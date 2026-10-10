// Claude Code Pro login, relayed through the bridge.
//
// Mode: local-only. The hosted service must never import this module.
//
// `claude auth login` prints a sign-in URL and waits for the code the sign-in
// page shows ("Paste code here if prompted"). The page's redirect is
// platform.claude.com's code page, so the sign-in can happen in any browser,
// a phone included. This relay starts the command with pipes, hands the URL to
// the caller (OpenCEO's "wake up" button), and writes the code the owner
// pastes back into the command. The code is written to the process and never
// stored or logged. A login counts only when the credential store was
// rewritten (see claude-auth-recovery.mjs for why an exit code is not enough).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { readClaudeCredentialStamp } from "./claude-auth-recovery.mjs";

const URL_PATTERN = /https:\/\/[^\s"'<>]*oauth\/authorize\?[^\s"'<>]+/;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const CODE_WAIT_MS = 60 * 1000;

export function createClaudeLoginRelay({
  buildCommand,
  buildEnv = () => process.env,
  spawnProcess = spawn,
  readCredentialStamp = readClaudeCredentialStamp,
  onSuccess = () => {},
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, any>} */
  const logins = new Map();

  function view(login) {
    return {
      id: login.id,
      status: login.status,
      url: login.url,
      detail: login.detail,
    };
  }

  function settle(login, status, detail) {
    if (login.status !== "waiting") return;
    login.status = status;
    login.detail = detail;
    clearTimeout(login.timer);
    for (const resolve of login.waiters.splice(0)) resolve(view(login));
  }

  /** Starts a login, or returns the one already waiting for a code. */
  async function start({ workspace = "" } = {}) {
    for (const login of logins.values()) {
      if (login.status === "waiting" && login.url) return view(login);
    }
    const commandSpec = buildCommand?.(["auth", "login"]) ?? { command: "claude", args: ["auth", "login"] };
    const env = { ...buildEnv(), BROWSER: "none" };
    const login = {
      id: randomUUID(),
      status: "waiting",
      url: "",
      detail: "",
      stampBefore: readCredentialStamp(),
      waiters: [],
      child: null,
      timer: null,
      startedAt: now(),
    };
    logins.set(login.id, login);
    const child = spawnProcess(commandSpec.command, commandSpec.args, {
      cwd: workspace || process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    login.child = child;
    let output = "";
    const seen = new Promise((resolve) => {
      const read = (chunk) => {
        output = `${output}${chunk}`.slice(-8000);
        const found = URL_PATTERN.exec(output);
        if (found && !login.url) {
          login.url = found[0];
          resolve();
        }
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.on("close", resolve);
      child.on("error", resolve);
    });
    child.on("error", (error) => settle(login, "failed", `Claude could not be started: ${String(error?.message ?? error)}`));
    child.on("close", async (code) => {
      if (login.status !== "waiting") return;
      if (readCredentialStamp() !== login.stampBefore) {
        await onSuccess();
        settle(login, "done", "Claude Code Pro login completed.");
      } else {
        settle(login, "failed", code === 0
          ? "The login ended without storing a new credential."
          : `The login did not complete (exit ${code ?? "unknown"}).`);
      }
    });
    login.timer = setTimeout(() => {
      settle(login, "failed", "The login was not finished in time. Start it again.");
      child.kill();
    }, LOGIN_TTL_MS);
    await Promise.race([seen, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    if (!login.url && login.status === "waiting") {
      settle(login, "failed", "Claude did not print a sign-in URL.");
      child.kill();
    }
    return view(login);
  }

  /** Gives the waiting login the code the sign-in page showed. */
  async function submitCode(id, code) {
    const login = logins.get(String(id ?? ""));
    if (!login) return null;
    if (login.status !== "waiting") return view(login);
    const clean = String(code ?? "").trim();
    if (!clean || clean.length > 2000 || /[\r\n]/.test(clean)) {
      return { ...view(login), detail: "Paste the code exactly as the sign-in page shows it." };
    }
    const settled = new Promise((resolve) => login.waiters.push(resolve));
    login.child?.stdin?.write(`${clean}\n`);
    return await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(() => resolve(view(login)), CODE_WAIT_MS)),
    ]);
  }

  function status(id) {
    const login = logins.get(String(id ?? ""));
    return login ? view(login) : null;
  }

  return { start, submitCode, status };
}

/**
 * HTTP routes for the relay, under /api/claude-auth/.
 *
 * - GET  /api/claude-auth/status            whether Claude Code Pro is signed in
 * - POST /api/claude-auth/login             start a login; returns its URL
 * - GET  /api/claude-auth/login/:id         a login's state
 * - POST /api/claude-auth/login/:id/code    the code the sign-in page showed
 *
 * Only callers on this machine without an Origin (OpenCEO's server) or an
 * allowed origin may use them.
 */
export function createClaudeLoginRoutes({ relay, readStatus, isAllowedOrigin, readJsonBody, sendJson, workspace }) {
  return async function handleClaudeLoginRequest(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith("/api/claude-auth/")) return false;
    const origin = String(request.headers.origin ?? "");
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(response, 403, { error: "Origin is not allowed to sign Claude in." });
      return true;
    }
    const method = request.method ?? "GET";
    if (method === "GET" && path === "/api/claude-auth/status") {
      sendJson(response, 200, await readStatus());
      return true;
    }
    if (method === "POST" && path === "/api/claude-auth/login") {
      sendJson(response, 200, await relay.start({ workspace }));
      return true;
    }
    const one = /^\/api\/claude-auth\/login\/([0-9a-f-]{36})(\/code)?$/.exec(path);
    if (one && method === "GET" && !one[2]) {
      const login = relay.status(one[1]);
      sendJson(response, login ? 200 : 404, login ?? { error: "Unknown login" });
      return true;
    }
    if (one && method === "POST" && one[2]) {
      const body = await readJsonBody(request);
      const login = await relay.submitCode(one[1], body?.code);
      sendJson(response, login ? 200 : 404, login ?? { error: "Unknown login" });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}

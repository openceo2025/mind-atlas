// Interactive Claude Code Pro OAuth recovery for the local bridge.
//
// Mode: local-only. The hosted service must never import this module.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * Fingerprint of the stored Claude credential, used to tell a real login from a
 * cancelled window. `claude auth login` exiting 0 is not proof: the wrapper can
 * exit 0 without the user completing the OAuth flow. A rewritten credential
 * file is the observable signal that a login actually happened.
 */
export function readClaudeCredentialStamp(home = process.env.USERPROFILE || process.env.HOME || "") {
  if (!home) return "";
  for (const name of [".credentials.json", "credentials.json"]) {
    try {
      const info = statSync(join(home, ".claude", name));
      return `${name}:${info.mtimeMs}:${info.size}`;
    } catch {
      // Try the next candidate; an absent store simply yields no stamp.
    }
  }
  return "";
}

export function isClaudeOAuthAuthenticationError(value) {
  const text = String(value ?? "").toLowerCase();
  return text.includes("oauth access token has been revoked")
    || (text.includes("failed to authenticate") && (text.includes("oauth") || text.includes("401")));
}

export function buildClaudeLoginPowerShellScript(commandSpec) {
  const command = quotePowerShellLiteral(commandSpec?.command ?? "claude");
  const args = Array.isArray(commandSpec?.args) ? commandSpec.args.map(quotePowerShellLiteral).join(" ") : "";
  return [
    "$ErrorActionPreference = 'Continue'",
    "try { $Host.UI.RawUI.WindowTitle = 'Mind Atlas - Claude Code Pro login' } catch {}",
    "Write-Host 'Mind Atlas detected an expired Claude Code Pro login.' -ForegroundColor Yellow",
    "Write-Host 'Complete the Claude login flow. The original Mind Atlas request will retry automatically.'",
    `& ${command}${args ? ` ${args}` : ""}`,
    "$exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { [int]$LASTEXITCODE }",
    "if ($exitCode -eq 0) {",
    "  Write-Host 'Claude login completed. Returning to Mind Atlas...' -ForegroundColor Green",
    "  Start-Sleep -Seconds 1",
    "} else {",
    "  Write-Host ('Claude login did not complete (exit ' + $exitCode + ').') -ForegroundColor Red",
    "  Read-Host 'Press Enter to close this window' | Out-Null",
    "}",
    "exit $exitCode",
  ].join("\r\n");
}

export function createClaudeAuthRecovery({
  buildCommand,
  buildEnv = () => process.env,
  onSuccess = () => {},
  platform = process.platform,
  spawnProcess = spawn,
  readCredentialStamp = readClaudeCredentialStamp,
} = {}) {
  let inFlight = null;

  return async function recoverClaudeAuth({ workspace = "" } = {}) {
    if (inFlight) return await inFlight;
    const commandSpec = buildCommand?.(["auth", "login"]) ?? { command: "claude", args: ["auth", "login"] };
    const env = buildEnv();
    const stampBefore = readCredentialStamp();
    const task = launchInteractiveLogin({ commandSpec, workspace, env, platform, spawnProcess })
      .then(async (result) => {
        if (!result.ok) return result;
        // A clean exit code is not evidence of a login. Require the credential
        // store to have been rewritten, otherwise the caller would retry the
        // request straight into the same authentication failure.
        if (readCredentialStamp() === stampBefore) {
          return {
            ok: false,
            exitCode: result.exitCode,
            detail: "The Claude login window closed without storing a new credential. Run `claude auth login` in a terminal and complete the browser flow.",
          };
        }
        await onSuccess();
        return result;
      });
    let tracked;
    tracked = task.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return await tracked;
  };
}

function launchInteractiveLogin({ commandSpec, workspace, env, platform, spawnProcess }) {
  if (platform !== "win32") {
    return waitForProcess(spawnProcess(commandSpec.command, commandSpec.args, {
      cwd: workspace || process.cwd(),
      env,
      windowsHide: false,
      stdio: "inherit",
    }));
  }

  const script = buildClaudeLoginPowerShellScript(commandSpec);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // `detached: true` on Windows means DETACHED_PROCESS: the child gets NO
  // console at all. `claude auth login` needs a terminal to prompt in, so it
  // exited immediately and the recovery reported a success that never happened.
  // `cmd /c start /wait` is what actually creates a visible console window, and
  // `/wait` lets the bridge await the user closing it.
  const child = spawnProcess(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/s",
    "/c",
    "start",
    "/wait",
    "Mind Atlas - Claude Code Pro login",
    "powershell.exe",
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ], {
    cwd: workspace || process.cwd(),
    env,
    windowsHide: false,
    stdio: "ignore",
  });
  return waitForProcess(child);
}

function waitForProcess(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", (error) => finish({
      ok: false,
      exitCode: null,
      detail: `Claude login window could not start: ${String(error?.message ?? error)}`,
    }));
    child.on("close", (code) => finish({
      ok: code === 0,
      exitCode: code ?? null,
      detail: code === 0
        ? "Claude Code Pro login completed."
        : `Claude Code Pro login was cancelled or failed (exit ${code ?? "unknown"}).`,
    }));
  });
}

function quotePowerShellLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

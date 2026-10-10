// The link between agents and the open Mind Atlas notebook.
//
// Mode: local-only.
//
// The notebook lives in the browser that has Mind Atlas open (IndexedDB), and
// that browser is the only thing that changes it, so undo, history and
// generations stay in one place. Agents reach it through this link:
//
// - Copy: the browser sends a sanitized copy of the notebook whenever it
//   changes. The Atlas MCP read tools read this copy, so a run started from
//   anywhere (OpenCEO included) sees the notebook as it is now.
// - Writes: an Atlas MCP write tool queues an operation here. The open
//   browser takes pending operations, applies them with its own store, and
//   reports the result, which is handed back to the waiting tool call. With
//   no browser open an operation waits, and the agent is told so.
//
// Operations are kept on disk until the browser reports them, so a bridge
// restart does not lose an agent's write.

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ATLAS_WRITE_TOOLS = Object.freeze([
  "add_child_nodes",
  "update_node_text",
  "set_node_status",
  "delete_node",
  "move_nodes",
  "bulk_update_nodes",
]);

const BROWSER_SEEN_MS = 15_000;
const DEFAULT_WAIT_MS = 20_000;
const MAX_PENDING = 200;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class AtlasLink {
  /** @param {{ dir: string, now?: () => number }} options */
  constructor(options) {
    this.dir = options.dir;
    this.now = options.now ?? (() => Date.now());
    this.copy = null;
    this.copyLoaded = false;
    this.ops = new Map();
    this.opsLoaded = false;
    this.waiters = new Map();
    this.tokens = new Map();
    this.browserSeenAt = 0;
  }

  // ------------------------------------------------------------ the copy

  async setCopy(payload) {
    const root = payload?.root;
    if (!root || typeof root !== "object" || typeof root.id !== "string") {
      throw new Error("A notebook copy needs a root node.");
    }
    this.copy = {
      title: String(payload?.title ?? root.title ?? ""),
      root,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.copyLoaded = true;
    this.browserSeenAt = this.now();
    await mkdir(this.dir, { recursive: true });
    await writeAtomically(join(this.dir, "atlas-copy.json"), JSON.stringify(this.copy));
    return { updatedAt: this.copy.updatedAt };
  }

  async getCopy() {
    if (!this.copyLoaded) {
      this.copyLoaded = true;
      try {
        this.copy = JSON.parse(await readFile(join(this.dir, "atlas-copy.json"), "utf8"));
      } catch {
        this.copy = null;
      }
    }
    return this.copy;
  }

  // ---------------------------------------------------------- run tokens

  /** A token an agent run's MCP server uses to queue writes as that run. */
  issueToken({ runId, provider, label }) {
    const token = randomBytes(24).toString("base64url");
    this.tokens.set(token, {
      runId: String(runId ?? ""),
      provider: String(provider ?? ""),
      label: String(label ?? "").slice(0, 80),
      expires: this.now() + TOKEN_TTL_MS,
    });
    return token;
  }

  runOf(token) {
    if (typeof token !== "string" || !token) return null;
    for (const [known, run] of this.tokens) {
      if (known.length === token.length && timingSafeEqual(Buffer.from(known), Buffer.from(token))) {
        if (run.expires < this.now()) {
          this.tokens.delete(known);
          return null;
        }
        return run;
      }
    }
    return null;
  }

  // ---------------------------------------------------------- operations

  get browserOnline() {
    return this.now() - this.browserSeenAt < BROWSER_SEEN_MS;
  }

  /** Queues one write and waits a little for the open browser to apply it. */
  async enqueue({ token, tool, args }, waitMs = DEFAULT_WAIT_MS) {
    const run = this.runOf(token);
    if (!run) return { error: "unknown_run", status: 403 };
    if (!ATLAS_WRITE_TOOLS.includes(tool)) return { error: "unknown_tool", status: 400 };
    await this.#loadOps();
    const pending = [...this.ops.values()].filter((op) => op.status === "pending");
    if (pending.length >= MAX_PENDING) return { error: "queue_full", status: 429 };
    const op = {
      id: randomUUID(),
      tool,
      args: args && typeof args === "object" && !Array.isArray(args) ? args : {},
      runId: run.runId,
      provider: run.provider,
      label: run.label,
      status: "pending",
      createdAt: new Date(this.now()).toISOString(),
      result: null,
    };
    this.ops.set(op.id, op);
    await this.#save(op);
    const settled = await this.#wait(op.id, waitMs);
    return { op: settled ?? op, browserOnline: this.browserOnline };
  }

  /** What the open browser should apply, oldest first. */
  async pending() {
    this.browserSeenAt = this.now();
    await this.#loadOps();
    return [...this.ops.values()]
      .filter((op) => op.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ id, tool, args, runId, provider, label, createdAt }) => ({ id, tool, args, runId, provider, label, createdAt }));
  }

  /** The browser applied (or could not apply) an operation. */
  async complete(id, result) {
    this.browserSeenAt = this.now();
    await this.#loadOps();
    const op = this.ops.get(String(id ?? ""));
    if (!op) return null;
    if (op.status !== "pending") return op;
    op.status = result?.ok ? "done" : "failed";
    op.result = {
      ok: Boolean(result?.ok),
      text: String(result?.text ?? "").slice(0, 4000),
      data: result?.data && typeof result.data === "object" ? result.data : null,
    };
    op.completedAt = new Date(this.now()).toISOString();
    await this.#save(op);
    for (const resolve of this.waiters.get(op.id) ?? []) resolve(op);
    this.waiters.delete(op.id);
    return op;
  }

  async #wait(id, waitMs) {
    const op = this.ops.get(id);
    if (!op || op.status !== "pending" || waitMs <= 0) return op ?? null;
    return await new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      const timer = setTimeout(() => resolve(this.ops.get(id) ?? null), waitMs);
      list.push((settled) => {
        clearTimeout(timer);
        resolve(settled);
      });
      this.waiters.set(id, list);
    });
  }

  async #loadOps() {
    if (this.opsLoaded) return;
    this.opsLoaded = true;
    let names = [];
    try {
      names = await readdir(join(this.dir, "atlas-ops"));
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const op = JSON.parse(await readFile(join(this.dir, "atlas-ops", name), "utf8"));
        if (op?.id && !this.ops.has(op.id)) this.ops.set(op.id, op);
      } catch {
        // A half-written file is skipped; its writer will write it again.
      }
    }
  }

  async #save(op) {
    const dir = join(this.dir, "atlas-ops");
    await mkdir(dir, { recursive: true });
    await writeAtomically(join(dir, `${op.id}.json`), JSON.stringify(op));
  }
}

async function writeAtomically(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}

/**
 * HTTP routes for the link. Returns true when it handled the request.
 *
 * - POST /api/atlas-link/copy         browser: the notebook as it is now
 * - GET  /api/atlas-link/copy         MCP server: read it
 * - POST /api/atlas-link/ops          MCP server: queue a write (run token)
 * - GET  /api/atlas-link/ops/pending  browser: writes to apply
 * - POST /api/atlas-link/ops/:id      browser: the result of one write
 */
export function createAtlasLinkRoutes({ link, isAllowedOrigin, readJsonBody = readJsonUpTo, sendJson }) {
  return async function handleAtlasLinkRequest(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith("/api/atlas-link/")) return false;
    const method = request.method ?? "GET";
    const origin = String(request.headers.origin ?? "");
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(response, 403, { error: "Origin is not allowed to reach the notebook link." });
      return true;
    }

    if (method === "POST" && path === "/api/atlas-link/copy") {
      sendJson(response, 200, await link.setCopy(await readJsonBody(request)));
      return true;
    }
    if (method === "GET" && path === "/api/atlas-link/copy") {
      // A copy is only for agents on this machine: a browser page never needs
      // it back, so a request that carries an Origin is refused.
      if (origin) {
        sendJson(response, 403, { error: "The notebook copy is for local agents only." });
        return true;
      }
      sendJson(response, 200, { copy: await link.getCopy(), browserOnline: link.browserOnline });
      return true;
    }
    if (method === "POST" && path === "/api/atlas-link/ops") {
      if (origin) {
        sendJson(response, 403, { error: "Writes are queued by agent runs only." });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await link.enqueue({
        token: request.headers["x-mind-atlas-run-token"],
        tool: String(body?.tool ?? ""),
        args: body?.args,
      });
      if (result.error) {
        sendJson(response, result.status ?? 400, { error: result.error });
        return true;
      }
      sendJson(response, 200, result);
      return true;
    }
    if (method === "GET" && path === "/api/atlas-link/ops/pending") {
      sendJson(response, 200, { ops: await link.pending() });
      return true;
    }
    const done = /^\/api\/atlas-link\/ops\/([0-9a-f-]{36})$/.exec(path);
    if (method === "POST" && done) {
      const op = await link.complete(done[1], await readJsonBody(request));
      sendJson(response, op ? 200 : 404, op ? { id: op.id, status: op.status } : { error: "Unknown operation" });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}

/** A JSON body of at most `limit` bytes; a notebook copy can be large. */
export function readJsonUpTo(request, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error("Request body must be JSON"), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

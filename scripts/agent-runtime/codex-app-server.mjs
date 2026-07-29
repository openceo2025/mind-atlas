// Persistent `codex app-server` connection over stdio JSON-RPC.
//
// Mode: local-only. The process is owned by the local bridge and is never
// exposed on a network socket (`--listen` is deliberately not used).
//
// Protocol facts verified on codex-cli 0.145.0-alpha.18 and recorded in
// docs/local-agent-poc-results.md:
// - `initialize` must be followed by an `initialized` notification;
// - notifications are routed by `threadId` in their params;
// - approvals arrive as server-initiated requests and must be answered with
//   `accept` / `decline` (not `approved`);
// - `turn/completed` carries an empty `items` array, so the final agent message
//   must be collected from `item/completed`.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const INITIALIZE_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_BACKOFF_MS = 30_000;

export class CodexAppServerConnection extends EventEmitter {
  /**
   * @param {{ command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
   *           clientInfo: { name: string, title: string, version: string },
   *           onDiagnostic?: (text: string) => void }} options
   */
  constructor(options) {
    super();
    this.options = options;
    this.child = null;
    this.nextRequestId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {Map<string, { onNotification: Function, onServerRequest: Function }>} */
    this.threadHandlers = new Map();
    this.readyPromise = null;
    this.buffer = "";
    this.restartAttempts = 0;
    this.closed = false;
    this.initializeResult = null;
    /** Notifications that arrive before their thread handler is registered. */
    this.pendingByThread = new Map();
  }

  async ready() {
    if (this.closed) throw new Error("Codex app-server connection was closed");
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.#start().catch((error) => {
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  async #start() {
    const { command, args, cwd, env } = this.options;
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.buffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#consume(chunk));
    child.stdout.on("error", () => {});
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.options.onDiagnostic?.(String(chunk).slice(0, 4000));
    });
    child.stderr.on("error", () => {});
    child.on("error", (error) => this.#handleExit(error));
    child.on("close", () => this.#handleExit(null));

    const initialize = await this.#request("initialize", {
      clientInfo: this.options.clientInfo,
      capabilities: { experimentalApi: true, requestAttestation: false },
    }, INITIALIZE_TIMEOUT_MS);
    this.initializeResult = initialize;
    this.#send({ method: "initialized", params: {} });
    this.restartAttempts = 0;
    return initialize;
  }

  #handleExit(error) {
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error ?? new Error("Codex app-server exited"));
    }
    this.pending.clear();
    if (this.closed) return;
    this.emit("exit", { error: error ? String(error.message ?? error) : "" });
    if (!child) return;
    // Threads are recovered lazily: the next request restarts the process and
    // the adapter re-reads or resumes affected threads.
    this.restartAttempts += 1;
  }

  backoffMs() {
    return Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.max(0, this.restartAttempts - 1));
  }

  #consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        this.options.onDiagnostic?.(`unparsable app-server line: ${trimmed.slice(0, 300)}`);
        continue;
      }
      this.#dispatch(message);
    }
  }

  #dispatch(message) {
    if (message.id !== undefined && message.method === undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new CodexProtocolError(message.error));
      else entry.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#dispatchServerRequest(message);
      return;
    }
    const threadId = message.params?.threadId ?? message.params?.thread?.id ?? "";
    const handler = threadId ? this.threadHandlers.get(threadId) : null;
    if (handler) {
      handler.onNotification(message.method, message.params ?? {});
      return;
    }
    if (threadId) {
      const queued = this.pendingByThread.get(threadId) ?? [];
      queued.push({ method: message.method, params: message.params ?? {} });
      if (queued.length <= 500) this.pendingByThread.set(threadId, queued);
      return;
    }
    this.emit("notification", { method: message.method, params: message.params ?? {} });
  }

  #dispatchServerRequest(message) {
    const threadId = message.params?.threadId ?? "";
    const handler = threadId ? this.threadHandlers.get(threadId) : null;
    if (!handler) {
      this.respond(message.id, null, { code: -32601, message: "No Mind Atlas run owns this thread" });
      return;
    }
    Promise.resolve()
      .then(() => handler.onServerRequest(message.method, message.params ?? {}, message.id))
      .catch((error) => {
        this.respond(message.id, null, { code: -32000, message: String(error?.message ?? error) });
      });
  }

  respond(id, result, error) {
    if (!this.child || this.child.stdin.destroyed) return;
    this.#send(error ? { id, error } : { id, result: result ?? {} });
  }

  #send(message) {
    if (!this.child || this.child.stdin.destroyed) return;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // A dead pipe surfaces through the close handler.
    }
  }

  #request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#send({ method, id, params });
    });
  }

  /** Public request helper that guarantees the process is initialized first. */
  async request(method, params, timeoutMs) {
    await this.ready();
    return this.#request(method, params, timeoutMs);
  }

  registerThread(threadId, handlers) {
    if (!threadId) return () => {};
    this.threadHandlers.set(threadId, handlers);
    const queued = this.pendingByThread.get(threadId);
    if (queued) {
      this.pendingByThread.delete(threadId);
      for (const entry of queued) handlers.onNotification(entry.method, entry.params);
    }
    return () => {
      this.threadHandlers.delete(threadId);
    };
  }

  close() {
    this.closed = true;
    this.threadHandlers.clear();
    try {
      this.child?.stdin.end();
      this.child?.kill();
    } catch {
      // best effort
    }
    this.child = null;
    this.readyPromise = null;
  }
}

export class CodexProtocolError extends Error {
  constructor(error) {
    super(String(error?.message ?? "Codex app-server error"));
    this.name = "CodexProtocolError";
    this.code = error?.code;
    this.data = error?.data;
  }
}

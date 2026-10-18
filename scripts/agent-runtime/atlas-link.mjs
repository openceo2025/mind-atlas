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
//
// - Latest: with each copy the browser sends the whole notebook and the time
//   of the copy it started from (`basedOn`). A browser whose notebook came
//   from older storage (another tab, a restored profile) starts from an older
//   copy than the newest one here: its copy is refused, the newest is kept,
//   writes wait, and the browser is told so, to load the newest or to keep
//   its own on purpose (OpenCEO: the notebook went back to an old state).

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { applyToTree, findNode, readableCopy } from "./spaces.mjs";

export const ATLAS_WRITE_TOOLS = Object.freeze([
  "add_child_nodes",
  "update_node_text",
  "set_node_status",
  "delete_node",
  "move_nodes",
  "bulk_update_nodes",
  "save_to_cloud",
  // Internal: a branch moved in from another space (OpenCEO ADR 0089).
  "insert_branch",
]);

const BROWSER_SEEN_MS = 15_000;
/** How long the browser's request for writes may wait for one to arrive. */
const MAX_PENDING_WAIT_MS = 25_000;
const DEFAULT_WAIT_MS = 20_000;
const MAX_PENDING = 200;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class AtlasLink {
  /** @param {{ dir: string, now?: () => number, spaces?: import("./spaces.mjs").SpaceStore }} options */
  constructor(options) {
    this.dir = options.dir;
    /** Spaces beside the open notebook (OpenCEO ADR 0089), when given. */
    this.spaces = options.spaces ?? null;
    this.now = options.now ?? (() => Date.now());
    this.copy = null;
    this.copyLoaded = false;
    this.ops = new Map();
    this.opsLoaded = false;
    this.waiters = new Map();
    this.tokens = new Map();
    this.browserSeenAt = 0;
    /** Browsers waiting for a write to arrive (long poll). */
    this.pendingWaiters = new Set();
    /** The newest whole notebook, and when its copy was taken. */
    this.latest = null;
    this.latestLoaded = false;
    /** Set while a browser with an older notebook is open. */
    this.conflict = null;
  }

  // ------------------------------------------------------------ the copy

  async setCopy(payload) {
    const root = payload?.root;
    if (!root || typeof root !== "object" || typeof root.id !== "string") {
      throw new Error("A notebook copy needs a root node.");
    }
    this.browserSeenAt = this.now();
    const latest = await this.latestFor(root.id);
    const basedOn = String(payload?.basedOn ?? "");
    // The same notebook as the newest (a new tab opened on it) is not older.
    const same = payload?.full && latest && JSON.stringify(payload.full) === JSON.stringify(latest.root);
    if (latest && latest.rootId === root.id && payload?.force !== true && !same && basedOn < latest.acceptedAt) {
      // Older than what is here: keep the newest, and say so.
      this.conflict = { at: new Date(this.now()).toISOString(), latestAt: latest.acceptedAt };
      return { stale: true, latestAt: latest.acceptedAt };
    }
    this.conflict = null;
    this.copy = {
      title: String(payload?.title ?? root.title ?? ""),
      root,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.copyLoaded = true;
    this.browserSeenAt = this.now();
    await mkdir(this.dir, { recursive: true });
    await writeAtomically(join(this.dir, "atlas-copy.json"), JSON.stringify(this.copy));
    if (payload?.full && typeof payload.full === "object") {
      this.latest = { rootId: root.id, acceptedAt: this.copy.updatedAt, root: payload.full };
      await writeAtomically(join(this.dir, "atlas-latest.json"), JSON.stringify(this.latest));
      // The open notebook is a space too, kept beside the others. The
      // owner's own notebook is the owner's space.
      if (this.spaces) {
        const known = await this.spaces.get(root.id);
        await this.spaces.save(payload.full, {
          acceptedAt: this.copy.updatedAt,
          kind: known?.kind ?? (root.id === "atlas-root" ? "owner" : "other"),
        });
      }
    } else if (this.latest && this.latest.rootId === root.id) {
      this.latest = { ...this.latest, acceptedAt: this.copy.updatedAt };
    }
    // Writes held back during a conflict may go on now.
    for (const wake of [...this.pendingWaiters]) wake();
    return { updatedAt: this.copy.updatedAt };
  }

  /** The newest whole copy of one notebook: its space, or the latest kept. */
  async latestFor(rootId) {
    if (this.spaces) {
      const space = await this.spaces.get(rootId);
      if (space?.acceptedAt) return { rootId, acceptedAt: space.acceptedAt, root: space.root };
    }
    const latest = await this.getLatest();
    return latest && latest.rootId === rootId ? latest : null;
  }

  /** The root id of the notebook open in the browser, or "". */
  get openRootId() {
    return String(this.copy?.root?.id ?? "");
  }

  /**
   * Which space a write or read means (ADR 0089): the one open in the
   * browser when none is named or the named one is open; otherwise the
   * named space's file. Null when no such space is known.
   */
  async spaceFor(name) {
    await this.getCopy();
    const key = String(name ?? "").trim();
    if (!key || !this.spaces) return { open: true };
    if (key === this.openRootId || key === String(this.copy?.title ?? "")) return { open: true };
    const space = await this.spaces.find(key);
    if (!space) return null;
    if (space.root.id === this.openRootId) return { open: true };
    return { open: false, space };
  }

  /** The newest whole notebook kept here, or null. */
  async getLatest() {
    if (!this.latestLoaded) {
      this.latestLoaded = true;
      try {
        this.latest = JSON.parse(await readFile(join(this.dir, "atlas-latest.json"), "utf8"));
      } catch {
        this.latest = null;
      }
    }
    return this.latest;
  }

  /**
   * What OpenCEO watches (local-only): which notebook is open, how big it is,
   * and whether a browser has it open. No text leaves through here.
   */
  async status() {
    const copy = await this.getCopy();
    return {
      browserOnline: this.browserOnline,
      // A browser with an older notebook is open (writes wait meanwhile).
      ...(this.conflict ? { conflict: this.conflict } : {}),
      // The open notebook is one of the spaces (ADR 0089): another space
      // opened in the browser is a normal change, not a lost notebook.
      ...(this.spaces && copy?.root?.id && (await this.spaces.get(copy.root.id)) ? { openIsSpace: true } : {}),
      copy: copy
        ? {
            rootId: String(copy.root?.id ?? ""),
            title: String(copy.title ?? ""),
            nodeCount: countNodes(copy.root),
            updatedAt: String(copy.updatedAt ?? ""),
          }
        : null,
    };
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
    // A browser waiting for writes right now is open, however long ago its
    // last request began.
    return this.pendingWaiters.size > 0 || this.now() - this.browserSeenAt < BROWSER_SEEN_MS;
  }

  /** Queues one write and waits a little for the open browser to apply it. */
  async enqueue({ token, tool, args }, waitMs = DEFAULT_WAIT_MS) {
    const run = this.runOf(token);
    if (!run) return { error: "unknown_run", status: 403 };
    if (!ATLAS_WRITE_TOOLS.includes(tool)) return { error: "unknown_tool", status: 400 };
    const cleanArgs = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    const target = await this.spaceFor(cleanArgs.space);
    if (!target) return { error: "unknown_space", status: 404 };
    if (!target.open) return await this.writeSpace(target.space, tool, cleanArgs, run);
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
    // A browser waiting for writes takes this one at once.
    for (const wake of [...this.pendingWaiters]) wake();
    const settled = await this.#wait(op.id, waitMs);
    return { op: settled ?? op, browserOnline: this.browserOnline };
  }

  /** A write to a space no browser has open: applied to its file here. */
  async writeSpace(space, tool, args, run) {
    const at = new Date(this.now()).toISOString();
    const result =
      tool === "save_to_cloud"
        ? { ok: true, text: "Spaces are kept on this PC already." }
        : applyToTree(space.root, tool, args, run.label, this.now);
    if (result.ok && tool !== "save_to_cloud") await this.spaces.save(space.root, { acceptedAt: at });
    return {
      op: { id: randomUUID(), tool, status: result.ok ? "done" : "failed", result, createdAt: at },
      browserOnline: this.browserOnline,
    };
  }

  /** A space's tree as agents read it, or the open notebook's copy. */
  async readSpace(name) {
    const target = await this.spaceFor(name);
    if (!target) return null;
    if (target.open) return await this.getCopy();
    return {
      title: String(target.space.root.title ?? ""),
      root: readableCopy(target.space.root),
      updatedAt: target.space.acceptedAt,
    };
  }

  /**
   * Moves a branch from one space to another (ADR 0089): written into the
   * target, then taken out of the source, each where that space lives (the
   * open one through the browser, the others here).
   */
  async moveBranch({ token, nodeId, from, to, parentId }) {
    const run = this.runOf(token);
    if (!run) return { error: "unknown_run", status: 403 };
    const source = await this.spaceFor(from);
    const target = await this.spaceFor(to);
    if (!source || !target) return { error: "unknown_space", status: 404 };
    if (source.open && target.open) return { error: "same_space", status: 400 };
    const sourceRoot = source.open ? (await this.latestFor(this.openRootId))?.root : source.space.root;
    const branch = sourceRoot ? findNode(sourceRoot, String(nodeId ?? "")) : null;
    if (!branch) return { error: "unknown_node", status: 404 };
    if (branch.id === sourceRoot.id) return { error: "root", status: 400 };
    const targetRoot = target.open ? (await this.latestFor(this.openRootId))?.root : target.space.root;
    const into = String(parentId ?? "") || String(targetRoot?.id ?? "");
    const copy = JSON.parse(JSON.stringify(branch));
    const placed = target.open
      ? await this.enqueue({ token, tool: "insert_branch", args: { parentId: into, branch: copy } })
      : await this.writeSpace(target.space, "insert_branch", { parentId: into, branch: copy }, run);
    if (placed.op?.status !== "done" && placed.op?.status !== "pending") {
      return { error: placed.op?.result?.text ?? "could_not_place", status: 409 };
    }
    // Only once it is in the target is it taken out of the source.
    const removed = source.open
      ? await this.enqueue({ token, tool: "delete_node", args: { nodeId: branch.id } })
      : await this.writeSpace(source.space, "delete_node", { nodeId: branch.id }, run);
    return { moved: true, placed: placed.op?.status, removed: removed.op?.status };
  }

  /**
   * What the open browser should apply, oldest first. With `waitMs`, an empty
   * answer waits until a write arrives (up to MAX_PENDING_WAIT_MS): a
   * browser tab in the background has its timers slowed to once a minute,
   * but an answer to a request it is waiting on reaches it at once.
   */
  async pending(waitMs = 0) {
    this.browserSeenAt = this.now();
    await this.#loadOps();
    const wait = Math.min(Math.max(0, Number(waitMs) || 0), MAX_PENDING_WAIT_MS);
    // A browser with an older notebook gets no writes: applied there, they
    // would be lost when the newest is loaded.
    if (this.conflict) {
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 2_000)));
      return [];
    }
    if (wait > 0 && ![...this.ops.values()].some((op) => op.status === "pending")) {
      await new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.pendingWaiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, wait);
        this.pendingWaiters.add(wake);
      });
      this.browserSeenAt = this.now();
    }
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

function countNodes(node) {
  if (!node || typeof node !== "object") return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((total, child) => total + countNodes(child), 0);
}

async function writeAtomically(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  // Windows rejects a rename onto a file another write or read has open, for
  // a moment (EPERM/EBUSY/EACCES): the copy is written often. Retry briefly.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      const retryable = error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
      if (!retryable || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

/**
 * HTTP routes for the link. Returns true when it handled the request.
 *
 * - POST /api/atlas-link/copy         browser: the notebook as it is now
 * - GET  /api/atlas-link/copy         MCP server: read it
 * - GET  /api/atlas-link/status       OpenCEO: which notebook is open, its size
 * - GET  /api/atlas-link/latest       browser: the newest whole notebook kept here
 * - POST /api/atlas-link/ops          MCP server: queue a write (run token)
 * - GET  /api/atlas-link/ops/pending  browser: writes to apply (?wait=ms: until one arrives)
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
    if (method === "GET" && path === "/api/atlas-link/latest") {
      // The newest whole notebook, for a browser that found its own older.
      const latest = await link.getLatest();
      sendJson(response, latest ? 200 : 404, latest ?? { error: "No notebook kept yet." });
      return true;
    }
    if (method === "GET" && path === "/api/atlas-link/status") {
      // For OpenCEO on this machine; a page has no need of it.
      if (origin) {
        sendJson(response, 403, { error: "The notebook status is for local programs only." });
        return true;
      }
      sendJson(response, 200, await link.status());
      return true;
    }
    if (method === "GET" && path === "/api/atlas-link/copy") {
      // A copy is only for agents on this machine: a browser page never needs
      // it back, so a request that carries an Origin is refused.
      if (origin) {
        sendJson(response, 403, { error: "The notebook copy is for local agents only." });
        return true;
      }
      const space = url.searchParams.get("space") ?? "";
      const copy = await link.readSpace(space);
      if (space && !copy) {
        sendJson(response, 404, { error: `No space ${space}.` });
        return true;
      }
      sendJson(response, 200, { copy, browserOnline: link.browserOnline });
      return true;
    }
    if (path === "/api/atlas-link/spaces") {
      // Spaces (ADR 0089), for local programs and agents only.
      if (origin || !link.spaces) {
        sendJson(response, 403, { error: "Spaces are for local programs only." });
        return true;
      }
      if (method === "GET") {
        await link.getCopy();
        sendJson(response, 200, { spaces: await link.spaces.list(), open: link.openRootId });
        return true;
      }
      if (method === "POST") {
        const body = await readJsonBody(request);
        try {
          sendJson(response, 200, await link.spaces.create({ title: body?.title, kind: body?.kind }));
        } catch (error) {
          sendJson(response, 400, { error: String(error?.message ?? error) });
        }
        return true;
      }
    }
    if (method === "POST" && path === "/api/atlas-link/move") {
      if (origin) {
        sendJson(response, 403, { error: "Moves are made by agent runs only." });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await link.moveBranch({
        token: request.headers["x-mind-atlas-run-token"],
        nodeId: body?.nodeId,
        from: body?.from,
        to: body?.to,
        parentId: body?.parentId,
      });
      sendJson(response, result.error ? (result.status ?? 400) : 200, result);
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
      sendJson(response, 200, { ops: await link.pending(Number(url.searchParams.get("wait") ?? 0)) });
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

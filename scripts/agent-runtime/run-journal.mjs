// Durable run journal for the local agent runtime.
//
// Mode: local-only.
//
// Layout (outside Git):
//   server-data/agent-runtime/
//     runs/<run-id>/manifest.json    atomic temp+rename
//     runs/<run-id>/events.jsonl     append-only, sequence ordered
//     runs/<run-id>/final.json       bounded terminal record
//     runs/<run-id>/diagnostics.log  bounded raw provider diagnostics
//     sessions/<provider-session-key>.json
//     handoffs/<handoff-id>.json
//
// Rules enforced here:
// - the manifest is written before a provider process starts;
// - every event is appended to disk before it is broadcast;
// - a run is acknowledged only by an explicit ack call from the app;
// - unacknowledged completed runs are never deleted by retention.

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

import {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_MANIFEST_SCHEMA_VERSION,
  boundText,
  canTransition,
  isTerminalStatus,
  redactValue,
} from "./types.mjs";

const DEFAULT_MAX_EVENT_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RUN_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_REPLAY_LIMIT = 5000;
const MAX_DIAGNOSTICS_BYTES = 512 * 1024;

/**
 * Windows can transiently reject an atomic rename with EPERM/EBUSY when a
 * virus scanner or another handle touches the target. Retry briefly so a run
 * never loses its manifest for a recoverable filesystem hiccup.
 */
async function renameWithRetry(from, to, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const retryable = error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

export class AgentRunStore {
  constructor(options = {}) {
    this.baseDir = resolve(options.baseDir ?? join(process.cwd(), "server-data", "agent-runtime"));
    this.runsDir = join(this.baseDir, "runs");
    this.sessionsDir = join(this.baseDir, "sessions");
    this.handoffsDir = join(this.baseDir, "handoffs");
    this.maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
    this.maxRunOutputBytes = options.maxRunOutputBytes ?? DEFAULT_MAX_RUN_OUTPUT_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    this.instanceId = options.instanceId ?? randomUUID();
    /** @type {Map<string, RunHandle>} */
    this.active = new Map();
    /** @type {Map<string, Set<(event: object) => void>>} */
    this.subscribers = new Map();
    /**
     * Manifest writes are serialized per run. Windows rejects a concurrent
     * temp-file rename onto the same target with EPERM, and status/session
     * updates can legitimately overlap.
     * @type {Map<string, Promise<unknown>>}
     */
    this.manifestChains = new Map();
  }

  async init() {
    await mkdir(this.runsDir, { recursive: true });
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.handoffsDir, { recursive: true });
  }

  runDir(runId) {
    return join(this.runsDir, runId);
  }

  /**
   * Create a run directory and write its manifest before any provider process
   * starts. Returns a handle used for appending events.
   */
  async createRun(manifest) {
    const runId = manifest.runId ?? randomUUID();
    const now = new Date().toISOString();
    const record = {
      schemaVersion: AGENT_MANIFEST_SCHEMA_VERSION,
      runId,
      clientRunId: manifest.clientRunId ?? "",
      provider: manifest.provider,
      route: manifest.route,
      requestedRoute: manifest.requestedRoute ?? manifest.route,
      status: "queued",
      requestNodeId: manifest.requestNodeId ?? "",
      sourceNodeId: manifest.sourceNodeId ?? "",
      workspace: manifest.workspace ?? "",
      sourceWorkspace: manifest.sourceWorkspace ?? manifest.workspace ?? "",
      workspaceMode: manifest.workspaceMode === "worktree" ? "worktree" : "shared",
      worktree: manifest.worktree ?? null,
      model: manifest.model ?? "",
      effort: manifest.effort ?? "",
      permissionMode: manifest.permissionMode ?? "",
      sandboxMode: manifest.sandboxMode ?? "",
      authMode: manifest.authMode ?? "",
      title: boundText(manifest.title ?? "", 300),
      session: manifest.session ?? null,
      ownership: manifest.ownership ?? { state: "mind_atlas", leaseId: randomUUID(), acquiredAt: now },
      git: manifest.git ?? null,
      gitAfter: manifest.gitAfter ?? null,
      checkpoint: manifest.checkpoint ?? null,
      checkpointRevert: manifest.checkpointRevert ?? null,
      bridgeInstanceId: this.instanceId,
      createdAt: now,
      updatedAt: now,
      completedAt: "",
      lastEventSequence: 0,
      finalEventId: "",
      acknowledgedAt: "",
    };
    await mkdir(this.runDir(runId), { recursive: true });
    await this.#writeManifest(record);
    const handle = new RunHandle(this, record);
    this.active.set(runId, handle);
    return handle;
  }

  #writeManifest(record) {
    const runId = record.runId;
    const previous = this.manifestChains.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const target = join(this.runDir(runId), "manifest.json");
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
        await renameWithRetry(temporary, target);
      });
    this.manifestChains.set(runId, next);
    next.finally(() => {
      if (this.manifestChains.get(runId) === next) this.manifestChains.delete(runId);
    }).catch(() => {});
    return next;
  }

  async readManifest(runId) {
    try {
      const text = await readFile(join(this.runDir(runId), "manifest.json"), "utf8");
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async writeManifest(record) {
    await this.#writeManifest(record);
  }

  async readFinal(runId) {
    try {
      return JSON.parse(await readFile(join(this.runDir(runId), "final.json"), "utf8"));
    } catch {
      return null;
    }
  }

  /** Read persisted events after `sinceSequence`, bounded by the replay limit. */
  async readEvents(runId, sinceSequence = 0, limit = this.replayLimit) {
    const path = join(this.runDir(runId), "events.jsonl");
    const events = [];
    let stream;
    try {
      stream = createReadStream(path, { encoding: "utf8" });
    } catch {
      return events;
    }
    try {
      const reader = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (typeof parsed?.sequence !== "number" || parsed.sequence <= sinceSequence) continue;
        events.push(parsed);
        if (events.length >= limit) break;
      }
    } catch {
      // A partially written tail is tolerated; recovery uses what is readable.
    } finally {
      stream.destroy();
    }
    return events;
  }

  async listRuns({ limit = 100, includeAcknowledged = true } = {}) {
    let entries = [];
    try {
      entries = await readdir(this.runsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await this.readManifest(entry.name);
      if (!manifest) continue;
      if (!includeAcknowledged && manifest.acknowledgedAt) continue;
      manifests.push(manifest);
    }
    manifests.sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0));
    return manifests.slice(0, limit);
  }

  /**
   * Return the newest provider-reported allowance event for each rate-limit
   * window. This is intentionally journal-backed: restarting the bridge must
   * not make the last known Claude plan utilization disappear.
   */
  async latestUsageEvents({ provider, scope, authMode = "", limitRuns = 80 } = {}) {
    const found = new Map();
    for (const manifest of await this.listRuns({ limit: limitRuns })) {
      if (provider && manifest.provider !== provider) continue;
      if (authMode && manifest.authMode !== authMode) continue;
      const events = await this.readEvents(manifest.runId, 0, 10_000);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        const usage = event?.usage ?? {};
        if (event?.kind !== "usage_updated" || (scope && usage.scope !== scope)) continue;
        if (authMode && usage.authMode && usage.authMode !== authMode) continue;
        const key = String(usage.rateLimitType || usage.scope || "default");
        if (!found.has(key)) found.set(key, { ...event, manifestAuthMode: manifest.authMode });
      }
    }
    return [...found.values()].sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0));
  }

  /**
   * On startup, a run left in a non-terminal state by a previous bridge process
   * cannot still be streaming into this process. Mark it interrupted so the
   * result is recoverable instead of hanging forever. Runs owned by the native
   * application are left alone.
   */
  async recoverAbandonedRuns() {
    const manifests = await this.listRuns({ limit: 500 });
    const recovered = [];
    for (const manifest of manifests) {
      if (isTerminalStatus(manifest.status)) continue;
      if (manifest.status === "native_owned" || manifest.status === "transferring") continue;
      if (manifest.bridgeInstanceId === this.instanceId) continue;
      const now = new Date().toISOString();
      const next = {
        ...manifest,
        status: "interrupted",
        updatedAt: now,
        completedAt: manifest.completedAt || now,
        interruptedReason: "The local bridge restarted before this agent run finished.",
      };
      await this.#writeManifest(next);
      const final = await this.readFinal(manifest.runId);
      if (!final) {
        await this.writeFinal(manifest.runId, {
          runId: manifest.runId,
          provider: manifest.provider,
          route: manifest.route,
          status: "interrupted",
          error: "The local bridge restarted before this agent run finished.",
          text: "",
          completedAt: now,
        });
      }
      recovered.push(next);
    }
    return recovered;
  }

  async writeFinal(runId, final) {
    const target = join(this.runDir(runId), "final.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    const bounded = {
      ...final,
      text: boundText(final.text ?? "", 400_000),
      error: boundText(final.error ?? "", 20_000),
    };
    await writeFile(temporary, JSON.stringify(redactValue(bounded), null, 2), "utf8");
    await renameWithRetry(temporary, target);
  }

  async appendDiagnostics(runId, text) {
    if (!text) return;
    const path = join(this.runDir(runId), "diagnostics.log");
    try {
      const info = await stat(path).catch(() => null);
      if (info && info.size > MAX_DIAGNOSTICS_BYTES) return;
      await appendFile(path, `${boundText(String(text), 8000)}\n`, "utf8");
    } catch {
      // Diagnostics are best effort and must never break a run.
    }
  }

  subscribe(runId, listener) {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.subscribers.delete(runId);
    };
  }

  broadcast(runId, event) {
    const set = this.subscribers.get(runId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // A broken browser connection must never stall the provider stream.
      }
    }
  }

  getHandle(runId) {
    return this.active.get(runId) ?? null;
  }

  releaseHandle(runId) {
    this.active.delete(runId);
  }

  /** Age and byte based retention that never removes unacknowledged results. */
  async applyRetention() {
    const manifests = await this.listRuns({ limit: 5000 });
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    let totalBytes = 0;
    const survivors = [];
    for (const manifest of manifests) {
      const dir = this.runDir(manifest.runId);
      let bytes = 0;
      try {
        for (const name of await readdir(dir)) {
          const info = await stat(join(dir, name)).catch(() => null);
          bytes += info?.size ?? 0;
        }
      } catch {
        continue;
      }
      const created = Date.parse(manifest.createdAt ?? "") || 0;
      const removable = Boolean(manifest.acknowledgedAt) && isTerminalStatus(manifest.status);
      if (removable && created && created < cutoff) {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
        continue;
      }
      totalBytes += bytes;
      survivors.push({ manifest, bytes, created, removable });
    }
    if (totalBytes > this.maxEventBytes) {
      survivors.sort((left, right) => left.created - right.created);
      for (const entry of survivors) {
        if (totalBytes <= this.maxEventBytes) break;
        if (!entry.removable) continue;
        await rm(this.runDir(entry.manifest.runId), { recursive: true, force: true });
        totalBytes -= entry.bytes;
        removed += 1;
      }
    }
    return { removed, totalBytes };
  }

  async saveSession(key, value) {
    if (!key) return;
    const safeKey = String(key).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
    const target = join(this.sessionsDir, `${safeKey}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(redactValue(value), null, 2), "utf8");
    await renameWithRetry(temporary, target);
  }

  async readSession(key) {
    const safeKey = String(key ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
    if (!safeKey) return null;
    try {
      return JSON.parse(await readFile(join(this.sessionsDir, `${safeKey}.json`), "utf8"));
    } catch {
      return null;
    }
  }

  async saveHandoff(record) {
    const id = record.handoffId ?? randomUUID();
    const target = join(this.handoffsDir, `${id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const payload = { ...record, handoffId: id };
    await writeFile(temporary, JSON.stringify(redactValue(payload), null, 2), "utf8");
    await renameWithRetry(temporary, target);
    return payload;
  }

  async readHandoff(handoffId) {
    const safeId = String(handoffId ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
    if (!safeId) return null;
    try {
      return JSON.parse(await readFile(join(this.handoffsDir, `${safeId}.json`), "utf8"));
    } catch {
      return null;
    }
  }
}

export class RunHandle {
  constructor(store, manifest) {
    this.store = store;
    this.manifest = manifest;
    this.sequence = manifest.lastEventSequence ?? 0;
    this.outputBytes = 0;
    this.overflowed = false;
    this.seenProviderEventIds = new Set();
    this.writeChain = Promise.resolve();
    this.eventsPath = join(store.runDir(manifest.runId), "events.jsonl");
  }

  get runId() {
    return this.manifest.runId;
  }

  get status() {
    return this.manifest.status;
  }

  /**
   * Append a normalized event. Persisted before broadcast so a browser can
   * always replay what it missed. Duplicate provider events are ignored.
   */
  async append(partial) {
    if (partial.providerEventId) {
      if (this.seenProviderEventIds.has(partial.providerEventId)) return null;
      this.seenProviderEventIds.add(partial.providerEventId);
      if (this.seenProviderEventIds.size > 20_000) this.seenProviderEventIds.clear();
    }
    this.sequence += 1;
    const event = redactValue({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: randomUUID(),
      sequence: this.sequence,
      runId: this.manifest.runId,
      provider: this.manifest.provider,
      route: this.manifest.route,
      createdAt: new Date().toISOString(),
      ...partial,
    });
    const line = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (this.outputBytes + bytes > this.store.maxRunOutputBytes) {
      if (!this.overflowed) {
        this.overflowed = true;
        await this.#persist({
          schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
          eventId: randomUUID(),
          sequence: this.sequence,
          runId: this.manifest.runId,
          provider: this.manifest.provider,
          route: this.manifest.route,
          createdAt: new Date().toISOString(),
          kind: "warning",
          code: "output_budget_exceeded",
          message: "Run output exceeded the local byte budget. Later low-value events are dropped; the final answer is still recorded.",
        });
      }
      // Lifecycle, final message, usage, and errors always survive overflow.
      const critical = new Set(["lifecycle", "message_completed", "error", "usage_updated", "approval_requested", "user_input_requested"]);
      if (!critical.has(event.kind)) return null;
    }
    this.outputBytes += bytes;
    await this.#persist(event);
    this.store.broadcast(this.manifest.runId, event);
    return event;
  }

  #persist(event) {
    this.writeChain = this.writeChain
      .then(() => appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8"))
      .catch(() => {
        // Disk failure must not kill the run; the browser still receives the
        // broadcast and the manifest records the terminal state.
      });
    return this.writeChain;
  }

  async setStatus(status, extra = {}) {
    if (!canTransition(this.manifest.status, status)) {
      await this.append({
        kind: "diagnostic",
        code: "invalid_transition",
        message: `Ignored transition ${this.manifest.status} -> ${status}`,
      });
      return this.manifest;
    }
    this.manifest = {
      ...this.manifest,
      ...extra,
      status,
      updatedAt: new Date().toISOString(),
      lastEventSequence: this.sequence,
      ...(isTerminalStatus(status) ? { completedAt: new Date().toISOString() } : {}),
    };
    await this.store.writeManifest(this.manifest);
    await this.append({ kind: "lifecycle", status, ...(extra.detail ? { message: extra.detail } : {}) });
    return this.manifest;
  }

  async patchManifest(patch) {
    this.manifest = {
      ...this.manifest,
      ...patch,
      updatedAt: new Date().toISOString(),
      lastEventSequence: this.sequence,
    };
    await this.store.writeManifest(this.manifest);
    return this.manifest;
  }

  async finalize(final) {
    await this.writeChain;
    const completedAt = new Date().toISOString();
    await this.store.writeFinal(this.manifest.runId, {
      runId: this.manifest.runId,
      provider: this.manifest.provider,
      route: this.manifest.route,
      completedAt,
      ...final,
    });
    // The terminal status must be visible before the final event is broadcast:
    // a subscriber that reacts to the event immediately reads this manifest.
    this.manifest = {
      ...this.manifest,
      status: final.status,
      completedAt,
      updatedAt: completedAt,
      lastEventSequence: this.sequence,
    };
    await this.store.writeManifest(this.manifest);
    const event = await this.append({
      kind: "lifecycle",
      status: final.status,
      final: true,
      message: final.error ? "Run ended with an error." : "Run completed.",
    });
    this.manifest = {
      ...this.manifest,
      lastEventSequence: this.sequence,
      finalEventId: event?.eventId ?? this.manifest.finalEventId,
    };
    await this.store.writeManifest(this.manifest);
    return this.manifest;
  }
}

export function createAgentRunStore(options) {
  return new AgentRunStore(options);
}

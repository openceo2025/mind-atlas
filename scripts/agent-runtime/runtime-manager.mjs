// Agent Runtime Manager: the single local-only entry point that owns provider
// adapters, the durable journal, run control, session ownership, and the
// normalized event stream consumed over SSE.
//
// Mode: local-only. Never import this from `server/mind-atlas-service.mjs`.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ClaudeAdapter } from "./claude-adapter.mjs";
import { CodexAdapter } from "./codex-adapter.mjs";
import { planEvidenceTransport, renderEvidenceReferenceBlock } from "./evidence-store.mjs";
import {
  createMissionWorktree,
  createRunCheckpoint,
  inspectGitWorkspace,
  removeMissionWorktree,
  revertRunCheckpoint,
  sourceRootFromCommonGitDir,
} from "./git-workspace.mjs";
import { createAgentRunStore } from "./run-journal.mjs";
import { boundText, isTerminalStatus } from "./types.mjs";

const DELTA_FLUSH_MS = 80;
const DELTA_FLUSH_CHARS = 400;

export class AgentRuntimeManager {
  /**
   * @param {{
   *   store?: import("./run-journal.mjs").AgentRunStore,
   *   codex?: { enabled: boolean, resolveCommand: () => { command: string, args: string[] }, workspace: string, env?: NodeJS.ProcessEnv },
   *   claude?: { enabled: boolean, buildCommand: (args: string[]) => { command: string, args: string[] }, buildEnv: (settings: object) => NodeJS.ProcessEnv, reauthenticate?: (options: { workspace: string }) => Promise<{ ok: boolean, detail?: string }>, workspace: string },
   *   codexRoutePreference?: "auto"|"app-server"|"exec",
   *   claudeRoutePreference?: "auto"|"stream-json"|"json",
   *   clientInfo?: { name: string, title: string, version: string },
   *   legacyRunner?: (payload: object, hooks: object) => Promise<object>,
   * }} options
   */
  constructor(options = {}) {
    this.options = options;
    this.store = options.store ?? createAgentRunStore(options.storeOptions);
    this.clientInfo = options.clientInfo ?? { name: "mind_atlas", title: "Mind Atlas", version: "0.1.1" };
    this.codexRoutePreference = options.codexRoutePreference ?? "auto";
    this.claudeRoutePreference = options.claudeRoutePreference ?? "auto";
    this.legacyRunner = options.legacyRunner ?? null;
    this.atlasMcp = options.atlasMcp ?? { enabled: false };
    this.capabilityCache = new Map();
    this.retentionTimer = null;
    /** @type {Map<string, RunEventSink>} Active event sinks by run id. */
    this.sinks = new Map();

    this.codexAdapter = options.codex?.enabled
      ? new CodexAdapter({
        resolveCommand: options.codex.resolveCommand,
        workspace: options.codex.workspace,
        env: options.codex.env,
        clientInfo: this.clientInfo,
        onDiagnostic: (runId, text) => {
          if (runId) void this.store.appendDiagnostics(runId, text);
        },
      })
      : null;
       this.claudeAdapter = options.claude?.enabled
      ? new ClaudeAdapter({
        buildCommand: options.claude.buildCommand,
        buildEnv: options.claude.buildEnv,
        reauthenticate: options.claude.reauthenticate,
        workspace: options.claude.workspace,
      })
      : null;
  }

  async init() {
    await this.store.init();
    const recovered = await this.store.recoverAbandonedRuns();
    if (recovered.length) {
      console.log(`[agent-runtime] marked ${recovered.length} abandoned run(s) as interrupted`);
    }
    void this.store.applyRetention().catch(() => {});
    this.retentionTimer = setInterval(() => {
      void this.store.applyRetention().catch(() => {});
    }, 24 * 60 * 60 * 1000);
    this.retentionTimer.unref?.();
    return { recovered: recovered.length };
  }

  async inspectWorkspace(workspace) {
    const info = await inspectGitWorkspace(workspace);
    const managedRoot = resolve(this.store.baseDir, "worktrees");
    const relativeToManaged = info.resolvedWorkspace ? relative(managedRoot, info.resolvedWorkspace) : "..";
    return {
      ...info,
      managedMissionWorktree: Boolean(
        relativeToManaged
        && !relativeToManaged.startsWith("..")
        && !isAbsolute(relativeToManaged),
      ),
    };
  }

  adapterFor(provider) {
    if (provider === "codex") return this.codexAdapter;
    if (provider === "claude") return this.claudeAdapter;
    return null;
  }

  /** Capability inventory used by the picker. Runtime reported, never hardcoded. */
  async getCapabilities({ refresh = false, claudeSettings = {}, workspace = "" } = {}) {
    const key = `${workspace}|${claudeSettings.authMode ?? ""}`;
    const cached = this.capabilityCache.get(key);
    if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.value;
    const [codex, claude] = await Promise.all([
      this.codexAdapter
        ? this.codexAdapter.discoverCapabilities(workspace).catch((error) => ({
          provider: "codex",
          route: "codex-exec",
          available: false,
          models: [],
          permissionModes: [],
          sandboxModes: [],
          supports: {},
          unavailableReasons: { streaming: String(error?.message ?? error).slice(0, 300) },
        }))
        : null,
      this.claudeAdapter
        ? this.claudeAdapter.discoverCapabilities({ ...claudeSettings, workspace }).catch((error) => ({
          provider: "claude",
          route: "claude-json",
          available: false,
          models: [],
          permissionModes: [],
          sandboxModes: [],
          supports: {},
          unavailableReasons: { streaming: String(error?.message ?? error).slice(0, 300) },
        }))
        : null,
    ]);
    const effectiveCodex = this.codexRoutePreference === "exec"
      ? fallbackCapabilities(codex, "codex")
      : codex;
    const effectiveClaude = this.claudeRoutePreference === "json"
      ? fallbackCapabilities(claude, "claude")
      : claude;
    const value = {
      generatedAt: new Date().toISOString(),
      routePreference: { codex: this.codexRoutePreference, claude: this.claudeRoutePreference },
      providers: [effectiveCodex, effectiveClaude].filter(Boolean),
    };
    this.capabilityCache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * Start a run. The manifest is written before any provider process starts, so
   * a crash between here and the first event is still recoverable.
   */
  async startRun(request) {
    const provider = request.provider === "claude" ? "claude" : "codex";
    const adapter = this.adapterFor(provider);
    const preference = provider === "codex" ? this.codexRoutePreference : this.claudeRoutePreference;
    const richRoute = provider === "codex" ? "codex-app-server" : "claude-stream-json";
    const fallbackRoute = provider === "codex" ? "codex-exec" : "claude-json";

    let route = richRoute;
    let fallbackReason = "";
    if (preference === "exec" || preference === "json") {
      route = fallbackRoute;
      fallbackReason = "runtime route pinned by configuration";
    } else if (!adapter) {
      route = fallbackRoute;
      fallbackReason = `${provider} rich runtime is disabled`;
    } else {
      const probe = await adapter.probe(request.claudeSettings ?? {});
      if (!probe.ok) {
        route = fallbackRoute;
        fallbackReason = probe.reason ?? "rich runtime probe failed";
      }
    }

    const runId = randomUUID();
    let sourceWorkspace = String(request.workspace ?? "");
    const workspaceMode = request.workspaceMode === "worktree" ? "worktree" : "shared";
    const sourceGit = await inspectGitWorkspace(sourceWorkspace);
    let runWorkspace = sourceGit.resolvedWorkspace || sourceWorkspace;
    let worktree = null;
    if (workspaceMode === "worktree") {
      if (!sourceGit.available) {
        throw new Error("Mission worktree mode requires a Git repository. Use Current folder for a folder without Git.");
      }
      const managedRoot = resolve(this.store.baseDir, "worktrees");
      const relativeToManaged = sourceGit.resolvedWorkspace ? relative(managedRoot, sourceGit.resolvedWorkspace) : "..";
      const reusingManagedWorktree = Boolean(
        relativeToManaged
        && !relativeToManaged.startsWith("..")
        && !isAbsolute(relativeToManaged),
      );
      if (reusingManagedWorktree) {
        runWorkspace = sourceGit.resolvedWorkspace;
        sourceWorkspace = sourceRootFromCommonGitDir(sourceGit.commonGitDir, sourceGit.gitRoot);
        worktree = {
          sourceWorkspace,
          sourceGitRoot: sourceWorkspace,
          sourceCommonGitDir: sourceGit.commonGitDir,
          path: sourceGit.resolvedWorkspace,
          branch: sourceGit.branch,
          baseHead: sourceGit.head,
          createdAt: new Date().toISOString(),
          reused: true,
          repositoryName: sourceGit.repositoryName,
        };
      } else {
        if (sourceGit.dirtyCount > 0) {
          throw new Error("Mission worktree creation requires a clean source checkout because uncommitted changes are not copied into a Git worktree.");
        }
        worktree = await createMissionWorktree({
          sourceWorkspace,
          baseDir: this.store.baseDir,
          runId,
          title: request.title ?? "",
        });
        runWorkspace = worktree.path;
      }
    }
    const initialGit = await inspectGitWorkspace(runWorkspace);
    const effectiveRequest = {
      ...request,
      workspace: runWorkspace,
      sourceWorkspace,
      workspaceMode,
    };

    let handle;
    try {
      handle = await this.store.createRun({
        runId,
        clientRunId: request.clientRunId ?? "",
        provider,
        route,
        requestedRoute: preference === "auto" ? richRoute : route,
        requestNodeId: request.requestNodeId ?? "",
        sourceNodeId: request.sourceNodeId ?? "",
        workspace: runWorkspace,
        sourceWorkspace,
        workspaceMode,
        worktree,
        model: request.model ?? "",
        effort: request.effort ?? "",
        permissionMode: request.permissionMode ?? request.claudeSettings?.permissionMode ?? "",
        sandboxMode: request.sandboxMode ?? "",
        authMode: request.claudeSettings?.authMode ?? "",
        title: request.title ?? "",
        session: request.session ?? null,
        git: initialGit.available ? initialGit : request.git ?? null,
      });
    } catch (error) {
      if (worktree && !worktree.reused) {
        await removeMissionWorktree({
          sourceGitRoot: worktree.sourceGitRoot,
          worktreePath: worktree.path,
        }).catch(() => null);
      }
      throw error;
    }

    if (fallbackReason) {
      await handle.append({ kind: "warning", code: "route_fallback", message: `Using ${route}: ${fallbackReason}` });
    }

    const sink = new RunEventSink(this, handle);
    this.sinks.set(handle.runId, sink);
    await handle.setStatus("starting");

    const mcpConfigPath = await this.#prepareAtlasTools(handle, effectiveRequest);
    if (mcpConfigPath) {
      await handle.append({
        kind: "diagnostic",
        code: "atlas_tools_attached",
        message: "Read-only Mind Atlas retrieval tools are attached to this run.",
      });
    }

    // Evidence transport is decided from the runtime's own capabilities and
    // reported per item, so the UI can never imply a file was seen when only
    // its path was sent.
    let providerRequest = { ...effectiveRequest, mcpConfigPath };
    if (request.evidence?.length) {
      const capabilities = adapter
        ? await (provider === "claude"
          ? adapter.discoverCapabilities({ ...(request.claudeSettings ?? {}), workspace: runWorkspace })
          : adapter.discoverCapabilities(runWorkspace)).catch(() => null)
        : null;
      const planned = planEvidenceTransport(provider, capabilities, request.evidence);
      await handle.append({
        kind: "diagnostic",
        code: "evidence_transport",
        message: planned.map((item) => `${item.displayName}: ${item.status} (${item.note})`).join("\n"),
        evidence: planned.map(({ id, kind, displayName, mimeType, size, providerTransport, status }) => ({
          id, kind, displayName, mimeType, size, providerTransport, status,
        })),
      });
      const referenceBlock = renderEvidenceReferenceBlock(planned);
      providerRequest = {
        ...providerRequest,
        evidence: planned.filter((item) => item.providerTransport === "localImage"),
        plannedEvidence: planned,
        prompt: referenceBlock ? `${request.prompt}\n${referenceBlock}` : request.prompt,
      };
    }

    if (route === richRoute && adapter) {
      try {
        const mode = normalizeSessionMode(request.sessionMode, request.session);
        await adapter.startRun(mode, providerRequest, sink);
        await handle.setStatus("running");
      } catch (error) {
        const message = String(error?.message ?? error).slice(0, 800);
        await handle.append({ kind: "error", code: "start_failed", message });
        await sink.terminal({ status: "failed", text: "", error: message });
      }
      return this.describeRun(handle.runId);
    }

    // Fallback route: reuse the proven legacy runner and synthesize normalized
    // lifecycle events so recovery and the workspace still work.
    if (!this.legacyRunner) {
      const message = `No fallback runner is configured for ${provider}.`;
      await handle.append({ kind: "error", code: "no_fallback", message });
      await sink.terminal({ status: "failed", text: "", error: message });
      return this.describeRun(handle.runId);
    }
    // Status first: the fallback runner can settle before the next await, and a
    // terminal run must never be pushed back to `running`.
    await handle.setStatus("running");
    void this.#runLegacy(providerRequest, handle, sink);
    return this.describeRun(handle.runId);
  }

  /**
   * Write the run-scoped Atlas snapshot and an additive MCP config. Only the
   * sanitized notebook reaches the child process; no bridge internals and no
   * credentials are shared. Codex is not auto-configured here because that
   * would require mutating provider configuration; see docs/ai-bridge.md.
   */
  async #prepareAtlasTools(handle, request) {
    if (!this.atlasMcp?.enabled) return "";
    if (handle.manifest.provider !== "claude") return "";
    const snapshot = request.atlasSnapshot;
    if (!snapshot || typeof snapshot !== "object") return "";
    try {
      const dir = this.store.runDir(handle.runId);
      const snapshotPath = join(dir, "atlas-snapshot.json");
      await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
      const configPath = join(dir, "mcp-config.json");
      await writeFile(configPath, JSON.stringify({
        mcpServers: {
          mind_atlas: {
            command: this.atlasMcp.nodeExecPath ?? process.execPath,
            args: [this.atlasMcp.serverScript, snapshotPath],
          },
        },
      }, null, 2), "utf8");
      return configPath;
    } catch (error) {
      await handle.append({
        kind: "warning",
        code: "atlas_tools_failed",
        message: `Mind Atlas retrieval tools could not be attached: ${String(error?.message ?? error).slice(0, 300)}`,
      });
      return "";
    }
  }

  async #runLegacy(request, handle, sink) {
    try {
      const result = await this.legacyRunner(request);
      const text = String(result?.output?.body ?? result?.text ?? "");
      if (text) await sink.event({ kind: "message_completed", text: boundText(text, 400_000) });
      if (result?.usage) {
        await sink.event({ kind: "usage_updated", usage: { scope: "provider_session", ...result.usage } });
      }
      if (result?.codexThreadId || result?.claudeSessionId) {
        await sink.session({
          provider: handle.manifest.provider,
          threadId: result.codexThreadId ?? "",
          sessionId: result.claudeSessionId ?? result.codexThreadId ?? "",
          action: result?.sessionInfo?.action ?? "new",
          fellBack: Boolean(result?.sessionInfo?.fellBack),
        });
      }
      // The legacy result is kept verbatim so its richer artifacts survive, but
      // its raw provider transcript is bounded before it reaches the journal.
      await sink.terminal({
        status: "completed",
        text,
        legacyResult: result ? { ...result, rawText: boundText(String(result.rawText ?? ""), 200_000) } : null,
      });
    } catch (error) {
      await sink.terminal({ status: "failed", text: "", error: String(error?.message ?? error).slice(0, 4000) });
    }
  }

  async describeRun(runId) {
    const handle = this.store.getHandle(runId);
    const manifest = handle?.manifest ?? (await this.store.readManifest(runId));
    if (!manifest) return null;
    // Always attempt the final record: a run recovered from disk or finalized a
    // moment ago must not appear answerless because of a status race.
    const final = await this.store.readFinal(runId);
    return { manifest, final };
  }

  async listRuns(options) {
    return await this.store.listRuns(options);
  }

  async latestUsageEvents(options) {
    return await this.store.latestUsageEvents(options);
  }

  subscribe(runId, listener) {
    return this.store.subscribe(runId, listener);
  }

  async replay(runId, sinceSequence) {
    return await this.store.readEvents(runId, sinceSequence);
  }

  #requireActive(runId) {
    const handle = this.store.getHandle(runId);
    if (!handle) return { ok: false, reason: "unknown_run", detail: "That run is not active in this bridge process." };
    if (handle.manifest.ownership?.state === "native") {
      return { ok: false, reason: "native_owned", detail: "The native application currently owns this session. Reclaim it first." };
    }
    return { ok: true, handle };
  }

  async interrupt(runId) {
    const guard = this.#requireActive(runId);
    if (!guard.ok) return guard;
    const adapter = this.adapterFor(guard.handle.manifest.provider);
    if (!adapter) return { ok: false, reason: "unsupported", detail: "No adapter owns this run." };
    await guard.handle.append({ kind: "lifecycle", status: "stopping", message: "Stop requested." });
    return await adapter.interrupt(runId);
  }

  async steer(runId, input) {
    const guard = this.#requireActive(runId);
    if (!guard.ok) return guard;
    const adapter = this.adapterFor(guard.handle.manifest.provider);
    if (!adapter) return { ok: false, reason: "unsupported", detail: "No adapter owns this run." };
    const result = await adapter.steer(runId, input);
    if (result.ok) {
      await guard.handle.append({ kind: "diagnostic", code: "steered", message: boundText(input.map((entry) => entry.text ?? "").join("\n"), 4000) });
    }
    return result;
  }

  async resolveApproval(runId, requestId, decision) {
    const guard = this.#requireActive(runId);
    if (!guard.ok) return guard;
    const adapter = this.adapterFor(guard.handle.manifest.provider);
    if (!adapter) return { ok: false, reason: "unsupported", detail: "No adapter owns this run." };
    const result = await adapter.resolveApproval(runId, requestId, decision);
    if (result.ok && guard.handle.manifest.status === "waiting_for_approval") {
      await guard.handle.setStatus("running");
    }
    return result;
  }

  async resolveUserInput(runId, requestId, answers) {
    const guard = this.#requireActive(runId);
    if (!guard.ok) return guard;
    const adapter = this.adapterFor(guard.handle.manifest.provider);
    if (!adapter) return { ok: false, reason: "unsupported", detail: "No adapter owns this run." };
    const result = await adapter.resolveUserInput(runId, requestId, answers);
    if (result.ok && guard.handle.manifest.status === "waiting_for_user_input") {
      await guard.handle.setStatus("running");
    }
    return result;
  }

  async compact(runId) {
    const guard = this.#requireActive(runId);
    if (!guard.ok) return guard;
    const adapter = this.adapterFor(guard.handle.manifest.provider);
    if (!adapter?.compact) return { ok: false, reason: "unsupported", detail: "This runtime does not expose compaction." };
    return await adapter.compact(runId);
  }

  async checkpoint(runId, message = "") {
    const manifest = await this.store.readManifest(runId);
    if (!manifest) return { ok: false, reason: "unknown_run", detail: "That run is not known to this bridge." };
    if (!isTerminalStatus(manifest.status)) return { ok: false, reason: "run_active", detail: "Finish or stop the run before creating a checkpoint." };
    if (manifest.ownership?.state !== "mind_atlas") return { ok: false, reason: "native_owned", detail: "Reclaim the session before creating a checkpoint." };
    if (manifest.workspaceMode !== "worktree" || !manifest.worktree?.path) {
      return {
        ok: false,
        reason: "isolation_required",
        detail: "Safe run checkpoints are available for mission worktrees, where changes are attributable to one run.",
      };
    }
    const final = await this.store.readFinal(runId);
    const result = await createRunCheckpoint({
      workspace: manifest.workspace,
      changedFiles: final?.changedFiles ?? [],
      message: message || `Mind Atlas checkpoint: ${manifest.title || runId}`,
    });
    if (!result.ok) return result;
    const next = { ...manifest, checkpoint: result, updatedAt: new Date().toISOString() };
    await this.store.writeManifest(next);
    const handle = this.store.getHandle(runId);
    if (handle) handle.manifest = next;
    return result;
  }

  async revertCheckpoint(runId, confirmation) {
    const manifest = await this.store.readManifest(runId);
    if (!manifest) return { ok: false, reason: "unknown_run", detail: "That run is not known to this bridge." };
    if (confirmation !== runId) return { ok: false, reason: "confirmation_required", detail: "The run id confirmation did not match." };
    if (!manifest.checkpoint?.commit) return { ok: false, reason: "no_checkpoint", detail: "This run has no checkpoint commit to revert." };
    const result = await revertRunCheckpoint({ workspace: manifest.workspace, commit: manifest.checkpoint.commit });
    if (!result.ok) return result;
    const next = { ...manifest, checkpointRevert: result, updatedAt: new Date().toISOString() };
    await this.store.writeManifest(next);
    const handle = this.store.getHandle(runId);
    if (handle) handle.manifest = next;
    return result;
  }

  async removeWorktree(runId, confirmation) {
    const manifest = await this.store.readManifest(runId);
    if (!manifest) return { ok: false, reason: "unknown_run", detail: "That run is not known to this bridge." };
    if (confirmation !== runId) return { ok: false, reason: "confirmation_required", detail: "The run id confirmation did not match." };
    if (!manifest.worktree?.path || !manifest.worktree?.sourceGitRoot) {
      return { ok: false, reason: "not_worktree", detail: "This run does not own a mission worktree." };
    }
    const result = await removeMissionWorktree({
      sourceGitRoot: manifest.worktree.sourceGitRoot,
      worktreePath: manifest.worktree.path,
    });
    if (!result.ok) return result;
    const next = {
      ...manifest,
      worktree: { ...manifest.worktree, removedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeManifest(next);
    const handle = this.store.getHandle(runId);
    if (handle) handle.manifest = next;
    return result;
  }

  async cleanup() {
    return await this.store.applyRetention();
  }

  /** Acknowledge a run only after the app stored its result. */
  async acknowledge(runIds = [], clientRunIds = []) {
    const wanted = new Set(runIds.filter(Boolean));
    const wantedClients = new Set(clientRunIds.filter(Boolean));
    let acknowledged = 0;
    for (const manifest of await this.store.listRuns({ limit: 500 })) {
      if (manifest.acknowledgedAt) continue;
      if (!wanted.has(manifest.runId) && !wantedClients.has(manifest.clientRunId)) continue;
      await this.store.writeManifest({ ...manifest, acknowledgedAt: new Date().toISOString() });
      acknowledged += 1;
    }
    return { acknowledged };
  }

  /** Unacknowledged terminal runs that the app still has to represent. */
  async inbox({ graceMs = 5000, limit = 100 } = {}) {
    const now = Date.now();
    const manifests = await this.store.listRuns({ limit: 500, includeAcknowledged: false });
    const items = [];
    for (const manifest of manifests) {
      if (!isTerminalStatus(manifest.status)) continue;
      const completedAt = Date.parse(manifest.completedAt || manifest.updatedAt || manifest.createdAt || "");
      if (Number.isFinite(completedAt) && now - completedAt < graceMs) continue;
      const final = await this.store.readFinal(manifest.runId);
      items.push({ manifest, final });
      if (items.length >= limit) break;
    }
    items.sort((left, right) => Date.parse(left.manifest.completedAt ?? 0) - Date.parse(right.manifest.completedAt ?? 0));
    return { items };
  }

  close() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    this.codexAdapter?.close();
    this.claudeAdapter?.close();
  }
}

function normalizeSessionMode(mode, session) {
  if (mode === "new" || !session) return "new";
  if (mode === "fork") return "fork";
  // Default to resuming the branch session. Forking is reserved for a genuine
  // branch divergence, which the caller detects and requests explicitly; a
  // fork on every run mints a new session and discards the prompt cache.
  return "resume";
}

/**
 * Adapter-facing event sink. Coalesces text deltas, keeps the manifest in sync,
 * and guarantees a single terminal transition per run.
 */
class RunEventSink {
  constructor(manager, handle) {
    this.manager = manager;
    this.handle = handle;
    this.runId = handle.runId;
    this.pendingDelta = "";
    this.deltaKind = "";
    this.deltaMeta = {};
    this.deltaTimer = null;
    this.finished = false;
  }

  diagnostic(text) {
    void this.manager.store.appendDiagnostics(this.runId, text);
  }

  async event(partial) {
    if (partial.kind === "message_delta" || partial.kind === "reasoning_summary") {
      if (typeof partial.delta === "string" && partial.delta) {
        return await this.#bufferDelta(partial);
      }
    }
    await this.#flushDelta();
    if (partial.kind === "approval_requested") {
      await this.handle.setStatus("waiting_for_approval");
    } else if (partial.kind === "user_input_requested") {
      await this.handle.setStatus("waiting_for_user_input");
    }
    return await this.handle.append(partial);
  }

  async #bufferDelta(partial) {
    if (this.deltaKind && this.deltaKind !== partial.kind) await this.#flushDelta();
    this.deltaKind = partial.kind;
    this.deltaMeta = { itemId: partial.itemId, turnId: partial.turnId };
    this.pendingDelta += partial.delta;
    if (this.pendingDelta.length >= DELTA_FLUSH_CHARS) {
      await this.#flushDelta();
      return null;
    }
    if (!this.deltaTimer) {
      this.deltaTimer = setTimeout(() => {
        this.deltaTimer = null;
        void this.#flushDelta();
      }, DELTA_FLUSH_MS);
      this.deltaTimer.unref?.();
    }
    return null;
  }

  async #flushDelta() {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    if (!this.pendingDelta) return;
    const kind = this.deltaKind || "message_delta";
    const delta = this.pendingDelta;
    const meta = this.deltaMeta ?? {};
    this.pendingDelta = "";
    this.deltaKind = "";
    await this.handle.append({ kind, delta, ...meta });
  }

  async session(info) {
    await this.#flushDelta();
    await this.handle.patchManifest({
      session: {
        provider: info.provider,
        threadId: info.threadId ?? "",
        sessionId: info.sessionId ?? "",
        threadPath: info.threadPath ?? "",
        action: info.action ?? "new",
        fellBack: Boolean(info.fellBack),
        authMode: info.authMode ?? this.handle.manifest.authMode ?? "",
      },
      ...(info.model ? { model: info.model } : {}),
      ...(info.effort ? { effort: info.effort } : {}),
      ...(info.runtimeVersion ? { runtimeVersion: info.runtimeVersion } : {}),
    });
    await this.handle.append({ kind: "lifecycle", status: "session", session: info });
    if (info.sessionId) {
      await this.manager.store.saveSession(`${info.provider}-${info.sessionId}`, {
        provider: info.provider,
        sessionId: info.sessionId,
        threadId: info.threadId ?? "",
        threadPath: info.threadPath ?? "",
        workspace: this.handle.manifest.workspace,
        runId: this.runId,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async terminal(final) {
    if (this.finished) return;
    this.finished = true;
    await this.#flushDelta();
    if (final.sessionId && final.sessionId !== this.handle.manifest.session?.sessionId) {
      await this.handle.patchManifest({
        session: { ...(this.handle.manifest.session ?? {}), sessionId: final.sessionId },
      });
    }
    const gitAfter = await inspectGitWorkspace(this.handle.manifest.workspace).catch(() => null);
    await this.handle.patchManifest({
      gitAfter: gitAfter?.available ? gitAfter : null,
    });
    await this.handle.finalize({
      status: final.status,
      text: final.text ?? "",
      error: final.error ?? "",
      diff: final.diff ? boundText(final.diff, 400_000) : "",
      changedFiles: final.changedFiles ?? [],
      durationMs: final.durationMs ?? null,
      session: this.handle.manifest.session ?? null,
      legacyResult: final.legacyResult ?? null,
      gitAfter: gitAfter?.available ? gitAfter : null,
    });
    this.manager.adapterFor(this.handle.manifest.provider)?.release?.(this.runId);
    this.manager.sinks.delete(this.runId);
    // The handle stays registered so late control calls report a clear reason
    // instead of "unknown run"; retention removes it later.
  }
}

export function createAgentRuntimeManager(options) {
  return new AgentRuntimeManager(options);
}

function fallbackCapabilities(capability, provider) {
  if (!capability) return null;
  const browser = provider === "claude" && capability.supports?.browser === true;
  const route = provider === "codex" ? "codex-exec" : "claude-json";
  return {
    ...capability,
    route,
    supports: {
      ...capability.supports,
      streaming: false,
      steer: false,
      interrupt: false,
      approvals: false,
      userQuestions: false,
      resume: true,
      fork: provider === "claude",
      compact: false,
      images: false,
      mcp: false,
      skills: false,
      subagents: false,
      browser,
      nativeCliHandoff: true,
    },
    unavailableReasons: {
      ...capability.unavailableReasons,
      streaming: "The configured fallback returns one bounded result after the process exits.",
      steer: "The configured fallback has no verified mid-turn steering channel.",
      interrupt: "The fallback process is owned by the legacy runner and is not attached to the streaming control channel.",
      approvals: "The configured fallback does not expose interactive approvals to Mind Atlas.",
      userQuestions: "The configured fallback does not expose interactive questions to Mind Atlas.",
      compact: "The configured fallback does not expose provider-native compaction.",
      images: "Typed evidence transport is available only on the verified rich runtime.",
      mcp: "Run-scoped Atlas MCP attachment is available only on the verified rich runtime.",
      skills: "The configured fallback does not report a live skill inventory.",
      subagents: "The configured fallback does not stream subagent activity.",
      ...(browser ? {} : { browser: capability.unavailableReasons?.browser || "This fallback route has no verified browser integration." }),
    },
  };
}

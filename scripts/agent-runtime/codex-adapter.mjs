// Codex adapter: normalizes `codex app-server` protocol traffic into the shared
// Mind Atlas run event model.
//
// Mode: local-only.
//
// Unsupported operations return a typed `{ ok: false, reason: "unsupported" }`
// result. They never silently do nothing.

import { randomUUID } from "node:crypto";

import { CodexAppServerConnection } from "./codex-app-server.mjs";
import { boundText, reduceCapabilities } from "./types.mjs";

const MAX_COMMAND_OUTPUT_CHARS = 20_000;

export class CodexAdapter {
  /**
   * @param {{ resolveCommand: () => { command: string, args: string[] },
   *           workspace: string, env?: NodeJS.ProcessEnv,
   *           clientInfo: { name: string, title: string, version: string },
   *           onDiagnostic?: (runId: string, text: string) => void }} options
   */
  constructor(options) {
    this.id = "codex";
    this.options = options;
    /** @type {CodexAppServerConnection | null} */
    this.connection = null;
    this.capabilitiesCache = null;
    /** @type {Map<string, CodexRunSession>} */
    this.sessions = new Map();
  }

  #connect() {
    if (this.connection && !this.connection.closed) return this.connection;
    const spec = this.options.resolveCommand();
    this.connection = new CodexAppServerConnection({
      command: spec.command,
      args: spec.args,
      cwd: this.options.workspace,
      env: this.options.env ?? process.env,
      clientInfo: this.options.clientInfo,
      onDiagnostic: (text) => this.options.onDiagnostic?.("", text),
    });
    return this.connection;
  }

  async probe() {
    try {
      const connection = this.#connect();
      const initialize = await connection.ready();
      return {
        ok: true,
        route: "codex-app-server",
        runtimeVersion: String(initialize?.userAgent ?? "").split(" ")[0] ?? "",
        detail: { codexHome: initialize?.codexHome, platformOs: initialize?.platformOs },
      };
    } catch (error) {
      return { ok: false, route: "codex-exec", reason: String(error?.message ?? error).slice(0, 400) };
    }
  }

  /** Runtime-reported capabilities. Nothing here is hardcoded from docs. */
  async discoverCapabilities(workspace) {
    if (this.capabilitiesCache && Date.now() - this.capabilitiesCache.at < 60_000) {
      return this.capabilitiesCache.value;
    }
    const probe = await this.probe();
    if (!probe.ok) {
      const value = reduceCapabilities({
        provider: "codex",
        route: "codex-exec",
        available: false,
        models: [],
        permissionModes: [],
        sandboxModes: [],
        supports: {},
        unavailableReasons: { streaming: probe.reason },
      });
      this.capabilitiesCache = { at: Date.now(), value };
      return value;
    }
    const connection = this.#connect();
    const [models, profiles, skills] = await Promise.all([
      connection.request("model/list", { limit: 100 }).catch(() => null),
      connection.request("permissionProfile/list", {}).catch(() => null),
      connection.request("skills/list", {}).catch(() => null),
    ]);
    const modelList = (models?.data ?? []).filter((entry) => entry && !entry.hidden).map((entry) => ({
      id: String(entry.id ?? entry.model ?? ""),
      model: String(entry.model ?? entry.id ?? ""),
      displayName: String(entry.displayName ?? entry.id ?? ""),
      description: String(entry.description ?? ""),
      isDefault: Boolean(entry.isDefault),
      defaultEffort: String(entry.defaultReasoningEffort ?? ""),
      supportedEfforts: (entry.supportedReasoningEfforts ?? [])
        .map((option) => String(option?.reasoningEffort ?? option ?? ""))
        .filter(Boolean),
      inputModalities: (entry.inputModalities ?? []).map((value) => String(value)),
      upgrade: entry.upgrade ? String(entry.upgrade) : "",
    })).filter((entry) => entry.id);
    const supportsImages = modelList.some((entry) => entry.inputModalities.includes("image"));
    const value = reduceCapabilities({
      provider: "codex",
      route: "codex-app-server",
      available: true,
      runtimeVersion: probe.runtimeVersion,
      workspace: workspace ?? this.options.workspace,
      models: modelList,
      permissionModes: (profiles?.data ?? []).map((entry) => ({
        id: String(entry.id ?? ""),
        label: String(entry.id ?? "").replace(/^:/, ""),
        allowed: entry.allowed !== false,
      })).filter((entry) => entry.id),
      sandboxModes: [
        { id: "read-only", label: "read-only" },
        { id: "workspace-write", label: "workspace-write" },
        { id: "danger-full-access", label: "danger-full-access" },
      ],
      skills: (skills?.data ?? []).map((entry) => ({
        name: String(entry?.name ?? entry?.id ?? ""),
        description: boundText(String(entry?.description ?? ""), 300),
      })).filter((entry) => entry.name),
      supports: {
        streaming: true,
        steer: true,
        interrupt: true,
        approvals: true,
        userQuestions: true,
        resume: true,
        fork: true,
        compact: true,
        images: supportsImages,
        mcp: true,
        skills: (skills?.data ?? []).length > 0,
        nativeCliHandoff: true,
      },
      unavailableReasons: {
        pdf: "Codex app-server input types on this runtime are text, image url, local image, skill, and mention only.",
        browser: "No browser tool was reported by this app-server session.",
        subagents: "Sub-agent activity is reported only when Codex spawns collaborators.",
        nativeDesktopHandoff: "No application on this machine handles codex:// URLs.",
      },
    });
    this.capabilitiesCache = { at: Date.now(), value };
    return value;
  }

  /**
   * Start, resume, or fork a Codex thread and run one turn on it.
   * @param {"new"|"resume"|"fork"} mode
   */
  async startRun(mode, request, sink) {
    const connection = this.#connect();
    await connection.ready();
    const threadParams = {
      cwd: request.workspace,
      sandbox: request.sandboxMode || "workspace-write",
      approvalPolicy: request.approvalPolicy || "on-request",
      ...(request.model ? { model: request.model } : {}),
    };

    let thread = null;
    let sessionAction = mode;
    let fellBack = false;
    if (mode === "resume" && request.session?.threadId) {
      try {
        thread = await connection.request("thread/resume", { threadId: request.session.threadId, ...threadParams });
      } catch (error) {
        fellBack = true;
        sink.diagnostic(`thread/resume failed: ${String(error?.message ?? error).slice(0, 300)}`);
      }
    } else if (mode === "fork" && request.session?.threadId) {
      try {
        thread = await connection.request("thread/fork", { threadId: request.session.threadId, ...threadParams });
      } catch (error) {
        fellBack = true;
        sink.diagnostic(`thread/fork failed: ${String(error?.message ?? error).slice(0, 300)}`);
      }
    }
    if (!thread) {
      if (mode !== "new") sessionAction = "new";
      thread = await connection.request("thread/start", threadParams);
    }

    const threadId = String(thread?.thread?.id ?? "");
    if (!threadId) throw new Error("Codex app-server did not return a thread id");

    const session = new CodexRunSession({
      adapter: this,
      connection,
      sink,
      threadId,
      sessionId: String(thread?.thread?.sessionId ?? threadId),
      threadPath: String(thread?.thread?.path ?? ""),
      model: String(thread?.model ?? request.model ?? ""),
      effort: String(thread?.reasoningEffort ?? request.effort ?? ""),
    });
    this.sessions.set(sink.runId, session);
    session.attach();

    await sink.session({
      provider: "codex",
      threadId,
      sessionId: session.sessionId,
      threadPath: session.threadPath,
      action: sessionAction,
      fellBack,
      model: session.model,
      effort: session.effort,
    });

    const input = buildCodexInput(request);
    const turn = await connection.request("turn/start", {
      threadId,
      input,
      ...(request.effort ? { effort: request.effort } : {}),
      ...(request.model ? { model: request.model } : {}),
    });
    session.currentTurnId = String(turn?.turn?.id ?? "");
    return {
      provider: "codex",
      route: "codex-app-server",
      runId: sink.runId,
      threadId,
      turnId: session.currentTurnId,
    };
  }

  async steer(runId, input) {
    const session = this.sessions.get(runId);
    if (!session) return { ok: false, reason: "unsupported", detail: "No active Codex session for this run." };
    if (!session.currentTurnId) return { ok: false, reason: "unsupported", detail: "No active Codex turn to steer." };
    try {
      await session.connection.request("turn/steer", {
        threadId: session.threadId,
        expectedTurnId: session.currentTurnId,
        input: input.map((entry) => toCodexUserInput(entry)),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "failed", detail: String(error?.message ?? error).slice(0, 400) };
    }
  }

  async interrupt(runId) {
    const session = this.sessions.get(runId);
    if (!session) return { ok: false, reason: "unsupported", detail: "No active Codex session for this run." };
    if (!session.currentTurnId) return { ok: false, reason: "unsupported", detail: "No active Codex turn to interrupt." };
    try {
      await session.connection.request("turn/interrupt", { threadId: session.threadId, turnId: session.currentTurnId });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "failed", detail: String(error?.message ?? error).slice(0, 400) };
    }
  }

  async resolveApproval(runId, requestId, decision) {
    const session = this.sessions.get(runId);
    if (!session) return { ok: false, reason: "unsupported", detail: "No active Codex session for this run." };
    return session.resolveApproval(requestId, decision);
  }

  async resolveUserInput(runId, requestId, answers) {
    const session = this.sessions.get(runId);
    if (!session) return { ok: false, reason: "unsupported", detail: "No active Codex session for this run." };
    return session.resolveUserInput(requestId, answers);
  }

  async compact(runId) {
    const session = this.sessions.get(runId);
    if (!session) return { ok: false, reason: "unsupported", detail: "No active Codex session for this run." };
    try {
      await session.connection.request("thread/compact/start", { threadId: session.threadId });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "failed", detail: String(error?.message ?? error).slice(0, 400) };
    }
  }

  /** Read-only reconciliation after a native handoff. */
  async readThread(threadId) {
    try {
      const connection = this.#connect();
      await connection.ready();
      const result = await connection.request("thread/read", { threadId, includeTurns: true });
      return { ok: true, thread: result?.thread ?? null };
    } catch (error) {
      return { ok: false, reason: "failed", detail: String(error?.message ?? error).slice(0, 400) };
    }
  }

  release(runId) {
    const session = this.sessions.get(runId);
    session?.detach();
    this.sessions.delete(runId);
  }

  close() {
    for (const session of this.sessions.values()) session.detach();
    this.sessions.clear();
    this.connection?.close();
    this.connection = null;
  }
}

function toCodexUserInput(entry) {
  if (entry?.type === "localImage" && entry.path) return { type: "localImage", path: entry.path };
  if (entry?.type === "imageUrl" && entry.url) return { type: "image", url: entry.url };
  if (entry?.type === "skill" && entry.name) return { type: "skill", name: entry.name, path: entry.path ?? "" };
  return { type: "text", text: String(entry?.text ?? entry ?? ""), text_elements: [] };
}

function buildCodexInput(request) {
  const input = [];
  for (const evidence of request.evidence ?? []) {
    if (evidence.kind === "image" && evidence.localPath) {
      input.push({ type: "localImage", path: evidence.localPath });
    }
  }
  input.push({ type: "text", text: String(request.prompt ?? ""), text_elements: [] });
  return input;
}

class CodexRunSession {
  constructor({ adapter, connection, sink, threadId, sessionId, threadPath, model, effort }) {
    this.adapter = adapter;
    this.connection = connection;
    this.sink = sink;
    this.threadId = threadId;
    this.sessionId = sessionId;
    this.threadPath = threadPath;
    this.model = model;
    this.effort = effort;
    this.currentTurnId = "";
    this.detachFn = null;
    this.finalText = "";
    this.lastDiff = "";
    /** Paths this turn reported changing, used by the Changes tab and handoff. */
    this.changedFiles = new Set();
    /** @type {Map<string, { serverRequestId: number, kind: string }>} */
    this.openApprovals = new Map();
    /** @type {Map<string, { serverRequestId: number }>} */
    this.openQuestions = new Map();
  }

  attach() {
    this.detachFn = this.connection.registerThread(this.threadId, {
      onNotification: (method, params) => {
        this.#onNotification(method, params).catch((error) => {
          this.sink.diagnostic(`codex notification handler failed: ${String(error?.message ?? error).slice(0, 300)}`);
        });
      },
      onServerRequest: (method, params, id) => this.#onServerRequest(method, params, id),
    });
  }

  detach() {
    this.detachFn?.();
    this.detachFn = null;
  }

  async #onNotification(method, params) {
    switch (method) {
      case "turn/started":
        this.currentTurnId = String(params?.turn?.id ?? params?.turnId ?? this.currentTurnId);
        return;
      case "item/agentMessage/delta":
        await this.sink.event({ kind: "message_delta", itemId: params.itemId, turnId: params.turnId, delta: String(params.delta ?? "") });
        return;
      case "item/reasoning/summaryTextDelta":
        await this.sink.event({ kind: "reasoning_summary", itemId: params.itemId, turnId: params.turnId, delta: String(params.delta ?? "") });
        return;
      case "turn/plan/updated":
        await this.sink.event({
          kind: "plan_updated",
          turnId: params.turnId,
          explanation: params.explanation ?? "",
          steps: (params.plan ?? []).map((entry) => ({ step: String(entry?.step ?? entry?.text ?? ""), status: String(entry?.status ?? "") })),
        });
        return;
      case "turn/diff/updated":
        this.lastDiff = String(params.diff ?? "");
        await this.sink.event({ kind: "diff_updated", turnId: params.turnId, diff: boundText(this.lastDiff, 400_000) });
        return;
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta":
        await this.sink.event({
          kind: "command_output",
          itemId: params.itemId ?? params.execId ?? "",
          turnId: params.turnId,
          chunk: boundText(decodeMaybeBase64(params.chunk ?? params.delta ?? ""), 4000),
        });
        return;
      case "thread/tokenUsage/updated":
        await this.sink.event({
          kind: "usage_updated",
          turnId: params.turnId,
          usage: {
            scope: "provider_session",
            totalTokens: params?.tokenUsage?.total?.totalTokens ?? null,
            inputTokens: params?.tokenUsage?.total?.inputTokens ?? null,
            cachedInputTokens: params?.tokenUsage?.total?.cachedInputTokens ?? null,
            outputTokens: params?.tokenUsage?.total?.outputTokens ?? null,
            reasoningOutputTokens: params?.tokenUsage?.total?.reasoningOutputTokens ?? null,
            lastTurnTokens: params?.tokenUsage?.last?.totalTokens ?? null,
            contextWindow: params?.tokenUsage?.modelContextWindow ?? null,
          },
        });
        return;
      case "item/started":
        await this.#onItem(params, "started");
        return;
      case "item/completed":
        await this.#onItem(params, "completed");
        return;
      case "turn/completed":
        await this.#onTurnCompleted(params);
        return;
      case "thread/compacted":
        await this.sink.event({ kind: "warning", code: "context_compacted", message: "Codex compacted this thread's context." });
        return;
      case "warning":
      case "guardianWarning":
      case "configWarning":
        await this.sink.event({ kind: "warning", code: method, message: boundText(String(params?.message ?? JSON.stringify(params ?? {})), 2000) });
        return;
      case "error":
        await this.sink.event({ kind: "error", code: "codex_error", message: boundText(String(params?.message ?? JSON.stringify(params ?? {})), 4000) });
        return;
      case "model/rerouted":
        await this.sink.event({ kind: "warning", code: "model_rerouted", message: boundText(JSON.stringify(params ?? {}), 1000) });
        return;
      default:
        this.sink.diagnostic(`unmapped codex notification ${method}`);
    }
  }

  async #onItem(params, phase) {
    const item = params?.item;
    if (!item || typeof item !== "object") return;
    const base = { itemId: item.id, turnId: params.turnId };
    switch (item.type) {
      case "agentMessage":
        if (phase === "completed") {
          this.finalText = String(item.text ?? "");
          await this.sink.event({ ...base, kind: "message_completed", text: boundText(this.finalText, 400_000), phase: item.phase ?? null });
        }
        return;
      case "reasoning":
        if (phase === "completed") {
          await this.sink.event({ ...base, kind: "reasoning_summary", summary: (item.summary ?? []).map((line) => boundText(String(line), 4000)) });
        }
        return;
      case "commandExecution":
        if (phase === "started") {
          await this.sink.event({ ...base, kind: "command_started", command: boundText(String(item.command ?? ""), 4000), cwd: String(item.cwd ?? "") });
        } else {
          await this.sink.event({
            ...base,
            kind: "command_completed",
            command: boundText(String(item.command ?? ""), 4000),
            exitCode: item.exitCode ?? null,
            status: String(item.status ?? ""),
            durationMs: item.durationMs ?? null,
            output: boundText(String(item.aggregatedOutput ?? ""), MAX_COMMAND_OUTPUT_CHARS),
          });
        }
        return;
      case "fileChange":
        if (phase === "completed") {
          const changes = (item.changes ?? []).map((change) => {
            const counts = countDiffLines(change?.diff);
            return {
              path: String(change?.path ?? change?.file ?? ""),
              // `kind` is a tagged union on this protocol version, not a string.
              kind: String(change?.kind?.type ?? change?.kind ?? change?.type ?? ""),
              movedTo: String(change?.kind?.move_path ?? ""),
              added: counts.added,
              removed: counts.removed,
            };
          });
          for (const change of changes) {
            if (change.path) this.changedFiles.add(change.path);
          }
          await this.sink.event({ ...base, kind: "file_change", status: String(item.status ?? ""), changes });
        }
        return;
      case "mcpToolCall":
        await this.sink.event({
          ...base,
          kind: phase === "started" ? "tool_started" : "tool_completed",
          toolKind: "mcp",
          server: String(item.server ?? ""),
          tool: String(item.tool ?? ""),
          status: String(item.status ?? ""),
          durationMs: item.durationMs ?? null,
          detail: boundText(JSON.stringify(item.arguments ?? {}), 4000),
          error: item.error ? boundText(JSON.stringify(item.error), 2000) : "",
        });
        return;
      case "dynamicToolCall":
        await this.sink.event({
          ...base,
          kind: phase === "started" ? "tool_started" : "tool_completed",
          toolKind: "dynamic",
          tool: String(item.tool ?? ""),
          status: String(item.status ?? ""),
          durationMs: item.durationMs ?? null,
          detail: boundText(JSON.stringify(item.arguments ?? {}), 4000),
        });
        return;
      case "webSearch":
        if (phase === "completed") {
          await this.sink.event({ ...base, kind: "tool_completed", toolKind: "web_search", tool: "web_search", detail: boundText(JSON.stringify(item.action ?? item.query ?? {}), 2000) });
        }
        return;
      case "subAgentActivity":
        await this.sink.event({ ...base, kind: "subagent", activity: String(item.kind ?? ""), agentThreadId: String(item.agentThreadId ?? ""), agentPath: String(item.agentPath ?? "") });
        return;
      case "contextCompaction":
        if (phase === "completed") {
          await this.sink.event({ ...base, kind: "warning", code: "context_compacted", message: "Codex compacted this thread's context." });
        }
        return;
      case "imageView":
        if (phase === "completed") {
          await this.sink.event({ ...base, kind: "artifact_created", artifactKind: "image", path: String(item.path ?? "") });
        }
        return;
      default:
        if (phase === "completed") this.sink.diagnostic(`unmapped codex item type ${item.type}`);
    }
  }

  async #onTurnCompleted(params) {
    const turn = params?.turn ?? {};
    this.currentTurnId = "";
    const status = String(turn.status ?? "");
    const normalized = status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed";
    await this.sink.terminal({
      status: normalized,
      // Verified on 0.145.0-alpha.18: `turn.items` is empty here, so the final
      // text always comes from the agentMessage items streamed earlier.
      text: this.finalText,
      diff: this.lastDiff,
      changedFiles: [...this.changedFiles],
      error: turn.error ? boundText(JSON.stringify(turn.error), 4000) : "",
      durationMs: turn.durationMs ?? null,
      turnId: String(turn.id ?? ""),
    });
  }

  #onServerRequest(method, params, serverRequestId) {
    const requestId = randomUUID();
    if (method === "item/commandExecution/requestApproval") {
      this.openApprovals.set(requestId, { serverRequestId, kind: "command" });
      return this.sink.event({
        kind: "approval_requested",
        requestId,
        category: "command",
        toolName: "Bash",
        turnId: params.turnId,
        itemId: params.itemId,
        reason: String(params.reason ?? ""),
        command: boundText(String(params.command ?? ""), 4000),
        cwd: String(params.cwd ?? ""),
        // Only choices the provider actually offers.
        choices: [
          { id: "accept", label: "Approve once" },
          { id: "acceptForSession", label: "Approve for this session" },
          { id: "decline", label: "Deny" },
        ],
      });
    }
    if (method === "item/fileChange/requestApproval") {
      this.openApprovals.set(requestId, { serverRequestId, kind: "file" });
      return this.sink.event({
        kind: "approval_requested",
        requestId,
        category: "file",
        toolName: "File change",
        turnId: params.turnId,
        itemId: params.itemId,
        reason: String(params.reason ?? ""),
        grantRoot: String(params.grantRoot ?? ""),
        choices: [
          { id: "accept", label: "Approve once" },
          { id: "acceptForSession", label: "Approve for this session" },
          { id: "decline", label: "Deny" },
        ],
      });
    }
    if (method === "item/tool/requestUserInput") {
      this.openQuestions.set(requestId, { serverRequestId });
      return this.sink.event({
        kind: "user_input_requested",
        requestId,
        turnId: params.turnId,
        itemId: params.itemId,
        autoResolutionMs: params.autoResolutionMs ?? null,
        questions: (params.questions ?? []).map((question) => ({
          id: String(question?.id ?? ""),
          header: String(question?.header ?? ""),
          question: String(question?.question ?? ""),
          allowOther: Boolean(question?.isOther),
          isSecret: Boolean(question?.isSecret),
          options: (question?.options ?? []).map((option) => ({
            id: String(option?.id ?? option?.value ?? option?.label ?? ""),
            label: String(option?.label ?? option?.value ?? ""),
            description: String(option?.description ?? ""),
          })),
        })),
      });
    }
    // Everything else is explicitly declined rather than silently ignored.
    this.connection.respond(serverRequestId, null, { code: -32601, message: `Mind Atlas does not implement ${method}` });
    return this.sink.event({ kind: "warning", code: "unhandled_server_request", message: `Codex requested ${method}, which Mind Atlas declined.` });
  }

  async resolveApproval(requestId, decision) {
    const open = this.openApprovals.get(requestId);
    if (!open) return { ok: false, reason: "unknown_request", detail: "That approval is no longer waiting." };
    const allowed = new Set(["accept", "acceptForSession", "decline", "cancel"]);
    if (!allowed.has(decision)) return { ok: false, reason: "invalid_decision", detail: `Unsupported decision: ${decision}` };
    this.openApprovals.delete(requestId);
    this.connection.respond(open.serverRequestId, { decision });
    await this.sink.event({ kind: "approval_resolved", requestId, decision });
    return { ok: true };
  }

  async resolveUserInput(requestId, answers) {
    const open = this.openQuestions.get(requestId);
    if (!open) return { ok: false, reason: "unknown_request", detail: "That question is no longer waiting." };
    this.openQuestions.delete(requestId);
    const payload = {};
    for (const [questionId, values] of Object.entries(answers ?? {})) {
      payload[questionId] = { answers: Array.isArray(values) ? values.map(String) : [String(values)] };
    }
    this.connection.respond(open.serverRequestId, { answers: payload });
    await this.sink.event({ kind: "user_input_resolved", requestId });
    return { ok: true };
  }
}

/** Count added and removed lines in one file's unified diff fragment. */
function countDiffLines(diff) {
  const text = String(diff ?? "");
  if (!text) return { added: null, removed: null };
  let added = 0;
  let removed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function decodeMaybeBase64(value) {
  const text = String(value ?? "");
  if (!text) return "";
  // Codex sends plain text on this version; tolerate a base64 payload without
  // corrupting normal output.
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(text) || text.length % 4 !== 0) return text;
  try {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    return /�/.test(decoded) ? text : decoded;
  } catch {
    return text;
  }
}

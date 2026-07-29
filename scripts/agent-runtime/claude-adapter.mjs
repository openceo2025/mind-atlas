// Claude Code adapter: `claude -p --output-format stream-json` normalized into
// the shared Mind Atlas run event model.
//
// Mode: local-only.
//
// Verified against Claude Code 2.1.178 (see docs/local-agent-poc-results.md):
// - `system/init` carries session_id, model, tools, mcp_servers, slash_commands,
//   skills, agents, permissionMode, apiKeySource, claude_code_version;
// - partial deltas arrive as `stream_event` wrapping Anthropic stream events;
// - `result` carries usage, total_cost_usd and modelUsage[model].contextWindow;
// - `rate_limit_event` carries plan allowance, which is NOT context usage;
// - killing the process yields no `result` line, so the terminal event must be
//   synthesized locally.

import { spawn } from "node:child_process";

import { boundText, reduceCapabilities } from "./types.mjs";

const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "ApplyPatch"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const MAX_TOOL_DETAIL_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 20_000;

export class ClaudeAdapter {
  /**
   * @param {{ buildCommand: (args: string[]) => { command: string, args: string[] },
   *           buildEnv: (settings: object) => NodeJS.ProcessEnv,
   *           workspace: string,
   *           probeAuth: (settings: object) => Promise<{ loggedIn: boolean, detail?: object }> }} options
   */
  constructor(options) {
    this.id = "claude";
    this.options = options;
    /** @type {Map<string, ClaudeRunProcess>} */
    this.runs = new Map();
    this.capabilitiesCache = new Map();
    /** Cached result of the `--chrome` option probe. */
    this.chromeFlagCache = undefined;
  }

  async probe(settings = {}) {
    try {
      const env = this.options.buildEnv({ ...settings, authMode: settings.authMode ?? "subscription" });
      const spec = this.options.buildCommand(["--version"]);
      const result = await runOnce(spec, env, this.options.workspace, 15_000);
      const version = String(result.stdout ?? "").trim().split(/\s+/)[0] ?? "";
      return {
        ok: result.exitCode === 0,
        route: "claude-stream-json",
        runtimeVersion: version,
        supportsChromeFlag: await this.#probeChromeFlag(env),
        detail: result.stderr.slice(0, 300),
      };
    } catch (error) {
      return { ok: false, route: "claude-json", reason: String(error?.message ?? error).slice(0, 400) };
    }
  }

  /**
   * Browser support is detected from the installed CLI's own option list, not
   * from documentation. `--chrome` exists on builds that ship the Claude in
   * Chrome integration.
   */
  async #probeChromeFlag(env) {
    if (this.chromeFlagCache !== undefined) return this.chromeFlagCache;
    try {
      const spec = this.options.buildCommand(["--help"]);
      const result = await runOnce(spec, env, this.options.workspace, 20_000);
      this.chromeFlagCache = /(^|\s)--chrome(\s|$)/m.test(String(result.stdout ?? ""));
    } catch {
      this.chromeFlagCache = false;
    }
    return this.chromeFlagCache;
  }

  /**
   * Claude capability discovery needs a real `system/init` frame. A cheap probe
   * run is used and cached per auth route so the picker is never populated from
   * hardcoded strings.
   */
  async discoverCapabilities(settings = {}) {
    const authMode = settings.authMode === "subscription" ? "subscription" : "api";
    const cacheKey = `${authMode}:${settings.workspace ?? this.options.workspace}`;
    const cached = this.capabilitiesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;

    const probe = await this.probe(settings);
    if (!probe.ok) {
      const value = reduceCapabilities({
        provider: "claude",
        route: "claude-json",
        available: false,
        models: [],
        permissionModes: [],
        sandboxModes: [],
        supports: {},
        unavailableReasons: { streaming: probe.reason ?? "Claude Code CLI did not respond to --version" },
      });
      this.capabilitiesCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }

    let init = null;
    try {
      init = await this.#probeInit(settings);
    } catch {
      init = null;
    }

    const authIsSubscription = authMode === "subscription";
    const slashCommands = Array.isArray(init?.slash_commands) ? init.slash_commands.map(String) : [];
    const value = reduceCapabilities({
      provider: "claude",
      route: "claude-stream-json",
      available: true,
      runtimeVersion: String(init?.claude_code_version ?? probe.runtimeVersion ?? ""),
      authMode,
      workspace: settings.workspace ?? this.options.workspace,
      // The installed CLI reports the model it will actually use; Mind Atlas
      // presets remain available but the runtime value is authoritative.
      models: init?.model ? [{ id: String(init.model), model: String(init.model), displayName: String(init.model), isDefault: true, supportedEfforts: [], inputModalities: [] }] : [],
      permissionModes: init?.permissionMode
        ? [{ id: String(init.permissionMode), label: String(init.permissionMode) }]
        : [],
      sandboxModes: [],
      tools: Array.isArray(init?.tools) ? init.tools.map(String) : [],
      mcpServers: Array.isArray(init?.mcp_servers) ? init.mcp_servers : [],
      skills: Array.isArray(init?.skills) ? init.skills.map((name) => ({ name: String(name), description: "" })) : [],
      agents: Array.isArray(init?.agents) ? init.agents.map(String) : [],
      slashCommands,
      apiKeySource: String(init?.apiKeySource ?? ""),
      supports: {
        streaming: true,
        interrupt: true,
        resume: true,
        fork: true,
        compact: slashCommands.includes("compact"),
        mcp: Array.isArray(init?.mcp_servers) && init.mcp_servers.length > 0,
        skills: Array.isArray(init?.skills) && init.skills.length > 0,
        subagents: Array.isArray(init?.agents) && init.agents.length > 0,
        // /desktop is not present on the verified build; never advertise it
        // from documentation alone.
        nativeDesktopHandoff: authIsSubscription && slashCommands.includes("desktop"),
        nativeCliHandoff: true,
        images: Array.isArray(init?.tools) && init.tools.includes("Read"),
        // Official behaviour: Claude in Chrome requires direct Claude plan
        // authentication, so an API or third-party route never advertises it
        // merely because the flag exists.
        browser: authIsSubscription && probe.supportsChromeFlag === true,
      },
      unavailableReasons: {
        steer: "Claude print mode has no verified mid-turn steering channel; Mind Atlas queues a follow-up run instead.",
        approvals: "Claude print mode resolves permissions from --permission-mode; it does not raise an interactive approval to the client.",
        userQuestions: "Claude print mode does not surface interactive questions to a non-TTY client.",
        nativeDesktopHandoff: slashCommands.includes("desktop")
          ? ""
          : "The installed Claude Code build does not report a /desktop command.",
        browser: authIsSubscription
          ? (probe.supportsChromeFlag
            ? ""
            : "The installed Claude Code build does not expose a --chrome option.")
          : "Claude in Chrome requires direct Claude plan authentication, not an API key or third-party provider.",
      },
    });
    this.capabilitiesCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  async #probeInit(settings) {
    return await new Promise((resolve, reject) => {
      const spec = this.options.buildCommand(["-p", "--output-format", "stream-json", "--verbose"]);
      const child = spawn(spec.command, spec.args, {
        cwd: settings.workspace || this.options.workspace,
        env: this.options.buildEnv(settings),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "";
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { child.kill(); } catch {}
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(null, new Error("Claude capability probe timed out")), 45_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed?.type === "system" && parsed?.subtype === "init") finish(parsed);
          } catch {
            // ignore
          }
        }
      });
      child.on("error", (error) => finish(null, error));
      child.on("close", () => finish(null, new Error("Claude capability probe closed before init")));
      // A trivial prompt is enough to emit `system/init`; the process is killed
      // as soon as that frame arrives so no model turn is billed.
      child.stdin.write("ping");
      child.stdin.end();
    });
  }

  /**
   * @param {"new"|"resume"|"fork"} mode
   */
  async startRun(mode, request, sink) {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    const settings = request.claudeSettings ?? {};
    // Additive per-run MCP config. The user's own global MCP servers stay
    // available because `--strict-mcp-config` is deliberately not used.
    if (request.mcpConfigPath) args.push("--mcp-config", request.mcpConfigPath);
    // Browser control is opt-in per run and only when the installed build and
    // the auth route both support it.
    if (request.browser === true && settings.authMode === "subscription" && this.chromeFlagCache === true) {
      args.push("--chrome");
    }
    if (settings.authMode === "subscription" && settings.model) args.push("--model", settings.model);
    if (settings.reasoningEffort && settings.reasoningEffort !== "default") args.push("--effort", settings.reasoningEffort);
    if (settings.permissionMode && settings.permissionMode !== "default") args.push("--permission-mode", settings.permissionMode);
    let sessionAction = mode;
    if ((mode === "resume" || mode === "fork") && request.session?.sessionId) {
      args.push("--resume", request.session.sessionId);
      if (mode === "fork") args.push("--fork-session");
    } else if (mode !== "new") {
      sessionAction = "new";
    }

    const spec = this.options.buildCommand(args);
    const runProcess = new ClaudeRunProcess({
      adapter: this,
      sink,
      sessionAction,
      requestedSessionId: request.session?.sessionId ?? "",
      workspace: request.workspace || this.options.workspace,
      env: this.options.buildEnv(settings),
      spec,
      prompt: String(request.prompt ?? ""),
      authMode: settings.authMode === "subscription" ? "subscription" : "api",
    });
    this.runs.set(sink.runId, runProcess);
    runProcess.start();
    return {
      provider: "claude",
      route: "claude-stream-json",
      runId: sink.runId,
      sessionAction,
    };
  }

  async steer(runId) {
    const run = this.runs.get(runId);
    if (!run) return { ok: false, reason: "unsupported", detail: "No active Claude run." };
    return {
      ok: false,
      reason: "unsupported",
      detail: "Claude print mode has no verified mid-turn steering channel. Stop this run and send a follow-up, or hand off to the native CLI.",
    };
  }

  async interrupt(runId) {
    const run = this.runs.get(runId);
    if (!run) return { ok: false, reason: "unsupported", detail: "No active Claude run." };
    run.stop();
    return { ok: true };
  }

  async resolveApproval() {
    return { ok: false, reason: "unsupported", detail: "Claude print mode does not raise interactive approvals." };
  }

  async resolveUserInput() {
    return { ok: false, reason: "unsupported", detail: "Claude print mode does not raise interactive questions." };
  }

  release(runId) {
    this.runs.delete(runId);
  }

  close() {
    for (const run of this.runs.values()) run.stop(true);
    this.runs.clear();
  }
}

class ClaudeRunProcess {
  constructor({ adapter, sink, sessionAction, requestedSessionId, workspace, env, spec, prompt, authMode }) {
    this.adapter = adapter;
    this.sink = sink;
    this.sessionAction = sessionAction;
    this.requestedSessionId = requestedSessionId;
    this.workspace = workspace;
    this.env = env;
    this.spec = spec;
    this.prompt = prompt;
    this.authMode = authMode;
    this.child = null;
    this.buffer = "";
    this.stderr = "";
    this.sessionId = "";
    this.model = "";
    this.contextWindow = null;
    this.finalText = "";
    this.sawResult = false;
    this.stopping = false;
    this.changedFiles = new Set();
    /** @type {Map<string, { name: string, startedAt: number, detail?: string, label?: string }>} */
    this.openTools = new Map();
  }

  start() {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.workspace,
      env: this.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#consume(chunk));
    child.stdout.on("error", () => {});
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
      this.sink.diagnostic(String(chunk).slice(0, 2000));
    });
    child.stderr.on("error", () => {});
    child.on("error", (error) => {
      this.#finish("failed", String(error?.message ?? error));
    });
    child.on("close", (code) => {
      if (this.buffer.trim()) {
        this.#handleLine(this.buffer.trim());
        this.buffer = "";
      }
      if (this.sawResult) return;
      if (this.stopping) {
        this.#finish("interrupted", "");
        return;
      }
      this.#finish("failed", this.stderr.trim() || `Claude Code exited with ${code}`);
    });
    try {
      child.stdin.write(this.prompt);
      child.stdin.end();
    } catch (error) {
      this.#finish("failed", String(error?.message ?? error));
    }
  }

  stop(force = false) {
    if (!this.child) return;
    this.stopping = true;
    try {
      // Graceful first; the close handler synthesizes the terminal event.
      this.child.kill("SIGINT");
    } catch {
      // ignore
    }
    const child = this.child;
    setTimeout(() => {
      try { child.kill(); } catch {}
    }, force ? 0 : 5000);
  }

  #consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) this.#handleLine(trimmed);
    }
  }

  #handleLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.sink.diagnostic(`unparsable claude stream line: ${line.slice(0, 300)}`);
      return;
    }
    this.#onEvent(event).catch((error) => {
      this.sink.diagnostic(`claude event handler failed: ${String(error?.message ?? error).slice(0, 300)}`);
    });
  }

  async #onEvent(event) {
    const type = String(event?.type ?? "");
    if (type === "system") return this.#onSystem(event);
    if (type === "stream_event") return this.#onStreamEvent(event);
    if (type === "assistant") return this.#onAssistant(event);
    if (type === "user") return this.#onUser(event);
    if (type === "result") return this.#onResult(event);
    if (type === "rate_limit_event") {
      const info = event.rate_limit_info ?? {};
      return this.sink.event({
        kind: "usage_updated",
        usage: {
          scope: "account_plan",
          authMode: this.authMode,
          status: String(info.status ?? ""),
          rateLimitType: String(info.rateLimitType ?? ""),
          resetsAt: info.resetsAt ?? null,
          isUsingOverage: Boolean(info.isUsingOverage),
          utilization: Number.isFinite(Number(info.utilization)) ? Number(info.utilization) : null,
        },
      });
    }
    this.sink.diagnostic(`unmapped claude event type ${type}`);
  }

  async #onSystem(event) {
    const subtype = String(event.subtype ?? "");
    if (subtype === "init") {
      this.sessionId = String(event.session_id ?? "");
      this.model = String(event.model ?? "");
      await this.sink.session({
        provider: "claude",
        sessionId: this.sessionId,
        action: this.sessionAction,
        requestedSessionId: this.requestedSessionId,
        model: this.model,
        authMode: this.authMode,
        permissionMode: String(event.permissionMode ?? ""),
        runtimeVersion: String(event.claude_code_version ?? ""),
        tools: Array.isArray(event.tools) ? event.tools.map(String) : [],
        mcpServers: Array.isArray(event.mcp_servers) ? event.mcp_servers : [],
        skills: Array.isArray(event.skills) ? event.skills.map(String) : [],
        agents: Array.isArray(event.agents) ? event.agents.map(String) : [],
        memoryPaths: event.memory_paths ?? null,
      });
      return;
    }
    if (subtype === "thinking_tokens") {
      await this.sink.event({
        kind: "usage_updated",
        usage: { scope: "thinking_estimate", estimatedTokens: event.estimated_tokens ?? null },
      });
      return;
    }
    if (subtype === "post_turn_summary") {
      await this.sink.event({
        kind: "diagnostic",
        code: "post_turn_summary",
        message: boundText(`${event.status_category ?? ""}: ${event.status_detail ?? ""}`, 1000),
        needsAction: String(event.needs_action ?? ""),
      });
      return;
    }
    if (subtype === "api_retry" || subtype === "retry") {
      await this.sink.event({ kind: "retry", message: boundText(JSON.stringify(event), 1000) });
      return;
    }
    if (subtype === "status") {
      this.sink.diagnostic(`claude status ${event.status ?? ""}`);
      return;
    }
    this.sink.diagnostic(`unmapped claude system subtype ${subtype}`);
  }

  async #onStreamEvent(event) {
    const inner = event.event ?? {};
    const innerType = String(inner.type ?? "");
    if (innerType !== "content_block_delta") return;
    const delta = inner.delta ?? {};
    if (delta.type === "text_delta" && delta.text) {
      await this.sink.event({ kind: "message_delta", delta: String(delta.text) });
      return;
    }
    if (delta.type === "thinking_delta" && delta.thinking) {
      await this.sink.event({ kind: "reasoning_summary", delta: boundText(String(delta.thinking), 4000) });
    }
  }

  async #onAssistant(event) {
    const content = event?.message?.content ?? [];
    for (const block of content) {
      if (block?.type === "text" && block.text) {
        this.finalText = String(block.text);
        await this.sink.event({ kind: "message_completed", text: boundText(this.finalText, 400_000) });
        continue;
      }
      if (block?.type === "tool_use") {
        const name = String(block.name ?? "");
        const itemId = String(block.id ?? "");
        const detail = boundText(JSON.stringify(block.input ?? {}), MAX_TOOL_DETAIL_CHARS);
        const label = boundText(String(block.input?.description ?? block.input?.name ?? name), 300);
        this.openTools.set(itemId, { name, startedAt: Date.now(), detail, label });
        if (name === "Bash") {
          await this.sink.event({
            kind: "command_started",
            itemId: String(block.id ?? ""),
            command: boundText(String(block.input?.command ?? ""), 4000),
            cwd: this.workspace,
          });
          continue;
        }
        if (FILE_WRITE_TOOLS.has(name)) {
          const path = String(block.input?.file_path ?? block.input?.path ?? "");
          if (path) this.changedFiles.add(path);
          await this.sink.event({
            kind: "file_change",
            itemId: String(block.id ?? ""),
            status: "proposed",
            changes: [{ path, kind: name === "Write" ? "write" : "edit", added: null, removed: null }],
          });
          continue;
        }
        if (SUBAGENT_TOOLS.has(name)) {
          await this.sink.event({
            kind: "subagent",
            itemId,
            activity: "started",
            status: "running",
            label: label || "Claude sub-agent",
            detail,
          });
          continue;
        }
        await this.sink.event({
          kind: "tool_started",
          itemId,
          toolKind: "tool",
          tool: name,
          detail: boundText(JSON.stringify(block.input ?? {}), MAX_TOOL_DETAIL_CHARS),
        });
      }
    }
  }

  async #onUser(event) {
    const content = event?.message?.content ?? [];
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      const id = String(block.tool_use_id ?? "");
      const open = this.openTools.get(id);
      this.openTools.delete(id);
      const text = extractToolResultText(block.content);
      if (open?.name === "Bash") {
        await this.sink.event({
          kind: "command_completed",
          itemId: id,
          status: block.is_error ? "failed" : "completed",
          exitCode: block.is_error ? 1 : 0,
          durationMs: open ? Date.now() - open.startedAt : null,
          output: boundText(text, MAX_TOOL_RESULT_CHARS),
        });
        continue;
      }
      if (open && FILE_WRITE_TOOLS.has(open.name)) {
        await this.sink.event({
          kind: "file_change",
          itemId: id,
          status: block.is_error ? "failed" : "applied",
          changes: [],
          detail: boundText(text, 2000),
        });
        continue;
      }
      if (open && SUBAGENT_TOOLS.has(open.name)) {
        await this.sink.event({
          kind: "subagent",
          itemId: id,
          activity: block.is_error ? "failed" : "completed",
          status: block.is_error ? "failed" : "completed",
          label: open.label || "Claude sub-agent",
          detail: boundText(text, MAX_TOOL_RESULT_CHARS),
        });
        continue;
      }
      await this.sink.event({
        kind: "tool_completed",
        itemId: id,
        tool: open?.name ?? "",
        status: block.is_error ? "failed" : "completed",
        durationMs: open ? Date.now() - open.startedAt : null,
        detail: boundText(text, MAX_TOOL_RESULT_CHARS),
      });
    }
  }

  async #onResult(event) {
    this.sawResult = true;
    this.sessionId = String(event.session_id ?? this.sessionId);
    const usage = event.usage ?? {};
    const modelUsage = event.modelUsage ?? {};
    const primaryModel = this.model && modelUsage[this.model] ? this.model : Object.keys(modelUsage)[0] ?? "";
    const primary = primaryModel ? modelUsage[primaryModel] : null;
    this.contextWindow = primary?.contextWindow ?? null;
    await this.sink.event({
      kind: "usage_updated",
      usage: {
        scope: "provider_session",
        inputTokens: usage.input_tokens ?? null,
        cachedInputTokens: usage.cache_read_input_tokens ?? null,
        cacheWriteInputTokens: usage.cache_creation_input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
        // Claude's real per-turn context occupancy is input + cache read +
        // cache creation. Never a character estimate.
        totalTokens:
          (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0),
        contextWindow: this.contextWindow,
        maxOutputTokens: primary?.maxOutputTokens ?? null,
        costUsd: event.total_cost_usd ?? null,
        serviceTier: usage.service_tier ?? "",
        model: primaryModel,
        durationMs: event.duration_ms ?? null,
        ttftMs: event.ttft_ms ?? null,
        numTurns: event.num_turns ?? null,
      },
    });
    const text = String(event.result ?? this.finalText ?? "");
    if (text && text !== this.finalText) {
      this.finalText = text;
      await this.sink.event({ kind: "message_completed", text: boundText(text, 400_000) });
    }
    const isError = Boolean(event.is_error) || String(event.subtype ?? "") !== "success";
    this.#finish(isError ? "failed" : "completed", isError ? boundText(String(event.result ?? event.subtype ?? "Claude Code reported an error"), 8000) : "");
  }

  #finish(status, error) {
    if (this.finished) return;
    this.finished = true;
    this.adapter.release(this.sink.runId);
    void this.sink.terminal({
      status,
      text: this.finalText,
      error,
      sessionId: this.sessionId,
      changedFiles: [...this.changedFiles],
    });
  }
}

function extractToolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => (typeof entry === "string" ? entry : entry?.type === "text" ? String(entry.text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function runOnce(spec, env, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error("Claude probe timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    try { child.stdin.end(); } catch {}
  });
}

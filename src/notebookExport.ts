import type {
  AgentExecutionMetadata,
  AgentWorkspaceBinding,
  AiContextOptions,
  AiDialogSettings,
  AiExecutionMode,
  AiProvider,
  AiUsage,
  AtlasNode,
  AtlasNodeAction,
  AtlasNodeKind,
  AttachmentKind,
  ChatReasoningEffort,
  ChatServiceId,
  ChatSettings,
  ClaudePermissionMode,
  ClaudeReasoningEffort,
  ClaudeSettings,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexSettings,
  NodeAttachment,
  NotebookNodeType,
  OpenClawSettings,
  PlanetTexture,
  WorkStatus,
} from "./types";

const ATTACHMENT_KINDS: AttachmentKind[] = ["image", "audio", "video", "file"];
const ATLAS_NODE_KINDS: AtlasNodeKind[] = ["root", "workArea", "artifact", "event", "concept", "thread"];
const NOTEBOOK_NODE_TYPES: NotebookNodeType[] = [
  "human_prompt",
  "ai_reply",
  "tool_call",
  "tool_result",
  "approval_request",
  "note",
  "file_context",
];
const WORK_STATUSES: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];
const PLANET_TEXTURES: PlanetTexture[] = ["speckled", "bands", "freckles", "craters", "mist", "cell"];
const AI_PROVIDERS: AiProvider[] = ["openai", "openai-compatible", "anthropic", "deepseek", "local", "codex", "openclaw", "claude", "mock"];
const AI_EXECUTION_MODES: AiExecutionMode[] = ["chat", "openai", "local", "codex", "openclaw", "claude"];
const CHAT_SERVICES: ChatServiceId[] = ["openai", "anthropic", "deepseek", "local"];
const CODEX_SANDBOX_MODES: CodexSandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
const CLAUDE_PERMISSION_MODES: ClaudePermissionMode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];

export interface NotebookExportOptions {
  includeAttachmentAssetPaths?: boolean;
}

export function sanitizeNotebookForExport(node: AtlasNode, options: NotebookExportOptions = {}): AtlasNode {
  const source = node as Partial<AtlasNode>;
  const sanitized: AtlasNode = {
    id: safeBoundedText(source.id, "node", 240),
    kind: ATLAS_NODE_KINDS.includes(source.kind as AtlasNodeKind) ? (source.kind as AtlasNodeKind) : "thread",
    nodeType: NOTEBOOK_NODE_TYPES.includes(source.nodeType as NotebookNodeType) ? (source.nodeType as NotebookNodeType) : "note",
    title: safeString(source.title, "Untitled"),
    subtitle: safeString(source.subtitle, ""),
    body: safeString(source.body, ""),
    author: isNodeAuthor(source.author) ? source.author : "human",
    status: WORK_STATUSES.includes(source.status as WorkStatus) ? (source.status as WorkStatus) : "needs_review",
    color: safeBoundedText(source.color, "#6f8cff", 80),
    texture: PLANET_TEXTURES.includes(source.texture as PlanetTexture) ? (source.texture as PlanetTexture) : "speckled",
    radius: safeSize(source.radius) || 28,
    summary: safeString(source.summary, ""),
    nextDecision: safeString(source.nextDecision, ""),
    tags: Array.isArray(source.tags)
      ? source.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.slice(0, 160)).slice(0, 100)
      : [],
    attachments: Array.isArray(source.attachments)
      ? source.attachments.map((attachment) => sanitizeAttachmentForExport(attachment, {}, options))
      : [],
    createdAt: safeDateText(source.createdAt).slice(0, 80),
    updatedAt: safeDateText(source.updatedAt).slice(0, 80),
    children: Array.isArray(source.children) ? source.children.map((child) => sanitizeNotebookForExport(child, options)) : [],
  };

  assignOptionalString(sanitized, "sourceParentId", source.sourceParentId);
  assignOptionalString(sanitized, "sourceId", source.sourceId);
  assignOptionalString(sanitized, "propagatedErrorSourceId", source.propagatedErrorSourceId);
  assignOptionalString(sanitized, "aiRunId", source.aiRunId);
  assignOptionalString(sanitized, "modelId", source.modelId);
  assignOptionalString(sanitized, "codexThreadId", source.codexThreadId);
  assignOptionalString(sanitized, "codexLogPath", source.codexLogPath);
  assignOptionalString(sanitized, "openClawSessionKey", source.openClawSessionKey);
  assignOptionalString(sanitized, "openClawLogPath", source.openClawLogPath);
  assignOptionalString(sanitized, "claudeLogPath", source.claudeLogPath);
  assignOptionalString(sanitized, "claudeSessionId", source.claudeSessionId);
  assignOptionalString(sanitized, "reminderAt", source.reminderAt);
  assignOptionalString(sanitized, "reminderFiredAt", source.reminderFiredAt);

  if (isVec3(source.position)) sanitized.position = source.position;
  if (AI_PROVIDERS.includes(source.provider as AiProvider)) sanitized.provider = source.provider as AiProvider;
  if (AI_EXECUTION_MODES.includes(source.runMode as AiExecutionMode)) sanitized.runMode = source.runMode as AiExecutionMode;

  const usage = sanitizeAiUsage(source.usage);
  if (usage) sanitized.usage = usage;

  const action = sanitizeNodeAction(source.action);
  if (action) sanitized.action = action;

  const aiDialogSettings = sanitizeAiDialogSettings(source.aiDialogSettings);
  if (aiDialogSettings) sanitized.aiDialogSettings = aiDialogSettings;

  // The repository binding gates whether an agent run may start from this
  // branch. Dropping it here silently re-locks every branch after an export,
  // package save, or cloud round trip.
  const agentWorkspaceBinding = sanitizeAgentWorkspaceBinding(source.agentWorkspaceBinding);
  if (agentWorkspaceBinding) sanitized.agentWorkspaceBinding = agentWorkspaceBinding;

  const agentExecution = sanitizeAgentExecution(source.agentExecution);
  if (agentExecution) sanitized.agentExecution = agentExecution;

  return sanitized;
}

function sanitizeAgentWorkspaceBinding(value: unknown): AgentWorkspaceBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<AgentWorkspaceBinding>;
  const gitRoot = safeBoundedText(source.gitRoot, "", 1200);
  if (!gitRoot) return undefined;
  const binding: AgentWorkspaceBinding = {
    gitRoot,
    repositoryName: safeBoundedText(source.repositoryName, "", 240),
    boundAt: safeDateText(source.boundAt).slice(0, 80),
  };
  if (source.workspaceKind === "git" || source.workspaceKind === "directory") {
    binding.workspaceKind = source.workspaceKind;
  }
  const repositoryId = safeBoundedText(source.repositoryId, "", 1200);
  if (repositoryId) binding.repositoryId = repositoryId;
  return binding;
}

function sanitizeAgentExecution(value: unknown): AgentExecutionMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<AgentExecutionMetadata>;
  const clientRunId = safeBoundedText(source.clientRunId, "", 240);
  if (!clientRunId) return undefined;
  const execution: AgentExecutionMetadata = {
    clientRunId,
    requestedWorkspace: safeBoundedText(source.requestedWorkspace, "", 1200),
    workspaceMode: source.workspaceMode === "worktree" ? "worktree" : "shared",
    recordedAt: safeDateText(source.recordedAt).slice(0, 80),
  };
  if (source.workspaceKind === "git" || source.workspaceKind === "directory") {
    execution.workspaceKind = source.workspaceKind;
  }
  for (const key of ["runtimeRunId", "route", "resolvedWorkspace", "sourceWorkspace", "gitRoot", "repositoryName", "repositoryId", "gitBranch", "gitHead"] as const) {
    const text = safeBoundedText(source[key], "", 1200);
    if (text) execution[key] = text;
  }
  return execution;
}

export function sanitizeAttachmentForExport(
  attachment: NodeAttachment,
  patch: Partial<Pick<NodeAttachment, "mimeType" | "size" | "assetPath">> = {},
  options: NotebookExportOptions = {},
): NodeAttachment {
  const assetPath =
    options.includeAttachmentAssetPaths === false
      ? undefined
      : safeOptionalBoundedText(patch.assetPath ?? attachment.assetPath, 1024);
  return {
    id: safeBoundedText(attachment.id, "attachment", 180),
    name: safeBoundedText(attachment.name, "attachment", 240),
    kind: ATTACHMENT_KINDS.includes(attachment.kind) ? attachment.kind : "file",
    mimeType: safeBoundedText(patch.mimeType ?? attachment.mimeType, "application/octet-stream", 120),
    size: safeSize(patch.size ?? attachment.size),
    path: safeBoundedText(attachment.path, attachment.name || "attachment", 1024),
    createdAt: safeDateText(attachment.createdAt).slice(0, 80),
    ...(assetPath ? { assetPath } : {}),
  };
}

function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function safeReasoningEffort(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : fallback;
}

function safeBoundedText(value: unknown, fallback: string, maxLength: number) {
  const text = safeText(value, fallback);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function safeOptionalBoundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function safeDateText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : new Date().toISOString();
}

function safeSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function assignOptionalString(
  target: AtlasNode,
  key:
    | "sourceParentId"
    | "sourceId"
    | "propagatedErrorSourceId"
    | "aiRunId"
    | "modelId"
    | "claudeSessionId"
    | "codexThreadId"
    | "codexLogPath"
    | "openClawSessionKey"
    | "openClawLogPath"
    | "claudeLogPath"
    | "reminderAt"
    | "reminderFiredAt",
  value: unknown,
) {
  if (typeof value === "string" && value.trim()) {
    (target as unknown as Record<string, unknown>)[key] = value.slice(0, 240);
  }
}

function isNodeAuthor(value: unknown): value is AtlasNode["author"] {
  return value === "human" || value === "ai" || value === "tool" || value === "system";
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function sanitizeAiUsage(value: unknown): AiUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: AiUsage = {};
  assignOptionalNumber(usage, "inputTokens", value.inputTokens);
  assignOptionalNumber(usage, "outputTokens", value.outputTokens);
  assignOptionalNumber(usage, "totalTokens", value.totalTokens);
  assignOptionalNumber(usage, "maxOutputTokens", value.maxOutputTokens);
  assignOptionalNumber(usage, "estimatedCostUsd", value.estimatedCostUsd);
  assignOptionalNumber(usage, "durationMs", value.durationMs);
  assignOptionalUsageString(usage, "finishReason", value.finishReason);
  if (value.outputLimitHit === true) usage.outputLimitHit = true;
  return Object.keys(usage).length ? usage : undefined;
}

function assignOptionalUsageString(target: AiUsage, key: "finishReason", value: unknown) {
  if (typeof value === "string" && value.trim()) {
    target[key] = value.slice(0, 120);
  }
}

function sanitizeNodeAction(value: unknown): AtlasNodeAction | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "git_push") {
    return {
      kind: "git_push",
      label: safeString(value.label, "Push"),
      workspace: safeString(value.workspace, ""),
      runId: safeString(value.runId, ""),
    };
  }
  if (value.kind !== "codex_full_access") return undefined;
  const contextOptions = sanitizeAiContextOptions(value.contextOptions);
  const settings = sanitizeCodexSettings(value.settings);
  if (!contextOptions || !settings) return undefined;
  return {
    kind: "codex_full_access",
    label: safeString(value.label, "Approve"),
    decision: value.decision === "deny" ? "deny" : "approve",
    prompt: safeString(value.prompt, ""),
    sourceNodeId: safeString(value.sourceNodeId, ""),
    runId: safeString(value.runId, ""),
    contextOptions,
    settings,
  };
}

function sanitizeAiDialogSettings(value: unknown): AiDialogSettings | undefined {
  if (!isRecord(value)) return undefined;
  const contextOptions = sanitizeAiContextOptions(value.contextOptions);
  const chatSettings = sanitizeChatSettings(value.chatSettings ?? {});
  const codexSettings = sanitizeCodexSettings(value.codexSettings);
  const openClawSettings = sanitizeOpenClawSettings(value.openClawSettings ?? {});
  const claudeSettings = sanitizeClaudeSettings(value.claudeSettings ?? {});
  if (!contextOptions || !chatSettings || !codexSettings || !openClawSettings || !claudeSettings) return undefined;
  return { contextOptions, chatSettings, codexSettings, openClawSettings, claudeSettings };
}

function sanitizeAiContextOptions(value: unknown): AiContextOptions | undefined {
  if (!isRecord(value)) return undefined;
  return {
    scope:
      value.scope === "minimal" ||
      value.scope === "focused" ||
      value.scope === "subtree" ||
      value.scope === "neighborhood" ||
      value.scope === "selected" ||
      value.scope === "custom"
        ? value.scope
        : "focused",
    ancestorDepth: safeInteger(value.ancestorDepth, 2),
    descendantDepth: safeInteger(value.descendantDepth, 2),
    lateralRadius: safeInteger(value.lateralRadius, 1),
    attachmentMode: value.attachmentMode === "content" ? "content" : "metadata",
    maxAttachmentCount: safeInteger(value.maxAttachmentCount, 10),
    maxAttachmentBytes: safeInteger(value.maxAttachmentBytes, 2 * 1024 * 1024),
    selectedNodeIds: Array.isArray(value.selectedNodeIds)
      ? value.selectedNodeIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function sanitizeCodexSettings(value: unknown): CodexSettings | undefined {
  if (!isRecord(value)) return undefined;
  return {
    model: safeString(value.model, "gpt-5.5"),
    reasoningEffort: safeReasoningEffort(value.reasoningEffort, "medium"),
    sandbox: CODEX_SANDBOX_MODES.includes(value.sandbox as CodexSandboxMode)
      ? (value.sandbox as CodexSandboxMode)
      : "workspace-write",
    workspace: safeString(value.workspace, ""),
    workspaceMode: value.workspaceMode === "worktree" ? "worktree" : "shared",
    webSearch: true,
    skipGitRepoCheck: false,
    ...(typeof value.fullAccessApproved === "boolean" ? { fullAccessApproved: value.fullAccessApproved } : {}),
    continueMode: value.continueMode === "new" ? "new" : "auto",
    resumeThreadId: typeof value.resumeThreadId === "string" ? value.resumeThreadId.slice(0, 160) : "",
  };
}

function sanitizeOpenClawSettings(value: unknown): OpenClawSettings | undefined {
  if (!isRecord(value)) return undefined;
  return {
    model: safeString(value.model, ""),
    thinking: "off",
    workspace: safeString(value.workspace, ""),
    timeoutMs: safeInteger(value.timeoutMs, 10 * 60 * 1000),
    continueMode: value.continueMode === "new" ? "new" : "auto",
    resumeSessionKey: typeof value.resumeSessionKey === "string" ? value.resumeSessionKey.slice(0, 220) : "",
  };
}

function sanitizeClaudeSettings(value: unknown): ClaudeSettings | undefined {
  if (!isRecord(value)) return undefined;
  return {
    authMode: value.authMode === "subscription" ? "subscription" : "api",
    model: safeString(value.model, ""),
    baseUrl: safeString(value.baseUrl, ""),
    reasoningEffort: safeReasoningEffort(value.reasoningEffort, "default"),
    permissionMode: CLAUDE_PERMISSION_MODES.includes(value.permissionMode as ClaudePermissionMode)
      ? (value.permissionMode as ClaudePermissionMode)
      : "default",
    workspace: safeString(value.workspace, ""),
    workspaceMode: value.workspaceMode === "worktree" ? "worktree" : "shared",
    browser: value.authMode === "subscription" && value.browser === true,
    continueMode: value.continueMode === "new" ? "new" : "auto",
    resumeSessionId: safeString(value.resumeSessionId, ""),
  };
}

function sanitizeChatSettings(value: unknown): ChatSettings | undefined {
  if (!isRecord(value)) return undefined;
  return {
    service: CHAT_SERVICES.includes(value.service as ChatServiceId) ? (value.service as ChatServiceId) : "openai",
    model: safeString(value.model, ""),
    reasoningEffort: safeReasoningEffort(value.reasoningEffort, "default"),
  };
}

function assignOptionalNumber(target: AiUsage, key: keyof AiUsage, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function safeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

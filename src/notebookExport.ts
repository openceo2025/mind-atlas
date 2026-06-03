import type {
  AiContextOptions,
  AiDialogSettings,
  AiExecutionMode,
  AiProvider,
  AiUsage,
  AtlasNode,
  AtlasNodeAction,
  AtlasNodeKind,
  AttachmentKind,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexSettings,
  NodeAttachment,
  NotebookNodeType,
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
const AI_PROVIDERS: AiProvider[] = ["openai", "openai-compatible", "local", "codex", "mock"];
const AI_EXECUTION_MODES: AiExecutionMode[] = ["openai", "local", "codex"];
const CODEX_REASONING_EFFORTS: CodexReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const CODEX_SANDBOX_MODES: CodexSandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

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

  return sanitized;
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
    | "codexThreadId"
    | "codexLogPath"
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
  const codexSettings = sanitizeCodexSettings(value.codexSettings);
  if (!contextOptions || !codexSettings) return undefined;
  return { contextOptions, codexSettings };
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
    reasoningEffort: CODEX_REASONING_EFFORTS.includes(value.reasoningEffort as CodexReasoningEffort)
      ? (value.reasoningEffort as CodexReasoningEffort)
      : "medium",
    sandbox: CODEX_SANDBOX_MODES.includes(value.sandbox as CodexSandboxMode)
      ? (value.sandbox as CodexSandboxMode)
      : "workspace-write",
    workspace: safeString(value.workspace, ""),
    webSearch: value.webSearch === true,
    skipGitRepoCheck: value.skipGitRepoCheck === true,
    timeoutMs: safeInteger(value.timeoutMs, 60 * 60 * 1000),
    ...(typeof value.fullAccessApproved === "boolean" ? { fullAccessApproved: value.fullAccessApproved } : {}),
    continueMode: value.continueMode === "new" ? "new" : "auto",
    resumeThreadId: typeof value.resumeThreadId === "string" ? value.resumeThreadId.slice(0, 160) : "",
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

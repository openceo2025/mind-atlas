export type WorkStatus =
  | "running"
  | "needs_review"
  | "waiting"
  | "blocked"
  | "error"
  | "done";

export type EventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "artifact_create"
  | "artifact_update"
  | "status_change"
  | "branch_create"
  | "link_attach";

export type EventActor = "human" | "ai" | "tool" | "system";

export type ArtifactType = "text" | "pdf" | "pptx" | "xlsx" | "app" | "image" | "code";

export type NotebookNodeType =
  | "human_prompt"
  | "ai_reply"
  | "tool_call"
  | "tool_result"
  | "approval_request"
  | "note"
  | "file_context";

export type AttachmentKind = "image" | "audio" | "video" | "file";

export interface NodeAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  path: string;
  assetPath?: string;
  createdAt: string;
}

export interface AtlasEvent {
  id: string;
  type: EventType;
  actor: EventActor;
  content: string;
  createdAt: string;
  modelId?: string;
  labels?: string[];
}

export interface Artifact {
  id: string;
  title: string;
  type: ArtifactType;
  status: WorkStatus;
  summary: string;
  preview: string[];
}

export interface WorkArea {
  id: string;
  title: string;
  subtitle: string;
  status: WorkStatus;
  color: string;
  position: [number, number, number];
  radius: number;
  summary: string;
  nextDecision: string;
  events: AtlasEvent[];
  artifacts: Artifact[];
}

export interface ResonanceLink {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  strength: number;
  color: string;
}

export type AtlasNodeKind = "root" | "workArea" | "artifact" | "event" | "concept" | "thread";

export type PlanetTexture = "speckled" | "bands" | "freckles" | "craters" | "mist" | "cell";

export type AiExecutionMode = "chat" | "openai" | "local" | "codex" | "openclaw" | "claude";

export type AiContextScope = "minimal" | "focused" | "subtree" | "neighborhood" | "selected" | "custom";

export type AiAttachmentMode = "metadata" | "content";

export interface AiContextOptions {
  scope: AiContextScope;
  ancestorDepth: number;
  descendantDepth: number;
  lateralRadius: number;
  attachmentMode: AiAttachmentMode;
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  selectedNodeIds: string[];
}

export type AiProvider = "openai" | "openai-compatible" | "anthropic" | "deepseek" | "local" | "codex" | "openclaw" | "claude" | "mock";

export type ChatServiceId = "openai" | "anthropic" | "deepseek" | "local";

export type ChatReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type AiRunStatus = "running" | "needs_review" | "error" | "done";

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexContinueMode = "auto" | "new";

export type OpenClawThinkingLevel = "off";

export type ClaudeReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";

export interface CodexSettings {
  model: string;
  reasoningEffort: CodexReasoningEffort;
  sandbox: CodexSandboxMode;
  workspace: string;
  webSearch: boolean;
  skipGitRepoCheck: boolean;
  timeoutMs: number;
  fullAccessApproved?: boolean;
  continueMode?: CodexContinueMode;
  resumeThreadId?: string;
  clientRunId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
}

export interface OpenClawSettings {
  model: string;
  thinking: OpenClawThinkingLevel;
  workspace: string;
  timeoutMs: number;
  continueMode?: CodexContinueMode;
  resumeSessionKey?: string;
  sessionKey?: string;
  clientRunId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
}

export interface ClaudeSettings {
  model: string;
  baseUrl: string;
  reasoningEffort: ClaudeReasoningEffort;
  permissionMode: ClaudePermissionMode;
  workspace: string;
  timeoutMs: number;
  clientRunId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
}

export interface ChatSettings {
  service: ChatServiceId;
  model: string;
  reasoningEffort: ChatReasoningEffort;
}

export interface ChatModelOption {
  model: string;
  displayName: string;
  description?: string;
  defaultReasoningEffort: ChatReasoningEffort;
  supportedReasoningEfforts: ChatReasoningEffort[];
}

export interface ChatServiceOption {
  id: ChatServiceId;
  label: string;
  configured: boolean;
  defaultModel: string;
  defaultReasoningEffort: ChatReasoningEffort;
  supportedReasoningEfforts: ChatReasoningEffort[];
  models: ChatModelOption[];
  baseUrl?: string;
  detail?: string;
}

export interface ChatOptionsResult {
  services: ChatServiceOption[];
  defaultService: ChatServiceId;
}

export interface CodexModelOption {
  model: string;
  displayName: string;
  description?: string;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: CodexReasoningEffort[];
}

export interface CodexOptionsResult {
  models: CodexModelOption[];
  defaultModel: string;
  defaultReasoningEffort: CodexReasoningEffort;
  defaultWorkspace: string;
  defaultSandbox: CodexSandboxMode;
  defaultTimeoutMs: number;
}

export type ProviderUsageMetricKind = "rate_limit" | "balance";

export interface ProviderUsageMetric {
  id: string;
  vendor: string;
  vendorLabel: string;
  kind: ProviderUsageMetricKind;
  label: string;
  available: boolean;
  displayValue: string;
  value?: number;
  unit?: string;
  barPercent?: number;
  resetAt?: string;
  detail?: string;
  source: string;
  defaultVisible?: boolean;
}

export interface ProviderUsageResult {
  fetchedAt: string;
  metrics: ProviderUsageMetric[];
}

export interface OpenClawModelOption {
  model: string;
  displayName: string;
  input?: string;
  contextWindow?: number;
  local?: boolean;
}

export interface OpenClawOptionsResult {
  models: OpenClawModelOption[];
  defaultModel: string;
  defaultTimeoutMs: number;
}

export type CodexGeneratedNodeKind =
  | "summary"
  | "command"
  | "file_change"
  | "approval_request"
  | "approval_option"
  | "final"
  | "error";

export type AtlasNodeAction = CodexFullAccessAction | GitPushAction;

export interface CodexFullAccessAction {
  kind: "codex_full_access";
  label: string;
  decision: "approve" | "deny";
  prompt: string;
  sourceNodeId: string;
  runId: string;
  contextOptions: AiContextOptions;
  settings: CodexSettings;
}

export interface GitPushAction {
  kind: "git_push";
  label: string;
  workspace: string;
  runId: string;
}

export interface CodexGeneratedNode {
  kind: CodexGeneratedNodeKind;
  title: string;
  body: string;
  summary: string;
  suggestedStatus: WorkStatus;
  tags: string[];
  nodeType?: NotebookNodeType;
  color?: string;
  action?: AtlasNodeAction;
  children?: CodexGeneratedNode[];
}

export interface AiDialogSettings {
  contextOptions: AiContextOptions;
  chatSettings: ChatSettings;
  codexSettings: CodexSettings;
  openClawSettings: OpenClawSettings;
  claudeSettings: ClaudeSettings;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  maxOutputTokens?: number;
  finishReason?: string;
  outputLimitHit?: boolean;
}

export interface AiRun {
  id: string;
  nodeId: string;
  requestNodeId?: string;
  provider: AiProvider;
  mode: AiExecutionMode;
  modelId: string;
  status: AiRunStatus;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  responseNodeId?: string;
  error?: string;
  usage?: AiUsage;
  contextStats?: AiContextStats;
  workspace?: string;
  codexThreadId?: string;
  codexLogPath?: string;
  openClawSessionKey?: string;
  openClawLogPath?: string;
  claudeLogPath?: string;
}

export interface AiNodeSnapshot {
  id: string;
  title: string;
  body: string;
  summary: string;
  status: WorkStatus;
  author: AtlasNode["author"];
  nodeType: NotebookNodeType;
  tags: string[];
  provider?: AiProvider;
  runMode?: AiExecutionMode;
  aiRunId?: string;
  codexThreadId?: string;
  codexLogPath?: string;
  openClawSessionKey?: string;
  openClawLogPath?: string;
  claudeLogPath?: string;
  attachments: AiAttachmentSnapshot[];
  children: AiNodeSnapshot[];
}

export interface AiAttachmentSnapshot extends Pick<NodeAttachment, "id" | "name" | "kind" | "mimeType" | "size"> {
  content?: {
    encoding: "text" | "data_url";
    value: string;
    bytes: number;
    truncated?: boolean;
    unavailable?: boolean;
    error?: string;
  };
}

export interface AiNodeContext {
  selectedNode: AiNodeSnapshot;
  selectedNodes?: AiNodeSnapshot[];
  path: AiNodeSnapshot[];
  siblingNodes: AiNodeSnapshot[];
  descendantCount: number;
  scope: AiContextScope;
  options?: AiContextOptions;
  stats: AiContextStats;
  exportedAt: string;
}

export interface AiContextStats {
  scope: AiContextScope;
  includedNodeCount: number;
  estimatedInputTokens: number;
  includedAttachmentCount: number;
  includedAttachmentBytes: number;
  truncated?: boolean;
  truncatedNodeCount?: number;
  truncatedBodyCount?: number;
  truncatedSummaryCount?: number;
  omittedChildNodeCount?: number;
  truncatedAttachmentCount?: number;
  sections: {
    selected: number;
    path: number;
    siblings: number;
    selectedNodes?: number;
  };
}

export interface AiResponsePayload {
  prompt: string;
  context: AiNodeContext;
  provider: AiExecutionMode;
  model?: string;
  chat?: Partial<ChatSettings>;
  codex?: Partial<CodexSettings>;
  openclaw?: Partial<OpenClawSettings>;
  claude?: Partial<ClaudeSettings>;
  // Node anchored AI runs must stay limited to the explicit node context.
  // Do not add AI Partner log, voice summary, or other global history here.
}

export interface AiGeneratedOutput {
  title: string;
  body: string;
  summary: string;
  suggestedStatus: "needs_review" | "done" | "waiting";
  tags: string[];
}

export interface AiGeneratedAttachment {
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  path: string;
  base64: string;
}

export interface AiResponseResult {
  id: string;
  provider: AiProvider;
  model: string;
  output: AiGeneratedOutput;
  codexNodes?: CodexGeneratedNode[];
  generatedAttachments?: AiGeneratedAttachment[];
  codexThreadId?: string;
  codexLogPath?: string;
  openClawSessionKey?: string;
  openClawLogPath?: string;
  claudeLogPath?: string;
  rawText: string;
  usage?: AiUsage;
}

export interface CodexRunRecoveryRequest {
  runId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
  threadId?: string;
  workspace?: string;
  startedAfter?: string;
}

export interface CodexRunRecoveryResult {
  found: boolean;
  result?: AiResponseResult;
  logPath?: string;
  metadata?: Record<string, unknown>;
}

export interface GitPushResult {
  ok: boolean;
  workspace: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AiBridgeHealth {
  ok: boolean;
  bridge: string;
  openaiConfigured: boolean;
  openAiBaseUrl: string;
  openAiMode: string;
  defaultModel: string;
  realtimeModel: string;
  realtimeReasoningEffort?: string;
  transcriptionModel?: string;
  realtimeTranscriptionModel?: string;
  mockFallback: boolean;
  providers: AiBridgeProvider[];
}

export interface AiBridgeProvider {
  id: AiExecutionMode;
  label: string;
  configured: boolean;
  model?: string;
  baseUrl?: string;
  detail?: string;
}

export type NotificationPulseKind = "done" | "needs_review" | "error" | "codex" | "openclaw" | "claude" | "cost";

export interface NotificationPulse {
  id: string;
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
  createdAt: number;
}

export type VoiceLogRole = "user" | "assistant" | "tool" | "system" | "summary" | "error";

export interface VoiceLogEntry {
  id: string;
  role: VoiceLogRole;
  text: string;
  createdAt: string;
  sessionId?: string;
  title?: string;
  toolName?: string;
  toolCallId?: string;
  status?: "pending" | "running" | "done" | "error" | "approval_required";
  metadata?: Record<string, unknown>;
}

export interface VoiceSessionSummary {
  text: string;
  createdAt: string;
  sessionId?: string;
}

export interface VoicePartnerState {
  sessionId: string | null;
  connected: boolean;
  lastInteractionAt: string | null;
  summary: VoiceSessionSummary | null;
}

export interface VoicePartnerSettings {
  realtimeModel: string;
  realtimeVoice: string;
}

export interface RealtimeToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AudioTranscriptionResult {
  text: string;
  model: string;
  durationMs?: number;
  audioSizeBytes?: number;
  audioMimeType?: string;
}

export interface WebSearchResult {
  text: string;
  citations: Array<{
    title?: string;
    url: string;
  }>;
  sources: Array<{
    title?: string;
    url: string;
  }>;
  usage?: AiUsage;
  raw?: unknown;
}

export interface CloudNotebookEntry {
  name: string;
  size: number;
  updatedAt: string;
}

export interface CloudNotebookListResult {
  directory: string;
  notebooks: CloudNotebookEntry[];
}

export interface CloudNotebookSaveResult extends CloudNotebookEntry {
  directory: string;
}

export interface RealtimeSessionConfig {
  context: AiNodeContext;
  instructions?: string;
  model?: string;
  voice?: string;
  summary?: VoiceSessionSummary | null;
  voiceLogContext?: string;
  notificationSummary?: string;
  tools?: RealtimeToolDefinition[];
}

export type TextPartnerMessageRole = "user" | "assistant" | "tool";

export interface TextPartnerMessage {
  role: TextPartnerMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: TextPartnerToolCall[];
}

export interface TextPartnerToolCall {
  name: string;
  arguments: string;
  callId?: string;
}

export interface TextPartnerTurnPayload {
  provider: ChatServiceId;
  context: AiNodeContext;
  messages: TextPartnerMessage[];
  tools: RealtimeToolDefinition[];
  model?: string;
  reasoningEffort?: ChatReasoningEffort;
  summary?: VoiceSessionSummary | null;
  voiceLogContext?: string;
}

export interface TextPartnerTurnResult {
  text: string;
  toolCalls: TextPartnerToolCall[];
  provider: AiProvider;
  model: string;
  usage?: AiUsage;
  raw?: unknown;
}

export interface AtlasNode {
  id: string;
  kind: AtlasNodeKind;
  nodeType: NotebookNodeType;
  title: string;
  subtitle: string;
  body: string;
  author: "human" | "ai" | "tool" | "system";
  status: WorkStatus;
  color: string;
  texture: PlanetTexture;
  radius: number;
  summary: string;
  nextDecision: string;
  tags: string[];
  attachments: NodeAttachment[];
  createdAt: string;
  updatedAt: string;
  position?: [number, number, number];
  sourceParentId?: string;
  sourceId?: string;
  propagatedErrorSourceId?: string;
  aiRunId?: string;
  modelId?: string;
  provider?: AiProvider;
  runMode?: AiExecutionMode;
  codexThreadId?: string;
  codexLogPath?: string;
  openClawSessionKey?: string;
  openClawLogPath?: string;
  claudeLogPath?: string;
  usage?: AiUsage;
  action?: AtlasNodeAction;
  aiDialogSettings?: AiDialogSettings;
  reminderAt?: string;
  reminderFiredAt?: string;
  children: AtlasNode[];
}

export type Selection =
  | { kind: "workArea"; id: string }
  | { kind: "event"; id: string; parentId: string }
  | { kind: "artifact"; id: string; parentId: string }
  | { kind: "node"; id: string };

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

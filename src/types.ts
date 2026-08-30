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

/** The optional feature mode owned by the notebook root. */
export type NotebookMode = "standard" | "shogi" | "chess" | "go";

export type PlanetTexture = "speckled" | "bands" | "freckles" | "craters" | "mist" | "cell";

export type AiExecutionMode = "chat" | "openai" | "local" | "codex" | "openclaw" | "claude";

export type AiContextScope = "minimal" | "path-children" | "focused" | "subtree" | "neighborhood" | "selected" | "custom";

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

export type AiProvider =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "glm"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "composer"
  | "kimi"
  | "mimo"
  | "minimax"
  | "grok"
  | "local"
  | "codex"
  | "openclaw"
  | "claude"
  | "mock";

export type HostedChatServiceId =
  | "openai"
  | "anthropic"
  | "glm"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "composer"
  | "kimi"
  | "mimo"
  | "minimax"
  | "grok";

export type ChatServiceId = HostedChatServiceId | "local";

// Providers add and rename reasoning levels independently. Keep the browser
// contract extensible while the bridge validates values before execution.
export type ReasoningEffort = string;

export type ChatReasoningEffort = ReasoningEffort;

export type AiRunStatus = "running" | "needs_review" | "error" | "done";

export type CodexReasoningEffort = ReasoningEffort;

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexContinueMode = "auto" | "new";
export type AgentWorkspaceMode = "shared" | "worktree";

export type OpenClawThinkingLevel = ReasoningEffort;

export type ClaudeReasoningEffort = ReasoningEffort;

export type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";

export interface CodexSettings {
  model: string;
  reasoningEffort: CodexReasoningEffort;
  sandbox: CodexSandboxMode;
  workspace: string;
  workspaceMode?: AgentWorkspaceMode;
  webSearch: boolean;
  skipGitRepoCheck: boolean;
  fullAccessApproved?: boolean;
  continueMode?: CodexContinueMode;
  resumeThreadId?: string;
  /**
   * Branch the resumed thread instead of extending it. Supported by the Codex
   * app-server (`thread/fork`); the `codex exec` fallback cannot fork and
   * degrades to a new thread.
   */
  forkThread?: boolean;
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
  authMode: "api" | "subscription";
  model: string;
  baseUrl: string;
  reasoningEffort: ClaudeReasoningEffort;
  permissionMode: ClaudePermissionMode;
  workspace: string;
  workspaceMode?: AgentWorkspaceMode;
  browser?: boolean;
  continueMode?: CodexContinueMode;
  resumeSessionId?: string;
  forkSession?: boolean;
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
  pricing?: {
    inputUsdPer1M: number;
    outputUsdPer1M: number;
  };
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
  /** Whether the model list came from live provider discovery. */
  modelSource?: "live" | "configured";
  modelSourceDetail?: string;
  baseUrl?: string;
  detail?: string;
}

export interface ChatOptionsResult {
  services: ChatServiceOption[];
  defaultService: ChatServiceId;
}

export interface HostedServiceUser {
  id: string;
  email: string;
  name: string;
  pictureUrl?: string;
  role: "user" | "admin";
}

export interface HostedServiceSubscription {
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface HostedServiceCredit {
  periodKey: string;
  remainingPercent: number;
  limitPercent: number;
  exhausted: boolean;
  updatedAt?: string;
}

export interface HostedServiceEntitlement {
  aiEnabled: boolean;
  reason?: "anonymous" | "subscription_required" | "billing_period_unavailable" | "credit_exhausted" | "active";
}

export interface HostedServiceSession {
  publicService: true;
  authenticated: boolean;
  user: HostedServiceUser | null;
  subscription: HostedServiceSubscription | null;
  credit: HostedServiceCredit | null;
  entitlement: HostedServiceEntitlement;
  chatOptions: ChatOptionsResult;
}

export interface CodexModelOption {
  model: string;
  displayName: string;
  description?: string;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: CodexReasoningEffort[];
}

export interface ClaudeApiModelOption {
  id: string;
  model: string;
  baseUrl: string;
  displayName: string;
  vendor: "bridge" | "anthropic" | "deepseek";
  supportedReasoningEfforts: ClaudeReasoningEffort[];
  defaultReasoningEffort: ClaudeReasoningEffort;
}

export interface ClaudeSubscriptionModelOption {
  id: string;
  model: string;
  resolvedModel: string;
  displayName: string;
  supportedReasoningEfforts: ClaudeReasoningEffort[];
  defaultReasoningEffort: ClaudeReasoningEffort;
}

export interface CodeModelDiscoveryState {
  status: "ready" | "error";
  source: "runtime" | "provider-api" | "native-cache" | "configured";
  detail: string;
  checkedAt: string;
}

export interface CodexOptionsResult {
  models: CodexModelOption[];
  defaultModel: string;
  defaultReasoningEffort: CodexReasoningEffort;
  claudeReasoningEfforts?: ClaudeReasoningEffort[];
  claudeApiModels?: {
    options: ClaudeApiModelOption[];
    anthropic: CodeModelDiscoveryState;
    deepseek: CodeModelDiscoveryState;
  };
  claudeSubscriptionModels?: {
    options: ClaudeSubscriptionModelOption[];
    discovery: CodeModelDiscoveryState;
  };
  modelDiscovery: {
    codex: CodeModelDiscoveryState;
  };
  defaultWorkspace: string;
  defaultSandbox: CodexSandboxMode;
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

export type AtlasNodeAction = CodexFullAccessAction | AgentApprovalAction | GitPushAction;

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

export interface AgentApprovalAction {
  kind: "agent_approval";
  label: string;
  approveLabel?: string;
  denyLabel?: string;
  provider: Extract<AiProvider, "codex" | "claude">;
  runId: string;
  requestId: string;
  approveDecision: string;
  denyDecision: string;
}

export interface AgentApprovalRecord {
  provider: Extract<AiProvider, "codex" | "claude">;
  runId: string;
  requestId: string;
  toolName: string;
  category: string;
  reason: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  approveDecision: string;
  denyDecision: string;
  createdAt: string;
  resolvedDecision?: string;
  resolvedAt?: string;
  responseDetail?: string;
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
  agentRuntimeRunId?: string;
  agentRuntimeRoute?: string;
  agentRuntimeSourceWorkspace?: string;
  agentRuntimeWorkspaceMode?: AgentWorkspaceMode;
  agentRuntimeGit?: {
    gitRoot?: string;
    repositoryName?: string;
    repositoryId?: string;
    commonGitDir?: string;
    branch?: string;
    head?: string;
    dirtyCount?: number;
  } | null;
  codexThreadId?: string;
  codexLogPath?: string;
  openClawSessionKey?: string;
  openClawLogPath?: string;
  claudeLogPath?: string;
  claudeSessionId?: string;
  sessionInfo?: AgentSessionInfo;
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
  claudeSessionId?: string;
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
  // Context-engine fields. When present the bridge prefers these over the
  // legacy `context` JSON dump; `context` stays as a slim compatibility copy.
  contextText?: string;
  chatMessages?: ChatContextMessage[];
  agentPrompt?: string;
  agentDeltaPrompt?: string;
  session?: AgentSessionInfo;
  // Local-only: route Codex / Claude Code through the streaming agent runtime
  // instead of the batch `codex exec` / `claude -p --output-format json` path.
  // The response shape is identical either way.
  useAgentRuntime?: boolean;
  // Local-only: typed evidence files already written to disk by the bridge.
  evidence?: AgentEvidenceInput[];
  // Node anchored AI runs must stay limited to the explicit node context.
  // Do not add AI Partner log, voice summary, or other global history here.
}

export interface AgentEvidenceInput {
  id: string;
  kind: string;
  displayName: string;
  localPath: string;
  mimeType: string;
  size: number;
  sourceNodeId?: string;
}

export interface ChatContextMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentSessionAction = "continue" | "fork" | "new";

export interface AgentSessionInfo {
  action: AgentSessionAction;
  resumeId?: string;
  resolvedId?: string;
  fellBack?: boolean;
  reason?: string;
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
  claudeSessionId?: string;
  sessionInfo?: AgentSessionInfo;
  /** Local-only: id of the streaming runtime run backing this result. */
  agentRuntimeRunId?: string;
  agentRuntimeRoute?: string;
  agentRuntimeWorkspace?: string;
  agentRuntimeSourceWorkspace?: string;
  agentRuntimeWorkspaceMode?: AgentWorkspaceMode;
  agentRuntimeGit?: {
    gitRoot?: string;
    repositoryName?: string;
    repositoryId?: string;
    commonGitDir?: string;
    branch?: string;
    head?: string;
    dirtyCount?: number;
  } | null;
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

export type LocalAgentRunMode = Extract<AiExecutionMode, "codex" | "claude" | "openclaw">;

export interface AgentRunInboxItem {
  id: string;
  provider: LocalAgentRunMode;
  status: "completed" | "error" | "interrupted";
  startedAt: string;
  completedAt?: string;
  clientRunId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
  workspace?: string;
  model?: string;
  prompt?: string;
  result?: AiResponseResult;
  error?: string;
}

export interface AgentRunInboxResult {
  items: AgentRunInboxItem[];
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
  processId?: number;
  uptimeSeconds?: number;
  allowedOrigin?: string;
  requestOrigin?: string;
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

export type NotificationPulseKind = "done" | "needs_review" | "error" | "codex" | "openclaw" | "claude" | "cost" | "shogiAI";

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
  id?: string;
  name: string;
  title?: string;
  size: number;
  updatedAt: string;
  visibility?: "private" | "public";
  shareToken?: string;
  fileFormat?: CloudNotebookFileFormat;
  notebookMode?: NotebookMode;
}

export interface CloudNotebookListResult {
  directory: string;
  notebooks: CloudNotebookEntry[];
  quota?: {
    usedBytes: number;
    limitBytes: number;
  };
}

export interface CloudNotebookSaveResult extends CloudNotebookEntry {
  directory: string;
  prunedCount?: number;
  quota?: {
    usedBytes: number;
    limitBytes: number;
  };
}

export interface CloudNotebookLoadResult {
  entry: CloudNotebookEntry;
  root?: AtlasNode;
  record?: NativeBoardRecordPayload;
}

export interface CloudNotebookShareResult {
  url: string;
  token: string;
  entry: CloudNotebookEntry;
  prunedCount?: number;
  quota?: {
    usedBytes: number;
    limitBytes: number;
  };
}

export interface CloudNotebookDeleteResult {
  ok: boolean;
  id: string;
  quota?: {
    usedBytes: number;
    limitBytes: number;
  };
}

export type NativeBoardRecordFormat = "kif" | "pgn" | "sgf";
export type CloudNotebookFileFormat = "mindatlas" | NativeBoardRecordFormat;

export interface NativeBoardRecordPayload {
  kind: "board-record";
  schemaVersion: 1;
  mode: Exclude<NotebookMode, "standard">;
  format: NativeBoardRecordFormat;
  title: string;
  text: string;
}

export interface ShogiSourceImportResult {
  provider: "shogi-wars" | "shogi-quest";
  datasetName: string;
  fileName: string;
  format: "csa";
  text: string;
}

/**
 * One engine answer for one position. `score.sente` is already normalized to
 * sente-positive by the service, so no consumer has to know whose turn it was.
 */
export interface ShogiAnalysisResult {
  engine: { id: string; name: string; label: string };
  analyzedAt: string;
  sfen: string;
  sideToMove: "sente" | "gote";
  movetimeMs: number;
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  terminal: boolean;
  /** The answer came from the opening book rather than from a search. */
  book: boolean;
  score: { kind: "cp" | "mate"; sente: number } | null;
  bestMove: string;
  pv: string[];
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
  // Compact markdown notebook context from the context engine. Servers that
  // understand it prefer it over the legacy `context` JSON dump.
  contextText?: string;
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
  /** Persisted on the root node so board-game notebooks reopen in their mode. */
  notebookMode?: NotebookMode;
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
  claudeSessionId?: string;
  /** Local-only workspace identity inherited down an Atlas branch. */
  agentWorkspaceBinding?: AgentWorkspaceBinding;
  /** Local-only immutable execution record for request/result nodes. */
  agentExecution?: AgentExecutionMetadata;
  /** Local-only durable record of a provider approval request and its answer. */
  agentApproval?: AgentApprovalRecord;
  usage?: AiUsage;
  action?: AtlasNodeAction;
  aiDialogSettings?: AiDialogSettings;
  /** Local-only structured content owned by an optional feature module. */
  structuredContent?: AtlasStructuredContent;
  reminderAt?: string;
  reminderFiredAt?: string;
  children: AtlasNode[];
}

export type ShogiRecordFormat = "kif" | "ki2" | "csa" | "new";

export interface ShogiRecordContent {
  kind: "shogi-record";
  schemaVersion: 1;
  role: "record-root" | "move";
  recordId: string;
  sourceFormat: ShogiRecordFormat;
  ply: number;
  sfen: string;
  usi?: string;
  specialMove?: {
    type: string;
    name?: string;
  };
  displayText?: string;
  branchIndex?: number;
  metadata?: Record<string, string>;
  /**
   * The header of the record this move came from, kept when a second record is
   * merged in. Set on the first move of each branch the merge adds, so a fork
   * can be traced back to the game it was played in. The keys are whatever the
   * importer produced, never a fixed set from one file format.
   */
  sourceRecordMetadata?: Record<string, string>;
}

export type ChessRecordFormat = "pgn" | "new";

export interface ChessRecordContent {
  kind: "chess-record";
  schemaVersion: 1;
  role: "record-root" | "move";
  recordId: string;
  sourceFormat: ChessRecordFormat;
  ply: number;
  fen: string;
  uci?: string;
  san?: string;
  displayText?: string;
  branchIndex?: number;
  nags?: number[];
  metadata?: Record<string, string>;
  /**
   * The header of the record this move came from, kept when a second record is
   * merged in. Set on the first move of each branch the merge adds, so a fork
   * can be traced back to the game it was played in. The keys are whatever the
   * importer produced, never a fixed set from one file format.
   */
  sourceRecordMetadata?: Record<string, string>;
}

export type GoRecordFormat = "sgf" | "new";

export interface GoRecordContent {
  kind: "go-record";
  schemaVersion: 1;
  role: "record-root" | "move";
  recordId: string;
  sourceFormat: GoRecordFormat;
  ply: number;
  boardSize: number;
  board: string;
  color?: "B" | "W";
  vertex?: string;
  displayText?: string;
  branchIndex?: number;
  setupBlack?: string[];
  setupWhite?: string[];
  setupEmpty?: string[];
  metadata?: Record<string, string>;
  /**
   * The header of the record this move came from, kept when a second record is
   * merged in. Set on the first move of each branch the merge adds, so a fork
   * can be traced back to the game it was played in. The keys are whatever the
   * importer produced, never a fixed set from one file format.
   */
  sourceRecordMetadata?: Record<string, string>;
}

export type AtlasStructuredContent = ShogiRecordContent | ChessRecordContent | GoRecordContent;

export interface AgentWorkspaceBinding {
  /** Legacy field name; stores the canonical bound root for either binding kind. */
  gitRoot: string;
  workspaceKind?: "git" | "directory";
  repositoryName: string;
  repositoryId?: string;
  boundAt: string;
}

export interface AgentExecutionMetadata {
  clientRunId: string;
  runtimeRunId?: string;
  route?: string;
  requestedWorkspace: string;
  resolvedWorkspace?: string;
  sourceWorkspace?: string;
  workspaceMode: AgentWorkspaceMode;
  workspaceKind?: "git" | "directory";
  gitRoot?: string;
  repositoryName?: string;
  repositoryId?: string;
  gitBranch?: string;
  gitHead?: string;
  recordedAt: string;
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

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

export type AiExecutionMode = "openai" | "local" | "codex";

export type AiContextScope = "minimal" | "focused" | "subtree" | "neighborhood";

export type AiProvider = "openai" | "openai-compatible" | "local" | "codex" | "mock";

export type AiRunStatus = "running" | "needs_review" | "error" | "done";

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
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
  attachments: Array<Pick<NodeAttachment, "id" | "name" | "kind" | "mimeType" | "size">>;
  children: AiNodeSnapshot[];
}

export interface AiNodeContext {
  selectedNode: AiNodeSnapshot;
  path: AiNodeSnapshot[];
  siblingNodes: AiNodeSnapshot[];
  descendantCount: number;
  scope: AiContextScope;
  stats: AiContextStats;
  exportedAt: string;
}

export interface AiContextStats {
  scope: AiContextScope;
  includedNodeCount: number;
  estimatedInputTokens: number;
  sections: {
    selected: number;
    path: number;
    siblings: number;
  };
}

export interface AiResponsePayload {
  prompt: string;
  context: AiNodeContext;
  provider: AiExecutionMode;
  model?: string;
}

export interface AiGeneratedOutput {
  title: string;
  body: string;
  summary: string;
  suggestedStatus: "needs_review" | "done" | "waiting";
  tags: string[];
}

export interface AiResponseResult {
  id: string;
  provider: AiProvider;
  model: string;
  output: AiGeneratedOutput;
  rawText: string;
  usage?: AiUsage;
}

export interface AiBridgeHealth {
  ok: boolean;
  bridge: string;
  openaiConfigured: boolean;
  openAiBaseUrl: string;
  openAiMode: string;
  defaultModel: string;
  realtimeModel: string;
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

export type NotificationPulseKind = "done" | "needs_review" | "error" | "codex" | "cost";

export interface NotificationPulse {
  id: string;
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
  createdAt: number;
}

export interface RealtimeSessionConfig {
  context: AiNodeContext;
  instructions?: string;
  model?: string;
  voice?: string;
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
  aiRunId?: string;
  modelId?: string;
  provider?: AiProvider;
  runMode?: AiExecutionMode;
  usage?: AiUsage;
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

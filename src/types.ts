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

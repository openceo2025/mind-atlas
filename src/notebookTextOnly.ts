import { sanitizeStructuredContentForExport } from "./notebookExport";
import type { AtlasNode, AtlasNodeKind, NotebookMode, NotebookNodeType, PlanetTexture, WorkStatus } from "./types";

const NODE_KINDS: AtlasNodeKind[] = ["root", "workArea", "artifact", "event", "concept", "thread"];
const NODE_TYPES: NotebookNodeType[] = ["human_prompt", "ai_reply", "tool_call", "tool_result", "approval_request", "note", "file_context"];
const STATUSES: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];
const TEXT_ONLY_STATUSES: WorkStatus[] = ["waiting", "done"];
const TEXTURES: PlanetTexture[] = ["speckled", "bands", "freckles", "craters", "mist", "cell"];

export function createTextOnlyNotebookRoot(root: AtlasNode): AtlasNode {
  return toTextOnlyNode(root, true);
}

export function textOnlyNotebookSizeBytes(root: AtlasNode) {
  return new TextEncoder().encode(JSON.stringify(root)).byteLength;
}

function toTextOnlyNode(node: AtlasNode, isRoot: boolean): AtlasNode {
  const now = new Date().toISOString();
  const status = STATUSES.includes(node.status) && TEXT_ONLY_STATUSES.includes(node.status) ? node.status : "waiting";
  return {
    id: boundedText(node.id, `${isRoot ? "root" : "node"}-${randomIdPart()}`, 240),
    kind: isRoot ? "root" : NODE_KINDS.includes(node.kind) ? node.kind : "thread",
    nodeType: NODE_TYPES.includes(node.nodeType) ? node.nodeType : "note",
    title: typeof node.title === "string" ? node.title : "",
    subtitle: typeof node.subtitle === "string" ? node.subtitle : "",
    body: typeof node.body === "string" ? node.body : "",
    author: node.author === "ai" || node.author === "tool" || node.author === "system" ? node.author : "human",
    status,
    color: boundedText(node.color, "#6f8cff", 80),
    texture: TEXTURES.includes(node.texture) ? node.texture : "speckled",
    radius: typeof node.radius === "number" && Number.isFinite(node.radius) && node.radius > 0 ? Math.min(240, node.radius) : isRoot ? 80 : 28,
    summary: typeof node.summary === "string" ? node.summary : "",
    nextDecision: typeof node.nextDecision === "string" ? node.nextDecision : "",
    tags: Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.slice(0, 160)).slice(0, 100) : [],
    attachments: [],
    createdAt: dateText(node.createdAt, now),
    updatedAt: dateText(node.updatedAt, now),
    ...(isVec3(node.position) ? { position: node.position } : {}),
    ...(isRoot && isBoardNotebookMode(node.notebookMode) ? { notebookMode: node.notebookMode } : {}),
    ...boardStructuredContent(node.structuredContent),
    ...(typeof node.reminderAt === "string" && node.reminderAt ? { reminderAt: node.reminderAt.slice(0, 120) } : {}),
    ...(typeof node.reminderFiredAt === "string" && node.reminderFiredAt ? { reminderFiredAt: node.reminderFiredAt.slice(0, 120) } : {}),
    children: Array.isArray(node.children) ? node.children.map((child) => toTextOnlyNode(child, false)) : [],
  };
}

function boardStructuredContent(value: unknown): Partial<Pick<AtlasNode, "structuredContent">> {
  const structuredContent = sanitizeStructuredContentForExport(value);
  return structuredContent ? { structuredContent } : {};
}

function isBoardNotebookMode(value: unknown): value is Exclude<NotebookMode, "standard"> {
  return value === "shogi" || value === "chess" || value === "go";
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function dateText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.slice(0, 120) : fallback;
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function randomIdPart() {
  try {
    return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

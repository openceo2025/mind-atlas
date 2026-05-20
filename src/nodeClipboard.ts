import { sanitizeAttachmentForExport } from "./notebookExport";
import type { AtlasNode, NodeAttachment } from "./types";

export const MIND_ATLAS_NODE_CLIPBOARD_FORMAT = "mind-atlas-node-subtree";
export const MIND_ATLAS_NODE_CLIPBOARD_VERSION = 1;

export type MindAtlasNodeClipboardPayload = {
  format: typeof MIND_ATLAS_NODE_CLIPBOARD_FORMAT;
  version: typeof MIND_ATLAS_NODE_CLIPBOARD_VERSION;
  exportedAt: string;
  source: {
    origin: string;
    nodeId: string;
    title: string;
  };
  root: AtlasNode;
};

export function createNodeClipboardText(root: AtlasNode) {
  const payload: MindAtlasNodeClipboardPayload = {
    format: MIND_ATLAS_NODE_CLIPBOARD_FORMAT,
    version: MIND_ATLAS_NODE_CLIPBOARD_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      origin: typeof window === "undefined" ? "" : window.location.origin,
      nodeId: root.id,
      title: root.title,
    },
    root: cloneNodeMetadataOnly(root),
  };

  return JSON.stringify(payload, null, 2);
}

export function parseNodeClipboardText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.format !== MIND_ATLAS_NODE_CLIPBOARD_FORMAT) return null;
  if (parsed.version !== MIND_ATLAS_NODE_CLIPBOARD_VERSION) return null;
  if (!isAtlasNodeLike(parsed.root)) return null;

  return parsed.root as AtlasNode;
}

export function nodeTreeHasAttachments(node: Pick<AtlasNode, "attachments" | "children">): boolean {
  return node.attachments.length > 0 || node.children.some((child) => nodeTreeHasAttachments(child));
}

function cloneNodeMetadataOnly(node: AtlasNode): AtlasNode {
  return {
    ...node,
    attachments: node.attachments.map(stripAttachmentAssetPath),
    children: node.children.map(cloneNodeMetadataOnly),
  };
}

function stripAttachmentAssetPath(attachment: NodeAttachment): NodeAttachment {
  const { assetPath: _assetPath, ...metadata } = sanitizeAttachmentForExport(attachment);
  return metadata;
}

function isAtlasNodeLike(value: unknown): value is AtlasNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.kind !== "string") return false;
  if (typeof value.nodeType !== "string") return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.subtitle !== "string") return false;
  if (typeof value.body !== "string") return false;
  if (typeof value.author !== "string") return false;
  if (typeof value.status !== "string") return false;
  if (typeof value.color !== "string") return false;
  if (typeof value.texture !== "string") return false;
  if (typeof value.radius !== "number") return false;
  if (typeof value.summary !== "string") return false;
  if (typeof value.nextDecision !== "string") return false;
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return false;
  if (!Array.isArray(value.attachments)) return false;
  if (!value.attachments.every(isAttachmentLike)) return false;
  if (value.position !== undefined && !isVec3(value.position)) return false;
  if (!Array.isArray(value.children)) return false;
  return value.children.every(isAtlasNodeLike);
}

function isAttachmentLike(value: unknown): value is NodeAttachment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.size === "number" &&
    typeof value.path === "string" &&
    typeof value.createdAt === "string"
  );
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

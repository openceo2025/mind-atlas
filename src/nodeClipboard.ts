import { sanitizeAttachmentForExport } from "./notebookExport";
import type { AtlasNode, NodeAttachment } from "./types";

export const MIND_ATLAS_NODE_CLIPBOARD_FORMAT = "mind-atlas-node-subtree";
export const MIND_ATLAS_NODE_CLIPBOARD_VERSION = 1;
export const MIND_ATLAS_NODE_CLIPBOARD_MIME = "web text/mind-atlas-node-subtree";

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

export async function writeNodeClipboard(root: AtlasNode, plainText: string) {
  const objectText = createNodeClipboardText(root);
  if (typeof navigator !== "undefined" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          [MIND_ATLAS_NODE_CLIPBOARD_MIME]: new Blob([objectText], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch (error) {
      console.warn("Structured Mind Atlas clipboard write failed; falling back to JSON text.", error);
    }
  }
  await writeFallbackClipboardText(objectText);
}

export async function readNodeClipboard() {
  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!item.types.includes(MIND_ATLAS_NODE_CLIPBOARD_MIME)) continue;
        const blob = await item.getType(MIND_ATLAS_NODE_CLIPBOARD_MIME);
        const parsedNode = parseNodeClipboardText(await blob.text());
        if (parsedNode) return parsedNode;
      }
    } catch {
      // Fall back to text/plain below. Some browsers require extra permission for read().
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    return parseNodeClipboardText(await navigator.clipboard.readText());
  }
  return null;
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

async function writeFallbackClipboardText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard write is not available.");
  }
}

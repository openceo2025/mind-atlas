import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import type { AtlasNode, PlanetTexture } from "./types";

const SHARE_HASH_PREFIX = "mindatlas=";
const SHARE_VERSION = 2;
const SHARE_SOFT_LIMIT_CHARS = 16_000;
const DEFAULT_CHILD_RADIUS = 28;
const DEFAULT_ROOT_RADIUS = 80;
const PLANET_TEXTURES: PlanetTexture[] = ["speckled", "bands", "freckles", "craters", "mist", "cell"];

type SharedNotebookNode = {
  t?: string;
  b?: string;
  p?: [number, number, number];
  c?: string;
  x?: PlanetTexture;
  n?: SharedNotebookNode[];
};

type SharedNotebookPayload = {
  v: typeof SHARE_VERSION;
  r: SharedNotebookNode;
};

export type SharedNotebookLinkResult = {
  url: string;
  encodedLength: number;
  payloadChars: number;
  nodeCount: number;
};

export async function createSharedNotebookLink(root: AtlasNode, currentUrl = window.location.href): Promise<SharedNotebookLinkResult> {
  const payload: SharedNotebookPayload = {
    v: SHARE_VERSION,
    r: atlasNodeToSharedNode(root),
  };
  const payloadText = JSON.stringify(payload);
  const encoded = encodeSharePayload(payloadText);
  if (encoded.length > SHARE_SOFT_LIMIT_CHARS) {
    throw new Error(
      [
        "This atlas is too large for a reliable social share URL.",
        `Encoded characters: ${encoded.length.toLocaleString()}`,
        "Use Export package or cloud save for this notebook.",
      ].join("\n"),
    );
  }

  const url = new URL(currentUrl);
  url.hash = `${SHARE_HASH_PREFIX}${encoded}`;
  return {
    url: url.toString(),
    encodedLength: encoded.length,
    payloadChars: payloadText.length,
    nodeCount: countSharedNodes(payload.r),
  };
}

export function readSharedNotebookFromUrl(urlText = window.location.href): AtlasNode | null {
  const url = new URL(urlText);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  const encoded = hash.slice(SHARE_HASH_PREFIX.length);
  if (!encoded) return null;
  const payload = decodeSharePayload(encoded);
  return sharedNodeToAtlasNode(payload.r, 0);
}

export function removeSharedNotebookHash(urlText = window.location.href) {
  const url = new URL(urlText);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return false;
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  return true;
}

function atlasNodeToSharedNode(node: AtlasNode): SharedNotebookNode {
  return {
    t: node.title || undefined,
    b: node.body || undefined,
    p: isVec3(node.position) ? node.position : undefined,
    c: node.color || undefined,
    x: PLANET_TEXTURES.includes(node.texture) ? node.texture : undefined,
    n: node.children.length ? node.children.map(atlasNodeToSharedNode) : undefined,
  };
}

function sharedNodeToAtlasNode(node: SharedNotebookNode, depth: number): AtlasNode {
  const now = new Date().toISOString();
  const id = createSharedNodeId(depth === 0 ? "root" : "note");
  const title = safeString(node.t, depth === 0 ? "Shared Mind Atlas" : "");
  const body = safeString(node.b, "");
  const color = safeColor(node.c);
  const texture = safeTexture(node.x, id);
  const children = Array.isArray(node.n) ? node.n.map((child) => sharedNodeToAtlasNode(child, depth + 1)) : [];
  return {
    id,
    kind: depth === 0 ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: depth === 0 ? title : "",
    body,
    author: "human",
    status: "waiting",
    color,
    texture,
    radius: depth === 0 ? DEFAULT_ROOT_RADIUS : DEFAULT_CHILD_RADIUS,
    summary: "",
    nextDecision: "Edit this node or branch from it.",
    tags: depth === 0 ? ["shared"] : [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    position: isVec3(node.p) ? node.p : depth === 0 ? [0, 0, 0] : undefined,
    children,
  };
}

function encodeSharePayload(payloadText: string) {
  const compressed = zlibSync(strToU8(payloadText), { level: 9 });
  return bytesToBase64Url(compressed);
}

function decodeSharePayload(encoded: string): SharedNotebookPayload {
  const bytes = base64UrlToBytes(encoded);
  const text = strFromU8(unzlibSync(bytes));
  const payload = JSON.parse(text) as SharedNotebookPayload;
  if (payload.v !== SHARE_VERSION || !isSharedNotebookNode(payload.r)) {
    throw new Error("Unsupported Mind Atlas share URL.");
  }
  return payload;
}

function isSharedNotebookNode(value: unknown): value is SharedNotebookNode {
  if (!isRecord(value)) return false;
  if ("t" in value && typeof value.t !== "string") return false;
  if ("b" in value && typeof value.b !== "string") return false;
  if ("p" in value && !isVec3(value.p)) return false;
  if ("c" in value && typeof value.c !== "string") return false;
  if ("x" in value && !PLANET_TEXTURES.includes(value.x as PlanetTexture)) return false;
  return !("n" in value) || (Array.isArray(value.n) && value.n.every(isSharedNotebookNode));
}

function createSharedNodeId(kind: string) {
  return `node-shared-${kind}-${Date.now()}-${randomIdPart()}`;
}

function randomIdPart() {
  try {
    return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function safeString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function safeColor(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "#6f8cff";
  return value.slice(0, 80);
}

function safeTexture(value: unknown, seed: string): PlanetTexture {
  if (PLANET_TEXTURES.includes(value as PlanetTexture)) return value as PlanetTexture;
  return PLANET_TEXTURES[hashText(seed) % PLANET_TEXTURES.length];
}

function countSharedNodes(node: SharedNotebookNode): number {
  return 1 + (node.n?.reduce((total, child) => total + countSharedNodes(child), 0) ?? 0);
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

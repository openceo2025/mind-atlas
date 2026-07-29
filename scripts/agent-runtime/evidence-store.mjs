// Evidence storage for multimodal agent input.
//
// Mode: local-only.
//
// Files are written once to a content-addressed local path so a provider can
// read them through a real typed transport. Nothing is base64-encoded into run
// journals, and the browser never learns anything but the local path it just
// created.

import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "application/x-ndjson"]);

export function classifyEvidence(mimeType, fileName) {
  const type = String(mimeType ?? "").toLowerCase();
  if (IMAGE_TYPES.has(type) || type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (TEXT_TYPES.has(type) || type.startsWith("text/")) return "text";
  if (/\.(log|txt)$/i.test(String(fileName ?? ""))) return "log";
  if (/\.(diff|patch)$/i.test(String(fileName ?? ""))) return "diff";
  return "artifact";
}

export class EvidenceStore {
  constructor({ baseDir, maxBytes = DEFAULT_MAX_BYTES }) {
    this.dir = resolve(baseDir);
    this.maxBytes = maxBytes;
  }

  async save({ buffer, fileName, mimeType }) {
    if (!buffer?.byteLength) throw new Error("Evidence file is empty.");
    if (buffer.byteLength > this.maxBytes) {
      throw new Error(`Evidence file is larger than the ${Math.round(this.maxBytes / 1024 / 1024)} MB local limit.`);
    }
    await mkdir(this.dir, { recursive: true });
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const safeName = String(fileName ?? "evidence")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(-80) || "evidence";
    const extension = extname(safeName) || extensionFor(mimeType);
    const storedName = `${sha256.slice(0, 16)}-${safeName.replace(/\.[^.]*$/, "")}${extension}`;
    const localPath = join(this.dir, storedName);
    // Content addressed: an identical file is written once and reused.
    const existing = await stat(localPath).catch(() => null);
    if (!existing) await writeFile(localPath, buffer);
    return {
      id: sha256.slice(0, 32),
      kind: classifyEvidence(mimeType, safeName),
      displayName: String(fileName ?? safeName).slice(0, 200),
      localPath,
      mimeType: String(mimeType ?? "application/octet-stream"),
      size: buffer.byteLength,
      sha256,
      addedAt: new Date().toISOString(),
    };
  }
}

function extensionFor(mimeType) {
  switch (String(mimeType ?? "").toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "application/pdf": return ".pdf";
    case "text/markdown": return ".md";
    case "text/plain": return ".txt";
    case "application/json": return ".json";
    default: return ".bin";
  }
}

/**
 * Decide how each evidence item can actually reach the selected provider, and
 * say so honestly. `attached` means a typed provider input carries the bytes;
 * `referenced` means only a path was given and the model must open it with a
 * tool; `unsupported` means it cannot reach the model at all.
 */
export function planEvidenceTransport(provider, capabilities, evidence) {
  const supportsImages = capabilities?.supports?.images === true;
  const canReadFiles = provider === "claude"
    ? Array.isArray(capabilities?.tools) && capabilities.tools.includes("Read")
    : true;
  return evidence.map((item) => {
    if (provider === "codex" && item.kind === "image") {
      return supportsImages
        ? { ...item, providerTransport: "localImage", status: "attached", note: "Sent as a typed Codex local image input." }
        : { ...item, providerTransport: null, status: "unsupported", note: "The selected Codex model does not accept image input." };
    }
    if (canReadFiles) {
      return {
        ...item,
        providerTransport: "pathReference",
        status: "referenced",
        note: item.kind === "image"
          ? "Only the file path was sent. The model must open it with its file-reading tool; it was not attached as a typed image."
          : "Only the file path was sent. The model must open it with its file-reading tool.",
      };
    }
    return { ...item, providerTransport: null, status: "unsupported", note: "This runtime reported no way to read local files." };
  });
}

/** A short, explicit block appended to the prompt for referenced evidence. */
export function renderEvidenceReferenceBlock(planned) {
  const referenced = planned.filter((item) => item.status === "referenced");
  if (!referenced.length) return "";
  return [
    "",
    "# Evidence files provided by Mind Atlas",
    "These files were NOT attached inline. Open them yourself if they matter:",
    ...referenced.map((item) => `- ${item.displayName} (${item.kind}, ${item.mimeType}): ${item.localPath}`),
  ].join("\n");
}

export function createEvidenceStore(options) {
  return new EvidenceStore(options);
}

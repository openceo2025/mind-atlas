import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { getStoredAttachmentBlob } from "./attachmentStorage";
import { sanitizeAttachmentForExport, sanitizeNotebookForExport } from "./notebookExport";
import type { AtlasNode, NodeAttachment } from "./types";

const PACKAGE_FORMAT = "mindatlaspkg";
const PACKAGE_VERSION = 1;
const JSON_PACKAGE_MIME_TYPE = "application/x-mindatlas-package+json";
const ZIP_PACKAGE_MIME_TYPE = "application/x-mindatlas-package";
const MANIFEST_SOFT_LIMIT_CHARS = 64 * 1024 * 1024;

type PackageAsset = {
  attachmentId: string;
  nodeId: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
};

type PackageManifest = {
  format: typeof PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  notebook: AtlasNode;
  assets: PackageAsset[];
};

export type NotebookPackageKind = "zip" | "json";

export type NotebookPackageResult = {
  blob: Blob;
  includedCount: number;
  missingCount: number;
  packageKind: NotebookPackageKind;
};

export async function createNotebookPackage(
  root: AtlasNode,
  attachmentPreviewUrls: Record<string, string>,
): Promise<NotebookPackageResult> {
  const entries: Record<string, Uint8Array> = {};
  const assets: PackageAsset[] = [];
  let missingCount = 0;

  const notebook = await cloneNodeWithAssets(root, attachmentPreviewUrls, entries, assets, (missing) => {
    missingCount += missing;
  });

  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    notebook: sanitizeNotebookForExport(notebook, { includeAttachmentAssetPaths: true }),
    assets,
  };

  if (Object.keys(entries).length === 0) {
    return createJsonPackageResult(manifest, missingCount);
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  if (manifestJson.length > MANIFEST_SOFT_LIMIT_CHARS) {
    throw new Error(createPackageDiagnosticMessage("manifest.json is too large before encoding", manifest, entries, manifestJson.length, missingCount));
  }

  try {
    entries["manifest.json"] = strToU8(manifestJson);
  } catch (error) {
    throw new Error(
      createPackageDiagnosticMessage(
        "failed while encoding manifest.json with TextEncoder",
        manifest,
        entries,
        manifestJson.length,
        missingCount,
        error,
      ),
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = zipSync(entries, { level: 0 });
  } catch (error) {
    throw new Error(createPackageDiagnosticMessage("failed while creating .mindatlaspkg zip", manifest, entries, manifestJson.length, missingCount, error));
  }

  return {
    blob: new Blob([toArrayBuffer(bytes)], { type: ZIP_PACKAGE_MIME_TYPE }),
    includedCount: assets.length,
    missingCount,
    packageKind: "zip",
  };
}

export function createNotebookJsonPackage(root: AtlasNode): NotebookPackageResult {
  const notebook = sanitizeNotebookForExport(root, { includeAttachmentAssetPaths: false });
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    notebook,
    assets: [],
  };
  return createJsonPackageResult(manifest, countNotebookAttachments(notebook));
}

export async function importNotebookPackage(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeJson(bytes)) {
    return packageManifestToImportResult(parsePackageManifest(strFromU8(bytes)));
  }

  const entries = unzipSync(bytes);
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) {
    throw new Error("manifest.json is missing from the Mind Atlas package.");
  }

  const manifest = parsePackageManifest(strFromU8(manifestBytes));

  const attachmentPreviewUrls: Record<string, string> = {};
  const attachmentBlobs: Record<string, Blob> = {};
  for (const asset of manifest.assets) {
    const bytes = entries[asset.path];
    if (!bytes) continue;
    const blob = new Blob([toArrayBuffer(bytes)], { type: asset.mimeType || "application/octet-stream" });
    attachmentBlobs[asset.attachmentId] = blob;
    attachmentPreviewUrls[asset.attachmentId] = URL.createObjectURL(blob);
  }

  return {
    root: manifest.notebook,
    attachmentPreviewUrls,
    attachmentBlobs,
  };
}

function packageManifestToImportResult(manifest: PackageManifest) {
  return {
    root: manifest.notebook,
    attachmentPreviewUrls: {} as Record<string, string>,
    attachmentBlobs: {} as Record<string, Blob>,
  };
}

async function cloneNodeWithAssets(
  node: AtlasNode,
  attachmentPreviewUrls: Record<string, string>,
  entries: Record<string, Uint8Array>,
  assets: PackageAsset[],
  addMissing: (count: number) => void,
): Promise<AtlasNode> {
  const attachments: NodeAttachment[] = [];
  for (const attachment of node.attachments) {
    const metadata = sanitizeAttachmentForExport(attachment);
    const previewUrl = attachmentPreviewUrls[metadata.id];
    const storedBlob = previewUrl ? undefined : await getStoredAttachmentBlob(metadata.id);
    if (!previewUrl && !storedBlob) {
      addMissing(1);
      attachments.push(metadata);
      continue;
    }

    try {
      let blob: Blob;
      if (storedBlob) {
        blob = storedBlob;
      } else if (previewUrl) {
        blob = await fetch(previewUrl).then((response) => response.blob());
      } else {
        throw new Error(`Attachment ${metadata.id} has no available blob.`);
      }
      const path = `assets/${safeZipSegment(metadata.id)}/${safeZipSegment(metadata.name) || "attachment"}`;
      entries[path] = new Uint8Array(await blob.arrayBuffer());
      const packagedAttachment = sanitizeAttachmentForExport(metadata, {
        mimeType: blob.type || attachment.mimeType,
        size: blob.size || attachment.size,
        assetPath: path,
      });
      attachments.push(packagedAttachment);
      assets.push({
        attachmentId: metadata.id,
        nodeId: node.id,
        path,
        name: metadata.name,
        mimeType: packagedAttachment.mimeType,
        size: packagedAttachment.size,
      });
    } catch (error) {
      console.error("Failed to package attachment", metadata.name, error);
      addMissing(1);
      attachments.push(metadata);
    }
  }

  return {
    ...node,
    attachments,
    children: await Promise.all(
      node.children.map((child) => cloneNodeWithAssets(child, attachmentPreviewUrls, entries, assets, addMissing)),
    ),
  };
}

function safeZipSegment(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 96);
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createJsonPackageResult(manifest: PackageManifest, missingCount: number): NotebookPackageResult {
  return {
    blob: new Blob([JSON.stringify({ ...manifest, assets: [] }, null, 2)], { type: JSON_PACKAGE_MIME_TYPE }),
    includedCount: 0,
    missingCount,
    packageKind: "json",
  };
}

function parsePackageManifest(text: string) {
  const manifest = JSON.parse(text) as PackageManifest;
  if (manifest.format !== PACKAGE_FORMAT || manifest.version !== PACKAGE_VERSION) {
    throw new Error("Unsupported Mind Atlas package format.");
  }
  return manifest;
}

function looksLikeJson(bytes: Uint8Array) {
  for (const byte of bytes.slice(0, 64)) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x7b;
  }
  return false;
}

function countNotebookAttachments(node: AtlasNode): number {
  return node.attachments.length + node.children.reduce((total, child) => total + countNotebookAttachments(child), 0);
}

function createPackageDiagnosticMessage(
  phase: string,
  manifest: PackageManifest,
  entries: Record<string, Uint8Array>,
  manifestChars: number,
  missingCount: number,
  cause?: unknown,
) {
  const stats = collectPackageDiagnosticStats(manifest, entries, manifestChars, missingCount);
  return [
    `Mind Atlas package export failed: ${phase}.`,
    "The package manifest was sanitized before export, so this usually means a legitimate notebook text field is extremely large or the package assets exceed browser memory.",
    "",
    "Diagnostics:",
    `- manifest characters: ${stats.manifestChars.toLocaleString()}`,
    `- nodes: ${stats.nodeCount.toLocaleString()}`,
    `- attachments in manifest: ${stats.attachmentCount.toLocaleString()}`,
    `- packaged asset files: ${stats.assetCount.toLocaleString()}`,
    `- packaged asset bytes: ${formatBytes(stats.assetBytes)}`,
    `- missing attachment blobs: ${stats.missingCount.toLocaleString()}`,
    `- largest text fields: ${stats.largestTextFields.length ? stats.largestTextFields.map(formatTextFieldStat).join("; ") : "none"}`,
    cause ? `Original error: ${cause instanceof Error ? cause.message : String(cause)}` : "",
  ].filter(Boolean).join("\n");
}

function collectPackageDiagnosticStats(
  manifest: PackageManifest,
  entries: Record<string, Uint8Array>,
  manifestChars: number,
  missingCount: number,
) {
  const largestTextFields: TextFieldStat[] = [];
  let nodeCount = 0;
  let attachmentCount = 0;

  const visit = (node: AtlasNode, path: string) => {
    nodeCount += 1;
    attachmentCount += node.attachments.length;
    addTextFieldStat(largestTextFields, path, "title", node.title);
    addTextFieldStat(largestTextFields, path, "subtitle", node.subtitle);
    addTextFieldStat(largestTextFields, path, "body", node.body);
    addTextFieldStat(largestTextFields, path, "summary", node.summary);
    addTextFieldStat(largestTextFields, path, "nextDecision", node.nextDecision);
    if (node.action?.kind === "codex_full_access") addTextFieldStat(largestTextFields, path, "action.prompt", node.action.prompt);
    node.children.forEach((child, index) => visit(child, `${path}/${index}:${child.title || child.id}`));
  };
  visit(manifest.notebook, manifest.notebook.title || manifest.notebook.id);

  const assetEntries = Object.entries(entries).filter(([path]) => path !== "manifest.json");
  return {
    manifestChars,
    nodeCount,
    attachmentCount,
    assetCount: assetEntries.length,
    assetBytes: assetEntries.reduce((total, [, bytes]) => total + bytes.byteLength, 0),
    missingCount,
    largestTextFields,
  };
}

type TextFieldStat = {
  path: string;
  field: string;
  chars: number;
};

function addTextFieldStat(stats: TextFieldStat[], path: string, field: string, value: string) {
  if (!value.length) return;
  stats.push({ path, field, chars: value.length });
  stats.sort((left, right) => right.chars - left.chars);
  stats.splice(5);
}

function formatTextFieldStat(stat: TextFieldStat) {
  return `${truncateDiagnosticText(stat.path, 48)}.${stat.field}=${stat.chars.toLocaleString()} chars`;
}

function truncateDiagnosticText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { AtlasNode, NodeAttachment } from "./types";

const PACKAGE_FORMAT = "mindatlaspkg";
const PACKAGE_VERSION = 1;

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

export async function createNotebookPackage(
  root: AtlasNode,
  attachmentPreviewUrls: Record<string, string>,
) {
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
    notebook,
    assets,
  };

  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const bytes = zipSync(entries, { level: 0 });
  return {
    blob: new Blob([toArrayBuffer(bytes)], { type: "application/x-mindatlas-package" }),
    includedCount: assets.length,
    missingCount,
  };
}

export async function importNotebookPackage(file: File) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) {
    throw new Error("manifest.json is missing from the Mind Atlas package.");
  }

  const manifest = JSON.parse(strFromU8(manifestBytes)) as PackageManifest;
  if (manifest.format !== PACKAGE_FORMAT || manifest.version !== PACKAGE_VERSION) {
    throw new Error("Unsupported Mind Atlas package format.");
  }

  const attachmentPreviewUrls: Record<string, string> = {};
  for (const asset of manifest.assets) {
    const bytes = entries[asset.path];
    if (!bytes) continue;
    const blob = new Blob([toArrayBuffer(bytes)], { type: asset.mimeType || "application/octet-stream" });
    attachmentPreviewUrls[asset.attachmentId] = URL.createObjectURL(blob);
  }

  return {
    root: manifest.notebook,
    attachmentPreviewUrls,
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
    const previewUrl = attachmentPreviewUrls[attachment.id];
    if (!previewUrl) {
      addMissing(1);
      attachments.push(attachment);
      continue;
    }

    try {
      const response = await fetch(previewUrl);
      const blob = await response.blob();
      const path = `assets/${safeZipSegment(attachment.id)}/${safeZipSegment(attachment.name) || "attachment"}`;
      entries[path] = new Uint8Array(await blob.arrayBuffer());
      const packagedAttachment = {
        ...attachment,
        mimeType: blob.type || attachment.mimeType,
        size: blob.size || attachment.size,
        assetPath: path,
      };
      attachments.push(packagedAttachment);
      assets.push({
        attachmentId: attachment.id,
        nodeId: node.id,
        path,
        name: attachment.name,
        mimeType: packagedAttachment.mimeType,
        size: packagedAttachment.size,
      });
    } catch (error) {
      console.error("Failed to package attachment", attachment.name, error);
      addMissing(1);
      attachments.push(attachment);
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

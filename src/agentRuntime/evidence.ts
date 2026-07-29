// Turns Mind Atlas node attachments into typed agent evidence.
//
// Mode: local-only.
//
// Before this existed, an attachment reached the model as metadata inside the
// context text. Now the bytes are written to a local file by the bridge and the
// provider receives them through a real typed transport (Codex `localImage`) or
// an explicit path reference the model must open itself. The bridge decides and
// reports which of the two actually happened.

import type { AtlasNode, NodeAttachment } from "../types";
import { getStoredAttachmentBlob } from "../attachmentStorage";
import { getBridgeUrl } from "../ai/bridgeClient";
import { isAgentRuntimeAvailable } from "./runtimeClient";

export interface AgentEvidenceRecord {
  id: string;
  kind: "image" | "pdf" | "text" | "log" | "source" | "diff" | "artifact";
  displayName: string;
  localPath: string;
  mimeType: string;
  size: number;
  sha256: string;
  addedAt: string;
  sourceNodeId?: string;
}

const MAX_EVIDENCE_ITEMS = 8;
const SUPPORTED_KINDS = new Set(["image", "pdf"]);

/** Attachments on the active node and its ancestors, newest node first. */
export function collectEvidenceCandidates(root: AtlasNode, nodeId: string) {
  const path = findNodePath(root, nodeId);
  if (!path.length) return [];
  const candidates: Array<{ attachment: NodeAttachment; nodeId: string }> = [];
  for (const node of [...path].reverse()) {
    for (const attachment of node.attachments ?? []) {
      const kind = normalizeKind(attachment);
      if (!SUPPORTED_KINDS.has(kind)) continue;
      candidates.push({ attachment, nodeId: node.id });
      if (candidates.length >= MAX_EVIDENCE_ITEMS) return candidates;
    }
  }
  return candidates;
}

/**
 * Materialize candidates through the bridge. Failures are skipped rather than
 * failing the run, and the caller only ever sees items that really exist on
 * disk.
 */
export async function materializeEvidence(
  root: AtlasNode,
  nodeId: string,
): Promise<AgentEvidenceRecord[]> {
  if (!isAgentRuntimeAvailable()) return [];
  const candidates = collectEvidenceCandidates(root, nodeId);
  if (!candidates.length) return [];
  const records: AgentEvidenceRecord[] = [];
  for (const candidate of candidates) {
    try {
      const blob = await getStoredAttachmentBlob(candidate.attachment.id);
      if (!blob) continue;
      const uploaded = await uploadAgentEvidence(blob, candidate.attachment.name, candidate.attachment.mimeType);
      records.push({ ...uploaded, sourceNodeId: candidate.nodeId });
    } catch {
      // An unreadable attachment must never block the run.
    }
  }
  return records;
}

export async function uploadAgentEvidence(blob: Blob, fileName: string, mimeType?: string) {
  if (!isAgentRuntimeAvailable()) throw new Error("Local agent evidence is not available in hosted public mode.");
  const formData = new FormData();
  const typed = mimeType && blob.type !== mimeType ? new Blob([blob], { type: mimeType }) : blob;
  formData.set("file", typed, fileName);
  const response = await fetch(`${getBridgeUrl()}/api/agent-evidence`, { method: "POST", body: formData });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("The bridge returned malformed JSON for an evidence upload.");
  }
  if (!response.ok) {
    throw new Error((data as { error?: string })?.error ?? `Evidence upload failed with ${response.status}`);
  }
  return data as AgentEvidenceRecord;
}

function normalizeKind(attachment: NodeAttachment) {
  const mime = String(attachment.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (attachment.kind === "image") return "image";
  return "artifact";
}

function findNodePath(root: AtlasNode, nodeId: string): AtlasNode[] {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const found = findNodePath(child, nodeId);
    if (found.length) return [root, ...found];
  }
  return [];
}

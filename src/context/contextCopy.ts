import type { ContextAssemblyResult, ContextAssemblyStats } from "./contextAssembly";
import type { AtlasNode } from "../types";

export type ContextCopyPreset = "node" | "ancestors" | "subtree";

export const CONTEXT_COPY_PRESETS: Array<{ id: ContextCopyPreset; label: string }> = [
  { id: "node", label: "Node only" },
  { id: "ancestors", label: "With ancestors" },
  { id: "subtree", label: "With subtree" },
];

export function buildContextCopy(root: AtlasNode, nodeId: string, preset: ContextCopyPreset): ContextAssemblyResult | null {
  const path = findNodePath(root, nodeId);
  if (!path) return null;
  const selectedNode = path[path.length - 1];
  const ancestorNodes = preset === "node" ? [] : path.slice(0, -1);
  const targetNodes = preset === "subtree" ? collectSubtreeNodes(selectedNode) : [{ node: selectedNode, depth: 0 }];
  const lines = [
    "# Mind Atlas Context",
    "",
    `preset: ${preset}`,
    `selected: ${selectedNode.title || selectedNode.id}`,
    "",
    "## Ancestor Context",
    ...(ancestorNodes.length ? ancestorNodes.map((node, index) => formatNodeLine(node, index)) : ["- none"]),
    "",
    preset === "subtree" ? "## Target Subtree" : "## Target Node",
    ...targetNodes.map(({ node, depth }) => formatNodeLine(node, depth)),
  ];
  const markdown = lines.join("\n").trimEnd();
  const includedNodeIds = uniqueIds([...ancestorNodes.map((node) => node.id), ...targetNodes.map(({ node }) => node.id)]);
  const stats: ContextAssemblyStats = {
    scope: preset === "subtree" ? "subtree" : "custom",
    characterCount: markdown.length,
    estimatedTokens: estimateTokens(markdown),
    includedNodeCount: includedNodeIds.length,
    omittedNodeCount: 0,
    truncated: false,
    sections: {
      ancestorChain: ancestorNodes.length,
      siblingTitles: 0,
      subtree: targetNodes.length,
      selectedNodes: 0,
    },
  };
  return {
    markdown,
    stats,
    includedNodeIds,
    omittedNodeIds: [],
  };
}

function findNodePath(root: AtlasNode, nodeId: string): AtlasNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const path = findNodePath(child, nodeId);
    if (path) return [root, ...path];
  }
  return null;
}

function collectSubtreeNodes(node: AtlasNode, depth = 0): Array<{ node: AtlasNode; depth: number }> {
  return [{ node, depth }, ...node.children.flatMap((child) => collectSubtreeNodes(child, depth + 1))];
}

function formatNodeLine(node: AtlasNode, depth: number) {
  const indent = "  ".repeat(depth);
  const parts = [`${indent}- ${singleLine(node.title || "Untitled")} (${node.id})`];
  const metadata = [`status=${node.status}`, `type=${node.nodeType}`];
  if (node.tags.length) metadata.push(`tags=${node.tags.join(",")}`);
  if (node.attachments.length) metadata.push(`attachments=${node.attachments.map((attachment) => `${attachment.name}:${attachment.kind}`).join(",")}`);
  parts.push(`${indent}  meta: ${metadata.join("; ")}`);
  const summary = node.summary?.trim();
  const body = node.body?.trim();
  if (summary) parts.push(`${indent}  summary: ${singleLine(summary)}`);
  if (body && body !== summary) parts.push(`${indent}  body: ${singleLine(body)}`);
  return parts.join("\n");
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function estimateTokens(markdown: string) {
  return Math.ceil(markdown.length / 3.8);
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export async function copyContextMarkdown(root: AtlasNode, nodeId: string, preset: ContextCopyPreset) {
  const result = buildContextCopy(root, nodeId, preset);
  if (!result) throw new Error("Context could not be assembled.");
  await writeClipboardText(result.markdown);
  return result;
}

export function formatContextCopyStats(result: ContextAssemblyResult | null) {
  if (!result) return "No context";
  const truncated = result.stats.truncated ? " / truncated" : "";
  return `${result.stats.estimatedTokens.toLocaleString()} tokens / ${result.stats.includedNodeCount} nodes${truncated}`;
}

async function writeClipboardText(text: string) {
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
  if (!copied) throw new Error("Clipboard write is not available.");
}

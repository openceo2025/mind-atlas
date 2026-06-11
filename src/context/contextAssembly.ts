import type { AiAttachmentMode, AiContextOptions, AiContextScope, AtlasNode } from "../types";

export interface ContextAssemblyOptions extends Partial<AiContextOptions> {
  scope?: AiContextScope;
  maxCharacters?: number;
  includeMetadata?: boolean;
}

export interface ContextAssemblyResult {
  markdown: string;
  stats: ContextAssemblyStats;
  includedNodeIds: string[];
  omittedNodeIds: string[];
}

export interface ContextAssemblyStats {
  scope: AiContextScope;
  characterCount: number;
  estimatedTokens: number;
  includedNodeCount: number;
  omittedNodeCount: number;
  truncated: boolean;
  sections: {
    ancestorChain: number;
    siblingTitles: number;
    subtree: number;
    selectedNodes: number;
  };
}

interface ContextNode {
  node: AtlasNode;
  depth: number;
}

const DEFAULT_CONTEXT_OPTIONS: Required<Pick<ContextAssemblyOptions, "scope" | "ancestorDepth" | "descendantDepth" | "lateralRadius" | "attachmentMode" | "maxAttachmentCount" | "maxAttachmentBytes" | "selectedNodeIds" | "maxCharacters" | "includeMetadata">> = {
  scope: "focused",
  ancestorDepth: 2,
  descendantDepth: 2,
  lateralRadius: 1,
  attachmentMode: "metadata",
  maxAttachmentCount: 20,
  maxAttachmentBytes: 2 * 1024 * 1024,
  selectedNodeIds: [],
  maxCharacters: 24000,
  includeMetadata: true,
};

export function assembleAtlasContextMarkdown(
  root: AtlasNode,
  selectedNodeId: string,
  optionsInput: AiContextScope | ContextAssemblyOptions = "focused",
): ContextAssemblyResult | null {
  const options = normalizeContextAssemblyOptions(optionsInput);
  const path = findNodePath(root, selectedNodeId);
  if (!path) return null;

  const selectedNode = path[path.length - 1];
  const ancestorChain = selectAncestorChain(path, options);
  const siblingGroups = selectSiblingGroups(path, options);
  const subtreeNodes = selectSubtreeNodes(selectedNode, options);
  const selectedNodes = options.scope === "selected"
    ? options.selectedNodeIds
        .filter((id) => id !== selectedNodeId)
        .map((id) => findNode(root, id))
        .filter((node): node is AtlasNode => Boolean(node))
    : [];

  const sections: string[] = [
    "# Mind Atlas Context",
    "",
    `scope: ${options.scope}`,
    `selected: ${selectedNode.title || selectedNode.id}`,
    "",
    "## Ancestor Chain",
    ...formatAncestorChain(ancestorChain),
    "",
    "## Sibling Titles",
    ...formatSiblingGroups(siblingGroups),
    "",
    "## Target Subtree",
    ...formatSubtree(subtreeNodes),
  ];

  if (selectedNodes.length) {
    sections.push("", "## Additional Selected Nodes", ...selectedNodes.flatMap((node) => formatNodeBlock(node, 0)));
  }

  const includedNodeIds = uniqueIds([
    ...ancestorChain.map((node) => node.id),
    ...siblingGroups.flatMap((group) => group.siblings.map((node) => node.id)),
    ...subtreeNodes.map((entry) => entry.node.id),
    ...selectedNodes.map((node) => node.id),
  ]);
  const fullMarkdown = sections.join("\n").trimEnd();
  const limited = applyCharacterLimit(fullMarkdown, includedNodeIds, options.maxCharacters);
  const omittedNodeIds = limited.omittedNodeIds;
  const markdown = limited.markdown;

  return {
    markdown,
    includedNodeIds: includedNodeIds.filter((id) => !omittedNodeIds.includes(id)),
    omittedNodeIds,
    stats: {
      scope: options.scope,
      characterCount: markdown.length,
      estimatedTokens: estimateTokens(markdown),
      includedNodeCount: includedNodeIds.length - omittedNodeIds.length,
      omittedNodeCount: omittedNodeIds.length,
      truncated: omittedNodeIds.length > 0 || markdown.length < fullMarkdown.length,
      sections: {
        ancestorChain: ancestorChain.length,
        siblingTitles: siblingGroups.reduce((count, group) => count + group.siblings.length, 0),
        subtree: subtreeNodes.length,
        selectedNodes: selectedNodes.length,
      },
    },
  };
}

export function normalizeContextAssemblyOptions(optionsInput: AiContextScope | ContextAssemblyOptions = "focused"): Required<ContextAssemblyOptions> {
  const input = typeof optionsInput === "string" ? { scope: optionsInput } : optionsInput;
  return {
    ...DEFAULT_CONTEXT_OPTIONS,
    ...input,
    scope: input.scope ?? DEFAULT_CONTEXT_OPTIONS.scope,
    ancestorDepth: clampInteger(input.ancestorDepth ?? DEFAULT_CONTEXT_OPTIONS.ancestorDepth, 0, 20),
    descendantDepth: clampInteger(input.descendantDepth ?? DEFAULT_CONTEXT_OPTIONS.descendantDepth, 0, 20),
    lateralRadius: clampInteger(input.lateralRadius ?? DEFAULT_CONTEXT_OPTIONS.lateralRadius, 0, 10),
    attachmentMode: normalizeAttachmentMode(input.attachmentMode),
    maxAttachmentCount: clampInteger(input.maxAttachmentCount ?? DEFAULT_CONTEXT_OPTIONS.maxAttachmentCount, 0, 100),
    maxAttachmentBytes: clampInteger(input.maxAttachmentBytes ?? DEFAULT_CONTEXT_OPTIONS.maxAttachmentBytes, 0, 100 * 1024 * 1024),
    selectedNodeIds: uniqueIds(input.selectedNodeIds ?? DEFAULT_CONTEXT_OPTIONS.selectedNodeIds),
    maxCharacters: clampInteger(input.maxCharacters ?? DEFAULT_CONTEXT_OPTIONS.maxCharacters, 200, 200000),
    includeMetadata: input.includeMetadata ?? DEFAULT_CONTEXT_OPTIONS.includeMetadata,
  };
}

function selectAncestorChain(path: AtlasNode[], options: Required<ContextAssemblyOptions>) {
  if (options.scope === "selected") return [];
  if (options.scope === "minimal") return path.slice(-1);
  if (options.scope === "custom") return path.slice(Math.max(0, path.length - options.ancestorDepth - 1));
  return path;
}

function selectSiblingGroups(path: AtlasNode[], options: Required<ContextAssemblyOptions>) {
  if (options.scope !== "neighborhood" && options.scope !== "custom") return [];
  const groups: Array<{ parent: AtlasNode; siblings: AtlasNode[] }> = [];
  const maxGroups = options.scope === "custom" ? options.lateralRadius : 1;
  for (let pathIndex = Math.max(1, path.length - maxGroups); pathIndex < path.length; pathIndex += 1) {
    const parent = path[pathIndex - 1];
    const current = path[pathIndex];
    const siblings = parent.children.filter((node) => node.id !== current.id);
    if (siblings.length) groups.push({ parent, siblings });
  }
  return groups;
}

function selectSubtreeNodes(selectedNode: AtlasNode, options: Required<ContextAssemblyOptions>): ContextNode[] {
  const depth = selectedDepth(options);
  const nodes: ContextNode[] = [];
  visitSubtree(selectedNode, 0, depth, nodes);
  return nodes;
}

function selectedDepth(options: Required<ContextAssemblyOptions>) {
  switch (options.scope) {
    case "minimal":
    case "selected":
      return 0;
    case "focused":
      return 1;
    case "neighborhood":
      return 2;
    case "subtree":
      return Number.MAX_SAFE_INTEGER;
    case "custom":
      return options.descendantDepth;
  }
}

function visitSubtree(node: AtlasNode, depth: number, maxDepth: number, nodes: ContextNode[]) {
  nodes.push({ node, depth });
  if (depth >= maxDepth) return;
  node.children.forEach((child) => visitSubtree(child, depth + 1, maxDepth, nodes));
}

function formatAncestorChain(nodes: AtlasNode[]) {
  if (!nodes.length) return ["- none"];
  return nodes.map((node, index) => `${"  ".repeat(index)}- ${formatTitle(node)}`);
}

function formatSiblingGroups(groups: Array<{ parent: AtlasNode; siblings: AtlasNode[] }>) {
  if (!groups.length) return ["- none"];
  return groups.flatMap((group) => [
    `- under ${formatTitle(group.parent)}:`,
    ...group.siblings.map((node) => `  - ${formatTitle(node)}`),
  ]);
}

function formatSubtree(nodes: ContextNode[]) {
  if (!nodes.length) return ["- none"];
  return nodes.flatMap(({ node, depth }) => formatNodeBlock(node, depth));
}

function formatNodeBlock(node: AtlasNode, depth: number) {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}- ${formatTitle(node)}`];
  const summary = node.summary?.trim();
  const body = node.body?.trim();
  if (summary) lines.push(`${indent}  summary: ${singleLine(summary)}`);
  if (body && body !== summary) lines.push(`${indent}  body: ${singleLine(body)}`);
  return lines;
}

function applyCharacterLimit(markdown: string, includedNodeIds: string[], maxCharacters: number) {
  if (markdown.length <= maxCharacters) return { markdown, omittedNodeIds: [] as string[] };
  const omittedNodeIds: string[] = [];
  const marker = "\n\n## Overflow\nDeepest context was omitted to stay within the character budget.";
  let next = markdown;
  for (let index = includedNodeIds.length - 1; index >= 0 && next.length + marker.length > maxCharacters; index -= 1) {
    omittedNodeIds.push(includedNodeIds[index]);
    const escaped = escapeRegExp(includedNodeIds[index]);
    next = next.replace(new RegExp(`\\n?[^\\n]*\\(${escaped}\\)[\\s\\S]*?(?=\\n\\s*- |\\n## |$)`, "g"), "");
  }
  if (next.length + marker.length > maxCharacters) {
    next = `${next.slice(0, Math.max(0, maxCharacters - marker.length - 16)).trimEnd()}\n[truncated]`;
  }
  return { markdown: `${next.trimEnd()}${marker}`, omittedNodeIds };
}

function findNodePath(root: AtlasNode, id: string): AtlasNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const path = findNodePath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}

function findNode(root: AtlasNode, id: string): AtlasNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

function formatTitle(node: AtlasNode) {
  return `${singleLine(node.title || "Untitled")} (${node.id})`;
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function estimateTokens(markdown: string) {
  return Math.ceil(markdown.length / 3.8);
}

function normalizeAttachmentMode(mode: AiAttachmentMode | undefined): AiAttachmentMode {
  return mode === "content" ? "content" : "metadata";
}

function clampInteger(value: number, min: number, max: number) {
  const number = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, number));
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

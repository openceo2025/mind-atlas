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

type ContextSection = "ancestorChain" | "siblingTitles" | "subtree" | "selectedNodes";

interface ContextBlock {
  section: ContextSection;
  lines: string[];
  depth: number;
  nodeId?: string;
  removable: boolean;
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

  const blocks = buildContextBlocks({
    options,
    selectedNode,
    ancestorChain,
    siblingGroups,
    subtreeNodes,
    selectedNodes,
  });
  const limited = applyCharacterLimit(blocks, options.maxCharacters);
  const markdown = renderMarkdown(limited.blocks, options.scope, selectedNode, limited.omittedNodeIds.length > 0);
  const includedNodeIds = uniqueIds(limited.blocks.map((block) => block.nodeId).filter((id): id is string => Boolean(id)));

  return {
    markdown,
    includedNodeIds,
    omittedNodeIds: limited.omittedNodeIds,
    stats: {
      scope: options.scope,
      characterCount: markdown.length,
      estimatedTokens: estimateTokens(markdown),
      includedNodeCount: includedNodeIds.length,
      omittedNodeCount: limited.omittedNodeIds.length,
      truncated: limited.omittedNodeIds.length > 0,
      sections: {
        ancestorChain: countSectionBlocks(limited.blocks, "ancestorChain"),
        siblingTitles: countSectionBlocks(limited.blocks, "siblingTitles"),
        subtree: countSectionBlocks(limited.blocks, "subtree"),
        selectedNodes: countSectionBlocks(limited.blocks, "selectedNodes"),
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

function buildContextBlocks({
  options,
  ancestorChain,
  siblingGroups,
  subtreeNodes,
  selectedNodes,
}: {
  options: Required<ContextAssemblyOptions>;
  selectedNode: AtlasNode;
  ancestorChain: AtlasNode[];
  siblingGroups: Array<{ parent: AtlasNode; siblings: AtlasNode[] }>;
  subtreeNodes: ContextNode[];
  selectedNodes: AtlasNode[];
}): ContextBlock[] {
  return [
    ...ancestorChain.map((node, index) => nodeBlock("ancestorChain", node, index, options, false)),
    ...siblingGroups.flatMap((group) => [
      {
        section: "siblingTitles" as const,
        lines: [`- under ${formatTitle(group.parent)}:`],
        depth: 0,
        removable: false,
      },
      ...group.siblings.map((node) => nodeBlock("siblingTitles", node, 1, options, true)),
    ]),
    ...subtreeNodes.map(({ node, depth }) => nodeBlock("subtree", node, depth, options, depth > 0)),
    ...selectedNodes.map((node) => nodeBlock("selectedNodes", node, 0, options, true)),
  ];
}

function nodeBlock(section: ContextSection, node: AtlasNode, depth: number, options: Required<ContextAssemblyOptions>, removable: boolean): ContextBlock {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}- ${formatTitle(node)}`];
  const metadata = formatNodeMetadata(node, options);
  const summary = node.summary?.trim();
  const body = node.body?.trim();
  if (metadata) lines.push(`${indent}  meta: ${metadata}`);
  if (summary) lines.push(`${indent}  summary: ${singleLine(summary)}`);
  if (body && body !== summary) lines.push(`${indent}  body: ${singleLine(body)}`);
  return { section, lines, depth, nodeId: node.id, removable };
}

function renderMarkdown(blocks: ContextBlock[], scope: AiContextScope, selectedNode: AtlasNode, truncated: boolean) {
  const lines = [
    "# Mind Atlas Context",
    "",
    `scope: ${scope}`,
    `selected: ${selectedNode.title || selectedNode.id}`,
    "",
    "## Ancestor Chain",
    ...sectionLines(blocks, "ancestorChain"),
    "",
    "## Sibling Titles",
    ...sectionLines(blocks, "siblingTitles"),
    "",
    "## Target Subtree",
    ...sectionLines(blocks, "subtree"),
  ];

  if (blocks.some((block) => block.section === "selectedNodes")) {
    lines.push("", "## Additional Selected Nodes", ...sectionLines(blocks, "selectedNodes"));
  }
  if (truncated) {
    lines.push("", "## Overflow", "Deepest context was omitted to stay within the character budget.");
  }
  return lines.join("\n").trimEnd();
}

function applyCharacterLimit(blocks: ContextBlock[], maxCharacters: number) {
  let nextBlocks = [...blocks];
  const omittedNodeIds: string[] = [];
  while (renderBlocksLength(nextBlocks, omittedNodeIds.length > 0) > maxCharacters) {
    const removableIndex = findDeepestRemovableBlockIndex(nextBlocks);
    if (removableIndex < 0) break;
    const [removed] = nextBlocks.splice(removableIndex, 1);
    if (removed.nodeId) omittedNodeIds.push(removed.nodeId);
  }
  if (renderBlocksLength(nextBlocks, omittedNodeIds.length > 0) > maxCharacters) {
    let removableIndex = -1;
    for (let index = nextBlocks.length - 1; index >= 0; index -= 1) {
      if (nextBlocks[index].removable || nextBlocks[index].section === "subtree") {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex >= 0) {
      const removed = nextBlocks.splice(removableIndex, 1)[0];
      if (removed.nodeId) omittedNodeIds.push(removed.nodeId);
    }
  }
  return { blocks: nextBlocks, omittedNodeIds: uniqueIds(omittedNodeIds) };
}

function renderBlocksLength(blocks: ContextBlock[], truncated: boolean) {
  return blocks.reduce((total, block) => total + block.lines.join("\n").length + 1, 120) + (truncated ? 78 : 0);
}

function findDeepestRemovableBlockIndex(blocks: ContextBlock[]) {
  let bestIndex = -1;
  let bestDepth = -1;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block.removable) continue;
    if (block.depth >= bestDepth) {
      bestIndex = index;
      bestDepth = block.depth;
    }
  }
  return bestIndex;
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

function sectionLines(blocks: ContextBlock[], section: ContextSection) {
  const lines = blocks.filter((block) => block.section === section).flatMap((block) => block.lines);
  return lines.length ? lines : ["- none"];
}

function countSectionBlocks(blocks: ContextBlock[], section: ContextSection) {
  return blocks.filter((block) => block.section === section && block.nodeId).length;
}

function formatNodeMetadata(node: AtlasNode, options: Required<ContextAssemblyOptions>) {
  if (!options.includeMetadata) return "";
  const values = [`status=${node.status}`, `type=${node.nodeType}`];
  if (node.tags.length) values.push(`tags=${node.tags.join(",")}`);
  const attachments = node.attachments
    .filter((attachment) => attachment.size <= options.maxAttachmentBytes)
    .slice(0, options.maxAttachmentCount);
  if (options.attachmentMode === "metadata" && attachments.length) {
    values.push(`attachments=${attachments.map((attachment) => `${attachment.name}:${attachment.kind}`).join(",")}`);
  }
  return values.join("; ");
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

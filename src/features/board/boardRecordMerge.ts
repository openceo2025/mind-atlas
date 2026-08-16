import type { AtlasNode, AtlasStructuredContent, NotebookMode } from "../../types";
import { isBoardNotebookMode, type BoardNotebookMode } from "./boardRecord.ts";

export interface BoardRecordMergeResult {
  root: AtlasNode;
  matchedNodes: number;
  addedBranches: number;
  mergedTextNodes: number;
  lastAddedNodeId: string | null;
}

export function mergeBoardRecords(destination: AtlasNode, source: AtlasNode): BoardRecordMergeResult {
  const destinationMode = boardMode(destination.notebookMode);
  const sourceMode = boardMode(source.notebookMode);
  if (!destinationMode || !sourceMode || destinationMode !== sourceMode) {
    throw new Error("Only records from the same game type can be merged.");
  }

  const target = structuredClone(destination);
  const targetRecordRoot = findRecordRoot(target, destinationMode);
  const sourceRecordRoot = findRecordRoot(source, sourceMode);
  if (!targetRecordRoot || !sourceRecordRoot) throw new Error("A record root could not be found.");
  assertSameGame(targetRecordRoot, sourceRecordRoot, destinationMode);

  const state = { matchedNodes: 1, addedBranches: 0, mergedTextNodes: 0, lastAddedNodeId: null as string | null };
  // Keep the notebook user's record title stable; imported source names are
  // metadata, not a new title to append on every merge.
  mergeNodeText(targetRecordRoot, sourceRecordRoot, destinationMode, state, { preserveDestinationTitle: true });
  mergeMetadata(targetRecordRoot, sourceRecordRoot);
  const recordId = targetRecordRoot.structuredContent?.recordId;
  if (!recordId) throw new Error("The destination record id is missing.");
  mergeChildren(targetRecordRoot, sourceRecordRoot, destinationMode, recordId, state);
  target.updatedAt = new Date().toISOString();

  return { root: target, ...state };
}

function mergeChildren(
  targetParent: AtlasNode,
  sourceParent: AtlasNode,
  mode: BoardNotebookMode,
  recordId: string,
  state: Omit<BoardRecordMergeResult, "root">,
) {
  const targetMoveChildren = targetParent.children.filter((node) => isMoveNode(node, mode));
  for (const sourceChild of sourceParent.children.filter((node) => isMoveNode(node, mode))) {
    const key = positionKey(sourceChild, mode);
    const match = key ? targetMoveChildren.find((node) => positionKey(node, mode) === key) : undefined;
    if (match) {
      state.matchedNodes += 1;
      mergeNodeText(match, sourceChild, mode, state);
      mergeChildren(match, sourceChild, mode, recordId, state);
      continue;
    }
    const clone = cloneRecordSubtree(sourceChild, targetParent.id, recordId, targetMoveChildren.length);
    targetParent.children.push(clone);
    targetMoveChildren.push(clone);
    state.addedBranches += 1;
    state.lastAddedNodeId = findRecordTail(clone, mode).id;
  }
  targetParent.children.forEach((child, branchIndex) => {
    if (isMoveNode(child, mode) && child.structuredContent) child.structuredContent.branchIndex = branchIndex;
  });
}

function cloneRecordSubtree(source: AtlasNode, parentId: string, recordId: string, branchIndex: number): AtlasNode {
  const id = `node-board-merge-${crypto.randomUUID()}`;
  const structuredContent = source.structuredContent
    ? { ...source.structuredContent, recordId, branchIndex } as AtlasStructuredContent
    : undefined;
  const clone: AtlasNode = {
    ...structuredClone(source),
    id,
    sourceParentId: parentId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(structuredContent ? { structuredContent } : {}),
    children: [],
  };
  clone.children = source.children.map((child, index) => cloneRecordSubtree(child, id, recordId, index));
  return clone;
}

function assertSameGame(destination: AtlasNode, source: AtlasNode, mode: BoardNotebookMode) {
  if (positionKey(destination, mode) !== positionKey(source, mode)) {
    throw new Error("The records start from different positions and cannot be merged.");
  }
}

function mergeMetadata(destination: AtlasNode, source: AtlasNode) {
  if (!destination.structuredContent || !source.structuredContent) return;
  destination.structuredContent.metadata = {
    ...(source.structuredContent.metadata ?? {}),
    ...(destination.structuredContent.metadata ?? {}),
  };
}

function mergeNodeText(
  destination: AtlasNode,
  source: AtlasNode,
  mode: BoardNotebookMode,
  state: Pick<BoardRecordMergeResult, "mergedTextNodes">,
  options: { preserveDestinationTitle?: boolean } = {},
) {
  const title = options.preserveDestinationTitle
    ? destination.title
    : mergeTitle(destination, source, mode);
  const body = mergeBody(destination.body, source.body);
  if (title === destination.title && body === destination.body) return;
  destination.title = title;
  destination.body = body;
  destination.summary = body || title;
  destination.updatedAt = new Date().toISOString();
  state.mergedTextNodes += 1;
}

export function mergeBoardRecordTitle(destination: string, source: string) {
  return mergeSimpleTitle(destination, source);
}

export function mergeBoardRecordBody(destination: string, source: string) {
  return mergeBody(destination, source);
}

function mergeTitle(destinationNode: AtlasNode, sourceNode: AtlasNode, mode: BoardNotebookMode) {
  const destination = String(destinationNode.title ?? "").trim();
  const source = String(sourceNode.title ?? "").trim();
  const destinationDefault = isGeneratedBoardTitle(destinationNode, mode);
  const sourceDefault = isGeneratedBoardTitle(sourceNode, mode);
  if (destinationDefault && sourceDefault) return destination || source;
  if (destinationDefault && !sourceDefault) return source || destination;
  if (!destinationDefault && sourceDefault) return destination || source;

  return mergeSimpleTitle(destination, source);
}

function isGeneratedBoardTitle(node: AtlasNode, mode: BoardNotebookMode) {
  const content = node.structuredContent;
  if (!content || content.kind !== `${mode}-record`) return false;
  if (content.role === "record-root") return true;
  const generated = String(content.displayText ?? "").trim();
  if (generated && normalizeTitle(generated) === normalizeTitle(node.title)) return true;
  return normalizeTitle(node.title) === normalizeTitle(`Move ${content.ply}`);
}

function normalizeTitle(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function mergeSimpleTitle(destination: string, source: string) {
  const parts: string[] = [];
  for (const value of [destination, source]) {
    for (const part of String(value ?? "").split(/\s+\/\s+/)) {
      const normalized = part.trim();
      if (normalized && !parts.includes(normalized)) parts.push(normalized);
    }
  }
  return parts.join(" / ");
}

function mergeBody(destination: string, source: string) {
  const lines: string[] = [];
  for (const value of [destination, source]) {
    for (const line of String(value ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      const normalized = line.trim();
      if (normalized && !lines.includes(normalized)) lines.push(normalized);
    }
  }
  return lines.join("\n");
}

function positionKey(node: AtlasNode, mode: BoardNotebookMode) {
  const content = node.structuredContent;
  if (mode === "shogi" && content?.kind === "shogi-record") {
    return content.sfen.trim().split(/\s+/).slice(0, 3).join(" ");
  }
  if (mode === "chess" && content?.kind === "chess-record") {
    return content.fen.trim().split(/\s+/).slice(0, 4).join(" ");
  }
  if (mode === "go" && content?.kind === "go-record") {
    return `${content.boardSize}:${content.board}:${content.role === "move" ? content.color ?? "" : content.metadata?.PL ?? "B"}`;
  }
  return "";
}

function findRecordRoot(root: AtlasNode, mode: BoardNotebookMode): AtlasNode | null {
  if (isRecordRoot(root, mode)) return root;
  for (const child of root.children) {
    const found = findRecordRoot(child, mode);
    if (found) return found;
  }
  return null;
}

function isRecordRoot(node: AtlasNode, mode: BoardNotebookMode) {
  return node.structuredContent?.kind === `${mode}-record` && node.structuredContent.role === "record-root";
}

function isMoveNode(node: AtlasNode, mode: BoardNotebookMode) {
  return node.structuredContent?.kind === `${mode}-record` && node.structuredContent.role === "move";
}

function findRecordTail(node: AtlasNode, mode: BoardNotebookMode): AtlasNode {
  const moveChildren = node.children.filter((child) => isMoveNode(child, mode));
  if (!moveChildren.length) return node;
  return moveChildren.reduce((tail, child) => {
    const candidate = findRecordTail(child, mode);
    const tailPly = recordPly(tail);
    const candidatePly = recordPly(candidate);
    return candidatePly >= tailPly ? candidate : tail;
  }, moveChildren[0]);
}

function recordPly(node: AtlasNode) {
  const content = node.structuredContent;
  return content && "ply" in content && typeof content.ply === "number" ? content.ply : -1;
}

function boardMode(value: NotebookMode | undefined) {
  return isBoardNotebookMode(value) ? value : null;
}

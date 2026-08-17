import type { AtlasNode, AtlasStructuredContent, NotebookMode } from "../../types";
import { isBoardNotebookMode, type BoardNotebookMode } from "./boardRecord.ts";

export interface BoardRecordMergeResult {
  root: AtlasNode;
  matchedNodes: number;
  addedBranches: number;
  mergedTextNodes: number;
  lastAddedNodeId: string | null;
  anchor: BoardRecordMergeAnchor;
}

export type BoardRecordMergeStrategy = "record-root" | "deepest-common-position";

export interface BoardRecordMergeOptions {
  strategy?: BoardRecordMergeStrategy;
}

export interface BoardRecordMergeAnchor {
  strategy: BoardRecordMergeStrategy;
  destinationNodeId: string;
  sourceNodeId: string;
  destinationPly: number;
  sourcePly: number;
}

type MergeState = Pick<BoardRecordMergeResult, "matchedNodes" | "addedBranches" | "mergedTextNodes" | "lastAddedNodeId">;

type PositionedRecordNode = {
  node: AtlasNode;
  ply: number;
  depth: number;
  order: number;
};

export function mergeBoardRecords(
  destination: AtlasNode,
  source: AtlasNode,
  options: BoardRecordMergeOptions = {},
): BoardRecordMergeResult {
  const destinationMode = boardMode(destination.notebookMode);
  const sourceMode = boardMode(source.notebookMode);
  if (!destinationMode || !sourceMode || destinationMode !== sourceMode) {
    throw new Error("Only records from the same game type can be merged.");
  }
  const strategy = options.strategy ?? "record-root";
  if (strategy === "deepest-common-position" && destinationMode === "go") {
    throw new Error("Go records can only be merged from the initial position because position history can affect ko legality.");
  }

  const target = structuredClone(destination);
  const targetRecordRoot = findRecordRoot(target, destinationMode);
  const sourceRecordRoot = findRecordRoot(source, sourceMode);
  if (!targetRecordRoot || !sourceRecordRoot) throw new Error("A record root could not be found.");
  assertSameGame(targetRecordRoot, sourceRecordRoot, destinationMode);

  const state: MergeState = { matchedNodes: 1, addedBranches: 0, mergedTextNodes: 0, lastAddedNodeId: null };
  // Keep the notebook user's record title stable; imported source names are
  // metadata, not a new title to append on every merge.
  mergeNodeText(targetRecordRoot, sourceRecordRoot, destinationMode, state, { preserveDestinationTitle: true });
  mergeMetadata(targetRecordRoot, sourceRecordRoot);
  const recordId = targetRecordRoot.structuredContent?.recordId;
  if (!recordId) throw new Error("The destination record id is missing.");
  const anchor = strategy === "deepest-common-position"
    ? findDeepestCommonPosition(targetRecordRoot, sourceRecordRoot, destinationMode)
    : createMergeAnchor(targetRecordRoot, sourceRecordRoot);
  if (anchor.target.node !== targetRecordRoot) {
    state.matchedNodes += 1;
    mergeNodeText(anchor.target.node, anchor.source.node, destinationMode, state);
  }
  mergeChildren(anchor.target.node, anchor.source.node, destinationMode, recordId, state);
  target.updatedAt = new Date().toISOString();

  return {
    root: target,
    ...state,
    anchor: {
      strategy,
      destinationNodeId: anchor.target.node.id,
      sourceNodeId: anchor.source.node.id,
      destinationPly: anchor.target.ply,
      sourcePly: anchor.source.ply,
    },
  };
}

function mergeChildren(
  targetParent: AtlasNode,
  sourceParent: AtlasNode,
  mode: BoardNotebookMode,
  recordId: string,
  state: MergeState,
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

function findDeepestCommonPosition(
  destinationRoot: AtlasNode,
  sourceRoot: AtlasNode,
  mode: BoardNotebookMode,
) {
  if (mode === "go") throw new Error("Go records cannot use deepest-position merging.");
  const destinationPositions = collectRecordPositions(destinationRoot, mode);
  const sourcePositions = collectRecordPositions(sourceRoot, mode);
  const destinationByKey = new Map<string, PositionedRecordNode>();
  for (const candidate of destinationPositions) {
    const key = positionKey(candidate.node, mode);
    if (!key) continue;
    const current = destinationByKey.get(key);
    if (!current || comparePositionCandidates(candidate, current) > 0) {
      destinationByKey.set(key, candidate);
    }
  }

  let best = createMergeAnchor(destinationRoot, sourceRoot);
  for (const source of sourcePositions) {
    const key = positionKey(source.node, mode);
    if (!key) continue;
    const target = destinationByKey.get(key);
    if (!target) continue;
    const candidate = { target, source };
    if (compareMergeAnchors(candidate, best) > 0) best = candidate;
  }
  return best;
}

function collectRecordPositions(root: AtlasNode, mode: BoardNotebookMode) {
  const result: PositionedRecordNode[] = [];
  const stack: Array<{ node: AtlasNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    if (isRecordRoot(current.node, mode) || isMoveNode(current.node, mode)) {
      const ply = recordPly(current.node);
      result.push({
        node: current.node,
        ply: ply >= 0 ? ply : current.depth,
        depth: current.depth,
        order: result.length,
      });
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index];
      if (isMoveNode(child, mode)) stack.push({ node: child, depth: current.depth + 1 });
    }
  }
  return result;
}

function createMergeAnchor(target: AtlasNode, source: AtlasNode) {
  return {
    target: positionedNode(target, 0, 0),
    source: positionedNode(source, 0, 0),
  };
}

function comparePositionCandidates(left: PositionedRecordNode, right: PositionedRecordNode) {
  if (left.ply !== right.ply) return left.ply - right.ply;
  if (left.depth !== right.depth) return left.depth - right.depth;
  return right.order - left.order;
}

function positionedNode(node: AtlasNode, depth: number, order: number): PositionedRecordNode {
  const ply = recordPly(node);
  return { node, ply: ply >= 0 ? ply : depth, depth, order };
}

function compareMergeAnchors(
  left: { target: PositionedRecordNode; source: PositionedRecordNode },
  right: { target: PositionedRecordNode; source: PositionedRecordNode },
) {
  const leftCommonDepth = Math.min(left.target.ply, left.source.ply);
  const rightCommonDepth = Math.min(right.target.ply, right.source.ply);
  if (leftCommonDepth !== rightCommonDepth) return leftCommonDepth - rightCommonDepth;
  if (left.source.ply !== right.source.ply) return left.source.ply - right.source.ply;
  if (left.target.ply !== right.target.ply) return left.target.ply - right.target.ply;
  if (left.source.depth !== right.source.depth) return left.source.depth - right.source.depth;
  if (left.target.depth !== right.target.depth) return left.target.depth - right.target.depth;
  if (left.source.order !== right.source.order) return right.source.order - left.source.order;
  return right.target.order - left.target.order;
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

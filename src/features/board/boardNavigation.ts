import { useEffect, useRef } from "react";
import type { AtlasNode } from "../../types";
import {
  branchTailAlongMemory,
  findBoardRecordPath,
  preferredBranchChild,
  rememberBranchPath,
  type BoardBranchMemory,
} from "./boardBranchMemory.ts";

type FocusNode = (id: string) => void;

/**
 * Keeps the user's chosen child for each board position while the record is
 * open. Board navigation must not infer a new branch from array order after
 * the user has deliberately chosen another variation. The rules themselves
 * live in boardBranchMemory.ts; this hook only binds them to focus changes.
 */
export function useBoardBranchNavigation(
  recordRoot: AtlasNode | null,
  currentNode: AtlasNode | null,
  focusNode: FocusNode,
) {
  const memoryByRecordRef = useRef(new Map<string, BoardBranchMemory>());
  const recordMemory = recordRoot
    ? getRecordMemory(memoryByRecordRef.current, recordRoot.id)
    : null;

  // Landing on a position is itself a branch choice, however the user got
  // there. A merge drops focus straight onto the tail of the new line without
  // any forward step, so recording the whole current path is what lets the user
  // walk back to the fork and step forward onto the merged branch again.
  useEffect(() => {
    if (!recordRoot || !currentNode) return;
    rememberBranchPath(getRecordMemory(memoryByRecordRef.current, recordRoot.id), recordRoot, currentNode.id);
  }, [currentNode, recordRoot]);

  const rememberChild = (parentId: string, childId: string) => {
    if (!recordRoot) return;
    getRecordMemory(memoryByRecordRef.current, recordRoot.id).set(parentId, childId);
  };

  const selectVariation = (node: AtlasNode) => {
    if (recordRoot) {
      const path = findBoardRecordPath(recordRoot, node.id);
      const parent = path && path.length > 1 ? path[path.length - 2] : null;
      if (parent) rememberChild(parent.id, node.id);
    }
    focusNode(node.id);
  };

  const advance = () => {
    const parent = currentNode ?? recordRoot;
    if (!parent || !recordMemory) return;
    const next = preferredBranchChild(recordMemory, parent);
    if (!next) return;
    rememberChild(parent.id, next.id);
    focusNode(next.id);
  };

  const advanceToTail = () => {
    const initialNode = currentNode ?? recordRoot;
    if (!initialNode || !recordMemory) return;
    const tail = branchTailAlongMemory(recordMemory, initialNode);
    if (tail.id !== initialNode.id) focusNode(tail.id);
  };

  return { rememberChild, selectVariation, advance, advanceToTail };
}

function getRecordMemory(records: Map<string, BoardBranchMemory>, recordId: string) {
  const existing = records.get(recordId);
  if (existing) return existing;
  const created: BoardBranchMemory = new Map();
  records.set(recordId, created);
  return created;
}

import { useEffect, useRef } from "react";
import type { AtlasNode } from "../../types";
import {
  branchTailAlongMemory,
  findBoardRecordPath,
  pathToNextBranchPoint,
  pathToPreviousBranchPoint,
  preferredBranchChild,
  rememberBranchPath,
  type BoardBranchMemory,
} from "./boardBranchMemory.ts";

/**
 * Reaching the next fork is a replay, not a jump: the moves in between are
 * played in order so the user sees which line was fast-forwarded through. The
 * whole trip is meant to take about half a second, with a floor and a ceiling
 * so a two-move hop is not a crawl and a fifty-move hop is not a strobe.
 */
const BRANCH_REPLAY_TOTAL_MS = 500;
const BRANCH_REPLAY_MIN_STEP_MS = 26;
const BRANCH_REPLAY_MAX_STEP_MS = 110;

export function branchReplayStepMs(steps: number) {
  if (steps <= 1) return 0;
  const even = BRANCH_REPLAY_TOTAL_MS / steps;
  return Math.round(Math.min(BRANCH_REPLAY_MAX_STEP_MS, Math.max(BRANCH_REPLAY_MIN_STEP_MS, even)));
}

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
  const replayTimersRef = useRef<number[]>([]);
  const cancelReplay = () => {
    for (const timer of replayTimersRef.current) window.clearTimeout(timer);
    replayTimersRef.current = [];
  };
  useEffect(() => cancelReplay, []);
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

  const replay = (steps: AtlasNode[]) => {
    cancelReplay();
    if (!steps.length) return;
    const stepMs = branchReplayStepMs(steps.length);
    if (!stepMs) {
      focusNode(steps[0].id);
      return;
    }
    replayTimersRef.current = steps.map((node, index) => window.setTimeout(() => {
      focusNode(node.id);
      if (index === steps.length - 1) replayTimersRef.current = [];
    }, index * stepMs));
  };

  const nextBranchSteps = currentNode && recordMemory ? pathToNextBranchPoint(recordMemory, currentNode) : [];
  const previousBranchSteps = recordRoot && currentNode ? pathToPreviousBranchPoint(recordRoot, currentNode) : [];

  return {
    rememberChild,
    selectVariation,
    advance,
    advanceToTail,
    // The buttons stay disabled rather than doing nothing when no fork is left.
    hasNextBranchPoint: nextBranchSteps.length > 0,
    hasPreviousBranchPoint: previousBranchSteps.length > 0,
    replayToNextBranchPoint: () => replay(nextBranchSteps),
    replayToPreviousBranchPoint: () => replay(previousBranchSteps),
  };
}

function getRecordMemory(records: Map<string, BoardBranchMemory>, recordId: string) {
  const existing = records.get(recordId);
  if (existing) return existing;
  const created: BoardBranchMemory = new Map();
  records.set(recordId, created);
  return created;
}

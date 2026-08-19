import { exportKIF, Record as TsshogiRecord } from "tsshogi";
import { exportChessRecord, importChessRecordText } from "../src/features/chess/chessRecord.ts";
import { exportGoRecord, importGoRecordText } from "../src/features/go/goRecord.ts";
import { mergeBoardRecords } from "../src/features/board/boardRecordMerge.ts";
import {
  boardMoveChildren,
  findBoardRecordPath,
  preferredBranchChild,
  rememberBranchPath,
  type BoardBranchMemory,
} from "../src/features/board/boardBranchMemory.ts";
import { exportShogiRecord, importShogiRecordText } from "../src/features/shogi/shogiRecord.ts";
import type { AtlasNode } from "../src/types.ts";

verifyShogiMerge();
verifyChessMerge();
verifyGoMerge();
verifyShogiTranspositionMerge();
verifyChessTranspositionMerge();
verifyGoDeepestStrategyGuard();
verifyMidRecordCommonPosition();
verifyNearestTailAnchorShogi();
verifyNearestTailAnchorChess();
verifyNoCommonPositionBeyondStart();
verifyExistingBranchesAtAnchor();
verifyBranchMemoryAfterMerge();
verifyPlainNavigationUnchanged();

/** A shared position partway through the record anchors there, not at the root. */
function verifyMidRecordCommonPosition() {
  const destination = shogiRecord("7g7f 3c3d 2g2f 8c8d", "Destination");
  const source = shogiRecord("7g7f 3c3d 2g2f 4a4b", "Source");
  const merged = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  if (merged.anchor.destinationPly !== 3 || merged.anchor.sourcePly !== 3) {
    throw new Error("mid-record merge did not anchor at the last shared position.");
  }
  const anchor = findNode(merged.root, merged.anchor.destinationNodeId);
  if (!anchor || boardMoveChildren(anchor).length !== 2 || merged.addedBranches !== 1) {
    throw new Error("mid-record merge did not append the divergence at the shared position.");
  }
  console.log("verify:board-record-merge:shogi:mid-record:passed");
}

/**
 * Several positions are shared, and the one nearest the imported record's final
 * position wins even though an earlier match sits deeper in the destination.
 * The source returns to the ply-2 position after six moves, so only its last
 * move should be added.
 */
function verifyNearestTailAnchorShogi() {
  const destination = shogiRecord("7g7f 3c3d 6i6h 4a4b", "Destination");
  const source = shogiRecord("6i6h 4a4b 7g7f 3c3d 6h6i 4b4a 2g2f", "Source");
  const merged = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  if (merged.anchor.sourcePly !== 6 || merged.anchor.destinationPly !== 2) {
    throw new Error(
      `shogi merge chose ply ${merged.anchor.destinationPly}/${merged.anchor.sourcePly} instead of the match nearest the imported tail.`,
    );
  }
  const anchor = findNode(merged.root, merged.anchor.destinationNodeId);
  const added = merged.lastAddedNodeId ? findNode(merged.root, merged.lastAddedNodeId) : null;
  if (!anchor || !added || merged.addedBranches !== 1) throw new Error("shogi nearest-tail merge did not add the continuation.");
  if (boardMoveChildren(added).length !== 0) throw new Error("shogi nearest-tail merge added moves before the shared position.");
  if (!boardMoveChildren(anchor).some((child) => child.id === added.id)) {
    throw new Error("shogi nearest-tail merge attached the continuation somewhere other than the shared position.");
  }
  console.log("verify:board-record-merge:shogi:nearest-tail:passed");
}

/**
 * The same shape in chess, which additionally depends on the en-passant square
 * being dropped from the position key when no capture exists: the destination
 * reaches these positions without a double pawn push and the source with one.
 */
function verifyNearestTailAnchorChess() {
  const destination = chessRecord("1. e4 e5 2. Nf3 Nf6 *", "Destination");
  const source = chessRecord("1. Nf3 Nf6 2. e4 e5 3. Ng1 Ng8 4. d4 *", "Source");
  const merged = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  if (merged.anchor.sourcePly !== 6 || merged.anchor.destinationPly !== 2) {
    throw new Error(
      `chess merge chose ply ${merged.anchor.destinationPly}/${merged.anchor.sourcePly} instead of the match nearest the imported tail.`,
    );
  }
  const added = merged.lastAddedNodeId ? findNode(merged.root, merged.lastAddedNodeId) : null;
  if (!added || merged.addedBranches !== 1 || boardMoveChildren(added).length !== 0) {
    throw new Error("chess nearest-tail merge did not add exactly the continuation after the shared position.");
  }
  console.log("verify:board-record-merge:chess:nearest-tail:passed");
}

/** Nothing but the start position is shared, so the whole line is added there. */
function verifyNoCommonPositionBeyondStart() {
  const destination = shogiRecord("7g7f 3c3d 2g2f", "Destination");
  const source = shogiRecord("2g2f 8c8d 2f2e", "Source");
  const merged = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  if (merged.anchor.destinationPly !== 0 || merged.anchor.sourcePly !== 0) {
    throw new Error("merge without a shared position did not fall back to the record root.");
  }
  const recordRoot = findNode(merged.root, merged.anchor.destinationNodeId);
  if (!recordRoot || boardMoveChildren(recordRoot).length !== 2 || merged.addedBranches !== 1) {
    throw new Error("merge without a shared position did not add the imported line at the start.");
  }
  if (countMoveNodes(boardMoveChildren(recordRoot)[1]) !== 3) {
    throw new Error("merge without a shared position dropped part of the imported line.");
  }
  console.log("verify:board-record-merge:shogi:no-common-position:passed");
}

/** Variations already present at the shared position survive the merge. */
function verifyExistingBranchesAtAnchor() {
  const base = shogiRecord("7g7f 3c3d 2g2f", "Destination");
  const withSecondBranch = mergeBoardRecords(base, shogiRecord("7g7f 3c3d 6i6h", "Existing variation"), {
    strategy: "deepest-common-position",
  }).root;
  const merged = mergeBoardRecords(withSecondBranch, shogiRecord("7g7f 3c3d 5i6h", "Source"), {
    strategy: "deepest-common-position",
  });
  const anchor = findNode(merged.root, merged.anchor.destinationNodeId);
  if (!anchor || merged.anchor.destinationPly !== 2) throw new Error("merge with existing branches moved the anchor.");
  const variations = boardMoveChildren(anchor);
  if (variations.length !== 3 || merged.addedBranches !== 1) {
    throw new Error("merge with existing branches did not keep both existing variations.");
  }
  variations.forEach((child, index) => {
    if (child.structuredContent && "branchIndex" in child.structuredContent && child.structuredContent.branchIndex !== index) {
      throw new Error("merge with existing branches left branch indexes inconsistent.");
    }
  });
  console.log("verify:board-record-merge:shogi:existing-branches:passed");
}

/**
 * The reported regression: after a merge the user is dropped on the tail of the
 * new line, walks back to the fork, and steps forward again. That must return to
 * the merged branch rather than the pre-existing first variation.
 */
function verifyBranchMemoryAfterMerge() {
  const destination = shogiRecord("7g7f 3c3d 2g2f 8c8d 2f2e", "Destination");
  const source = shogiRecord("7g7f 3c3d 6i6h 4a4b", "Source");
  const merged = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  const recordRoot = merged.root.children[0];
  const mergedTailId = merged.lastAddedNodeId;
  if (!recordRoot || !mergedTailId) throw new Error("merge fixture for branch memory is incomplete.");

  // Focus lands on the merged tail, which is what records the branch.
  const memory: BoardBranchMemory = new Map();
  if (!rememberBranchPath(memory, recordRoot, mergedTailId)) throw new Error("the merged tail is not reachable from the record root.");

  // Step back to the fork one move at a time.
  const path = findBoardRecordPath(recordRoot, mergedTailId);
  if (!path) throw new Error("the merged path disappeared.");
  const fork = path.find((node) => boardMoveChildren(node).length > 1);
  if (!fork) throw new Error("the merge did not create a fork to walk back to.");
  if (boardMoveChildren(fork)[0].id === path[path.indexOf(fork) + 1].id) {
    throw new Error("branch memory fixture is not exercising the fallback: the merged branch is already first.");
  }

  // Step forward again: the remembered branch wins over array order.
  const forward = preferredBranchChild(memory, fork);
  if (!forward || forward.id !== path[path.indexOf(fork) + 1].id) {
    throw new Error("stepping forward after a merge did not return to the merged branch.");
  }
  console.log("verify:board-record-merge:shogi:branch-memory:passed");
}

/** Without a remembered choice, navigation still follows the record order. */
function verifyPlainNavigationUnchanged() {
  const destination = shogiRecord("7g7f 3c3d 2g2f", "Destination");
  const merged = mergeBoardRecords(destination, shogiRecord("7g7f 3c3d 6i6h", "Source"), {
    strategy: "deepest-common-position",
  });
  const fork = findNode(merged.root, merged.anchor.destinationNodeId);
  if (!fork) throw new Error("plain navigation fixture lost its fork.");
  const variations = boardMoveChildren(fork);
  const memory: BoardBranchMemory = new Map();
  if (preferredBranchChild(memory, fork)?.id !== variations[0].id) {
    throw new Error("navigation without a remembered branch stopped following record order.");
  }
  memory.set(fork.id, variations[1].id);
  if (preferredBranchChild(memory, fork)?.id !== variations[1].id) {
    throw new Error("navigation ignored a remembered branch.");
  }
  const leaf = variations[0];
  if (preferredBranchChild(memory, leaf) !== null) {
    throw new Error("navigation invented a move at the end of a line.");
  }
  console.log("verify:board-record-merge:navigation:passed");
}

function shogiRecord(usiMoves: string, title: string) {
  const native = TsshogiRecord.newByUSI(`startpos moves ${usiMoves}`);
  if (native instanceof Error) throw new Error(`Could not build the shogi fixture "${usiMoves}": ${native.message}`);
  return importShogiRecordText(exportKIF(native), title, "kif").root;
}

function chessRecord(pgn: string, title: string) {
  return importChessRecordText(`[Event "${title}"]\n\n${pgn}`, title).root;
}

function countMoveNodes(node: AtlasNode): number {
  return boardMoveChildren(node).reduce((total, child) => total + countMoveNodes(child), 1);
}

function verifyShogiMerge() {
  const destinationNative = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d");
  const sourceNative = TsshogiRecord.newByUSI("startpos moves 7g7f 8c8d");
  if (destinationNative instanceof Error || sourceNative instanceof Error) throw new Error("Could not create shogi merge fixtures.");
  const destination = importShogiRecordText(exportKIF(destinationNative), "Destination", "kif").root;
  const source = importShogiRecordText(exportKIF(sourceNative), "Source", "kif").root;
  annotateRoots(destination, source);
  const merged = verifyMerge(destination, source, "shogi");
  const restored = importShogiRecordText(exportShogiRecord(merged), "Restored", "kif").root;
  assertAnnotations(restored, "shogi");
}

function verifyChessMerge() {
  const destination = importChessRecordText('[Event "Destination"]\n\n1. e4 e5 *', "Destination").root;
  const source = importChessRecordText('[Event "Source"]\n\n1. e4 c5 *', "Source").root;
  annotateRoots(destination, source);
  const merged = verifyMerge(destination, source, "chess");
  const restored = importChessRecordText(exportChessRecord(merged), "Restored").root;
  assertAnnotations(restored, "chess");
}

function verifyGoMerge() {
  const destination = importGoRecordText("(;GM[1]FF[4]SZ[9];B[dd];W[cc])", "Destination").root;
  const source = importGoRecordText("(;GM[1]FF[4]SZ[9];B[dd];W[cf])", "Source").root;
  annotateRoots(destination, source);
  const merged = verifyMerge(destination, source, "go");
  const restored = importGoRecordText(exportGoRecord(merged), "Restored").root;
  assertAnnotations(restored, "go");
}

function verifyShogiTranspositionMerge() {
  const destinationNative = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d 2g2f 8c8d 2f2e");
  const sourceNative = TsshogiRecord.newByUSI("startpos moves 2g2f 8c8d 7g7f 3c3d 7f7e");
  if (destinationNative instanceof Error || sourceNative instanceof Error) throw new Error("Could not create shogi transposition fixtures.");
  const destination = importShogiRecordText(exportKIF(destinationNative), "Destination", "kif").root;
  const source = importShogiRecordText(exportKIF(sourceNative), "Source", "kif").root;
  verifyTranspositionStrategies(destination, source, "shogi", 4);
}

function verifyChessTranspositionMerge() {
  const destination = importChessRecordText('[Event "Destination"]\n\n1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 *', "Destination").root;
  const source = importChessRecordText('[Event "Source"]\n\n1. g3 d5 2. Nf3 Nf6 3. Bg2 c5 *', "Source").root;
  verifyTranspositionStrategies(destination, source, "chess", 5);
}

function verifyTranspositionStrategies(destination: AtlasNode, source: AtlasNode, label: string, expectedAnchorPly: number) {
  const fromRoot = mergeBoardRecords(destination, source, { strategy: "record-root" });
  const rootRecord = fromRoot.root.children[0];
  if (rootRecord?.children.length !== 2 || fromRoot.anchor.destinationPly !== 0 || fromRoot.anchor.sourcePly !== 0) {
    throw new Error(label + " initial-position strategy did not preserve alternate move orders.");
  }

  const fromDeepest = mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  const deepestRecord = fromDeepest.root.children[0];
  const anchor = findNode(fromDeepest.root, fromDeepest.anchor.destinationNodeId);
  if (!deepestRecord || !anchor) throw new Error(label + " deepest-position merge lost its anchor.");
  if (deepestRecord.children.length !== 1) throw new Error(label + " deepest-position merge retained the imported move-order prefix.");
  if (fromDeepest.anchor.destinationPly !== expectedAnchorPly || fromDeepest.anchor.sourcePly !== expectedAnchorPly) {
    throw new Error(label + " deepest-position merge selected the wrong common position.");
  }
  if (anchor.children.length !== 2 || fromDeepest.addedBranches !== 1 || !fromDeepest.lastAddedNodeId) {
    throw new Error(label + " deepest-position merge did not append the new continuation at the common position.");
  }

  const repeated = mergeBoardRecords(fromDeepest.root, source, { strategy: "deepest-common-position" });
  if (repeated.addedBranches !== 0 || repeated.lastAddedNodeId !== null) {
    throw new Error(label + " deepest-position merge was not idempotent.");
  }
  console.log("verify:board-record-merge:" + label + ":transposition:passed");
}

function verifyGoDeepestStrategyGuard() {
  const destination = importGoRecordText("(;GM[1]FF[4]SZ[9];B[dd])", "Destination").root;
  const source = importGoRecordText("(;GM[1]FF[4]SZ[9];B[dd])", "Source").root;
  let rejected = false;
  try {
    mergeBoardRecords(destination, source, { strategy: "deepest-common-position" });
  } catch (error) {
    rejected = error instanceof Error && /ko legality/i.test(error.message);
  }
  if (!rejected) throw new Error("Go deepest-position merge must be rejected.");
  console.log("verify:board-record-merge:go:deepest-guard:passed");
}

function annotateRoots(destination: AtlasNode, source: AtlasNode) {
  const destinationRecord = destination.children[0];
  const sourceRecord = source.children[0];
  const destinationFirst = destinationRecord?.children[0];
  const sourceFirst = sourceRecord?.children[0];
  if (!destinationRecord || !sourceRecord || !destinationFirst || !sourceFirst) throw new Error("Merge fixture is incomplete.");
  destinationRecord.title = "Destination title";
  destinationRecord.body = "Destination body";
  sourceRecord.title = "Source title";
  sourceRecord.body = "Source body";
  destinationFirst.body = "Shared destination note";
  sourceFirst.body = "Shared source note";
  sourceFirst.title = "Source move title";
}

function verifyMerge(destination: AtlasNode, source: AtlasNode, label: string) {
  const first = mergeBoardRecords(destination, source);
  const recordRoot = first.root.children[0];
  const sharedMove = recordRoot?.children[0];
  if (!recordRoot || !sharedMove) throw new Error(label + " merge lost the shared path.");
  if (recordRoot.title !== "Destination title") throw new Error(label + " merge changed the record-root title.");
  if (recordRoot.body !== "Destination body\nSource body") throw new Error(label + " merge body order is wrong.");
  if (sharedMove.body !== "Shared destination note\nShared source note") throw new Error(label + " shared-node notes were not merged.");
  if (sharedMove.title !== "Source move title") throw new Error(label + " did not preserve the edited move title.");
  if (sharedMove.children.length !== 2 || first.addedBranches !== 1) throw new Error(label + " variation was not added exactly once.");
  if (!first.lastAddedNodeId || !findNode(first.root, first.lastAddedNodeId) || first.lastAddedNodeId === sharedMove.id) {
    throw new Error(label + " did not identify the tail of the newly merged branch.");
  }

  const repeated = mergeBoardRecords(first.root, source);
  const repeatedRoot = repeated.root.children[0];
  const repeatedShared = repeatedRoot?.children[0];
  if (repeated.addedBranches !== 0 || repeated.lastAddedNodeId !== null || repeatedRoot?.title !== recordRoot.title || repeatedShared?.body !== sharedMove.body) {
    throw new Error(label + " repeated merge was not idempotent.");
  }
  console.log("verify:board-record-merge:" + label + ":passed");
  return repeated.root;
}

function findNode(root: AtlasNode, id: string): AtlasNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function assertAnnotations(root: AtlasNode, label: string) {
  const recordRoot = root.children[0];
  const sharedMove = recordRoot?.children[0];
  if (recordRoot?.title !== "Destination title" || recordRoot.body !== "Destination body\nSource body") {
    throw new Error(label + " merged root annotations did not survive native export.");
  }
  if (sharedMove?.body !== "Shared destination note\nShared source note") {
    throw new Error(label + " merged move annotations did not survive native export.");
  }
}

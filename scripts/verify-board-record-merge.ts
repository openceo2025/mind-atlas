import { exportKIF, Record as TsshogiRecord } from "tsshogi";
import { exportChessRecord, importChessRecordText } from "../src/features/chess/chessRecord.ts";
import { exportGoRecord, importGoRecordText } from "../src/features/go/goRecord.ts";
import { mergeBoardRecords } from "../src/features/board/boardRecordMerge.ts";
import { exportShogiRecord, importShogiRecordText } from "../src/features/shogi/shogiRecord.ts";
import type { AtlasNode } from "../src/types.ts";

verifyShogiMerge();
verifyChessMerge();
verifyGoMerge();
verifyShogiTranspositionMerge();
verifyChessTranspositionMerge();
verifyGoDeepestStrategyGuard();

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

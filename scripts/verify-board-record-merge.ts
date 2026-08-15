import { exportKIF, Record as TsshogiRecord } from "tsshogi";
import { exportChessRecord, importChessRecordText } from "../src/features/chess/chessRecord.ts";
import { exportGoRecord, importGoRecordText } from "../src/features/go/goRecord.ts";
import { mergeBoardRecords } from "../src/features/board/boardRecordMerge.ts";
import { exportShogiRecord, importShogiRecordText } from "../src/features/shogi/shogiRecord.ts";
import type { AtlasNode } from "../src/types.ts";

verifyShogiMerge();
verifyChessMerge();
verifyGoMerge();

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
}

function verifyMerge(destination: AtlasNode, source: AtlasNode, label: string) {
  const first = mergeBoardRecords(destination, source);
  const recordRoot = first.root.children[0];
  const sharedMove = recordRoot?.children[0];
  if (!recordRoot || !sharedMove) throw new Error(label + " merge lost the shared path.");
  if (recordRoot.title !== "Destination title / Source title") throw new Error(label + " merge title order is wrong.");
  if (recordRoot.body !== "Destination body\nSource body") throw new Error(label + " merge body order is wrong.");
  if (sharedMove.body !== "Shared destination note\nShared source note") throw new Error(label + " shared-node notes were not merged.");
  if (sharedMove.children.length !== 2 || first.addedBranches !== 1) throw new Error(label + " variation was not added exactly once.");

  const repeated = mergeBoardRecords(first.root, source);
  const repeatedRoot = repeated.root.children[0];
  const repeatedShared = repeatedRoot?.children[0];
  if (repeated.addedBranches !== 0 || repeatedRoot?.title !== recordRoot.title || repeatedShared?.body !== sharedMove.body) {
    throw new Error(label + " repeated merge was not idempotent.");
  }
  console.log("verify:board-record-merge:" + label + ":passed");
  return repeated.root;
}

function assertAnnotations(root: AtlasNode, label: string) {
  const recordRoot = root.children[0];
  const sharedMove = recordRoot?.children[0];
  if (recordRoot?.title !== "Destination title / Source title" || recordRoot.body !== "Destination body\nSource body") {
    throw new Error(label + " merged root annotations did not survive native export.");
  }
  if (sharedMove?.body !== "Shared destination note\nShared source note") {
    throw new Error(label + " merged move annotations did not survive native export.");
  }
}

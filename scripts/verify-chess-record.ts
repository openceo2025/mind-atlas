import { exportChessRecord, importChessRecordFile } from "../src/features/chess/chessRecord.ts";

const source = `[Event "Mind Atlas fixture"]
[Site "Local"]
[Round "1"]
[White "White"]
[Black "Black"]

1. e4 e5 2. Nf3 (2. Bc4 Nc6) 2... Nc6 3. Bb5 a6 *`;

const imported = await importChessRecordFile(new File([source], "fixture.pgn"));
const annotatedRoot = imported.root.children[0];
const annotatedMove = annotatedRoot?.children[0];
if (!annotatedRoot || !annotatedMove) throw new Error("Chess annotation fixture is incomplete.");
if (annotatedMove.title !== "e4" || annotatedMove.children[0]?.title !== "e5") {
  throw new Error(`Chess node titles should use concise SAN without PGN move-number punctuation: ${annotatedMove.title} / ${annotatedMove.children[0]?.title}`);
}
annotatedRoot.title = "Main line / study";
annotatedRoot.body = "Root note\nSecond note";
annotatedMove.title = "King pawn plan";
annotatedMove.body = "Keep this idea visible.";
const exported = exportChessRecord(imported.root);
const roundTrip = await importChessRecordFile(new File([exported], "round-trip.pgn"));
const nodeCount = countNodes(roundTrip.root);
const moveCount = countStructuredNodes(roundTrip.root);
if (nodeCount < 9 || moveCount < 8 || !exported.includes("Bc4")) {
  throw new Error(`PGN import/export lost moves or variation: nodes=${nodeCount}, moves=${moveCount}`);
}
const restoredRoot = roundTrip.root.children[0];
const restoredMove = restoredRoot?.children[0];
if (restoredRoot?.title !== annotatedRoot.title || restoredRoot.body !== annotatedRoot.body) throw new Error("PGN root annotations did not round-trip.");
if (restoredMove?.title !== annotatedMove.title || restoredMove.body !== annotatedMove.body) throw new Error("PGN move annotations did not round-trip.");
console.log(`verify:chess:pgn:passed nodes=${nodeCount} moves=${moveCount}`);

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function countStructuredNodes(node: { structuredContent?: unknown; children: Array<{ structuredContent?: unknown; children: unknown[] }> }): number {
  return (node.structuredContent ? 1 : 0) + node.children.reduce((sum, child) => sum + countStructuredNodes(child as never), 0);
}

import { exportChessRecord, importChessRecordFile } from "../src/features/chess/chessRecord.ts";

const source = `[Event "Mind Atlas fixture"]
[Site "Local"]
[Round "1"]
[White "White"]
[Black "Black"]

1. e4 e5 2. Nf3 (2. Bc4 Nc6) 2... Nc6 3. Bb5 a6 *`;

const imported = await importChessRecordFile(new File([source], "fixture.pgn"));
const exported = exportChessRecord(imported.root);
const roundTrip = await importChessRecordFile(new File([exported], "round-trip.pgn"));
const nodeCount = countNodes(roundTrip.root);
const moveCount = countStructuredNodes(roundTrip.root);
if (nodeCount < 9 || moveCount < 8 || !exported.includes("Bc4")) {
  throw new Error(`PGN import/export lost moves or variation: nodes=${nodeCount}, moves=${moveCount}`);
}
console.log(`verify:chess:pgn:passed nodes=${nodeCount} moves=${moveCount}`);

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function countStructuredNodes(node: { structuredContent?: unknown; children: Array<{ structuredContent?: unknown; children: unknown[] }> }): number {
  return (node.structuredContent ? 1 : 0) + node.children.reduce((sum, child) => sum + countStructuredNodes(child as never), 0);
}

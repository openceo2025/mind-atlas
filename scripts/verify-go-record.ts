import { exportGoRecord, importGoRecordFile } from "../src/features/go/goRecord.ts";

const source = `(;GM[1]FF[4]SZ[9]PB[Black]PW[White]C[fixture root];B[dd]C[first](;W[cc];B[ee])(;W[cf]))`;

const imported = await importGoRecordFile(new File([source], "fixture.sgf"));
const exported = exportGoRecord(imported.root);
const roundTrip = await importGoRecordFile(new File([exported], "round-trip.sgf"));
const nodeCount = countNodes(roundTrip.root);
const moveCount = countStructuredNodes(roundTrip.root);
if (nodeCount < 6 || moveCount < 4 || !exported.includes("B[dd]")) {
  throw new Error(`SGF import/export lost moves or variation: nodes=${nodeCount}, moves=${moveCount}`);
}
console.log(`verify:go:sgf:passed nodes=${nodeCount} moves=${moveCount}`);

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function countStructuredNodes(node: { structuredContent?: unknown; children: Array<{ structuredContent?: unknown; children: unknown[] }> }): number {
  return (node.structuredContent ? 1 : 0) + node.children.reduce((sum, child) => sum + countStructuredNodes(child as never), 0);
}

import { createNewChessRecord, exportChessRecord, importChessRecordFile, importChessRecordText } from "../src/features/chess/chessRecord.ts";

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

expectError(
  "multi-game PGN",
  () => importChessRecordText(`${source}\n\n[Event "Second"]\n\n1. d4 d5 *`),
  /contains 2 games/i,
);
expectError(
  "unsupported chess variant",
  () => importChessRecordText('[Event "Atomic"]\n[Variant "Atomic"]\n\n1. e4 *'),
  /unsupported chess variant/i,
);
const newRecord = createNewChessRecord("New fixture");
const newPgn = exportChessRecord(newRecord.root);
for (const tag of ["Event", "Site", "Date", "Round", "White", "Black", "Result"]) {
  if (!newPgn.includes(`[${tag} `)) throw new Error(`New PGN is missing the Seven Tag Roster field ${tag}.`);
}
const noteRoot = imported.root.children[0];
if (!noteRoot || !annotatedMove) throw new Error("Chess note fixture is incomplete.");
noteRoot.children.push({ ...annotatedMove, id: "ordinary-chess-note", title: "Unsupported note", body: "Must not disappear", structuredContent: undefined, children: [] });
expectError("ordinary Atlas note export", () => exportChessRecord(imported.root), /unsupported Atlas node/i);
console.log("verify:chess:boundaries:passed");

function expectError(label: string, action: () => unknown, pattern: RegExp) {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pattern.test(message)) return;
    throw new Error(`${label} failed with an unexpected error: ${message}`);
  }
  throw new Error(`${label} should have been rejected.`);
}

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function countStructuredNodes(node: { structuredContent?: unknown; children: Array<{ structuredContent?: unknown; children: unknown[] }> }): number {
  return (node.structuredContent ? 1 : 0) + node.children.reduce((sum, child) => sum + countStructuredNodes(child as never), 0);
}

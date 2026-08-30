import { canEditGoRecord, createNewGoRecord, exportGoRecord, importGoRecordFile, importGoRecordText } from "../src/features/go/goRecord.ts";

const source = `(;GM[1]FF[4]SZ[9]PB[Black]PW[White]C[fixture root];B[dd]C[first](;W[cc];B[ee])(;W[cf]))`;

const imported = await importGoRecordFile(new File([source], "fixture.sgf"));
const annotatedRoot = imported.root.children[0];
const annotatedMove = annotatedRoot?.children[0];
if (!annotatedRoot || !annotatedMove) throw new Error("Go annotation fixture is incomplete.");
annotatedRoot.title = "Fuseki / study";
annotatedRoot.body = "Root note\nSecond note";
annotatedMove.title = "Corner approach";
annotatedMove.body = "Review this direction.";
const exported = exportGoRecord(imported.root);
const roundTrip = await importGoRecordFile(new File([exported], "round-trip.sgf"));
const nodeCount = countNodes(roundTrip.root);
const moveCount = countStructuredNodes(roundTrip.root);
if (nodeCount < 6 || moveCount < 4 || !exported.includes("B[dd]")) {
  throw new Error(`SGF import/export lost moves or variation: nodes=${nodeCount}, moves=${moveCount}`);
}
const restoredRoot = roundTrip.root.children[0];
const restoredMove = restoredRoot?.children[0];
if (restoredRoot?.title !== annotatedRoot.title || restoredRoot.body !== annotatedRoot.body) throw new Error("SGF root annotations did not round-trip.");
if (restoredMove?.title !== annotatedMove.title || restoredMove.body !== annotatedMove.body) throw new Error("SGF move annotations did not round-trip.");
console.log(`verify:go:sgf:passed nodes=${nodeCount} moves=${moveCount}`);

expectError(
  "multi-tree SGF",
  () => importGoRecordText(`${source}\n(;GM[1]FF[4]SZ[9];B[aa])`),
  /contains 2 game trees/i,
);
expectError(
  "non-move SGF node",
  () => importGoRecordText("(;GM[1]FF[4]SZ[9];C[between];B[dd])"),
  /non-move node/i,
);
expectError(
  "non-Go SGF game type",
  () => importGoRecordText("(;GM[3]FF[4]SZ[9];B[dd])"),
  /GM\[3\]/i,
);
expectError(
  "rectangular SGF board",
  () => importGoRecordText("(;GM[1]FF[4]SZ[9:13];B[dd])"),
  /rectangular/i,
);

const compressedSetup = importGoRecordText("(;GM[1]FF[4]SZ[9]AB[aa:cc])", "Compressed setup");
const compressedContent = compressedSetup.root.children[0]?.structuredContent;
if (compressedContent?.kind !== "go-record" || (compressedContent.board.match(/X/g) ?? []).length !== 9) {
  throw new Error("Compressed SGF setup should create all nine stones.");
}
const erasedSetup = importGoRecordText("(;GM[1]FF[4]SZ[9]AB[aa:cc]AE[bb])", "Erased setup");
const erasedContent = erasedSetup.root.children[0]?.structuredContent;
if (erasedContent?.kind !== "go-record" || (erasedContent.board.match(/X/g) ?? []).length !== 8) {
  throw new Error("SGF AE setup should remove the erased point.");
}

const nzSuicide = importGoRecordText("(;GM[1]FF[4]SZ[5]RU[NZ]AW[ab][ba][cb][bc];B[bb])", "NZ suicide");
const nzRootContent = nzSuicide.root.children[0]?.structuredContent;
if (nzRootContent?.kind !== "go-record" || canEditGoRecord(nzRootContent)) throw new Error("Non-Japanese Go rules should be replay-only.");
if (!nzSuicide.root.children[0]?.children[0]) throw new Error("NZ suicide should be replayed instead of rejected.");

const newRecord = createNewGoRecord("New fixture");
const newSgf = exportGoRecord(newRecord.root);
if (!newSgf.includes("CA[UTF-8]") || !newSgf.includes("RU[Japanese]") || !newSgf.includes("KM[6.5]") || !newSgf.includes("PL[B]")) {
  throw new Error("New SGF should declare UTF-8, rules, komi, and player to move.");
}
const japaneseRoot = newRecord.root.children[0];
if (!japaneseRoot) throw new Error("New Go record root is missing.");
japaneseRoot.title = "日本";
const japaneseRoundTrip = importGoRecordText(exportGoRecord(newRecord.root), "Japanese round trip");
if (japaneseRoundTrip.root.children[0]?.title !== "日本") throw new Error("UTF-8 Japanese SGF text did not round-trip.");

const sjisPrefix = new TextEncoder().encode("(;GM[1]FF[4]CA[Shift_JIS]SZ[9]GN[");
const sjisSuffix = new TextEncoder().encode("])");
const sjisBytes = new Uint8Array(sjisPrefix.length + 4 + sjisSuffix.length);
sjisBytes.set(sjisPrefix);
sjisBytes.set([0x93, 0xfa, 0x96, 0x7b], sjisPrefix.length);
sjisBytes.set(sjisSuffix, sjisPrefix.length + 4);
const sjisRecord = await importGoRecordFile(new File([sjisBytes], "shift-jis.sgf"));
if (sjisRecord.root.children[0]?.title !== "日本") throw new Error(`Shift_JIS SGF text did not decode correctly: ${JSON.stringify(sjisRecord.root.children[0]?.title)}.`);

const noteRoot = imported.root.children[0];
if (!noteRoot || !annotatedMove) throw new Error("Go note fixture is incomplete.");
noteRoot.children.push({ ...annotatedMove, id: "ordinary-go-note", title: "Unsupported note", body: "Must not disappear", structuredContent: undefined, children: [] });
expectError("ordinary Atlas note export", () => exportGoRecord(imported.root), /unsupported Atlas node/i);
console.log("verify:go:boundaries:passed");

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

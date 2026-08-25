import { anySpecialMove, exportCSA, exportKI2, exportKIF, Record as TsshogiRecord } from "tsshogi";
import { sanitizeStructuredContentForExport } from "../src/notebookExport.ts";
import { createNewShogiRecord, exportShogiRecord, importShogiRecordFile } from "../src/features/shogi/shogiRecord.ts";
import { buildShogiCandidateArrows, buildShogiCandidateTargets } from "../src/features/shogi/shogiCandidates.ts";
import { hasKifPromotedPieceText, normalizeShogiNotebookNotation, toShogiBoardNotation } from "../src/features/shogi/shogiNotation.ts";
import { RECORD_PROVENANCE_HEADING, findRecordProvenance, normalizeRecordProvenanceBodies } from "../src/features/board/recordProvenance.ts";
import { mergeBoardRecords } from "../src/features/board/boardRecordMerge.ts";
import { isBoardBranchPoint, pathToNextBranchPoint, pathToPreviousBranchPoint } from "../src/features/board/boardBranchMemory.ts";
import { branchReplayStepMs } from "../src/features/board/boardNavigation.ts";
import type { AtlasNode } from "../src/types.ts";

const source = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d 2g2f");
if (source instanceof Error) throw source;
source.goto(1);
const branch = source.position.createMoveByUSI("8c8d");
if (!branch || !source.append(branch)) throw new Error("Could not create the branch fixture.");

for (const [extension, content] of [
  ["kif", exportKIF(source)],
  ["ki2", exportKI2(source)],
  ["csa", exportCSA(source)],
] as const) {
  const imported = await importShogiRecordFile(new File([content], `fixture.${extension}`));
  const exportedKif = exportShogiRecord(imported.root);
  const roundTrip = await importShogiRecordFile(new File([exportedKif], "round-trip.kif"));
  const nodeCount = countNodes(roundTrip.root);
  const minimumNodes = extension === "csa" ? 4 : 6;
  if (nodeCount < minimumNodes) throw new Error(`${extension} import lost moves: ${nodeCount}`);
  console.log(`verify:shogi:${extension}:passed nodes=${nodeCount}`);
}

const annotated = await importShogiRecordFile(new File([exportKIF(source)], "annotated.kif"));
const annotatedRoot = annotated.root.children[0];
const annotatedMove = annotatedRoot?.children[0];
if (!annotatedRoot || !annotatedMove) throw new Error("Shogi annotation fixture is incomplete.");
annotatedRoot.title = "Opening position / study";
annotatedRoot.body = "Destination note\nSource note";
annotatedMove.title = "Custom move title";
annotatedMove.body = "Remember this variation.";
const annotationRoundTrip = await importShogiRecordFile(new File([exportShogiRecord(annotated.root)], "annotated-round-trip.kif"));
const restoredRoot = annotationRoundTrip.root.children[0];
const restoredMove = restoredRoot?.children[0];
if (restoredRoot?.title !== annotatedRoot.title || restoredRoot.body !== annotatedRoot.body) {
  throw new Error("KIF root title/body annotations did not round-trip.");
}
if (restoredMove?.title !== annotatedMove.title || restoredMove.body !== annotatedMove.body) {
  throw new Error("KIF move title/body annotations did not round-trip.");
}
console.log("verify:shogi:annotations:passed");

const fresh = createNewShogiRecord();
if (fresh.datasetName !== "新規の棋譜" || fresh.root.title !== "新規の棋譜" || fresh.root.children.length !== 1) {
  throw new Error("New shogi launch did not create exactly one initial-position node.");
}
if (fresh.root.children[0]?.title !== "将棋" || fresh.root.children[0]?.body !== "" || fresh.root.children[0]?.children.length !== 0) {
  throw new Error("New shogi launch initial node is not empty and correctly titled.");
}
console.log("verify:shogi:new-record:passed");

const specialSource = TsshogiRecord.newByUSI("startpos moves 7g7f");
if (specialSource instanceof Error) throw specialSource;
if (!specialSource.append(anySpecialMove("封じ手"))) throw new Error("Could not create a special-move fixture.");
const specialAtlas = await importShogiRecordFile(new File([exportKIF(specialSource)], "special.kif"));
const cloudRoundTripRoot = sanitizeBoardTree(specialAtlas.root);
const cloudKif = exportShogiRecord(cloudRoundTripRoot);
if (!cloudKif.includes("封じ手") || !cloudKif.includes("７六歩")) {
  throw new Error("Cloud text-only sanitization lost shogi USI or special-move data.");
}

const legacyAtlas = structuredClone(specialAtlas.root);
const legacyMove = legacyAtlas.children[0]?.children[0];
if (!legacyMove?.structuredContent || legacyMove.structuredContent.kind !== "shogi-record") {
  throw new Error("Legacy repair fixture is incomplete.");
}
delete legacyMove.structuredContent.usi;
const repairedKif = exportShogiRecord(legacyAtlas);
if (!repairedKif.includes("７六歩")) throw new Error("Missing legacy USI data was not reconstructed from SFEN.");

const deletedTerminalAtlas = structuredClone(specialAtlas.root);
const moveParent = deletedTerminalAtlas.children[0]?.children[0];
if (!moveParent) throw new Error("Terminal deletion fixture is incomplete.");
moveParent.children = [];
const deletedTerminalKif = exportShogiRecord(deletedTerminalAtlas);
if (deletedTerminalKif.includes("封じ手") || !deletedTerminalKif.includes("７六歩")) {
  throw new Error("Deleting a terminal subtree did not produce a valid shortened KIF.");
}
console.log("verify:shogi:cloud-delete-and-legacy-repair:passed");

const promotionNodes = ["8f8h", "8f8h+"].map((usi, index) => ({
  id: `promotion-${index}`,
  title: usi,
  structuredContent: {
    kind: "shogi-record",
    schemaVersion: 1,
    role: "move",
    recordId: "promotion-record",
    sourceFormat: "kif",
    ply: 1,
    sfen: "4k4/9/9/9/9/1R7/9/9/4K4 b - 1",
    usi,
    displayText: usi,
  },
} as any));
const promotionArrows = buildShogiCandidateArrows(promotionNodes, "sente");
if (promotionArrows.length !== 2 || promotionArrows.some((arrow) => !arrow.from || !arrow.from.every(Number.isFinite) || !arrow.to.every(Number.isFinite))) {
  throw new Error("Promotion candidate arrows did not produce finite source and destination points.");
}
if (promotionArrows[0].to[0] === promotionArrows[1].to[0] && promotionArrows[0].to[1] === promotionArrows[1].to[1]) {
  throw new Error("Promotion candidate arrows were not separated at the shared destination.");
}
const promotionCenter = [150, 750];
if (promotionArrows.some((arrow) => Math.abs(arrow.to[1] - promotionCenter[1]) > 0.001)) {
  throw new Error(`Promotion suffix changed the destination rank: ${JSON.stringify(promotionArrows.map((arrow) => arrow.to))}`);
}
if (!(promotionArrows[0].to[0] > promotionCenter[0] && promotionArrows[1].to[0] < promotionCenter[0])) {
  throw new Error(`Promotion arrows do not straddle their shared destination: ${JSON.stringify(promotionArrows.map((arrow) => arrow.to))}`);
}
const reversedPromotionArrows = buildShogiCandidateArrows(promotionNodes, "gote");
if (reversedPromotionArrows.some((arrow) => Math.abs(arrow.to[1] - 150) > 0.001)) {
  throw new Error(`Flipped promotion arrows use the wrong destination rank: ${JSON.stringify(reversedPromotionArrows.map((arrow) => arrow.to))}`);
}
console.log("verify:shogi:candidate-arrows:passed promotion-branch");

const dropNodes = ["P*5e", "G*5e"].map((usi, index) => ({
  id: `drop-${index}`,
  title: usi,
  structuredContent: {
    kind: "shogi-record",
    schemaVersion: 1,
    role: "move",
    recordId: "drop-record",
    sourceFormat: "kif",
    ply: 1,
    sfen: "4k4/9/9/9/9/9/9/9/4K4 b PG 1",
    usi,
    displayText: usi,
  },
} as any));
const dropTargets = buildShogiCandidateTargets(buildShogiCandidateArrows(dropNodes, "sente"));
if (dropTargets.length !== 1 || dropTargets[0].node.id !== dropNodes[0].id || !dropTargets[0].isDrop) {
  throw new Error("A shared drop destination must expose one marker bound to the first variation.");
}
const invalidCandidate = {
  ...dropNodes[0],
  id: "invalid",
  structuredContent: { ...dropNodes[0].structuredContent, usi: "8h+" },
};
if (buildShogiCandidateArrows([invalidCandidate], "sente").length !== 0) {
  throw new Error("Malformed candidate USI should not create an off-board arrow.");
}
console.log("verify:shogi:candidate-arrows:passed drop-and-invalid");

// ---------------------------------------------------------------------------
// Promoted pieces are named the way a board names them, not the way KIF spells
// them. Nothing Mind Atlas draws may still read 成銀 / 成桂 / 成香.
// ---------------------------------------------------------------------------

if (toShogiBoardNotation("同　成銀(23)") !== "同　全(23)") throw new Error("Promoted silver is not shown as 全.");
if (toShogiBoardNotation("２四成桂(36)") !== "２四圭(36)") throw new Error("Promoted knight is not shown as 圭.");
if (toShogiBoardNotation("１三成香(15)") !== "１三杏(15)") throw new Error("Promoted lance is not shown as 杏.");
// The promotion suffix and 不成 are different words and must survive untouched.
if (toShogiBoardNotation("２二角成(88)") !== "２二角成(88)") throw new Error("The promotion suffix was rewritten.");
if (toShogiBoardNotation("７七桂不成(89)") !== "７七桂不成(89)") throw new Error("不成 was rewritten.");
console.log("verify:shogi:promoted-piece-text:passed");

const promotedSource = TsshogiRecord.newByUSI(
  "startpos moves 7g7f 3c3d 8h2b+ 3a2b B*4e 2b3c 4e3d 3c3d P*3c 2a3c 3i4h 3c4e 4h3i 4e3g+ 3i3h 3g4g",
);
if (promotedSource instanceof Error) throw promotedSource;
const promotedImport = await importShogiRecordFile(new File([exportKIF(promotedSource)], "promoted.kif"));
const promotedTexts: string[] = [];
collectMoveText(promotedImport.root, promotedTexts);
const kifSpelled = promotedTexts.filter((text) => hasKifPromotedPieceText(text));
if (kifSpelled.length) throw new Error(`Imported moves still use KIF promoted-piece text: ${JSON.stringify(kifSpelled)}`);
if (!promotedTexts.some((text) => text.includes("圭"))) {
  throw new Error(`The promoted-knight fixture never produced a 圭 move: ${JSON.stringify(promotedTexts)}`);
}
console.log("verify:shogi:promoted-piece-import:passed");

// A notebook stored before the board forms were adopted is rewritten on load,
// but a title the user typed is left alone.
const legacyRoot = {
  id: "atlas-root", title: "棋譜", body: "", children: [{
    id: "record", title: "record", body: "",
    structuredContent: { kind: "shogi-record", schemaVersion: 1, role: "record-root", recordId: "r", sourceFormat: "kif", ply: 0, sfen: "x" },
    children: [
      { id: "m1", title: "同　成銀(23)", body: "", structuredContent: { kind: "shogi-record", schemaVersion: 1, role: "move", recordId: "r", sourceFormat: "kif", ply: 1, sfen: "x", displayText: "同　成銀(23)" }, children: [] },
      { id: "m2", title: "私の勝負手 成銀", body: "", structuredContent: { kind: "shogi-record", schemaVersion: 1, role: "move", recordId: "r", sourceFormat: "kif", ply: 1, sfen: "x", displayText: "２四成桂(36)" }, children: [] },
    ],
  }],
} as unknown as AtlasNode;
const migrated = normalizeShogiNotebookNotation(legacyRoot);
if (!migrated) throw new Error("A legacy notebook was not migrated.");
const migratedMoves = migrated.children[0].children;
if (migratedMoves[0].title !== "同　全(23)" || migratedMoves[0].structuredContent?.displayText !== "同　全(23)") {
  throw new Error(`The generated title was not migrated: ${JSON.stringify(migratedMoves[0])}`);
}
if (migratedMoves[1].title !== "私の勝負手 成銀") throw new Error("A hand-written title was rewritten by the migration.");
if (migratedMoves[1].structuredContent?.displayText !== "２四圭(36)") throw new Error("The move text under a hand-written title was not migrated.");
if (normalizeShogiNotebookNotation(migrated) !== null) throw new Error("The migration is not idempotent.");
console.log("verify:shogi:promoted-piece-migration:passed");

// ---------------------------------------------------------------------------
// Replaying to the next and previous branching position.
// ---------------------------------------------------------------------------

const branchSource = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d 2g2f 8c8d 2f2e");
if (branchSource instanceof Error) throw branchSource;
branchSource.goto(3);
const sideLine = branchSource.position.createMoveByUSI("4c4d");
if (!sideLine || !branchSource.append(sideLine)) throw new Error("Could not create the branch-navigation fixture.");
const branchImport = await importShogiRecordFile(new File([exportKIF(branchSource)], "branches.kif"));
const branchRecordRoot = branchImport.root.children[0];
const memory = new Map<string, string>();
const forwardSteps = pathToNextBranchPoint(memory, branchRecordRoot);
if (!forwardSteps.length) throw new Error("No branching position was found ahead of the record root.");
if (!isBoardBranchPoint(forwardSteps[forwardSteps.length - 1])) throw new Error("The forward replay did not stop on a fork.");
if (forwardSteps.some((node, index) => index < forwardSteps.length - 1 && isBoardBranchPoint(node))) {
  throw new Error("The forward replay walked past a nearer fork.");
}
// Every intermediate move is replayed, so the user sees the line being played.
if (forwardSteps.length < 2) throw new Error(`The forward replay skipped the moves in between: ${forwardSteps.length}`);
const forkNode = forwardSteps[forwardSteps.length - 1];
const deepNode = findRecordTailNode(forkNode.children[0]);
const backSteps = pathToPreviousBranchPoint(branchRecordRoot, deepNode);
if (!backSteps.length) throw new Error("No branching position was found behind the tail.");
if (backSteps[backSteps.length - 1].id !== forkNode.id) throw new Error("The backward replay did not stop on the nearest fork.");
if (pathToNextBranchPoint(memory, deepNode).length) throw new Error("A fork was reported ahead of the record tail.");
if (pathToPreviousBranchPoint(branchRecordRoot, branchRecordRoot).length) throw new Error("A fork was reported behind the record root.");
// The whole replay is about half a second, and each step stays visible.
for (const [steps, minimum, maximum] of [[2, 26, 260], [8, 26, 110], [40, 26, 110]] as const) {
  const stepMs = branchReplayStepMs(steps);
  if (stepMs < minimum || stepMs > maximum) throw new Error(`Replay pacing is out of range for ${steps} steps: ${stepMs}ms`);
}
if (branchReplayStepMs(8) * 8 > 700) throw new Error("An eight-move replay takes noticeably longer than half a second.");
if (branchReplayStepMs(1) !== 0) throw new Error("A single-step replay should not be paced.");
console.log("verify:shogi:branch-replay:passed");

// ---------------------------------------------------------------------------
// A merged branch names the record it came from.
// ---------------------------------------------------------------------------

const baseRecord = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d 2g2f");
if (baseRecord instanceof Error) throw baseRecord;
const otherRecord = TsshogiRecord.newByUSI("startpos moves 7g7f 3c3d 6i7h");
if (otherRecord instanceof Error) throw otherRecord;
otherRecord.metadata.setStandardMetadata("date" as never, "2026/03/14");
otherRecord.metadata.setStandardMetadata("blackName" as never, "佐藤");
otherRecord.metadata.setStandardMetadata("whiteName" as never, "鈴木");
otherRecord.metadata.setStandardMetadata("tournament" as never, "研究会");
const destination = await importShogiRecordFile(new File([exportKIF(baseRecord)], "base.kif"));
const incoming = await importShogiRecordFile(new File([exportKIF(otherRecord)], "other.kif"));
const merged = mergeBoardRecords(destination.root, incoming.root, { strategy: "record-root" });
if (!merged.addedBranches) throw new Error("The provenance fixture did not add a branch.");
const branchFirstMoves: AtlasNode[] = [];
collectProvenanceNodes(merged.root, branchFirstMoves);
if (branchFirstMoves.length !== 1) {
  throw new Error(`Exactly the first move of the added branch should carry the source record: ${branchFirstMoves.length}`);
}
const provenance = findRecordProvenance(branchFirstMoves[0]);
if (!provenance) throw new Error("The merged branch has no readable source record.");
for (const expected of ["2026/03/14", "佐藤", "鈴木", "研究会"]) {
  if (!provenance.headline.includes(expected) && !provenance.entries.some(([, value]) => value.includes(expected))) {
    throw new Error(`The source record summary lost ${expected}: ${JSON.stringify(provenance)}`);
  }
}
if (!provenance.headline.includes("vs")) throw new Error(`The two players are not paired: ${provenance.headline}`);
// Unknown header keys must still reach the reader rather than being dropped.
const customProvenance = findRecordProvenance({
  structuredContent: { sourceRecordMetadata: { "独自項目": "手元の記録" } },
} as unknown as AtlasNode);
if (!customProvenance || !customProvenance.headline.includes("手元の記録")) {
  throw new Error(`An unrecognized header key was dropped: ${JSON.stringify(customProvenance)}`);
}
// The field survives the export sanitizer, so cloud save and share keep it.
const sanitizedProvenance = sanitizeStructuredContentForExport(branchFirstMoves[0].structuredContent);
if (!sanitizedProvenance || !("sourceRecordMetadata" in sanitizedProvenance)) {
  throw new Error("The source record header did not survive the export sanitizer.");
}

// The header belongs in the node body, where notes about a move already live
// and where export, sharing and editing reach it - not in a panel beside the
// board that only the merged branch could ever show.
const provenanceBody = branchFirstMoves[0].body ?? "";
if (!provenanceBody.includes(RECORD_PROVENANCE_HEADING)) {
  throw new Error(`The merged branch did not record its source in the body: ${JSON.stringify(provenanceBody)}`);
}
for (const expected of ["2026/03/14", "佐藤", "鈴木", "研究会"]) {
  if (!provenanceBody.includes(expected)) {
    throw new Error(`The source header lost ${expected} on its way into the body: ${JSON.stringify(provenanceBody)}`);
  }
}

// Merging the same record twice must not stack copies of the same header.
const twiceMerged = mergeBoardRecords(merged.root, incoming.root, { strategy: "record-root" });
const twiceBodies: string[] = [];
const collectBodies = (node: AtlasNode) => {
  if (node.structuredContent?.sourceRecordMetadata) twiceBodies.push(node.body ?? "");
  node.children.forEach(collectBodies);
};
collectBodies(twiceMerged.root);
for (const body of twiceBodies) {
  if (body.split(RECORD_PROVENANCE_HEADING).length > 2) {
    throw new Error(`A repeated merge duplicated the source header: ${JSON.stringify(body)}`);
  }
}

// Records merged before the header moved into the body keep it only in
// structured content; loading one has to write it through.
const legacyBranch: AtlasNode = {
  ...branchFirstMoves[0],
  body: "",
  children: [],
};
const provenanceMigrated = normalizeRecordProvenanceBodies({ ...merged.root, children: [legacyBranch] } as AtlasNode);
if (!provenanceMigrated || !provenanceMigrated.children[0].body.includes(RECORD_PROVENANCE_HEADING)) {
  throw new Error("An older merged record did not gain its source header on load.");
}
if (normalizeRecordProvenanceBodies(provenanceMigrated) !== null) {
  throw new Error("The load-time migration rewrote a record that already carried its header.");
}
console.log("verify:shogi:merged-branch-provenance:passed");

function collectMoveText(node: AtlasNode, into: string[]) {
  const content = node.structuredContent;
  if (content?.kind === "shogi-record" && content.role === "move") {
    into.push(node.title);
    if (content.displayText) into.push(content.displayText);
  }
  for (const child of node.children) collectMoveText(child, into);
}

function collectProvenanceNodes(node: AtlasNode, into: AtlasNode[]) {
  if (node.structuredContent?.sourceRecordMetadata) into.push(node);
  for (const child of node.children) collectProvenanceNodes(child, into);
}

function findRecordTailNode(node: AtlasNode): AtlasNode {
  const moves = node.children.filter((child) => child.structuredContent?.role === "move");
  return moves.length ? findRecordTailNode(moves[0]) : node;
}


function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function sanitizeBoardTree<T extends { structuredContent?: unknown; children: T[] }>(node: T): T {
  const clone = structuredClone(node);
  const structuredContent = sanitizeStructuredContentForExport(clone.structuredContent);
  if (structuredContent) clone.structuredContent = structuredContent;
  else delete clone.structuredContent;
  clone.children = clone.children.map(sanitizeBoardTree);
  return clone;
}

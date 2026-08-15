import { exportCSA, exportKI2, exportKIF, Record as TsshogiRecord } from "tsshogi";
import { exportShogiRecord, importShogiRecordFile } from "../src/features/shogi/shogiRecord.ts";
import { buildShogiCandidateArrows, buildShogiCandidateTargets } from "../src/features/shogi/shogiCandidates.ts";

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

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

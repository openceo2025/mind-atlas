import { exportCSA, exportKI2, exportKIF, Record as TsshogiRecord } from "tsshogi";
import { exportShogiRecord, importShogiRecordFile } from "../src/features/shogi/shogiRecord.ts";

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

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

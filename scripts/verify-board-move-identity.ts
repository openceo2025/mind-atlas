import { Position } from "tsshogi";
import { boardMoveIdentity } from "../src/features/board/boardMoveIdentity.ts";
import { deduplicateBoardRecordMoves } from "../src/features/board/boardMoveDeduplication.ts";
import { normalizeShogiNotebookNotation } from "../src/features/shogi/shogiNotation.ts";
import type { AtlasNode, AtlasStructuredContent } from "../src/types.ts";

const startSfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const position = Position.newBySFEN(startSfen);
const move = position?.createMoveByUSI("7g7f");
if (!position || !move || !position.isValidMove(move) || !position.doMove(move)) {
  throw new Error("Could not create the board move identity fixture.");
}

const shogiContent = (id: string, title: string, body: string): AtlasNode => ({
  id,
  kind: "thread",
  nodeType: "note",
  title,
  subtitle: "",
  body,
  author: "human",
  status: "waiting",
  color: "#fff",
  texture: "speckled",
  radius: 28,
  summary: title,
  nextDecision: "",
  tags: [],
  attachments: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  structuredContent: {
    kind: "shogi-record",
    schemaVersion: 1,
    role: "move",
    recordId: "record",
    sourceFormat: "kif",
    ply: 1,
    sfen: position.sfen,
    usi: "7g7f",
    displayText: "７六歩(77)",
  },
  children: [],
});

const first = shogiContent("first", "７六歩(77)", "first note");
const duplicate = { ...shogiContent("duplicate", "▲7六歩", "second note"), children: [{ ...shogiContent("grandchild", "次の手", ""), structuredContent: undefined }] };
const root: AtlasNode = {
  ...shogiContent("root", "将棋", ""),
  notebookMode: "shogi",
  structuredContent: {
    kind: "shogi-record",
    schemaVersion: 1,
    role: "record-root",
    recordId: "record",
    sourceFormat: "kif",
    ply: 0,
    sfen: startSfen,
  },
  children: [first, duplicate],
};

if (boardMoveIdentity(first) !== "shogi:7g7f") throw new Error("Shogi move identity was not normalized.");
const normalizedRoot = normalizeShogiNotebookNotation(root) ?? root;
if (normalizedRoot.children[0]?.title !== "７六歩(77)" || normalizedRoot.children[1]?.title !== "７六歩(77)") {
  throw new Error("Generated shogi move titles were not normalized before deduplication.");
}
const repaired = deduplicateBoardRecordMoves(normalizedRoot);
if (!repaired.changed || repaired.root.children.length !== 1 || repaired.removedNodeIds.join(",") !== "duplicate") {
  throw new Error(`Duplicate shogi siblings were not merged: ${JSON.stringify(repaired.removedNodeIds)}`);
}
if (repaired.root.children[0]?.title !== "７六歩(77)") throw new Error("Equivalent generated titles were merged unnecessarily.");
if (repaired.root.children[0]?.body !== "first note\nsecond note") throw new Error("Duplicate move notes were not preserved.");
console.log("verify:board-move-identity:shogi-deduplication:passed");

for (const [mode, contentA, contentB] of [
  ["chess", { kind: "chess-record", role: "move", uci: "e2e4" }, { kind: "chess-record", role: "move", uci: "e2e4" }],
  ["go", { kind: "go-record", role: "move", color: "B", vertex: "D4" }, { kind: "go-record", role: "move", color: "b", vertex: "d4" }],
] as const) {
  const left = boardMoveIdentity({ ...(contentA as unknown as AtlasStructuredContent), schemaVersion: 1 } as AtlasStructuredContent);
  const right = boardMoveIdentity({ ...(contentB as unknown as AtlasStructuredContent), schemaVersion: 1 } as AtlasStructuredContent);
  if (!left || left !== right || !left.startsWith(`${mode}:`)) {
    throw new Error(`${mode} move identity did not collapse equivalent notation: ${left} / ${right}`);
  }
}
console.log("verify:board-move-identity:cross-board:passed");

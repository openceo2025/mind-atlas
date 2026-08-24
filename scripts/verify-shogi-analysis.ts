import {
  SHOGI_ANALYSIS_MAX_LINE_NODES,
  appendShogiAnalysisEntry,
  appendShogiAnalysisLine,
  buildShogiAnalysisLine,
  describeShogiScore,
  formatShogiAnalysisEntry,
  formatShogiAnalysisFailure,
  formatShogiAnalysisStamp,
  readShogiRecordContent,
  sideToMoveFromSfen,
} from "../src/features/shogi/shogiAnalysis.ts";
import type { AtlasNode, ShogiAnalysisResult, ShogiRecordContent } from "../src/types.ts";

const START_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

function analysisResult(patch: Partial<ShogiAnalysisResult> = {}): ShogiAnalysisResult {
  return {
    engine: { id: "yaneuraou-suisho5", name: "YaneuraOu NNUE 9.40", label: "やねうら王 + 水匠5" },
    analyzedAt: "2026-08-23T12:40:00.000Z",
    sfen: START_SFEN,
    sideToMove: "sente",
    movetimeMs: 5000,
    depth: 24,
    seldepth: 32,
    nodes: 12_000_000,
    nps: 2_400_000,
    elapsedMs: 5010,
    terminal: false,
    book: false,
    score: { kind: "cp", sente: 62 },
    bestMove: "7g7f",
    pv: ["7g7f", "3c3d", "2g2f", "8c8d", "2f2e", "8d8e"],
    ...patch,
  };
}

function moveNode(id: string, content: Partial<ShogiRecordContent> & Pick<ShogiRecordContent, "sfen">): AtlasNode {
  return {
    id,
    kind: "thread",
    nodeType: "human_prompt",
    title: content.displayText ?? id,
    subtitle: "human prompt",
    body: "",
    author: "human",
    status: "waiting",
    color: "#8bd8d2",
    texture: "rock",
    radius: 1,
    summary: "",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    children: [],
    structuredContent: {
      kind: "shogi-record",
      schemaVersion: 1,
      role: "move",
      recordId: "record-1",
      sourceFormat: "kif",
      ply: 0,
      ...content,
    },
  } as AtlasNode;
}

/** Stands in for the store's node factory: a plain node with no board content. */
let nextNodeId = 0;
const nodeFactory = (_parentId: string, _index: number, title: string, body: string): AtlasNode => {
  const node = moveNode(`generated-${(nextNodeId += 1)}`, { sfen: "pending" });
  return { ...node, title, body, structuredContent: undefined };
};

// --- side to move -----------------------------------------------------------
if (sideToMoveFromSfen(START_SFEN) !== "sente") throw new Error("The opening position must be sente to move.");
if (sideToMoveFromSfen("lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2") !== "gote") {
  throw new Error("A `w` side-to-move field must read as gote.");
}
console.log("verify:shogi-analysis:side-to-move:passed");

// --- evaluation wording -----------------------------------------------------
const scoreCases: Array<[ShogiAnalysisResult["score"], string]> = [
  [{ kind: "cp", sente: 62 }, "+62（先手やや有利）"],
  [{ kind: "cp", sente: -350 }, "-350（後手有利）"],
  [{ kind: "cp", sente: 12 }, "+12（互角）"],
  [{ kind: "cp", sente: 0 }, "0（互角）"],
  [{ kind: "cp", sente: -1500 }, "-1500（後手勝勢）"],
  [{ kind: "mate", sente: 17 }, "先手勝ち（17手詰）"],
  [{ kind: "mate", sente: -13 }, "後手勝ち（13手詰）"],
  [null, "不明"],
];
for (const [score, expected] of scoreCases) {
  const actual = describeShogiScore(score);
  if (actual !== expected) throw new Error(`Evaluation wording mismatch: ${actual} !== ${expected}`);
}
console.log(`verify:shogi-analysis:score-wording:passed cases=${scoreCases.length}`);

// --- principal variation replay ---------------------------------------------
const steps = buildShogiAnalysisLine(START_SFEN, 0, analysisResult().pv, 24);
if (steps.length !== 6) throw new Error(`The whole legal principal variation must replay: ${steps.length}`);
if (steps[0].pvText !== "▲７六歩") throw new Error(`Unexpected first move text: ${steps[0].pvText}`);
if (steps[1].pvText !== "△３四歩") throw new Error(`Unexpected second move text: ${steps[1].pvText}`);
if (steps[0].ply !== 1 || steps[5].ply !== 6) throw new Error("Ply numbering must continue from the analyzed node.");
if (sideToMoveFromSfen(steps[0].sfen) !== "gote") throw new Error("The position after a sente move must be gote to move.");
console.log(`verify:shogi-analysis:pv-replay:passed steps=${steps.length}`);

const truncated = buildShogiAnalysisLine(START_SFEN, 0, ["7g7f", "9i9h", "3c3d"], 24);
if (truncated.length !== 1) throw new Error(`An illegal continuation must stop the line: ${truncated.length}`);
console.log("verify:shogi-analysis:pv-truncation:passed");

const limited = buildShogiAnalysisLine(START_SFEN, 0, analysisResult().pv, SHOGI_ANALYSIS_MAX_LINE_NODES);
if (limited.length !== SHOGI_ANALYSIS_MAX_LINE_NODES) throw new Error("The node limit must cap the replay.");
if (buildShogiAnalysisLine("not-a-position", 0, ["7g7f"], 5).length !== 0) {
  throw new Error("An unreadable position must produce no steps.");
}
console.log("verify:shogi-analysis:pv-limit:passed");

// --- body text --------------------------------------------------------------
const entry = formatShogiAnalysisEntry(analysisResult(), steps);
const entryLines = entry.split("\n");
// The evaluation is the answer, so it is the first thing in the block. Anything
// above it would push it out of view on a phone behind provenance nobody reads
// first.
if (entryLines[0] !== "評価値: +62（先手やや有利）") throw new Error(`The evaluation must lead the block:\n${entry}`);
if (entryLines[1] !== "最善手: ▲７六歩") throw new Error(`The best move must follow the evaluation:\n${entry}`);
if (!entryLines[2].startsWith("読み筋: ▲７六歩 △３四歩")) throw new Error(`The reading must follow the best move:\n${entry}`);
if (entryLines[3] !== "やねうら王 + 水匠5（5秒 / 深さ24） 2026-08-23 21:40") {
  throw new Error(`Provenance must close the block, not open it:\n${entry}`);
}
if (entryLines.length !== 4) throw new Error(`The block must be exactly four lines:\n${entry}`);
if (entry.includes("AI解析") || entry.includes("エンジン:")) throw new Error(`The old header must be gone:\n${entry}`);
if (entry.includes("─")) throw new Error("The block must use ASCII rules so KIF comments survive Shift_JIS export.");

const terminalEntry = formatShogiAnalysisEntry(analysisResult({ pv: [], bestMove: "resign", terminal: true }), []);
if (!terminalEntry.includes("最善手: なし")) throw new Error("A terminal position must still record an entry.");

const appended = appendShogiAnalysisEntry(appendShogiAnalysisEntry("元の本文", entry), terminalEntry);
if (!appended.startsWith("元の本文\n\n評価値: ")) throw new Error("Entries must append after the existing body.");
if (appended.split("評価値: ").length !== 3) throw new Error("Repeated analysis must keep every block.");
if (appendShogiAnalysisEntry("", entry) !== entry) throw new Error("An empty body must not gain leading blank lines.");

const stamp = formatShogiAnalysisStamp(analysisResult());
if (!stamp.includes("読み筋から作成")) throw new Error("Generated move nodes must say where they came from.");
if (stamp.includes("評価値")) throw new Error("Generated move nodes must not repeat the evaluation.");

// A book answer is a different kind of claim from a search and has to read as
// one: it did not think for five seconds, so it must not say that it did.
const bookResult = analysisResult({ book: true, depth: 0, seldepth: 0, nodes: 0, nps: 0, elapsedMs: 47, score: { kind: "cp", sente: 44 }, bestMove: "7g7f", pv: ["7g7f", "8c8d"] });
const bookSteps = buildShogiAnalysisLine(START_SFEN, 0, bookResult.pv, 24);
const bookEntry = formatShogiAnalysisEntry(bookResult, bookSteps);
if (!bookEntry.includes("やねうら王 + 水匠5（定跡）")) throw new Error(`A book answer must say so:\n${bookEntry}`);
if (bookEntry.includes("秒")) throw new Error("A book answer must not claim a search budget it never spent.");
if (!bookEntry.includes("最善手: ▲７六歩")) throw new Error("A book answer must still name the move.");
if (!formatShogiAnalysisStamp(bookResult).includes("定跡から作成")) throw new Error("Nodes from a book line must say they came from the book.");
console.log("verify:shogi-analysis:book-answer:passed");

const failure = formatShogiAnalysisFailure("やねうら王 + 水匠5", "The shogi engine did not answer in time.", "2026-08-23T12:40:00.000Z");
if (!failure.includes("error: The shogi engine did not answer in time.")) throw new Error("Failures must record the reason.");
console.log("verify:shogi-analysis:body-text:passed");

// --- record growth ----------------------------------------------------------
const analyzed = moveNode("analyzed", { sfen: START_SFEN, ply: 0, role: "record-root", displayText: "開始局面" });
const played = moveNode("played-7g7f", { sfen: steps[0].sfen, ply: 1, usi: "7g7f", displayText: steps[0].displayText });
const root: AtlasNode = { ...analyzed, children: [played] };

const grown = appendShogiAnalysisLine(root, "analyzed", steps.slice(0, SHOGI_ANALYSIS_MAX_LINE_NODES), stamp, nodeFactory);
if (grown.createdIds.length !== 4) {
  throw new Error(`The existing first move must be reused and only the rest created: ${grown.createdIds.length}`);
}
// The notification points at the engine's move. Here that move was already in
// the record, so the reused node has to be reported rather than nothing.
if (grown.firstMoveNodeId !== "played-7g7f") {
  throw new Error(`The reused first move must be the notification target: ${grown.firstMoveNodeId}`);
}
const fresh = appendShogiAnalysisLine(analyzed, "analyzed", steps.slice(0, 2), stamp, nodeFactory);
if (!fresh.firstMoveNodeId || fresh.firstMoveNodeId !== fresh.createdIds[0]) {
  throw new Error(`A newly created first move must be the notification target: ${fresh.firstMoveNodeId}`);
}
if (appendShogiAnalysisLine(analyzed, "analyzed", [], stamp, nodeFactory).firstMoveNodeId !== null) {
  throw new Error("A position with no continuation must report no move node.");
}
const reused = grown.root.children.filter((child) => readShogiRecordContent(child)?.usi === "7g7f");
if (reused.length !== 1) throw new Error("Reusing a move must not duplicate it as a sibling.");

let cursor: AtlasNode | undefined = grown.root.children[0];
const line: string[] = [];
while (cursor) {
  const content = readShogiRecordContent(cursor);
  if (content?.usi) line.push(content.usi);
  cursor = cursor.children[0];
}
if (line.join(" ") !== "7g7f 3c3d 2g2f 8c8d 2f2e") throw new Error(`The line was not extended in order: ${line.join(" ")}`);

const generated = grown.root.children[0].children[0];
if (generated.body !== stamp) throw new Error("A generated move node must carry the analysis stamp.");
if (readShogiRecordContent(generated)?.ply !== 2) throw new Error("Generated nodes must continue the ply count.");
if (generated.author !== "human" || generated.nodeType !== "human_prompt") {
  throw new Error("Generated nodes must be indistinguishable from human-played move nodes.");
}

const again = appendShogiAnalysisLine(grown.root, "analyzed", steps.slice(0, SHOGI_ANALYSIS_MAX_LINE_NODES), stamp, nodeFactory);
if (again.createdIds.length !== 0) throw new Error("Re-analyzing the same line must not duplicate any node.");
console.log(`verify:shogi-analysis:record-growth:passed created=${grown.createdIds.length}`);

console.log("verify:shogi-analysis:passed");

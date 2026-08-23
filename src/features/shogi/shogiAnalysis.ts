import { formatKIFMove, Position } from "tsshogi";
import { toShogiBoardNotation } from "./shogiNotation.ts";
import type { AtlasNode, ShogiAnalysisResult, ShogiRecordContent } from "../../types";

/**
 * Engine analysis, as the record sees it.
 *
 * Two products come out of one engine answer: a human-readable block appended
 * to the analyzed node, and a short line of real move nodes. The nodes are
 * ordinary record nodes - the same shape a human move or a merged variation
 * produces - so nothing downstream has to special-case "engine moves".
 *
 * Every string written into a notebook body is Japanese on purpose. Bodies are
 * persisted data that round-trip through KIF comments, so localizing them at
 * write time would freeze whatever language the author happened to be using.
 */

/** How many moves of the principal variation become real nodes. */
export const SHOGI_ANALYSIS_MAX_LINE_NODES = 5;

const ANALYSIS_BLOCK_PREFIX = "--- AI解析 ";

export interface ShogiAnalysisLineStep {
  usi: string;
  /** Move text in the same convention human-played move nodes use. */
  displayText: string;
  /** Compact move text for the reading line, e.g. `▲７六歩`. */
  pvText: string;
  /** Position after the move. */
  sfen: string;
  ply: number;
}

export function sideToMoveFromSfen(sfen: string): "sente" | "gote" {
  return sfen.split(" ")[1] === "w" ? "gote" : "sente";
}

/**
 * Replays the principal variation from a position, keeping only the prefix that
 * is actually legal. A truncated or stale PV therefore degrades to a shorter
 * line instead of poisoning the record with impossible moves.
 */
export function buildShogiAnalysisLine(startSfen: string, startPly: number, pv: string[], limit: number): ShogiAnalysisLineStep[] {
  const position = Position.newBySFEN(startSfen);
  if (!position) return [];
  const steps: ShogiAnalysisLineStep[] = [];
  for (const usi of pv) {
    if (steps.length >= limit) break;
    const move = position.createMoveByUSI(usi);
    if (!move || !position.isValidMove(move)) break;
    const color = sideToMoveFromSfen(position.sfen);
    const displayText = toShogiBoardNotation(formatKIFMove(move));
    if (!position.doMove(move)) break;
    steps.push({
      usi,
      displayText,
      pvText: toPvMoveText(displayText, color),
      sfen: position.sfen,
      ply: startPly + steps.length + 1,
    });
  }
  return steps;
}

/** `７六歩(77)` plus the mover's mark, trimmed to how a reading line reads. */
function toPvMoveText(displayText: string, color: "sente" | "gote"): string {
  const mark = color === "sente" ? "▲" : "△";
  const compact = displayText.replace(/\([0-9]{2}\)\s*$/, "").replace(/　/g, "");
  return `${mark}${compact}`;
}

/**
 * Sente-positive evaluation, in the words a shogi player expects. The engine
 * already normalized the sign, so this is purely presentation.
 */
export function describeShogiScore(score: ShogiAnalysisResult["score"]): string {
  if (!score) return "不明";
  if (score.kind === "mate") {
    if (score.sente === 0) return "詰み";
    const winner = score.sente > 0 ? "先手" : "後手";
    return `${winner}勝ち（${Math.abs(score.sente)}手詰）`;
  }
  const value = score.sente;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  return `${sign}${magnitude}（${describeAdvantage(value)}）`;
}

function describeAdvantage(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 50) return "互角";
  const side = value > 0 ? "先手" : "後手";
  if (magnitude < 200) return `${side}やや有利`;
  if (magnitude < 600) return `${side}有利`;
  if (magnitude < 1200) return `${side}優勢`;
  return `${side}勝勢`;
}

export function formatShogiAnalysisTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function engineLine(result: ShogiAnalysisResult): string {
  const label = result.engine.label || "やねうら王 + 水匠5";
  const seconds = Math.round(result.movetimeMs / 100) / 10;
  const depth = result.depth > 0 ? ` / 深さ${result.depth}` : "";
  return `エンジン: ${label}（${seconds}秒${depth}）`;
}

/** The block appended to the node the user asked about. */
export function formatShogiAnalysisEntry(result: ShogiAnalysisResult, steps: ShogiAnalysisLineStep[]): string {
  const lines = [
    `${ANALYSIS_BLOCK_PREFIX}${formatShogiAnalysisTimestamp(result.analyzedAt)} ---`,
    engineLine(result),
    `評価値: ${describeShogiScore(result.score)}`,
  ];
  if (steps.length) {
    lines.push(`最善手: ${steps[0].pvText}`);
    lines.push(`読み筋: ${steps.map((step) => step.pvText).join(" ")}`);
  } else {
    lines.push("最善手: なし（終局または指す手がない局面）");
  }
  return lines.join("\n");
}

/**
 * The stamp written into the move nodes this analysis created. They carry only
 * when and with what the line was produced; the evaluation itself belongs to
 * the position that was actually analyzed.
 */
export function formatShogiAnalysisStamp(result: ShogiAnalysisResult): string {
  const label = result.engine.label || "やねうら王 + 水匠5";
  return `${ANALYSIS_BLOCK_PREFIX}${formatShogiAnalysisTimestamp(result.analyzedAt)} ---\nエンジン: ${label} の読み筋から作成`;
}

/** Failure leaves a trace on the analyzed node and creates nothing else. */
export function formatShogiAnalysisFailure(engineLabel: string, message: string, analyzedAt = new Date().toISOString()): string {
  const reason = message.trim().replace(/\s+/g, " ").slice(0, 200) || "原因不明のエラー";
  return `${ANALYSIS_BLOCK_PREFIX}${formatShogiAnalysisTimestamp(analyzedAt)} ---\nエンジン: ${engineLabel}\nerror: ${reason}`;
}

/** Appends one block to a body, keeping a blank line between entries. */
export function appendShogiAnalysisEntry(body: string, entry: string): string {
  const current = body.replace(/\s+$/, "");
  return current ? `${current}\n\n${entry}` : entry;
}

export function readShogiRecordContent(node: AtlasNode | undefined | null): ShogiRecordContent | null {
  return node?.structuredContent?.kind === "shogi-record" ? node.structuredContent : null;
}

export type ShogiMoveNodeFactory = (parentId: string, index: number, title: string, body: string) => AtlasNode;

/**
 * Materializes the engine reading as ordinary record nodes.
 *
 * A principal variation usually opens with moves the record already contains -
 * the engine tends to agree with what was actually played - so each step reuses
 * the matching child and only branches where the reading leaves the known tree.
 * The nodes it creates are indistinguishable from a human move or a merged
 * variation, which is what keeps export, merge and navigation unaware of them.
 */
export function appendShogiAnalysisLine(
  root: AtlasNode,
  analyzedNodeId: string,
  steps: ShogiAnalysisLineStep[],
  stampBody: string,
  createMoveNode: ShogiMoveNodeFactory,
): { root: AtlasNode; createdIds: string[] } {
  let nextRoot = root;
  let parentId = analyzedNodeId;
  const createdIds: string[] = [];
  const now = new Date().toISOString();

  for (const step of steps) {
    const parent = findNodeById(nextRoot, parentId);
    const parentContent = readShogiRecordContent(parent);
    if (!parent || !parentContent) break;
    const existing = parent.children.find((child) => readShogiRecordContent(child)?.usi === step.usi);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created = createMoveNode(parentId, parent.children.length, step.displayText, stampBody);
    const moveNode: AtlasNode = {
      ...created,
      structuredContent: {
        kind: "shogi-record",
        schemaVersion: 1,
        role: "move",
        recordId: parentContent.recordId,
        sourceFormat: parentContent.sourceFormat,
        ply: parentContent.ply + 1,
        sfen: step.sfen,
        usi: step.usi,
        displayText: step.displayText,
        branchIndex: parent.children.filter((item) => readShogiRecordContent(item)?.role === "move").length,
      },
    };
    nextRoot = replaceNodeById(nextRoot, parentId, (node) => ({
      ...node,
      children: [...node.children, moveNode],
      updatedAt: now,
    }));
    createdIds.push(moveNode.id);
    parentId = moveNode.id;
  }

  return { root: nextRoot, createdIds };
}

function findNodeById(node: AtlasNode, id: string): AtlasNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function replaceNodeById(node: AtlasNode, id: string, updater: (node: AtlasNode) => AtlasNode): AtlasNode {
  if (node.id === id) return updater(node);
  let changed = false;
  const children = node.children.map((child) => {
    const next = replaceNodeById(child, id, updater);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

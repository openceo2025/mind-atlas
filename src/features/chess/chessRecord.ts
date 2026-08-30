import {
  ChildNode,
  makePgn,
  Node,
  parsePgn,
  startingPosition,
  type Game,
  type PgnNodeData,
} from "chessops/pgn";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import type { Position } from "chessops/chess";
import type { AtlasNode, ChessRecordContent } from "../../types";
import { decodeRecordComment, encodeRecordComment } from "../board/recordComment.ts";
import {
  assertBoardRecordExportable,
  assertBoardRecordFileWithinLimits,
  assertBoardRecordTextWithinLimits,
  assertParsedRecordTreeWithinLimits,
  decodeUtf8BoardRecord,
} from "../board/boardRecordSafety.ts";

export interface ChessImportResult {
  root: AtlasNode;
  recordRootId: string;
  datasetName: string;
}

const NODE_COLORS = ["#8eb7e5", "#f0c674", "#d88989", "#a79be8", "#83cfaa"];

export function detectChessRecordFormat(fileName: string) {
  return fileName.toLowerCase().endsWith(".pgn") ? "pgn" : null;
}

export async function importChessRecordFile(file: File): Promise<ChessImportResult> {
  if (!detectChessRecordFormat(file.name)) throw new Error("Unsupported chess record. Use PGN.");
  assertBoardRecordFileWithinLimits(file, "PGN");
  const text = decodeUtf8BoardRecord(new Uint8Array(await file.arrayBuffer()), "PGN");
  return importChessRecordText(text, datasetNameFromFile(file.name));
}

export function importChessRecordText(text: string, datasetName = "Imported chess record"): ChessImportResult {
  assertBoardRecordTextWithinLimits(text, "PGN");
  const games = parsePgn(text);
  if (!games.length) throw new Error("The PGN does not contain a chess game.");
  if (games.length > 1) throw new Error(`This PGN contains ${games.length} games. Multi-game PGN files are not supported yet; import one game at a time.`);
  const game = games[0];
  assertSupportedChessGame(game);
  assertParsedRecordTreeWithinLimits([game.moves], {
    format: "PGN",
    getChildren: (node) => node.children,
    getCommentText: (node) => {
      if (!("data" in node)) return [...(game.comments ?? [])].join("\n");
      const data = (node as ChildNode<PgnNodeData>).data;
      return [...(data.startingComments ?? []), ...(data.comments ?? [])].join("\n");
    },
  });
  return gameToAtlas(game, datasetName);
}

export function createNewChessRecord(datasetName = "New chess game"): ChessImportResult {
  const game: Game<PgnNodeData> = {
    headers: chessHeaders(new Map([["Event", datasetName]])),
    comments: [],
    moves: new Node<PgnNodeData>(),
  };
  return gameToAtlas(game, datasetName);
}

export function exportChessRecord(root: AtlasNode): string {
  assertBoardRecordExportable(root, "chess");
  const recordRoot = findRecordRoot(root);
  const rootContent = findChessNodeContent(recordRoot);
  if (!recordRoot || !rootContent || rootContent.role !== "record-root") {
    throw new Error("Select a node inside an imported chess record first.");
  }
  const position = positionFromFen(rootContent.fen);
  const game: Game<PgnNodeData> = {
    headers: chessHeaders(new Map(Object.entries(rootContent.metadata ?? {}))),
    comments: [encodeRecordComment(recordRoot.title, recordRoot.body)],
    moves: new Node<PgnNodeData>(),
  };
  appendPgnChildren(game.moves, recordRoot, position);
  const text = makePgn(game);
  assertBoardRecordTextWithinLimits(text, "PGN");
  return text;
}

export function findChessRecordRoot(root: AtlasNode, nodeId: string): AtlasNode | null {
  const path = findPath(root, nodeId);
  if (!path) return null;
  return [...path].reverse().find((node) => findChessNodeContent(node)?.role === "record-root") ?? (path.length === 1 ? findFirstRecordRoot(root) : null);
}

export function findChessNodeContent(node: AtlasNode | null | undefined): ChessRecordContent | null {
  const content = node?.structuredContent;
  return content?.kind === "chess-record" ? content : null;
}

export function nearestChessRecordNode(root: AtlasNode, nodeId: string, recordRootId: string): AtlasNode | null {
  const path = findPath(root, nodeId);
  if (!path) return null;
  const start = path.findIndex((node) => node.id === recordRootId);
  return start >= 0 ? [...path].slice(start).reverse().find((node) => findChessNodeContent(node)?.kind === "chess-record") ?? null : null;
}

function gameToAtlas(game: Game<PgnNodeData>, datasetName: string): ChessImportResult {
  const headers = chessHeaders(game.headers);
  const starting = startingPosition(headers);
  const position = starting.unwrap();
  const recordId = makeId("chess-record");
  const recordRootId = makeId("chess-root");
  const now = new Date().toISOString();
  const rootContent: ChessRecordContent = {
    kind: "chess-record",
    schemaVersion: 1,
    role: "record-root",
    recordId,
    sourceFormat: "pgn",
    ply: 0,
    fen: makeFen(position.toSetup()),
    metadata: Object.fromEntries(headers),
  };
  const rootText = decodeRecordComment([...(game.comments ?? [])].join("\n"), headers.get("Event") || datasetName);
  const recordRoot = makeNode(
    recordRootId,
    "workArea",
    rootText.title,
    rootText.body,
    now,
    rootContent,
    [],
  );
  recordRoot.children = buildMoveChildren(game.moves, position, recordRoot.id, recordId, now);
  const root = makeNode(
    "atlas-root",
    "root",
    datasetName,
    "Imported chess record. Select a move to view and edit the position.",
    now,
    undefined,
    [recordRoot],
  );
  root.notebookMode = "chess";
  return { root, recordRootId, datasetName };
}

function assertSupportedChessGame(game: Game<PgnNodeData>) {
  const variant = game.headers.get("Variant")?.trim();
  if (variant && !/^(?:standard|chess)$/i.test(variant)) {
    throw new Error(`Unsupported chess variant: ${variant}. Only standard chess PGN is supported.`);
  }
}

const CHESS_ROSTER_TAGS = ["Event", "Site", "Date", "Round", "White", "Black", "Result"] as const;

function chessHeaders(headers: Map<string, string>) {
  const normalized = new Map<string, string>();
  const defaults: Record<typeof CHESS_ROSTER_TAGS[number], string> = {
    Event: "Untitled chess game",
    Site: "?",
    Date: "????.??.??",
    Round: "-",
    White: "?",
    Black: "?",
    Result: "*",
  };
  for (const tag of CHESS_ROSTER_TAGS) normalized.set(tag, headers.get(tag) || defaults[tag]);
  for (const [key, value] of headers) {
    if (!CHESS_ROSTER_TAGS.includes(key as typeof CHESS_ROSTER_TAGS[number])) normalized.set(key, value);
  }
  return normalized;
}

function buildMoveChildren(
  parent: Node<PgnNodeData>,
  parentPosition: Position,
  parentId: string,
  recordId: string,
  now: string,
): AtlasNode[] {
  return parent.children.map((child, branchIndex) => {
    const before = parentPosition.clone();
    const move = parseSan(before, child.data.san);
    if (!move) throw new Error(`Illegal PGN move: ${child.data.san}`);
    const san = makeSan(before, move);
    before.play(move);
    const content: ChessRecordContent = {
      kind: "chess-record",
      schemaVersion: 1,
      role: "move",
      recordId,
      sourceFormat: "pgn",
      ply: parentPosition.fullmoves * 2 - (parentPosition.turn === "white" ? 1 : 0),
      fen: makeFen(before.toSetup()),
      uci: makeUci(move),
      san,
      displayText: formatMoveLabel(san),
      branchIndex,
      ...(child.data.nags?.length ? { nags: child.data.nags } : {}),
    };
    const moveText = decodeRecordComment(
      [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])].join("\n"),
      content.displayText || san,
    );
    const node = makeNode(
      makeId(`chess-move-${content.ply}`),
      "thread",
      moveText.title,
      moveText.body,
      now,
      content,
      [],
    );
    node.sourceParentId = parentId;
    node.children = buildMoveChildren(child, before, node.id, recordId, now);
    return node;
  });
}

function appendPgnChildren(parent: Node<PgnNodeData>, atlasParent: AtlasNode, parentPosition: Position) {
  const children = atlasParent.children.filter((node) => findChessNodeContent(node)?.role === "move");
  for (const atlasChild of children) {
    const content = findChessNodeContent(atlasChild);
    if (!content?.uci) throw new Error(`Chess move ${atlasChild.title} is missing UCI data.`);
    const move = parseUci(content.uci);
    if (!move || !parentPosition.isLegal(move)) throw new Error(`Illegal or unsupported chess move: ${content.uci}.`);
    const san = content.san || makeSan(parentPosition, move);
    const child = new ChildNode<PgnNodeData>({
      san,
      comments: [encodeRecordComment(atlasChild.title, atlasChild.body)],
      ...(content.nags?.length ? { nags: content.nags } : {}),
    });
    parent.children.push(child);
    const next = parentPosition.clone();
    next.play(move);
    appendPgnChildren(child, atlasChild, next);
  }
}

function positionFromFen(fen: string): Position {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

function formatMoveLabel(san: string) {
  return san;
}

function makeNode(
  id: string,
  kind: AtlasNode["kind"],
  title: string,
  body: string,
  now: string,
  structuredContent: ChessRecordContent | undefined,
  children: AtlasNode[],
): AtlasNode {
  return {
    id,
    kind,
    nodeType: "note",
    title: title || "Untitled chess record",
    subtitle: structuredContent?.role === "move" ? "Chess move" : "Chess record",
    body,
    author: "human",
    status: "waiting",
    color: NODE_COLORS[Math.abs(hashCode(id)) % NODE_COLORS.length],
    texture: "speckled",
    radius: structuredContent?.role === "record-root" ? 42 : 28,
    summary: body || title,
    nextDecision: "",
    tags: ["chess", "record"],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    ...(structuredContent ? { structuredContent } : {}),
    children,
  };
}

function findRecordRoot(root: AtlasNode): AtlasNode | null {
  if (findChessNodeContent(root)?.role === "record-root") return root;
  for (const child of root.children) {
    const result = findRecordRoot(child);
    if (result) return result;
  }
  return null;
}

function findFirstRecordRoot(root: AtlasNode): AtlasNode | null {
  if (findChessNodeContent(root)?.role === "record-root") return root;
  for (const child of root.children) {
    const result = findFirstRecordRoot(child);
    if (result) return result;
  }
  return null;
}

function findPath(root: AtlasNode, targetId: string, path: AtlasNode[] = []): AtlasNode[] | null {
  const next = [...path, root];
  if (root.id === targetId) return next;
  for (const child of root.children) {
    const found = findPath(child, targetId, next);
    if (found) return found;
  }
  return null;
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.pgn$/i, "").replace(/[_-]+/g, " ").trim() || "Imported chess record";
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return hash;
}

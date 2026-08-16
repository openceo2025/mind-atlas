import GoBoard, { type Sign, type Vertex } from "@sabaki/go-board";
import sgf, { type SgfNode } from "@sabaki/sgf";
import type { AtlasNode, GoRecordContent } from "../../types";
import { decodeRecordComment, encodeRecordComment } from "../board/recordComment.ts";

export interface GoImportResult {
  root: AtlasNode;
  recordRootId: string;
  datasetName: string;
}

const NODE_COLORS = ["#89c7a4", "#d7aa72", "#8faed8", "#d48f9a", "#a798d9"];

export type GoFileFormat = "sgf";

export function detectGoRecordFormat(fileName: string): GoFileFormat | null {
  return fileName.toLowerCase().endsWith(".sgf") ? "sgf" : null;
}

export async function importGoRecordFile(file: File): Promise<GoImportResult> {
  if (!detectGoRecordFormat(file.name)) throw new Error("Unsupported Go record. Use SGF.");
  const text = new TextDecoder("utf-8").decode(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/, "");
  return importGoRecordText(text, datasetNameFromFile(file.name));
}

export function importGoRecordText(text: string, datasetName = "Imported Go record"): GoImportResult {
  const tree = sgf.parse(text)[0];
  if (!tree) throw new Error("The SGF does not contain a Go game.");
  return treeToAtlas(tree, datasetName);
}

export function createNewGoRecord(datasetName = "New Go game"): GoImportResult {
  return treeToAtlas({
    id: 0,
    parentId: null,
    data: { GM: ["1"], FF: ["4"], SZ: ["19"] },
    children: [],
  }, datasetName);
}

export function exportGoRecord(root: AtlasNode): string {
  const recordRoot = findRecordRoot(root);
  const rootContent = findGoNodeContent(recordRoot);
  if (!recordRoot || !rootContent || rootContent.role !== "record-root") {
    throw new Error("Select a node inside an imported Go record first.");
  }
  const tree: SgfNode = {
    id: 0,
    parentId: null,
    data: {
      GM: ["1"],
      FF: ["4"],
      SZ: [String(rootContent.boardSize)],
      ...Object.fromEntries(Object.entries(rootContent.metadata ?? {}).map(([key, value]) => [key, [value]])),
      ...(rootContent.setupBlack?.length ? { AB: rootContent.setupBlack.map((value) => sgfVertexFromDisplay(value, rootContent.boardSize)) } : {}),
      ...(rootContent.setupWhite?.length ? { AW: rootContent.setupWhite.map((value) => sgfVertexFromDisplay(value, rootContent.boardSize)) } : {}),
      C: [encodeRecordComment(recordRoot.title, recordRoot.body)],
    },
    children: [],
  };
  appendChildren(tree, recordRoot, 1);
  return sgf.stringify(tree);
}

export function findGoRecordRoot(root: AtlasNode, nodeId: string): AtlasNode | null {
  const path = findPath(root, nodeId);
  if (!path) return null;
  return [...path].reverse().find((node) => isRecordRoot(node)) ?? (path.length === 1 ? findFirstRecordRoot(root) : null);
}

export function findGoNodeContent(node: AtlasNode | null | undefined): GoRecordContent | null {
  const content = node?.structuredContent;
  return content?.kind === "go-record" ? content : null;
}

export function boardFromGoContent(content: GoRecordContent): GoBoard {
  const board = GoBoard.fromDimensions(content.boardSize);
  for (let y = 0; y < content.boardSize; y += 1) {
    for (let x = 0; x < content.boardSize; x += 1) {
      const cell = content.board[y * content.boardSize + x];
      if (cell === "X" || cell === "O") board.set([x, y], cell === "X" ? 1 : -1);
    }
  }
  return board;
}

export function nearestGoRecordNode(root: AtlasNode, nodeId: string, recordRootId: string): AtlasNode | null {
  const path = findPath(root, nodeId);
  if (!path) return null;
  const start = path.findIndex((node) => node.id === recordRootId);
  return start >= 0 ? [...path].slice(start).reverse().find((node) => findGoNodeContent(node)?.kind === "go-record") ?? null : null;
}

export function goRecordPath(recordRoot: AtlasNode, nodeId: string): AtlasNode[] {
  return findPath(recordRoot, nodeId) ?? [recordRoot];
}

export function nextGoSign(rootContent: GoRecordContent, currentNode: AtlasNode): Sign {
  const current = findGoNodeContent(currentNode);
  if (current?.role === "move") return current.color === "B" ? -1 : 1;
  const configured = rootContent.metadata?.PL?.toUpperCase();
  return configured === "W" ? -1 : 1;
}

export function goVertexToSgf(vertex: Vertex): string {
  return `${String.fromCharCode(97 + vertex[0])}${String.fromCharCode(97 + vertex[1])}`;
}

export function sgfVertexToGo(value: string, boardSize: number): Vertex {
  if (!value) return [-1, -1];
  if (value.length !== 2) return [-1, -1];
  const vertex: Vertex = [value.charCodeAt(0) - 97, value.charCodeAt(1) - 97];
  if (vertex[0] < 0 || vertex[1] < 0 || vertex[0] >= boardSize || vertex[1] >= boardSize) return [-1, -1];
  return vertex;
}

function treeToAtlas(tree: SgfNode, datasetName: string): GoImportResult {
  const rootData = tree.data;
  const boardSize = parseBoardSize(first(rootData.SZ));
  const recordId = makeId("go-record");
  const recordRootId = makeId("go-root");
  const now = new Date().toISOString();
  const initialBoard = createInitialBoard(rootData, boardSize);
  const rootContent: GoRecordContent = {
    kind: "go-record",
    schemaVersion: 1,
    role: "record-root",
    recordId,
    sourceFormat: "sgf",
    ply: 0,
    boardSize,
    board: boardString(initialBoard),
    ...(readSetup(rootData, "AB", boardSize).length ? { setupBlack: readSetup(rootData, "AB", boardSize) } : {}),
    ...(readSetup(rootData, "AW", boardSize).length ? { setupWhite: readSetup(rootData, "AW", boardSize) } : {}),
    metadata: readMetadata(rootData),
  };
  const rootText = decodeRecordComment(first(rootData.C), first(rootData.GN) || datasetName);
  const recordRoot = makeNode(recordRootId, "workArea", rootText.title, rootText.body, now, rootContent, []);
  recordRoot.children = buildChildren(tree, recordRoot.id, recordId, boardSize, initialBoard, now, 0);
  const root = makeNode(
    "atlas-root",
    "root",
    datasetName,
    "Imported Go record. Select a move to view and edit the position.",
    now,
    undefined,
    [recordRoot],
  );
  root.notebookMode = "go";
  return { root, recordRootId, datasetName };
}

function buildChildren(
  parent: SgfNode,
  parentId: string,
  recordId: string,
  boardSize: number,
  parentBoard: GoBoard,
  now: string,
  ply: number,
): AtlasNode[] {
  return parent.children.map((child, branchIndex) => {
    const color = first(child.data.B) ? "B" : first(child.data.W) ? "W" : null;
    if (!color) return makeNode(makeId(`go-node-${ply + 1}`), "thread", "Go note", first(child.data.C) || "", now, undefined, []);
    const sign: Sign = color === "B" ? 1 : -1;
    const rawVertex = first(child.data[color]) ?? "";
    const vertex = sgfVertexToGo(rawVertex, boardSize);
    let nextBoard = parentBoard.clone();
    if (vertex[0] >= 0) {
      if (nextBoard.analyzeMove(sign, vertex).overwrite || nextBoard.analyzeMove(sign, vertex).suicide) {
        throw new Error(`Illegal SGF move: ${color}[${rawVertex}]`);
      }
      nextBoard = nextBoard.makeMove(sign, vertex, { preventOverwrite: true, preventSuicide: true, preventKo: true });
    }
    const displayText = vertex[0] >= 0 ? `${color} ${nextBoard.stringifyVertex(vertex)}` : `${color} pass`;
    const content: GoRecordContent = {
      kind: "go-record",
      schemaVersion: 1,
      role: "move",
      recordId,
      sourceFormat: "sgf",
      ply: ply + 1,
      boardSize,
      board: boardString(nextBoard),
      color,
      vertex: vertex[0] >= 0 ? nextBoard.stringifyVertex(vertex) : "pass",
      displayText,
      branchIndex,
    };
    const moveText = decodeRecordComment(first(child.data.C), displayText);
    const node = makeNode(makeId(`go-move-${ply + 1}`), "thread", moveText.title, moveText.body, now, content, []);
    node.sourceParentId = parentId;
    node.children = buildChildren(child, node.id, recordId, boardSize, nextBoard, now, ply + 1);
    return node;
  });
}

function appendChildren(parent: SgfNode, atlasParent: AtlasNode, nextId: number): number {
  const moveChildren = atlasParent.children.filter((node) => findGoNodeContent(node)?.role === "move");
  for (const atlasChild of moveChildren) {
    const content = findGoNodeContent(atlasChild);
    if (!content?.color) continue;
    const child: SgfNode = {
      id: nextId,
      parentId: parent.id,
      data: {
        [content.color]: [content.vertex === "pass" ? "" : sgfVertexFromDisplay(content.vertex || "", content.boardSize)],
        C: [encodeRecordComment(atlasChild.title, atlasChild.body)],
      },
      children: [],
    };
    parent.children.push(child);
    nextId += 1;
    nextId = appendChildren(child, atlasChild, nextId);
  }
  return nextId;
}

function createInitialBoard(data: Record<string, string[]>, boardSize: number) {
  let board = GoBoard.fromDimensions(boardSize);
  for (const item of data.AB ?? []) {
    const vertex = sgfVertexToGo(item, boardSize);
    if (vertex[0] >= 0) board = board.set(vertex, 1);
  }
  for (const item of data.AW ?? []) {
    const vertex = sgfVertexToGo(item, boardSize);
    if (vertex[0] >= 0) board = board.set(vertex, -1);
  }
  return board;
}

function boardString(board: GoBoard) {
  let result = "";
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) result += board.get([x, y]) === 1 ? "X" : board.get([x, y]) === -1 ? "O" : ".";
  }
  return result;
}

function readSetup(data: Record<string, string[]>, key: "AB" | "AW", boardSize: number) {
  return (data[key] ?? []).map((value) => {
    const vertex = sgfVertexToGo(value, boardSize);
    if (vertex[0] < 0) return "";
    return GoBoard.fromDimensions(boardSize).stringifyVertex(vertex);
  }).filter(Boolean);
}

function readMetadata(data: Record<string, string[]>) {
  const allowed = ["PB", "PW", "RE", "DT", "EV", "RO", "RU", "KM", "HA", "PL"];
  return Object.fromEntries(allowed.filter((key) => data[key]?.[0]).map((key) => [key, data[key][0]]));
}

function first(values: string[] | undefined) {
  return values?.[0] ?? "";
}

function parseBoardSize(value: string) {
  const parsed = Number(value.split(":")[0] || 19);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 25) throw new Error("SGF board size must be between 2 and 25.");
  return parsed;
}

function sgfVertexFromDisplay(value: string, boardSize: number) {
  const board = GoBoard.fromDimensions(boardSize);
  const vertex = board.parseVertex(value);
  if (vertex[0] < 0) throw new Error(`Invalid Go vertex: ${value}`);
  return goVertexToSgf(vertex);
}

function makeNode(
  id: string,
  kind: AtlasNode["kind"],
  title: string,
  body: string,
  now: string,
  structuredContent: GoRecordContent | undefined,
  children: AtlasNode[],
): AtlasNode {
  return {
    id,
    kind,
    nodeType: "note",
    title: title || "Untitled Go record",
    subtitle: structuredContent?.role === "move" ? "Go move" : "Go record",
    body: body || "",
    author: "human",
    status: "waiting",
    color: NODE_COLORS[Math.abs(hashCode(id)) % NODE_COLORS.length],
    texture: "speckled",
    radius: structuredContent?.role === "record-root" ? 42 : 28,
    summary: body || title,
    nextDecision: "",
    tags: ["go", "record"],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    ...(structuredContent ? { structuredContent } : {}),
    children,
  };
}

function findRecordRoot(root: AtlasNode): AtlasNode | null {
  if (isRecordRoot(root)) return root;
  for (const child of root.children) {
    const result = findRecordRoot(child);
    if (result) return result;
  }
  return null;
}

function findFirstRecordRoot(root: AtlasNode): AtlasNode | null {
  if (isRecordRoot(root)) return root;
  for (const child of root.children) {
    const result = findFirstRecordRoot(child);
    if (result) return result;
  }
  return null;
}

function isRecordRoot(node: AtlasNode) {
  return node.structuredContent?.kind === "go-record" && node.structuredContent.role === "record-root";
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
  return fileName.replace(/\.sgf$/i, "").replace(/[_-]+/g, " ").trim() || "Imported Go record";
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return hash;
}

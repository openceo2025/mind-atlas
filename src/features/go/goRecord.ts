import GoBoard, { type Sign, type Vertex } from "@sabaki/go-board";
import sgf, { type SgfNode } from "@sabaki/sgf";
import type { AtlasNode, GoRecordContent } from "../../types";
import { decodeRecordComment, encodeRecordComment } from "../board/recordComment.ts";
import {
  assertBoardRecordExportable,
  assertBoardRecordFileWithinLimits,
  assertBoardRecordTextWithinLimits,
  assertParsedRecordTreeWithinLimits,
} from "../board/boardRecordSafety.ts";

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
  assertBoardRecordFileWithinLimits(file, "SGF");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeSgfBytes(bytes);
  return importGoRecordText(text, datasetNameFromFile(file.name));
}

export function importGoRecordText(text: string, datasetName = "Imported Go record"): GoImportResult {
  assertBoardRecordTextWithinLimits(text, "SGF");
  const trees = sgf.parse(text);
  if (!trees.length) throw new Error("The SGF does not contain a Go game.");
  if (trees.length > 1) throw new Error(`This SGF contains ${trees.length} game trees. Multi-game SGF files are not supported yet; import one game at a time.`);
  const tree = trees[0];
  assertSupportedGoTree(tree);
  assertParsedRecordTreeWithinLimits([tree], {
    format: "SGF",
    getChildren: (node) => node.children,
    getCommentText: (node) => (node.data.C ?? []).join("\n"),
  });
  return treeToAtlas(tree, datasetName);
}

export function createNewGoRecord(datasetName = "New Go game"): GoImportResult {
  return treeToAtlas({
    id: 0,
    parentId: null,
    data: { GM: ["1"], FF: ["4"], CA: ["UTF-8"], SZ: ["19"], RU: ["Japanese"], KM: ["6.5"], PL: ["B"] },
    children: [],
  }, datasetName);
}

export function exportGoRecord(root: AtlasNode): string {
  assertBoardRecordExportable(root, "go");
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
      CA: ["UTF-8"],
      SZ: [String(rootContent.boardSize)],
      ...Object.fromEntries(Object.entries(rootContent.metadata ?? {})
        .filter(([key]) => !["GM", "FF", "CA", "SZ", "AB", "AW", "AE", "C"].includes(key))
        .map(([key, value]) => [key, [value]])),
      ...(rootContent.setupBlack?.length ? { AB: rootContent.setupBlack.map((value) => sgfVertexFromDisplay(value, rootContent.boardSize)) } : {}),
      ...(rootContent.setupWhite?.length ? { AW: rootContent.setupWhite.map((value) => sgfVertexFromDisplay(value, rootContent.boardSize)) } : {}),
      ...(rootContent.setupEmpty?.length ? { AE: rootContent.setupEmpty.map((value) => sgfVertexFromDisplay(value, rootContent.boardSize)) } : {}),
      C: [encodeRecordComment(recordRoot.title, recordRoot.body)],
    },
    children: [],
  };
  appendChildren(tree, recordRoot, 1);
  const text = sgf.stringify(tree);
  assertBoardRecordTextWithinLimits(text, "SGF");
  return text;
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

const GO_ROOT_METADATA_KEYS = [
  "PB", "PW", "BR", "WR", "RE", "DT", "EV", "RO", "GN", "PC", "TM", "OT", "SO", "AP", "GC",
  "RU", "KM", "HA", "PL", "US", "AN", "ON", "CP", "ST",
] as const;

const GO_ROOT_ALLOWED_KEYS = new Set<string>([
  "GM", "FF", "CA", "SZ", "C", "AB", "AW", "AE", ...GO_ROOT_METADATA_KEYS,
]);

export function canEditGoRecord(content: GoRecordContent) {
  const rules = content.metadata?.RU?.trim().toLowerCase().replace(/\s+/g, " ");
  return rules === "japanese";
}

function assertSupportedGoTree(tree: SgfNode) {
  const rootData = tree.data;
  const game = first(rootData.GM);
  if (game && game !== "1") throw new Error(`Unsupported SGF game type GM[${game}]. Only Go records GM[1] are supported.`);
  const fileFormat = first(rootData.FF);
  if (fileFormat && fileFormat !== "4") throw new Error(`Unsupported SGF file format FF[${fileFormat}]. Only FF[4] is supported.`);
  const charset = first(rootData.CA);
  if (charset) normalizeSgfCharset(charset);
  if (first(rootData.SZ).includes(":")) throw new Error("Rectangular SGF boards are not supported yet. Use a square board size.");
  for (const key of Object.keys(rootData)) {
    if (!GO_ROOT_ALLOWED_KEYS.has(key)) throw new Error(`Unsupported SGF root property ${key}. Import was stopped before changing the workspace.`);
    if (!["C", "AB", "AW", "AE"].includes(key) && (rootData[key]?.length ?? 0) > 1) {
      throw new Error(`Repeated SGF root property ${key} is not supported yet.`);
    }
  }

  const stack = tree.children.map((node) => ({ node, index: 1 }));
  let nodeIndex = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    nodeIndex += 1;
    const keys = Object.keys(current.node.data);
    const hasBlack = Boolean(first(current.node.data.B));
    const hasWhite = Boolean(first(current.node.data.W));
    if (!hasBlack && !hasWhite) {
      throw new Error(`Unsupported SGF non-move node ${nodeIndex} (${keys.join(", ") || "empty"}). Import was stopped before changing the workspace.`);
    }
    if (hasBlack && hasWhite) throw new Error(`SGF node ${nodeIndex} contains both B and W moves.`);
    for (const key of keys) {
      if (key !== "B" && key !== "W" && key !== "C") {
        throw new Error(`Unsupported SGF property ${key} on move node ${nodeIndex}. Import was stopped before changing the workspace.`);
      }
    }
    const moveKey = hasBlack ? "B" : "W";
    if ((current.node.data[moveKey]?.length ?? 0) !== 1 || (current.node.data.C?.length ?? 0) > 1) {
      throw new Error(`Repeated SGF move or comment property on node ${nodeIndex} is not supported yet.`);
    }
    for (let childIndex = current.node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      stack.push({ node: current.node.children[childIndex], index: nodeIndex + childIndex + 1 });
    }
  }
}

function treeToAtlas(tree: SgfNode, datasetName: string): GoImportResult {
  const rootData = tree.data;
  const boardSize = parseBoardSize(first(rootData.SZ));
  const recordId = makeId("go-record");
  const recordRootId = makeId("go-root");
  const now = new Date().toISOString();
  const initialBoard = createInitialBoard(rootData, boardSize);
  const setupBlack = readSetup(rootData, "AB", boardSize);
  const setupWhite = readSetup(rootData, "AW", boardSize);
  const setupEmpty = readSetup(rootData, "AE", boardSize);
  const rootContent: GoRecordContent = {
    kind: "go-record",
    schemaVersion: 1,
    role: "record-root",
    recordId,
    sourceFormat: "sgf",
    ply: 0,
    boardSize,
    board: boardString(initialBoard),
    ...(setupBlack.length ? { setupBlack } : {}),
    ...(setupWhite.length ? { setupWhite } : {}),
    ...(setupEmpty.length ? { setupEmpty } : {}),
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
    if (!color) throw new Error(`Unsupported SGF non-move node after validation at ply ${ply + 1}.`);
    const sign: Sign = color === "B" ? 1 : -1;
    const rawVertex = first(child.data[color]) ?? "";
    const vertex = sgfVertexToGo(rawVertex, boardSize);
    let nextBoard = parentBoard.clone();
    if (vertex[0] >= 0) {
      if (nextBoard.analyzeMove(sign, vertex).overwrite) {
        throw new Error(`Illegal SGF move: ${color}[${rawVertex}]`);
      }
      // SGF replay preserves the recorded path. Rule-specific legality is
      // applied only when the user creates a new move in GoViewer.
      nextBoard = nextBoard.makeMove(sign, vertex, { preventOverwrite: true });
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
  board = applySetup(board, data.AB ?? [], boardSize, 1);
  board = applySetup(board, data.AW ?? [], boardSize, -1);
  board = applySetup(board, data.AE ?? [], boardSize, 0);
  return board;
}

function applySetup(board: GoBoard, values: string[], boardSize: number, sign: Sign) {
  for (const value of values) {
    for (const vertex of sgf.parseCompressedVertices(value)) {
      if (vertex[0] < 0 || vertex[1] < 0 || vertex[0] >= boardSize || vertex[1] >= boardSize) {
        throw new Error(`SGF setup point ${value} is outside the ${boardSize}x${boardSize} board.`);
      }
      board = board.set(vertex, sign);
    }
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

function readSetup(data: Record<string, string[]>, key: "AB" | "AW" | "AE", boardSize: number) {
  return (data[key] ?? []).flatMap((value) => sgf.parseCompressedVertices(value).map((vertex) => {
    if (vertex[0] < 0 || vertex[1] < 0 || vertex[0] >= boardSize || vertex[1] >= boardSize) {
      throw new Error(`SGF setup point ${value} is outside the ${boardSize}x${boardSize} board.`);
    }
    return GoBoard.fromDimensions(boardSize).stringifyVertex(vertex);
  }));
}

function readMetadata(data: Record<string, string[]>) {
  const metadata = Object.fromEntries(GO_ROOT_METADATA_KEYS.filter((key) => data[key]?.[0]).map((key) => [key, data[key][0]]));
  return {
    RU: metadata.RU || "Japanese",
    KM: metadata.KM || "6.5",
    PL: metadata.PL || "B",
    ...metadata,
  };
}

function first(values: string[] | undefined) {
  return values?.[0] ?? "";
}

function parseBoardSize(value: string) {
  if (value.includes(":")) throw new Error("Rectangular SGF boards are not supported yet. Use a square board size.");
  const parsed = Number(value || 19);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 25) throw new Error("SGF board size must be between 2 and 25.");
  return parsed;
}

function decodeSgfBytes(bytes: Uint8Array) {
  const declared = readDeclaredSgfCharset(bytes);
  const charset = declared ? normalizeSgfCharset(declared) : null;
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (error) {
    if (charset) throw new Error(`SGF record could not be decoded as ${declared}.`);
    try {
      return new TextDecoder("iso-8859-1").decode(bytes).replace(/^\uFEFF/, "");
    } catch {
      throw new Error(`SGF record could not be decoded: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
}

function readDeclaredSgfCharset(bytes: Uint8Array) {
  const preamble = new TextDecoder("iso-8859-1").decode(bytes.subarray(0, 16 * 1024));
  return preamble.match(/\bCA\[([^\]]+)\]/i)?.[1]?.trim() || "";
}

function normalizeSgfCharset(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["utf-8", "utf8"].includes(normalized)) return "utf-8";
  if (["iso-8859-1", "iso8859-1", "latin1", "latin-1"].includes(normalized)) return "iso-8859-1";
  if (["shift-jis", "shiftjis", "sjis", "windows-31j", "cp932"].includes(normalized)) return "shift_jis";
  if (["euc-jp", "eucjp"].includes(normalized)) return "euc-jp";
  throw new Error(`Unsupported SGF charset CA[${value}]. Supported charsets are UTF-8, ISO-8859-1, Shift_JIS, and EUC-JP.`);
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

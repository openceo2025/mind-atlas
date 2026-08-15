import {
  exportKIF,
  importCSA,
  importKIF,
  importKI2,
  Position,
  Record as TsshogiRecord,
  RecordMetadataKey,
  type ImmutableNode,
} from "tsshogi";
import type { AtlasNode, ShogiRecordContent, ShogiRecordFormat } from "../../types";
import { decodeRecordComment, encodeRecordComment } from "../board/recordComment.ts";

export interface ShogiImportResult {
  root: AtlasNode;
  recordRootId: string;
  datasetName: string;
  format: ShogiRecordFormat;
}

const DEFAULT_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const NODE_COLORS = ["#7ec8e3", "#f5c86b", "#d98b8b", "#9f9be7", "#8bd3a8"];

export type ShogiFileFormat = Exclude<ShogiRecordFormat, "new">;

export function detectShogiRecordFormat(fileName: string): ShogiFileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".kif")) return "kif";
  if (lower.endsWith(".ki2")) return "ki2";
  if (lower.endsWith(".csa")) return "csa";
  return null;
}

export async function importShogiRecordFile(file: File): Promise<ShogiImportResult> {
  const format = detectShogiRecordFormat(file.name);
  if (!format) throw new Error("Unsupported shogi record. Use KIF, KI2, or CSA.");
  return importShogiRecordText(await decodeShogiFile(file), datasetNameFromFile(file.name), format);
}

export function importShogiRecordText(
  text: string,
  datasetName = "Imported shogi record",
  preferredFormat?: ShogiFileFormat,
): ShogiImportResult {
  const formats = preferredFormat
    ? [preferredFormat, ...(["kif", "ki2", "csa"] as const).filter((format) => format !== preferredFormat)]
    : (["kif", "ki2", "csa"] as const);
  const failures: string[] = [];
  for (const format of formats) {
    try {
      return recordToAtlas(parseRecord(text.replace(/^#\s*----\s*KIF形式\s*----\s*$/m, ""), format), format, datasetName);
    } catch (error) {
      failures.push(`${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`The pasted text is not a supported KIF, KI2, or CSA record.\n${failures.join("\n")}`);
}

export function exportShogiRecord(root: AtlasNode): string {
  const recordRoot = findRecordRoot(root);
  if (!recordRoot) throw new Error("Select a node inside an imported shogi record first.");
  const rootContent = recordRoot.structuredContent;
  if (!rootContent || rootContent.kind !== "shogi-record" || rootContent.role !== "record-root") {
    throw new Error("The selected node is not a shogi record.");
  }
  const position = Position.newBySFEN(rootContent.sfen);
  if (!position) throw new Error("The saved starting position is invalid.");
  const record = new TsshogiRecord(position);
  applyMetadata(record, rootContent.metadata ?? {});
  record.first.comment = encodeRecordComment(recordRoot.title, recordRoot.body);
  const nativeByAtlasId = new Map<string, ImmutableNode>([[recordRoot.id, record.first]]);
  appendChildren(record, recordRoot, record.first, nativeByAtlasId);
  return exportKIF(record);
}

export function findShogiRecordRoot(root: AtlasNode, nodeId: string): AtlasNode | null {
  const path = findPath(root, nodeId);
  if (!path) return null;
  return [...path].reverse().find((node) => isRecordRoot(node)) ?? (path.length === 1 ? findFirstRecordRoot(root) : null);
}

export function findShogiNodeContent(node: AtlasNode | null | undefined): ShogiRecordContent | null {
  const content = node?.structuredContent;
  return content?.kind === "shogi-record" ? content : null;
}

function parseRecord(text: string, format: ShogiFileFormat) {
  const parsed = format === "kif" ? importKIF(text) : format === "ki2" ? importKI2(text) : importCSA(text);
  if (parsed instanceof Error) throw new Error(parsed.message || `${format.toUpperCase()} could not be parsed.`);
  return parsed;
}

function recordToAtlas(
  record: TsshogiRecord,
  format: ShogiFileFormat,
  datasetName: string,
): ShogiImportResult {
  const recordId = makeId("record");
  const now = new Date().toISOString();
  const recordRootId = makeId("shogi-root");
  const metadata = readMetadata(record);
  const recordRootContent: ShogiRecordContent = {
    kind: "shogi-record",
    schemaVersion: 1,
    role: "record-root",
    recordId,
    sourceFormat: format,
    ply: 0,
    sfen: record.first.sfen || DEFAULT_SFEN,
    metadata,
  };
  const rootText = decodeRecordComment(record.first.comment, metadata.title || datasetName);
  const recordRoot: AtlasNode = makeNode(
    recordRootId,
    "workArea",
    rootText.title,
    rootText.body,
    now,
    recordRootContent,
    [],
  );
  recordRoot.children = buildMoveChildren(record.first, recordRoot.id, recordId, format, now);

  const notebookRoot: AtlasNode = makeNode(
    "atlas-root",
    "root",
    datasetName,
    "Imported shogi record. Select a move to view and edit the position.",
    now,
    undefined,
    [recordRoot],
  );
  notebookRoot.notebookMode = "shogi";
  return { root: notebookRoot, recordRootId, datasetName, format };
}

function buildMoveChildren(
  parent: ImmutableNode,
  parentId: string,
  recordId: string,
  format: ShogiFileFormat,
  now: string,
): AtlasNode[] {
  const children: AtlasNode[] = [];
  let move = parent.next;
  while (move) {
    const moveId = makeId(`shogi-move-${move.ply}`);
    const content: ShogiRecordContent = {
      kind: "shogi-record",
      schemaVersion: 1,
      role: "move",
      recordId,
      sourceFormat: format,
      ply: move.ply,
      sfen: move.sfen,
      ...(move.move && "usi" in move.move ? { usi: move.move.usi } : {}),
      displayText: move.displayText,
      branchIndex: move.branchIndex,
    };
    const moveText = decodeRecordComment(move.comment, move.displayText || `Move ${move.ply}`);
    const node = makeNode(moveId, "thread", moveText.title, moveText.body, now, content, []);
    node.sourceParentId = parentId;
    node.children = buildMoveChildren(move, node.id, recordId, format, now);
    children.push(node);
    move = move.branch;
  }
  return children;
}

function appendChildren(
  record: TsshogiRecord,
  atlasParent: AtlasNode,
  nativeParent: ImmutableNode,
  nativeByAtlasId: Map<string, ImmutableNode>,
) {
  const moveChildren = atlasParent.children.filter((node) => findShogiNodeContent(node)?.role === "move");
  moveChildren.forEach((atlasChild, index) => {
    if (index > 0 && !record.gotoNode(nativeParent)) {
      throw new Error(`Could not select the parent position for branch ${atlasChild.title}.`);
    }
    const content = findShogiNodeContent(atlasChild);
    if (!content?.usi) throw new Error(`Move node ${atlasChild.title} is missing USI data.`);
    const move = record.position.createMoveByUSI(content.usi);
    if (!move || !record.append(move)) throw new Error(`Illegal or unsupported move: ${content.usi}.`);
    const nativeChild = record.current;
    nativeChild.comment = encodeRecordComment(atlasChild.title, atlasChild.body);
    nativeByAtlasId.set(atlasChild.id, nativeChild);
    appendChildren(record, atlasChild, nativeChild, nativeByAtlasId);
  });
}

function applyMetadata(record: TsshogiRecord, metadata: Record<string, string>) {
  const standardKeys = new Set(Object.values(RecordMetadataKey));
  for (const [key, value] of Object.entries(metadata)) {
    if (standardKeys.has(key as RecordMetadataKey)) record.metadata.setStandardMetadata(key as RecordMetadataKey, value);
    else record.metadata.setCustomMetadata(key, value);
  }
}

function readMetadata(record: TsshogiRecord): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of record.metadata.standardMetadataKeys) {
    const value = record.metadata.getStandardMetadata(key);
    if (value) result[key] = value;
  }
  for (const key of record.metadata.customMetadataKeys) {
    const value = record.metadata.getCustomMetadata(key);
    if (value) result[key] = value;
  }
  return result;
}

function makeNode(
  id: string,
  kind: AtlasNode["kind"],
  title: string,
  body: string,
  now: string,
  structuredContent: ShogiRecordContent | undefined,
  children: AtlasNode[],
): AtlasNode {
  return {
    id,
    kind,
    nodeType: "note",
    title: title || "Untitled shogi record",
    subtitle: structuredContent?.role === "move" ? "Shogi move" : "Shogi record",
    body: body || "",
    author: "human",
    status: "waiting",
    color: NODE_COLORS[Math.abs(hashCode(id)) % NODE_COLORS.length],
    texture: "speckled",
    radius: structuredContent?.role === "record-root" ? 42 : 28,
    summary: body || title,
    nextDecision: "",
    tags: ["shogi", "record"],
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
  return node.structuredContent?.kind === "shogi-record" && node.structuredContent.role === "record-root";
}

function findPath(root: AtlasNode, targetId: string, path: AtlasNode[] = []): AtlasNode[] | null {
  const next = [...path, root];
  if (root.id === targetId) return next;
  for (const child of root.children) {
    const result = findPath(child, targetId, next);
    if (result) return result;
  }
  return null;
}

async function decodeShogiFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("shift_jis").decode(bytes).replace(/^\uFEFF/, "");
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.(kif|ki2|csa)$/i, "").replace(/[_-]+/g, " ").trim() || "Imported shogi record";
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return hash;
}

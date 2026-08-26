import {
  exportKIF,
  importCSA,
  importKIF,
  importKI2,
  anySpecialMove,
  Position,
  Record as TsshogiRecord,
  RecordMetadataKey,
  SpecialMoveType,
  type ImmutableNode,
  type ImmutablePosition,
  type Move,
  type SpecialMove,
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

export function createNewShogiRecord(datasetName = "新規の棋譜"): ShogiImportResult {
  const position = Position.newBySFEN(DEFAULT_SFEN);
  if (!position) throw new Error("The standard shogi position could not be created.");
  return recordToAtlas(new TsshogiRecord(position), "new", datasetName, {
    recordRootTitle: datasetName === "新規の棋譜" ? "将棋" : datasetName,
    recordRootBody: "",
  });
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
  format: ShogiRecordFormat,
  datasetName: string,
  options: { recordRootTitle?: string; recordRootBody?: string } = {},
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
  const rootText = decodeRecordComment(record.first.comment, options.recordRootTitle ?? (metadata.title || datasetName));
  if (options.recordRootBody !== undefined) rootText.body = options.recordRootBody;
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
    format === "new" ? "" : "Imported shogi record. Select a move to view and edit the position.",
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
  format: ShogiRecordFormat,
  now: string,
): AtlasNode[] {
  const children: AtlasNode[] = [];
  let move = parent.next;
  while (move) {
    const moveId = makeId(`shogi-move-${move.ply}`);
    const specialMove = "usi" in move.move ? undefined : serializeSpecialMove(move.move);
    const content: ShogiRecordContent = {
      kind: "shogi-record",
      schemaVersion: 1,
      role: "move",
      recordId,
      sourceFormat: format,
      ply: move.ply,
      sfen: move.sfen,
      ...(move.move && "usi" in move.move ? { usi: move.move.usi } : {}),
      ...(specialMove ? { specialMove } : {}),
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
    const move = content ? resolveAtlasMove(record.position, content, atlasChild) : null;
    if (!move || !record.append(move)) return;
    const nativeChild = record.current;
    nativeChild.comment = encodeRecordComment(atlasChild.title, atlasChild.body);
    nativeByAtlasId.set(atlasChild.id, nativeChild);
    appendChildren(record, atlasChild, nativeChild, nativeByAtlasId);
  });
}

function serializeSpecialMove(move: SpecialMove): NonNullable<ShogiRecordContent["specialMove"]> {
  return move.type === "any" ? { type: move.type, name: move.name } : { type: move.type };
}

function resolveAtlasMove(position: ImmutablePosition, content: ShogiRecordContent, node: AtlasNode): Move | SpecialMove | null {
  const targetPosition = comparableSfen(content.sfen);
  if (content.usi) {
    const direct = position.createMoveByUSI(content.usi);
    if (direct && position.isValidMove(direct) && moveMatchesTarget(position, direct, targetPosition)) return direct;
  }
  const persistedSpecial = specialMoveFromContent(content.specialMove);
  if (persistedSpecial) return persistedSpecial;
  if (comparableSfen(position.sfen) === targetPosition) return inferLegacySpecialMove(content.displayText || node.title);
  return recoverMoveFromTargetSfen(position, targetPosition);
}

function specialMoveFromContent(value: ShogiRecordContent["specialMove"]): SpecialMove | null {
  if (!value) return null;
  if (value.type === "any") return value.name ? anySpecialMove(value.name) : null;
  return Object.values(SpecialMoveType).includes(value.type as SpecialMoveType)
    ? { type: value.type as SpecialMoveType }
    : null;
}

function inferLegacySpecialMove(label: string): SpecialMove {
  const normalized = String(label ?? "").trim();
  const known: Array<[RegExp, SpecialMoveType]> = [
    [/投了/, SpecialMoveType.RESIGN],
    [/中断/, SpecialMoveType.INTERRUPT],
    [/千日手/, SpecialMoveType.REPETITION_DRAW],
    [/持将棋/, SpecialMoveType.IMPASS],
    [/不詰/, SpecialMoveType.NO_MATE],
    [/詰み/, SpecialMoveType.MATE],
    [/時間切れ/, SpecialMoveType.TIMEOUT],
    [/反則勝ち/, SpecialMoveType.FOUL_WIN],
    [/反則負け/, SpecialMoveType.FOUL_LOSE],
    [/入玉勝ち/, SpecialMoveType.ENTERING_OF_KING],
    [/不戦勝/, SpecialMoveType.WIN_BY_DEFAULT],
    [/不戦敗/, SpecialMoveType.LOSE_BY_DEFAULT],
  ];
  const matched = known.find(([pattern]) => pattern.test(normalized));
  return matched ? { type: matched[1] } : anySpecialMove(normalized || "終局");
}

function recoverMoveFromTargetSfen(position: ImmutablePosition, targetPosition: string): Move | null {
  const ranks = "abcdefghi";
  for (let fromFile = 1; fromFile <= 9; fromFile += 1) {
    for (const fromRank of ranks) {
      for (let toFile = 1; toFile <= 9; toFile += 1) {
        for (const toRank of ranks) {
          for (const suffix of ["", "+"] as const) {
            const move = position.createMoveByUSI(`${fromFile}${fromRank}${toFile}${toRank}${suffix}`);
            if (move && position.isValidMove(move) && moveMatchesTarget(position, move, targetPosition)) return move;
          }
        }
      }
    }
  }
  for (const piece of ["R", "B", "G", "S", "N", "L", "P"] as const) {
    for (let file = 1; file <= 9; file += 1) {
      for (const rank of ranks) {
        const move = position.createMoveByUSI(`${piece}*${file}${rank}`);
        if (move && position.isValidMove(move) && moveMatchesTarget(position, move, targetPosition)) return move;
      }
    }
  }
  return null;
}

function moveMatchesTarget(position: ImmutablePosition, move: Move, targetPosition: string) {
  const next = position.clone();
  return next.doMove(move) && comparableSfen(next.sfen) === targetPosition;
}

function comparableSfen(value: string) {
  return String(value ?? "").trim().split(/\s+/).slice(0, 3).join(" ");
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

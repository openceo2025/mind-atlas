import type {
  AtlasNode,
  NativeBoardRecordFormat,
  NativeBoardRecordPayload,
  NotebookMode,
} from "../../types";

export type BoardNotebookMode = Exclude<NotebookMode, "standard">;

export const BOARD_RECORD_FORMATS: Record<BoardNotebookMode, { label: string; extension: NativeBoardRecordFormat }> = {
  shogi: { label: "KIF", extension: "kif" },
  chess: { label: "PGN", extension: "pgn" },
  go: { label: "SGF", extension: "sgf" },
};

export function isBoardNotebookMode(value: unknown): value is BoardNotebookMode {
  return value === "shogi" || value === "chess" || value === "go";
}

export function boardModeForNativeFormat(value: unknown): BoardNotebookMode | null {
  if (value === "kif") return "shogi";
  if (value === "pgn") return "chess";
  if (value === "sgf") return "go";
  return null;
}

export async function exportNativeBoardRecord(
  root: AtlasNode,
  requestedMode?: BoardNotebookMode,
): Promise<NativeBoardRecordPayload> {
  const mode = requestedMode ?? (isBoardNotebookMode(root.notebookMode) ? root.notebookMode : null);
  if (!mode) throw new Error("This workspace is not a shogi, chess, or Go record.");
  const format = BOARD_RECORD_FORMATS[mode].extension;
  let text = "";
  if (mode === "shogi") {
    const { exportShogiRecord } = await import("../shogi/shogiRecord.ts");
    text = exportShogiRecord(root);
  } else if (mode === "chess") {
    const { exportChessRecord } = await import("../chess/chessRecord.ts");
    text = exportChessRecord(root);
  } else {
    const { exportGoRecord } = await import("../go/goRecord.ts");
    text = exportGoRecord(root);
  }
  return {
    kind: "board-record",
    schemaVersion: 1,
    mode,
    format,
    title: root.title || `Mind Atlas ${BOARD_RECORD_FORMATS[mode].label}`,
    text,
  };
}

export async function importNativeBoardRecord(payload: NativeBoardRecordPayload) {
  if (!isNativeBoardRecordPayload(payload)) throw new Error("The saved board-game record is invalid.");
  if (payload.mode === "shogi") {
    const { importShogiRecordText } = await import("../shogi/shogiRecord.ts");
    return { ...importShogiRecordText(payload.text, payload.title, "kif"), mode: payload.mode };
  }
  if (payload.mode === "chess") {
    const { importChessRecordText } = await import("../chess/chessRecord.ts");
    return { ...importChessRecordText(payload.text, payload.title), mode: payload.mode };
  }
  const { importGoRecordText } = await import("../go/goRecord.ts");
  return { ...importGoRecordText(payload.text, payload.title), mode: payload.mode };
}

export async function importNativeBoardRecordFile(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".kif") || lowerName.endsWith(".ki2") || lowerName.endsWith(".csa")) {
    const { importShogiRecordFile } = await import("../shogi/shogiRecord.ts");
    return { ...(await importShogiRecordFile(file)), mode: "shogi" as const };
  }
  if (lowerName.endsWith(".pgn")) {
    const { importChessRecordFile } = await import("../chess/chessRecord.ts");
    return { ...(await importChessRecordFile(file)), mode: "chess" as const };
  }
  if (lowerName.endsWith(".sgf")) {
    const { importGoRecordFile } = await import("../go/goRecord.ts");
    return { ...(await importGoRecordFile(file)), mode: "go" as const };
  }
  throw new Error("Use KIF, KI2, CSA, PGN, or SGF.");
}

export async function importNativeBoardRecordText(
  mode: BoardNotebookMode,
  text: string,
  datasetName: string,
  preferredFormat?: "kif" | "ki2" | "csa",
) {
  if (mode === "shogi") {
    const { importShogiRecordText } = await import("../shogi/shogiRecord.ts");
    return { ...importShogiRecordText(text, datasetName, preferredFormat), mode };
  }
  if (mode === "chess") {
    const { importChessRecordText } = await import("../chess/chessRecord.ts");
    return { ...importChessRecordText(text, datasetName), mode };
  }
  const { importGoRecordText } = await import("../go/goRecord.ts");
  return { ...importGoRecordText(text, datasetName), mode };
}

export function nativeBoardRecordSizeBytes(payload: NativeBoardRecordPayload) {
  return new TextEncoder().encode(payload.text).byteLength;
}

export function nativeBoardRecordFileName(payload: NativeBoardRecordPayload, title = payload.title) {
  return `${sanitizeRecordFileLabel(title)}.${payload.format}`;
}

export function isNativeBoardRecordPayload(value: unknown): value is NativeBoardRecordPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<NativeBoardRecordPayload>;
  return candidate.kind === "board-record"
    && candidate.schemaVersion === 1
    && isBoardNotebookMode(candidate.mode)
    && BOARD_RECORD_FORMATS[candidate.mode].extension === candidate.format
    && typeof candidate.title === "string"
    && typeof candidate.text === "string";
}

function sanitizeRecordFileLabel(value: string) {
  return value.trim().replace(/[\\/:*?"<>|#\r\n\t]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "Mind Atlas";
}

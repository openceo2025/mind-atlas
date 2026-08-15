import { ChevronLeft, ChevronRight, Download, GitBranch, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.cburnett.css";
import { exportChessRecord, findChessNodeContent, findChessRecordRoot, nearestChessRecordNode } from "./chessRecord";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, ChessRecordContent } from "../../types";

interface ChessViewerProps {
  enabled?: boolean;
  onStatus?: (message: string) => void;
}

export function ChessViewer({ enabled = true, onStatus }: ChessViewerProps) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const recordRoot = findChessRecordRoot(atlasRoot, selectedNodeId);
  const currentNode = recordRoot ? nearestChessRecordNode(atlasRoot, selectedNodeId, recordRoot.id) : null;
  const currentContent = findChessNodeContent(currentNode) ?? findChessNodeContent(recordRoot);
  const path = recordRoot && currentNode ? findPath(recordRoot, currentNode.id) ?? [recordRoot] : recordRoot ? [recordRoot] : [];
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const variations = (currentNode ?? recordRoot)?.children.filter((node) => findChessNodeContent(node)?.role === "move") ?? [];
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const configRef = useRef<Config | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  configRef.current = currentContent ? makeBoardConfig(currentContent, handleMove) : null;

  useEffect(() => {
    if (!enabled || !recordRoot || !boardRef.current) return;
    try {
      apiRef.current?.destroy();
      apiRef.current = Chessground(boardRef.current, configRef.current ?? undefined);
      setLibraryReady(true);
    } catch (error) {
      console.error("Failed to load chessground", error);
      setLibraryError("チェス盤ライブラリを読み込めませんでした。");
    }
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [enabled, recordRoot?.id]);

  useEffect(() => {
    if (!apiRef.current || !currentContent) return;
    apiRef.current.set(makeBoardConfig(currentContent, handleMove));
  }, [currentContent?.fen, currentNode?.id, recordRoot?.id]);

  if (!enabled || !recordRoot || !currentContent || !selectedNode) return null;

  function handleMove(orig: string, dest: string) {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const content = findChessNodeContent(parent);
    if (!content) return;
    const position = positionFromFen(content.fen);
    const uci = normalizeCastling(`${orig}${dest}`);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) {
      onStatus?.("その手は現在の局面では指せません。");
      apiRef.current?.set(makeBoardConfig(content, handleMove));
      return;
    }
    const existing = parent.children.find((child) => findChessNodeContent(child)?.uci === uci);
    if (existing) {
      focusNode(existing.id);
      return;
    }
    const san = makeSan(position, move);
    const nextPosition = position.clone();
    nextPosition.play(move);
    const displayText = formatMoveLabel(position, san);
    const childId = addChildNode(parent.id, "", { title: displayText, focus: false, requestEdit: false });
    if (!childId) return;
    const nextContent: ChessRecordContent = {
      kind: "chess-record",
      schemaVersion: 1,
      role: "move",
      recordId: content.recordId,
      sourceFormat: content.sourceFormat,
      ply: content.ply + 1,
      fen: makeFenForPosition(nextPosition),
      uci,
      san,
      displayText,
      branchIndex: parent.children.filter((child) => findChessNodeContent(child)?.role === "move").length,
    };
    updateNode(childId, { structuredContent: nextContent });
    focusNode(childId);
  }

  const jumpTo = (node: AtlasNode | null) => {
    if (node) focusNode(node.id);
  };

  const exportCurrentRecord = () => {
    try {
      const pgn = exportChessRecord(atlasRoot);
      const blob = new Blob([pgn], { type: "application/x-chess-pgn;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${recordRoot.title || "chess-record"}.pgn`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Chess PGN export failed", error);
      onStatus?.(error instanceof Error ? error.message : "PGNの出力に失敗しました。");
    }
  };

  return (
    <section className="chess-viewer" aria-label="Chess record viewer">
      <div className="chess-viewer-toolbar">
        <span className="chess-viewer-label">チェス</span>
        <span className="chess-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply} ply`}</span>
        <button type="button" className="chess-viewer-icon" onClick={() => jumpTo(recordRoot)} aria-label="開始局面">
          <RotateCcw size={14} />
        </button>
        <button type="button" className="chess-viewer-icon" onClick={() => jumpTo(parentNode)} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="chess-viewer-icon" onClick={() => jumpTo(variations[0] ?? null)} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <button type="button" className="chess-viewer-icon" onClick={exportCurrentRecord} aria-label="PGNを出力">
          <Download size={14} />
        </button>
      </div>
      <div className="chess-board-host" ref={boardRef} />
      {!libraryReady && !libraryError ? <p className="chess-viewer-note">チェス盤を準備しています...</p> : null}
      {libraryError ? <p className="chess-viewer-note is-error">{libraryError}</p> : null}
      {variations.length > 1 ? (
        <div className="chess-variations" aria-label="分岐">
          <GitBranch size={13} />
          {variations.map((node) => (
            <button key={node.id} type="button" className={node.id === currentNode?.id ? "is-active" : ""} onClick={() => focusNode(node.id)}>
              {findChessNodeContent(node)?.displayText || node.title}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function makeBoardConfig(content: ChessRecordContent, onMove: (orig: string, dest: string) => void): Config {
  const turnColor = content.fen.split(" ")[1] === "b" ? "black" : "white";
  return {
    fen: content.fen as never,
    orientation: "white",
    turnColor,
    coordinates: true,
    blockTouchScroll: true,
    movable: {
      free: true,
      color: "both",
      showDests: true,
      events: { after: onMove },
    },
    draggable: { enabled: true },
    selectable: { enabled: true },
    drawable: { enabled: false, visible: false },
    animation: { enabled: true, duration: 180 },
  };
}

function positionFromFen(fen: string) {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

function makeFenForPosition(position: ReturnType<typeof positionFromFen>) {
  return makeFen(position.toSetup());
}

function normalizeCastling(uci: string) {
  if (uci === "e1g1") return "e1h1";
  if (uci === "e1c1") return "e1a1";
  if (uci === "e8g8") return "e8h8";
  if (uci === "e8c8") return "e8a8";
  return uci;
}

function formatMoveLabel(position: ReturnType<typeof positionFromFen>, san: string) {
  return `${position.fullmoves}${position.turn === "white" ? "." : "..."} ${san}`;
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

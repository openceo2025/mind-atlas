import { ChevronLeft, ChevronRight, GitBranch, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatKIFMove, Position } from "tsshogi";
import type { Api } from "shogiground/api";
import { findShogiNodeContent, findShogiRecordRoot } from "./shogiRecord";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, ShogiRecordContent } from "../../types";

const PIECE_ROLES: Record<string, string> = {
  pawn: "P",
  lance: "L",
  knight: "N",
  silver: "S",
  gold: "G",
  bishop: "B",
  rook: "R",
  king: "K",
};

interface ShogiViewerProps {
  enabled?: boolean;
  onStatus?: (message: string) => void;
}

export function ShogiViewer({ enabled = true, onStatus }: ShogiViewerProps) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const recordRoot = findShogiRecordRoot(atlasRoot, selectedNodeId);
  const currentNode = recordRoot ? nearestRecordNode(atlasRoot, selectedNodeId, recordRoot.id) : null;
  const currentContent = findShogiNodeContent(currentNode) ?? findShogiNodeContent(recordRoot);
  const path = recordRoot && currentNode ? findPath(recordRoot, currentNode.id) ?? [recordRoot] : recordRoot ? [recordRoot] : [];
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const variations = (currentNode ?? recordRoot)?.children.filter((node) => findShogiNodeContent(node)?.role === "move") ?? [];
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [selectedSquare, setSelectedSquare] = useState("");
  const [orientation, setOrientation] = useState<"sente" | "gote">("sente");
  const boardRef = useRef<HTMLDivElement>(null);
  const topHandRef = useRef<HTMLDivElement>(null);
  const bottomHandRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const boardConfigRef = useRef<ReturnType<typeof makeBoardConfig> | null>(null);

  const boardConfig = useMemo(
    () => (currentContent?.kind === "shogi-record" ? makeBoardConfig(currentContent.sfen, (usi) => handleMove(usi), orientation) : null),
    [currentContent?.sfen, currentNode?.id, orientation, recordRoot?.id],
  );
  boardConfigRef.current = boardConfig;

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !recordRoot || !boardRef.current || !topHandRef.current || !bottomHandRef.current) return;
    void import("shogiground")
      .then(({ Shogiground }) => {
        if (cancelled || !boardRef.current || !topHandRef.current || !bottomHandRef.current) return;
        apiRef.current?.destroy();
        apiRef.current = Shogiground(boardConfigRef.current ?? undefined, {
          board: boardRef.current,
          hands: { top: topHandRef.current, bottom: bottomHandRef.current },
        });
        setLibraryReady(true);
      })
      .catch((error) => {
        console.error("Failed to load shogiground", error);
        setLibraryError("将棋盤ライブラリを読み込めませんでした。");
      });
    return () => {
      cancelled = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, [enabled, recordRoot?.id]);

  useEffect(() => {
    if (!apiRef.current || !boardConfig) return;
    apiRef.current.set(boardConfig, true);
  }, [boardConfig]);

  if (!enabled || !recordRoot || !currentContent || !selectedNode) return null;

  function handleMove(usi: string) {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const content = findShogiNodeContent(parent);
    if (!content) return;
    const position = Position.newBySFEN(content.sfen);
    const move = position?.createMoveByUSI(usi);
    if (!position || !move) {
      onStatus?.("その手は現在の局面では指せません。");
      if (boardConfigRef.current) apiRef.current?.set(boardConfigRef.current, true);
      return;
    }
    const existing = parent.children.find((child) => findShogiNodeContent(child)?.usi === usi);
    if (existing) {
      focusNode(existing.id);
      return;
    }
    const nextPosition = position.clone();
    if (!nextPosition.doMove(move)) {
      onStatus?.("その手は現在の局面では指せません。");
      if (boardConfigRef.current) apiRef.current?.set(boardConfigRef.current, true);
      return;
    }
    const childId = addChildNode(parent.id, "", { title: formatKIFMove(move), focus: false, requestEdit: false });
    if (!childId) return;
    const nextContent: ShogiRecordContent = {
      kind: "shogi-record",
      schemaVersion: 1,
      role: "move",
      recordId: content.recordId,
      sourceFormat: content.sourceFormat,
      ply: content.ply + 1,
      sfen: nextPosition.sfen,
      usi,
      displayText: formatKIFMove(move),
      branchIndex: parent.children.filter((child) => findShogiNodeContent(child)?.role === "move").length,
    };
    updateNode(childId, { structuredContent: nextContent });
    focusNode(childId);
  }

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const boardElement = boardRef.current;
    const boardBounds = boardElement?.getBoundingClientRect();
    if (!boardElement || !boardBounds) return;
    const piece = Array.from(boardElement.querySelectorAll("piece")).find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    }) as (HTMLElement & { sgKey?: string }) | undefined;
    const target = document.elementFromPoint(event.clientX, event.clientY) as (HTMLElement & { sgKey?: string }) | null;
    const square = target?.closest("piece, sq") as (HTMLElement & { sgKey?: string }) | null;
    const key = piece?.sgKey ?? square?.sgKey ?? shogiKeyAtPoint(boardBounds, event.clientX, event.clientY);
    if (!key) return;
    if (!selectedSquare && piece?.sgKey) {
      setSelectedSquare(key);
      return;
    }
    if (selectedSquare) {
      const from = selectedSquare;
      setSelectedSquare("");
      handleMove(`${from}${key}`);
    }
  };

  const jumpTo = (node: AtlasNode | null) => {
    if (node) focusNode(node.id);
  };

  return (
    <section className="shogi-viewer" aria-label="Shogi record viewer">
      <div className="shogi-viewer-toolbar">
        <span className="shogi-viewer-label">将棋</span>
        <span className="shogi-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply}手目`}</span>
        <button
          type="button"
          className="shogi-viewer-icon"
          onClick={() => {
            setSelectedSquare("");
            setOrientation((current) => current === "sente" ? "gote" : "sente");
          }}
          aria-label="盤面を反転"
          title="盤面を反転"
        >
          <RotateCcw size={14} />
        </button>
        <button type="button" className="shogi-viewer-icon" onClick={() => jumpTo(parentNode)} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="shogi-viewer-icon" onClick={() => jumpTo(variations[0] ?? null)} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="shogi-board-shell">
        <div className="shogi-hand-host" ref={topHandRef} />
        <div className="shogi-board-host" ref={boardRef} onPointerDownCapture={handleBoardPointerDown} />
        <div className="shogi-hand-host" ref={bottomHandRef} />
      </div>
      {!libraryReady && !libraryError ? <p className="shogi-viewer-note">将棋盤を準備しています...</p> : null}
      {libraryError ? <p className="shogi-viewer-note is-error">{libraryError}</p> : null}
      <div className="shogi-variations" aria-label="候補手">
        {variations.length ? <GitBranch size={13} /> : null}
        {variations.map((node) => (
          <button key={node.id} type="button" className={node.id === currentNode?.id ? "is-active" : ""} onClick={() => focusNode(node.id)}>
            {findShogiNodeContent(node)?.displayText || node.title}
          </button>
        ))}
      </div>
    </section>
  );
}

function shogiKeyAtPoint(bounds: DOMRect, clientX: number, clientY: number) {
  const fileIndex = Math.floor(((clientX - bounds.left) / bounds.width) * 9);
  const rankIndex = Math.floor(((clientY - bounds.top) / bounds.height) * 9);
  if (fileIndex < 0 || fileIndex > 8 || rankIndex < 0 || rankIndex > 8) return undefined;
  return `${9 - fileIndex}${"abcdefghi"[rankIndex]}`;
}

function makeBoardConfig(sfen: string, onMove: (usi: string) => void, orientation: "sente" | "gote") {
  const [board = "", turn = "b", hands = "-"] = sfen.split(" ");
  const turnColor = turn === "w" ? "gote" : "sente";
  return {
    sfen: { board, hands },
    orientation,
    turnColor: turnColor as "sente" | "gote",
    // The viewer validates the resulting USI through tsshogi. Keeping both
    // colors selectable also makes imported handicap/analysis positions
    // editable when the record's side-to-move metadata is incomplete.
    activeColor: "both" as const,
    coordinates: { enabled: true, files: "numeric" as const, ranks: "numeric" as const },
    scaleDownPieces: false,
    blockTouchScroll: true,
    movable: {
      free: true,
      showDests: true,
      events: { after: (orig: string, dest: string, prom: boolean) => onMove(`${orig}${dest}${prom ? "+" : ""}`) },
    },
    droppable: {
      free: true,
      showDests: true,
      events: { after: (piece: { role: string }, key: string, prom: boolean) => onMove(`${PIECE_ROLES[piece.role] ?? "P"}*${key}${prom ? "+" : ""}`) },
    },
    promotion: { movePromotionDialog: () => true, dropPromotionDialog: () => true },
    drawable: { enabled: false, visible: false },
    animation: { enabled: true, duration: 180 },
  };
}

function nearestRecordNode(root: AtlasNode, nodeId: string, recordRootId: string) {
  const path = findPath(root, nodeId);
  if (!path) return null;
  const start = path.findIndex((node) => node.id === recordRootId);
  return start >= 0 ? [...path].slice(start).reverse().find((node) => findShogiNodeContent(node)?.kind === "shogi-record") ?? null : null;
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

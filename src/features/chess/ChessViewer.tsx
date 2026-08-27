import { ChevronLeft, ChevronRight, GitBranch, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Chess } from "chessops/chess";
import { chessgroundDests, chessgroundMove } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { Role } from "chessops/types";
import { parseSquare, parseUci } from "chessops/util";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.cburnett.css";
import { findChessNodeContent, findChessRecordRoot, nearestChessRecordNode } from "./chessRecord";
import { useBoardBranchNavigation } from "../board/boardNavigation";
import { BoardBranchJumpButton } from "../board/BoardBranchJumpButtons";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, ChessRecordContent } from "../../types";
import { formatAppMessage } from "../../i18n/format";

const PROMOTION_OPTIONS: Array<{ role: Role; label: string; suffix: string }> = [
  { role: "queen", label: "Q", suffix: "q" },
  { role: "rook", label: "R", suffix: "r" },
  { role: "bishop", label: "B", suffix: "b" },
  { role: "knight", label: "N", suffix: "n" },
];

interface ChessViewerProps {
  enabled?: boolean;
  onStatus?: (message: string) => void;
}

type PendingPromotion = {
  baseUci: string;
  options: typeof PROMOTION_OPTIONS;
};

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
  const variationChildren = (currentNode ?? recordRoot)?.children ?? [];
  const variations = useMemo(
    () => variationChildren.filter((node) => findChessNodeContent(node)?.role === "move"),
    [variationChildren],
  );
  const {
    rememberChild,
    selectVariation,
    advance,
    advanceToTail,
    hasNextBranchPoint,
    hasPreviousBranchPoint,
    replayToNextBranchPoint,
    replayToPreviousBranchPoint,
  } = useBoardBranchNavigation(recordRoot, currentNode, focusNode);
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const configRef = useRef<Config | null>(null);
  const candidateArrowheadId = useId().replace(/:/g, "");
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const candidateArrows = useMemo(() => buildCandidateArrows(variations, orientation), [variations, orientation]);
  const branchTail = currentNode ? findRecordTail(currentNode) : recordRoot ? findRecordTail(recordRoot) : null;
  configRef.current = currentContent ? makeBoardConfig(currentContent, handleBoardMove, orientation) : null;

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
    apiRef.current.set(makeBoardConfig(currentContent, handleBoardMove, orientation));
  }, [currentContent?.fen, currentContent?.uci, currentNode?.id, orientation, recordRoot?.id]);

  useEffect(() => {
    setPendingPromotion(null);
  }, [currentContent?.fen, currentContent?.uci, currentNode?.id, recordRoot?.id]);

  if (!enabled || !recordRoot || !currentContent || !selectedNode) return null;

  function handleBoardMove(orig: string, dest: string) {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const content = findChessNodeContent(parent);
    if (!content) return;
    const position = positionFromFen(content.fen);
    const baseUci = normalizeCastling(`${orig}${dest}`);
    const from = parseSquare(baseUci.slice(0, 2));
    const to = parseSquare(baseUci.slice(2, 4));
    const piece = from === undefined ? undefined : position.board.get(from);
    const reachesBackRank = to !== undefined && (to < 8 || to >= 56);
    if (piece?.role === "pawn" && reachesBackRank) {
      const options = PROMOTION_OPTIONS.filter(({ suffix }) => {
        const move = parseUci(`${baseUci}${suffix}`);
        return Boolean(move && position.isLegal(move));
      });
      if (options.length) {
        setPendingPromotion({ baseUci, options });
        return;
      }
    }
    commitMove(baseUci);
  }

  function commitMove(uci: string) {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const content = findChessNodeContent(parent);
    if (!content) return;
    const position = positionFromFen(content.fen);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) {
      onStatus?.("その手は現在の局面では指せません。");
      apiRef.current?.set(makeBoardConfig(content, handleBoardMove, orientation));
      setPendingPromotion(null);
      return;
    }
    const existing = parent.children.find((child) => findChessNodeContent(child)?.uci === uci);
    if (existing) {
      setPendingPromotion(null);
      rememberChild(parent.id, existing.id);
      focusNode(existing.id);
      return;
    }
    const san = makeSan(position, move);
    const nextPosition = position.clone();
    nextPosition.play(move);
    const displayText = formatMoveLabel(san);
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
    setPendingPromotion(null);
    updateNode(childId, { structuredContent: nextContent });
    rememberChild(parent.id, childId);
    focusNode(childId);
  }

  const jumpTo = (node: AtlasNode | null) => {
    if (node) focusNode(node.id);
  };

  return (
    <section className="chess-viewer" aria-label="Chess record viewer">
      <div className="chess-viewer-toolbar">
        <span className="chess-viewer-label">チェス</span>
        <span className="chess-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply} ply`}</span>
        <button
          type="button"
          className="chess-viewer-icon"
          onClick={() => setOrientation((current) => current === "white" ? "black" : "white")}
          aria-label={formatAppMessage("board.flip")}
          title={formatAppMessage("board.flip")}
        >
          <RotateCcw size={14} />
        </button>
        <button type="button" className="chess-viewer-icon" onClick={() => jumpTo(recordRoot)} disabled={!recordRoot || currentNode?.id === recordRoot.id} aria-label={formatAppMessage("board.navigation.first")} title={formatAppMessage("board.navigation.first")}>
          <SkipBack size={14} />
        </button>
        <BoardBranchJumpButton
          className="chess-viewer-icon"
          direction="previous"
          disabled={!hasPreviousBranchPoint}
          onClick={replayToPreviousBranchPoint}
        />
        <button type="button" className="chess-viewer-icon" onClick={() => jumpTo(parentNode)} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="chess-viewer-icon" onClick={advance} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <BoardBranchJumpButton
          className="chess-viewer-icon"
          direction="next"
          disabled={!hasNextBranchPoint}
          onClick={replayToNextBranchPoint}
        />
        <button type="button" className="chess-viewer-icon" onClick={advanceToTail} disabled={!branchTail || branchTail.id === currentNode?.id} aria-label={formatAppMessage("board.navigation.last")} title={formatAppMessage("board.navigation.last")}>
          <SkipForward size={14} />
        </button>
      </div>
      <div className="chess-board-frame">
        <div className="chess-board-host" ref={boardRef} />
        <div className="chess-candidate-overlay">
          <svg className="chess-candidate-arrows" viewBox="0 0 800 800" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id={candidateArrowheadId} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" />
              </marker>
            </defs>
            {candidateArrows.map((candidate) => (
              <line
                key={`arrow-${candidate.node.id}`}
                x1={candidate.from[0]}
                y1={candidate.from[1]}
                x2={candidate.to[0]}
                y2={candidate.to[1]}
                markerEnd={`url(#${candidateArrowheadId})`}
              />
            ))}
          </svg>
          {candidateArrows.map((candidate) => (
            <span
              key={candidate.node.id}
              className="chess-candidate-arrow-hit"
              style={{ left: `${candidate.to[0] / 8}%`, top: `${candidate.to[1] / 8}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
        {pendingPromotion ? (
          <div className="chess-promotion-picker" role="dialog" aria-label={formatAppMessage("board.chess.promotion")}>
            {pendingPromotion.options.map((option) => (
              <button key={option.role} type="button" onClick={() => commitMove(`${pendingPromotion.baseUci}${option.suffix}`)}>
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="is-cancel"
              onClick={() => {
                setPendingPromotion(null);
                apiRef.current?.set(makeBoardConfig(currentContent, handleBoardMove, orientation));
              }}
            >
              {formatAppMessage("common.cancel")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="chess-variations" aria-label={formatAppMessage("board.candidateMoves")}>
        <span className="board-variation-label">{formatAppMessage("board.candidateMoves")}</span>
        {variations.length ? <GitBranch size={13} /> : null}
        {variations.map((node) => (
          <button key={node.id} type="button" onClick={() => selectVariation(node)}>
            {findChessNodeContent(node)?.displayText || node.title}
          </button>
        ))}
      </div>
      {!libraryReady && !libraryError ? <p className="chess-viewer-note">チェス盤を準備しています...</p> : null}
      {libraryError ? <p className="chess-viewer-note is-error">{libraryError}</p> : null}
    </section>
  );
}

function makeBoardConfig(
  content: ChessRecordContent,
  onMove: (orig: string, dest: string) => void,
  orientation: "white" | "black",
): Config {
  const position = positionFromFen(content.fen);
  const turnColor = position.turn;
  return {
    fen: content.fen as never,
    orientation,
    turnColor,
    check: position.isCheck() ? turnColor : false,
    lastMove: makeLastMove(content.uci),
    coordinates: true,
    blockTouchScroll: true,
    movable: {
      free: false,
      color: turnColor,
      dests: chessgroundDests(position) as Map<Key, Key[]>,
      showDests: true,
      rookCastle: true,
      events: { after: onMove },
    },
    premovable: { enabled: false },
    draggable: { enabled: true },
    selectable: { enabled: true },
    drawable: { enabled: false, visible: false, autoShapes: [] },
    highlight: { lastMove: true, check: true },
    animation: { enabled: true, duration: 180 },
  };
}

type ChessCandidateArrow = {
  node: AtlasNode;
  label: string;
  from: [number, number];
  to: [number, number];
};

function buildCandidateArrows(nodes: AtlasNode[], orientation: "white" | "black"): ChessCandidateArrow[] {
  const groups = new Map<string, Array<{ node: AtlasNode; label: string; from: string; to: string }>>();
  for (const node of nodes) {
    const content = findChessNodeContent(node);
    const uci = content?.uci;
    const move = uci ? parseUci(uci) : undefined;
    if (!uci || !move || !("from" in move)) continue;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const key = `${from}-${to}`;
    const group = groups.get(key) ?? [];
    group.push({ node, label: content?.displayText || node.title, from, to });
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => group.map((candidate, index) => {
    const from = chessArrowPoint(candidate.from, orientation);
    const to = chessArrowPoint(candidate.to, orientation);
    const offset = (index - (group.length - 1) / 2) * 12;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    const normal: [number, number] = [-dy / length * offset, dx / length * offset];
    return {
      node: candidate.node,
      label: candidate.label,
      from: [from[0] + normal[0], from[1] + normal[1]],
      to: [to[0] + normal[0], to[1] + normal[1]],
    };
  }));
}

function chessArrowPoint(square: string, orientation: "white" | "black"): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return [(column + 0.5) * 100, (row + 0.5) * 100];
}

function makeLastMove(uci?: string): Key[] | undefined {
  const move = uci ? parseUci(uci) : undefined;
  return move ? chessgroundMove(move) as Key[] : undefined;
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

function formatMoveLabel(san: string) {
  return san;
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

function findRecordTail(node: AtlasNode): AtlasNode {
  const next = node.children.find((child) => findChessNodeContent(child)?.role === "move");
  return next ? findRecordTail(next) : node;
}

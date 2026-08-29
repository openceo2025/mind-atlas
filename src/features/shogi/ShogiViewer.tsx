import { ChevronLeft, ChevronRight, GitBranch, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatKIFMove, handPieceTypes, Position, Square } from "tsshogi";
import type { Api } from "shogiground/api";
import type { Config } from "shogiground/config";
import type { DropDests, Key, MoveDests, PieceName, RoleString } from "shogiground/types";
import { findShogiNodeContent, findShogiRecordRoot } from "./shogiRecord";
import { BoardBranchJumpButton } from "../board/BoardBranchJumpButtons";
import { findRecordProvenance } from "../board/recordProvenance";
import { buildShogiCandidateArrows, buildShogiCandidateTargets } from "./shogiCandidates";
import { useBoardBranchNavigation } from "../board/boardNavigation";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, ShogiRecordContent } from "../../types";
import { formatAppMessage } from "../../i18n/format";

/**
 * Candidate-arrow geometry, expressed in board squares.
 *
 * The board overlay is drawn on a 900-unit grid, so one square is 100 units and
 * every arrow measurement can be stated as a fraction of a square. Both arrows
 * on the board and arrows that start in a hand tray use these, which is what
 * keeps a drop arrow the same size as a move arrow.
 */
const SHOGI_SQUARE_UNITS = 100;
/** Matches the stroke width the candidate arrows are styled with. */
const CANDIDATE_ARROW_STROKE = 10;
const CANDIDATE_ARROWHEAD_SQUARES = 0.3;
/**
 * How far short of each piece's centre the arrow stops.
 *
 * An arrow drawn centre to centre covers both pieces it is talking about. This
 * clearance leaves the piece it starts from and the square it points at both
 * legible, so the arrow reads as a relation between two things rather than as
 * something drawn on top of them.
 */
const CANDIDATE_ARROW_CLEARANCE_SQUARES = 1 / 3;
/** Shaft left visible behind the head once both ends have been trimmed. */
const CANDIDATE_ARROW_MIN_SHAFT_SQUARES = 0.2;

/**
 * Works out where to draw the shaft so that the arrow tip lands `clearance`
 * short of `to` and no part of the shaft shows through the head.
 *
 * The returned end is the head's base, not the tip: a stroked line ends in a
 * round cap and keeps its full width all the way, so a line drawn to the tip
 * pokes out along the head's slopes and past its point. The head is placed from
 * this end instead, and covers the last stretch itself.
 *
 * A one-square move is the shortest arrow the board can produce; there the
 * clearance yields rather than letting the shaft disappear behind the head.
 */
function trimCandidateSegment(
  from: readonly [number, number],
  to: readonly [number, number],
  square: number,
): { from: [number, number]; to: [number, number] } | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0 || square <= 0) return null;
  const clearance = CANDIDATE_ARROW_CLEARANCE_SQUARES * square;
  const headLength = CANDIDATE_ARROWHEAD_SQUARES * square;
  const minimumSpan = headLength + CANDIDATE_ARROW_MIN_SHAFT_SQUARES * square;
  const trim = Math.min(clearance, Math.max(0, (length - minimumSpan) / 2));
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    from: [from[0] + unitX * trim, from[1] + unitY * trim],
    to: [to[0] - unitX * (trim + headLength), to[1] - unitY * (trim + headLength)],
  };
}

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

const PROMOTED_ROLES: Record<string, string> = {
  pawn: "tokin",
  lance: "promotedlance",
  knight: "promotedknight",
  silver: "promotedsilver",
  bishop: "horse",
  rook: "dragon",
};

const UNPROMOTED_ROLES = Object.fromEntries(Object.entries(PROMOTED_ROLES).map(([base, promoted]) => [promoted, base]));
const JAPANESE_RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

interface ShogiViewerProps {
  enabled?: boolean;
  onStatus?: (message: string) => void;
}

type DropArrowLayout = {
  width: number;
  height: number;
  strokeWidth: number;
  markerWidth: number;
  markerHeight: number;
  arrows: Array<{ id: string; from: [number, number]; to: [number, number] }>;
};

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
  const {
    rememberChild,
    selectVariation,
    retreat,
    advance,
    advanceToTail,
    hasNextBranchPoint,
    hasPreviousBranchPoint,
    replayToNextBranchPoint,
    replayToPreviousBranchPoint,
  } = useBoardBranchNavigation(recordRoot, currentNode, focusNode);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [orientation, setOrientation] = useState<"sente" | "gote">("sente");
  const boardRef = useRef<HTMLDivElement>(null);
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const topHandRef = useRef<HTMLDivElement>(null);
  const bottomHandRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const boardConfigRef = useRef<Config | null>(null);
  const candidateArrowheadId = useId().replace(/:/g, "");

  const boardConfig = useMemo(
    () => (currentContent?.kind === "shogi-record" ? makeBoardConfig(currentContent, handleMove, orientation) : null),
    [currentContent?.sfen, currentContent?.usi, currentNode?.id, orientation, recordRoot?.id],
  );
  boardConfigRef.current = boardConfig;

  const candidateArrows = useMemo(() => buildShogiCandidateArrows(variations, orientation), [variations, orientation]);
  const candidateTargets = useMemo(() => buildShogiCandidateTargets(candidateArrows), [candidateArrows]);
  const [dropArrowLayout, setDropArrowLayout] = useState<DropArrowLayout>({ width: 0, height: 0, strokeWidth: 0, markerWidth: 0, markerHeight: 0, arrows: [] });
  const branchTail = currentNode ? findRecordTail(currentNode) : recordRoot ? findRecordTail(recordRoot) : null;
  const coordinateFiles = orientation === "sente" ? ["9", "8", "7", "6", "5", "4", "3", "2", "1"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const coordinateRanks = orientation === "sente" ? JAPANESE_RANKS : [...JAPANESE_RANKS].reverse();

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

  useEffect(() => {
    const shell = shellRef.current;
    const boardFrame = boardFrameRef.current;
    if (!shell || !boardFrame || !currentContent || !recordRoot) {
      setDropArrowLayout({ width: 0, height: 0, strokeWidth: 0, markerWidth: 0, markerHeight: 0, arrows: [] });
      return;
    }
    let frameId = 0;
    const updateLayout = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const shellRect = shell.getBoundingClientRect();
        const boardRect = boardFrame.getBoundingClientRect();
        const boardScale = boardRect.width / 900;
        const turnColor = currentContent.sfen.split(" ")[1] === "w" ? "gote" : "sente";
        const handHost = turnColor === orientation ? bottomHandRef.current : topHandRef.current;
        const arrows = candidateArrows
          .filter((candidate) => candidate.isDrop && candidate.dropRole)
          .flatMap((candidate) => {
            const handPiece = handHost?.querySelector<HTMLElement>(`sg-hp-wrap piece.${candidate.dropRole}`);
            if (!handPiece) return [];
            const handRect = handPiece.getBoundingClientRect();
            const squarePx = boardRect.width / 9;
            const segment = trimCandidateSegment(
              [handRect.left + handRect.width / 2 - shellRect.left, handRect.top + handRect.height / 2 - shellRect.top],
              [
                boardRect.left - shellRect.left + boardRect.width * candidate.to[0] / 900,
                boardRect.top - shellRect.top + boardRect.height * candidate.to[1] / 900,
              ],
              squarePx,
            );
            if (!segment) return [];
            return [{ id: candidate.node.id, from: segment.from, to: segment.to }];
          });
        // This overlay is measured in shell pixels rather than board units, so
        // each figure is converted through the board scale. Both come from the
        // same constants the board arrows use, so an arrow that starts in a
        // hand tray is the same weight and the same head as one that starts on
        // a square.
        setDropArrowLayout({
          width: shellRect.width,
          height: shellRect.height,
          strokeWidth: CANDIDATE_ARROW_STROKE * boardScale,
          markerWidth: CANDIDATE_ARROWHEAD_SQUARES * SHOGI_SQUARE_UNITS * boardScale,
          markerHeight: CANDIDATE_ARROWHEAD_SQUARES * SHOGI_SQUARE_UNITS * boardScale,
          arrows,
        });
      });
    };
    updateLayout();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateLayout);
    resizeObserver?.observe(shell);
    resizeObserver?.observe(boardFrame);
    window.addEventListener("resize", updateLayout, { passive: true });
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateLayout);
    };
  }, [candidateArrows, currentContent?.sfen, orientation, recordRoot?.id, libraryReady]);

  if (!enabled || !recordRoot || !currentContent || !selectedNode) return null;

  function handleMove(usi: string) {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const content = findShogiNodeContent(parent);
    if (!content) return;
    const position = Position.newBySFEN(content.sfen);
    const move = position?.createMoveByUSI(usi);
    if (!position || !move || !position.isValidMove(move)) {
      onStatus?.("その手は現在の局面では指せません。");
      if (boardConfigRef.current) apiRef.current?.set(boardConfigRef.current, true);
      return;
    }
    const existing = parent.children.find((child) => findShogiNodeContent(child)?.usi === usi);
    if (existing) {
      rememberChild(parent.id, existing.id);
      focusNode(existing.id);
      return;
    }
    const nextPosition = position.clone();
    if (!nextPosition.doMove(move)) {
      onStatus?.("その手は現在の局面では指せません。");
      if (boardConfigRef.current) apiRef.current?.set(boardConfigRef.current, true);
      return;
    }
    const moveText = formatKIFMove(move);
    const childId = addChildNode(parent.id, "", { title: moveText, focus: false, requestEdit: false });
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
      displayText: moveText,
      branchIndex: parent.children.filter((child) => findShogiNodeContent(child)?.role === "move").length,
    };
    updateNode(childId, { structuredContent: nextContent });
    rememberChild(parent.id, childId);
    focusNode(childId);
  }

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
          onClick={() => setOrientation((current) => current === "sente" ? "gote" : "sente")}
          aria-label={formatAppMessage("board.shogi.flip")}
          title={formatAppMessage("board.shogi.flip")}
        >
          <RotateCcw size={14} />
        </button>
        <button type="button" className="shogi-viewer-icon" onClick={() => jumpTo(recordRoot)} disabled={!recordRoot || currentNode?.id === recordRoot.id} aria-label={formatAppMessage("board.navigation.first")} title={formatAppMessage("board.navigation.first")}>
          <SkipBack size={14} />
        </button>
        <BoardBranchJumpButton
          className="shogi-viewer-icon"
          direction="previous"
          disabled={!hasPreviousBranchPoint}
          onClick={replayToPreviousBranchPoint}
        />
        <button type="button" className="shogi-viewer-icon" onClick={retreat} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="shogi-viewer-icon" onClick={advance} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <BoardBranchJumpButton
          className="shogi-viewer-icon"
          direction="next"
          disabled={!hasNextBranchPoint}
          onClick={replayToNextBranchPoint}
        />
        <button type="button" className="shogi-viewer-icon" onClick={advanceToTail} disabled={!branchTail || branchTail.id === currentNode?.id} aria-label={formatAppMessage("board.navigation.last")} title={formatAppMessage("board.navigation.last")}>
          <SkipForward size={14} />
        </button>
      </div>
      <div className={`shogi-board-shell orientation-${orientation}`} ref={shellRef}>
        {dropArrowLayout.arrows.length ? (
          <svg
            className="shogi-drop-arrow-overlay"
            viewBox={`0 0 ${dropArrowLayout.width} ${dropArrowLayout.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={`${candidateArrowheadId}-drop`}
                markerWidth={dropArrowLayout.markerWidth}
                markerHeight={dropArrowLayout.markerHeight}
                viewBox="0 0 7 7"
                markerUnits="userSpaceOnUse"
                refX="0"
                refY="3.5"
                orient="auto"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" />
              </marker>
            </defs>
            {dropArrowLayout.arrows.map((arrow) => (
              <line
                key={`drop-arrow-${arrow.id}`}
                x1={arrow.from[0]}
                y1={arrow.from[1]}
                x2={arrow.to[0]}
                y2={arrow.to[1]}
                style={{ strokeWidth: dropArrowLayout.strokeWidth }}
                markerEnd={`url(#${candidateArrowheadId}-drop)`}
              />
            ))}
          </svg>
        ) : null}
        <div className="shogi-hand-host" ref={topHandRef} />
        <div className="shogi-board-frame" ref={boardFrameRef}>
          <div className={`shogi-board-host orientation-${orientation}`} ref={boardRef} />
          <div className="shogi-file-coordinates" aria-hidden="true">
            {coordinateFiles.map((file) => <span key={file}>{file}</span>)}
          </div>
          <div className="shogi-rank-coordinates" aria-hidden="true">
            {coordinateRanks.map((rank) => <span key={rank}>{rank}</span>)}
          </div>
          <div className="shogi-candidate-overlay">
            <svg className="shogi-candidate-arrows" viewBox="0 0 900 900" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                {/*
                  * The head is sized in squares, not in stroke widths. Marker
                  * units default to the stroke width, so the 7-unit head this
                  * arrow is drawn from came out seven times the 10-unit line -
                  * 70% of a square - and buried the piece it was pointing at.
                  * The viewBox scales that same shape into the width below, so
                  * the head is CANDIDATE_ARROWHEAD_SQUARES of one square.
                  */}
                <marker
                  id={candidateArrowheadId}
                  viewBox="0 0 7 7"
                  markerWidth={CANDIDATE_ARROWHEAD_SQUARES * SHOGI_SQUARE_UNITS / CANDIDATE_ARROW_STROKE}
                  markerHeight={CANDIDATE_ARROWHEAD_SQUARES * SHOGI_SQUARE_UNITS / CANDIDATE_ARROW_STROKE}
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7 Z" />
                </marker>
              </defs>
              {candidateArrows.flatMap((candidate) => {
                if (!candidate.from) return [];
                const segment = trimCandidateSegment(candidate.from, candidate.to, SHOGI_SQUARE_UNITS);
                if (!segment) return [];
                return [(
                  <line
                    key={`arrow-${candidate.node.id}`}
                    x1={segment.from[0]}
                    y1={segment.from[1]}
                    x2={segment.to[0]}
                    y2={segment.to[1]}
                    markerEnd={`url(#${candidateArrowheadId})`}
                  />
                )];
              })}
            </svg>
            {candidateTargets.map((candidate) => (
              <span
                key={candidate.node.id}
                className={`shogi-candidate-arrow-hit ${candidate.isDrop ? "is-drop" : ""}`}
                data-candidate-kind={candidate.isDrop ? "drop" : "move"}
                data-candidate-square={candidate.toSquare}
                style={{ left: `${(candidate.to[0] / 9)}%`, top: `${(candidate.to[1] / 9)}%` }}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
        <div className="shogi-hand-host" ref={bottomHandRef} />
      </div>
      <div className="shogi-variations" aria-label={formatAppMessage("board.candidateMoves")}>
        <span className="board-variation-label">{formatAppMessage("board.candidateMoves")}</span>
        {variations.length ? <GitBranch size={13} /> : null}
        {variations.map((node) => {
          const provenance = findRecordProvenance(node);
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => selectVariation(node)}
              className={provenance ? "has-record-source" : ""}
              title={provenance ? provenance.headline : undefined}
            >
              <span className="board-variation-move">{findShogiNodeContent(node)?.displayText || node.title}</span>
              {provenance ? <span className="board-variation-source">{provenance.headline}</span> : null}
            </button>
          );
        })}
      </div>
      {!libraryReady && !libraryError ? <p className="shogi-viewer-note">将棋盤を準備しています...</p> : null}
      {libraryError ? <p className="shogi-viewer-note is-error">{libraryError}</p> : null}
    </section>
  );
}

function makeBoardConfig(content: ShogiRecordContent, onMove: (usi: string) => void, orientation: "sente" | "gote"): Config {
  const position = Position.newBySFEN(content.sfen);
  const [board = "", turn = "b", hands = "-"] = content.sfen.split(" ");
  const turnColor = turn === "w" ? "gote" : "sente";
  if (!position) {
    return { sfen: { board, hands }, orientation, viewOnly: true };
  }
  const { moveDests, dropDests } = makeLegalDests(position, turnColor);
  return {
    sfen: { board, hands },
    orientation,
    turnColor,
    activeColor: turnColor,
    checks: position.checked ? turnColor : false,
    lastDests: lastMoveSquares(content.usi),
    lastPiece: lastDropPiece(content.usi, turnColor),
    coordinates: { enabled: false },
    scaleDownPieces: false,
    blockTouchScroll: true,
    highlight: { lastDests: true, check: true, checkRoles: ["king"], hovered: true },
    hands: { roles: ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"] },
    movable: {
      free: false,
      dests: moveDests,
      showDests: true,
      events: { after: (orig, dest, promoted) => onMove(`${orig}${dest}${promoted ? "+" : ""}`) },
    },
    droppable: {
      free: false,
      dests: dropDests,
      showDests: true,
      events: { after: (piece, key) => onMove(`${PIECE_ROLES[piece.role] ?? "P"}*${key}`) },
    },
    premovable: { enabled: false },
    predroppable: { enabled: false },
    promotion: {
      promotesTo: (role) => PROMOTED_ROLES[role],
      unpromotesTo: (role) => UNPROMOTED_ROLES[role],
      movePromotionDialog: (orig, dest) => isOptionalPromotion(position, orig, dest),
      forceMovePromotion: (orig, dest) => isForcedPromotion(position, orig, dest),
      dropPromotionDialog: () => false,
      forceDropPromotion: () => false,
    },
    drawable: { enabled: false, visible: false },
    animation: { enabled: true, hands: true, duration: 180 },
  };
}

function makeLegalDests(position: Position, turnColor: "sente" | "gote") {
  const moveDests: MoveDests = new Map();
  for (const from of position.board.listSquaresByColor(position.color)) {
    const destinations: Key[] = [];
    for (const to of Square.all) {
      const move = position.createMove(from, to);
      if (!move) continue;
      if (position.isValidMove(move) || position.isValidMove(move.withPromote())) destinations.push(to.usi as Key);
    }
    if (destinations.length) moveDests.set(from.usi as Key, destinations);
  }

  const dropDests: DropDests = new Map();
  for (const pieceType of handPieceTypes) {
    if (position.hand(position.color).count(pieceType) <= 0) continue;
    const destinations: Key[] = [];
    for (const to of Square.all) {
      const move = position.createMove(pieceType, to);
      if (move && position.isValidMove(move)) destinations.push(to.usi as Key);
    }
    if (destinations.length) dropDests.set(`${turnColor} ${pieceType}` as PieceName, destinations);
  }
  return { moveDests, dropDests };
}

function isOptionalPromotion(position: Position, orig: Key, dest: Key) {
  const move = position.createMoveByUSI(`${orig}${dest}`);
  if (!move || !PROMOTED_ROLES[move.pieceType]) return false;
  return position.isValidMove(move) && position.isValidMove(move.withPromote());
}

function isForcedPromotion(position: Position, orig: Key, dest: Key) {
  const move = position.createMoveByUSI(`${orig}${dest}`);
  if (!move || !PROMOTED_ROLES[move.pieceType]) return false;
  return !position.isValidMove(move) && position.isValidMove(move.withPromote());
}

function lastMoveSquares(usi?: string): Key[] | undefined {
  if (!usi) return undefined;
  if (usi.includes("*")) return [usi.slice(2, 4) as Key];
  return [usi.slice(0, 2) as Key, usi.slice(2, 4) as Key];
}

function lastDropPiece(usi: string | undefined, turnColor: "sente" | "gote") {
  if (!usi?.includes("*")) return undefined;
  const role = Object.entries(PIECE_ROLES).find(([, symbol]) => symbol === usi[0])?.[0] as RoleString | undefined;
  return role ? { role, color: turnColor === "sente" ? "gote" as const : "sente" as const } : undefined;
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

function findRecordTail(node: AtlasNode): AtlasNode {
  const next = node.children.find((child) => findShogiNodeContent(child)?.role === "move");
  return next ? findRecordTail(next) : node;
}

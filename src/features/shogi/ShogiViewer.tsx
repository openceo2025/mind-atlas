import { BookOpen, ChevronLeft, ChevronRight, GitBranch, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatKIFMove, handPieceTypes, Position, Square } from "tsshogi";
import type { Api } from "shogiground/api";
import type { Config } from "shogiground/config";
import type { DropDests, Key, MoveDests, PieceName, RoleString } from "shogiground/types";
import { findShogiNodeContent, findShogiRecordRoot } from "./shogiRecord";
import { toShogiBoardNotation } from "./shogiNotation";
import { BoardBranchJumpButton } from "../board/BoardBranchJumpButtons";
import { findRecordProvenance } from "../board/recordProvenance";
import { buildShogiCandidateArrows, buildShogiCandidateTargets } from "./shogiCandidates";
import { useBoardBranchNavigation } from "../board/boardNavigation";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, ShogiRecordContent } from "../../types";
import { formatAppMessage } from "../../i18n/format";

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
    const moveText = toShogiBoardNotation(formatKIFMove(move));
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

  // Shown for the move the user is standing on, so a branch that was merged in
  // says which game it came from without needing a hover.
  const currentProvenance = findRecordProvenance(currentNode);

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
        <button type="button" className="shogi-viewer-icon" onClick={() => jumpTo(parentNode)} disabled={!parentNode} aria-label="一手戻る">
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
      <div className={`shogi-board-shell orientation-${orientation}`}>
        <div className="shogi-hand-host" ref={topHandRef} />
        <div className="shogi-board-frame">
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
                <marker id={candidateArrowheadId} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" />
                </marker>
              </defs>
              {candidateArrows.filter((candidate) => candidate.from).map((candidate) => (
                <line
                  key={`arrow-${candidate.node.id}`}
                  x1={candidate.from?.[0]}
                  y1={candidate.from?.[1]}
                  x2={candidate.to[0]}
                  y2={candidate.to[1]}
                  markerEnd={`url(#${candidateArrowheadId})`}
                  onClick={() => selectVariation(candidate.node)}
                />
              ))}
            </svg>
            {candidateTargets.map((candidate) => (
              <button
                key={candidate.node.id}
                type="button"
                className={`shogi-candidate-arrow-hit ${candidate.isDrop ? "is-drop" : ""}`}
                data-candidate-kind={candidate.isDrop ? "drop" : "move"}
                data-candidate-square={candidate.toSquare}
                style={{ left: `${(candidate.to[0] / 9)}%`, top: `${(candidate.to[1] / 9)}%` }}
                onClick={() => selectVariation(candidate.node)}
                aria-label={candidate.label}
                title={candidate.label}
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
      {currentProvenance ? (
        <dl className="board-record-source" aria-label={formatAppMessage("board.recordSource.label")}>
          <div className="board-record-source-headline">
            <BookOpen size={12} aria-hidden="true" />
            <span>{formatAppMessage("board.recordSource.label")}</span>
          </div>
          {currentProvenance.entries.map(([key, value]) => (
            <div key={key} className="board-record-source-row">
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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

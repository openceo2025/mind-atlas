import { ChevronLeft, ChevronRight, GitBranch, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useMemo, useState } from "react";
import GoBoard, { type Sign, type Vertex } from "@sabaki/go-board";
import { canEditGoRecord, findGoNodeContent, findGoRecordRoot, goRecordPath, goVertexToSgf, nearestGoRecordNode, nextGoSign, boardFromGoContent } from "./goRecord";
import { useBoardBranchNavigation } from "../board/boardNavigation";
import { BoardBranchJumpButton } from "../board/BoardBranchJumpButtons";
import { boardMoveIdentity } from "../board/boardMoveIdentity";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, GoRecordContent } from "../../types";
import { formatAppMessage } from "../../i18n/format";

interface GoViewerProps {
  enabled?: boolean;
  onStatus?: (message: string) => void;
}

export function GoViewer({ enabled = true, onStatus }: GoViewerProps) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const recordRoot = findGoRecordRoot(atlasRoot, selectedNodeId);
  const currentNode = recordRoot ? nearestGoRecordNode(atlasRoot, selectedNodeId, recordRoot.id) : null;
  const rootContent = findGoNodeContent(recordRoot);
  const currentContent = findGoNodeContent(currentNode) ?? rootContent;
  const phone19ReplayOnly = Boolean(currentContent && currentContent.boardSize >= 19 && isMobileBoardGameViewport());
  const canEdit = Boolean(rootContent && canEditGoRecord(rootContent) && !phone19ReplayOnly);
  const path = recordRoot && currentNode ? goRecordPath(recordRoot, currentNode.id) : recordRoot ? [recordRoot] : [];
  const positionHistory = path
    .map((node) => findGoNodeContent(node)?.board)
    .filter((value): value is string => Boolean(value));
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const variations = (currentNode ?? recordRoot)?.children.filter((node) => findGoNodeContent(node)?.role === "move") ?? [];
  const branchTail = currentNode ? findRecordTail(currentNode) : recordRoot ? findRecordTail(recordRoot) : null;
  const board = useMemo(() => (currentContent ? boardFromGoContent(currentContent) : null), [currentContent?.board, currentContent?.boardSize]);
  const [flipped, setFlipped] = useState(false);
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

  if (!enabled || !recordRoot || !rootContent || !currentContent || !selectedNode || !board) return null;

  const lastVertex = currentContent.vertex && currentContent.vertex !== "pass" ? board.parseVertex(currentContent.vertex) : null;
  const candidateNodesByVertex = new Map<string, AtlasNode[]>();
  for (const variation of variations) {
    const content = findGoNodeContent(variation);
    if (!content?.vertex || content.vertex === "pass") continue;
    const nodes = candidateNodesByVertex.get(content.vertex) ?? [];
    nodes.push(variation);
    candidateNodesByVertex.set(content.vertex, nodes);
  }

  const addMove = (vertex: Vertex, pass = false) => {
    if (!canEdit) {
      onStatus?.(formatAppMessage("board.go.replayOnly"));
      return;
    }
    const parent = currentNode ?? recordRoot;
    const parentContent = findGoNodeContent(parent);
    if (!parentContent) return;
    const sign = nextGoSign(rootContent, parent);
    const color = sign === 1 ? "B" : "W";
    const rawVertex = pass ? "" : goVertexToSgf(vertex);
    const moveIdentity = `go:${color}:${(pass ? "pass" : board.stringifyVertex(vertex)).trim().toLowerCase()}`;
    const existing = parent.children.find((child) => {
      const content = findGoNodeContent(child);
      return content?.role === "move" && boardMoveIdentity(child) === moveIdentity;
    });
    if (existing) {
      rememberChild(parent.id, existing.id);
      focusNode(existing.id);
      return;
    }
    let nextBoard = board;
    if (!pass) {
      const analysis = board.analyzeMove(sign, vertex);
      if (analysis.overwrite || analysis.suicide || analysis.ko) {
        onStatus?.("その手は現在の局面では指せません。");
        return;
      }
      nextBoard = board.makeMove(sign, vertex, { preventOverwrite: true, preventSuicide: true });
      const previousPosition = positionHistory.at(-2);
      if (previousPosition && boardString(nextBoard) === previousPosition) {
        onStatus?.("コウのため、直前の局面へ戻る手は指せません。");
        return;
      }
    }
    const displayText = pass ? `${color} pass` : `${color} ${board.stringifyVertex(vertex)}`;
    const nextContent: GoRecordContent = {
      kind: "go-record",
      schemaVersion: 1,
      role: "move",
      recordId: parentContent.recordId,
      sourceFormat: parentContent.sourceFormat,
      ply: parentContent.ply + 1,
      boardSize: parentContent.boardSize,
      board: boardString(nextBoard),
      color,
      vertex: pass ? "pass" : board.stringifyVertex(vertex),
      displayText,
      branchIndex: parent.children.filter((child) => findGoNodeContent(child)?.role === "move").length,
    };
    const childId = addChildNode(parent.id, "", {
      title: displayText,
      focus: false,
      requestEdit: false,
      allowBoardRecordNode: true,
      structuredContent: nextContent,
      boardMoveIdentity: boardMoveIdentity(nextContent) ?? moveIdentity,
    });
    if (!childId) return;
    rememberChild(parent.id, childId);
    focusNode(childId);
  };

  return (
    <section className="go-viewer" aria-label="Go record viewer">
      <div className="go-viewer-toolbar">
        <span className="go-viewer-label">囲碁</span>
        <span className="go-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply} 手目`}</span>
        <span className="go-viewer-rules">{rootContent.metadata?.RU}</span>
        <button
          type="button"
          className="go-viewer-icon"
          onClick={() => setFlipped((current) => !current)}
          aria-label={formatAppMessage("board.flip")}
          title={formatAppMessage("board.flip")}
        >
          <RotateCcw size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => recordRoot && focusNode(recordRoot.id)} disabled={!recordRoot || currentNode?.id === recordRoot.id} aria-label={formatAppMessage("board.navigation.first")} title={formatAppMessage("board.navigation.first")}>
          <SkipBack size={14} />
        </button>
        <BoardBranchJumpButton
          className="go-viewer-icon"
          direction="previous"
          disabled={!hasPreviousBranchPoint}
          onClick={replayToPreviousBranchPoint}
        />
        <button type="button" className="go-viewer-icon" onClick={retreat} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={advance} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <BoardBranchJumpButton
          className="go-viewer-icon"
          direction="next"
          disabled={!hasNextBranchPoint}
          onClick={replayToNextBranchPoint}
        />
        <button type="button" className="go-viewer-icon" onClick={advanceToTail} disabled={!branchTail || branchTail.id === currentNode?.id} aria-label={formatAppMessage("board.navigation.last")} title={formatAppMessage("board.navigation.last")}>
          <SkipForward size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => addMove([-1, -1], true)} disabled={!canEdit} aria-label="パス">
          Pass
        </button>
      </div>
      {!canEdit ? <p className="chess-viewer-note">{formatAppMessage("board.go.replayOnly")}</p> : null}
      <div className={`go-board-host ${flipped ? "is-flipped" : ""}`} style={{ "--go-size": currentContent.boardSize } as React.CSSProperties}>
        {Array.from({ length: currentContent.boardSize * currentContent.boardSize }, (_, index) => {
          const boardIndex = flipped ? currentContent.boardSize * currentContent.boardSize - 1 - index : index;
          const x = boardIndex % currentContent.boardSize;
          const y = Math.floor(boardIndex / currentContent.boardSize);
          const vertex: Vertex = [x, y];
          const sign = board.get(vertex);
          const vertexLabel = board.stringifyVertex(vertex);
          const candidateNodes = candidateNodesByVertex.get(vertexLabel) ?? [];
          const isCandidate = candidateNodes.length > 0;
          const isLast = Boolean(lastVertex && lastVertex[0] === x && lastVertex[1] === y);
          const edgeClasses = [
            x === 0 ? "is-left-edge" : "",
            x === currentContent.boardSize - 1 ? "is-right-edge" : "",
            y === 0 ? "is-top-edge" : "",
            y === currentContent.boardSize - 1 ? "is-bottom-edge" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              className={`go-point ${edgeClasses} ${sign === 1 ? "is-black" : sign === -1 ? "is-white" : ""} ${isStarPoint(x, y, currentContent.boardSize) ? "is-star" : ""} ${isLast ? "is-last" : ""} ${isCandidate ? "is-candidate" : ""}`}
              onClick={() => isCandidate ? selectVariation(candidateNodes[0]) : sign === 0 ? addMove(vertex) : onStatus?.("その交点にはすでに石があります。")}
              disabled={!isCandidate && sign === 0 && !canEdit}
              aria-label={`${vertexLabel}${sign === 1 ? " 黒" : sign === -1 ? " 白" : ""}${isCandidate ? ` ${formatAppMessage("board.candidateMoves")}` : ""}`}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="go-variations" aria-label={formatAppMessage("board.candidateMoves")}>
        <span className="board-variation-label">{formatAppMessage("board.candidateMoves")}</span>
        {variations.length ? <GitBranch size={13} /> : null}
        {variations.map((node) => (
          <button key={node.id} type="button" className={node.id === currentNode?.id ? "is-active" : ""} onClick={() => selectVariation(node)}>
            {findGoNodeContent(node)?.displayText || node.title}
          </button>
        ))}
      </div>
    </section>
  );
}

function boardString(board: GoBoard) {
  let result = "";
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) result += board.get([x, y]) === 1 ? "X" : board.get([x, y]) === -1 ? "O" : ".";
  }
  return result;
}

function isStarPoint(x: number, y: number, size: number) {
  if (size < 7) return false;
  const points = size >= 13 ? [3, size - 4, Math.floor(size / 2)] : [2, size - 3];
  return points.includes(x) && points.includes(y);
}

function findRecordTail(node: AtlasNode): AtlasNode {
  const next = node.children.find((child) => findGoNodeContent(child)?.role === "move");
  return next ? findRecordTail(next) : node;
}

function isMobileBoardGameViewport() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const fixedHeight = Number.parseFloat(document.documentElement.style.getPropertyValue("--board-mobile-fixed-height"));
  const height = Number.isFinite(fixedHeight) && fixedHeight > 0 ? fixedHeight : Math.round(window.innerHeight);
  return width <= 980 && height > width;
}

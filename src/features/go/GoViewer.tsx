import { ChevronLeft, ChevronRight, GitBranch, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useMemo, useState } from "react";
import GoBoard, { type Sign, type Vertex } from "@sabaki/go-board";
import { findGoNodeContent, findGoRecordRoot, goRecordPath, goVertexToSgf, nearestGoRecordNode, nextGoSign, boardFromGoContent } from "./goRecord";
import { useBoardBranchNavigation } from "../board/boardNavigation";
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
  const updateNode = useAtlasStore((state) => state.updateNode);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const recordRoot = findGoRecordRoot(atlasRoot, selectedNodeId);
  const currentNode = recordRoot ? nearestGoRecordNode(atlasRoot, selectedNodeId, recordRoot.id) : null;
  const rootContent = findGoNodeContent(recordRoot);
  const currentContent = findGoNodeContent(currentNode) ?? rootContent;
  const path = recordRoot && currentNode ? goRecordPath(recordRoot, currentNode.id) : recordRoot ? [recordRoot] : [];
  const positionHistory = path
    .map((node) => findGoNodeContent(node)?.board)
    .filter((value): value is string => Boolean(value));
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const variations = (currentNode ?? recordRoot)?.children.filter((node) => findGoNodeContent(node)?.role === "move") ?? [];
  const branchTail = currentNode ? findRecordTail(currentNode) : recordRoot ? findRecordTail(recordRoot) : null;
  const board = useMemo(() => (currentContent ? boardFromGoContent(currentContent) : null), [currentContent?.board, currentContent?.boardSize]);
  const [flipped, setFlipped] = useState(false);
  const { rememberChild, selectVariation, advance } = useBoardBranchNavigation(recordRoot, currentNode, focusNode);

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
  const turnLabel = nextGoSign(rootContent, currentNode ?? recordRoot) === 1 ? "黒番" : "白番";

  const addMove = (vertex: Vertex, pass = false) => {
    const parent = currentNode ?? recordRoot;
    const parentContent = findGoNodeContent(parent);
    if (!parentContent) return;
    const sign = nextGoSign(rootContent, parent);
    const color = sign === 1 ? "B" : "W";
    const rawVertex = pass ? "" : goVertexToSgf(vertex);
    const existing = parent.children.find((child) => {
      const content = findGoNodeContent(child);
      return content?.role === "move" && content.color === color && (content.vertex === "pass" ? pass : content.vertex === board.stringifyVertex(vertex));
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
    const childId = addChildNode(parent.id, "", { title: displayText, focus: false, requestEdit: false });
    if (!childId) return;
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
    updateNode(childId, { structuredContent: nextContent });
    rememberChild(parent.id, childId);
    focusNode(childId);
  };

  return (
    <section className="go-viewer" aria-label="Go record viewer">
      <div className="go-viewer-toolbar">
        <span className="go-viewer-label">囲碁</span>
        <span className="go-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply} 手目`}</span>
        <span className="board-turn-indicator">{turnLabel}</span>
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
        <button type="button" className="go-viewer-icon" onClick={() => parentNode && focusNode(parentNode.id)} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={advance} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => branchTail && focusNode(branchTail.id)} disabled={!branchTail || branchTail.id === currentNode?.id} aria-label={formatAppMessage("board.navigation.last")} title={formatAppMessage("board.navigation.last")}>
          <SkipForward size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => addMove([-1, -1], true)} aria-label="パス">
          Pass
        </button>
      </div>
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

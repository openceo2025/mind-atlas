import { ChevronLeft, ChevronRight, Download, GitBranch, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import GoBoard, { type Sign, type Vertex } from "@sabaki/go-board";
import { exportGoRecord, findGoNodeContent, findGoRecordRoot, goRecordPath, goVertexToSgf, nearestGoRecordNode, nextGoSign, boardFromGoContent } from "./goRecord";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode, GoRecordContent } from "../../types";

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
  const parentNode = path.length > 1 ? path[path.length - 2] : null;
  const variations = (currentNode ?? recordRoot)?.children.filter((node) => findGoNodeContent(node)?.role === "move") ?? [];
  const board = useMemo(() => (currentContent ? boardFromGoContent(currentContent) : null), [currentContent?.board, currentContent?.boardSize]);

  if (!enabled || !recordRoot || !rootContent || !currentContent || !selectedNode || !board) return null;

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
      nextBoard = board.makeMove(sign, vertex, { preventOverwrite: true, preventSuicide: true, preventKo: true });
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
    focusNode(childId);
  };

  const exportCurrentRecord = () => {
    try {
      const sgf = exportGoRecord(atlasRoot);
      const blob = new Blob([sgf], { type: "application/x-go-sgf;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${recordRoot.title || "go-record"}.sgf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Go SGF export failed", error);
      onStatus?.(error instanceof Error ? error.message : "SGFの出力に失敗しました。");
    }
  };

  return (
    <section className="go-viewer" aria-label="Go record viewer">
      <div className="go-viewer-toolbar">
        <span className="go-viewer-label">囲碁</span>
        <span className="go-viewer-position">{currentContent.ply === 0 ? "開始局面" : `${currentContent.ply} 手目`}</span>
        <button type="button" className="go-viewer-icon" onClick={() => focusNode(recordRoot.id)} aria-label="開始局面">
          <RotateCcw size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => parentNode && focusNode(parentNode.id)} disabled={!parentNode} aria-label="一手戻る">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => variations[0] && focusNode(variations[0].id)} disabled={!variations.length} aria-label="一手進む">
          <ChevronRight size={14} />
        </button>
        <button type="button" className="go-viewer-icon" onClick={() => addMove([-1, -1], true)} aria-label="パス">
          Pass
        </button>
        <button type="button" className="go-viewer-icon" onClick={exportCurrentRecord} aria-label="SGFを出力">
          <Download size={14} />
        </button>
      </div>
      <div className="go-board-host" style={{ "--go-size": currentContent.boardSize } as React.CSSProperties}>
        {Array.from({ length: currentContent.boardSize * currentContent.boardSize }, (_, index) => {
          const x = index % currentContent.boardSize;
          const y = Math.floor(index / currentContent.boardSize);
          const vertex: Vertex = [x, y];
          const sign = board.get(vertex);
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              className={`go-point ${sign === 1 ? "is-black" : sign === -1 ? "is-white" : ""} ${isStarPoint(x, y, currentContent.boardSize) ? "is-star" : ""}`}
              onClick={() => sign === 0 ? addMove(vertex) : onStatus?.("その交点にはすでに石があります。")}
              aria-label={`${board.stringifyVertex(vertex)}${sign === 1 ? " 黒" : sign === -1 ? " 白" : ""}`}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {variations.length > 1 ? (
        <div className="go-variations" aria-label="分岐">
          <GitBranch size={13} />
          {variations.map((node) => (
            <button key={node.id} type="button" className={node.id === currentNode?.id ? "is-active" : ""} onClick={() => focusNode(node.id)}>
              {findGoNodeContent(node)?.displayText || node.title}
            </button>
          ))}
        </div>
      ) : null}
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

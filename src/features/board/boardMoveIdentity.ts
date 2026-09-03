import type { AtlasNode, AtlasStructuredContent } from "../../types";
import type { BoardNotebookMode } from "./boardRecord.ts";

/**
 * Returns the move identity that is meaningful under one board position.
 *
 * A destination position is not used as the identity: two different moves
 * must remain different variations even when a ruleset happens to make them
 * converge. The parent node supplies the scope, while this key identifies the
 * actual move made from that parent.
 */
export function boardMoveIdentity(value: AtlasNode | AtlasStructuredContent | null | undefined): string | null {
  const content = isAtlasNode(value) ? value.structuredContent : value;
  if (!content || content.role !== "move") return null;
  if (content.kind === "shogi-record") {
    const usi = content.usi?.trim().toLowerCase();
    return usi ? `shogi:${usi}` : null;
  }
  if (content.kind === "chess-record") {
    const uci = content.uci?.trim().toLowerCase();
    return uci ? `chess:${uci}` : null;
  }
  if (content.kind === "go-record") {
    const color = content.color?.trim().toUpperCase();
    const vertex = content.vertex?.trim().toLowerCase();
    return color && vertex ? `go:${color}:${vertex}` : null;
  }
  return null;
}

export function findBoardMoveChild(parent: AtlasNode, mode: BoardNotebookMode, identity: string): AtlasNode | null {
  return parent.children.find((child) => {
    const content = child.structuredContent;
    if (!content || content.kind !== `${mode}-record` || content.role !== "move") return false;
    return boardMoveIdentity(child) === identity;
  }) ?? null;
}

function isAtlasNode(value: AtlasNode | AtlasStructuredContent | null | undefined): value is AtlasNode {
  return Boolean(value && typeof value === "object" && "id" in value && "children" in value);
}

import type { AtlasNode, ShogiRecordContent } from "../../types";

/**
 * Promoted silver, knight and lance are written two ways, and the two ways
 * belong to two different places.
 *
 * A shogi board carries the one-character forms - 全, 圭, 杏 - because that is
 * what fits on a piece, and Mind Atlas draws its board pieces that way. Written
 * move text does not have that constraint and reads as KIF does: 成銀, 成桂,
 * 成香. Node titles, node bodies and the candidate-move list are written move
 * text, so they use the KIF spelling.
 *
 * The record files themselves are unaffected either way: tsshogi re-derives
 * move text from the position on export, and its parser accepts both spellings.
 */
export const SHOGI_PROMOTED_PIECE_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["成銀", "全"],
  ["成桂", "圭"],
  ["成香", "杏"],
];

export function hasBoardPromotedPieceText(text: string): boolean {
  const value = String(text ?? "");
  return SHOGI_PROMOTED_PIECE_TEXT.some(([, boardText]) => value.includes(boardText));
}

/** Rewrites board-style promoted pieces back to how move text spells them. */
export function toKifPromotedPieceText(text: string): string {
  let result = String(text ?? "");
  for (const [kifText, boardText] of SHOGI_PROMOTED_PIECE_TEXT) {
    if (result.includes(boardText)) result = result.split(boardText).join(kifText);
  }
  return result;
}

/**
 * Repairs records written while move text used the board forms.
 *
 * A title is only rewritten when it still matches its own move text, so a title
 * the user wrote by hand keeps whatever they wrote - including a bare 全 or 杏
 * that was never a piece name.
 *
 * Returns null when nothing changed, so the caller can skip a notebook write.
 */
export function normalizeShogiNotebookNotation(root: AtlasNode): AtlasNode | null {
  let changed = false;

  const visit = (node: AtlasNode): AtlasNode => {
    const children = node.children.map(visit);
    const childrenChanged = children.some((child, index) => child !== node.children[index]);
    const content = node.structuredContent?.kind === "shogi-record"
      ? (node.structuredContent as ShogiRecordContent)
      : null;
    const displayText = content?.displayText ?? "";
    if (content?.role !== "move" || !hasBoardPromotedPieceText(displayText)) {
      return childrenChanged ? { ...node, children } : node;
    }
    changed = true;
    const nextDisplayText = toKifPromotedPieceText(displayText);
    return {
      ...node,
      title: node.title === displayText ? nextDisplayText : node.title,
      structuredContent: { ...content, displayText: nextDisplayText },
      children,
    };
  };

  const next = visit(root);
  return changed ? next : null;
}

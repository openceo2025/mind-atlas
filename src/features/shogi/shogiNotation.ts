import type { AtlasNode, ShogiRecordContent } from "../../types";

/**
 * KIF writes promoted silver, knight and lance with two characters ("成銀",
 * "成桂", "成香"), but a shogi board carries the one-character forms. Mind Atlas
 * shows moves next to the board, so it uses the board forms everywhere a move is
 * named. The record files themselves are unaffected: tsshogi re-derives move
 * text from the position on export, and its parser accepts both spellings.
 */
export const SHOGI_PROMOTED_PIECE_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["成銀", "全"],
  ["成桂", "圭"],
  ["成香", "杏"],
];

export function toShogiBoardNotation(text: string): string {
  let result = String(text ?? "");
  for (const [kifText, boardText] of SHOGI_PROMOTED_PIECE_TEXT) {
    if (result.includes(kifText)) result = result.split(kifText).join(boardText);
  }
  return result;
}

export function hasKifPromotedPieceText(text: string): boolean {
  const value = String(text ?? "");
  return SHOGI_PROMOTED_PIECE_TEXT.some(([kifText]) => value.includes(kifText));
}

/**
 * Rewrites records that were imported before the board forms were adopted.
 * A move title is only rewritten when it still matches its own move text, so a
 * title the user wrote by hand is never edited.
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
    if (content?.role !== "move" || !hasKifPromotedPieceText(displayText)) {
      return childrenChanged ? { ...node, children } : node;
    }
    changed = true;
    const nextDisplayText = toShogiBoardNotation(displayText);
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

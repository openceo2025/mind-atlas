import { formatKIFMove, Position } from "tsshogi";
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

  const visit = (node: AtlasNode, parent: AtlasNode | null): AtlasNode => {
    const children = node.children.map((child) => visit(child, node));
    const childrenChanged = children.some((child, index) => child !== node.children[index]);
    const content = node.structuredContent?.kind === "shogi-record"
      ? (node.structuredContent as ShogiRecordContent)
      : null;
    if (content?.role !== "move") {
      return childrenChanged ? { ...node, children } : node;
    }

    const displayText = content.displayText ?? "";
    const nextDisplayText = canonicalMoveText(parent, content) ?? toKifPromotedPieceText(displayText);
    const nextTitle = titleFollowsGeneratedMove(node.title, displayText)
      ? nextDisplayText
      : node.title;
    const contentChanged = nextDisplayText !== displayText;
    const titleChanged = nextTitle !== node.title;
    if (!contentChanged && !titleChanged) {
      return childrenChanged ? { ...node, children } : node;
    }
    changed = true;
    return {
      ...node,
      ...(titleChanged ? { title: nextTitle } : {}),
      ...(contentChanged ? { structuredContent: { ...content, displayText: nextDisplayText } } : {}),
      children,
    };
  };

  const next = visit(root, null);
  return changed ? next : null;
}

function canonicalMoveText(parent: AtlasNode | null, content: ShogiRecordContent) {
  const parentContent = parent?.structuredContent;
  if (!parentContent || parentContent.kind !== "shogi-record" || !content.usi) return null;
  const position = Position.newBySFEN(parentContent.sfen);
  const move = position?.createMoveByUSI(content.usi);
  return position && move && position.isValidMove(move) ? formatKIFMove(move) : null;
}

function titleFollowsGeneratedMove(title: string, displayText: string) {
  const normalize = (value: string) => value
    .trim()
    .replace(/^[▲△]\s*/, "")
    .replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0))
    .replace(/\s+/g, "");
  const normalizedDisplay = normalize(displayText).replace(/\([０-９]{2}\)$/, "");
  return normalize(title).replace(/\([０-９]{2}\)$/, "") === normalizedDisplay;
}

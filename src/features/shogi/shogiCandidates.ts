import { findShogiNodeContent } from "./shogiRecord.ts";
import type { AtlasNode } from "../../types";

export type ShogiCandidateArrow = {
  node: AtlasNode;
  label: string;
  from?: [number, number];
  to: [number, number];
  fromSquare?: string;
  toSquare: string;
  isDrop: boolean;
  dropRole?: string;
};

const MAX_SHARED_DESTINATION_SPAN = 64;
const PREFERRED_SHARED_DESTINATION_SPACING = 54;

export function buildShogiCandidateArrows(nodes: AtlasNode[], orientation: "sente" | "gote"): ShogiCandidateArrow[] {
  const groups = new Map<string, Array<{ node: AtlasNode; label: string; from?: string; to: string; dropRole?: string }>>();
  for (const node of nodes) {
    const content = findShogiNodeContent(node);
    const usi = content?.usi?.trim();
    if (!content || !usi) continue;
    const parsed = parseShogiCandidateUsi(usi);
    if (!parsed) continue;
    const { from, to } = parsed;
    const key = `${from ?? "drop"}-${to}`;
    const group = groups.get(key) ?? [];
    group.push({ node, label: content.displayText || node.title, from, to, dropRole: parsed.dropRole });
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) => group.map((candidate, index) => {
    const spacing = group.length > 1
      ? Math.min(PREFERRED_SHARED_DESTINATION_SPACING, MAX_SHARED_DESTINATION_SPAN / (group.length - 1))
      : 0;
    const offset = candidate.from ? (index - (group.length - 1) / 2) * spacing : 0;
    const baseTo = shogiArrowPoint(candidate.to, orientation);
    const baseFrom = candidate.from ? shogiArrowPoint(candidate.from, orientation) : undefined;
    const dx = baseTo[0] - (baseFrom?.[0] ?? baseTo[0]);
    const dy = baseTo[1] - (baseFrom?.[1] ?? baseTo[1]);
    const length = Math.hypot(dx, dy) || 1;
    const normal: [number, number] = [-dy / length * offset, dx / length * offset];
    const to: [number, number] = [baseTo[0] + normal[0], baseTo[1] + normal[1]];
    const from: [number, number] | undefined = baseFrom
      ? [baseFrom[0] + normal[0], baseFrom[1] + normal[1]]
      : undefined;
    return {
      node: candidate.node,
      label: candidate.label,
      from,
      to,
      ...(candidate.from ? { fromSquare: candidate.from } : {}),
      toSquare: candidate.to,
      isDrop: !candidate.from,
      ...(candidate.dropRole ? { dropRole: candidate.dropRole } : {}),
    };
  }));
}

export function buildShogiCandidateTargets(candidates: ShogiCandidateArrow[]): ShogiCandidateArrow[] {
  const seenDropSquares = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.isDrop) return true;
    if (seenDropSquares.has(candidate.toSquare)) return false;
    seenDropSquares.add(candidate.toSquare);
    return true;
  });
}

function parseShogiCandidateUsi(usi: string): { from?: string; to: string; dropRole?: string } | null {
  const boardMove = /^([1-9][a-i])([1-9][a-i])(?:\+)?$/.exec(usi);
  if (boardMove) return { from: boardMove[1], to: boardMove[2] };
  const drop = /^([PLNSGBR])\*([1-9][a-i])$/.exec(usi);
  if (!drop) return null;
  const dropRoles: Record<string, string> = {
    P: "pawn",
    L: "lance",
    N: "knight",
    S: "silver",
    G: "gold",
    B: "bishop",
    R: "rook",
  };
  return { to: drop[2], dropRole: dropRoles[drop[1]] };
}

function shogiArrowPoint(key: string, orientation: "sente" | "gote"): [number, number] {
  const file = Number(key[0]);
  const rank = "abcdefghi".indexOf(key[1]);
  const column = orientation === "sente" ? 9 - file : file - 1;
  const row = orientation === "sente" ? rank : 8 - rank;
  return [(column + 0.5) * 100, (row + 0.5) * 100];
}

import type { AtlasNode } from "../../types";

/**
 * The branch the user is on, as parent node id -> chosen child node id, for one
 * open record. Board navigation must not infer a branch from array order once
 * the user has been on another variation, and that includes variations that
 * only appeared when a record was merged in.
 *
 * Kept free of React so the same rules can be exercised by verify scripts.
 */
export type BoardBranchMemory = Map<string, string>;

export function boardMoveChildren(node: AtlasNode) {
  return node.children.filter((child) => child.structuredContent?.role === "move");
}

export function findBoardRecordPath(root: AtlasNode, targetId: string, path: AtlasNode[] = []): AtlasNode[] | null {
  const next = [...path, root];
  if (root.id === targetId) return next;
  for (const child of root.children) {
    const found = findBoardRecordPath(child, targetId, next);
    if (found) return found;
  }
  return null;
}

/**
 * Records every edge from the record root down to `targetId`, not just the last
 * step. Arriving at a position — by stepping, by clicking a variation, by
 * jumping to a node, or by landing on the tail of a freshly merged line — is
 * what makes that whole route the remembered branch, so stepping back to a fork
 * and forward again returns to where the user was.
 */
export function rememberBranchPath(memory: BoardBranchMemory, root: AtlasNode, targetId: string) {
  const path = findBoardRecordPath(root, targetId);
  if (!path) return false;
  for (let index = 1; index < path.length; index += 1) {
    memory.set(path[index - 1].id, path[index].id);
  }
  return true;
}

/** The node a forward step lands on: the remembered branch, else the first. */
export function preferredBranchChild(memory: BoardBranchMemory, node: AtlasNode) {
  const variations = boardMoveChildren(node);
  if (!variations.length) return null;
  const preferredId = memory.get(node.id);
  return variations.find((child) => child.id === preferredId) ?? variations[0];
}

/** Follows the remembered branch to its end, as the "jump to last" control does. */
export function branchTailAlongMemory(memory: BoardBranchMemory, node: AtlasNode) {
  let current = node;
  const visited = new Set<string>();
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const next = preferredBranchChild(memory, current);
    if (!next) break;
    memory.set(current.id, next.id);
    current = next;
  }
  return current;
}

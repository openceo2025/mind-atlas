import type { AtlasNode } from "../../types";
import { isBoardNotebookMode, type BoardNotebookMode } from "./boardRecord.ts";
import { boardMoveIdentity } from "./boardMoveIdentity.ts";

export interface BoardMoveDeduplicationResult {
  root: AtlasNode;
  removedNodeIds: string[];
  changed: boolean;
}

/**
 * Repairs duplicate move siblings without changing the order of the first
 * occurrence. The parent position scopes the identity, so an identical move
 * in a different position remains a valid, separate node.
 */
export function deduplicateBoardRecordMoves(root: AtlasNode): BoardMoveDeduplicationResult {
  const mode = isBoardNotebookMode(root.notebookMode) ? root.notebookMode : null;
  if (!mode) return { root, removedNodeIds: [], changed: false };

  const removedNodeIds: string[] = [];
  let changed = false;
  const nextRoot = visit(root, mode);
  return { root: nextRoot, removedNodeIds, changed };

  function visit(node: AtlasNode, recordMode: BoardNotebookMode): AtlasNode {
    const visitedChildren = node.children.map((child) => visit(child, recordMode));
    const children = normalizeChildren(visitedChildren, recordMode);
    const changedChildren = visitedChildren.some((child, index) => child !== node.children[index]);
    return changedChildren || children.changed ? { ...node, children: children.nodes } : node;
  }

  function normalizeChildren(children: AtlasNode[], recordMode: BoardNotebookMode) {
    const result: AtlasNode[] = [];
    const byMoveIdentity = new Map<string, AtlasNode>();
    let childrenChanged = false;

    for (const child of children) {
      const content = child.structuredContent;
      const identity = content?.kind === `${recordMode}-record` && content.role === "move"
        ? boardMoveIdentity(child)
        : null;
      if (!identity) {
        result.push(child);
        continue;
      }
      const existing = byMoveIdentity.get(identity);
      if (!existing) {
        byMoveIdentity.set(identity, child);
        result.push(child);
        continue;
      }

      const merged = mergeDuplicate(existing, child, recordMode);
      const index = result.indexOf(existing);
      if (index >= 0) result[index] = merged;
      byMoveIdentity.set(identity, merged);
      removedNodeIds.push(child.id);
      changed = true;
      childrenChanged = true;
    }

    if (!childrenChanged) return { nodes: children, changed: false };
    return { nodes: result, changed: true };
  }

  function mergeDuplicate(primary: AtlasNode, duplicate: AtlasNode, recordMode: BoardNotebookMode): AtlasNode {
    const duplicateChildren = duplicate.children.map((child) => (
      child.sourceParentId === duplicate.id ? { ...child, sourceParentId: primary.id } : child
    ));
    const mergedChildren = normalizeChildren([...primary.children, ...duplicateChildren], recordMode).nodes;
    const title = mergeText(primary.title, duplicate.title, " / ");
    const body = mergeText(primary.body, duplicate.body, "\n");
    return {
      ...primary,
      title,
      body,
      summary: body || title || primary.summary,
      children: mergedChildren,
      updatedAt: new Date().toISOString(),
    };
  }
}

function mergeText(first: string, second: string, separator: string) {
  const values = [String(first ?? "").trim(), String(second ?? "").trim()].filter(Boolean);
  const unique = values.filter((value, index) => values.indexOf(value) === index);
  return unique.join(separator);
}

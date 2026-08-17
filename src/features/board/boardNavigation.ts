import { useRef } from "react";
import type { AtlasNode } from "../../types";

type FocusNode = (id: string) => void;

/**
 * Keeps the user's chosen child for each board position while the record is
 * open. Board navigation must not infer a new branch from array order after
 * the user has deliberately chosen another variation.
 */
export function useBoardBranchNavigation(
  recordRoot: AtlasNode | null,
  currentNode: AtlasNode | null,
  focusNode: FocusNode,
) {
  const preferencesByRecordRef = useRef(new Map<string, Map<string, string>>());
  const recordPreferences = recordRoot
    ? getRecordPreferences(preferencesByRecordRef.current, recordRoot.id)
    : null;

  const rememberChild = (parentId: string, childId: string) => {
    if (!recordRoot) return;
    getRecordPreferences(preferencesByRecordRef.current, recordRoot.id).set(parentId, childId);
  };

  const selectVariation = (node: AtlasNode) => {
    if (recordRoot) {
      const path = findPath(recordRoot, node.id);
      const parent = path && path.length > 1 ? path[path.length - 2] : null;
      if (parent) rememberChild(parent.id, node.id);
    }
    focusNode(node.id);
  };

  const advance = () => {
    const parent = currentNode ?? recordRoot;
    if (!parent) return;
    const variations = moveChildren(parent);
    if (!variations.length) return;
    const preferredId = recordPreferences?.get(parent.id);
    const next = variations.find((node) => node.id === preferredId) ?? variations[0];
    rememberChild(parent.id, next.id);
    focusNode(next.id);
  };

  return { rememberChild, selectVariation, advance };
}

function getRecordPreferences(records: Map<string, Map<string, string>>, recordId: string) {
  const existing = records.get(recordId);
  if (existing) return existing;
  const created = new Map<string, string>();
  records.set(recordId, created);
  return created;
}

function moveChildren(node: AtlasNode) {
  return node.children.filter((child) => child.structuredContent?.role === "move");
}

function findPath(root: AtlasNode, targetId: string, path: AtlasNode[] = []): AtlasNode[] | null {
  const next = [...path, root];
  if (root.id === targetId) return next;
  for (const child of root.children) {
    const found = findPath(child, targetId, next);
    if (found) return found;
  }
  return null;
}

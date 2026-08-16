import type { AtlasNode } from "../types.ts";

export type AtlasRenderIndexEntry = {
  node: AtlasNode;
  parentId: string | null;
  depth: number;
  childIndex: number;
  siblingCount: number;
};

export type AtlasRenderIndex = {
  rootId: string;
  entries: Map<string, AtlasRenderIndexEntry>;
  revision: number;
};

export function updateAtlasRenderIndex(root: AtlasNode, previous?: AtlasRenderIndex | null): AtlasRenderIndex {
  if (!previous || previous.rootId !== root.id || !previous.entries.has(root.id)) {
    return {
      rootId: root.id,
      entries: buildFreshIndex(root),
      revision: (previous?.revision ?? 0) + 1,
    };
  }

  const entries = previous.entries;
  const pending: AtlasRenderIndexEntry[] = [
    { node: root, parentId: null, depth: 0, childIndex: 0, siblingCount: 1 },
  ];

  while (pending.length) {
    const current = pending.pop()!;
    const prior = entries.get(current.node.id);
    if (
      prior?.node === current.node &&
      prior.parentId === current.parentId &&
      prior.depth === current.depth &&
      prior.childIndex === current.childIndex &&
      prior.siblingCount === current.siblingCount
    ) continue;

    if (prior) {
      const nextChildIds = new Set(current.node.children.map((child) => child.id));
      for (const priorChild of prior.node.children) {
        if (!nextChildIds.has(priorChild.id)) removeIndexedSubtree(entries, priorChild);
      }
    }

    entries.set(current.node.id, current);
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: current.node.children[index],
        parentId: current.node.id,
        depth: current.depth + 1,
        childIndex: index,
        siblingCount: current.node.children.length,
      });
    }
  }

  return { rootId: root.id, entries, revision: previous.revision + 1 };
}

export function getAtlasRenderPathIds(index: AtlasRenderIndex, nodeId: string) {
  const path: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = nodeId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const entry = index.entries.get(currentId);
    if (!entry) break;
    path.push(currentId);
    currentId = entry.parentId;
  }
  return path.reverse();
}

export function getAtlasRenderNodePath(index: AtlasRenderIndex, nodeId: string) {
  return getAtlasRenderPathIds(index, nodeId)
    .map((id) => index.entries.get(id)?.node)
    .filter((node): node is AtlasNode => Boolean(node));
}

export function buildAtlasRenderProjection({
  index,
  anchorNodeId,
  priorityNodeIds,
  maxNodes,
}: {
  index: AtlasRenderIndex;
  anchorNodeId: string;
  priorityNodeIds: Iterable<string | null | undefined>;
  maxNodes: number;
}) {
  const limit = Math.max(1, Math.floor(maxNodes));
  const selected = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  const enqueue = (nodeId: string | null | undefined) => {
    if (!nodeId || queued.has(nodeId) || !index.entries.has(nodeId)) return;
    queued.add(nodeId);
    queue.push(nodeId);
  };
  const add = (nodeId: string | null | undefined) => {
    if (!nodeId || nodeId === index.rootId || selected.has(nodeId) || !index.entries.has(nodeId) || selected.size >= limit) return;
    selected.add(nodeId);
  };

  enqueue(anchorNodeId);
  const anchor = index.entries.get(anchorNodeId);
  enqueue(anchor?.parentId);
  anchor?.node.children.forEach((child) => enqueue(child.id));

  for (const nodeId of priorityNodeIds) add(nodeId);

  for (let cursor = 0; cursor < queue.length && selected.size < limit; cursor += 1) {
    const nodeId = queue[cursor];
    const entry = index.entries.get(nodeId);
    if (!entry) continue;
    add(nodeId);
    enqueue(entry.parentId);
    entry.node.children.forEach((child) => enqueue(child.id));
  }

  return selected;
}

function buildFreshIndex(root: AtlasNode) {
  const entries = new Map<string, AtlasRenderIndexEntry>();
  const pending: AtlasRenderIndexEntry[] = [
    { node: root, parentId: null, depth: 0, childIndex: 0, siblingCount: 1 },
  ];
  while (pending.length) {
    const current = pending.pop()!;
    entries.set(current.node.id, current);
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: current.node.children[index],
        parentId: current.node.id,
        depth: current.depth + 1,
        childIndex: index,
        siblingCount: current.node.children.length,
      });
    }
  }
  return entries;
}

function removeIndexedSubtree(entries: Map<string, AtlasRenderIndexEntry>, root: AtlasNode) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    const indexed = entries.get(node.id);
    if (indexed?.node !== node) continue;
    entries.delete(node.id);
    pending.push(...node.children);
  }
}

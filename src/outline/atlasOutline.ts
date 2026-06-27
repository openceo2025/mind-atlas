import type { AtlasNode } from "../types";
import { NODE_TITLE_PLACEHOLDER } from "../titleMaintenance";

export const OUTLINE_UNTITLED_TITLE = NODE_TITLE_PLACEHOLDER;

export type OutlineDraftNode = {
  key: string;
  id?: string;
  title: string;
  body: string;
  collapsed: boolean;
  children: OutlineDraftNode[];
};

export type OutlineNodeInput = {
  id?: string;
  clientKey?: string;
  title: string;
  body: string;
  children: OutlineNodeInput[];
};

export function createOutlineDraftFromAtlas(root: AtlasNode): OutlineDraftNode {
  return {
    key: root.id,
    id: root.id,
    title: normalizeOutlineTitle(root.title),
    body: root.body,
    collapsed: false,
    children: root.children.map(createOutlineDraftFromAtlas),
  };
}

export function outlineDraftToInput(node: OutlineDraftNode): OutlineNodeInput {
  return {
    id: node.id,
    clientKey: node.key,
    title: normalizeOutlineTitle(node.title),
    body: normalizeOutlineBody(node.body),
    children: node.children.map(outlineDraftToInput),
  };
}

export function createBlankOutlineDraft(parentKey: string, title = ""): OutlineDraftNode {
  return {
    key: `outline-draft-${Date.now()}-${Math.random().toString(36).slice(2)}-${parentKey}`,
    title,
    body: "",
    collapsed: false,
    children: [],
  };
}

export function cloneOutlineDraft(node: OutlineDraftNode): OutlineDraftNode {
  return {
    ...node,
    children: node.children.map(cloneOutlineDraft),
  };
}

export function findOutlineNodePath(root: OutlineDraftNode, key: string): number[] | null {
  if (root.key === key) return [];
  for (let index = 0; index < root.children.length; index += 1) {
    const childPath = findOutlineNodePath(root.children[index], key);
    if (childPath) return [index, ...childPath];
  }
  return null;
}

export function getOutlineNodeAtPath(root: OutlineDraftNode, path: number[]) {
  return path.reduce<OutlineDraftNode | undefined>((node, index) => node?.children[index], root);
}

export function updateOutlineNode(root: OutlineDraftNode, key: string, updater: (node: OutlineDraftNode) => OutlineDraftNode): OutlineDraftNode {
  if (root.key === key) return updater(root);
  return {
    ...root,
    children: root.children.map((child) => updateOutlineNode(child, key, updater)),
  };
}

export function insertOutlineSiblingAfter(root: OutlineDraftNode, key: string): { root: OutlineDraftNode; key: string } {
  const path = findOutlineNodePath(root, key);
  if (!path) return { root, key };
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = getOutlineNodeAtPath(root, parentPath);
  if (!parent) return { root, key };
  const next = createBlankOutlineDraft(parent.key);
  const updated = updateChildrenAtPath(root, parentPath, (children) => insertAt(children, index + 1, next));
  return { root: updated, key: next.key };
}

export function insertOutlineChild(root: OutlineDraftNode, key: string): { root: OutlineDraftNode; key: string } {
  const next = createBlankOutlineDraft(key);
  const updated = updateOutlineNode(root, key, (node) => ({
    ...node,
    collapsed: false,
    children: [...node.children, next],
  }));
  return { root: updated, key: next.key };
}

export function indentOutlineNode(root: OutlineDraftNode, key: string): OutlineDraftNode {
  const path = findOutlineNodePath(root, key);
  if (!path || path.length === 0) return root;
  const index = path[path.length - 1];
  if (index <= 0) return root;
  const parentPath = path.slice(0, -1);
  const parent = getOutlineNodeAtPath(root, parentPath);
  if (!parent) return root;
  const moving = parent.children[index];
  const previousSibling = parent.children[index - 1];
  let withoutMoving = updateChildrenAtPath(root, parentPath, (children) => children.filter((_, childIndex) => childIndex !== index));
  const previousSiblingPath = [...parentPath, index - 1];
  withoutMoving = updateOutlineNode(withoutMoving, previousSibling.key, (node) => ({
    ...node,
    collapsed: false,
    children: [...node.children, moving],
  }));
  return getOutlineNodeAtPath(withoutMoving, previousSiblingPath) ? withoutMoving : root;
}

export function outdentOutlineNode(root: OutlineDraftNode, key: string): OutlineDraftNode {
  const path = findOutlineNodePath(root, key);
  if (!path || path.length <= 1) return root;
  const parentPath = path.slice(0, -1);
  const grandparentPath = path.slice(0, -2);
  const index = path[path.length - 1];
  const parentIndex = parentPath[parentPath.length - 1];
  const parent = getOutlineNodeAtPath(root, parentPath);
  if (!parent) return root;
  const moving = parent.children[index];
  let updated = updateChildrenAtPath(root, parentPath, (children) => children.filter((_, childIndex) => childIndex !== index));
  updated = updateChildrenAtPath(updated, grandparentPath, (children) => insertAt(children, parentIndex + 1, moving));
  return updated;
}

export function moveOutlineSibling(root: OutlineDraftNode, key: string, direction: -1 | 1): OutlineDraftNode {
  const path = findOutlineNodePath(root, key);
  if (!path || path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = getOutlineNodeAtPath(root, parentPath);
  if (!parent) return root;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= parent.children.length) return root;
  return updateChildrenAtPath(root, parentPath, (children) => {
    const next = [...children];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });
}

export function removeOutlineNode(root: OutlineDraftNode, key: string): { root: OutlineDraftNode; nextKey: string } {
  const path = findOutlineNodePath(root, key);
  if (!path || path.length === 0) return { root, nextKey: root.key };
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = getOutlineNodeAtPath(root, parentPath);
  if (!parent) return { root, nextKey: root.key };
  const nextFocus = parent.children[index + 1]?.key ?? parent.children[index - 1]?.key ?? parent.key;
  return {
    root: updateChildrenAtPath(root, parentPath, (children) => children.filter((_, childIndex) => childIndex !== index)),
    nextKey: nextFocus,
  };
}

function updateChildrenAtPath(root: OutlineDraftNode, path: number[], updater: (children: OutlineDraftNode[]) => OutlineDraftNode[]): OutlineDraftNode {
  if (!path.length) {
    return { ...root, children: updater(root.children) };
  }
  const [head, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child, index) => (index === head ? updateChildrenAtPath(child, rest, updater) : child)),
  };
}

function insertAt<T>(items: T[], index: number, item: T) {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function normalizeOutlineTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

function normalizeOutlineBody(body: string) {
  return body.replace(/\r\n/g, "\n").trim();
}

/**
 * Whole-atlas reading for the AI Partner's tools.
 *
 * Questions like "based on this whole space, how would you sort the inbox?"
 * need the shape of the entire tree, not search snippets. Without these, a
 * model rebuilds the tree one search at a time and runs out of tool turns.
 * `buildAtlasOutline` returns the tree in one call, going as deep as a
 * character budget allows; `readAtlasNodes` returns the full text of the few
 * nodes the outline pointed at.
 */
import type { AtlasNode } from "../types";

export const OUTLINE_CHAR_BUDGET = 24_000;
export const READ_CHAR_BUDGET = 36_000;
const READ_BODY_CHARS = 4_000;
const READ_CHILD_TITLES = 60;
const SNIPPET_CHARS = 90;

export interface AtlasOutlineResult {
  outline: string;
  rootId: string;
  totalNodes: number;
  shownNodes: number;
  /** Deepest level shown below the starting node; deeper levels are counted, not listed. */
  shownDepth: number;
  maxDepth: number;
  truncated: boolean;
}

export interface AtlasOutlineOptions {
  nodeId?: string;
  maxDepth?: number;
  withSnippets?: boolean;
  charBudget?: number;
}

function oneLine(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function nodeLabel(node: AtlasNode) {
  return oneLine(node.title || node.summary || node.body || "(untitled)", 120);
}

function countDescendants(node: AtlasNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function depthOf(node: AtlasNode): number {
  return node.children.reduce((deepest, child) => Math.max(deepest, 1 + depthOf(child)), 0);
}

function outlineLines(node: AtlasNode, limit: number, withSnippets: boolean, depth = 0, lines: string[] = []) {
  const indent = "  ".repeat(depth);
  const hidden = depth === limit && node.children.length ? ` (+${countDescendants(node)} below)` : "";
  const kids = node.children.length ? ` · ${node.children.length} child${node.children.length === 1 ? "" : "ren"}` : "";
  const snippetSource = node.title ? node.summary || node.body : "";
  const snippet = withSnippets && snippetSource ? ` — ${oneLine(snippetSource, SNIPPET_CHARS)}` : "";
  lines.push(`${indent}- ${nodeLabel(node)} [${node.id}]${kids}${hidden}${snippet}`);
  if (depth < limit) node.children.forEach((child) => outlineLines(child, limit, withSnippets, depth + 1, lines));
  return lines;
}

/**
 * The tree under `nodeId` (default: the root) as an indented list of titles and
 * ids. It shows as many levels as fit the budget; nodes at the cut say how many
 * descendants they hide, so the model knows where to look next.
 */
export function buildAtlasOutline(root: AtlasNode, options: AtlasOutlineOptions = {}): AtlasOutlineResult | null {
  const start = options.nodeId ? findById(root, options.nodeId) : root;
  if (!start) return null;
  const budget = options.charBudget ?? OUTLINE_CHAR_BUDGET;
  const treeDepth = depthOf(start);
  const cap = Math.min(treeDepth, Math.max(0, Math.trunc(options.maxDepth ?? treeDepth)));
  const totalNodes = 1 + countDescendants(start);

  let chosen: string[] = outlineLines(start, 0, Boolean(options.withSnippets));
  let shownDepth = 0;
  for (let limit = 1; limit <= cap; limit += 1) {
    const lines = outlineLines(start, limit, Boolean(options.withSnippets));
    if (lines.join("\n").length > budget) break;
    chosen = lines;
    shownDepth = limit;
  }
  // Even one level may not fit (a node with thousands of children): list what fits.
  if (shownDepth === 0 && cap > 0) {
    const lines = outlineLines(start, 1, Boolean(options.withSnippets));
    const fitted: string[] = [];
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > budget) break;
      fitted.push(line);
      used += line.length + 1;
    }
    if (fitted.length < lines.length) fitted.push(`  … ${lines.length - fitted.length} more children not listed`);
    chosen = fitted;
    shownDepth = 1;
  }
  const shownNodes = chosen.filter((line) => /^\s*- /.test(line)).length;
  return {
    outline: chosen.join("\n"),
    rootId: start.id,
    totalNodes,
    shownNodes,
    shownDepth,
    maxDepth: treeDepth,
    truncated: shownNodes < totalNodes,
  };
}

export interface AtlasNodeReading {
  id: string;
  title: string;
  path: string[];
  status: string;
  tags: string[];
  summary?: string;
  body: string;
  bodyChars: number;
  bodyComplete: boolean;
  children: Array<{ id: string; title: string; childCount: number }>;
  moreChildren: number;
}

/** Full text of specific nodes, with their path and direct children, within a budget. */
export function readAtlasNodes(root: AtlasNode, ids: string[], charBudget = READ_CHAR_BUDGET) {
  const nodes: AtlasNodeReading[] = [];
  const missing: string[] = [];
  let remaining = charBudget;
  for (const id of [...new Set(ids)].slice(0, 20)) {
    const path = findPath(root, id);
    if (!path) {
      missing.push(id);
      continue;
    }
    const node = path[path.length - 1];
    const bodyLimit = Math.max(200, Math.min(READ_BODY_CHARS, remaining));
    const body = node.body.length > bodyLimit ? `${node.body.slice(0, bodyLimit)}…` : node.body;
    const children = node.children.slice(0, READ_CHILD_TITLES).map((child) => ({ id: child.id, title: nodeLabel(child), childCount: child.children.length }));
    nodes.push({
      id: node.id,
      title: nodeLabel(node),
      path: path.slice(0, -1).map(nodeLabel),
      status: node.status,
      tags: node.tags,
      ...(node.summary && node.summary !== node.body ? { summary: oneLine(node.summary, 400) } : {}),
      body,
      bodyChars: node.body.length,
      bodyComplete: body.length === node.body.length,
      children,
      moreChildren: Math.max(0, node.children.length - children.length),
    });
    remaining -= body.length + children.reduce((sum, child) => sum + child.title.length + 40, 0) + 200;
    if (remaining <= 0) break;
  }
  return { nodes, missing };
}

function findById(node: AtlasNode, id: string): AtlasNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

function findPath(node: AtlasNode, id: string, trail: AtlasNode[] = []): AtlasNode[] | null {
  const next = [...trail, node];
  if (node.id === id) return next;
  for (const child of node.children) {
    const hit = findPath(child, id, next);
    if (hit) return hit;
  }
  return null;
}

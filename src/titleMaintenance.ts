import type { AtlasNode } from "./types";

const AUTO_TITLE_EXCERPT_MAX_GRAPHEMES = 24;
const MISSING_TITLE_PREFIX = "untitle";

export interface MissingTitleHydrationResult {
  root: AtlasNode;
  changedNodeIds: string[];
}

export function hydrateMissingNodeTitlesFromBodies(root: AtlasNode, updatedAt = new Date().toISOString()): MissingTitleHydrationResult {
  const changedNodeIds: string[] = [];
  const nextRoot = hydrateNode(root);
  return { root: nextRoot, changedNodeIds };

  function hydrateNode(node: AtlasNode): AtlasNode {
    const children = node.children.map(hydrateNode);
    const title = createTitleExcerptFromBody(node.body);
    const shouldHydrateTitle = isMissingNodeTitle(node.title) && title;
    if (!shouldHydrateTitle && children.every((child, index) => child === node.children[index])) {
      return node;
    }
    if (shouldHydrateTitle) changedNodeIds.push(node.id);
    return {
      ...node,
      title: shouldHydrateTitle ? title : node.title,
      subtitle: shouldHydrateTitle && isMissingNodeTitle(node.subtitle) ? title : node.subtitle,
      updatedAt: shouldHydrateTitle ? updatedAt : node.updatedAt,
      children,
    };
  }
}

export function createTitleExcerptFromBody(body: string, maxGraphemes = AUTO_TITLE_EXCERPT_MAX_GRAPHEMES) {
  const firstLine = body
    .split("\n")
    .map((line) => cleanTitleExcerptSource(line))
    .find(Boolean);
  if (!firstLine) return "";
  const graphemes = Array.from(firstLine);
  if (graphemes.length <= maxGraphemes) return firstLine;
  return `${graphemes.slice(0, maxGraphemes).join("").trimEnd()}...`;
}

export function isMissingNodeTitle(title: string | undefined) {
  const normalized = (title ?? "").trim().toLowerCase();
  return normalized === "" || normalized.startsWith(MISSING_TITLE_PREFIX);
}

function cleanTitleExcerptSource(line: string) {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

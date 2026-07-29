import type { AtlasNode } from "../types";

export type NodeSearchField = "title" | "body" | "summary" | "tags" | "metadata";

export interface NodeSearchMatch {
  nodeId: string;
  title: string;
  path: string[];
  field: NodeSearchField;
  snippet: string;
  score: number;
}

export interface NodeSearchResult {
  matches: NodeSearchMatch[];
  total: number;
  error?: string;
}

export interface ExactNodeSearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  includeMetadata?: boolean;
  limit?: number;
}

export interface RelevantNodeSearchOptions {
  query: string;
  concepts?: string[];
  limit?: number;
}

const MAX_QUERY_LENGTH = 180;
const MAX_SEARCH_TEXT_LENGTH = 100_000;
const DEFAULT_EXACT_LIMIT = 100;
const DEFAULT_RELEVANT_LIMIT = 10;

export function searchAtlasNodes(root: AtlasNode, options: ExactNodeSearchOptions): NodeSearchResult {
  const query = options.query.trim();
  if (!query) return { matches: [], total: 0 };
  if (query.length > MAX_QUERY_LENGTH) {
    return { matches: [], total: 0, error: `Search text must be ${MAX_QUERY_LENGTH} characters or fewer.` };
  }

  const compiled = compileSearchPattern(query, Boolean(options.regex), Boolean(options.caseSensitive));
  if ("error" in compiled) return { matches: [], total: 0, error: compiled.error };

  const matches: NodeSearchMatch[] = [];
  visitAtlas(root, [], (node, path) => {
    const fields = searchableFields(node, Boolean(options.includeMetadata));
    let best: NodeSearchMatch | null = null;
    for (const field of fields) {
      const text = field.text.slice(0, MAX_SEARCH_TEXT_LENGTH);
      const match = compiled.pattern.exec(text);
      compiled.pattern.lastIndex = 0;
      if (!match) continue;
      const score = exactMatchScore(field.field, match.index, match[0].length, text.length);
      const candidate: NodeSearchMatch = {
        nodeId: node.id,
        title: node.title,
        path: [...path, node.title],
        field: field.field,
        snippet: createSnippet(text, match.index, Math.max(1, match[0].length)),
        score,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) matches.push(best);
  });

  matches.sort((left, right) =>
    right.score - left.score ||
    left.path.length - right.path.length ||
    left.title.localeCompare(right.title),
  );
  const limit = clampLimit(options.limit, DEFAULT_EXACT_LIMIT, 1, 200);
  return { matches: matches.slice(0, limit), total: matches.length };
}

export function rankAtlasNodes(root: AtlasNode, options: RelevantNodeSearchOptions): NodeSearchResult {
  const rawTerms = [options.query, ...(options.concepts ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!rawTerms.length) return { matches: [], total: 0 };
  if (rawTerms.some((term) => term.length > MAX_QUERY_LENGTH)) {
    return { matches: [], total: 0, error: `Each search concept must be ${MAX_QUERY_LENGTH} characters or fewer.` };
  }

  const normalizedTerms = [...new Set(rawTerms.map(normalizeSearchText).filter(Boolean))];
  const queryFeatures = buildFeatures(normalizedTerms.join(" "));
  const matches: NodeSearchMatch[] = [];

  visitAtlas(root, [], (node, path) => {
    const fields = searchableFields(node, true);
    let bestField: NodeSearchField = "title";
    let bestText = node.title;
    let bestScore = 0;

    for (const field of fields) {
      const text = field.text.slice(0, MAX_SEARCH_TEXT_LENGTH);
      const score = relevanceScore(text, field.field, normalizedTerms, queryFeatures);
      if (score > bestScore) {
        bestScore = score;
        bestField = field.field;
        bestText = text;
      }
    }

    const pathText = path.join(" ");
    const pathScore = relevanceScore(pathText, "metadata", normalizedTerms, queryFeatures) * 0.55;
    bestScore += pathScore;
    if (bestScore <= 0) return;

    const normalizedBestText = normalizeSearchText(bestText);
    const firstTerm = normalizedTerms.find((term) => normalizedBestText.includes(term));
    const snippetIndex = firstTerm ? normalizedBestText.indexOf(firstTerm) : 0;
    matches.push({
      nodeId: node.id,
      title: node.title,
      path: [...path, node.title],
      field: bestField,
      snippet: createSnippet(bestText, snippetIndex, firstTerm?.length ?? 1),
      score: Math.round(bestScore * 100) / 100,
    });
  });

  matches.sort((left, right) =>
    right.score - left.score ||
    left.path.length - right.path.length ||
    left.title.localeCompare(right.title),
  );
  const limit = clampLimit(options.limit, DEFAULT_RELEVANT_LIMIT, 1, 30);
  return { matches: matches.slice(0, limit), total: matches.length };
}

function compileSearchPattern(query: string, regex: boolean, caseSensitive: boolean): { pattern: RegExp } | { error: string } {
  const source = regex ? query : escapeRegExp(query);
  if (regex) {
    const unsafeReason = unsafeRegexReason(source);
    if (unsafeReason) return { error: unsafeReason };
  }
  try {
    return { pattern: new RegExp(source, caseSensitive ? "u" : "iu") };
  } catch (error) {
    return { error: error instanceof Error ? `Invalid regular expression: ${error.message}` : "Invalid regular expression." };
  }
}

function unsafeRegexReason(source: string) {
  if (source.length > MAX_QUERY_LENGTH) return `Regular expressions must be ${MAX_QUERY_LENGTH} characters or fewer.`;
  if (/\\[1-9]/.test(source)) return "Backreferences are not supported in notebook search.";
  if (/\((?:[^()]|\\.)*[+*](?:[^()]|\\.)*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/.test(source)) {
    return "This regular expression contains a nested repetition that may be too expensive.";
  }
  if (/(?:[+*]|\{\d+(?:,\d*)?\})\s*(?:[+*]|\{\d+(?:,\d*)?\})/.test(source)) {
    return "This regular expression contains repeated quantifiers that may be too expensive.";
  }
  return "";
}

function searchableFields(node: AtlasNode, includeMetadata: boolean): Array<{ field: NodeSearchField; text: string }> {
  const fields: Array<{ field: NodeSearchField; text: string }> = [
    { field: "title", text: node.title },
    { field: "body", text: node.body },
  ];
  if (!includeMetadata) return fields;
  fields.push(
    { field: "summary", text: [node.subtitle, node.summary, node.nextDecision].filter(Boolean).join("\n") },
    { field: "tags", text: node.tags.join(" ") },
    {
      field: "metadata",
      text: [node.id, node.status, node.provider ?? "", node.runMode ?? "", node.nodeType, node.author].join(" "),
    },
  );
  return fields;
}

function relevanceScore(
  text: string,
  field: NodeSearchField,
  normalizedTerms: string[],
  queryFeatures: Set<string>,
) {
  const normalized = normalizeSearchText(text);
  if (!normalized) return 0;
  const fieldWeight = field === "title" ? 2.4 : field === "summary" ? 1.65 : field === "tags" ? 1.8 : field === "body" ? 1 : 0.7;
  let score = 0;

  for (const term of normalizedTerms) {
    if (!term) continue;
    if (normalized === term) score += 18;
    else if (normalized.includes(term)) score += 10 + Math.min(5, term.length / 4);
  }

  const fieldFeatures = buildFeatures(normalized);
  let overlap = 0;
  for (const feature of queryFeatures) {
    if (fieldFeatures.has(feature)) overlap += feature.length > 2 ? 1.4 : 0.7;
  }
  score += Math.min(18, overlap);
  return score * fieldWeight;
}

function buildFeatures(value: string) {
  const normalized = normalizeSearchText(value);
  const features = new Set<string>();
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    features.add(token);
    if (token.length >= 4) {
      for (let index = 0; index <= token.length - 3; index += 1) features.add(token.slice(index, index + 3));
    }
  }
  const compact = normalized.replace(/\s+/g, "");
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(compact)) {
    for (let index = 0; index < compact.length - 1; index += 1) features.add(compact.slice(index, index + 2));
  }
  return features;
}

function exactMatchScore(field: NodeSearchField, index: number, matchLength: number, textLength: number) {
  const fieldWeight = field === "title" ? 100 : field === "body" ? 70 : field === "summary" ? 60 : field === "tags" ? 55 : 40;
  const startBonus = index === 0 ? 18 : Math.max(0, 10 - index / 20);
  const densityBonus = Math.min(12, (matchLength / Math.max(1, textLength)) * 30);
  return fieldWeight + startBonus + densityBonus;
}

function createSnippet(text: string, index: number, matchLength: number) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const safeIndex = Math.max(0, Math.min(index, collapsed.length));
  const start = Math.max(0, safeIndex - 58);
  const end = Math.min(collapsed.length, safeIndex + Math.max(matchLength, 1) + 92);
  return `${start > 0 ? "..." : ""}${collapsed.slice(start, end)}${end < collapsed.length ? "..." : ""}`;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visitAtlas(node: AtlasNode, path: string[], visitor: (node: AtlasNode, path: string[]) => void) {
  visitor(node, path);
  for (const child of node.children) visitAtlas(child, [...path, node.title], visitor);
}

function clampLimit(value: number | undefined, fallback: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

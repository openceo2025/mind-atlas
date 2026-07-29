// Read-only Atlas retrieval tools shared by every provider transport.
//
// Mode: local-only.
//
// Purpose (plan section 14): let the agent fetch exact notebook content on
// demand instead of paying the context cost of the whole notebook on every
// turn. This first release is strictly read-only; write tools need a separate
// permission and audit design.
//
// The matcher is the same pure implementation that powers the human Ctrl+F
// search (`src/search/nodeSearch.ts`), imported directly so the two can never
// drift apart.

import { rankAtlasNodes, searchAtlasNodes } from "../../src/search/nodeSearch.ts";

const MAX_BODY_CHARS = 12_000;
const MAX_OUTLINE_NODES = 400;

export const ATLAS_TOOL_DEFINITIONS = [
  {
    name: "search_nodes",
    description:
      "Exact text search across Mind Atlas node titles and bodies. Supports optional safe regular expressions. Returns node ids, titles, breadcrumbs and snippets - never the whole notebook.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regular expression to find." },
        regex: { type: "boolean", description: "Treat query as a regular expression." },
        caseSensitive: { type: "boolean" },
        includeMetadata: { type: "boolean", description: "Also search tags, summary and status fields." },
        limit: { type: "number", description: "Maximum hits (1-200, default 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "semantic_search_nodes",
    description:
      "Relevance ranked search over Mind Atlas nodes using lexical scoring plus character n-gram overlap, which works for Japanese and Chinese text. This is NOT vector embedding search; scoringMode in the response states exactly what ran.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        concepts: { type: "array", items: { type: "string" }, description: "Additional related terms to widen the ranking." },
        limit: { type: "number", description: "Maximum hits (1-30, default 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_node",
    description: "Read one Mind Atlas node: title, body, tags, status, breadcrumb and child ids. Attachment content is never included.",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
  {
    name: "get_branch",
    description: "Read the ancestor chain from the notebook root to a node, with each ancestor's title and a bounded body excerpt.",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" }, includeBodies: { type: "boolean" } },
      required: ["nodeId"],
    },
  },
  {
    name: "get_children",
    description: "List the direct children of a node with titles, status and short body previews.",
    inputSchema: {
      type: "object",
      properties: { nodeId: { type: "string" }, limit: { type: "number" } },
      required: ["nodeId"],
    },
  },
  {
    name: "get_atlas_outline",
    description: "Title-only outline skeleton of the notebook, optionally scoped to a subtree and depth. Use this to orient before fetching node bodies.",
    inputSchema: {
      type: "object",
      properties: {
        rootNodeId: { type: "string", description: "Defaults to the notebook root." },
        maxDepth: { type: "number", description: "Default 4." },
        limit: { type: "number", description: "Maximum nodes (default 200, cap 400)." },
      },
    },
  },
];

export class AtlasToolService {
  constructor(snapshot = null) {
    this.setSnapshot(snapshot);
  }

  /**
   * A run-scoped, already sanitized notebook snapshot. Only the fields the
   * tools return are kept, so bridge internals can never leak through a tool
   * result.
   */
  setSnapshot(snapshot) {
    this.root = sanitizeNode(snapshot?.root ?? snapshot ?? null);
    this.notebookTitle = String(snapshot?.title ?? "");
    this.updatedAt = new Date().toISOString();
    this.index = new Map();
    if (this.root) indexNode(this.root, [], this.index);
  }

  get available() {
    return Boolean(this.root);
  }

  listTools() {
    return ATLAS_TOOL_DEFINITIONS;
  }

  async call(name, args = {}) {
    if (!this.root) {
      return { isError: true, content: "No Mind Atlas notebook snapshot is attached to this run." };
    }
    switch (name) {
      case "search_nodes":
        return this.searchNodes(args);
      case "semantic_search_nodes":
        return this.semanticSearchNodes(args);
      case "get_node":
        return this.getNode(args);
      case "get_branch":
        return this.getBranch(args);
      case "get_children":
        return this.getChildren(args);
      case "get_atlas_outline":
        return this.getOutline(args);
      default:
        return { isError: true, content: `Unknown Mind Atlas tool: ${name}` };
    }
  }

  searchNodes(args) {
    const result = searchAtlasNodes(this.root, {
      query: String(args.query ?? ""),
      regex: Boolean(args.regex),
      caseSensitive: Boolean(args.caseSensitive),
      includeMetadata: Boolean(args.includeMetadata),
      limit: clamp(args.limit, 1, 200, 20),
    });
    if (result.error) return { isError: true, content: result.error };
    return {
      content: {
        total: result.total,
        returned: result.matches.length,
        hits: result.matches.map((match) => toHit(match)),
      },
    };
  }

  semanticSearchNodes(args) {
    const result = rankAtlasNodes(this.root, {
      query: String(args.query ?? ""),
      concepts: Array.isArray(args.concepts) ? args.concepts.map(String).slice(0, 12) : [],
      limit: clamp(args.limit, 1, 30, 10),
    });
    if (result.error) return { isError: true, content: result.error };
    return {
      content: {
        // Honest labelling: this is hybrid lexical + n-gram scoring, not vector
        // similarity. No embedding backend is configured.
        scoringMode: "lexical+ngram",
        embeddingBackend: null,
        degraded: true,
        degradedReason: "No embedding backend is configured, so vector similarity is unavailable.",
        total: result.total,
        returned: result.matches.length,
        hits: result.matches.map((match) => toHit(match)),
      },
    };
  }

  getNode(args) {
    const entry = this.index.get(String(args.nodeId ?? ""));
    if (!entry) return { isError: true, content: "No node with that id exists in this snapshot." };
    const node = entry.node;
    return {
      content: {
        nodeId: node.id,
        title: node.title,
        body: truncate(node.body, MAX_BODY_CHARS),
        bodyTruncated: node.body.length > MAX_BODY_CHARS,
        tags: node.tags,
        status: node.status,
        nodeType: node.nodeType,
        provider: node.provider,
        breadcrumb: entry.path,
        childIds: node.children.map((child) => child.id),
        attachmentCount: node.attachmentCount,
        attachmentsIncluded: false,
      },
    };
  }

  getBranch(args) {
    const entry = this.index.get(String(args.nodeId ?? ""));
    if (!entry) return { isError: true, content: "No node with that id exists in this snapshot." };
    const includeBodies = args.includeBodies !== false;
    return {
      content: {
        nodeId: entry.node.id,
        chain: entry.chain.map((node) => ({
          nodeId: node.id,
          title: node.title,
          status: node.status,
          ...(includeBodies ? { body: truncate(node.body, 2000) } : {}),
        })),
      },
    };
  }

  getChildren(args) {
    const entry = this.index.get(String(args.nodeId ?? ""));
    if (!entry) return { isError: true, content: "No node with that id exists in this snapshot." };
    const limit = clamp(args.limit, 1, 200, 50);
    return {
      content: {
        nodeId: entry.node.id,
        total: entry.node.children.length,
        children: entry.node.children.slice(0, limit).map((child) => ({
          nodeId: child.id,
          title: child.title,
          status: child.status,
          preview: truncate(child.body.replace(/\s+/g, " ").trim(), 240),
          childCount: child.children.length,
        })),
      },
    };
  }

  getOutline(args) {
    const rootId = String(args.rootNodeId ?? "");
    const start = rootId ? this.index.get(rootId)?.node : this.root;
    if (!start) return { isError: true, content: "No node with that id exists in this snapshot." };
    const maxDepth = clamp(args.maxDepth, 1, 12, 4);
    const limit = clamp(args.limit, 1, MAX_OUTLINE_NODES, 200);
    const lines = [];
    const walk = (node, depth) => {
      if (lines.length >= limit || depth > maxDepth) return;
      lines.push({ nodeId: node.id, title: node.title, depth, status: node.status, childCount: node.children.length });
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(start, 0);
    return {
      content: {
        notebookTitle: this.notebookTitle,
        rootNodeId: start.id,
        maxDepth,
        truncated: lines.length >= limit,
        outline: lines,
      },
    };
  }
}

function toHit(match) {
  return {
    nodeId: match.nodeId,
    title: match.title,
    snippet: match.snippet,
    breadcrumb: match.path,
    score: match.score,
    matchedField: match.field,
  };
}

function sanitizeNode(node) {
  if (!node || typeof node !== "object" || typeof node.id !== "string") return null;
  return {
    id: node.id,
    title: String(node.title ?? ""),
    body: String(node.body ?? ""),
    subtitle: String(node.subtitle ?? ""),
    summary: String(node.summary ?? ""),
    nextDecision: String(node.nextDecision ?? ""),
    tags: Array.isArray(node.tags) ? node.tags.map(String) : [],
    status: String(node.status ?? ""),
    nodeType: String(node.nodeType ?? ""),
    provider: String(node.provider ?? ""),
    runMode: String(node.runMode ?? ""),
    author: String(node.author ?? ""),
    attachmentCount: Array.isArray(node.attachments) ? node.attachments.length : 0,
    children: Array.isArray(node.children) ? node.children.map(sanitizeNode).filter(Boolean) : [],
  };
}

function indexNode(node, chain, index) {
  const path = chain.map((entry) => entry.title);
  index.set(node.id, { node, path, chain: [...chain, node] });
  for (const child of node.children) indexNode(child, [...chain, node], index);
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function createAtlasToolService(snapshot) {
  return new AtlasToolService(snapshot);
}

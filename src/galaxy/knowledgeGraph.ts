/** Shared-core, derived index. Notebook trees remain untouched; every relation
 * carries its source fingerprints so edits/deletions retract obsolete claims. */
import type { AtlasNode } from '../types.ts';
import type { SpaceView } from './galaxySummary.ts';

export const RELATION_TYPES = ['is-a', 'part-of', 'depends-on', 'supports', 'contradicts', 'causes', 'enables', 'prevents', 'before', 'after', 'created-by', 'derived-from', 'related', 'none'] as const;
export type RelationType = typeof RELATION_TYPES[number];
export interface KnowledgeNode { key: string; spaceId: string; node: AtlasNode; parentKey: string | null; depth: number; fingerprint: string }
export interface KnowledgeRelation {
  id: string; from: string; to: string; type: RelationType;
  source: 'tree' | 'dependency' | 'candidate' | 'ai' | 'inference'; confidence: number;
  evidence: string; fingerprints: [string, string]; model?: string; backend?: string; judgedAt?: string;
  basis?: 'tree' | 'candidate';
  supportIds?: string[];
}
export interface KnowledgeGraph { nodes: KnowledgeNode[]; relations: KnowledgeRelation[]; omitted: number }
export function nodeKey(spaceId: string, id: string) { return JSON.stringify([spaceId, id]); }
export function remapKnowledgeRelations(records: unknown, remap: (id: string) => string): KnowledgeRelation[] {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 6000).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const r = value as KnowledgeRelation;
    if (r.source !== 'ai' || !RELATION_TYPES.includes(r.type) || !Array.isArray(r.fingerprints) || r.fingerprints.length !== 2 || !r.fingerprints.every(v => typeof v === 'string')) return [];
    try {
      const from = JSON.parse(r.from), to = JSON.parse(r.to);
      if (![from, to].every(v => Array.isArray(v) && v.length === 2 && v.every((x: unknown) => typeof x === 'string'))) return [];
      const a = nodeKey(remap(from[0]), from[1]), b = nodeKey(remap(to[0]), to[1]);
      return [{ id: JSON.stringify([a, b, r.basis === 'tree' ? 'semantic' : 'candidate']), from: a, to: b, type: r.type, source: 'ai' as const, basis: r.basis === 'tree' ? 'tree' as const : 'candidate' as const, confidence: Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0, evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 2000) : '', fingerprints: r.fingerprints, model: typeof r.model === 'string' ? r.model.slice(0, 100) : undefined, backend: typeof r.backend === 'string' ? r.backend.slice(0, 40) : undefined, judgedAt: typeof r.judgedAt === 'string' ? r.judgedAt.slice(0, 40) : undefined }];
    } catch { return []; }
  });
}
export function fingerprint(node: AtlasNode) {
  const text = JSON.stringify([node.title, node.body, node.summary, node.tags]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
function terms(node: AtlasNode) {
  const text = `${node.title} ${node.summary} ${node.tags.join(' ')} ${node.body.slice(0, 1200)}`.toLowerCase();
  const tokens = text.match(/[a-z0-9][a-z0-9_-]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? [];
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'node', 'notebook', 'root']);
  const result = new Set(tokens.filter(t => !stop.has(t)));
  for (const token of tokens) if (/[^\x00-\x7f]/.test(token)) {
    for (let i = 0; i < token.length - 1; i++) result.add(token.slice(i, i + 2));
  }
  return result;
}
export function buildKnowledgeGraph(views: SpaceView[], judgments: KnowledgeRelation[] = []): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [], relations: KnowledgeRelation[] = [];
  let omitted = 0;
  // Round-robin limits leave room for every space, including a large active
  // notebook; cloud files carry their own, smaller budget.
  const budgeted = views.filter(view => view.nodeBudget === undefined).length;
  // Board-game records are move trees: their words would tie every game to every other.
  const boardSpaces = new Set(views.filter(view => view.root?.notebookMode && view.root.notebookMode !== 'standard').map(view => view.space.id));
  for (const view of views) {
    if (!view.root) continue;
    const queue: { node: AtlasNode; parentKey: string | null; depth: number }[] = [{ node: view.root, parentKey: null, depth: 0 }];
    const seen = new Set<string>();
    const limit = view.nodeBudget ?? Math.max(40, Math.floor(1800 / Math.max(1, budgeted)));
    let count = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const entry = queue[cursor];
      if (seen.has(entry.node.id)) continue;
      seen.add(entry.node.id);
      const key = nodeKey(view.space.id, entry.node.id);
      if (count++ < limit) nodes.push({ ...entry, key, spaceId: view.space.id, fingerprint: fingerprint(entry.node) });
      else omitted++;
      for (const child of entry.node.children) queue.push({ node: child, parentKey: key, depth: entry.depth + 1 });
    }
  }
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const add = (from: KnowledgeNode, to: KnowledgeNode, type: RelationType, source: KnowledgeRelation['source'], evidence: string, confidence = 1) => {
    relations.push({ id: JSON.stringify([from.key, to.key, source]), from: from.key, to: to.key, type, source, confidence, evidence, fingerprints: [from.fingerprint, to.fingerprint] });
  };
  for (const n of nodes) {
    const parent = n.parentKey && byKey.get(n.parentKey);
    if (parent) add(n, parent, 'part-of', 'tree', 'Notebook parent/child structure');
  }
  for (const view of views) for (const target of view.space.dependsOn) {
    const from = nodes.find(n => n.spaceId === view.space.id && n.depth === 0);
    const to = nodes.find(n => n.spaceId === target && n.depth === 0);
    if (from && to) add(from, to, 'depends-on', 'dependency', 'Saved space dependency');
  }
  // Inverted index, bounded postings. Similar words propose candidates; they do
  // not establish causality, support, or a semantic model's confidence.
  const postings = new Map<string, KnowledgeNode[]>();
  const judged = new Map(judgments.filter(r => {
    const a = byKey.get(r.from), b = byKey.get(r.to);
    return a && b && a.fingerprint === r.fingerprints[0] && b.fingerprint === r.fingerprints[1];
  }).map(r => [r.id, r]));
  for (const r of judged.values()) if (r.basis === 'tree' && r.type !== 'none') relations.push(r);
  for (const node of nodes) {
    if (boardSpaces.has(node.spaceId)) continue;
    const overlaps = new Map<string, { node: KnowledgeNode; terms: string[] }>();
    for (const term of terms(node.node)) {
      const list = postings.get(term) ?? [];
      for (const other of list) {
        if (other.key === node.parentKey || other.parentKey === node.key) continue;
        const hit = overlaps.get(other.key) ?? { node: other, terms: [] };
        hit.terms.push(term); overlaps.set(other.key, hit);
      }
      if (list.length < 24) { list.push(node); postings.set(term, list); }
    }
    const best = [...overlaps.values()].filter(hit => hit.terms.length >= 2)
      .sort((a, b) => b.terms.length - a.terms.length || a.node.key.localeCompare(b.node.key)).slice(0, 3);
    for (const hit of best) {
      const id = JSON.stringify([node.key, hit.node.key, 'candidate']);
      const judgment = judged.get(id);
      if (judgment) { if (judgment.type !== 'none') relations.push(judgment); }
      else add(node, hit.node, 'related', 'candidate', hit.terms.slice(0, 8).join(', '), 0);
    }
  }
  // A bounded worklist derives only transitive dependencies. Support and
  // causality are deliberately not treated as universally transitive rules.
  const dependencies = relations.filter(r => r.type === 'depends-on' && r.source !== 'candidate' && r.confidence >= .6);
  const adjacency = new Map<string, KnowledgeRelation[]>();
  for (const r of dependencies) { const list = adjacency.get(r.from) ?? []; list.push(r); adjacency.set(r.from, list); }
  let inferred = 0;
  for (const origin of nodes) {
    if (inferred >= 300) break;
    const visited = new Set([origin.key]);
    const queue = [{ key: origin.key, supportIds: [] as string[], confidence: 1 }];
    for (let cursor = 0; cursor < queue.length && inferred < 300; cursor++) {
      const step = queue[cursor]; if (step.supportIds.length >= 3) continue;
      for (const r of adjacency.get(step.key) ?? []) {
        if (visited.has(r.to)) continue;
        visited.add(r.to);
        const supportIds = [...step.supportIds, r.id], confidence = Math.min(step.confidence, r.confidence);
        queue.push({ key: r.to, supportIds, confidence });
        if (supportIds.length < 2) continue;
        const target = byKey.get(r.to)!;
        relations.push({ id: JSON.stringify([origin.key, target.key, 'inferred-dependency']), from: origin.key, to: target.key, type: 'depends-on', source: 'inference', confidence, supportIds, evidence: supportIds.map(id => { const edge = relations.find(e => e.id === id)!; return `${byKey.get(edge.from)?.node.title} → ${byKey.get(edge.to)?.node.title}`; }).join(' / '), fingerprints: [origin.fingerprint, target.fingerprint] });
        inferred++;
      }
    }
  }
  return { nodes, relations, omitted };
}

/** Cycle-safe BFS. A tree is a temporary, query-specific projection, never a rewrite. */
export function projectKnowledge(graph: KnowledgeGraph, query: string, mode: 'all' | 'dependencies' | 'evidence' | 'risk') {
  const text = query.trim().toLowerCase();
  const intent = mode !== 'all' ? mode : /原因|なぜ|依存|必要|cause|why|depend|requires/.test(text) ? 'dependencies'
    : /根拠|派生|由来|生まれ|矛盾|evidence|origin|contradict/.test(text) ? 'evidence'
    : /リスク|停滞|遅れ|危険|risk|block|delay/.test(text) ? 'risk' : 'all';
  const seeds = new Set(graph.nodes.filter(n => {
    const content = `${n.node.title} ${n.node.body} ${n.node.summary} ${n.node.tags.join(' ')}`.toLowerCase();
    if (text && (content.includes(text) || (n.node.title.length >= 2 && text.includes(n.node.title.toLowerCase())) || n.node.tags.some(tag => tag.length >= 2 && text.includes(tag.toLowerCase())))) return true;
    return !text && intent === 'risk' && ['blocked', 'waiting', 'needs_review', 'error'].includes(n.node.status);
  }).map(n => n.key));
  if (!seeds.size && text && intent !== 'all') {
    for (const n of graph.nodes) if (intent === 'risk' || intent === 'dependencies'
      ? ['blocked', 'waiting', 'needs_review', 'error'].includes(n.node.status)
      : n.depth === 0) seeds.add(n.key);
  }
  const filtered = graph.relations.filter(r => intent === 'dependencies' ? ['depends-on', 'causes', 'enables', 'prevents', 'part-of'].includes(r.type)
    : intent === 'evidence' ? ['supports', 'contradicts', 'derived-from', 'created-by', 'before', 'after', 'part-of'].includes(r.type) : true);
  const active = Boolean(text || mode !== 'all');
  if (!active) return { active, seeds, nodes: new Set(graph.nodes.map(n => n.key)), edges: new Set(graph.relations.map(r => r.id)), tree: [] as KnowledgeRelation[] };
  if (!text && intent !== 'risk') for (const r of filtered) if (r.type !== 'part-of') { seeds.add(r.from); seeds.add(r.to); }
  const reached = new Set(seeds), tree: KnowledgeRelation[] = [], edges = new Set<string>();
  const queue = [...seeds].map(key => ({ key, depth: 0 }));
  const adjacency = new Map<string, KnowledgeRelation[]>();
  for (const r of filtered) for (const key of [r.from, r.to]) { const list = adjacency.get(key) ?? []; list.push(r); adjacency.set(key, list); }
  for (let i = 0; i < queue.length; i++) {
    const { key, depth } = queue[i];
    if (depth >= 3) continue;
    for (const r of adjacency.get(key) ?? []) {
      edges.add(r.id);
      const other = r.from === key ? r.to : r.from;
      if (!reached.has(other)) { reached.add(other); tree.push(r); queue.push({ key: other, depth: depth + 1 }); }
    }
  }
  return { active, seeds, nodes: reached, edges, tree };
}

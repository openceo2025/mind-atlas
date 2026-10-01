import type { KnowledgeGraph, KnowledgeRelation } from './knowledgeGraph.ts';

export interface KnowledgeMetrics { count: number; done: number; blocked: number; review: number; running: number }
/** Actual notebook statuses, rolled up through the canonical parent links. */
export function knowledgeMetrics(graph: KnowledgeGraph) {
  const metrics = new Map(graph.nodes.map(n => [n.key, { count: 1, done: Number(n.node.status === 'done'), blocked: Number(['blocked', 'error'].includes(n.node.status)), review: Number(n.node.status === 'needs_review'), running: Number(n.node.status === 'running') }]));
  for (const n of [...graph.nodes].sort((a,b) => b.depth-a.depth)) {
    const own=metrics.get(n.key)!, parent=n.parentKey && metrics.get(n.parentKey);
    if (parent) for (const k of ['count','done','blocked','review','running'] as const) parent[k]+=own[k];
  }
  return metrics;
}

/**
 * What the rings around a hub (a space or one of its top-level branches) say.
 * Everything is measured from the hub's descendants, never typed by hand:
 *
 * - progress: the share of the branch that is done (null when it has no
 *   descendants, so a leaf never shows an arc that can only be 0 % or 100 %);
 * - risk: blocked work weighs double, plus work that depends on something
 *   blocked, over the size of the branch (at least four, so one blocked note in
 *   a tiny branch does not read as total failure);
 * - awaiting: notes waiting for a person — review requests and open approvals;
 * - running: work in progress, which speeds the hub's breathing.
 */
export interface HubSignals { progress: number | null; risk: number | null; awaiting: number; running: number; descendants: number; atRisk: boolean }

const BLOCKED = new Set(['blocked', 'error']);

export function knowledgeHubSignals(graph: KnowledgeGraph): Map<string, HubSignals> {
  const byKey = new Map(graph.nodes.map(n => [n.key, n]));
  const children = new Map<string, string[]>();
  for (const n of graph.nodes) if (n.parentKey) {
    const list = children.get(n.parentKey) ?? [];
    list.push(n.key);
    children.set(n.parentKey, list);
  }
  // A note is endangered when it depends on something that is blocked.
  const blockedKeys = new Set(graph.nodes.filter(n => BLOCKED.has(n.node.status)).map(n => n.key));
  const endangered = new Set<string>();
  for (const r of graph.relations) {
    if (r.type !== 'depends-on' || r.source === 'candidate' || r.confidence < .6) continue;
    const from = byKey.get(r.from);
    if (from && from.node.status !== 'done' && blockedKeys.has(r.to)) endangered.add(r.from);
  }
  const result = new Map<string, HubSignals>();
  for (const hub of graph.nodes) {
    if (hub.depth > 1) continue;
    let total = 0, done = 0, blocked = 0, atRisk = 0, awaiting = 0, running = 0;
    const stack = [...(children.get(hub.key) ?? [])];
    while (stack.length) {
      const key = stack.pop()!;
      const n = byKey.get(key);
      if (!n) continue;
      total++;
      const status = n.node.status;
      if (status === 'done') done++;
      if (BLOCKED.has(status)) blocked++;
      if (status === 'running') running++;
      if (status === 'needs_review' || (n.node.nodeType === 'approval_request' && status !== 'done')) awaiting++;
      if (endangered.has(key)) atRisk++;
      for (const child of children.get(key) ?? []) stack.push(child);
    }
    const ownBlocked = BLOCKED.has(hub.node.status);
    const measured = total ? Math.min(1, (blocked * 2 + atRisk) / Math.max(4, total)) : null;
    result.set(hub.key, {
      progress: total ? done / total : null,
      risk: ownBlocked ? Math.max(.5, measured ?? 0) : measured,
      awaiting,
      running,
      descendants: total,
      atRisk: ownBlocked || endangered.has(hub.key) || (measured ?? 0) > .5,
    });
  }
  return result;
}

export interface CascadeItem { key: string; via?: KnowledgeRelation; direction?: 'in' | 'out'; children: CascadeItem[] }
/** A bounded spanning forest; cross-links stay in the graph, never recurse. */
export function knowledgeCascade(graph: KnowledgeGraph, roots: string[], allowed?: Set<string>) {
  const adjacency=new Map<string,KnowledgeRelation[]>();
  for (const r of graph.relations) {
    if (allowed && !allowed.has(r.id)) continue;
    for (const key of [r.from,r.to]) { const list=adjacency.get(key)??[]; list.push(r); adjacency.set(key,list); }
  }
  const keys=new Set(graph.nodes.map(n=>n.key));
  const boundedRoots=[...new Set(roots)].filter(key=>keys.has(key)).slice(0,8);
  const seen=new Set(boundedRoots), items: CascadeItem[]=boundedRoots.map(key=>({key,children:[]}));
  const queue=items.map(item=>({item,depth:0}));
  for(let i=0;i<queue.length&&seen.size<80;i++) {
    const {item,depth}=queue[i]; if(depth>=4) continue;
    const relations=[...(adjacency.get(item.key)??[])].sort((a,b)=>Number(a.source==='candidate')-Number(b.source==='candidate') || b.confidence-a.confidence);
    for(const r of relations) {
      const other=r.from===item.key?r.to:r.from;
      if(seen.has(other)||item.children.length>=5||seen.size>=80) continue;
      seen.add(other); const child: CascadeItem={key:other,via:r,direction:r.from===item.key?'out':'in',children:[]};
      item.children.push(child);queue.push({item:child,depth:depth+1});
    }
  }
  return items;
}

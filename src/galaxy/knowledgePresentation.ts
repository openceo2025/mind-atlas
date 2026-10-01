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

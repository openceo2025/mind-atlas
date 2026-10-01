import assert from 'node:assert/strict';
import { buildKnowledgeGraph, projectKnowledge, remapKnowledgeRelations } from '../src/galaxy/knowledgeGraph.ts';
import type { AtlasNode } from '../src/types.ts';
import type { SpaceView } from '../src/galaxy/galaxySummary.ts';
import { knowledgeMetrics, knowledgeCascade, knowledgeHubSignals } from '../src/galaxy/knowledgePresentation.ts';
import { buildKnowledgeMap, frameBounds, type Vec3 } from '../src/galaxy/knowledgeMap.ts';
const node = (id: string, title: string, children: AtlasNode[] = []): AtlasNode => ({ id, title, body: `${title} shared evidence research`, summary: '', tags: [], children } as unknown as AtlasNode);
const a = node('same-id', 'Research', [node('a', 'Shared research evidence')]);
const b = node('same-id', 'Product', [node('b', 'Shared research evidence')]);
const views = [{ space: { id: 's1', dependsOn: ['s2'] }, root: a }, { space: { id: 's2', dependsOn: ['s1'] }, root: b }] as SpaceView[];
const graph = buildKnowledgeGraph(views);
assert.equal(new Set(graph.nodes.map(n => n.key)).size, 4, 'IDs are space scoped');
assert.equal(graph.relations.filter(r => r.source === 'dependency').length, 2);
const candidate = graph.relations.find(r => r.source === 'candidate')!;
assert.ok(candidate);
const judgment = { ...candidate, type: 'supports' as const, source: 'ai' as const, confidence: .82, model: 'test-fixture' };
assert.ok(buildKnowledgeGraph(views, [judgment]).relations.some(r => r.source === 'ai'));
const mutated = graph.nodes.find(n => n.key === judgment.from)!;
mutated.node.body = 'Changed evidence';
assert.ok(!buildKnowledgeGraph(views, [judgment]).relations.some(r => r.source === 'ai'), 'Edits retract obsolete AI judgments');
const projection = projectKnowledge(graph, 'research', 'all');
assert.ok(projection.nodes.size <= graph.nodes.length, 'Cycles terminate');
assert.ok(projection.tree.length <= graph.nodes.length - projection.seeds.size, 'Projection never re-adds visited nodes');
assert.equal(projectKnowledge(graph, 'no-such-query', 'all').nodes.size, 0);
const removed = buildKnowledgeGraph([{ ...views[0], root: node('same-id', 'Research') }]);
assert.ok(removed.relations.every(r => removed.nodes.some(n => n.key === r.from) && removed.nodes.some(n => n.key === r.to)), 'No dangling references after deletion');
const c = node('c', 'Third notebook');
const chainViews = [{space:{id:'s1',dependsOn:['s2']},root:a},{space:{id:'s2',dependsOn:['s3']},root:b},{space:{id:'s3',dependsOn:[]},root:c}] as SpaceView[];
const chain=buildKnowledgeGraph(chainViews);
const inferred=chain.relations.find(r=>r.source==='inference')!;
assert.equal(inferred.supportIds?.length,2,'Derived dependency keeps its premises');
assert.ok(!buildKnowledgeGraph([{...chainViews[0],space:{...chainViews[0].space,dependsOn:[]}},...chainViews.slice(1)]).relations.some(r=>r.source==='inference'),'Removing a premise retracts inferred dependencies');
const imported=remapKnowledgeRelations([judgment,{...judgment,type:'invented'},null],id=>`import-${id}`);
assert.equal(imported.length,1,'Import rejects unsupported relation types');
assert.equal(JSON.parse(imported[0].from)[0],`import-${JSON.parse(judgment.from)[0]}`,'Import remaps scoped endpoints');
assert.ok(projectKnowledge(chain,'何が必要なのか','all').active,'Bounded question intents activate a projection');
const parent=graph.nodes.find(n=>n.depth===0)!;
const child=graph.nodes.find(n=>n.parentKey===parent.key)!;
child.node.status='done';parent.node.status='blocked';
assert.deepEqual(knowledgeMetrics(graph).get(parent.key),{count:2,done:1,blocked:1,review:0,running:0},'Status arcs aggregate canonical descendants exactly once');
const forest=knowledgeCascade(graph,[parent.key,parent.key,'missing']);
const collect=(items:ReturnType<typeof knowledgeCascade>):string[]=>items.flatMap(item=>[item.key,...collect(item.children)]);
const visited=collect(forest);
assert.equal(forest.length,1,'Invalid and duplicate roots are omitted');
assert.equal(visited.length,new Set(visited).size,'Cycles and cross-links never duplicate tree items');
assert.ok(visited.length<=80);
assert.equal(collect(knowledgeCascade(graph,[parent.key],new Set())).length,1,'Relation filtering restricts traversal');
// Progress rings measure a branch, so a note without descendants has no arc
// at all instead of an all-or-nothing circle.
const leafy = (id: string, title: string, status: string, children: AtlasNode[] = []) => ({ ...node(id, title, children), status } as unknown as AtlasNode);
const hubTree = leafy('root', 'Hub', 'waiting', [
  leafy('b1', 'Branch with work', 'waiting', [leafy('x1', 'Done one', 'done'), leafy('x2', 'Done two', 'done'), leafy('x3', 'Blocked', 'blocked'), leafy('x4', 'Review', 'needs_review')]),
  leafy('b2', 'Lonely leaf', 'done'),
]);
const hubGraph = buildKnowledgeGraph([{ space: { id: 'h', dependsOn: [] }, root: hubTree }] as unknown as SpaceView[]);
const hubSignals = knowledgeHubSignals(hubGraph);
const keyOf = (id: string) => hubGraph.nodes.find(n => n.node.id === id)!.key;
assert.equal(hubSignals.get(keyOf('b2'))!.progress, null, 'A leaf branch shows no progress arc');
assert.equal(hubSignals.get(keyOf('b1'))!.progress, .5, 'Progress is the done share of the branch');
assert.equal(hubSignals.get(keyOf('b1'))!.awaiting, 1, 'Review requests become satellites');
assert.ok(hubSignals.get(keyOf('b1'))!.risk! > 0 && hubSignals.get(keyOf('b1'))!.risk! < 1, 'Blocked work raises a partial risk arc');
assert.equal(hubSignals.get(keyOf('root'))!.progress, 3 / 6, 'Space progress rolls up every descendant');
assert.ok(!hubSignals.has(keyOf('x1')), 'Only spaces and their top-level branches carry rings');

// The map: the origin space stays put, spaces never overlap, and the universe
// positions are kept for the seamless glide.
const spaceViews = ['p', 'q', 'r'].map((id, i) => ({ space: { id, dependsOn: [] }, root: leafy(`${id}-root`, `Space ${id}`, 'waiting', Array.from({ length: 3 + i * 3 }, (_, j) => leafy(`${id}-${j}`, `Note ${id}${j}`, 'waiting', [leafy(`${id}-${j}-a`, `Detail ${id}${j}`, 'done')]))) })) as unknown as SpaceView[];
const mapGraph = buildKnowledgeGraph(spaceViews);
const native = new Map<string, Map<string, Vec3>>(spaceViews.map(view => [view.space.id, new Map<string, Vec3>(mapGraph.nodes.filter(n => n.spaceId === view.space.id).map((n, i) => [n.node.id, [Math.cos(i) * 40 * n.depth, Math.sin(i) * 40 * n.depth, -340 * n.depth] as Vec3]))]));
const map = buildKnowledgeMap(mapGraph, native, 'q');
assert.deepEqual(map.anchors.get('q'), [0, 0], 'The space you came from stays at the origin');
const clusterList = [...map.clusters.values()];
for (let i = 0; i < clusterList.length; i++) for (let j = i + 1; j < clusterList.length; j++) {
  const a = clusterList[i], b = clusterList[j];
  assert.ok(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) >= a.radius + b.radius, 'Spaces never overlap');
}
for (const n of mapGraph.nodes) {
  const g = map.positions.get(n.key)!, u = map.native.get(n.key)!;
  assert.ok(Math.abs(g[2]) <= 60, 'The galaxy is a flat map with a little relief');
  const anchor = map.anchors.get(n.spaceId)!, origin = native.get(n.spaceId)!.get(n.node.id)!;
  assert.deepEqual(u, [origin[0] + anchor[0], origin[1] + anchor[1], origin[2]], 'Universe positions are kept for the glide');
}
const again = buildKnowledgeMap(mapGraph, native, 'q', map.anchors);
for (const [id, anchor] of map.anchors) assert.deepEqual(again.anchors.get(id), anchor, 'Places are stable within a visit');
const framed = frameBounds(map.bounds, { width: 1440, height: 900, fov: 45 }, { left: 236, right: 36, top: 128, bottom: 96 });
const wpp = (2 * framed.distance * Math.tan(Math.PI / 8)) / 900;
assert.ok((map.bounds.maxX - map.bounds.minX) / wpp <= 1440 - 236 - 36 + 1 && (map.bounds.maxY - map.bounds.minY) / wpp <= 900 - 128 - 96 + 1, 'The overview fits the free part of the screen');
console.log('Knowledge graph: scoped IDs, stale-source retraction, cycles, deletion, inference provenance/retraction, import, question intents, progress rings and map layout passed.');

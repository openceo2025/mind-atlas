import type { AxisKey, Card, CardKind, RelationType } from '../types';
import { cardSize, clusterCards, depthScale, fallbackClusterLabel, relax, similarityMatrix } from '../lib/semantic';
import { engine } from '../lib/physics';
import { t } from '../i18n';
import type { Draft } from '../lib/ai';
import { classifyRelations, nameClusters } from '../lib/ai';
import {
  addLog,
  addRelationRaw,
  get,
  isAxisCard,
  layoutCards,
  lookup,
  markDirty,
  newId,
  now,
  set,
  snapshot,
  toast,
  undo,
} from './core';
import { AXIS_KEYS } from './core';
import { AXIS_NAME, DOCK, applyAxes, overrideFromPosition, relayout } from './layout';
import { focusCard, select } from './ui';

export function makeCard(partial: Partial<Card> & { title: string }): Card {
  const at = now();
  return {
    id: newId('k'),
    kind: 'note',
    body: '',
    tags: [],
    x: 0,
    y: 0,
    depth: 0.5,
    place: 'canvas',
    log: [{ at, code: 'created' }],
    createdBy: 'user',
    createdAt: at,
    updatedAt: at,
    ...partial,
  };
}

// ── 作成・編集 ───────────────────────────────────────────
/**
 * カードを作る。位置を指定した場合は、その場所が「人が決めた意味の位置」になるので
 * いまの軸での上書き値として記録する。
 */
export function createCard(partial: Partial<Card> & { title: string }, at?: { x: number; y: number }, opts: { select?: boolean } = {}) {
  snapshot();
  const card = makeCard(partial);
  if (at) {
    card.x = at.x;
    card.y = at.y;
  }
  set((s) => ({ cards: { ...s.cards, [card.id]: card } }));
  markDirty();
  engine.place(card.id, at?.x ?? 0, at?.y ?? 0, 0.3);
  // 置いた場所は仮の場所。手で置いた印は付けず、編集が終わったら意味の位置へ動かす
  if (!get().editingCardId) relayout({ stagger: false, mode: 'soft' });
  if (opts.select !== false && card.place === 'canvas') select([card.id]);
  return card.id;
}

export function updateCard(id: string, patch: Partial<Card>, opts: { relayout?: boolean } = {}) {
  const c = lookup(id);
  if (!c) return;
  const textChanged = ['title', 'body', 'tags', 'subtitle'].some((k) => k in patch && JSON.stringify(patch[k as keyof Card]) !== JSON.stringify(c[k as keyof Card]));
  set((s) => ({ cards: { ...s.cards, [id]: { ...c, ...patch, updatedAt: now() } } }));
  markDirty();
  if (textChanged && opts.relayout !== false) scheduleRelayout();
}

let relayoutTimer = 0;
function scheduleRelayout() {
  window.clearTimeout(relayoutTimer);
  // 編集中は動かさない。beginCardEdit / endCardEdit が終わりを教えてくれる
  if (get().editingCardId) return;
  relayoutTimer = window.setTimeout(() => relayout({ stagger: false, mode: 'soft' }), 900);
}

/** カードを編集し始めた：終わるまで意味配置を止め、そのカードはその場に留める */
export function beginCardEdit(id: string) {
  if (get().editingCardId === id) return;
  set({ editingCardId: id });
}

/** 編集が終わった：意味の位置へ動かす（手で置いたカードはその場所のまま） */
export function endCardEdit(id: string) {
  if (get().editingCardId !== id) return;
  set({ editingCardId: null });
  relayout({ stagger: false, mode: 'soft' });
}

// ── 移動・複製・削除 ───────────────────────────────────────
export function moveCards(ids: string[], dx: number, dy: number) {
  set((s) => {
    const cards = { ...s.cards };
    for (const id of ids) if (cards[id]) cards[id] = { ...cards[id], x: cards[id].x + dx, y: cards[id].y + dy };
    return { cards };
  });
  for (const id of ids) {
    const c = lookup(id);
    if (c) engine.setTarget(id, c.x, c.y, depthScale(c.depth), 'drag');
  }
}

/** 軸になっているカードは、どこに置かれても軸の先端へ戻る */
export function settleAxisCard(id: string) {
  const k = AXIS_KEYS.find((key) => get().axes[key] === id);
  if (!k) return;
  set((s) => ({ cards: { ...s.cards, [id]: { ...s.cards[id], x: DOCK[k].x, y: DOCK[k].y } } }));
  engine.setTarget(id, DOCK[k].x, DOCK[k].y, depthScale(0.62), 'soft');
}

/** 軸の先端から遠くへ運んだら、その軸から外す（その軸には意味を持たせない） */
const AXIS_DETACH_DISTANCE = 220;

export function axisToDetach(id: string) {
  const s = get();
  const k = AXIS_KEYS.find((key) => s.axes[key] === id);
  if (!k) return null;
  const c = s.cards[id];
  if (!c) return null;
  return Math.hypot(c.x - DOCK[k].x, c.y - DOCK[k].y) > AXIS_DETACH_DISTANCE ? k : null;
}

export function detachAxis(key: AxisKey) {
  const s = get();
  const id = s.axes[key];
  if (!id) return;
  applyAxes({ ...s.axes, [key]: '' }, t('axis.detached', { axis: AXIS_NAME(key) }));
}

export function duplicate(ids: string[]): string[] {
  snapshot();
  const out: string[] = [];
  const cards = { ...get().cards };
  const rels: [string, string][] = [];
  for (const id of ids) {
    const c = cards[id];
    if (!c || c.kind === 'concept' || c.kind === 'group') continue;
    const nid = newId('k');
    cards[nid] = { ...structuredClone(c), id: nid, title: t('card.copyOf', { title: c.title }), log: [{ at: now(), code: 'duplicated', params: { title: c.title } }], createdAt: now(), updatedAt: now() };
    engine.place(nid, c.x, c.y, depthScale(c.depth));
    out.push(nid);
    rels.push([id, nid]);
  }
  set({ cards });
  for (const [a, b] of rels) addRelationRaw(a, b, 'derived');
  markDirty();
  return out;
}

export function deleteCards(ids: string[]) {
  const s = get();
  const del = ids.filter((id) => !isAxisCard(id));
  if (!del.length) {
    toast(t('toast.axisNotDeletable'));
    return;
  }
  snapshot();
  const cards = { ...s.cards };
  for (const id of del) {
    const c = cards[id];
    if (c?.members) for (const m of c.members) if (cards[m]) cards[m] = { ...cards[m], place: 'canvas', groupId: undefined, x: c.x, y: c.y };
    if (c?.groupId && cards[c.groupId]?.members) {
      const g = cards[c.groupId];
      cards[g.id] = { ...g, members: g.members!.filter((m) => m !== id) };
    }
    delete cards[id];
    engine.remove(id);
  }
  set({
    cards,
    relations: s.relations.filter((r) => !del.includes(r.from) && !del.includes(r.to)),
    selection: [],
    primary: null,
    windows: s.windows.filter((w) => !w.cardIds.length || w.cardIds.some((id) => !del.includes(id)) || ['axis', 'preview'].includes(w.type)),
  });
  markDirty();
  toast(t('toast.deleted', { n: del.length }), { action: { label: t('action.undo'), run: () => undo() } });
  relayout({ stagger: false, mode: 'soft' });
}

// ── 束ねる / 展開 ──────────────────────────────────────────
export function group(ids: string[], title?: string) {
  const s = get();
  const members = ids.filter((id) => s.cards[id]?.place === 'canvas' && !isAxisCard(id) && !['group', 'concept'].includes(s.cards[id].kind));
  if (members.length < 2) {
    toast(t('toast.groupNeedsTwo'));
    return;
  }
  snapshot();
  const ms = members.map((id) => s.cards[id]);
  const cx = ms.reduce((a, c) => a + c.x, 0) / ms.length;
  const cy = ms.reduce((a, c) => a + c.y, 0) / ms.length;
  const kinds = new Set(ms.map((m) => m.kind));
  const autoTitle =
    kinds.has('quote') && kinds.size === 1
      ? t('group.evidence')
      : [...kinds].every((k) => ['hypothesis', 'issue', 'idea'].includes(k))
        ? t('group.issues')
        : fallbackClusterLabel(ms) || t('group.bundle');
  const card = makeCard({
    kind: 'group',
    title: title ?? autoTitle,
    subtitle: t('group.count', { n: members.length }),
    tags: [...new Set(ms.flatMap((m) => m.tags))].slice(0, 3),
    body: ms.map((m) => m.title).join('\n'),
    x: cx,
    y: cy,
    depth: ms.reduce((a, c) => a + c.depth, 0) / ms.length,
    members,
    expanded: false,
    log: [{ at: now(), code: 'grouped', params: { n: members.length } }],
  });
  const cards = { ...s.cards, [card.id]: card };
  for (const m of members) cards[m] = { ...cards[m], place: 'hidden', groupId: card.id, x: cx, y: cy, log: [...cards[m].log, { at: now(), code: 'bundledInto', params: { title: card.title } }] };
  engine.place(card.id, cx, cy, 0.4);
  for (const m of members) engine.setTarget(m, cx, cy, 0.3, 'soft');
  set({
    cards,
    relations: [...s.relations, ...members.map((m) => ({ id: newId('r'), from: card.id, to: m, type: 'contains' as const }))],
    selection: [card.id],
    primary: card.id,
  });
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
  toast(t('toast.grouped', { n: members.length, title: card.title }));
  return card.id;
}

export function expandGroup(gid: string) {
  const s = get();
  const g = s.cards[gid];
  if (!g?.members) return;
  snapshot();
  const cards = { ...s.cards };
  const n = g.members.length;
  const nodes = g.members
    .filter((m) => cards[m])
    .map((m, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const size = cardSize(cards[m]);
      const x = g.x + Math.cos(a) * 270;
      const y = g.y + Math.sin(a) * 170;
      return { id: m, x, y, tx: x, ty: y, w: size.w, h: size.h };
    });
  const others = layoutCards(s)
    .filter((c) => c.id !== gid)
    .map((c) => ({ id: c.id, x: c.x, y: c.y, tx: c.x, ty: c.y, w: cardSize(c).w, h: cardSize(c).h }));
  relax([...nodes, ...others], 50);
  for (const n2 of nodes) {
    cards[n2.id] = { ...cards[n2.id], place: 'canvas', x: n2.x, y: n2.y, depth: g.depth };
    engine.place(n2.id, g.x, g.y, 0.3);
  }
  for (const o of others) cards[o.id] = { ...cards[o.id], x: o.x, y: o.y };
  cards[gid] = { ...g, expanded: true, log: [...g.log, { at: now(), code: 'expanded' }] };
  set({ cards });
  markDirty();
  nodes.forEach((n2, i) => engine.setTarget(n2.id, n2.x, n2.y, depthScale(g.depth), 'soft', i * 40));
  others.forEach((o) => engine.setTarget(o.id, o.x, o.y, depthScale(cards[o.id].depth), 'soft'));
}

export function collapseGroup(gid: string) {
  const s = get();
  const g = s.cards[gid];
  if (!g?.members) return;
  snapshot();
  const cards = { ...s.cards };
  for (const m of g.members) {
    if (!cards[m]) continue;
    cards[m] = { ...cards[m], place: 'hidden', x: g.x, y: g.y };
    engine.setTarget(m, g.x, g.y, 0.3, 'soft');
  }
  cards[gid] = { ...g, expanded: false };
  set({ cards, selection: [gid], primary: gid });
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
}

export function addToGroup(gid: string, ids: string[]) {
  const s = get();
  const g = s.cards[gid];
  const add = ids.filter((id) => id !== gid && !isAxisCard(id) && s.cards[id] && !['group', 'concept'].includes(s.cards[id].kind) && !g?.members?.includes(id));
  if (!g?.members || !add.length) return;
  snapshot();
  const members = [...g.members, ...add];
  const cards = { ...s.cards };
  for (const id of add) {
    cards[id] = { ...cards[id], place: g.expanded ? 'canvas' : 'hidden', groupId: gid, log: [...cards[id].log, { at: now(), code: 'bundledInto', params: { title: g.title } }] };
    if (!g.expanded) engine.setTarget(id, g.x, g.y, 0.3, 'soft');
  }
  cards[gid] = {
    ...g,
    members,
    subtitle: t('group.count', { n: members.length }),
    body: members.map((m) => cards[m]?.title ?? '').join('\n'),
    log: [...g.log, { at: now(), code: 'addedToGroup', params: { n: add.length } }],
  };
  set({
    cards,
    relations: [...s.relations, ...add.map((m) => ({ id: newId('r'), from: gid, to: m, type: 'contains' as const }))],
    selection: [gid],
    primary: gid,
  });
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
  toast(t('toast.addedToGroup', { n: add.length, title: g.title }));
}

/** 隠れているカード（束の中）なら束を開いてから、そのカードへ寄る */
export function revealCard(id: string) {
  const c = lookup(id);
  if (!c) return;
  if (c.place === 'hidden' && c.groupId) expandGroup(c.groupId);
  if (c.place === 'shelf' || c.place === 'library') return;
  window.setTimeout(() => focusCard(id), c.place === 'hidden' ? 350 : 0);
}

// ── AI や抽出で生まれたカードを、元カードの周りに置く ─────────────
export function spawnDrafts(sourceId: string, drafts: Draft[], radius = 290): string[] {
  const s = get();
  const src = s.cards[sourceId];
  if (!src || !drafts.length) return [];
  snapshot();
  const cards = { ...s.cards };
  const ids: string[] = [];
  const baseAngle = Math.atan2(src.y, src.x);
  const nodes = drafts.map((d, i) => {
    const a = baseAngle + (i - (drafts.length - 1) / 2) * 0.75;
    const x = src.x + Math.cos(a) * radius;
    const y = src.y + Math.sin(a) * radius * 0.7;
    const card = makeCard({
      kind: d.kind,
      title: d.title,
      body: d.body,
      tags: d.tags,
      x,
      y,
      depth: src.depth,
      createdBy: 'ai',
      log: [{ at: now(), code: 'generatedFrom', params: { title: src.title } }],
    });
    cards[card.id] = card;
    ids.push(card.id);
    engine.place(card.id, src.x, src.y, 0.3);
    return card;
  });
  cards[sourceId] = { ...cards[sourceId], log: [...cards[sourceId].log, { at: now(), code: 'spawned', params: { n: drafts.length } }] };
  set({
    cards,
    relations: [...s.relations, ...drafts.map((d, i) => ({ id: newId('r'), from: sourceId, to: nodes[i].id, type: d.relation ?? ('derived' as RelationType) }))],
  });
  markDirty();
  relayout({ stagger: true, mode: 'soft' });
  return ids;
}

export function extractText(sourceId: string, text: string, kind: CardKind = 'quote') {
  const src = lookup(sourceId);
  const body = text.trim();
  if (!src || !body) return undefined;
  const title = body.length > 42 ? `${body.slice(0, 42)}…` : body;
  const [id] = spawnDrafts(sourceId, [{ kind, title, body, tags: [], relation: 'derived' }], 260);
  if (id) {
    patchSubtitle(id, t('card.extractedFrom', { title: src.title }));
    addLog(sourceId, 'extracted', { title });
    toast(t('toast.extracted', { title: src.title }));
  }
  return id;
}

function patchSubtitle(id: string, subtitle: string) {
  set((s) => (s.cards[id] ? { cards: { ...s.cards, [id]: { ...s.cards[id], subtitle } } } : {}));
}

export function saveSummaryCard(sourceIds: string[], title: string, body: string) {
  const first = sourceIds[0];
  if (!first) return;
  const [id] = spawnDrafts(first, [{ kind: 'summary', title: t('card.summaryTitle', { title }), body, tags: [], relation: 'derived' }], 250);
  if (!id) return;
  for (const sid of sourceIds.slice(1)) addRelationRaw(sid, id, 'derived');
  toast(t('toast.summarySaved'));
}

/** 位置の決まっている場所（ドロップ先など）へカードを置く */
export function placeCard(id: string, x: number, y: number) {
  set((s) => (s.cards[id] ? { cards: { ...s.cards, [id]: { ...s.cards[id], x, y } } } : {}));
  overrideFromPosition([id]);
}

// ── 関係 ───────────────────────────────────────────────
export function addRelation(from: string, to: string, type: RelationType) {
  if (from === to) return;
  const s = get();
  if (s.relations.some((r) => !r.suggested && ((r.from === from && r.to === to) || (r.from === to && r.to === from)) && r.type === type)) return;
  snapshot();
  const id = addRelationRaw(from, to, type);
  addLog(from, 'related', { type, title: lookup(to)?.title ?? '' });
  addLog(to, 'related', { type, title: lookup(from)?.title ?? '' });
  set({ selectedRelation: id });
  return id;
}

export function updateRelation(id: string, patch: { type?: RelationType; label?: string }) {
  snapshot();
  set((s) => ({ relations: s.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  markDirty();
}

export function removeRelation(id: string) {
  snapshot();
  set((s) => ({ relations: s.relations.filter((r) => r.id !== id), selectedRelation: null }));
  markDirty();
}

export function acceptRelation(id: string) {
  set((s) => ({ relations: s.relations.map((r) => (r.id === id ? { ...r, suggested: false } : r)) }));
  const r = get().relations.find((x) => x.id === id);
  if (r) {
    addLog(r.from, 'related', { type: r.type, title: lookup(r.to)?.title ?? '' });
    addLog(r.to, 'related', { type: r.type, title: lookup(r.from)?.title ?? '' });
  }
  markDirty();
}

export function dismissRelation(id: string) {
  set((s) => ({ relations: s.relations.filter((r) => r.id !== id) }));
}

export function markCompared(ids: string[]) {
  const [a, b] = ids;
  if (!a || !b) return;
  const s = get();
  if (s.relations.some((r) => r.type === 'compared-with' && ((r.from === a && r.to === b) || (r.from === b && r.to === a)))) return;
  addRelationRaw(a, b, 'compared-with');
  addLog(a, 'compared', { title: lookup(b)?.title ?? '' });
  addLog(b, 'compared', { title: lookup(a)?.title ?? '' });
}

/**
 * 意味の近さ（埋め込み）で未接続の組を候補に挙げ、AI が使えれば関係の種類を判定する。
 * AI が使えないときは「関連」として近さを添えて提案する。
 */
export async function suggestRelations(focus: string[] | undefined, useAi: boolean) {
  const s = get();
  const cards = layoutCards(s).filter((c) => c.kind !== 'concept');
  if (cards.length < 2) return 0;
  const sim = similarityMatrix(cards);
  const linked = new Set(s.relations.flatMap((r) => [`${r.from}|${r.to}`, `${r.to}|${r.from}`]));
  const cands: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].id;
      const b = cards[j].id;
      if (focus?.length && !focus.includes(a) && !focus.includes(b)) continue;
      if (linked.has(`${a}|${b}`)) continue;
      cands.push({ a, b, score: sim(i, j) });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const top = cands.slice(0, 6);
  if (!top.length) return 0;
  let suggestions: { from: string; to: string; type: RelationType; label: string }[] = top.map((c) => ({
    from: c.a,
    to: c.b,
    type: 'related',
    label: t('relation.similarity', { n: Math.round(Math.max(0, c.score) * 100) }),
  }));
  if (useAi) {
    try {
      const involved = [...new Set(top.flatMap((c) => [c.a, c.b]))].map((id) => s.cards[id]);
      const typed = await classifyRelations(involved, top.map((c) => [c.a, c.b]));
      if (typed.length) suggestions = typed.map((r) => ({ from: r.from, to: r.to, type: r.type, label: r.reason }));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { tone: 'error' });
    }
  }
  set((st) => ({
    relations: [
      ...st.relations.filter((r) => !r.suggested),
      ...suggestions.map((g) => ({ id: newId('sg'), from: g.from, to: g.to, type: g.type, suggested: true, label: g.label })),
    ],
  }));
  return suggestions.length;
}

// ── クラスタ ────────────────────────────────────────────
export async function proposeClusters(useAi: boolean) {
  const cards = layoutCards().filter((c) => c.kind !== 'concept');
  const k = cards.length >= 12 ? 4 : 3;
  const raw = clusterCards(cards, Math.min(k, cards.length));
  const clusters = raw.map((c) => ({ ...c, label: fallbackClusterLabel(c.cardIds.map((id) => lookup(id)!).filter(Boolean)) }));
  set({ clusters });
  if (useAi && clusters.length) {
    try {
      const labels = await nameClusters(clusters.map((c) => c.cardIds.map((id) => lookup(id)!).filter(Boolean)));
      set((s) => (s.clusters ? { clusters: s.clusters.map((c, i) => ({ ...c, label: labels[i] || c.label })) } : {}));
    } catch {
      // 名前付けに失敗しても、仮の名前で使える
    }
  }
  return clusters;
}

// ── 棚（Shelf） ────────────────────────────────────────
export function toShelf(ids: string[]) {
  const movable = ids.filter((id) => !isAxisCard(id) && lookup(id)?.kind !== 'concept');
  if (!movable.length) return;
  snapshot();
  set((s) => {
    const cards = { ...s.cards };
    for (const id of movable) cards[id] = { ...cards[id], place: 'shelf', log: [...cards[id].log, { at: now(), code: 'shelved' }] };
    return { cards, selection: [], primary: null };
  });
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
  toast(t('toast.shelved', { n: movable.length }));
}

export function fromShelf(id: string, x: number, y: number) {
  const c = lookup(id);
  if (!c) return;
  snapshot();
  set((s) => ({ cards: { ...s.cards, [id]: { ...c, place: 'canvas', x, y, log: [...c.log, { at: now(), code: 'placed' }] } } }));
  engine.place(id, x, y, 0.5);
  overrideFromPosition([id]);
  select([id]);
}

export function addNote(text: string, place: 'shelf' | 'canvas' = 'shelf') {
  const body = text.trim();
  if (!body) return;
  const lines = body.split('\n');
  const title = lines[0].slice(0, 80);
  createCard({ kind: 'note', title, body: lines.length > 1 || lines[0].length > 80 ? body : '', place }, undefined, { select: place === 'canvas' });
  if (place === 'shelf') toast(t('toast.noteShelved'));
}

/** テキストやファイルの取り込み結果を、まとめて空間に置く */
export function importDrafts(drafts: (Partial<Card> & { title: string; parent?: number })[]) {
  if (!drafts.length) return [];
  snapshot();
  const cards = { ...get().cards };
  const ids: string[] = [];
  const rels: [string, string][] = [];
  drafts.forEach((d, i) => {
    const { parent, ...rest } = d;
    const card = makeCard({ ...rest, log: [{ at: now(), code: 'imported' }] });
    cards[card.id] = card;
    ids.push(card.id);
    engine.place(card.id, 0, 0, 0.2);
    if (parent !== undefined && ids[parent] && parent !== i) rels.push([ids[parent], card.id]);
  });
  set({ cards });
  for (const [a, b] of rels) addRelationRaw(a, b, 'contains');
  markDirty();
  relayout({ stagger: true });
  return ids;
}

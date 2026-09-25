import type { AxisKey, Card, CardKind, Relation, RelationType, RelationWord } from '../types';
import { CUSTOM_PREFIX, type VocabularyId } from '../lib/relationCatalog';
import { cardSize, clusterCards, depthScale, fallbackClusterLabel, freezeCardText, relax, similarityMatrix, thawCardText } from '../lib/semantic';
import { engine } from '../lib/physics';
import { t } from '../i18n';
import type { Draft } from '../lib/ai';
import { classifyRelations, nameClusters } from '../lib/ai';
import { classifyNewCards, judgeRelations } from '../lib/decisions';
import { decideEnabled } from '../lib/decide';
import {
  addLog,
  addRelationRaw,
  canvasCards,
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
  endTextEdit(id, true);
  if (get().editingCardId !== id) return;
  set({ editingCardId: null });
  relayout({ stagger: false, mode: 'soft' });
}

// 文字の入力。入力欄にいる間は、打ちかけの文章で意味を計算しない。
// 入力欄を離れたら書き終わり（タイトル→本文のように欄を移るだけなら続き）。
const textEditTimers = new Map<string, number>();

export function beginTextEdit(id: string) {
  window.clearTimeout(textEditTimers.get(id));
  textEditTimers.delete(id);
  const c = lookup(id);
  if (c) freezeCardText(c);
}

export function endTextEdit(id: string, immediately = false) {
  window.clearTimeout(textEditTimers.get(id));
  const finish = () => {
    textEditTimers.delete(id);
    const c = lookup(id);
    if (c && thawCardText(c)) relayout({ stagger: false, mode: 'soft' });
  };
  if (immediately) finish();
  else textEditTimers.set(id, window.setTimeout(finish, 700));
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

/**
 * ドラッグで一緒に動くカード。人は線を全部たどって見るのではなく、引き連れて動くことで
 * つながりを感じるので、つかんだカードから生まれたもの（派生の向き）を孫の先までたどる。
 * 開いているグループの中身も連れていく。軸のカードと、画面に出ていないカードは連れていかない。
 */
export function dragFollowers(ids: string[]): string[] {
  const s = get();
  const out = new Set<string>();
  const seen = new Set(ids);
  const queue = [...ids];
  while (queue.length) {
    const from = queue.shift()!;
    const src = s.cards[from];
    for (const r of s.relations) {
      if (r.suggested || r.from !== from || seen.has(r.to)) continue;
      if (r.type !== 'derived' && !(r.type === 'contains' && src?.kind === 'group' && src.expanded)) continue;
      const c = s.cards[r.to];
      seen.add(r.to);
      if (!c || c.place !== 'canvas' || isAxisCard(r.to)) continue;
      out.add(r.to);
      queue.push(r.to);
    }
  }
  return [...out];
}

/** Shift ドラッグ：奥行きだけを動かす（奥へ行くほど右上へ寄り、小さくなる） */
export function placeAtDepth(places: { id: string; x: number; y: number; depth: number }[]) {
  set((s) => {
    const cards = { ...s.cards };
    for (const p of places) if (cards[p.id]) cards[p.id] = { ...cards[p.id], x: p.x, y: p.y, depth: p.depth };
    return { cards };
  });
  for (const p of places) engine.setTarget(p.id, p.x, p.y, depthScale(p.depth), 'drag');
}

/** 軸になっているカードは、どこに置かれても軸の先端へ戻る */
export function settleAxisCard(id: string) {
  const k = AXIS_KEYS.find((key) => get().axes[key] === id);
  if (!k) return;
  set((s) => ({ cards: { ...s.cards, [id]: { ...s.cards[id], x: DOCK[k].x, y: DOCK[k].y } } }));
  engine.setTarget(id, DOCK[k].x, DOCK[k].y, depthScale(0.38), 'soft');
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

/**
 * 親のすぐ右から近い順に、他のカードと重ならない場所を探す（子カードの生まれる場所）。
 * 起点はいつも親の真横。作った数だけ下へずらすと、兄カードを動かした後も下へ下へと離れていく。
 * 奥にある親ほどカードは小さく描かれるので、間隔もその分だけ詰める。
 */
function childSpots(parent: Card, kids: Pick<Card, 'kind'>[], cards: Card[]) {
  const k = depthScale(parent.depth);
  const { w } = cardSize(parent);
  const taken = cards.map((c) => {
    const o = cardSize(c);
    const kc = depthScale(c.depth);
    return { x: c.x, y: c.y, w: o.w * kc, h: o.h * kc };
  });
  const base = cardSize(kids[0] as Card);
  const stepX = (base.w + 30) * k;
  const stepY = (base.h + 28) * k;
  const home = { x: parent.x + ((w + base.w) / 2 + 40) * k, y: parent.y };
  const spots: { x: number; y: number; cost: number }[] = [];
  for (let gx = -3; gx <= 4; gx++) {
    for (let gy = -5; gy <= 6; gy++) {
      const px = home.x + gx * stepX;
      const py = home.y + gy * stepY;
      // 右と下を少しだけ好む（左や上は遠回り扱い）
      const cost = Math.hypot((px - home.x) * (gx < 0 ? 1.6 : 1), (py - home.y) * (gy < 0 ? 1.3 : 1));
      spots.push({ x: px, y: py, cost });
    }
  }
  spots.sort((a, b) => a.cost - b.cost);
  return kids.map((kid, i) => {
    const size = cardSize(kid as Card);
    const kw = size.w * k;
    const kh = size.h * k;
    const free = (px: number, py: number) => !taken.some((o) => Math.abs(o.x - px) < (o.w + kw) / 2 + 14 * k && Math.abs(o.y - py) < (o.h + kh) / 2 + 14 * k);
    const spot = spots.find((p) => free(p.x, p.y)) ?? { x: home.x + stepX, y: home.y + i * stepY };
    taken.push({ x: spot.x, y: spot.y, w: kw, h: kh });
    return { x: spot.x, y: spot.y };
  });
}

/**
 * あるカードから、つながった子カードを生やす。押すたびに親の右へ increment して並ぶ。
 * 中身を書く前に意味配置で飛ばされないよう、置いた場所を「手で置いた」として覚える。
 */
export function createChild(parentId: string) {
  const s = get();
  const parent = s.cards[parentId];
  if (!parent || parent.place !== 'canvas' || s.readOnly) return;
  snapshot();
  const [{ x, y }] = childSpots(parent, [{ kind: 'note' }], canvasCards(s));
  const card = makeCard({
    kind: 'note',
    title: t('card.newTitle'),
    x,
    y,
    depth: parent.depth,
    log: [{ at: now(), code: 'childOf', params: { title: parent.title } }],
  });
  set((st) => ({ cards: { ...st.cards, [card.id]: card } }));
  engine.place(card.id, parent.x, parent.y, depthScale(parent.depth) * 0.5);
  engine.setTarget(card.id, x, y, depthScale(parent.depth), 'soft');
  addRelationRaw(parentId, card.id, 'derived');
  addLog(parentId, 'spawned', { n: 1 });
  markDirty();
  overrideFromPosition([card.id]);
  set({ highlight: [card.id] });
  window.setTimeout(() => set((st) => (st.highlight.includes(card.id) ? { highlight: [] } : {})), 1200);
  return card.id;
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
    if (c?.members) for (const m of c.members) if (cards[m]) cards[m] = { ...cards[m], place: 'canvas', groupId: undefined, groupOffset: undefined, x: c.x, y: c.y };
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
  // 束ねる前の並びを覚えておき、開いたときはその並びのまま出す
  for (const m of members)
    cards[m] = {
      ...cards[m],
      place: 'hidden',
      groupId: card.id,
      groupOffset: { x: cards[m].x - cx, y: cards[m].y - cy },
      x: cx,
      y: cy,
      log: [...cards[m].log, { at: now(), code: 'bundledInto', params: { title: card.title } }],
    };
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
  // 中のカードは毎回同じ場所へ出す（覚えている場所が無いものだけ、輪の上に空きを作って置く）
  const nodes = g.members
    .filter((m) => cards[m])
    .map((m, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const size = cardSize(cards[m]);
      const off = cards[m].groupOffset ?? { x: Math.round(Math.cos(a) * 270), y: Math.round(Math.sin(a) * 170) };
      const x = g.x + off.x;
      const y = g.y + off.y;
      return { id: m, x, y, tx: x, ty: y, w: size.w, h: size.h, fixed: true, off };
    });
  const others = layoutCards(s)
    .filter((c) => c.id !== gid && c.groupId !== gid)
    .map((c) => ({ id: c.id, x: c.x, y: c.y, tx: c.x, ty: c.y, w: cardSize(c).w, h: cardSize(c).h }));
  relax([...nodes, ...others], 50);
  for (const n2 of nodes) {
    cards[n2.id] = { ...cards[n2.id], place: 'canvas', x: n2.x, y: n2.y, depth: g.depth, groupOffset: n2.off };
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
    // いまの並びを覚えてから畳む（次に開いたとき、同じ並びで出てくる）
    const c = cards[m];
    const off = c.place === 'canvas' ? { x: c.x - g.x, y: c.y - g.y } : c.groupOffset;
    cards[m] = { ...c, place: 'hidden', x: g.x, y: g.y, groupOffset: off };
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
    cards[id] = {
      ...cards[id],
      place: g.expanded ? 'canvas' : 'hidden',
      groupId: gid,
      // 開いているグループへ入れたなら、置いた場所をそのまま中での場所にする
      groupOffset: g.expanded ? { x: cards[id].x - g.x, y: cards[id].y - g.y } : undefined,
      log: [...cards[id].log, { at: now(), code: 'bundledInto', params: { title: g.title } }],
    };
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

/** グループから外して、独立したカードに戻す（その場所に残る）。空になったグループは消える */
export function removeFromGroup(ids: string[]) {
  const s = get();
  const out = ids.filter((id) => s.cards[id]?.groupId && s.cards[s.cards[id].groupId!]);
  if (!out.length) return;
  snapshot();
  const cards = { ...s.cards };
  const emptied: string[] = [];
  const titles = new Set<string>();
  for (const id of out) {
    const c = cards[id];
    const g = cards[c.groupId!];
    titles.add(g.title);
    const members = (g.members ?? []).filter((m) => m !== id);
    cards[g.id] = {
      ...g,
      members,
      subtitle: t('group.count', { n: members.length }),
      body: members.map((m) => cards[m]?.title ?? '').join('\n'),
    };
    if (!members.length) emptied.push(g.id);
    cards[id] = {
      ...c,
      place: 'canvas',
      groupId: undefined,
      groupOffset: undefined,
      x: c.place === 'canvas' ? c.x : g.x + 260,
      y: c.place === 'canvas' ? c.y : g.y,
      log: [...c.log, { at: now(), code: 'removedFromGroup', params: { title: g.title } }],
    };
  }
  for (const gid of emptied) {
    delete cards[gid];
    engine.remove(gid);
  }
  set({
    cards,
    relations: s.relations.filter((r) => !(r.type === 'contains' && out.includes(r.to) && s.cards[r.from]?.kind === 'group') && !emptied.includes(r.from) && !emptied.includes(r.to)),
    selection: out,
    primary: out[0],
  });
  markDirty();
  overrideFromPosition(out);
  toast(t('toast.removedFromGroup', { n: out.length, title: [...titles].join('・') }), { action: { label: t('action.undo'), run: () => undo() } });
}

/**
 * 開いているグループの中のカードを動かし終えた。グループから十分に離れたらグループから外し、
 * そうでなければ中での新しい場所として覚える。
 */
export function settleGroupMembers(ids: string[]) {
  const s = get();
  const leaving: string[] = [];
  const cards = { ...s.cards };
  let changed = false;
  for (const id of ids) {
    const c = s.cards[id];
    const g = c?.groupId ? s.cards[c.groupId] : undefined;
    if (!c || !g?.expanded || c.place !== 'canvas') continue;
    // 仲間のうち一番遠いものより、さらに一回り外へ出したら「外へ出した」とみなす
    const reach = Math.max(
      0,
      ...(g.members ?? []).filter((m) => m !== id && !ids.includes(m)).map((m) => Math.hypot(s.cards[m]?.groupOffset?.x ?? 0, s.cards[m]?.groupOffset?.y ?? 0)),
    );
    const dist = Math.hypot(c.x - g.x, c.y - g.y);
    if (dist > Math.max(460, reach + 240)) leaving.push(id);
    else {
      cards[id] = { ...c, groupOffset: { x: c.x - g.x, y: c.y - g.y } };
      changed = true;
    }
  }
  if (changed) set({ cards });
  if (leaving.length) removeFromGroup(leaving);
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
/**
 * AI や抽出で生まれたカードは、親のすぐ横にまとめて置き、その場所から動かさない
 * （意味の位置へは移さない）。いくつ生まれたかが一目で分かることを優先する。
 */
export function spawnDrafts(sourceId: string, drafts: Draft[]): string[] {
  const s = get();
  const src = s.cards[sourceId];
  if (!src || !drafts.length) return [];
  snapshot();
  const cards = { ...s.cards };
  const ids: string[] = [];
  const spots = childSpots(src, drafts, canvasCards(s));
  const nodes = drafts.map((d, i) => {
    const { x, y } = spots[i];
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
  // 置いた場所を「この軸での位置」として覚える。意味配置はもう動かさない
  overrideFromPosition(ids, { relayout: false, log: false });
  relayout({ stagger: true, mode: 'soft' });
  return ids;
}

export function extractText(sourceId: string, text: string, kind: CardKind = 'quote') {
  const src = lookup(sourceId);
  const body = text.trim();
  if (!src || !body) return undefined;
  const title = body.length > 42 ? `${body.slice(0, 42)}…` : body;
  const [id] = spawnDrafts(sourceId, [{ kind, title, body, tags: [], relation: 'derived' }]);
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
  const [id] = spawnDrafts(first, [{ kind: 'summary', title: t('card.summaryTitle', { title }), body, tags: [], relation: 'derived' }]);
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

export function updateRelation(id: string, patch: Partial<Pick<Relation, 'type' | 'label' | 'from' | 'to' | 'judged'>>, opts: { undoable?: boolean } = {}) {
  if (opts.undoable !== false) snapshot();
  set((s) => ({ relations: s.relations.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  markDirty();
}

/** 人が言葉を選ぶ。判断モデルの確信度はもう当てはまらないので消す */
export function chooseRelationWord(id: string, type: RelationType) {
  updateRelation(id, { type, judged: undefined });
}

/** 向きを入れ替える（「A だから B」を「B だから A」に） */
export function flipRelation(id: string) {
  const r = get().relations.find((x) => x.id === id);
  if (r) updateRelation(id, { from: r.to, to: r.from, judged: undefined });
}

// ── 言葉のセットと自分の言葉 ─────────────────────────────
export function setVocabulary(vocabulary: VocabularyId) {
  if (get().readOnly) return;
  set({ vocabulary });
  markDirty();
}

export function addRelationWord(word: Omit<RelationWord, 'id'>) {
  if (get().readOnly || !word.label.trim()) return undefined;
  const id = `${CUSTOM_PREFIX}${newId('w')}`;
  set((s) => ({ relationWords: [...s.relationWords, { ...word, id, label: word.label.trim(), back: word.back?.trim() || undefined, meaning: word.meaning.trim() }].slice(-12) }));
  markDirty();
  return id;
}

/** 自分の言葉を消す。その言葉で引いた線は「言葉なし」に戻す */
export function removeRelationWord(id: string) {
  snapshot();
  set((s) => ({
    relationWords: s.relationWords.filter((w) => w.id !== id),
    relations: s.relations.map((r) => (r.type === id ? { ...r, type: 'related', judged: undefined } : r)),
  }));
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
  if (decideEnabled()) {
    // 種類の判定は判断モデルへ。「どれでもない」も選べるので、近いだけの組はここで落ちる
    try {
      const judged = await judgeRelations(top.map((c) => [c.a, c.b] as [string, string]));
      if (judged.length) suggestions = judged;
    } catch {
      // 判断モデルが使えなければ、近さだけの提案のまま続ける
    }
  } else if (useAi) {
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
  // 種別とタグは判断モデルに見立ててもらう（届いたら静かに直る）
  void classifyNewCards(ids);
  return ids;
}

import type { Axes, AxisKey, Card } from '../types';
import { SPACE, axisSlotKey, cardSize, computeScores, depthScale, project, relax, unproject } from '../lib/semantic';
import { engine, type MotionMode } from '../lib/physics';
import { subscribeEmbeddings } from '../lib/embeddings';
import { subscribeAxisScores } from '../lib/axisScores';
import { t } from '../i18n';
import { AXIS_KEYS, addLog, get, layoutCards, lookup, markDirty, newId, now, set, snapshot, toast } from './core';
import { closeWindowsOfType, openWindowAtScreen, windowScreenPos } from './ui';

export const AXIS_NAME = (k: AxisKey) => t(`axis.${k}` as 'axis.x');

// 軸カードが収まる「ドック」のワールド座標（軸の先端）
const zlen = Math.hypot(SPACE.ZX, SPACE.ZY);
/** Z軸の高い側（奥）へ向かう単位ベクトル。右上 */
export const Z_UNIT = { x: SPACE.ZX / zlen, y: -SPACE.ZY / zlen };
// X は箱の下端、Y は箱の左端に寄せる（第一象限のような見え方）
export const DOCK: Record<AxisKey, { x: number; y: number }> = {
  x: { x: SPACE.W / 2 + 200, y: SPACE.H / 2 },
  y: { x: -SPACE.W / 2, y: -SPACE.H / 2 - 150 },
  z: { x: Z_UNIT.x * 900, y: Z_UNIT.y * 900 },
};

// ── 再配置（意味軸） ───────────────────────────────────────
export function relayout(opts: { stagger?: boolean; mode?: MotionMode } = {}) {
  const s = get();
  const cards = layoutCards(s);
  const scores = computeScores(cards, s.axes, lookup);
  const next = { ...s.cards };
  for (const k of AXIS_KEYS) {
    const a = next[s.axes[k]];
    if (a) next[a.id] = { ...a, place: 'canvas', x: DOCK[k].x, y: DOCK[k].y, depth: 0.38 };
  }
  const editingId = s.editingCardId;
  // 新しい文章の意味（埋め込み）がまだ届いていないと、そろわない間は全体が簡易ベクトルに落ちる。
  // そこで並べ直すと、関係のないカードまで一斉に飛んで、届いた瞬間にまた戻る。
  // その間は今ある場所に留め、届いてから（subscribeEmbeddings が呼び直す）動かす。
  const waiting = scores.source === 'local' && s.scoreSource === 'server';
  const nodes = cards.map((c) => {
    const v = scores.values.get(c.id)!;
    const p = project(v.sx, v.sy, v.sz);
    const size = cardSize(c);
    const k = depthScale(v.sz);
    // 編集中のカードは、書いている場所から動かさない（終わったら意味の位置へ）
    if (c.id === editingId || waiting) return { id: c.id, x: c.x, y: c.y, tx: c.x, ty: c.y, w: size.w * k, h: size.h * k, depth: c.depth, fixed: true };
    // 手で置いたカードは置いた場所のまま。周りのカードのほうが避ける
    return { id: c.id, x: p.x, y: p.y, tx: p.x, ty: p.y, w: size.w * k, h: size.h * k, depth: v.sz, fixed: handPlaced(c, s.axes) };
  });
  const obstacles = AXIS_KEYS.map((k) => ({ x: DOCK[k].x, y: DOCK[k].y, tx: DOCK[k].x, ty: DOCK[k].y, w: 260, h: 124, fixed: true }));
  relax([...nodes, ...obstacles], 110);
  for (const n of nodes) next[n.id] = { ...next[n.id], x: n.x, y: n.y, depth: n.depth };
  set({ cards: next, scoreSource: waiting ? 'server' : scores.source });

  // 動く距離が短いものから順に動かす（伸びていく感覚）
  const ids = [...nodes.map((n) => n.id), ...AXIS_KEYS.map((k) => s.axes[k]).filter((id) => next[id])];
  const moved = ids
    .map((id) => {
      const b = engine.get(id);
      const c = next[id];
      return { id, d: b ? Math.hypot(b.x - c.x, b.y - c.y) : 0 };
    })
    .sort((a, b) => a.d - b.d);
  const mode = opts.mode ?? 'layout';
  const step = opts.stagger === false ? 0 : Math.max(4, Math.min(22, 600 / Math.max(1, moved.length)));
  moved.forEach(({ id }, i) => {
    const c = next[id];
    engine.setTarget(id, c.x, c.y, depthScale(c.depth), mode, i * step);
  });
}

let embedTimer = 0;
subscribeEmbeddings(() => {
  // 埋め込みが届いたら、意味の位置へ組み替える
  window.clearTimeout(embedTimer);
  embedTimer = window.setTimeout(() => {
    if (!get().ready) return;
    const before = get().scoreSource;
    relayout({ stagger: true, mode: 'layout' });
    if (before === 'local' && get().scoreSource === 'server' && layoutCards().length > 1) toast(t('toast.semanticReady'));
  }, 180);
});

let scoreTimer = 0;
subscribeAxisScores(() => {
  // 判断モデルの採点が届いた。手で置いたカードはそのまま、残りが本来の位置へ移る
  window.clearTimeout(scoreTimer);
  scoreTimer = window.setTimeout(() => {
    if (get().ready) relayout({ stagger: false, mode: 'soft' });
  }, 220);
});

export function applyAxes(axes: Axes, reason?: string) {
  const s = get();
  const changed = AXIS_KEYS.filter((k) => s.axes[k] !== axes[k]);
  if (!changed.length) return;
  snapshot();
  const next = { ...s.cards };
  const newAxisIds = AXIS_KEYS.map((k) => axes[k]);
  // 外れた軸カード：概念カードはライブラリへ、通常カードは空間へ戻る
  for (const k of AXIS_KEYS) {
    const id = s.axes[k];
    if (newAxisIds.includes(id)) continue;
    const c = next[id];
    if (c) next[id] = { ...c, place: c.kind === 'concept' ? 'library' : 'canvas' };
  }
  let relations = s.relations.filter((r) => !(r.type === 'axis-of' && !newAxisIds.includes(r.from)));
  for (const k of changed) {
    const c = next[axes[k]];
    if (!c) continue;
    if (c.place !== 'canvas') engine.place(c.id, DOCK[k].x, DOCK[k].y, 0.3);
    next[c.id] = { ...c, place: 'canvas', log: [...c.log, { at: now(), code: 'axis', params: { axis: k.toUpperCase() } }] };
    relations = relations.filter((r) => !(r.type === 'axis-of' && r.from === c.id));
  }
  set({
    cards: next,
    relations,
    axes,
    draftAxes: null,
    trail: [...s.trail, { id: newId('t'), axes, at: now() }].slice(-16),
    clusters: null,
  });
  markDirty();
  closeWindowsOfType('preview');
  relayout();
  toast(
    reason ??
      t('toast.axesChanged', {
        list: changed.map((k) => `${AXIS_NAME(k)}=${lookup(axes[k])?.title ?? ''}`).join(', '),
      }),
  );
}

export function setAxis(key: AxisKey, cardId: string, immediate: boolean) {
  const s = get();
  const base = s.draftAxes ?? s.axes;
  const cur = { ...base };
  const other = AXIS_KEYS.find((k) => k !== key && cur[k] === cardId);
  if (other) cur[other] = cur[key]; // 既に別の軸なら入れ替え
  cur[key] = cardId;
  if (immediate || !s.previewFirst) return applyAxes(cur);
  set({ draftAxes: cur });
  ensurePreviewWindow();
}

export function setDraftAxes(axes: Axes) {
  const s = get();
  if (AXIS_KEYS.every((k) => s.axes[k] === axes[k])) {
    set({ draftAxes: null });
    return;
  }
  if (!s.previewFirst) return applyAxes(axes);
  set({ draftAxes: axes });
  ensurePreviewWindow();
}

function ensurePreviewWindow() {
  const s = get();
  if (s.windows.some((w) => w.type === 'preview')) return;
  const axisWin = s.windows.find((w) => w.type === 'axis');
  const pos = axisWin ? windowScreenPos(axisWin) : { x: s.viewport.w - 760, y: 90 };
  openWindowAtScreen('preview', [], { x: pos.x - 440, y: pos.y + 40 }, 420);
}

// ── 人による上書き ─────────────────────────────────────────
/** 人が X と Y の両方を決めたカード。意味配置はもう動かさない */
export function handPlaced(card: Card, axes: Axes) {
  const o = card.overrides;
  return Boolean(o && o[axisSlotKey(axes, 'x')] !== undefined && o[axisSlotKey(axes, 'y')] !== undefined);
}

/** ドラッグで置いた位置と奥行きを、いまの軸での値として記録する */
export function overrideFromPosition(ids: string[]) {
  const s = get();
  const cards = { ...s.cards };
  let changed = false;
  for (const id of ids) {
    const c = cards[id];
    if (!c || c.place !== 'canvas' || AXIS_KEYS.some((k) => s.axes[k] === id)) continue;
    const { sx, sy } = unproject(c.x, c.y, c.depth);
    cards[id] = {
      ...c,
      overrides: {
        ...(c.overrides ?? {}),
        [axisSlotKey(s.axes, 'x')]: round(sx),
        [axisSlotKey(s.axes, 'y')]: round(sy),
        [axisSlotKey(s.axes, 'z')]: round(c.depth),
      },
      log: [...c.log, { at: now(), code: 'moved', params: { x: lookup(s.axes.x)?.title ?? '', y: lookup(s.axes.y)?.title ?? '' } }].slice(-40),
    };
    changed = true;
  }
  if (!changed) return;
  set({ cards });
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
}

/** 詳細ウィンドウのスライダーから、特定の軸での値を直接設定する */
export function setOverrideValue(cardId: string, axisId: string, value: number | null, record = true) {
  const c = lookup(cardId);
  if (!c) return;
  if (record) snapshot();
  const overrides = { ...(c.overrides ?? {}) };
  if (value === null) delete overrides[axisId];
  else overrides[axisId] = round(value);
  set((s) => ({ cards: { ...s.cards, [cardId]: { ...c, overrides } } }));
  markDirty();
  relayout({ stagger: false, mode: 'soft' });
}

export function clearOverrides(cardId: string) {
  const c = lookup(cardId);
  if (!c?.overrides) return;
  snapshot();
  set((s) => ({ cards: { ...s.cards, [cardId]: { ...c, overrides: undefined } } }));
  addLog(cardId, 'overrideCleared');
  relayout({ stagger: false, mode: 'soft' });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ── 概念（軸）カード ─────────────────────────────────────────
export function createConcept(label: string, low: string, high: string, description = ''): Card {
  const id = newId('c');
  const card: Card = {
    id,
    kind: 'concept',
    title: label.trim(),
    body: description.trim(),
    tags: [],
    axisEnds: [low.trim() || t('axis.low'), high.trim() || t('axis.high')],
    x: 0,
    y: 0,
    depth: 0.5,
    place: 'library',
    log: [{ at: now(), code: 'created' }],
    createdBy: 'user',
    createdAt: now(),
    updatedAt: now(),
  };
  set((s) => ({ cards: { ...s.cards, [id]: card } }));
  markDirty();
  return card;
}

export function deleteConcept(id: string) {
  const s = get();
  if (AXIS_KEYS.some((k) => s.axes[k] === id)) return false;
  const cards = { ...s.cards };
  delete cards[id];
  // 他カードに残った、この軸での上書き値も消す
  for (const c of Object.values(cards)) {
    if (c.overrides?.[id] !== undefined) {
      const o = { ...c.overrides };
      delete o[id];
      cards[c.id] = { ...c, overrides: Object.keys(o).length ? o : undefined };
    }
  }
  set({ cards });
  markDirty();
  return true;
}

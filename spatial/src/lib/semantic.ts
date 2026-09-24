import type { Axes, AxisKey, Card, Cluster } from '../types';
import { cosine, resolveVectors } from './embeddings';
import { axisScore, requestAxisScore, type AxisDefinition } from './axisScores';
import { decideEnabled } from './decide';

// ── 意味空間の幾何（ワールド座標） ───────────────────────────
export const SPACE = {
  W: 1320, // X軸の長さ
  H: 740, // Y軸の長さ
  ZX: 25, // Z軸の方向（右上 = 奥）。ずれはごく控えめで、遠さは主に大きさで表す
  ZY: 15,
};

/** 奥行き（0=手前, 1=奥）による画面上のずれ。奥へ離れるほど右上へ寄る */
export function zOffset(depth: number) {
  const away = depth - 0.5;
  return { x: away * SPACE.ZX, y: -away * SPACE.ZY };
}

/** 手で置ける広さ。意味の箱（0..1）よりずっと外まで置いてよい */
const MANUAL_LOW = -2;
const MANUAL_HIGH = 3;

export const AXIS_KEYS: AxisKey[] = ['x', 'y', 'z'];

export function project(sx: number, sy: number, sz: number) {
  const o = zOffset(sz);
  return {
    x: (sx - 0.5) * SPACE.W + o.x,
    y: -(sy - 0.5) * SPACE.H + o.y,
  };
}

/** ワールド座標と奥行きから、X/Y 軸上の正規化値を逆算する（ドラッグによる上書き用） */
export function unproject(x: number, y: number, sz: number) {
  const o = zOffset(sz);
  const clamp = (v: number) => Math.max(MANUAL_LOW, Math.min(MANUAL_HIGH, v));
  return {
    sx: clamp((x - o.x) / SPACE.W + 0.5),
    sy: clamp(-(y - o.y) / SPACE.H + 0.5),
  };
}

/** 奥ほど小さく、手前ほど大きい（d は 0=手前 … 1=奥） */
export const depthScale = (d: number) => Math.max(0.4, Math.min(1.4, 1.18 - 0.46 * d));

/** Shift ドラッグで動かせる奥行きの範囲 */
export const DEPTH_LOW = -0.8;
export const DEPTH_HIGH = 1.8;

export function cardSize(card: Card): { w: number; h: number } {
  if (card.kind === 'topic') return { w: 250, h: 204 };
  if (card.kind === 'concept') return { w: 186, h: 72 };
  if (card.image || card.kind === 'image') return { w: 220, h: 156 };
  if (card.kind === 'idea' && card.visual) return { w: 230, h: 134 };
  if (card.kind === 'group') return { w: 224, h: 112 };
  if (card.kind === 'person') return { w: 214, h: 88 };
  return { w: 226, h: 96 };
}

// ── 埋め込みに渡す文章 ───────────────────────────────────
export function cardText(card: Card) {
  return frozenText.get(card.id) ?? liveText(card);
}

function liveText(card: Card) {
  return [card.title, card.subtitle, card.body, card.tags.join(' ')].filter(Boolean).join('\n');
}

// 文字を打っている間は、打ちかけの文章で意味を計算しない（埋め込みも採点も頼まない）。
// 書き始める前の文章のまま扱い、書き終えたら新しい文章で計算する。
const frozenText = new Map<string, string>();

export function freezeCardText(card: Card) {
  if (!frozenText.has(card.id)) frozenText.set(card.id, liveText(card));
}

/** 書き終えた。文章が変わっていれば true */
export function thawCardText(card: Card) {
  const before = frozenText.get(card.id);
  frozenText.delete(card.id);
  return before !== undefined && before !== liveText(card);
}

/** 概念（軸）カードの両極の文章。axisPoles が無ければラベルと両端語から作る */
export function poleTexts(axis: Card): [string, string] {
  const [lo, hi] = axis.axisEnds ?? ['low', 'high'];
  if (axis.axisPoles) return [`${axis.title}: ${lo}. ${axis.axisPoles[0]}`, `${axis.title}: ${hi}. ${axis.axisPoles[1]}`];
  const desc = axis.body ? ` ${axis.body}` : '';
  return [`${axis.title}: ${lo}.${desc}`, `${axis.title}: ${hi}.${desc}`];
}

/** 判断モデルに渡す軸の説明。概念カードなら両極、ふつうのカードなら「その主題への近さ」 */
export function axisDefinition(axes: Axes, k: AxisKey, axis: Card | undefined): AxisDefinition | null {
  if (!axis) return null;
  const slot = axisSlotKey(axes, k);
  if (axis.kind !== 'concept') return { slot, label: axis.title, low: '', high: '', similarity: true };
  const [low, high] = axis.axisEnds ?? ['low', 'high'];
  return { slot, label: axis.title, low: low || 'low', high: high || 'high', similarity: false };
}

export function axisEnds(axis: Card | undefined): [string, string] {
  if (!axis) return ['', ''];
  if (axis.axisEnds) return axis.axisEnds;
  return ['', ''];
}

// ── 軸スコア ─────────────────────────────────────────────
export interface ScoreSet {
  /** カードID → 軸キー → 正規化済みの値 0..1 */
  values: Map<string, { sx: number; sy: number; sz: number }>;
  source: 'server' | 'local';
}

/**
 * 各軸について生スコアを求め、カード集合の中で 0.04..0.96 に広げる。
 * 人が上書きした値（card.overrides[軸ID]）はその軸で最優先する。
 */
/** 軸が外れている（意味を持たせていない）スロットの上書き値もスロットごとに覚える */
export function axisSlotKey(axes: Axes, k: AxisKey) {
  return axes[k] || `none:${k}`;
}

export function computeScores(cards: Card[], axes: Axes, lookup: (id: string) => Card | undefined): ScoreSet {
  const texts: string[] = cards.map(cardText);
  const axisSlots: Record<AxisKey, { kind: 'concept' | 'card' | 'none'; idx: number[] }> = {
    x: { kind: 'none', idx: [] },
    y: { kind: 'none', idx: [] },
    z: { kind: 'none', idx: [] },
  };
  for (const k of AXIS_KEYS) {
    const a = lookup(axes[k]);
    if (!a) continue;
    if (a.kind === 'concept') {
      const [lo, hi] = poleTexts(a);
      axisSlots[k] = { kind: 'concept', idx: [texts.push(lo) - 1, texts.push(hi) - 1] };
    } else {
      axisSlots[k] = { kind: 'card', idx: [texts.push(cardText(a)) - 1] };
    }
  }
  const { vectors, source } = resolveVectors(texts);
  const raw: Record<AxisKey, number[]> = { x: [], y: [], z: [] };
  for (const k of AXIS_KEYS) {
    const slot = axisSlots[k];
    raw[k] = cards.map((_, i) => {
      if (slot.kind === 'concept') return cosine(vectors[i], vectors[slot.idx[1]]) - cosine(vectors[i], vectors[slot.idx[0]]);
      if (slot.kind === 'card') return cosine(vectors[i], vectors[slot.idx[0]]);
      return 0;
    });
  }
  const norm: Record<AxisKey, number[]> = { x: [], y: [], z: [] };
  const askDecider = decideEnabled();
  for (const k of AXIS_KEYS) {
    const axisId = axisSlotKey(axes, k);
    const definition = axisDefinition(axes, k, lookup(axes[k]));
    // 上書きの無いカードだけで幅を決める
    const free = raw[k].filter((_, i) => cards[i].overrides?.[axisId] === undefined);
    const min = free.length ? Math.min(...free) : 0;
    const max = free.length ? Math.max(...free) : 1;
    const mid = (min + max) / 2;
    const range = Math.max(max - min, 1e-6);
    norm[k] = raw[k].map((s, i) => {
      const o = cards[i].overrides?.[axisId];
      if (o !== undefined) return o; // 人が置いた場所が最優先
      if (definition) {
        // 判断モデルの採点は軸に対する絶対位置なので、そのまま使う
        const judged = axisScore(axisId, texts[i]);
        if (judged !== undefined) return judged;
        if (askDecider) requestAxisScore(definition, cards[i], texts[i]);
      }
      if (free.length < 2) return 0.5;
      return 0.5 + ((s - mid) / range) * 0.92;
    });
  }
  const values = new Map<string, { sx: number; sy: number; sz: number }>();
  cards.forEach((c, i) => values.set(c.id, { sx: norm.x[i], sy: norm.y[i], sz: norm.z[i] }));
  return { values, source };
}

export interface Placement {
  x: number;
  y: number;
  depth: number;
}

interface RelaxNode {
  x: number;
  y: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** 奥行き。離れていれば重なってよい（両方に値があるときだけ見る） */
  depth?: number;
  /** 動かない障害物（軸ドック、手で置いたカード） */
  fixed?: boolean;
}

/** これ以上 Z が離れていたら、重なってよい（そのための Z 軸） */
const DEPTH_APART = 0.16;
/** ただし完全に隠れると触れなくなるので、この割合までは押しのける */
const DEPTH_OVERLAP = 0.55;

/** 矩形の重なりを押し出しで解消しつつ、意味上の目標位置に弱く引き戻す */
export function relax(nodes: RelaxNode[], iterations = 140, gap = 16) {
  const n = nodes.length;
  const iters = n > 200 ? Math.min(iterations, 50) : n > 100 ? Math.min(iterations, 90) : iterations;
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.fixed && b.fixed) continue;
        const far = a.depth !== undefined && b.depth !== undefined && Math.abs(a.depth - b.depth) > DEPTH_APART;
        const room = far ? DEPTH_OVERLAP : 1;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = ((a.w + b.w) / 2 + gap) * room - Math.abs(dx);
        if (ox <= 0) continue;
        const oy = ((a.h + b.h) / 2 + gap) * room - Math.abs(dy);
        if (oy <= 0) continue;
        moved = true;
        const wa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const wb = 1 - wa;
        if (ox / (a.w + b.w) < oy / (a.h + b.h)) {
          const push = ox * (dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx)) * 0.5;
          a.x -= push * wa;
          b.x += push * wb;
        } else {
          const push = oy * (dy === 0 ? (j % 2 ? 1 : -1) : Math.sign(dy)) * 0.5;
          a.y -= push * wa;
          b.y += push * wb;
        }
      }
    }
    for (const node of nodes) {
      if (node.fixed) continue;
      node.x += (node.tx - node.x) * 0.03;
      node.y += (node.ty - node.y) * 0.03;
    }
    if (!moved && it > 20) break;
  }
}

// ── 近さ・クラスタ ─────────────────────────────────────────
export function cardVectors(cards: Card[]) {
  return resolveVectors(cards.map(cardText));
}

export function similarityMatrix(cards: Card[]) {
  const { vectors } = cardVectors(cards);
  return (i: number, j: number) => cosine(vectors[i], vectors[j]);
}

const HUES = [196, 152, 280, 32, 340];

/** 埋め込みベクトルで k-means（最遠点法で決定的に初期化） */
export function clusterCards(cards: Card[], k = 3): Omit<Cluster, 'label'>[] {
  if (cards.length < k) return [];
  const { vectors } = cardVectors(cards);
  const dist = (a: Float32Array, b: Float32Array) => 1 - cosine(a, b);
  const cents: Float32Array[] = [vectors[0]];
  while (cents.length < k) {
    let best = 0;
    let bestD = -1;
    vectors.forEach((v, i) => {
      const d = Math.min(...cents.map((c) => dist(v, c)));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    });
    cents.push(vectors[best]);
  }
  let assign = new Array(vectors.length).fill(0);
  for (let it = 0; it < 15; it++) {
    assign = vectors.map((v) => {
      let bi = 0;
      cents.forEach((c, ci) => {
        if (dist(v, c) < dist(v, cents[bi])) bi = ci;
      });
      return bi;
    });
    for (let ci = 0; ci < k; ci++) {
      const m = vectors.filter((_, i) => assign[i] === ci);
      if (!m.length) continue;
      const c = new Float32Array(m[0].length);
      for (const v of m) for (let d = 0; d < c.length; d++) c[d] += v[d];
      let s = 0;
      for (let d = 0; d < c.length; d++) s += c[d] * c[d];
      const nrm = Math.sqrt(s) || 1;
      for (let d = 0; d < c.length; d++) c[d] /= nrm;
      cents[ci] = c;
    }
  }
  return cents
    .map((_, ci) => ({ id: `cl-${ci}`, cardIds: cards.filter((__, i) => assign[i] === ci).map((c) => c.id), hue: HUES[ci % HUES.length] }))
    .filter((c) => c.cardIds.length > 0);
}

/** クラスタの仮の名前：メンバーに共通するタグ、無ければ代表カードの題名 */
export function fallbackClusterLabel(cards: Card[]) {
  const counts = new Map<string, number>();
  for (const c of cards) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t.replace(/^#/, ''));
  if (top.length) return top.join(' · ');
  return cards[0]?.title.slice(0, 16) ?? '';
}

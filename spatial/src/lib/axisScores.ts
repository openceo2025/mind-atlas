// 意味軸の採点を、判断モデル（System One）に頼む。
//
// 埋め込みのコサインは「カード集合の中での相対位置」しか出せないので、カードが増えると
// 全体がじわっと動く。判断モデルの score は軸そのものに対する絶対位置（0..1）を返すため、
// 1枚足しても他のカードは動かない。答えが届くまでは従来のコサインで表示し、届いたら
// 購読者（再配置）に知らせて差し替える。仕組みは embeddings.ts と同じ形にしてある。
import { askDecisions, pickScore, score } from './decide';
import { normalizeText, textHash } from './embeddings';
import { idbGetMany, idbSetMany } from './idb';
import type { Card } from '../types';

/** 低い側から高い側への段階。5段階だと「やや」まで表せる */
const LEVELS = 5;
const CARDS_PER_CALL = 10;
const MAX_TEXT = 400;

export interface AxisDefinition {
  /** 上書き値と同じスロットの鍵（軸カードのID、または none:x） */
  slot: string;
  label: string;
  low: string;
  high: string;
  /** 軸が概念カードでないとき（ふつうのカードを軸にした）は「近さ」を聞く */
  similarity: boolean;
}

type Listener = () => void;

const cache = new Map<string, { value: number; confidence: number }>();
const asked = new Set<string>();
const loaded = new Set<string>();
const pending = new Map<string, { text: string; slots: Set<string> }>();
const definitions = new Map<string, AxisDefinition>();
const listeners = new Set<Listener>();
let timer = 0;
let running = false;

const key = (slot: string, hash: string) => `${slot}::${hash}`;

export function subscribeAxisScores(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 採点済みならその値（0..1）。無ければ undefined（呼び出し側はコサインへ落ちる） */
export function axisScore(slot: string, text: string) {
  return cache.get(key(slot, textHash(normalizeText(text).slice(0, MAX_TEXT))))?.value;
}

export function axisScoreStatus() {
  return { scored: cache.size, pending: pending.size };
}

/**
 * 採点は「その軸カード × その文章」に紐づくので、空間を開き直しても捨てない
 * （クラウドから同じ空間を読み直すたびに聞き直すのは、ただの無駄）。
 * 覚えすぎたときだけ、まとめて忘れる。
 */
const MAX_CACHED = 4000;

export function clearAxisScores() {
  cache.clear();
  asked.clear();
  pending.clear();
  definitions.clear();
}

function remember(id: string, value: { value: number; confidence: number }) {
  if (cache.size >= MAX_CACHED) {
    cache.clear();
    asked.clear();
  }
  cache.set(id, value);
}

/** 前回までの採点を端末から戻す（読み込み直すたびに聞き直さないため） */
async function recall(ids: string[]) {
  const need = ids.filter((id) => !loaded.has(id));
  if (!need.length) return;
  need.forEach((id) => loaded.add(id));
  const rows = await idbGetMany<{ value: number; confidence: number }>('axisScores', need);
  let found = 0;
  rows.forEach((row, i) => {
    if (typeof row?.value !== 'number' || cache.has(need[i])) return;
    cache.set(need[i], row);
    found += 1;
  });
  if (found) listeners.forEach((l) => l());
}

/** この軸でのこのカードの位置を、あとで聞く */
export function requestAxisScore(definition: AxisDefinition, card: Card, text: string) {
  const body = normalizeText(text).slice(0, MAX_TEXT);
  if (!body) return;
  const hash = textHash(body);
  const id = key(definition.slot, hash);
  if (cache.has(id) || asked.has(id)) return;
  definitions.set(definition.slot, definition);
  const entry = pending.get(hash) ?? { text: `${card.title}\n${body}`.slice(0, MAX_TEXT), slots: new Set<string>() };
  entry.slots.add(definition.slot);
  pending.set(hash, entry);
  if (!timer) timer = window.setTimeout(() => void flush(), 200);
}

function levelsFor(definition: AxisDefinition) {
  if (definition.similarity) {
    return [
      `not related to "${definition.label}" at all`,
      `only slightly related to "${definition.label}"`,
      `related to "${definition.label}"`,
      `closely related to "${definition.label}"`,
      `the very same subject as "${definition.label}"`,
    ];
  }
  const { low, high, label } = definition;
  return [
    `clearly ${low} on "${label}"`,
    `somewhat ${low} on "${label}"`,
    `neither ${low} nor ${high} on "${label}"`,
    `somewhat ${high} on "${label}"`,
    `clearly ${high} on "${label}"`,
  ];
}

async function flush() {
  timer = 0;
  if (running) return;
  running = true;
  try {
    // まず端末に残っている採点を戻す。それで足りればリクエストは起きない
    await recall([...pending.entries()].flatMap(([hash, entry]) => [...entry.slots].map((slot) => key(slot, hash))));
    for (const [hash, entry] of [...pending.entries()]) {
      for (const slot of [...entry.slots]) if (cache.has(key(slot, hash))) entry.slots.delete(slot);
      if (!entry.slots.size) pending.delete(hash);
    }
    while (pending.size) {
      const batch = [...pending.entries()].slice(0, CARDS_PER_CALL);
      batch.forEach(([hash]) => pending.delete(hash));
      const slots = [...new Set(batch.flatMap(([, entry]) => [...entry.slots]))].filter((slot) => definitions.has(slot));
      if (!slots.length) continue;
      const state = {
        axes: slots.map((slot) => {
          const d = definitions.get(slot)!;
          return d.similarity ? { axis: d.label, meaning: 'how close the card is to this subject' } : { axis: d.label, low: d.low, high: d.high };
        }),
        cards: batch.map(([, entry], i) => ({ card: i + 1, text: entry.text })),
      };
      const questions: Record<string, ReturnType<typeof score>> = {};
      const map: { name: string; hash: string; slot: string }[] = [];
      batch.forEach(([hash, entry], i) => {
        for (const slot of entry.slots) {
          const definition = definitions.get(slot);
          if (!definition) continue;
          const name = `c${i + 1}_${slots.indexOf(slot)}`;
          questions[name] = score(`Judge card ${i + 1} on the axis "${definition.label}" only. Ignore every other axis.`, levelsFor(definition));
          map.push({ name, hash, slot });
          asked.add(key(slot, hash));
        }
      });
      if (!map.length) continue;
      const answers = await askDecisions('axis-scores', state, questions);
      let landed = 0;
      const rows: [string, unknown][] = [];
      for (const item of map) {
        const value = pickScore(answers[item.name], LEVELS);
        if (!value) {
          // 答えが来なかったものは、次の再配置でもう一度聞けるようにしておく
          asked.delete(key(item.slot, item.hash));
          continue;
        }
        const id = key(item.slot, item.hash);
        remember(id, value);
        rows.push([id, value]);
        landed += 1;
      }
      if (rows.length) void idbSetMany('axisScores', rows);
      if (landed) listeners.forEach((l) => l());
      if (!landed) break;
    }
  } finally {
    running = false;
  }
}

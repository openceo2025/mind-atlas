// 文章 → 意味ベクトル。
// 1) サーバーの埋め込み（多言語モデル）を使い、端末内（メモリ＋IndexedDB）にキャッシュする。
// 2) サーバーに届かない・まだ届いていない間は、文字 n-gram を畳み込んだ簡易ベクトルで即座に配置する。
// 同じ配置計算の中で2種類のベクトルを混ぜない（尺度が違うため）。
import { fetchEmbeddings } from './service';
import { idbGetMany, idbSetMany } from './idb';

export const LOCAL_DIMS = 256;
const BATCH = 64;
const MAX_CHARS = 1200;

type Listener = () => void;

const serverCache = new Map<string, Float32Array>();
const localCache = new Map<string, Float32Array>();
const pending = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<Listener>();
let serverModel = '';
let serverDownUntil = 0;
let timer = 0;
let persistedLoaded = new Set<string>();

export function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

/** FNV-1a を2系統回した 64bit 相当のハッシュ（キャッシュキー用） */
export function textHash(text: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** 文字 1〜3-gram をハッシュで 256 次元に畳み込む。言語を問わず動く代替ベクトル */
export function localVector(text: string): Float32Array {
  const norm = normalizeText(text).toLowerCase();
  const key = textHash(norm);
  const hit = localCache.get(key);
  if (hit) return hit;
  const v = new Float32Array(LOCAL_DIMS);
  const chars = [...norm];
  for (let n = 1; n <= 3; n++) {
    const w = n === 1 ? 0.3 : n === 2 ? 1 : 0.7;
    for (let i = 0; i + n <= chars.length; i++) {
      const g = chars.slice(i, i + n).join('');
      if (!g.trim()) continue;
      const h = Number.parseInt(textHash(g).slice(0, 8), 16);
      const sign = h & 1 ? 1 : -1;
      v[h % LOCAL_DIMS] += sign * w;
    }
  }
  normalize(v);
  localCache.set(key, v);
  return v;
}

function normalize(v: Float32Array) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function decode(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return normalize(new Float32Array(bytes.buffer));
}

export function subscribeEmbeddings(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((l) => l());
}

export function embeddingStatus() {
  return {
    model: serverModel,
    serverAvailable: Date.now() >= serverDownUntil,
    pending: pending.size + inflight.size,
    cached: serverCache.size,
  };
}

/**
 * 文章群のベクトルを返す。全てサーバー由来で揃っていればそれを、
 * 1つでも欠ければ全て簡易ベクトルにして返し、欠けた分の取得を予約する。
 */
export function resolveVectors(texts: string[]): { vectors: Float32Array[]; source: 'server' | 'local' } {
  const norms = texts.map(normalizeText);
  const keys = norms.map(textHash);
  const missing: string[] = [];
  const vectors: Float32Array[] = [];
  keys.forEach((k, i) => {
    const v = serverCache.get(k);
    if (v) vectors.push(v);
    else if (norms[i]) missing.push(norms[i]);
  });
  if (!missing.length && vectors.length === texts.length) return { vectors, source: 'server' };
  missing.forEach((m) => request(m));
  return { vectors: norms.map((n) => localVector(n || ' ')), source: 'local' };
}

export function request(text: string) {
  const norm = normalizeText(text);
  if (!norm) return;
  const key = textHash(norm);
  if (serverCache.has(key) || inflight.has(norm)) return;
  pending.add(norm);
  if (!timer) timer = window.setTimeout(flush, 120);
}

async function loadPersisted(texts: string[]) {
  const need = texts.filter((t) => !persistedLoaded.has(t));
  if (!need.length) return;
  need.forEach((t) => persistedLoaded.add(t));
  const keys = need.map((t) => textHash(t));
  const rows = await idbGetMany<{ model: string; b64: string }>('embeddings', keys);
  rows.forEach((row, i) => {
    if (row?.b64) {
      serverModel ||= row.model;
      if (row.model === serverModel) serverCache.set(keys[i], decode(row.b64));
    }
  });
}

async function flush() {
  timer = 0;
  const batch = [...pending];
  pending.clear();
  if (!batch.length) return;
  await loadPersisted(batch);
  const need = batch.filter((t) => !serverCache.has(textHash(t)));
  if (need.length < batch.length) emit();
  if (!need.length) return;
  if (Date.now() < serverDownUntil) return;
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    chunk.forEach((t) => inflight.add(t));
    try {
      const res = await fetchEmbeddings(chunk);
      if (serverModel && res.model !== serverModel) serverCache.clear();
      serverModel = res.model;
      const rows: [string, unknown][] = [];
      res.vectors.forEach((b64, j) => {
        const key = textHash(chunk[j]);
        serverCache.set(key, decode(b64));
        rows.push([key, { model: res.model, b64 }]);
      });
      void idbSetMany('embeddings', rows);
    } catch {
      // サーバー未設定・レート制限など。しばらく簡易ベクトルで続ける
      serverDownUntil = Date.now() + 60_000;
      chunk.forEach((t) => inflight.delete(t));
      emit();
      return;
    }
    chunk.forEach((t) => inflight.delete(t));
  }
  emit();
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

import type { Axes, Card, CardReminder, Relation, RelationWord, Space, SpaceAnchor, SpaceMeta } from '../types';
import { CUSTOM_PREFIX, LEGACY_TYPES, isVocabulary, type VocabularyId } from '../lib/relationCatalog';
import { idbAll, idbDelete, idbGet, idbSet } from '../lib/idb';
import { engine } from '../lib/physics';
import { depthScale } from '../lib/semantic';
import {
  HOSTED,
  deleteCloudSpace,
  fetchSession,
  listCloudSpaces,
  loadCloudSpace,
  loadSharedSpace,
  saveCloudSpace,
  shareCloudSpace,
} from '../lib/service';
import { t } from '../i18n';
import { AXIS_PRESETS, defaultConcepts, makeConceptCard, type ConceptKey } from '../data/concepts';
import { buildDemoSpace } from '../data/demo';
import { get, newId, now, set, toast, toastError, useStore } from './core';
import { relayout } from './layout';
import { fitView } from './ui';
import { applyAccountAiModel } from '../lib/ai';
import { forgetSpaceReminders, syncSpaceReminders, withFiredFromIndex } from './reminders';
import { postToUniverse } from '../lib/embed';

const LAST_KEY = 'lastSpaceId';

export function serializeSpace(): Space {
  const s = get();
  return {
    schema: 'mindatlas.space/1',
    id: s.spaceId,
    title: s.title,
    description: s.description,
    cards: s.cards,
    relations: s.relations.filter((r) => !r.suggested),
    axes: s.axes,
    trail: s.trail,
    vocabulary: s.vocabulary,
    relationWords: s.relationWords.length ? s.relationWords : undefined,
    createdAt: s.createdAt,
    updatedAt: now(),
    cloudId: s.cloudId,
    cloudUpdatedAt: s.cloudUpdatedAt,
    anchor: s.anchor,
  };
}

function metaOf(space: Space): SpaceMeta {
  return {
    id: space.id,
    title: space.title,
    updatedAt: space.updatedAt,
    cardCount: Object.values(space.cards).filter((c) => c.kind !== 'concept').length,
    cloudId: space.cloudId,
    cloudUpdatedAt: space.cloudUpdatedAt,
    planetId: space.anchor?.planetId,
  };
}

function sanitizeAnchor(raw: unknown): SpaceAnchor | undefined {
  const a = raw as Partial<SpaceAnchor> | null;
  if (!a || typeof a !== 'object' || typeof a.planetId !== 'string' || !a.planetId || typeof a.nodeId !== 'string') return undefined;
  return { planetId: a.planetId.slice(0, 120), nodeId: a.nodeId.slice(0, 200), nodeTitle: typeof a.nodeTitle === 'string' ? a.nodeTitle.slice(0, 300) : '' };
}

function sanitizeReminder(raw: unknown): CardReminder | undefined {
  const r = raw as Partial<CardReminder> | null;
  if (!r || typeof r !== 'object' || !Number.isFinite(r.at)) return undefined;
  return { at: r.at as number, ...(Number.isFinite(r.firedAt) ? { firedAt: r.firedAt as number } : {}) };
}

/** 保存形式を検証し、足りない項目を補う（取り込みやクラウドからの読み込みに使う） */
export function sanitizeSpace(raw: unknown, fallbackId = newId('s')): Space {
  const v = raw as Partial<Space>;
  if (!v || typeof v !== 'object' || !v.cards || typeof v.cards !== 'object') throw new Error(t('error.invalidSpace'));
  const at = now();
  const cards: Record<string, Card> = {};
  for (const [id, c] of Object.entries(v.cards)) {
    if (!c || typeof c.title !== 'string') continue;
    cards[id] = {
      ...c,
      id,
      body: typeof c.body === 'string' ? c.body : '',
      tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
      x: Number.isFinite(c.x) ? c.x : 0,
      y: Number.isFinite(c.y) ? c.y : 0,
      depth: Number.isFinite(c.depth) ? c.depth : 0.5,
      place: ['canvas', 'shelf', 'hidden', 'library'].includes(c.place) ? c.place : 'canvas',
      log: Array.isArray(c.log) ? c.log.filter((l) => l && typeof l.code === 'string') : [],
      reminder: sanitizeReminder(c.reminder),
      createdAt: Number.isFinite(c.createdAt) ? c.createdAt : at,
      updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : at,
    };
  }
  // 軸が壊れていたら、既定の概念軸で補う
  let axes = v.axes as Axes | undefined;
  if (!axes || !cards[axes.x] || !cards[axes.y] || !cards[axes.z]) {
    for (const c of defaultConcepts(at)) if (!cards[c.id]) cards[c.id] = c;
    axes = { x: 'c-abstraction', y: 'c-sentiment', z: 'c-horizon' };
  }
  for (const k of ['x', 'y', 'z'] as const) cards[axes[k]] = { ...cards[axes[k]], place: 'canvas' };
  const relationWords = sanitizeWords(v.relationWords);
  const relations = (Array.isArray(v.relations) ? v.relations : [])
    .filter((r) => r && cards[r.from] && cards[r.to] && typeof r.type === 'string')
    // 以前の「支持」「反証」は今の言葉へ。消えた自分の言葉の線は「言葉なし」に戻す
    .map((r): Relation => ({ ...r, type: LEGACY_TYPES[r.type] ?? (r.type.startsWith(CUSTOM_PREFIX) && !relationWords.some((w) => w.id === r.type) ? 'related' : r.type) }));
  return {
    schema: 'mindatlas.space/1',
    id: typeof v.id === 'string' && v.id ? v.id : fallbackId,
    title: typeof v.title === 'string' && v.title.trim() ? v.title : t('space.untitled'),
    description: typeof v.description === 'string' ? v.description : '',
    cards,
    relations,
    axes,
    trail: Array.isArray(v.trail) && v.trail.length ? v.trail : [{ id: 't0', axes, at }],
    vocabulary: isVocabulary(v.vocabulary) ? v.vocabulary : undefined,
    relationWords: relationWords.length ? relationWords : undefined,
    createdAt: Number.isFinite(v.createdAt) ? (v.createdAt as number) : at,
    updatedAt: Number.isFinite(v.updatedAt) ? (v.updatedAt as number) : at,
    cloudId: typeof v.cloudId === 'string' ? v.cloudId : undefined,
    cloudUpdatedAt: typeof v.cloudUpdatedAt === 'number' ? v.cloudUpdatedAt : undefined,
    anchor: sanitizeAnchor(v.anchor),
  };
}

function sanitizeWords(raw: unknown): RelationWord[] {
  if (!Array.isArray(raw)) return [];
  const out: RelationWord[] = [];
  for (const w of raw as Partial<RelationWord>[]) {
    if (!w || typeof w.id !== 'string' || !w.id.startsWith(CUSTOM_PREFIX) || typeof w.label !== 'string' || !w.label.trim()) continue;
    if (out.some((x) => x.id === w.id)) continue;
    out.push({
      id: w.id,
      label: w.label.trim().slice(0, 24),
      back: typeof w.back === 'string' && w.back.trim() ? w.back.trim().slice(0, 24) : undefined,
      meaning: typeof w.meaning === 'string' ? w.meaning.slice(0, 200) : '',
      directed: Boolean(w.directed),
      color: typeof w.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#9fb4d8',
    });
  }
  return out.slice(0, 12);
}

// ── 読み込み ────────────────────────────────────────────
export function openSpace(opened: Space, opts: { readOnly?: boolean; shareToken?: string; fit?: boolean } = {}) {
  // 閉じている間に宇宙側で発火した予定は、カードにも発火の印を付けて開く
  const space = opts.readOnly ? opened : withFiredFromIndex(opened);
  engine.clear();
  set({
    spaceId: space.id,
    title: space.title,
    description: space.description,
    createdAt: space.createdAt,
    cloudId: space.cloudId,
    cloudUpdatedAt: space.cloudUpdatedAt,
    anchor: opts.readOnly ? undefined : space.anchor,
    readOnly: Boolean(opts.readOnly),
    shareToken: opts.shareToken,
    cards: space.cards,
    relations: space.relations,
    axes: space.axes,
    trail: space.trail,
    vocabulary: space.vocabulary,
    relationWords: space.relationWords ?? [],
    selection: [],
    primary: null,
    selectedRelation: null,
    windows: [],
    clusters: null,
    draftAxes: null,
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    ready: true,
  });
  // 保存済みの位置から始め、意味の位置へ動かす
  for (const c of Object.values(space.cards)) {
    if (c.place === 'canvas') engine.place(c.id, c.x, c.y, depthScale(c.depth));
    else engine.place(c.id, c.x, c.y, 0.2);
  }
  relayout({ stagger: false, mode: 'soft' });
  if (opts.fit !== false) fitView(undefined, false);
  if (!opts.readOnly) {
    void idbSet('kv', LAST_KEY, space.id);
    syncSpaceReminders(space);
    if (space !== opened) markDirtyAfterOpen();
  }
}

/** 開いた時点で変わっていた（発火の印を付けた）ので、保存し直す */
function markDirtyAfterOpen() {
  set({ saveState: 'dirty' });
}

export async function loadSpaceIndex() {
  const all = await idbAll<Space>('spaces');
  const metas = all.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
  set({ spaces: metas });
  return metas;
}

export async function openSpaceById(id: string) {
  await flushSave();
  const space = await idbGet<Space>('spaces', id);
  if (!space) return false;
  openSpace(sanitizeSpace(space, id));
  void pullNewerCloudCopy();
  return true;
}

/** 起動時：前回のスペース、無ければデモを開く */
export async function bootSpaces() {
  const metas = await loadSpaceIndex();
  const last = await idbGet<string>('kv', LAST_KEY);
  if (last && (await openSpaceById(last))) return;
  if (metas[0] && (await openSpaceById(metas[0].id))) return;
  await createDemoSpace();
}

export async function createDemoSpace() {
  await flushSave();
  const space = buildDemoSpace(newId('s'));
  await idbSet('spaces', space.id, space);
  openSpace(space);
  await loadSpaceIndex();
}

export async function createBlankSpace(title = t('space.untitled'), presetId = 'p-think', vocabulary?: VocabularyId, anchor?: SpaceAnchor) {
  await flushSave();
  const at = now();
  const cards: Record<string, Card> = {};
  for (const c of defaultConcepts(at)) cards[c.id] = c;
  const preset = AXIS_PRESETS.find((p) => p.id === presetId) ?? AXIS_PRESETS[0];
  const axes: Axes = { x: `c-${preset.axes[0]}`, y: `c-${preset.axes[1]}`, z: `c-${preset.axes[2]}` };
  for (const k of ['x', 'y', 'z'] as const) cards[axes[k]] = { ...cards[axes[k]], place: 'canvas' };
  const space: Space = {
    schema: 'mindatlas.space/1',
    id: newId('s'),
    title,
    description: '',
    cards,
    relations: [],
    axes,
    trail: [{ id: 't0', axes, at }],
    vocabulary,
    createdAt: at,
    updatedAt: at,
    anchor,
  };
  await idbSet('spaces', space.id, space);
  openSpace(space);
  await loadSpaceIndex();
  return space.id;
}

/**
 * 惑星（ノード）の内側の空間を開く。この端末にあればそれを、無ければクラウドから、
 * どこにも無ければノードの名前で新しく作る。1つのノードに空間は1つ。
 */
export async function openPlanet(anchor: SpaceAnchor): Promise<string> {
  await flushSave();
  const s = get();
  if (s.ready && !s.readOnly && s.anchor?.planetId === anchor.planetId) {
    // もう開いている。ノード名の変更だけ受け取る
    const fresh = withFiredFromIndex(serializeSpace());
    set({ anchor: { ...anchor }, ...(fresh.cards !== s.cards ? { cards: fresh.cards, saveState: 'dirty' as const } : {}) });
    return s.spaceId;
  }
  const all = await idbAll<Space>('spaces');
  const local = all.filter((x) => x.anchor?.planetId === anchor.planetId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (local) {
    const space = sanitizeSpace(local, local.id);
    space.anchor = { ...anchor };
    openSpace(space);
    void pullNewerCloudCopy();
    await loadSpaceIndex();
    return space.id;
  }
  if (HOSTED && get().session.authenticated) {
    try {
      const hit = (await listCloudSpaces()).find((c) => c.planetId === anchor.planetId);
      if (hit) {
        await openCloudSpace(hit.id);
        set({ anchor: { ...anchor }, saveState: 'dirty' });
        return get().spaceId;
      }
    } catch {
      // クラウドが読めなくても、この端末で新しく始められる
    }
  }
  return createBlankSpace(anchor.nodeTitle.trim() || t('space.untitled'), 'p-think', undefined, { ...anchor });
}

/** 取り込んだ保存形式を、新しいスペースとして開く */
export async function importSpace(raw: unknown) {
  await flushSave();
  const space = sanitizeSpace(raw);
  space.id = newId('s');
  space.cloudId = undefined;
  space.cloudUpdatedAt = undefined;
  // 取り込んだものは別の空間。元の惑星には結びつけない
  space.anchor = undefined;
  await idbSet('spaces', space.id, space);
  openSpace(space);
  await loadSpaceIndex();
}

export async function duplicateCurrentSpace() {
  const base = serializeSpace();
  const space: Space = { ...structuredClone(base), id: newId('s'), title: t('space.copyOf', { title: base.title }), cloudId: undefined, cloudUpdatedAt: undefined, readOnly: undefined, shareToken: undefined, anchor: undefined };
  await idbSet('spaces', space.id, space);
  openSpace(space);
  await loadSpaceIndex();
  toast(t('toast.spaceDuplicated'));
}

export function renameSpace(title: string) {
  if (!title.trim()) return;
  set({ title: title.trim(), saveState: 'dirty' });
}

export async function deleteSpace(id: string, alsoCloud: boolean) {
  const meta = get().spaces.find((m) => m.id === id);
  if (alsoCloud && meta?.cloudId) {
    try {
      await deleteCloudSpace(meta.cloudId);
    } catch (error) {
      toastError(error);
    }
  }
  await idbDelete('spaces', id);
  forgetSpaceReminders(id);
  const metas = await loadSpaceIndex();
  if (get().spaceId === id) {
    if (metas[0]) await openSpaceById(metas[0].id);
    else await createBlankSpace();
  }
}

// ── 自動保存 ────────────────────────────────────────────
let saveTimer = 0;
let cloudTimer = 0;
let saving: Promise<void> | null = null;

export async function flushSave() {
  window.clearTimeout(saveTimer);
  if (saving) await saving;
  const s = get();
  if (!s.ready || s.readOnly || s.saveState !== 'dirty') return;
  saving = (async () => {
    set({ saveState: 'saving' });
    const space = serializeSpace();
    try {
      await idbSet('spaces', space.id, space);
      syncSpaceReminders(space);
      set({ saveState: get().saveState === 'saving' ? 'saved' : get().saveState });
      set((st) => ({ spaces: [metaOf(space), ...st.spaces.filter((m) => m.id !== space.id)] }));
      scheduleCloudSave();
    } catch {
      set({ saveState: 'error' });
    }
  })();
  await saving;
  saving = null;
}

useStore.subscribe((s, prev) => {
  if (s.saveState === 'dirty' && prev.saveState !== 'dirty') {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), 700);
  }
});

/**
 * Ctrl+S。保存はもともと自動だが、押した人を不安にさせないよう、待たずにいま書き込んで
 * 結果を伝える。書き込む道すじは自動保存とまったく同じもの。
 */
export async function saveNow() {
  const s = get();
  if (s.readOnly) {
    toast(t('save.readOnly'));
    return;
  }
  const pending = s.saveState !== 'saved';
  await flushSave();
  if (cloudEnabled()) void saveToCloud();
  toast(pending ? t('toast.saveDone') : t('toast.saveAuto'));
}

window.addEventListener('beforeunload', () => {
  if (get().saveState === 'dirty') void flushSave();
});

// ── クラウド（ログイン時） ─────────────────────────────────
export function cloudEnabled() {
  const s = get();
  return HOSTED && s.session.authenticated && !s.readOnly;
}

function scheduleCloudSave() {
  if (!cloudEnabled()) return;
  window.clearTimeout(cloudTimer);
  cloudTimer = window.setTimeout(() => void saveToCloud(), 2500);
}

export async function saveToCloud(): Promise<boolean> {
  if (!cloudEnabled()) return false;
  set({ cloudState: 'syncing' });
  try {
    const space = serializeSpace();
    const { entry } = await saveCloudSpace(space);
    const cloudUpdatedAt = Date.parse(entry.updatedAt) || now();
    if (get().spaceId === space.id) set({ cloudId: entry.id, cloudUpdatedAt, cloudState: 'synced' });
    const local = { ...space, cloudId: entry.id, cloudUpdatedAt };
    await idbSet('spaces', space.id, local);
    set((st) => ({ spaces: st.spaces.map((m) => (m.id === space.id ? metaOf(local) : m)) }));
    return true;
  } catch (error) {
    set({ cloudState: 'error' });
    toastError(error);
    return false;
  }
}

/** 開いたスペースのクラウド版が新しければ読み込む（別端末での編集を反映） */
async function pullNewerCloudCopy() {
  const s = get();
  if (!cloudEnabled() || !s.cloudId) return;
  try {
    const { space, entry } = await loadCloudSpace(s.cloudId);
    const cloudAt = Date.parse(entry.updatedAt) || 0;
    if (cloudAt > (s.cloudUpdatedAt ?? 0) + 1000 && get().spaceId === s.spaceId && get().saveState === 'saved') {
      const merged = sanitizeSpace({ ...space, id: s.spaceId, cloudId: entry.id, cloudUpdatedAt: cloudAt });
      await idbSet('spaces', merged.id, merged);
      openSpace(merged, { fit: false });
      toast(t('toast.cloudNewer'));
    } else {
      set({ cloudState: 'synced' });
    }
  } catch {
    set({ cloudState: 'error' });
  }
}

export async function refreshCloudList() {
  if (!HOSTED || !get().session.authenticated) return [];
  const cloud = await listCloudSpaces();
  const metas = await loadSpaceIndex();
  const known = new Set(metas.map((m) => m.cloudId).filter(Boolean));
  const extra: SpaceMeta[] = cloud
    .filter((c) => !known.has(c.id))
    .map((c) => ({ id: `cloud:${c.id}`, title: c.title, updatedAt: Date.parse(c.updatedAt) || 0, cardCount: c.cardCount, cloudId: c.id, cloudOnly: true }));
  set({ spaces: [...metas, ...extra].sort((a, b) => b.updatedAt - a.updatedAt) });
  return cloud;
}

export async function openCloudSpace(cloudId: string) {
  await flushSave();
  const { space, entry } = await loadCloudSpace(cloudId);
  const local = sanitizeSpace({ ...space, id: newId('s'), cloudId: entry.id, cloudUpdatedAt: Date.parse(entry.updatedAt) || now() });
  await idbSet('spaces', local.id, local);
  openSpace(local);
  await refreshCloudList();
}

// ── 共有 ───────────────────────────────────────────────
export async function setSharing(enabled: boolean) {
  if (!get().cloudId) {
    const ok = await saveToCloud();
    if (!ok) return null;
  }
  const cloudId = get().cloudId;
  if (!cloudId) return null;
  const res = await shareCloudSpace(cloudId, enabled);
  set({ shareToken: res.shareToken ?? undefined });
  return res;
}

export async function openSharedSpace(token: string) {
  const { space } = await loadSharedSpace(token);
  openSpace(sanitizeSpace({ ...space, id: `shared:${token}` }), { readOnly: true, shareToken: token });
}

export async function refreshSession() {
  try {
    const session = await fetchSession();
    if (session.authenticated) applyAccountAiModel(session.aiPreference);
    set({ session });
    return session;
  } catch {
    set((s) => ({ session: { ...s.session, loaded: true } }));
    return get().session;
  }
}

/** プリセットの概念軸が消されていたら作り直して ID を返す */
export function ensureConcept(key: ConceptKey) {
  const id = `c-${key}`;
  if (!get().cards[id]) set((s) => ({ cards: { ...s.cards, [id]: makeConceptCard(key, now()) } }));
  return id;
}

/** 旧 β から渡されたスペースを、この端末に加える。同じ ID が既にあれば加えない（何度移しても増えない） */
export async function importMovedSpace(raw: unknown): Promise<boolean> {
  const space = sanitizeSpace(raw);
  if (await idbGet<Space>('spaces', space.id)) return false;
  space.readOnly = undefined;
  space.shareToken = undefined;
  await idbSet('spaces', space.id, space);
  syncSpaceReminders(space);
  return true;
}

/** この端末に保存しているスペースすべて（旧 β から移すときに使う） */
export async function localSpacesForMove(): Promise<Space[]> {
  await flushSave();
  return (await idbAll<Space>('spaces')).filter((s) => !s.readOnly && !String(s.id).startsWith('shared:'));
}

/** 宇宙（マインドアトラス（スペース））へ上昇する。書きかけを保存してから知らせる */
export async function ascendToUniverse() {
  await flushSave();
  postToUniverse({ type: 'ascend', planetId: get().anchor?.planetId });
}

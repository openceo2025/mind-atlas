import { create } from 'zustand';
import type { Axes, AxisKey, Camera, Card, Cluster, FloatWin, Relation, RelationType, SpaceMeta, TrailItem } from '../types';
import type { SessionState } from '../lib/service';
import { HOSTED } from '../lib/service';
import { engine } from '../lib/physics';
import { depthScale } from '../lib/semantic';

export const AXIS_KEYS: AxisKey[] = ['x', 'y', 'z'];

export interface Ghost {
  card: Card;
  x: number;
  y: number;
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface Snapshot {
  cards: Record<string, Card>;
  relations: Relation[];
  axes: Axes;
}

export interface State {
  // ── スペース ──
  spaceId: string;
  title: string;
  description: string;
  createdAt: number;
  readOnly: boolean;
  shareToken?: string;
  cloudId?: string;
  cloudUpdatedAt?: number;
  cards: Record<string, Card>;
  relations: Relation[];
  axes: Axes;
  trail: TrailItem[];
  spaces: SpaceMeta[];
  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  cloudState: 'off' | 'synced' | 'syncing' | 'error';
  // ── 配置 ──
  scoreSource: 'server' | 'local';
  draftAxes: Axes | null;
  previewFirst: boolean;
  // ── UI ──
  selection: string[];
  primary: string | null;
  selectedRelation: string | null;
  camera: Camera;
  viewport: { w: number; h: number };
  windows: FloatWin[];
  topZ: number;
  clusters: Cluster[] | null;
  query: string;
  paletteOpen: boolean;
  toasts: Toast[];
  dropTarget: string | null;
  draggingIds: string[];
  ghost: Ghost | null;
  highlight: string[];
  radialHidden: boolean;
  linking: { from: string; x: number; y: number } | null;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  session: SessionState;
  theme: 'dark' | 'light';
  sidebarOpen: boolean;
  busy: Record<string, boolean>;
  ready: boolean;
}

export const initialSession: SessionState = {
  mode: HOSTED ? 'hosted' : 'local',
  loaded: false,
  authenticated: false,
  user: null,
  subscriptionActive: false,
  subscription: null,
  creditPercent: null,
  aiEnabled: false,
};

export const useStore = create<State>(() => ({
  spaceId: '',
  title: '',
  description: '',
  createdAt: Date.now(),
  readOnly: false,
  cards: {},
  relations: [],
  axes: { x: '', y: '', z: '' },
  trail: [],
  spaces: [],
  saveState: 'saved',
  cloudState: 'off',
  scoreSource: 'local',
  draftAxes: null,
  previewFirst: true,
  selection: [],
  primary: null,
  selectedRelation: null,
  camera: { x: 700, y: 420, zoom: 0.72 },
  viewport: { w: 1400, h: 840 },
  windows: [],
  topZ: 10,
  clusters: null,
  query: '',
  paletteOpen: false,
  toasts: [],
  dropTarget: null,
  draggingIds: [],
  ghost: null,
  highlight: [],
  radialHidden: false,
  linking: null,
  undoStack: [],
  redoStack: [],
  session: initialSession,
  theme: 'dark',
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth > 900 : true,
  busy: {},
  ready: false,
}));

export const get = useStore.getState;
export const set = useStore.setState;

let uid = Date.now() % 100000;
export const newId = (p: string) => `${p}-${(++uid).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const now = () => Date.now();

// ── 参照ヘルパ ────────────────────────────────────────────
export const lookup = (id: string) => get().cards[id];
export const isAxisCard = (id: string, axes = get().axes) => AXIS_KEYS.some((k) => axes[k] === id);
export const axisKeyOf = (id: string, axes = get().axes) => AXIS_KEYS.find((k) => axes[k] === id);
export const canvasCards = (s: State = get()) => Object.values(s.cards).filter((c) => c.place === 'canvas');
export const layoutCards = (s: State = get()) => canvasCards(s).filter((c) => !isAxisCard(c.id, s.axes));
export const conceptCards = (s: State = get()) => Object.values(s.cards).filter((c) => c.kind === 'concept');

export function worldToScreen(wx: number, wy: number, cam = get().camera) {
  return { x: cam.x + wx * cam.zoom, y: cam.y + wy * cam.zoom };
}
export function screenToWorld(sx: number, sy: number, cam = get().camera) {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}

// ── 変更の記録 ───────────────────────────────────────────
export function markDirty() {
  if (get().readOnly) return;
  set({ saveState: 'dirty' });
}

export function patchCard(id: string, patch: Partial<Card>) {
  set((s) => (s.cards[id] ? { cards: { ...s.cards, [id]: { ...s.cards[id], ...patch } } } : {}));
  markDirty();
}

export function addLog(id: string, code: string, params?: Record<string, string | number>) {
  const c = lookup(id);
  if (!c) return;
  patchCard(id, { log: [...c.log, { at: now(), code, params }].slice(-40) });
}

export function drive(ids: string[], mode: Parameters<typeof engine.setTarget>[4], stagger = 0) {
  const s = get();
  ids.forEach((id, i) => {
    const c = s.cards[id];
    if (!c) return;
    engine.setTarget(id, c.x, c.y, depthScale(c.depth), mode, stagger * i);
  });
}

export function snapshot() {
  const s = get();
  set({ undoStack: [...s.undoStack.slice(-39), { cards: s.cards, relations: s.relations, axes: s.axes }], redoStack: [] });
}

function restore(snap: Snapshot) {
  set({ cards: snap.cards, relations: snap.relations, axes: snap.axes, selection: [], primary: null });
  for (const c of Object.values(snap.cards)) {
    if (c.place === 'canvas') engine.setTarget(c.id, c.x, c.y, depthScale(c.depth), 'soft');
  }
  markDirty();
}

export function undo() {
  const s = get();
  const snap = s.undoStack[s.undoStack.length - 1];
  if (!snap) return false;
  set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, { cards: s.cards, relations: s.relations, axes: s.axes }] });
  restore(snap);
  return true;
}

export function redo() {
  const s = get();
  const snap = s.redoStack[s.redoStack.length - 1];
  if (!snap) return false;
  set({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, { cards: s.cards, relations: s.relations, axes: s.axes }] });
  restore(snap);
  return true;
}

let toastId = 0;
export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone: opts.tone, action: opts.action }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), opts.ms ?? (opts.action ? 6000 : 2800));
}

export function toastError(error: unknown) {
  toast(error instanceof Error ? error.message : String(error), { tone: 'error', ms: 5000 });
}

export function setBusy(key: string, on: boolean) {
  set((s) => ({ busy: { ...s.busy, [key]: on } }));
}

export function addRelationRaw(from: string, to: string, type: RelationType, label?: string, suggested?: boolean) {
  const id = newId('r');
  set((s) => ({ relations: [...s.relations, { id, from, to, type, label, suggested }] }));
  markDirty();
  return id;
}

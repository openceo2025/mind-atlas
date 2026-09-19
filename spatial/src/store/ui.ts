import type { Camera, Card, FloatWin, WindowType } from '../types';
import { cardSize, depthScale } from '../lib/semantic';
import { engine } from '../lib/physics';
import { canvasCards, get, lookup, newId, screenToWorld, set, worldToScreen } from './core';

// ── 選択 ───────────────────────────────────────────────
export function select(ids: string[], mode: 'replace' | 'toggle' | 'add' = 'replace') {
  const s = get();
  let sel: string[];
  if (mode === 'replace') sel = ids;
  else if (mode === 'add') sel = [...new Set([...s.selection, ...ids])];
  else {
    sel = [...s.selection];
    for (const id of ids) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
  }
  set({
    selection: sel,
    primary: sel.length ? (ids.find((i) => sel.includes(i)) ?? sel[sel.length - 1]) : null,
    radialHidden: false,
    selectedRelation: null,
  });
}

// ── ウィンドウ ───────────────────────────────────────────
export function windowScreenPos(w: FloatWin) {
  if (w.pinned && w.pinnedAt) return w.pinnedAt;
  const p = worldToScreen(w.anchor.x, w.anchor.y);
  return { x: p.x + w.offset.x, y: p.y + w.offset.y };
}

export const WINDOW_WIDTH: Record<WindowType, number> = {
  summary: 380,
  compare: 560,
  extract: 400,
  axis: 320,
  preview: 420,
  detail: 380,
  cluster: 340,
  relations: 380,
  chat: 420,
  search: 420,
  voice: 360,
  agent: 460,
  account: 360,
  share: 380,
  spaces: 400,
  help: 420,
  settings: 360,
  relation: 300,
};

/** 対象カードの近く（右、入らなければ左）に開く */
export function openWindow(type: WindowType, cardIds: string[], data?: Record<string, unknown>) {
  const s = get();
  const cards = cardIds.map((id) => s.cards[id]).filter(Boolean);
  const width = Math.min(WINDOW_WIDTH[type], s.viewport.w - 24);
  const existing = s.windows.find((w) => w.type === type && !w.pinned && w.cardIds.join() === cardIds.join());
  if (existing) return focusWindow(existing.id, false);
  if (!cards.length) return openWindowAtScreen(type, cardIds, { x: s.viewport.w / 2 - width / 2, y: 80 }, width, data);
  const right = Math.max(...cards.map((c) => c.x + (cardSize(c).w * depthScale(c.depth)) / 2));
  const cy = cards.reduce((a, c) => a + c.y, 0) / cards.length;
  const anchor = { x: right, y: cy };
  const p = worldToScreen(anchor.x, anchor.y);
  // 選択中カードの横にはラジアルアクションが出ているので、その外側に開く
  const gap = s.primary && cardIds.includes(s.primary) ? 250 : 28;
  let sx = p.x + gap;
  const sy = Math.max(64, Math.min(p.y - 150, s.viewport.h - 520));
  if (sx + width > s.viewport.w - 12) {
    const left = Math.min(...cards.map((c) => c.x - (cardSize(c).w * depthScale(c.depth)) / 2));
    sx = Math.max(12, worldToScreen(left, 0).x - width - gap);
  }
  if (s.viewport.w < 700) sx = 12;
  const win: FloatWin = {
    id: newId('w'),
    type,
    anchor,
    offset: { x: sx - p.x, y: sy - p.y },
    pinned: false,
    z: s.topZ + 1,
    cardIds,
    width,
    data: { at: Date.now(), ...data },
  };
  set({ windows: [...s.windows, win], topZ: s.topZ + 1 });
  return win.id;
}

/** 画面上の位置を指定して開く（空間に固定されない道具系のウィンドウ） */
export function openWindowAtScreen(type: WindowType, cardIds: string[], at: { x: number; y: number }, width = WINDOW_WIDTH[type], data?: Record<string, unknown>) {
  const s = get();
  const w = Math.min(width, s.viewport.w - 24);
  const x = Math.max(12, Math.min(at.x, s.viewport.w - w - 12));
  const y = Math.max(12, Math.min(at.y, s.viewport.h - 220));
  const win: FloatWin = {
    id: newId('w'),
    type,
    anchor: screenToWorld(x, y),
    offset: { x: 0, y: 0 },
    pinned: true,
    pinnedAt: { x, y },
    z: s.topZ + 1,
    cardIds,
    width: w,
    data: { at: Date.now(), ...data },
  };
  set({ windows: [...s.windows, win], topZ: s.topZ + 1, radialHidden: true });
  return win.id;
}

/** 同じ種類の道具ウィンドウがあれば前面に、無ければ開く */
export function toggleToolWindow(type: WindowType, at?: { x: number; y: number }, data?: Record<string, unknown>) {
  const s = get();
  const existing = s.windows.find((w) => w.type === type);
  if (existing) {
    if (existing.z === s.topZ) closeWindow(existing.id);
    else focusWindow(existing.id);
    return;
  }
  const width = WINDOW_WIDTH[type];
  openWindowAtScreen(type, s.selection.slice(0, 12), at ?? { x: s.viewport.w - width - 16, y: 64 }, width, data);
}

export function focusWindow(id: string, hideRadial = true) {
  set((s) => ({
    topZ: s.topZ + 1,
    radialHidden: hideRadial ? true : s.radialHidden,
    windows: s.windows.map((w) => (w.id === id ? { ...w, z: s.topZ + 1 } : w)),
  }));
  return id;
}

export function moveWindow(id: string, dx: number, dy: number) {
  set((s) => ({
    windows: s.windows.map((w) =>
      w.id !== id ? w : w.pinned && w.pinnedAt ? { ...w, pinnedAt: { x: w.pinnedAt.x + dx, y: w.pinnedAt.y + dy } } : { ...w, offset: { x: w.offset.x + dx, y: w.offset.y + dy } },
    ),
  }));
}

export function togglePin(id: string) {
  set((s) => ({
    windows: s.windows.map((w) => {
      if (w.id !== id) return w;
      if (w.pinned) {
        // ピン解除：現在のスクリーン位置のまま、空間に再アンカー
        const p = w.pinnedAt ?? windowScreenPos(w);
        const a = worldToScreen(w.anchor.x, w.anchor.y);
        return { ...w, pinned: false, pinnedAt: undefined, offset: { x: p.x - a.x, y: p.y - a.y } };
      }
      return { ...w, pinned: true, pinnedAt: windowScreenPos(w) };
    }),
  }));
}

export function closeWindow(id: string) {
  set((s) => ({
    windows: s.windows.filter((w) => w.id !== id),
    draftAxes: s.windows.find((w) => w.id === id)?.type === 'preview' ? null : s.draftAxes,
  }));
}

export function closeWindowsOfType(type: WindowType) {
  set((s) => ({ windows: s.windows.filter((w) => w.type !== type) }));
}

export function updateWindowData(id: string, data: Record<string, unknown>) {
  set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, data: { ...w.data, ...data } } : w)) }));
}

// ── カメラ ─────────────────────────────────────────────
let camAnim = 0;
let camTimer = 0;
export function setCamera(cam: Camera) {
  set({ camera: cam });
  engine.notify();
}

export function animateCamera(to: Camera, ms = 520) {
  const from = get().camera;
  const t0 = performance.now();
  const next = () => {
    cancelAnimationFrame(camAnim);
    clearTimeout(camTimer);
    camAnim = requestAnimationFrame(step);
    camTimer = window.setTimeout(step, 80); // 非表示時のフォールバック
  };
  const step = () => {
    const k = Math.min(1, Math.max(0, (performance.now() - t0) / ms));
    const e = 1 - Math.pow(1 - k, 3);
    setCamera({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom: from.zoom + (to.zoom - from.zoom) * e });
    if (k < 1) next();
  };
  next();
}

export function zoomAt(sx: number, sy: number, factor: number) {
  const cam = get().camera;
  const zoom = Math.max(0.2, Math.min(2.4, cam.zoom * factor));
  const w = screenToWorld(sx, sy, cam);
  setCamera({ zoom, x: sx - w.x * zoom, y: sy - w.y * zoom });
}

export function fitView(ids?: string[], animate = true) {
  const s = get();
  const cards = ids?.length ? ids.map((i) => s.cards[i]).filter(Boolean) : canvasCards(s);
  const { w, h } = s.viewport;
  if (!cards.length) {
    const cam = { zoom: 0.72, x: w / 2, y: h / 2 };
    return animate ? animateCamera(cam) : setCamera(cam);
  }
  const xs = cards.flatMap((c) => [c.x - cardSize(c).w / 2, c.x + cardSize(c).w / 2]);
  const ys = cards.flatMap((c) => [c.y - cardSize(c).h / 2, c.y + cardSize(c).h / 2]);
  const minX = Math.min(...xs) - 60;
  const maxX = Math.max(...xs) + 60;
  const minY = Math.min(...ys) - 60;
  const maxY = Math.max(...ys) + 60;
  const bottom = w < 700 ? 70 : 90;
  const fitZoom = Math.max(0.25, Math.min(1.3, Math.min(w / (maxX - minX), (h - bottom) / (maxY - minY))));
  const place = (zoom: number, shift: number) => ({
    zoom,
    x: w / 2 - shift - ((minX + maxX) / 2) * zoom,
    y: (h - bottom) / 2 + 10 - ((minY + maxY) / 2) * zoom,
  });
  // 右下のミニマップの下にカード（Z 軸のドックなど）が隠れないよう、少しずつ縮めて左へ寄せる
  let cam = place(fitZoom, 0);
  for (let i = 1; i <= 6 && hiddenByMinimap(cards, cam, w, h); i++) cam = place(fitZoom * (1 - i * 0.05), i * 18);
  if (animate) animateCamera(cam);
  else setCamera(cam);
}

// ミニマップ（components.css .minimap、900px 未満では非表示）が占める右下の領域
const MINIMAP_BOX = { w: 226 + 24, h: 196 + 24 };

function hiddenByMinimap(cards: Card[], cam: Camera, w: number, h: number) {
  if (w <= 900) return false;
  const left = w - MINIMAP_BOX.w;
  const top = h - MINIMAP_BOX.h;
  return cards.some((c) => {
    const size = cardSize(c);
    return (c.x + size.w / 2) * cam.zoom + cam.x > left && (c.y + size.h / 2) * cam.zoom + cam.y > top;
  });
}

export function focusCard(id: string) {
  const c = lookup(id);
  if (!c) return;
  const s = get();
  const zoom = Math.max(s.camera.zoom, 0.85);
  animateCamera({ zoom, x: s.viewport.w / 2 - c.x * zoom, y: s.viewport.h / 2 - c.y * zoom });
  select([id]);
  set({ highlight: [id] });
  setTimeout(() => set({ highlight: [] }), 1400);
}

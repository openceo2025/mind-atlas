import type { AxisKey, Card } from '../types';
import { t } from '../i18n';
import { addToGroup, fromShelf, get, lookup, screenToWorld, set, setAxis, toShelf, toast } from '../store';

let canvasEl: HTMLElement | null = null;
export const setCanvasEl = (el: HTMLElement | null) => {
  canvasEl = el;
};

/** 左ナビが閉じているときに、「ナビへ投げた」とみなす画面左からの幅 */
const NAV_FALLBACK = 84;

/** ポインタが左ナビの上にあるか（ナビが閉じていれば画面の左端）。ここへ投げたウィンドウは閉じ、カードは消える */
export function overNav(x: number, y: number) {
  const r = document.querySelector('.sidebar')?.getBoundingClientRect();
  if (!r || r.width < 8) return x < NAV_FALLBACK;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function clientToCanvas(cx: number, cy: number) {
  const r = canvasEl?.getBoundingClientRect();
  return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) };
}

export function clientToWorld(cx: number, cy: number) {
  const p = clientToCanvas(cx, cy);
  return screenToWorld(p.x, p.y);
}

/** ポインタ直下のドロップ先を探す。ドラッグ中のカード自身は除外する */
export function findDropTarget(cx: number, cy: number, exclude: string[] = []): string | null {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const h = el as HTMLElement;
    const cardId = h.closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    if (cardId && exclude.includes(cardId)) continue;
    const target = h.closest<HTMLElement>('[data-drop]')?.dataset.drop;
    if (target) {
      if (target.startsWith('group:') && exclude.includes(target.slice(6))) continue;
      return target;
    }
    if (h.classList.contains('canvas')) return 'canvas';
  }
  return null;
}

/** カードをドロップ先に置く。処理したら true */
export function dropCards(target: string | null, ids: string[], cx: number, cy: number): boolean {
  if (!target || !ids.length || get().readOnly) return false;
  const [kind, arg] = target.split(':');
  const id = ids[0];
  if (kind === 'axis' || kind === 'slot') {
    if (ids.length > 1) {
      toast(t('toast.axisSingle'));
      return false;
    }
    if (lookup(id)?.kind === 'group') {
      toast(t('toast.axisNoGroup'));
      return false;
    }
    // 空間上の軸ドックへのドロップは即時、パネルのスロットは設定に従う
    setAxis(arg as AxisKey, id, kind === 'axis');
    return true;
  }
  if (kind === 'shelf') {
    toShelf(ids);
    return true;
  }
  if (kind === 'group') {
    addToGroup(arg, ids);
    return true;
  }
  if (kind === 'canvas') {
    const c = lookup(id);
    if (c && (c.place === 'shelf' || c.place === 'library')) {
      const w = clientToWorld(cx, cy);
      fromShelf(id, w.x, w.y);
      return true;
    }
  }
  return false;
}

/** 棚・概念チップ・要約の項目など、空間の外から持ち出すドラッグ（ゴースト表示） */
export function startGhostDrag(
  e: React.PointerEvent,
  card: Card,
  opts: { onClick?: () => void; onDrop?: (target: string | null, cx: number, cy: number) => boolean } = {},
) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
    if (!started) window.getSelection()?.removeAllRanges();
    started = true;
    set({ ghost: { card, x: ev.clientX, y: ev.clientY }, draggingIds: [card.id], dropTarget: findDropTarget(ev.clientX, ev.clientY) });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    set({ ghost: null, draggingIds: [], dropTarget: null });
    if (!started) return opts.onClick?.();
    const target = findDropTarget(ev.clientX, ev.clientY);
    if (opts.onDrop) opts.onDrop(target, ev.clientX, ev.clientY);
    else dropCards(target, [card.id], ev.clientX, ev.clientY);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

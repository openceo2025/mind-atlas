import { addRelation, get, openWindow, set } from '../store';
import { clientToCanvas } from '../lib/drag';
import { judgeDrawnRelation } from '../lib/decisions';

/**
 * 選択中カードの「関係ハンドル」から別のカードへ線を引く。
 * 離した先がカードなら「言葉なし」で結び、言葉を選べる小窓をその場に開く。
 * 判断モデルが使えれば、裏で言葉と向きを選ばせる（人が先に選べばそちらが勝つ）。
 */
export function startLinkDrag(e: React.PointerEvent, from: string) {
  const p = clientToCanvas(e.clientX, e.clientY);
  set({ linking: { from, x: p.x, y: p.y } });
  const move = (ev: PointerEvent) => {
    const q = clientToCanvas(ev.clientX, ev.clientY);
    set({ linking: { from, x: q.x, y: q.y } });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    set({ linking: null });
    let target: string | undefined;
    for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const id = (el as HTMLElement).closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
      if (id && id !== from && get().cards[id]?.place === 'canvas') {
        target = id;
        break;
      }
    }
    if (!target) return;
    const rel = addRelation(from, target, 'related');
    if (!rel) return;
    openWindow('relation', [target], { relationId: rel });
    void judgeDrawnRelation(rel);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  createCard,
  get,
  importDrafts,
  importSpace,
  layoutCards,
  openWindow,
  screenToWorld,
  select,
  set,
  setCamera,
  toast,
  toastError,
  useStore,
  worldToScreen,
  zoomAt,
} from '../store';
import { setCanvasEl, clientToWorld } from '../lib/drag';
import { cardSize } from '../lib/semantic';
import { engine } from '../lib/physics';
import { parseText } from '../lib/importExport';
import { shrinkImage } from '../lib/dictation';
import { t } from '../i18n';
import { CardView } from './CardView';
import { RelationLayer } from './RelationLayer';
import { SpaceGrid, ClusterHalos } from './SpaceGrid';
import { RadialMenu } from './RadialMenu';
import { WindowLayer } from './WindowLayer';
import { Shelf } from './Shelf';
import { Minimap } from './Minimap';
import { AxisTrail } from './AxisTrail';
import { Legend } from './Legend';
import { panState } from './panState';
import { Icon } from './Icons';

const isTyping = (el: EventTarget | null) => {
  const h = el as HTMLElement | null;
  return Boolean(h && (h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT' || h.isContentEditable));
};

/** 文章・URL・画像を、カードとして空間に置く（貼り付け・ドロップ共通） */
export async function ingest(items: { text?: string; files?: File[] }, at?: { x: number; y: number }) {
  if (get().readOnly) return;
  for (const file of items.files ?? []) {
    try {
      if (file.type.startsWith('image/')) {
        const image = await shrinkImage(file);
        createCard({ kind: 'image', title: file.name.replace(/\.[^.]+$/, '') || t('card.image'), image }, at);
      } else if (/\.json$/i.test(file.name)) {
        await importSpace(JSON.parse(await file.text()));
        toast(t('spaces.imported'));
      } else if (/\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
        const drafts = parseText(await file.text());
        importDrafts(drafts);
        toast(t('spaces.importedCards', { n: drafts.length }));
      } else {
        toast(t('toast.unsupportedFile', { name: file.name }), { tone: 'error' });
      }
    } catch (e) {
      toastError(e);
    }
  }
  const text = items.text?.trim();
  if (!text) return;
  if (/^https?:\/\/\S+$/.test(text)) {
    let host = text;
    try {
      host = new URL(text).hostname;
    } catch {
      // URL として読めなくてもそのまま題名にする
    }
    const id = createCard({ kind: 'link', title: host, url: text, subtitle: text }, at);
    openWindow('detail', [id], { focusTitle: true });
    return;
  }
  const drafts = parseText(text);
  if (drafts.length <= 1) {
    const lines = text.split('\n');
    const title = lines[0].slice(0, 80);
    createCard({ kind: 'note', title, body: lines.length > 1 || lines[0].length > 80 ? text : '' }, at);
  } else {
    importDrafts(drafts);
    toast(t('spaces.importedCards', { n: drafts.length }));
  }
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const camera = useStore((s) => s.camera);
  const readOnly = useStore((s) => s.readOnly);
  const ids = useStore(useShallow((s) => Object.keys(s.cards).filter((id) => s.cards[id].place === 'canvas' || s.cards[id].place === 'hidden')));
  const empty = useStore((s) => s.ready && layoutCards(s).length === 0);
  const linking = useStore((s) => s.linking);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    setCanvasEl(el);
    const ro = new ResizeObserver(() => set({ viewport: { w: el.clientWidth, h: el.clientHeight } }));
    ro.observe(el);
    set({ viewport: { w: el.clientWidth, h: el.clientHeight } });
    const wheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      const scroller = target.closest<HTMLElement>('.fwin-body, .shelf-items, .palette-list, .trail');
      if (scroller) return;
      if (target.closest('.fwin, .shelf, .minimap, .legend')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // トラックパッドの2本指スクロールはパン、ピンチ（ctrl付き）とマウスホイールはズーム
      if (!e.ctrlKey && Math.abs(e.deltaX) > 0 && e.deltaMode === 0 && Math.abs(e.deltaY) < 40) {
        const cam = get().camera;
        setCamera({ ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY });
        return;
      }
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const onSpace = () => setSpace(panState.space);
    window.addEventListener('panstate', onSpace);
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || get().readOnly || get().paletteOpen) return;
      const files = [...(e.clipboardData?.files ?? [])];
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!files.length && !text.trim()) return;
      e.preventDefault();
      const { viewport } = get();
      void ingest({ text, files }, screenToWorld(viewport.w / 2, viewport.h / 2 - 40));
    };
    document.addEventListener('paste', onPaste);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('panstate', onSpace);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const startPan = (e: React.PointerEvent) => {
    setPanning(true);
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (panState.pinching) return;
      const cam = get().camera;
      setCamera({ ...cam, x: cam.x + ev.clientX - last.x, y: cam.y + ev.clientY - last.y });
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const trackPointer = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) {
        pinch.current = null;
        panState.pinching = false;
      }
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('pointermove', moveP);
    };
    const moveP = (ev: PointerEvent) => {
      if (!pointers.current.has(ev.pointerId)) return;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.current.size !== 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const r = ref.current!.getBoundingClientRect();
      if (pinch.current) {
        const cam = get().camera;
        setCamera({ ...cam, x: cam.x + cx - pinch.current.cx, y: cam.y + cy - pinch.current.cy });
        zoomAt(cx - r.left, cy - r.top, dist / pinch.current.dist);
      }
      pinch.current = { dist, cx, cy };
    };
    window.addEventListener('pointermove', moveP);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    if (pointers.current.size === 2) {
      panState.pinching = true;
      setMarquee(null);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    trackPointer(e);
    if (pointers.current.size > 1) return;
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    if (panState.space || e.button === 1 || e.button === 2 || e.pointerType === 'touch') {
      if (e.pointerType !== 'touch') e.preventDefault();
      if (e.pointerType === 'touch') select([]);
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    // 空白ドラッグ = 範囲選択
    const x1 = e.clientX - r.left;
    const y1 = e.clientY - r.top;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? get().selection : [];
    let moved = false;
    const move = (ev: PointerEvent) => {
      const x2 = ev.clientX - r.left;
      const y2 = ev.clientY - r.top;
      if (!moved && Math.hypot(x2 - x1, y2 - y1) < 4) return;
      moved = true;
      setMarquee({ x1, y1, x2, y2 });
      const a = screenToWorld(Math.min(x1, x2), Math.min(y1, y2));
      const b = screenToWorld(Math.max(x1, x2), Math.max(y1, y2));
      const hit = Object.values(get().cards)
        .filter((c) => c.place === 'canvas')
        .filter((c) => {
          const { w, h } = cardSize(c);
          return c.x + w / 2 > a.x && c.x - w / 2 < b.x && c.y + h / 2 > a.y && c.y - h / 2 < b.y;
        })
        .map((c) => c.id);
      select([...new Set([...base, ...hit])]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!moved && !additive) {
        select([]);
        set({ selectedRelation: null });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || (e.target as HTMLElement).closest('[data-card-id], .fwin, .shelf, .minimap, .legend, .trail, .radial')) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const id = createCard({ kind: 'note', title: t('card.newTitle') }, w);
    openWindow('detail', [id], { focusTitle: true });
  };

  // 関係線を引いている間の仮の線
  let linkLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (linking) {
    const b = engine.get(linking.from);
    if (b) {
      const p = worldToScreen(b.x, b.y, camera);
      linkLine = { x1: p.x, y1: p.y, x2: linking.x, y2: linking.y };
    }
  }

  return (
    <div
      ref={ref}
      className={`canvas ${panning ? 'panning' : ''} ${space ? 'space' : ''} ${dropping ? 'dropping' : ''}`}
      style={{ backgroundSize: `${60 * camera.zoom}px ${60 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        if (readOnly || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void ingest({ files: [...e.dataTransfer.files] }, clientToWorld(e.clientX, e.clientY));
      }}
    >
      <div className="world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <ClusterHalos />
        <SpaceGrid />
        <RelationLayer />
        {ids.map((id) => (
          <CardView key={id} id={id} />
        ))}
      </div>

      <AxisTrail />
      {empty && !readOnly && (
        <div className="empty-state">
          <Icon name="sparkle" size={22} />
          <b>{t('empty.title')}</b>
          <span>{t('empty.body')}</span>
        </div>
      )}
      <Legend />
      <RadialMenu />
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      )}
      {linkLine && (
        <svg className="link-preview">
          <line {...linkLine} stroke="#6ae3ff" strokeWidth={2} strokeDasharray="6 5" />
          <circle cx={linkLine.x2} cy={linkLine.y2} r={5} fill="#6ae3ff" />
        </svg>
      )}
      {dropping && <div className="drop-overlay">{t('drop.files')}</div>}
      <WindowLayer />
      <Shelf />
      <Minimap />
    </div>
  );
}

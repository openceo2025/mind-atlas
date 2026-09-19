import { useRef } from 'react';
import { useStore, setCamera, zoomAt, fitView, isAxisCard } from '../store';
import { t } from '../i18n';
import { cardSize } from '../lib/semantic';
import { Icon } from './Icons';

const MW = 226;
const MH = 128;

const COLOR: Record<string, string> = {
  topic: '#6ae3ff',
  summary: '#6ae3ff',
  idea: '#ffc15c',
  group: '#ffb347',
  issue: '#ff6b7a',
  hypothesis: '#b598ff',
  dataset: '#27d0a0',
  company: '#27d0a0',
};

export function Minimap() {
  const cards = useStore((s) => s.cards);
  const camera = useStore((s) => s.camera);
  const viewport = useStore((s) => s.viewport);
  const axes = useStore((s) => s.axes);
  const svgRef = useRef<SVGSVGElement>(null);

  const list = Object.values(cards).filter((c) => c.place === 'canvas');
  // 空間全体（カードの広がり＋余白）を表示範囲にする
  const xs = list.flatMap((c) => [c.x - 130, c.x + 130]);
  const ys = list.flatMap((c) => [c.y - 90, c.y + 90]);
  const minX = Math.min(-900, ...xs);
  const maxX = Math.max(900, ...xs);
  const minY = Math.min(-600, ...ys);
  const maxY = Math.max(600, ...ys);
  const k = Math.min(MW / (maxX - minX), MH / (maxY - minY));
  const ox = (MW - (maxX - minX) * k) / 2 - minX * k;
  const oy = (MH - (maxY - minY) * k) / 2 - minY * k;

  const vx = (-camera.x / camera.zoom) * k + ox;
  const vy = (-camera.y / camera.zoom) * k + oy;
  const vw = (viewport.w / camera.zoom) * k;
  const vh = (viewport.h / camera.zoom) * k;

  const jump = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const wx = (cx - r.left - ox) / k;
    const wy = (cy - r.top - oy) / k;
    const cam = useStore.getState().camera;
    setCamera({ ...cam, x: viewport.w / 2 - wx * cam.zoom, y: viewport.h / 2 - wy * cam.zoom });
  };

  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()}>
      <svg
        ref={svgRef}
        width={MW}
        height={MH}
        onPointerDown={(e) => {
          jump(e.clientX, e.clientY);
          const move = (ev: PointerEvent) => jump(ev.clientX, ev.clientY);
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        <line x1={ox + minX * k} y1={oy} x2={ox + maxX * k} y2={oy} stroke="rgba(106,227,255,.15)" />
        <line x1={ox} y1={oy + minY * k} x2={ox} y2={oy + maxY * k} stroke="rgba(106,227,255,.15)" />
        {list.map((c) => {
          const { w, h } = cardSize(c);
          const axis = isAxisCard(c.id, axes);
          return (
            <rect
              key={c.id}
              x={ox + (c.x - w / 2) * k}
              y={oy + (c.y - h / 2) * k}
              width={Math.max(3, w * k)}
              height={Math.max(2, h * k)}
              rx={1.5}
              fill={axis ? '#ffd166' : (COLOR[c.kind] ?? '#4d8dff')}
              opacity={axis ? 0.9 : 0.7}
            />
          );
        })}
        <rect x={vx} y={vy} width={vw} height={vh} fill="rgba(106,227,255,.06)" stroke="#6ae3ff" strokeWidth={1.2} rx={2} />
      </svg>
      <div className="minimap-bar">
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => zoomAt(viewport.w / 2, viewport.h / 2, 1 / 1.2)} title={t('map.zoomOut')} aria-label={t('map.zoomOut')}>
          <Icon name="minus" size={14} />
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => zoomAt(viewport.w / 2, viewport.h / 2, 1.2)} title={t('map.zoomIn')} aria-label={t('map.zoomIn')}>
          <Icon name="plus" size={14} />
        </button>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => fitView()} title={t('map.fit')} aria-label={t('map.fit')}>
          <Icon name="fit" size={14} />
        </button>
      </div>
    </div>
  );
}

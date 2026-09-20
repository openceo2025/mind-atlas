import { useStore, DOCK, Z_UNIT, AXIS_NAME, lookup } from '../store';
import { t } from '../i18n';
import { SPACE, axisEnds, cardSize } from '../lib/semantic';
import type { AxisKey } from '../types';

const H = { x: SPACE.W / 2, y: SPACE.H / 2 };
const ZX = SPACE.ZX / 2;
const ZY = SPACE.ZY / 2;

/** 意味空間の枠（各軸の値域）と、X/Y/Z 軸・軸ドック */
export function SpaceGrid() {
  const axes = useStore((s) => s.axes);
  const cards = useStore((s) => s.cards);
  const dropTarget = useStore((s) => s.dropTarget);
  const dragging = useStore((s) => s.draggingIds.length > 0);

  // 値域の箱（奥 z=0 と 手前 z=1 の2面）
  const corner = (sx: number, sy: number, sz: number) => ({
    x: sx * H.x + sz * ZX,
    y: -sy * H.y + sz * ZY,
  });
  const face = (sz: number) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => corner(a, b, sz));
  const back = face(-1);
  const front = face(1);
  const zEnd = 900 - 150;

  // 端の言葉は、概念軸かユーザーが決めたときだけ出す（自分のカードを軸にしても勝手に付けない）
  const ends = (k: AxisKey): [string, string] => axisEnds(lookup(axes[k]));
  const [xl, xh] = ends('x');
  const [yl, yh] = ends('y');
  const [zl, zh] = ends('z');

  return (
    <>
      <svg className="world-svg" style={{ zIndex: 0 }}>
        <defs>
          <linearGradient id="ax-x" x1="0" x2="1">
            <stop offset="0" stopColor="#3fa9ff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#6ae3ff" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="ax-y" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#3fa9ff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#6ae3ff" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="ax-z" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#3fa9ff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#6ae3ff" stopOpacity="0.9" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 10 5 0 10z" fill="#6ae3ff" />
          </marker>
        </defs>
        {/* 値域の箱 */}
        <g stroke="rgba(90,150,255,0.16)" strokeWidth="1" fill="none">
          <polygon points={back.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(40,90,200,0.03)" />
          <polygon points={front.map((p) => `${p.x},${p.y}`).join(' ')} strokeDasharray="4 6" />
          {back.map((p, i) => (
            <line key={i} x1={p.x} y1={p.y} x2={front[i].x} y2={front[i].y} strokeDasharray="4 6" />
          ))}
          {/* 奥の面に目盛り */}
          {[-0.5, 0, 0.5].map((t) => (
            <g key={t} stroke="rgba(90,150,255,0.08)">
              <line x1={corner(t, -1, -1).x} y1={corner(t, -1, -1).y} x2={corner(t, 1, -1).x} y2={corner(t, 1, -1).y} />
              <line x1={corner(-1, t, -1).x} y1={corner(-1, t, -1).y} x2={corner(1, t, -1).x} y2={corner(1, t, -1).y} />
            </g>
          ))}
        </g>
        {/* 軸 */}
        <g strokeWidth="2.2" fill="none" markerEnd="url(#arrow)">
          <line x1={-H.x - 60} y1={0} x2={DOCK.x.x - 140} y2={0} stroke="url(#ax-x)" />
          <line x1={0} y1={H.y + 60} x2={0} y2={DOCK.y.y + 70} stroke="url(#ax-y)" />
          <line x1={-Z_UNIT.x * 520} y1={-Z_UNIT.y * 520} x2={Z_UNIT.x * zEnd} y2={Z_UNIT.y * zEnd} stroke="url(#ax-z)" />
        </g>
        <circle r="5" fill="#6ae3ff" style={{ filter: 'drop-shadow(0 0 6px #6ae3ff)' }} />
      </svg>

      {/* 低い側の端ラベル */}
      <div className="end-label" style={{ left: -H.x - 60, top: -18 }}>
        {xl}
      </div>
      <div className="end-label" style={{ left: 0, top: H.y + 80 }}>
        {yl}
      </div>
      <div className="end-label" style={{ left: -Z_UNIT.x * 540, top: -Z_UNIT.y * 540 - 14 }}>
        {zl}
      </div>

      {(['x', 'y', 'z'] as AxisKey[]).map((k) => {
        const card = cards[axes[k]];
        const size = card ? cardSize(card) : { w: 176, h: 70 };
        const hi = k === 'x' ? xh : k === 'y' ? yh : zh;
        const lo = k === 'x' ? xl : k === 'y' ? yl : zl;
        const capStyle: React.CSSProperties =
          k === 'x'
            ? { left: DOCK.x.x - 110, top: DOCK.x.y + 74 }
            : k === 'y'
              ? { left: DOCK.y.x - 150 - size.w / 2 - 20, top: DOCK.y.y - 40, textAlign: 'right', width: 150 }
              : { left: DOCK.z.x + size.w / 2 + 34, top: DOCK.z.y - 34 };
        return (
          <div key={k}>
            <div
              className={`dock ${dropTarget === `axis:${k}` ? 'over' : ''} ${dragging ? 'dragging' : ''}`}
              data-drop={`axis:${k}`}
              style={{ left: DOCK[k].x, top: DOCK[k].y }}
              title={t('axis.dockHint')}
            />
            <div className="axis-caption" style={capStyle}>
              <span className="k">{AXIS_NAME(k)}</span>
              <span className="n">{card?.title ?? t('axis.unset')}</span>
              {(lo || hi) && <span className="e">{`(${lo} ⟷ ${hi})`}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** 群の名前を、メンバーの重心に置く（色はカードのリングと対応） */
export function ClusterHalos() {
  const clusters = useStore((s) => s.clusters);
  const cards = useStore((s) => s.cards);
  if (!clusters) return null;
  return (
    <>
      {clusters.map((cl) => {
        const ms = cl.cardIds.map((id) => cards[id]).filter((c) => c?.place === 'canvas');
        if (!ms.length) return null;
        const x = ms.reduce((a, c) => a + c.x, 0) / ms.length;
        const top = Math.min(...ms.map((c) => c.y - cardSize(c).h / 2));
        const col = `hsl(${cl.hue} 90% 65%)`;
        return (
          <div key={cl.id} className="cluster-label" style={{ left: x, top: top - 24, color: col, borderColor: col }}>
            {cl.label}（{ms.length}）
          </div>
        );
      })}
    </>
  );
}

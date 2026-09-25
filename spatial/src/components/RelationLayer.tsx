import { useEffect, useMemo, useRef } from 'react';
import { openWindow, set, useStore } from '../store';
import { engine } from '../lib/physics';
import { cardSize } from '../lib/semantic';
import { relLabel, relReading, relStyle } from '../lib/relStyle';
import type { Card, Relation } from '../types';

/** 矩形の中心から方向 (dx,dy) に伸ばした線が辺と交わる点 */
function edgePoint(cx: number, cy: number, hw: number, hh: number, dx: number, dy: number) {
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

interface Refs {
  path?: SVGPathElement | null;
  hit?: SVGPathElement | null;
  a?: SVGCircleElement | null;
  b?: SVGCircleElement | null;
  label?: SVGGElement | null;
}

export function RelationLayer() {
  const relations = useStore((s) => s.relations);
  const cards = useStore((s) => s.cards);
  const selection = useStore((s) => s.selection);
  const selectedRelation = useStore((s) => s.selectedRelation);
  const readOnly = useStore((s) => s.readOnly);
  const primary = useStore((s) => s.primary);
  const busy = useStore((s) => s.busy);
  // 言葉のセットや自分の言葉が変わったら描き直す
  useStore((s) => s.vocabulary);
  useStore((s) => s.relationWords);
  const refs = useRef(new Map<string, Refs>());

  const visible = useMemo(
    () =>
      relations.filter((r) => {
        const a = cards[r.from];
        const b = cards[r.to];
        return r.type !== 'axis-of' && a?.place === 'canvas' && b?.place === 'canvas';
      }),
    [relations, cards],
  );
  const latest = useRef<{ rels: Relation[]; cards: Record<string, Card> }>({ rels: visible, cards });
  latest.current = { rels: visible, cards };

  useEffect(
    () =>
      engine.subscribe(() => {
        const { rels, cards: cs } = latest.current;
        for (const r of rels) {
          const el = refs.current.get(r.id);
          const A = engine.get(r.from);
          const B = engine.get(r.to);
          if (!el?.path || !A || !B || !cs[r.from] || !cs[r.to]) continue;
          const sa = cardSize(cs[r.from]);
          const sb = cardSize(cs[r.to]);
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy);
          // 同じ位置に重なっている間（出現直後など）は線を描かない
          el.path.style.visibility = len < 1 ? 'hidden' : '';
          if (len < 1) continue;
          const ux = dx / len;
          const uy = dy / len;
          const p1 = edgePoint(A.x, A.y, (sa.w * A.s) / 2 + 4, (sa.h * A.s) / 2 + 4, ux, uy);
          const p2 = edgePoint(B.x, B.y, (sb.w * B.s) / 2 + 4, (sb.h * B.s) / 2 + 4, -ux, -uy);
          // ゆるく曲げて、線同士が重なりにくくする
          const bend = Math.min(60, len * 0.12);
          const mx = (p1.x + p2.x) / 2 - uy * bend;
          const my = (p1.y + p2.y) / 2 + ux * bend;
          const d = `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
          el.path.setAttribute('d', d);
          el.hit?.setAttribute('d', d);
          el.a?.setAttribute('cx', `${p1.x}`);
          el.a?.setAttribute('cy', `${p1.y}`);
          el.b?.setAttribute('cx', `${p2.x}`);
          el.b?.setAttribute('cy', `${p2.y}`);
          if (el.label) el.label.setAttribute('transform', `translate(${(p1.x + p2.x) / 4 + mx / 2},${(p1.y + p2.y) / 4 + my / 2})`);
        }
      }),
    [],
  );

  // 表示セットが変わったら即座に座標を反映
  useEffect(() => engine.notify(), [visible]);

  const focus = new Set(selection);
  // 見ているカード（選んでいるカード）。向きのある言葉はこのカードから読む
  const viewer = selection.length === 1 ? primary ?? selection[0] : null;
  const colors = [...new Set(visible.map((r) => relStyle(r.type).color))];
  const markerId = (color: string) => `rel-arrow-${color.replace('#', '')}`;
  return (
    <svg className="world-svg" style={{ zIndex: 0 }}>
      <defs>
        <filter id="rel-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {colors.map((color) => (
          <marker key={color} id={markerId(color)} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        ))}
      </defs>
      {visible.map((r) => {
        const st = relStyle(r.type);
        const reading = relReading(r, viewer);
        const chosen = selectedRelation === r.id;
        const on = chosen || focus.has(r.from) || focus.has(r.to);
        const faded = focus.size > 0 && !on;
        const judging = Boolean(busy[`judge:${r.id}`]);
        const showLabel = chosen || r.suggested || judging || (Boolean(reading.word) && !faded) || (r.type === 'compared-with' && !faded);
        const text = judging ? '…' : r.suggested ? `? ${reading.text}` : reading.text;
        // 矢印は読む向き：見ているカードが矢印の先なら、根元側に付け替える
        const arrow = reading.directed ? `url(#${markerId(st.color)})` : undefined;
        const setRef = (k: keyof Refs) => (el: SVGElement | null) => {
          const cur = refs.current.get(r.id) ?? {};
          (cur as Record<string, unknown>)[k] = el;
          refs.current.set(r.id, cur);
        };
        return (
          <g key={r.id} opacity={faded ? 0.18 : r.suggested ? 0.95 : on ? 1 : 0.6}>
            <path
              ref={setRef('path')}
              fill="none"
              stroke={st.color}
              strokeWidth={chosen ? 3.4 : on ? 2.6 : 1.6}
              strokeDasharray={r.suggested ? '5 6' : st.dash}
              strokeLinecap="round"
              markerEnd={reading.reversed ? undefined : arrow}
              markerStart={reading.reversed ? arrow : undefined}
              filter={on || r.suggested ? 'url(#rel-glow)' : undefined}
              className={r.suggested ? 'rel-suggested' : undefined}
            />
            <path
              ref={setRef('hit')}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                set({ selectedRelation: r.id, selection: [], primary: null });
                if (!readOnly || r.label) openWindow('relation', [r.to], { relationId: r.id });
              }}
            >
              <title>{r.label ? `${relLabel(r.type)} — ${r.label}` : relLabel(r.type)}</title>
            </path>
            {/* 矢印の付いた端には点を打たない */}
            <circle ref={setRef('a')} r={reading.directed && reading.reversed ? 0 : on ? 4 : 3} fill={st.color} />
            <circle ref={setRef('b')} r={reading.directed && !reading.reversed ? 0 : on ? 4 : 3} fill={st.color} />
            {showLabel && (
              <g ref={setRef('label')} style={{ pointerEvents: 'none' }}>
                <rect x={-text.length * 6 - 10} y={-10} width={text.length * 12 + 20} height={20} rx={10} fill="var(--panel-strong)" stroke={st.color} strokeWidth={1} />
                <text textAnchor="middle" dy={4} fontSize={11} fill={st.color} fontWeight={600}>
                  {text}
                </text>
              </g>
            )}
          </g>
        );
      })}
      <style>{`.rel-suggested{animation:dash 1.2s linear infinite}@keyframes dash{to{stroke-dashoffset:-22}}`}</style>
    </svg>
  );
}

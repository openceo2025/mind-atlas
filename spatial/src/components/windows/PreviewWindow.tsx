import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AXIS_KEYS, AXIS_NAME, applyAxes, closeWindow, isAxisCard, lookup, useStore } from '../../store';
import { computeScores } from '../../lib/semantic';
import { t } from '../../i18n';
import type { Axes, Card, FloatWin } from '../../types';
import { Icon } from '../Icons';

const KIND_COLOR: Record<string, string> = {
  document: '#8fb4ff',
  article: '#ff8a7a',
  image: '#3f8cff',
  dataset: '#27d0a0',
  company: '#27d0a0',
  person: '#34c3ff',
  summary: '#6ae3ff',
  idea: '#ffc15c',
  hypothesis: '#b598ff',
  issue: '#ff6b7a',
  quote: '#4fd8ff',
  group: '#ffb347',
  topic: '#6ae3ff',
  note: '#8fa6ff',
  link: '#4fd8ff',
};

const W = 170;
const H = 120;

function plot(cards: Card[], axes: Axes) {
  const s = computeScores(cards, axes, lookup).values;
  const out = new Map<string, { x: number; y: number; r: number; o: number }>();
  for (const c of cards) {
    const p = s.get(c.id)!;
    // X/Y を平面に、Z（手前ほど大きく明るく）を点の大きさで表す
    out.set(c.id, { x: 12 + p.sx * (W - 24) + (p.sz - 0.5) * 18, y: H - 12 - p.sy * (H - 24) + (p.sz - 0.5) * 12, r: 2.5 + p.sz * 3, o: 0.45 + p.sz * 0.55 });
  }
  return out;
}

const quadrant = (p: { x: number; y: number }) => t(`preview.q.${p.y < H / 2 ? 'top' : 'bottom'}${p.x < W / 2 ? 'Left' : 'Right'}` as 'preview.q.topLeft');

export function PreviewWindow({ win }: { win: FloatWin }) {
  const cards = useStore((s) => s.cards);
  const axes = useStore((s) => s.axes);
  const draft = useStore((s) => s.draftAxes);
  const target = draft ?? axes;

  const pool = useMemo(
    () => Object.values(cards).filter((c) => c.place === 'canvas' && !isAxisCard(c.id, axes) && !isAxisCard(c.id, target)),
    [cards, axes, target],
  );
  const before = useMemo(() => plot(pool, axes), [pool, axes]);
  const after = useMemo(() => plot(pool, target), [pool, target]);
  const movers = pool
    .map((c) => ({ c, d: Math.hypot(before.get(c.id)!.x - after.get(c.id)!.x, before.get(c.id)!.y - after.get(c.id)!.y) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 3);
  const changed = AXIS_KEYS.filter((k) => axes[k] !== target[k]);
  const label = (a: Axes) => AXIS_KEYS.map((k) => cards[a[k]]?.title ?? '?').join(' · ');

  const box = (pts: typeof before, ghost?: typeof before) => (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <line x1={10} y1={H - 10} x2={W - 6} y2={H - 10} stroke="rgba(110,190,255,.35)" />
      <line x1={10} y1={H - 10} x2={10} y2={6} stroke="rgba(110,190,255,.35)" />
      <line x1={10} y1={H - 10} x2={34} y2={H - 26} stroke="rgba(110,190,255,.25)" />
      {ghost &&
        pool.map((c) => {
          const a = ghost.get(c.id)!;
          const b = pts.get(c.id)!;
          return <line key={`l-${c.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(106,227,255,.35)" strokeWidth={0.8} />;
        })}
      {pool.map((c) => {
        const p = pts.get(c.id)!;
        const from = ghost?.get(c.id);
        return (
          <motion.circle
            key={c.id}
            r={p.r}
            fill={KIND_COLOR[c.kind] ?? '#8fb4ff'}
            opacity={p.o}
            initial={from ? { cx: from.x, cy: from.y } : false}
            animate={{ cx: p.x, cy: p.y }}
            transition={{ duration: 1.1, ease: [0.3, 0.7, 0.2, 1], repeat: ghost ? Infinity : 0, repeatDelay: 1.2 }}
          />
        );
      })}
    </svg>
  );

  return (
    <>
      <div className="fwin-body">
        <div className="hint-block">{t('preview.intro')}</div>
        <div className="pv-grid">
          <div>
            <div className="pv-box">{box(before)}</div>
            <div className="pv-cap">
              {t('preview.before')}
              <small>{label(axes)}</small>
            </div>
          </div>
          <Icon name="arrowR" size={20} />
          <div>
            <div className="pv-box" style={{ borderColor: changed.length ? 'rgba(255,209,102,.6)' : undefined }}>
              {box(after, before)}
            </div>
            <div className="pv-cap">
              {t('preview.after')}
              <small>{label(target)}</small>
            </div>
          </div>
        </div>
        {changed.length ? (
          <div className="movers">
            <div>
              {t('preview.changes')}{' '}
              {changed.map((k) => (
                <b key={k} style={{ marginInlineEnd: 8 }}>
                  {AXIS_NAME(k)} {cards[axes[k]]?.title} → {cards[target[k]]?.title}
                </b>
              ))}
            </div>
            {movers.map(({ c }) => (
              <div key={c.id}>
                · <b>{c.title}</b>: {quadrant(before.get(c.id)!)} → {quadrant(after.get(c.id)!)}
              </div>
            ))}
          </div>
        ) : (
          <div className="movers">{t('preview.noChange')}</div>
        )}
      </div>
      <div className="fwin-foot">
        <button className="btn primary" style={{ flex: 1 }} disabled={!changed.length} onClick={() => applyAxes(target)}>
          <Icon name="refresh" size={14} /> {t('preview.apply')}
        </button>
        <button className="btn" onClick={() => closeWindow(win.id)}>
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}

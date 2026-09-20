import { Fragment, useEffect, useRef } from 'react';
import { AXIS_KEYS, useStore, applyAxes } from '../store';
import { AXIS_PRESETS } from '../data/concepts';
import { t } from '../i18n';
import type { Axes } from '../types';

/** 1〜6 の数字キーで呼べるプリセットなら、その番号を返す */
function presetKey(axes: Axes) {
  const index = AXIS_PRESETS.findIndex((preset) => preset.axes.every((key, i) => axes[AXIS_KEYS[i]] === `c-${key}`));
  return index < 0 ? null : index + 1;
}

/** 思考の軌跡：これまでに通った軸の組み合わせ。クリックでその見方に戻れる */
export function AxisTrail() {
  const trail = useStore((s) => s.trail);
  const axes = useStore((s) => s.axes);
  const cards = useStore((s) => s.cards);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' });
  }, [trail.length]);

  const same = (a: Axes) => a.x === axes.x && a.y === axes.y && a.z === axes.z;
  const name = (a: Axes) => [a.x, a.y, a.z].map((id) => (id ? cards[id]?.title.slice(0, 8) ?? '?' : '—')).join('×');
  const lastIdx = trail.map((item) => same(item.axes)).lastIndexOf(true);

  return (
    <div className="trail" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <span className="trail-label">{t('trail.title')}</span>
      {trail.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 && <span className="trail-sep">→</span>}
          <button
            className={`trail-item ${i === lastIdx ? 'current' : ''}`}
            onClick={() => applyAxes(item.axes, t('trail.restored', { name: name(item.axes) }))}
            title={[item.axes.x, item.axes.y, item.axes.z].map((id, j) => `${'XYZ'[j]}: ${cards[id]?.title}`).join('\n')}
          >
            {presetKey(item.axes) && <span className="trail-key">{presetKey(item.axes)}</span>}
            {name(item.axes)}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

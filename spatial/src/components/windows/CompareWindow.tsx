import { useMemo, useState } from 'react';
import { AXIS_KEYS, applyAxes, createConcept, extractText, focusCard, get, layoutCards, lookup, setAxis, useStore, AXIS_NAME } from '../../store';
import { compare } from '../../lib/ai';
import { cardText, computeScores } from '../../lib/semantic';
import { cosine, resolveVectors } from '../../lib/embeddings';
import { t } from '../../i18n';
import type { Card, FloatWin } from '../../types';
import { Icon, KindIcon, Visual } from '../Icons';
import { AiNotice, Spinner, useAiBlock, useAsync } from './common';

const COLS = [
  { letter: 'A', cls: 'a', color: '#3fa9ff' },
  { letter: 'B', cls: 'b', color: '#ffb347' },
  { letter: 'C', cls: 'c', color: '#a98bff' },
];

export function CompareWindow({ win }: { win: FloatWin }) {
  const cards = useStore((s) => s.cards);
  const axes = useStore((s) => s.axes);
  const readOnly = useStore((s) => s.readOnly);
  const [detail, setDetail] = useState(false);
  const list = win.cardIds.map((id) => cards[id]).filter(Boolean) as Card[];
  const block = useAiBlock();
  const axisLabels = AXIS_KEYS.map((k) => lookup(axes[k])?.title ?? '');
  const ai = useAsync(() => compare(list, axisLabels), [win.cardIds.join(), axes.x, axes.y, axes.z], !block && list.length >= 2);

  // いまの軸での位置（空間に並んでいるカード全体の中での相対位置）
  const positions = useMemo(() => {
    const pool = layoutCards(get());
    const set = pool.some((c) => list.some((l) => l.id === c.id)) ? pool : [...pool, ...list];
    return computeScores(set, axes, lookup).values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, axes]);

  const similarity = useMemo(() => {
    if (list.length < 2) return 0;
    const { vectors } = resolveVectors(list.slice(0, 2).map(cardText));
    return cosine(vectors[0], vectors[1]);
  }, [list]);

  if (list.length < 2) return <div className="fwin-body">{t('compare.missing')}</div>;

  const factLabels = [...new Set(list.flatMap((c) => c.facts?.map((f) => f.label) ?? []))].filter((l) => list.every((c) => c.facts?.some((f) => f.label === l)));
  const winnerOf = (label: string) => {
    const vals = list.map((c) => c.facts!.find((f) => f.label === label)!);
    if (vals.some((v) => v.num === undefined)) return -1;
    const better = vals[0].higherIsBetter !== false;
    let bi = 0;
    vals.forEach((v, i) => {
      if (better ? v.num! > vals[bi].num! : v.num! < vals[bi].num!) bi = i;
    });
    return bi;
  };

  const suggested = ai.data?.axis;
  const useSuggestedAxis = () => {
    if (!suggested?.label) return;
    const existing = Object.values(get().cards).find((c) => c.kind === 'concept' && c.title === suggested.label);
    const concept = existing ?? createConcept(suggested.label, suggested.low, suggested.high);
    setAxis('x', concept.id, false);
  };

  const extractGap = () => {
    const text = ai.data?.comment || t('compare.gapFallback', { a: list[0].title, b: list[1].title });
    extractText(list[0].id, text, 'issue');
  };

  return (
    <>
      <div className="fwin-body">
        {Boolean(win.data?.picked) && (
          <div className="ai-note" style={{ marginTop: 0, marginBottom: 10 }}>
            <Icon name="sparkle" size={16} />
            <span>{t('compare.picked', { n: Math.round(Math.max(0, similarity) * 100) })}</span>
          </div>
        )}
        <div className="cmp-grid" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0,1fr))` }}>
          {list.map((c, i) => {
            const col = COLS[i];
            const pos = positions.get(c.id);
            return (
              <div key={c.id} className={`cmp-col ${col.cls}`}>
                <div className="cmp-head">
                  <span className="letter" style={{ color: col.color }}>
                    {col.letter}
                  </span>
                  <button style={{ display: 'block', textAlign: 'start' }} onClick={() => focusCard(c.id)}>
                    <b>{c.title}</b>
                  </button>
                </div>
                <div className="cmp-thumb">
                  {c.image ? (
                    <img src={c.image} alt="" />
                  ) : c.visual ? (
                    <Visual kind={c.visual} id={`${win.id}-${c.id}`} />
                  ) : (
                    <div className="cmp-thumb-fallback">
                      <KindIcon card={c} />
                      <small>{c.subtitle ?? ''}</small>
                    </div>
                  )}
                </div>
                <div className="cmp-facts">
                  {factLabels.map((l) => {
                    const f = c.facts!.find((x) => x.label === l)!;
                    return (
                      <div key={l} className="cmp-fact">
                        <span>{l}</span>
                        <b className={winnerOf(l) === i ? 'win' : ''}>{f.value}</b>
                      </div>
                    );
                  })}
                  <div className="cmp-score">
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>{t('compare.positionOnAxes')}</div>
                    {AXIS_KEYS.map((k) => {
                      const v = pos ? (k === 'x' ? pos.sx : k === 'y' ? pos.sy : pos.sz) : 0.5;
                      return (
                        <div key={k} className="axis-meter">
                          <span title={lookup(axes[k])?.title}>{AXIS_NAME(k)}</span>
                          <div className="meter">
                            <i style={{ width: `${Math.round(v * 100)}%`, background: col.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hint-inline" style={{ marginTop: 6 }}>
          {t('compare.positionNote', { axes: axisLabels.join(' / ') })}
        </div>

        {block ? (
          <div style={{ marginTop: 10 }}>
            <AiNotice block={block} compact />
          </div>
        ) : ai.loading ? (
          <Spinner />
        ) : ai.error ? (
          <div className="ai-note warn">{ai.error}</div>
        ) : ai.data ? (
          <>
            <div className="ai-note">
              <Icon name="sparkle" size={16} />
              <span>{ai.data.comment}</span>
            </div>
            <button className="btn small ghost" style={{ width: '100%', marginTop: 8, color: 'var(--accent-2)' }} onClick={() => setDetail((v) => !v)}>
              {t('compare.analysis')} <Icon name={detail ? 'chevronD' : 'chevronR'} size={13} />
            </button>
            {detail && (
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th />
                    {list.map((c, i) => (
                      <th key={c.id} style={{ color: COLS[i].color }}>
                        {COLS[i].letter}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ai.data.rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      {list.map((c, i) => (
                        <td key={c.id} className={row.best === i ? 'win' : ''}>
                          {row.values[i] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {suggested?.label && (
              <div className="ai-note gold">
                <Icon name="axis" size={16} />
                <span>{t('compare.axisSuggestion', { label: suggested.label, low: suggested.low, high: suggested.high })}</span>
              </div>
            )}
          </>
        ) : null}
      </div>
      {!readOnly && (
        <div className="fwin-foot">
          <button className="btn small" onClick={extractGap} title={t('compare.extractGapTip')}>
            <Icon name="extract" size={13} /> {t('compare.extractGap')}
          </button>
          <button className="btn small" onClick={useSuggestedAxis} disabled={!suggested?.label} title={t('compare.useAxisTip')}>
            <Icon name="axis" size={13} /> {t('compare.useAxis')}
          </button>
          <button className="btn small ghost" style={{ marginInlineStart: 'auto' }} onClick={() => applyAxes({ ...axes, x: axes.y, y: axes.x })} title={t('compare.swapTip')}>
            {t('compare.swap')}
          </button>
        </div>
      )}
    </>
  );
}

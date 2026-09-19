import { useState } from 'react';
import { extractText, focusCard, placeCard, revealCard, saveSummaryCard, updateWindowData, useStore } from '../../store';
import { summarize, type Lens, type SummaryResult } from '../../lib/ai';
import { clientToWorld, startGhostDrag } from '../../lib/drag';
import { formatDateTime, t } from '../../i18n';
import type { Card, FloatWin } from '../../types';
import { Icon, KindIcon } from '../Icons';
import { AiNotice, Spinner, useAiBlock, useAsync, useTyping } from './common';

const LENSES: Lens[] = ['points', 'risk', 'opportunity'];

/** AI が使えないときの簡易要約：各カードの冒頭の文を拾う */
function extractiveSummary(cards: Card[]): SummaryResult {
  const points = cards
    .flatMap((c) =>
      c.body
        .split(/\n|(?<=[。.!?！？])\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 6)
        .slice(0, 2)
        .map((text) => ({ text, sourceId: c.id })),
    )
    .slice(0, 5);
  return { lead: t('summary.extractiveLead', { n: cards.length }), points, tags: [...new Set(cards.flatMap((c) => c.tags))].slice(0, 4) };
}

export function SummaryWindow({ win }: { win: FloatWin }) {
  const cards = useStore((s) => s.cards);
  const readOnly = useStore((s) => s.readOnly);
  const lens = (win.data?.lens as Lens) ?? 'points';
  const gen = (win.data?.gen as number) ?? 0;
  const at = (win.data?.at as number) ?? Date.now();
  const targets = win.cardIds.map((id) => cards[id]).filter(Boolean) as Card[];
  const expanded = targets.flatMap((c) => (c.kind === 'group' && c.members ? c.members.map((m) => cards[m]).filter(Boolean) : [c]));
  const block = useAiBlock();
  const key = win.cardIds.join();
  const ai = useAsync(() => summarize(expanded, lens, gen), [key, lens, gen], !block);
  const result: SummaryResult = block ? extractiveSummary(expanded) : ai.data ?? { lead: '', points: [], tags: [] };
  const { shown, done } = useTyping(result.lead, `${lens}-${gen}-${Boolean(ai.data)}`);
  const [pulled, setPulled] = useState<string[]>([]);

  const pull = (text: string, sourceId: string | undefined, pos?: { x: number; y: number }) => {
    const src = sourceId && cards[sourceId] ? sourceId : win.cardIds[0];
    const id = extractText(src, text);
    if (id && pos) placeCard(id, pos.x, pos.y);
    setPulled((p) => [...p, text]);
  };

  return (
    <>
      <div className="fwin-body">
        <div className="meta-line">
          {t('summary.updated', { time: formatDateTime(at) })} · {t(`summary.lens.${lens}` as 'summary.lens.points')}
        </div>
        {block && <AiNotice block={block} compact />}
        {ai.loading && !block ? (
          <Spinner />
        ) : ai.error && !block ? (
          <div className="ai-note warn">{ai.error}</div>
        ) : (
          <>
            <p className={`lead ${done ? '' : 'caret'}`}>{shown}</p>
            <div className="sec-title">
              <span>{t('summary.points')}</span>
              {!readOnly && <span className="hint-inline">{t('summary.dragHint')}</span>}
            </div>
            <ul className="points">
              {result.points.map((p, i) => (
                <li
                  key={`${i}-${p.text}`}
                  className="point"
                  style={{ opacity: done ? (pulled.includes(p.text) ? 0.45 : 1) : 0.25, transition: `opacity .3s ${i * 0.08}s` }}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    const src = (p.sourceId && cards[p.sourceId]) || targets[0];
                    if (!src) return;
                    startGhostDrag(e, { ...src, title: p.text }, {
                      onDrop: (target, cx, cy) => {
                        if (target !== 'canvas') return false;
                        pull(p.text, p.sourceId, clientToWorld(cx, cy));
                        return true;
                      },
                    });
                  }}
                >
                  <span className="num">{i + 1}</span>
                  <span style={{ flex: 1 }}>{p.text}</span>
                  {!readOnly && (
                    <button className="pull" onPointerDown={(e) => e.stopPropagation()} onClick={() => pull(p.text, p.sourceId)} title={t('summary.extractPoint')}>
                      {t('radial.extract')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sec-title">{t('summary.sources', { n: expanded.length })}</div>
        {expanded.slice(0, 12).map((c) => (
          <button key={c.id} className="src-row" onClick={() => (c.place === 'hidden' ? revealCard(c.id) : focusCard(c.id))}>
            <KindIcon card={c} />
            <span>{c.title}</span>
            <Icon name="chevronR" size={14} />
          </button>
        ))}
        {result.tags.length > 0 && (
          <div className="tags" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {result.tags.map((tag) => (
              <span key={tag} className="tag">
                #{tag.replace(/^#/, '')}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="fwin-foot">
        <div className="seg">
          {LENSES.map((l) => (
            <button key={l} className={l === lens ? 'on' : ''} disabled={Boolean(block)} onClick={() => updateWindowData(win.id, { lens: l, at: Date.now() })}>
              {t(`summary.lens.${l}` as 'summary.lens.points')}
            </button>
          ))}
        </div>
        <button className="btn small" disabled={Boolean(block) || ai.loading} onClick={() => updateWindowData(win.id, { gen: gen + 1, at: Date.now() })} title={t('summary.rerunTip')}>
          <Icon name="refresh" size={13} /> {t('summary.rerun')}
        </button>
        {!readOnly && (
          <button
            className="btn small primary"
            style={{ marginInlineStart: 'auto' }}
            disabled={!result.points.length}
            onClick={() => saveSummaryCard(win.cardIds, targets.length === 1 ? targets[0].title : t('summary.manyTitle', { n: targets.length }), [result.lead, ...result.points.map((p) => `・${p.text}`)].join('\n'))}
            title={t('summary.saveTip')}
          >
            {t('summary.save')}
          </button>
        )}
      </div>
    </>
  );
}

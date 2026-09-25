import { useMemo } from 'react';
import { acceptRelation, addRelation, dismissRelation, revealCard, set, setBusy, suggestRelations, useStore } from '../../store';
import { relSentence, relStyle, vocabularyOf } from '../../lib/relStyle';
import { infer, type Finding } from '../../lib/inference';
import { t } from '../../i18n';
import type { Card, FloatWin } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, Spinner, useAiBlock } from './common';

export function RelationsWindow({ win }: { win: FloatWin }) {
  const relations = useStore((s) => s.relations);
  const cards = useStore((s) => s.cards);
  const busy = useStore((s) => s.busy.relations);
  const block = useAiBlock();
  const sugg = relations.filter((r) => r.suggested);

  const rerun = (focus?: string[]) => {
    setBusy('relations', true);
    void suggestRelations(focus, !block).finally(() => setBusy('relations', false));
  };

  return (
    <>
      <div className="fwin-body">
        <p className="hint-block">{block ? t('relations.introBasic') : t('relations.intro')}</p>
        {block && block !== 'readonly' && <AiNotice block={block} compact />}
        {busy && <Spinner label={t('relations.searching')} />}
        {!busy && sugg.length === 0 && <div className="empty-note">{t('relations.none')}</div>}
        {sugg.map((r) => {
          const a = cards[r.from];
          const b = cards[r.to];
          if (!a || !b) return null;
          return (
            <div key={r.id} className="sugg">
              <div className="sugg-head">
                <button onClick={() => revealCard(a.id)}>{a.title}</button>
                <span className="rel-type">↔</span>
                <button onClick={() => revealCard(b.id)}>{b.title}</button>
              </div>
              <p className="rel-say" style={{ borderColor: relStyle(r.type).color }}>
                {relSentence(r, { from: a.title, to: b.title })}
              </p>
              {r.label && <p>{r.label}</p>}
              <div className="row-gap">
                <button className="btn small primary" onClick={() => acceptRelation(r.id)}>
                  {t('relations.accept')}
                </button>
                <button className="btn small" onClick={() => dismissRelation(r.id)}>
                  {t('relations.dismiss')}
                </button>
              </div>
            </div>
          );
        })}
        <Inference />
      </div>
      <div className="fwin-foot">
        <button className="btn small" disabled={busy} onClick={() => rerun(win.cardIds)}>
          <Icon name="refresh" size={12} /> {t('relations.rerunSelected')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => rerun(undefined)}>
          {t('relations.rerunAll')}
        </button>
        <button className="btn small primary" style={{ marginInlineStart: 'auto' }} disabled={!sugg.length} onClick={() => sugg.forEach((r) => acceptRelation(r.id))}>
          {t('relations.acceptAll')}
        </button>
      </div>
    </>
  );
}

const title = (cards: Record<string, Card>, id: string) => cards[id]?.title ?? '?';

function findingText(f: Finding, cards: Record<string, Card>) {
  const path = f.cards.map((id) => title(cards, id)).join(' → ');
  if (f.kind === 'inconsistent') return t('infer.inconsistent', { a: title(cards, f.cards[0]) });
  if (f.kind === 'maybeConflict') return t('infer.maybeConflict', { a: title(cards, f.cards[0]), b: title(cards, f.cards[1]) });
  if (f.kind === 'rootCause') return t('infer.rootCause', { a: title(cards, f.cards[0]) });
  return f.loop === 'reinforcing' ? t('infer.loopReinforcing', { path: `${path} → ${title(cards, f.cards[0])}` }) : t('infer.loopBalancing', { path: `${path} → ${title(cards, f.cards[0])}` });
}

/** 今ある線の言葉から計算して言えること（演繹は「必ず」、論証をはさむと「たぶん」） */
function Inference() {
  const relations = useStore((s) => s.relations);
  const cards = useStore((s) => s.cards);
  const readOnly = useStore((s) => s.readOnly);
  const vocabulary = useStore((s) => vocabularyOf(s));
  useStore((s) => s.relationWords);
  const result = useMemo(() => infer(relations.filter((r) => !r.suggested && cards[r.from] && cards[r.to]), vocabulary), [relations, cards, vocabulary]);
  const byId = new Map(relations.map((r) => [r.id, r]));
  // 根拠になった線を、カードの名前でたどって見せる
  const via = (because: string[]) => {
    const steps: string[] = [];
    for (const id of because) {
      const r = byId.get(id);
      if (!r) continue;
      steps.push(relSentence(r, { from: title(cards, r.from), to: title(cards, r.to) }));
    }
    return steps.join(' / ');
  };
  const show = (ids: string[]) => {
    set({ highlight: ids });
    window.setTimeout(() => set({ highlight: [] }), 1600);
    revealCard(ids[0]);
  };
  const empty = !result.derived.length && !result.findings.length;
  return (
    <>
      <div className="sec-title" style={{ marginTop: 14 }}>
        {t('infer.title')}
      </div>
      <p className="hint-block">{t('infer.intro')}</p>
      {empty && <div className="empty-note">{t('infer.none')}</div>}
      {result.findings.map((f, i) => (
        <div key={`f${i}`} className="sugg">
          <p style={{ color: f.kind === 'inconsistent' ? 'var(--danger)' : undefined, fontWeight: 600 }}>{findingText(f, cards)}</p>
          <p className="hint-block">{t('infer.via', { path: via(f.because) })}</p>
          <div className="row-gap">
            <button className="btn small" onClick={() => show(f.cards)}>
              {t('infer.show')}
            </button>
          </div>
        </div>
      ))}
      {result.derived.map((d) => (
        <div key={`${d.from}|${d.to}|${d.type}`} className="sugg">
          <p className="rel-say" style={{ borderColor: relStyle(d.type).color }}>
            <span className="rel-type" style={{ marginInlineEnd: 6 }}>{d.strict ? t('infer.strict') : t('infer.weak')}</span>
            {relSentence(d, { from: title(cards, d.from), to: title(cards, d.to) })}
          </p>
          <p className="hint-block">{t('infer.via', { path: via(d.because) })}</p>
          <div className="row-gap">
            {!readOnly && (
              <button className="btn small primary" onClick={() => addRelation(d.from, d.to, d.type)}>
                {t('infer.adopt')}
              </button>
            )}
            <button className="btn small" onClick={() => show([d.from, d.to])}>
              {t('infer.show')}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

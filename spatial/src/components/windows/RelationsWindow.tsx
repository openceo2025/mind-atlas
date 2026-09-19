import { acceptRelation, dismissRelation, revealCard, setBusy, suggestRelations, useStore } from '../../store';
import { REL_STYLE, relLabel } from '../../lib/relStyle';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
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
                <span className="rel-type" style={{ color: REL_STYLE[r.type].color }}>
                  {relLabel(r.type)} →
                </span>
                <button onClick={() => revealCard(b.id)}>{b.title}</button>
              </div>
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

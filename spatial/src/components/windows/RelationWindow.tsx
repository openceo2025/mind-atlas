import { closeWindow, removeRelation, revealCard, updateRelation, useStore } from '../../store';
import { REL_STYLE, relLabel } from '../../lib/relStyle';
import { t } from '../../i18n';
import { USER_RELATION_TYPES, type FloatWin } from '../../types';
import { Icon } from '../Icons';

/** 1本の関係線の種類・メモを変える小窓 */
export function RelationWindow({ win }: { win: FloatWin }) {
  const relId = win.data?.relationId as string | undefined;
  const rel = useStore((s) => s.relations.find((r) => r.id === relId));
  const cards = useStore((s) => s.cards);
  const readOnly = useStore((s) => s.readOnly);
  if (!rel) return <div className="fwin-body">{t('relation.missing')}</div>;
  const a = cards[rel.from];
  const b = cards[rel.to];
  return (
    <>
      <div className="fwin-body">
        <div className="rel-ends">
          <button className="ellipsis" onClick={() => a && revealCard(a.id)}>
            {a?.title}
          </button>
          <Icon name="arrowR" size={14} />
          <button className="ellipsis" onClick={() => b && revealCard(b.id)}>
            {b?.title}
          </button>
        </div>
        {readOnly ? (
          <p>
            <b style={{ color: REL_STYLE[rel.type].color }}>{relLabel(rel.type)}</b> {rel.label}
          </p>
        ) : (
          <>
            <div className="chips" style={{ marginTop: 10 }}>
              {USER_RELATION_TYPES.map((type) => (
                <button key={type} className={`chip rel ${rel.type === type ? 'on' : ''}`} style={{ borderColor: REL_STYLE[type].color, color: rel.type === type ? '#fff' : REL_STYLE[type].color, background: rel.type === type ? REL_STYLE[type].color : undefined }} onClick={() => updateRelation(rel.id, { type })}>
                  {relLabel(type)}
                </button>
              ))}
            </div>
            <input className="input" style={{ marginTop: 10 }} defaultValue={rel.label ?? ''} placeholder={t('relation.notePlaceholder')} onBlur={(e) => e.target.value !== (rel.label ?? '') && updateRelation(rel.id, { label: e.target.value.trim() || undefined })} />
          </>
        )}
      </div>
      {!readOnly && (
        <div className="fwin-foot">
          <button className="btn small danger" onClick={() => (removeRelation(rel.id), closeWindow(win.id))}>
            <Icon name="trash" size={12} /> {t('relation.delete')}
          </button>
          <button className="btn small primary" style={{ marginInlineStart: 'auto' }} onClick={() => closeWindow(win.id)}>
            {t('common.done')}
          </button>
        </div>
      )}
    </>
  );
}

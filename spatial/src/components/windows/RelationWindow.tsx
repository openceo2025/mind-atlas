import { useState } from 'react';
import { addRelationWord, chooseRelationWord, closeWindow, flipRelation, removeRelation, revealCard, setVocabulary, updateRelation, useStore } from '../../store';
import { activeWords, relSentence, relStyle, shownWord, vocabularyName, vocabularyOf, type WordView } from '../../lib/relStyle';
import { CUSTOM_COLORS, VOCABULARY_IDS, WORD_GROUPS } from '../../lib/relationCatalog';
import { t, type MessageKey } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { Spinner } from './common';

function WordChip({ word, on, onPick }: { word: WordView; on: boolean; onPick: () => void }) {
  return (
    <button
      className={`chip rel ${on ? 'on' : ''}`}
      style={{ borderColor: word.color, color: on ? '#fff' : word.color, background: on ? word.color : undefined, borderStyle: word.dash ? 'dashed' : undefined }}
      title={word.directed ? `${word.label} ⇄ ${word.back}` : word.label}
      onClick={onPick}
    >
      {word.label}
      {word.directed && <span style={{ opacity: 0.7 }}> / {word.back}</span>}
    </button>
  );
}

/** 自分の言葉をつくる小さなフォーム */
function NewWordForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('');
  const [back, setBack] = useState('');
  const [meaning, setMeaning] = useState('');
  const [directed, setDirected] = useState(true);
  const [color, setColor] = useState(CUSTOM_COLORS[0]);
  const create = () => {
    const id = addRelationWord({ label, back: directed ? back : undefined, meaning, directed, color });
    if (id) onCreated(id);
  };
  return (
    <div className="new-word">
      <input className="input" value={label} maxLength={24} placeholder={t('word.new.label')} onChange={(e) => setLabel(e.target.value)} />
      <label className="toggle" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={directed} onChange={(e) => setDirected(e.target.checked)} />
        {t('word.new.directed')}
      </label>
      {directed && <input className="input" style={{ marginTop: 6 }} value={back} maxLength={24} placeholder={t('word.new.back')} onChange={(e) => setBack(e.target.value)} />}
      <input className="input" style={{ marginTop: 6 }} value={meaning} maxLength={200} placeholder={t('word.new.meaning')} onChange={(e) => setMeaning(e.target.value)} />
      <div className="row-gap" style={{ marginTop: 6, alignItems: 'center' }}>
        {CUSTOM_COLORS.map((c) => (
          <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
        <button className="btn small primary" style={{ marginInlineStart: 'auto' }} disabled={!label.trim()} onClick={create}>
          <Icon name="plus" size={12} /> {t('word.new.create')}
        </button>
      </div>
      <p className="hint-block" style={{ marginTop: 6 }}>{t('word.new.note')}</p>
    </div>
  );
}

/** 1本の関係線の言葉・向き・メモを変える小窓 */
export function RelationWindow({ win }: { win: FloatWin }) {
  const relId = win.data?.relationId as string | undefined;
  const rel = useStore((s) => s.relations.find((r) => r.id === relId));
  const cards = useStore((s) => s.cards);
  const readOnly = useStore((s) => s.readOnly);
  const judging = useStore((s) => Boolean(relId && s.busy[`judge:${relId}`]));
  useStore((s) => s.relationWords);
  const vocabulary = useStore((s) => vocabularyOf(s));
  const [making, setMaking] = useState(false);
  if (!rel) return <div className="fwin-body">{t('relation.missing')}</div>;
  const a = cards[rel.from];
  const b = cards[rel.to];
  const titles = { from: a?.title ?? '', to: b?.title ?? '' };
  const current = shownWord(rel.type);
  const words = activeWords();
  const groups = WORD_GROUPS[vocabulary];
  const custom = words.filter((w) => w.custom);
  const pick = (id: string) => chooseRelationWord(rel.id, id);
  const chip = (w: WordView) => <WordChip key={w.id} word={w} on={current?.id === w.id} onPick={() => pick(w.id)} />;
  // いまの線の言葉がこのセットに無い（別のセットで引いた）ときも、選ばれていることが分かるように出す
  const foreign = current && !words.some((w) => w.id === current.id) ? current : null;

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
          {!readOnly && current?.directed && (
            <button className="icon-btn small" onClick={() => flipRelation(rel.id)} title={t('relation.flip')} aria-label={t('relation.flip')}>
              <Icon name="refresh" size={12} />
            </button>
          )}
        </div>

        {current ? (
          <div className="rel-say" style={{ borderColor: relStyle(rel.type).color }}>
            <div>{relSentence(rel, titles)}</div>
            {current.directed && <div className="rel-say-back">{relSentence(rel, titles, rel.to)}</div>}
          </div>
        ) : (
          !judging && <p className="hint-block" style={{ marginTop: 8 }}>{readOnly ? t('relation.noWord') : t('relation.pickWord')}</p>
        )}
        {judging && <Spinner label={t('relation.judging')} />}
        {!judging && rel.judged !== undefined && <div className="rel-judged">{t('relation.judgedBy', { n: Math.round(rel.judged * 100) })}</div>}

        {readOnly ? (
          rel.label && <p>{rel.label}</p>
        ) : (
          <>
            <div className="seg" style={{ marginTop: 10 }} role="tablist" aria-label={t('vocab.title')}>
              {VOCABULARY_IDS.map((id) => (
                <button key={id} className={id === vocabulary ? 'on' : ''} onClick={() => setVocabulary(id)}>
                  {vocabularyName(id)}
                </button>
              ))}
            </div>
            {groups ? (
              groups.map(([group, ids]) => (
                <div key={group}>
                  <div className="word-group">{t(`vocab.group.${group}` as MessageKey)}</div>
                  <div className="chips">{words.filter((w) => ids.includes(w.id)).map(chip)}</div>
                </div>
              ))
            ) : (
              <div className="chips" style={{ marginTop: 10 }}>
                {words.filter((w) => !w.custom).map(chip)}
              </div>
            )}
            {(custom.length > 0 || foreign) && (
              <>
                <div className="word-group">{t('vocab.group.mine')}</div>
                <div className="chips">
                  {custom.map(chip)}
                  {foreign && chip(foreign)}
                </div>
              </>
            )}
            {making ? (
              <NewWordForm
                onCreated={(id) => {
                  pick(id);
                  setMaking(false);
                }}
              />
            ) : (
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setMaking(true)}>
                <Icon name="plus" size={12} /> {t('word.new.open')}
              </button>
            )}
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

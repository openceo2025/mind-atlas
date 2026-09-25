import { useState } from 'react';
import { activeWords, relLabel, relStyle, vocabularyHint, vocabularyName, vocabularyOf, type WordView } from '../lib/relStyle';
import { VOCABULARY_IDS, WORD_GROUPS } from '../lib/relationCatalog';
import { openWindow, removeRelationWord, setVocabulary, useStore } from '../store';
import { t, type MessageKey } from '../i18n';

/** アプリが自分で引く線（言葉ではない） */
const SYSTEM: string[] = ['related', 'derived', 'source', 'contains'];

function Line({ color, dash, arrow }: { color: string; dash: string; arrow?: boolean }) {
  return (
    <svg width="30" height="8" style={{ flex: 'none' }}>
      <line x1="1" y1="4" x2={arrow ? 24 : 29} y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" />
      {arrow && <path d="M23,0.5 L29,4 L23,7.5 z" fill={color} />}
    </svg>
  );
}

function WordRow({ word, onRemove }: { word: WordView; onRemove?: () => void }) {
  return (
    <div className="legend-row">
      <Line color={word.color} dash={word.dash} arrow={word.directed} />
      <span>
        {word.label}
        {word.directed && <span style={{ color: 'var(--text-3)' }}> ⇄ {word.back}</span>}
      </span>
      {onRemove && (
        <button className="chip-x" onClick={onRemove} title={t('word.remove')} aria-label={t('word.remove')}>
          ×
        </button>
      )}
    </div>
  );
}

export function Legend() {
  const [open, setOpen] = useState(false);
  const vocabulary = useStore((s) => vocabularyOf(s));
  const readOnly = useStore((s) => s.readOnly);
  useStore((s) => s.relationWords);
  const words = activeWords();
  const groups = WORD_GROUPS[vocabulary];
  return (
    <div className="legend" onPointerDown={(e) => e.stopPropagation()}>
      <button className="legend-head" onClick={() => setOpen((v) => !v)}>
        <span>
          {t('legend.title')} · {vocabularyName(vocabulary)}
        </span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <>
          {!readOnly && (
            <div className="seg" role="tablist" aria-label={t('vocab.title')}>
              {VOCABULARY_IDS.map((id) => (
                <button key={id} className={id === vocabulary ? 'on' : ''} onClick={() => setVocabulary(id)}>
                  {vocabularyName(id)}
                </button>
              ))}
            </div>
          )}
          <div className="legend-hint">{vocabularyHint(vocabulary)}</div>
          <div className="legend-words">
            {groups
              ? groups.map(([group, ids]) => (
                  <div key={group}>
                    <div className="legend-hint" style={{ marginTop: 4 }}>
                      {t(`vocab.group.${group}` as MessageKey)}
                    </div>
                    {words
                      .filter((w) => ids.includes(w.id))
                      .map((w) => (
                        <WordRow key={w.id} word={w} />
                      ))}
                  </div>
                ))
              : words.filter((w) => !w.custom).map((w) => <WordRow key={w.id} word={w} />)}
            {words.some((w) => w.custom) && (
              <div className="legend-hint" style={{ marginTop: 4 }}>
                {t('vocab.group.mine')}
              </div>
            )}
            {words
              .filter((w) => w.custom)
              .map((w) => (
                <WordRow key={w.id} word={w} onRemove={readOnly ? undefined : () => removeRelationWord(w.id)} />
              ))}
          </div>
          <div className="legend-hint" style={{ marginTop: 4 }}>
            {t('legend.readFrom')}
          </div>
          <button className="btn small" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => openWindow('relations', [])}>
            {t('legend.infer')}
          </button>
          <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
          {SYSTEM.map((type) => (
            <div key={type} className="legend-row">
              <Line {...relStyle(type)} />
              {relLabel(type)}
            </div>
          ))}
          <div className="legend-row">
            <Line color="#6ae3ff" dash="5 6" />
            {t('legend.suggested')}
          </div>
          <div className="legend-row" style={{ marginTop: 4 }}>
            <span style={{ display: 'inline-flex', gap: 2, width: 30 }}>
              {[0, 1, 2].map((i) => (
                <i key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-2)' }} />
              ))}
            </span>
            {t('legend.meaning')}
          </div>
          <div className="legend-row">
            <span style={{ width: 30, display: 'inline-flex', justifyContent: 'center', color: 'var(--gold)' }}>✋</span>
            {t('legend.human')}
          </div>
          <div className="legend-row">
            <span style={{ width: 30, height: 10, border: '1.5px solid var(--gold)', borderRadius: 3 }} />
            {t('legend.axis')}
          </div>
        </>
      )}
    </div>
  );
}

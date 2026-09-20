import { useEffect, useMemo, useRef } from 'react';
import {
  AXIS_KEYS,
  AXIS_NAME,
  axisKeyOf,
  beginCardEdit,
  clearOverrides,
  endCardEdit,
  deleteCards,
  duplicate,
  get,
  layoutCards,
  lookup,
  openWindow,
  removeRelation,
  requireAi,
  revealCard,
  setAxis,
  setOverrideValue,
  snapshot,
  toShelf,
  toastError,
  updateCard,
  useStore,
} from '../../store';
import { axisSlotKey, computeScores } from '../../lib/semantic';
import { REL_STYLE, relLabel } from '../../lib/relStyle';
import { shrinkImage, useDictation } from '../../lib/dictation';
import { formatTime, t, type MessageKey } from '../../i18n';
import { CARD_KINDS, type AxisKey, type Card, type FloatWin } from '../../types';
import { Icon } from '../Icons';

export function logText(code: string, params?: Record<string, string | number>) {
  return t(`log.${code}` as MessageKey, params);
}

export function DetailWindow({ win }: { win: FloatWin }) {
  const id = win.cardIds[0];
  const card = useStore((s) => s.cards[id]);
  const cards = useStore((s) => s.cards);
  const axes = useStore((s) => s.axes);
  const readOnly = useStore((s) => s.readOnly);
  const allRelations = useStore((s) => s.relations);
  const relations = allRelations.filter((r) => !r.suggested && (r.from === id || r.to === id));
  const editing = useRef(false);
  // 開いている間はこのカードを動かさない。閉じたら意味の位置へ落ち着く
  useEffect(() => {
    if (readOnly) return;
    beginCardEdit(id);
    return () => endCardEdit(id);
  }, [id, readOnly]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation(
    (text) => {
      const c = lookup(id);
      if (c) updateCard(id, { body: c.body ? `${c.body}\n${text}` : text });
    },
    (message) => toastError(message),
  );

  const scores = useMemo(() => {
    if (!card || card.place !== 'canvas' || axisKeyOf(id, axes)) return null;
    return computeScores(layoutCards(get()), axes, lookup).values.get(id) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, axes, id]);

  if (!card) return <div className="fwin-body">{t('common.cardMissing')}</div>;
  const axisKey = axisKeyOf(id, axes);

  const beginEdit = () => {
    if (!editing.current) snapshot();
    editing.current = true;
  };
  const endEdit = () => {
    editing.current = false;
  };
  const edit = (patch: Partial<Card>) => updateCard(id, patch);

  const onImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      snapshot();
      edit({ image: await shrinkImage(file) });
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <>
      <div className="fwin-body">
        {readOnly ? (
          <div className="detail-title">{card.title}</div>
        ) : (
          <input
            className="title-input"
            value={card.title}
            autoFocus={Boolean(win.data?.focusTitle)}
            onFocus={(e) => {
              beginEdit();
              if (win.data?.focusTitle) e.target.select();
            }}
            onBlur={endEdit}
            onChange={(e) => edit({ title: e.target.value })}
            aria-label={t('detail.title')}
          />
        )}
        <dl className="kv">
          <dt>{t('detail.kind')}</dt>
          <dd>
            {readOnly || card.kind === 'concept' || card.kind === 'group' ? (
              t(`kind.${card.kind}` as MessageKey)
            ) : (
              <select className="inline-select" value={card.kind} onChange={(e) => (snapshot(), edit({ kind: e.target.value as Card['kind'] }))}>
                {CARD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
            )}
            {card.createdBy === 'ai' && <span className="muted"> · {t('card.aiBadge')}</span>}
            {axisKey && <b style={{ color: 'var(--gold)', marginInlineStart: 6 }}>{t('card.axisBadge', { axis: AXIS_NAME(axisKey) })}</b>}
          </dd>
          <dt>{t('detail.subtitle')}</dt>
          <dd>
            {readOnly ? card.subtitle : <input className="input slim" value={card.subtitle ?? ''} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => edit({ subtitle: e.target.value })} />}
          </dd>
          <dt>{t('detail.tags')}</dt>
          <dd>
            {readOnly ? (
              card.tags.map((x) => `#${x}`).join(' ')
            ) : (
              <input
                className="input slim"
                defaultValue={card.tags.join(', ')}
                placeholder={t('detail.tagsPlaceholder')}
                onFocus={beginEdit}
                onBlur={(e) => {
                  endEdit();
                  edit({ tags: e.target.value.split(/[,、，\s]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 8) });
                }}
              />
            )}
          </dd>
          <dt>URL</dt>
          <dd>
            {readOnly ? (
              card.url && /^https?:\/\//.test(card.url) ? (
                <a href={card.url} target="_blank" rel="noreferrer noopener">
                  {card.url}
                </a>
              ) : (
                card.url ?? null
              )
            ) : (
              <div className="row-gap">
                <input className="input slim" value={card.url ?? ''} placeholder="https://" onFocus={beginEdit} onBlur={endEdit} onChange={(e) => edit({ url: e.target.value.trim() || undefined })} />
                {card.url && /^https?:\/\//.test(card.url) && (
                  <a className="icon-btn small" href={card.url} target="_blank" rel="noreferrer noopener" title={t('detail.openLink')}>
                    <Icon name="arrowR" size={14} />
                  </a>
                )}
              </div>
            )}
          </dd>
        </dl>

        <div className="sec-title">
          <span>{t('detail.body')}</span>
          {!readOnly && (
            <button className={`btn small ghost ${dictation.state === 'recording' ? 'recording' : ''}`} onClick={() => (dictation.state === 'idle' ? requireAi() && dictation.toggle() : dictation.toggle())} disabled={dictation.state === 'transcribing'} title={t('detail.dictateTip')}>
              <Icon name={dictation.state === 'recording' ? 'stop' : 'mic'} size={13} />
              {dictation.state === 'recording' ? t('voice.stop') : dictation.state === 'transcribing' ? t('voice.transcribing') : t('detail.dictate')}
            </button>
          )}
        </div>
        {readOnly ? (
          <p className="body-text">{card.body}</p>
        ) : (
          <textarea className="body-input" value={card.body} placeholder={t('detail.bodyPlaceholder')} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => edit({ body: e.target.value })} rows={Math.min(14, Math.max(4, card.body.split('\n').length + 1))} />
        )}

        {(card.image || !readOnly) && card.kind !== 'concept' && (
          <>
            <div className="sec-title">
              <span>{t('detail.image')}</span>
              {!readOnly && (
                <span className="row-gap">
                  <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
                    <Icon name="image" size={13} /> {card.image ? t('detail.replaceImage') : t('detail.addImage')}
                  </button>
                  {card.image && (
                    <button className="btn small ghost" onClick={() => (snapshot(), edit({ image: undefined }))}>
                      {t('common.remove')}
                    </button>
                  )}
                </span>
              )}
            </div>
            {card.image && <img className="detail-image" src={card.image} alt="" />}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onImage(e.target.files?.[0])} />
          </>
        )}

        {axisKey && (
          <>
            <div className="sec-title">{t('detail.axisEnds')}</div>
            <div className="hint-inline" style={{ marginBottom: 6 }}>
              {t('detail.axisEndsHint')}
            </div>
            <div className="row-gap">
              <input
                className="input slim"
                value={card.axisEnds?.[0] ?? ''}
                placeholder={t('axis.newLow')}
                disabled={readOnly}
                onFocus={beginEdit}
                onBlur={endEdit}
                onChange={(e) => updateCard(id, { axisEnds: [e.target.value, card.axisEnds?.[1] ?? ''] }, { relayout: false })}
              />
              <span className="muted small">⟷</span>
              <input
                className="input slim"
                value={card.axisEnds?.[1] ?? ''}
                placeholder={t('axis.newHigh')}
                disabled={readOnly}
                onFocus={beginEdit}
                onBlur={endEdit}
                onChange={(e) => updateCard(id, { axisEnds: [card.axisEnds?.[0] ?? '', e.target.value] }, { relayout: false })}
              />
            </div>
          </>
        )}

        {card.facts && card.facts.length > 0 && (
          <>
            <div className="sec-title">{t('detail.facts')}</div>
            <dl className="kv">
              {card.facts.map((f) => (
                <FactRow key={f.label} label={f.label} value={f.value} />
              ))}
            </dl>
          </>
        )}

        {scores && (
          <>
            <div className="sec-title">
              <span>{t('detail.position')}</span>
              {card.overrides && (
                <button className="btn small ghost" onClick={() => clearOverrides(id)} disabled={readOnly}>
                  <Icon name="refresh" size={12} /> {t('detail.resetPosition')}
                </button>
              )}
            </div>
            <div className="hint-inline" style={{ marginBottom: 6 }}>
              {t('detail.positionHint')}
            </div>
            {AXIS_KEYS.map((k: AxisKey) => {
              const axisId = axisSlotKey(axes, k);
              const axisCardId = axes[k];
              const value = k === 'x' ? scores.sx : k === 'y' ? scores.sy : scores.sz;
              const overridden = card.overrides?.[axisId] !== undefined;
              const axis = cards[axisCardId];
              return (
                <div key={k} className="pos-row">
                  <span className={`pos-label ${overridden ? 'overridden' : ''}`} title={overridden ? t('card.humanPlaced') : t('detail.fromEmbedding')}>
                    {overridden && <Icon name="hand" size={11} />} {AXIS_NAME(k)} · {axis?.title}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(value * 1000)}
                    disabled={readOnly}
                    onPointerDown={() => snapshot()}
                    onChange={(e) => setOverrideValue(id, axisId, Number(e.target.value) / 1000, false)}
                    aria-label={`${AXIS_NAME(k)} ${axis?.title ?? ''}`}
                  />
                </div>
              );
            })}
          </>
        )}

        <div className="sec-title">{t('detail.relations', { n: relations.length })}</div>
        {relations.length === 0 && <div className="empty-note">{t('detail.noRelations')}</div>}
        {relations.map((r) => {
          const other = cards[r.from === id ? r.to : r.from];
          if (!other) return null;
          return (
            <div key={r.id} className="rel-row">
              <span className="rel-type" style={{ color: REL_STYLE[r.type].color }}>
                {relLabel(r.type)}
                {r.from === id ? ' →' : ' ←'}
              </span>
              <button className="ellipsis" style={{ flex: 1, textAlign: 'start' }} onClick={() => revealCard(other.id)}>
                {other.title}
              </button>
              {!readOnly && r.type !== 'contains' && (
                <button className="icon-btn small" onClick={() => removeRelation(r.id)} title={t('common.delete')} aria-label={t('common.delete')}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          );
        })}

        <div className="sec-title">{t('detail.log')}</div>
        <ul className="log">
          {[...card.log].reverse().map((l, i) => (
            <li key={i}>
              <time>{formatTime(l.at)}</time>
              {logText(l.code, l.params)}
            </li>
          ))}
        </ul>
      </div>
      {!readOnly && (
        <div className="fwin-foot">
          {card.kind !== 'group' &&
            AXIS_KEYS.map((k) => (
              <button key={k} className="btn small" disabled={axes[k] === id} onClick={() => setAxis(k, id, true)} title={t('detail.makeAxisTip', { axis: AXIS_NAME(k) })}>
                <Icon name="axis" size={12} />
                {k.toUpperCase()}
              </button>
            ))}
          <button className="btn small" onClick={() => openWindow('summary', [id])}>
            {t('radial.summary')}
          </button>
          {!axisKey && card.kind !== 'concept' && (
            <>
              <button className="btn small" onClick={() => duplicate([id])} title={t('detail.duplicate')}>
                <Icon name="copy" size={12} />
              </button>
              <button className="btn small" onClick={() => toShelf([id])} title={t('detail.toShelf')}>
                <Icon name="shelf" size={12} />
              </button>
              <button className="btn small danger" onClick={() => deleteCards([id])} title={t('common.delete')}>
                <Icon name="trash" size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

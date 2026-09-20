import { useState } from 'react';
import {
  AXIS_KEYS,
  AXIS_NAME,
  applyAxes,
  createConcept,
  deleteConcept,
  ensureConcept,
  get,
  isAxisCard,
  markDirty,
  relayout,
  requireAi,
  set,
  setAxis,
  setDraftAxes,
  snapshot,
  toast,
  toastError,
  useStore,
} from '../../store';
import { AXIS_PRESETS } from '../../data/concepts';
import { axisEnds, axisSlotKey } from '../../lib/semantic';
import { startGhostDrag } from '../../lib/drag';
import { suggestAxisEnds } from '../../lib/ai';
import { t } from '../../i18n';
import type { AxisKey, Card, FloatWin } from '../../types';
import { Icon } from '../Icons';
import { useAiBlock } from './common';

export function AxisWindow({ win }: { win: FloatWin }) {
  const cards = useStore((s) => s.cards);
  const axes = useStore((s) => s.axes);
  const draft = useStore((s) => s.draftAxes);
  const previewFirst = useStore((s) => s.previewFirst);
  const dropTarget = useStore((s) => s.dropTarget);
  const primary = useStore((s) => s.primary);
  const readOnly = useStore((s) => s.readOnly);
  const view = draft ?? axes;
  const block = useAiBlock();
  const [label, setLabel] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  const concepts = Object.values(cards).filter((c) => c.kind === 'concept');
  const canvasCandidates = Object.values(cards).filter((c) => c.place === 'canvas' && !['concept', 'group', 'topic'].includes(c.kind));
  const focus: Card | undefined = primary ? cards[primary] : cards[win.cardIds[0]];
  const focusable = focus && focus.place === 'canvas' && !['concept', 'group'].includes(focus.kind) && !isAxisCard(focus.id);
  const used = new Set(Object.values(view));
  const overrideCount = Object.values(cards).filter((c) => AXIS_KEYS.some((k) => c.overrides?.[axisSlotKey(axes, k)] !== undefined)).length;

  if (readOnly) {
    return (
      <div className="fwin-body">
        {AXIS_KEYS.map((k) => (
          <div key={k} className="axis-slot">
            <span className="k">{AXIS_NAME(k)}</span>
            <span>{cards[axes[k]]?.title}</span>
          </div>
        ))}
        <div className="hint-block">{t('share.readOnlyAxes')}</div>
      </div>
    );
  }

  const create = () => {
    if (!label.trim()) return;
    const c = createConcept(label, low, high);
    setLabel('');
    setLow('');
    setHigh('');
    toast(t('axis.created', { label: c.title }));
  };

  const suggest = () => {
    if (!label.trim() || !requireAi()) return;
    setSuggesting(true);
    void suggestAxisEnds(label.trim())
      .then((r) => {
        setLow(r.low);
        setHigh(r.high);
      })
      .catch(toastError)
      .finally(() => setSuggesting(false));
  };

  const resetOverrides = () => {
    snapshot();
    const next = { ...get().cards };
    for (const c of Object.values(next)) {
      if (!c.overrides) continue;
      const o = { ...c.overrides };
      for (const k of AXIS_KEYS) delete o[axisSlotKey(axes, k)];
      next[c.id] = { ...c, overrides: Object.keys(o).length ? o : undefined };
    }
    set({ cards: next });
    markDirty();
    relayout();
    toast(t('axis.overridesReset'));
  };

  return (
    <>
      <div className="fwin-body">
        <div className="sec-title" style={{ marginTop: 0 }}>
          <span>{t('axis.current')}</span>
          <select
            className="btn small"
            value=""
            onChange={(e) => {
              const p = AXIS_PRESETS.find((x) => x.id === e.target.value);
              if (!p) return;
              const [a, b, c] = p.axes.map((k) => ensureConcept(k));
              setDraftAxes({ x: a, y: b, z: c });
            }}
          >
            <option value="">{t('axis.presets')}</option>
            {AXIS_PRESETS.map((p, index) => (
              <option key={p.id} value={p.id}>
                {index + 1}. {t(p.name)}
              </option>
            ))}
          </select>
        </div>
        {AXIS_KEYS.map((k: AxisKey) => {
          const cur = cards[view[k]];
          const [lo, hi] = axisEnds(cur);
          return (
            <div key={k} className="axis-slot">
              <span className="k">{AXIS_NAME(k)}</span>
              <div className={`slot-box ${dropTarget === `slot:${k}` ? 'over' : ''} ${draft && draft[k] !== axes[k] ? 'changed' : ''}`} data-drop={`slot:${k}`} title={lo || hi ? `${lo} ⟷ ${hi}` : t('axis.cardAxisTip')}>
                <Icon name={cur?.kind === 'concept' ? 'axis' : 'layers'} size={14} />
                <select value={view[k]} onChange={(e) => setAxis(k, e.target.value, false)} aria-label={AXIS_NAME(k)}>
                  <option value="">{t('axis.none')}</option>
                  <optgroup label={t('axis.concepts')}>
                    {concepts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </optgroup>
                  {canvasCandidates.length > 0 && (
                    <optgroup label={t('axis.cardsGroup')}>
                      {canvasCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          );
        })}

        <div className="dropzone">
          <Icon name="layers" size={16} />
          <br />
          {t('axis.dropzone')}
        </div>

        {focusable && (
          <>
            <div className="sec-title">{t('axis.useSelected')}</div>
            <div className="row-gap">
              <span className="ellipsis" style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
                {focus!.title}
              </span>
              {AXIS_KEYS.map((k) => (
                <button key={k} className="btn small" onClick={() => setAxis(k, focus!.id, false)}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sec-title">{t('axis.library')}</div>
        <div className="chips">
          {concepts.map((c) => (
            <span
              key={c.id}
              className={`chip ${used.has(c.id) ? 'used' : ''}`}
              title={`${c.title} (${axisEnds(c).join(' ⟷ ')})`}
              onPointerDown={(e) => startGhostDrag(e, c)}
            >
              {c.title}
              {!used.has(c.id) && !Object.values(axes).includes(c.id) ? (
                <button
                  className="chip-x"
                  aria-label={t('common.delete')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (deleteConcept(c.id)) toast(t('axis.deleted', { label: c.title }));
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>

        <div className="sec-title">{t('axis.newAxis')}</div>
        <div className="form-grid">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('axis.newLabel')} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <div className="row-gap">
            <input className="input" value={low} onChange={(e) => setLow(e.target.value)} placeholder={t('axis.newLow')} />
            <span>⟷</span>
            <input className="input" value={high} onChange={(e) => setHigh(e.target.value)} placeholder={t('axis.newHigh')} />
          </div>
          <div className="row-gap">
            <button className="btn small" disabled={!label.trim() || suggesting || Boolean(block)} onClick={suggest} title={block ? t(`ai.block.${block}` as 'ai.block.login') : t('axis.suggestTip')}>
              <Icon name="sparkle" size={12} /> {suggesting ? t('common.thinking') : t('axis.suggest')}
            </button>
            <button className="btn small primary" disabled={!label.trim()} onClick={create} style={{ marginInlineStart: 'auto' }}>
              {t('axis.create')}
            </button>
          </div>
        </div>

        <label className="toggle" onClick={() => set({ previewFirst: !previewFirst })}>
          <span className={`switch ${previewFirst ? 'on' : ''}`} />
          {t('axis.previewFirst')}
        </label>
        {overrideCount > 0 && (
          <button className="btn small ghost" style={{ marginTop: 8 }} onClick={resetOverrides}>
            <Icon name="hand" size={12} /> {t('axis.resetOverrides', { n: overrideCount })}
          </button>
        )}
      </div>
      <div className="fwin-foot">
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={() => {
            if (draft) return applyAxes(draft);
            relayout();
          }}
        >
          <Icon name="refresh" size={14} />
          {draft ? t('axis.applyDraft') : t('axis.relayout')}
        </button>
      </div>
    </>
  );
}

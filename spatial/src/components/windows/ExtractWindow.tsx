import { useEffect, useRef, useState } from 'react';
import { closeWindow, extractText, placeCard, requireAi, select, setBusy, spawnDrafts, toast, toastError, useStore } from '../../store';
import { extractIdeas } from '../../lib/ai';
import { clientToWorld, startGhostDrag } from '../../lib/drag';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { useAiBlock } from './common';

export const sentencesOf = (body: string) =>
  body
    .split(/\n+|(?<=[。．！？!?])\s*|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

export function ExtractWindow({ win }: { win: FloatWin }) {
  const card = useStore((s) => s.cards[win.cardIds[0]]);
  const busy = useStore((s) => s.busy.extractAi);
  const [picked, setPicked] = useState<number[]>([]);
  const [done, setDone] = useState<number[]>([]);
  const [selText, setSelText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const block = useAiBlock();

  // ウィンドウ内でのテキスト選択を拾う
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      setSelText(text && bodyRef.current && sel?.anchorNode && bodyRef.current.contains(sel.anchorNode) ? text : '');
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  if (!card) return <div className="fwin-body">{t('common.cardMissing')}</div>;
  const lines = sentencesOf(card.body);

  const run = () => {
    picked.forEach((i) => extractText(card.id, lines[i]));
    setDone((d) => [...d, ...picked]);
    setPicked([]);
  };

  const runAi = () => {
    if (!requireAi()) return;
    setBusy('extractAi', true);
    void extractIdeas(card)
      .then((drafts) => {
        const ids = spawnDrafts(card.id, drafts);
        if (ids.length) {
          select(ids);
          toast(t('toast.extractedMany', { n: ids.length }));
        }
      })
      .catch(toastError)
      .finally(() => setBusy('extractAi', false));
  };

  return (
    <>
      <div className="fwin-body" ref={bodyRef}>
        <div className="hint-block">{t('extract.intro')}</div>
        {lines.map((line, i) => (
          <button
            key={i}
            className={`sentence ${picked.includes(i) ? 'on' : ''} ${done.includes(i) ? 'done' : ''}`}
            onPointerDown={(e) => {
              if (e.altKey) return; // Alt 押下中はテキスト選択を優先
              startGhostDrag(e, { ...card, title: line }, {
                onClick: () => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i])),
                onDrop: (target, cx, cy) => {
                  if (target !== 'canvas') return false;
                  const id = extractText(card.id, line);
                  const w = clientToWorld(cx, cy);
                  if (id) placeCard(id, w.x, w.y);
                  setDone((d) => [...d, i]);
                  return true;
                },
              });
            }}
          >
            {line}
          </button>
        ))}
        {!lines.length && <div className="empty-note">{t('extract.empty')}</div>}
        {card.body && (
          <>
            <div className="sec-title">{t('extract.bodyTitle')}</div>
            <p className="body-text selectable">{card.body}</p>
          </>
        )}
      </div>
      <div className="fwin-foot">
        <button className="btn small" disabled={!selText} onClick={() => {
          extractText(card.id, selText);
          window.getSelection()?.removeAllRanges();
        }} title={t('extract.selectionTip')}>
          <Icon name="extract" size={13} /> {t('extract.selection')}
        </button>
        <button className="btn small" disabled={Boolean(block) || busy || !card.body} onClick={runAi} title={block ? t(`ai.block.${block}` as 'ai.block.login') : t('extract.aiTip')}>
          <Icon name="sparkle" size={13} /> {busy ? t('common.thinking') : t('extract.ai')}
        </button>
        <button className="btn small primary" style={{ marginInlineStart: 'auto' }} disabled={!picked.length} onClick={run}>
          {t('extract.run', { n: picked.length })}
        </button>
        <button className="btn small ghost" onClick={() => closeWindow(win.id)}>
          {t('common.close')}
        </button>
      </div>
    </>
  );
}

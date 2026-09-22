import { useEffect, useRef, useState } from 'react';
import { addRelationRaw, createCard, lookup, spawnDrafts, toast, updateWindowData, useStore } from '../../store';
import { chat, type ChatStep } from '../../lib/ai';
import { visibleContextCards } from '../../lib/spaceTools';
import type { AiTurnMessage } from '../../lib/service';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, useAiBlock } from './common';
import { Markdownish } from './Markdownish';

export function ChatWindow({ win }: { win: FloatWin }) {
  const title = useStore((s) => s.title);
  const readOnly = useStore((s) => s.readOnly);
  const messages = (win.data?.messages as AiTurnMessage[] | undefined) ?? [];
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<ChatStep[]>([]);
  const [error, setError] = useState('');
  const block = useAiBlock();
  const listRef = useRef<HTMLDivElement>(null);
  const contextIds = win.cardIds.length ? win.cardIds : [];
  const contextTitles = contextIds.map((id) => lookup(id)?.title).filter(Boolean);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const send = async (text = input) => {
    const q = text.trim();
    if (!q || busy || block) return;
    setInput('');
    setError('');
    const next: AiTurnMessage[] = [...messages, { role: 'user', content: q }];
    updateWindowData(win.id, { messages: next });
    setBusy(true);
    setSteps([]);
    try {
      // 選んだカードがあればそれ、無ければ「いま画面で読めているカード」をまとめて渡す
      const picked = contextIds.map((id) => lookup(id)).filter(Boolean) as NonNullable<ReturnType<typeof lookup>>[];
      const context = picked.length ? picked : visibleContextCards(60);
      const answer = await chat(next.slice(-12), context, title, { onStep: (step) => setSteps((prev) => [...prev, step]) });
      updateWindowData(win.id, { messages: [...next, { role: 'assistant', content: answer }] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toCard = (content: string) => {
    const firstLine = content.split('\n').find((l) => l.trim())?.replace(/^[#>*\-\s]+/, '').trim() ?? '';
    const titleText = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    if (contextIds[0] && lookup(contextIds[0])?.place === 'canvas') {
      const [id] = spawnDrafts(contextIds[0], [{ kind: 'note', title: titleText, body: content, tags: [], relation: 'derived' }], 270);
      contextIds.slice(1).forEach((cid) => id && addRelationRaw(cid, id, 'derived'));
    } else {
      createCard({ kind: 'note', title: titleText, body: content, createdBy: 'ai' });
    }
    toast(t('chat.saved'));
  };

  const suggestions = [t('chat.q1'), t('chat.q2'), t('chat.q3')];

  return (
    <>
      <div className="fwin-body chat-body" ref={listRef}>
        <div className="context-chips">
          <Icon name="layers" size={12} />
          {contextTitles.length
            ? contextTitles.slice(0, 4).join(' · ') + (contextTitles.length > 4 ? ` +${contextTitles.length - 4}` : '')
            : t('chat.visibleCards', { n: visibleContextCards(60).length })}
        </div>
        {block && <AiNotice block={block} />}
        {!messages.length && !block && (
          <div className="chat-suggest">
            {suggestions.map((s) => (
              <button key={s} className="btn small ghost" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? <Markdownish text={m.content} /> : <p>{m.content}</p>}
            {m.role === 'assistant' && !readOnly && (
              <button className="btn small ghost" onClick={() => toCard(m.content)}>
                <Icon name="plus" size={12} /> {t('chat.toCard')}
              </button>
            )}
          </div>
        ))}
        {steps.length > 0 && (
          <div className="tool-steps">
            {steps.map((step, i) => (
              <div key={i} className={`tool-step ${step.ok ? '' : 'bad'}`}>
                <Icon name={step.ok ? 'check' : 'info'} size={11} /> {step.text}
              </div>
            ))}
          </div>
        )}
        {busy && (
          <div className="msg assistant">
            <span className="spinner" /> {t('common.thinking')}
          </div>
        )}
        {error && <div className="ai-note warn">{error}</div>}
      </div>
      <div className="fwin-foot chat-foot">
        <textarea
          className="chat-input"
          value={input}
          rows={2}
          disabled={Boolean(block)}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" disabled={!input.trim() || busy || Boolean(block)} onClick={() => void send()} aria-label={t('chat.send')}>
          <Icon name="send" size={14} />
        </button>
      </div>
    </>
  );
}

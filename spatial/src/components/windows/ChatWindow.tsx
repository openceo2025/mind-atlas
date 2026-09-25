import { Fragment, useEffect, useRef, useState } from 'react';
import { addRelationRaw, createCard, get, lookup, spawnDrafts, toast, updateWindowData, useStore } from '../../store';
import { chat, type ChatStep } from '../../lib/ai';
import { neighborhood, visibleContextCards } from '../../lib/spaceTools';
import { RequestCancelled } from '../../lib/cost';
import type { AiTurnMessage } from '../../lib/service';
import {
  AUTO_COMPACT_CHARS,
  SUGGEST_COMPACT_CHARS,
  activeChars,
  activeTurns,
  canCompact,
  compactLog,
  emptyLog,
  loadAssistant,
  saveAssistant,
  type AssistantLog,
} from '../../lib/assistant';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, useAiBlock } from './common';
import { Markdownish } from './Markdownish';

/**
 * AI との会話。二つの顔がある。
 * - 「AIに質問」（サークルメニュー、type=chat）：選んだカードについて聞く。過去の会話は持ち込まない。
 * - 「AIアシスタント」（左ナビ、type=assistant）：このスペースでの会話をずっと覚えている。
 *   長くなったら古いやり取りを要約に畳む（自動／/compact）。/clear で最初から。
 */
export function ChatWindow({ win }: { win: FloatWin }) {
  const assistant = win.type === 'assistant';
  const title = useStore((s) => s.title);
  const spaceId = useStore((s) => s.spaceId);
  const readOnly = useStore((s) => s.readOnly);
  const onTop = useStore((s) => s.topZ === win.z);
  const selection = useStore((s) => s.selection);
  const [log, setLog] = useState<AssistantLog>(emptyLog);
  const logRef = useRef(log);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [steps, setSteps] = useState<ChatStep[]>([]);
  const [error, setError] = useState('');
  const block = useAiBlock();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const windowMessages = (win.data?.messages as AiTurnMessage[] | undefined) ?? [];
  const messages: AiTurnMessage[] = assistant ? log.messages : windowMessages;
  // AIに質問は開いたときに選んでいたカード、AIアシスタントはいま選んでいるカードが話題
  const contextIds = assistant ? selection.slice(0, 12) : win.cardIds;
  const contextTitles = contextIds.map((id) => lookup(id)?.title).filter(Boolean);

  const keepLog = (next: AssistantLog, spaceKey = spaceId) => {
    logRef.current = next;
    setLog(next);
    void saveAssistant(spaceKey, next);
  };

  // スペースを開き直したら、そのスペースでの会話を読み込む
  useEffect(() => {
    if (!assistant) return;
    let live = true;
    void loadAssistant(spaceId).then((saved) => {
      if (!live) return;
      logRef.current = saved;
      setLog(saved);
    });
    return () => {
      live = false;
    };
  }, [assistant, spaceId]);

  // 開いたら（前面に来たら）すぐ打てるように。焦点が空間に残ると、打った文字が空間の操作
  // （N で新しいカードなど）になってしまう
  useEffect(() => {
    if (onTop && !block) inputRef.current?.focus({ preventScroll: true });
  }, [onTop, block]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const compact = async (opts: { keep?: number; instruction?: string; auto?: boolean } = {}) => {
    const space = spaceId;
    const before = logRef.current;
    if (!canCompact(before, opts.keep ?? 4) && opts.keep !== 0) {
      if (!opts.auto) toast(t('assistant.nothingToCompact'));
      return;
    }
    setCompacting(true);
    try {
      const { log: next, folded } = await compactLog(before, opts);
      if (!folded) {
        if (!opts.auto) toast(t('assistant.nothingToCompact'));
        return;
      }
      // 要約している間に増えたやり取りは、そのまま後ろに残す
      const latest = logRef.current;
      keepLog({ ...next, messages: latest.messages }, space);
      toast(t(opts.auto ? 'assistant.autoCompacted' : 'assistant.compacted', { n: folded }));
    } catch (e) {
      if (!(e instanceof RequestCancelled)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompacting(false);
    }
  };

  const clear = () => {
    const before = logRef.current;
    const space = spaceId;
    keepLog(emptyLog(), space);
    toast(t('assistant.cleared'), { action: { label: t('action.undo'), run: () => keepLog(before, space) } });
  };

  const send = async (text = input) => {
    const q = text.trim();
    if (!q || busy || compacting || block) return;
    setInput('');
    setError('');
    if (assistant && /^\/compact\b/i.test(q)) return void compact({ keep: 0, instruction: q.replace(/^\/compact\s*/i, '') });
    if (assistant && /^\/clear\b/i.test(q)) return clear();

    const user: AiTurnMessage = { role: 'user', content: q };
    const space = spaceId;
    if (assistant) keepLog({ ...logRef.current, messages: [...logRef.current.messages, { role: 'user', content: q, at: Date.now() }] }, space);
    else updateWindowData(win.id, { messages: [...windowMessages, user] });
    setBusy(true);
    setSteps([]);
    try {
      // 選んだカードがあれば、それとつながっているカード（子・親・関連・グループの仲間）も一緒に、
      // 無ければ「いま画面で読めているカード」をまとめて渡す。足りなければ AI が道具で読みに行く
      const picked = contextIds.filter((id) => lookup(id));
      const context = picked.length ? neighborhood(picked, 2, 50) : visibleContextCards(60);
      const history = assistant ? activeTurns(logRef.current).slice(-24) : [...windowMessages, user].slice(-12);
      const answer = await chat(history, context, title, {
        onStep: (step) => setSteps((prev) => [...prev, step]),
        selectedIds: picked,
        memory: assistant ? logRef.current.summary : undefined,
      });
      if (assistant) {
        // 別のスペースへ移った後に答えが届いたら、元のスペースの会話へ入れる
        const base = get().spaceId === space ? logRef.current : await loadAssistant(space);
        const next = { ...base, messages: [...base.messages, { role: 'assistant' as const, content: answer, at: Date.now() }] };
        if (get().spaceId === space) keepLog(next, space);
        else void saveAssistant(space, next);
        // 長くなったら、裏で古いやり取りを要約に畳む
        if (get().spaceId === space && activeChars(next) > AUTO_COMPACT_CHARS) void compact({ auto: true });
      } else {
        updateWindowData(win.id, { messages: [...windowMessages, user, { role: 'assistant', content: answer }] });
      }
    } catch (e) {
      if (e instanceof RequestCancelled) {
        // 送るのをやめた：書いた文は入力欄に戻し、会話にも残さない
        if (assistant) keepLog({ ...logRef.current, messages: logRef.current.messages.slice(0, -1) }, space);
        else updateWindowData(win.id, { messages: windowMessages });
        setInput(text);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const toCard = (content: string) => {
    const firstLine = content.split('\n').find((l) => l.trim())?.replace(/^[#>*\-\s]+/, '').trim() ?? '';
    const titleText = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    if (contextIds[0] && lookup(contextIds[0])?.place === 'canvas') {
      const [id] = spawnDrafts(contextIds[0], [{ kind: 'note', title: titleText, body: content, tags: [], relation: 'derived' }]);
      contextIds.slice(1).forEach((cid) => id && addRelationRaw(cid, id, 'derived'));
    } else {
      createCard({ kind: 'note', title: titleText, body: content, createdBy: 'ai' });
    }
    toast(t('chat.saved'));
  };

  const suggestions = [t('chat.q1'), t('chat.q2'), t('chat.q3')];
  const suggestCompact = assistant && !compacting && activeChars(log) > SUGGEST_COMPACT_CHARS && canCompact(log);

  return (
    <>
      <div className="fwin-body chat-body" ref={listRef}>
        <div className="context-chips">
          <Icon name="layers" size={12} />
          {contextTitles.length
            ? contextTitles.slice(0, 4).join(' · ') + (contextTitles.length > 4 ? ` +${contextTitles.length - 4}` : '')
            : t('chat.visibleCards', { n: visibleContextCards(60).length })}
        </div>
        {assistant && <div className="muted small assistant-note">{t('assistant.note')}</div>}
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
          <Fragment key={i}>
            {assistant && i === log.compactedUpTo && i > 0 && <div className="compact-divider">{t('assistant.compactedDivider')}</div>}
            <div className={`msg ${m.role} ${assistant && i < log.compactedUpTo ? 'compacted' : ''}`}>
              {m.role === 'assistant' ? <Markdownish text={m.content} /> : <p>{m.content}</p>}
              {m.role === 'assistant' && !readOnly && (
                <button className="btn small ghost" onClick={() => toCard(m.content)}>
                  <Icon name="plus" size={12} /> {t('chat.toCard')}
                </button>
              )}
            </div>
          </Fragment>
        ))}
        {assistant && log.compactedUpTo >= log.messages.length && log.compactedUpTo > 0 && <div className="compact-divider">{t('assistant.compactedDivider')}</div>}
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
        {compacting && (
          <div className="msg assistant">
            <span className="spinner" /> {t('assistant.compacting')}
          </div>
        )}
        {error && <div className="ai-note warn">{error}</div>}
      </div>
      {suggestCompact && (
        <div className="compact-suggest">
          <span>{t('assistant.compactSuggest')}</span>
          <button className="btn small" onClick={() => void compact()}>
            {t('assistant.compactNow')}
          </button>
        </div>
      )}
      <div className="fwin-foot chat-foot">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          rows={2}
          autoFocus
          disabled={Boolean(block)}
          placeholder={assistant ? t('assistant.placeholder') : t('chat.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            // 入力欄の Enter は、ここで完結させる（外側のショートカットへは渡さない）
            e.stopPropagation();
            if (e.shiftKey) return; // 改行
            e.preventDefault();
            void send();
          }}
          aria-keyshortcuts="Enter Control+Enter"
          title={t('chat.keys')}
        />
        <button className="btn primary" disabled={!input.trim() || busy || compacting || Boolean(block)} onClick={() => void send()} aria-label={t('chat.send')}>
          <Icon name="send" size={14} />
        </button>
      </div>
    </>
  );
}

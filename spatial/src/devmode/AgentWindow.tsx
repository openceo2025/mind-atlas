// 開発者モード（ローカル専用）：Codex / Claude Code をローカルブリッジ経由で走らせ、
// 選択カードを文脈として渡し、結果をカードに戻す。公開ビルドには含まれない。
import { useEffect, useRef, useState } from 'react';
import { addRelationRaw, createCard, lookup, spawnDrafts, toast } from '../store';
import { serviceBaseUrl } from '../lib/service';
import { cardsContext } from '../lib/ai';
import { t } from '../i18n';
import type { FloatWin } from '../types';
import { Icon } from '../components/Icons';

const WS_KEY = 'mindatlas-spatial-agent-workspace';

interface RunEvent {
  sequence: number;
  kind: string;
  [key: string]: unknown;
}

function describe(ev: RunEvent): string {
  const text = (k: string) => (typeof ev[k] === 'string' ? (ev[k] as string) : '');
  switch (ev.kind) {
    case 'message_delta':
      return text('delta') || text('text');
    case 'message_completed':
      return text('text');
    case 'command_started':
      return `$ ${text('command')}`;
    case 'command_output':
      return text('output') || text('delta');
    case 'command_completed':
      return `✓ ${text('command')} (${String(ev.exitCode ?? '')})`;
    case 'file_change':
      return `± ${text('path')}`;
    case 'error':
    case 'warning':
      return `! ${text('message') || text('detail')}`;
    case 'lifecycle':
      return `· ${text('status') || text('phase')}`;
    default:
      return '';
  }
}

export default function AgentWindow({ win }: { win: FloatWin }) {
  const [provider, setProvider] = useState<'codex' | 'claude'>('claude');
  const [workspace, setWorkspace] = useState(() => localStorage.getItem(WS_KEY) ?? '');
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState('');
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [final, setFinal] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contextCards = win.cardIds.map((id) => lookup(id)).filter(Boolean) as NonNullable<ReturnType<typeof lookup>>[];

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [log]);

  const start = async () => {
    setError('');
    setLog([]);
    setFinal('');
    localStorage.setItem(WS_KEY, workspace);
    const fullPrompt = [prompt.trim(), contextCards.length ? `\n\nContext cards from MindAtlas:\n${cardsContext(contextCards, 16000)}` : ''].join('');
    try {
      const res = await fetch(`${serviceBaseUrl()}/api/agent-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, workspace, prompt: fullPrompt, title: prompt.slice(0, 60), clientRunId: `spatial-${Date.now()}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const id = data?.manifest?.runId as string;
      setRunId(id);
      setStatus(data?.manifest?.status ?? 'starting');
      void follow(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const follow = async (id: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    let messages = '';
    try {
      const res = await fetch(`${serviceBaseUrl()}/api/agent-runs/${encodeURIComponent(id)}/events?since=0`, { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const type = frame.split('\n').find((l) => l.startsWith('event: '))?.slice(7).trim();
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let payload: RunEvent;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (type === 'manifest') {
            setStatus(String((payload as unknown as { status?: string }).status ?? ''));
            continue;
          }
          if (type === 'end') continue;
          if (payload.kind === 'message_completed' && typeof payload.text === 'string') messages = payload.text;
          if (payload.kind === 'lifecycle' && typeof payload.status === 'string') setStatus(payload.status);
          const line = describe(payload);
          if (line) setLog((prev) => [...prev.slice(-300), line]);
        }
      }
      setFinal(messages);
      setStatus((s) => (['completed', 'failed', 'interrupted'].includes(s) ? s : 'completed'));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    }
  };

  const interrupt = async () => {
    if (!runId) return;
    await fetch(`${serviceBaseUrl()}/api/agent-runs/${encodeURIComponent(runId)}/interrupt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  };

  const toCard = () => {
    const body = final || log.join('\n').slice(-4000);
    const title = t('agent.resultTitle', { title: prompt.slice(0, 40) });
    if (contextCards[0]) {
      const [id] = spawnDrafts(contextCards[0].id, [{ kind: 'note', title, body, tags: [provider], relation: 'derived' }]);
      contextCards.slice(1).forEach((c) => id && addRelationRaw(c.id, id, 'derived'));
    } else createCard({ kind: 'note', title, body, tags: [provider], createdBy: 'ai' });
    toast(t('agent.saved'));
  };

  const running = Boolean(runId) && !['completed', 'failed', 'interrupted', ''].includes(status);

  return (
    <>
      <div className="fwin-body agent-body" ref={listRef}>
        <p className="hint-block">{t('agent.intro')}</p>
        <div className="row-gap">
          <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as 'codex' | 'claude')} disabled={running}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <input className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder={t('agent.workspace')} disabled={running} />
        </div>
        <textarea className="body-input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('agent.prompt')} disabled={running} />
        {contextCards.length > 0 && <div className="context-chips">{t('agent.context', { n: contextCards.length })}</div>}
        {status && <div className="muted small">{t('agent.status', { status })}</div>}
        {error && <div className="ai-note warn">{error}</div>}
        {log.length > 0 && <pre className="agent-log">{log.join('\n')}</pre>}
      </div>
      <div className="fwin-foot">
        {running ? (
          <button className="btn small danger" onClick={() => void interrupt()}>
            <Icon name="stop" size={12} /> {t('agent.interrupt')}
          </button>
        ) : (
          <button className="btn small primary" disabled={!prompt.trim() || !workspace.trim()} onClick={() => void start()}>
            <Icon name="play" size={12} /> {t('agent.run')}
          </button>
        )}
        <button className="btn small" style={{ marginInlineStart: 'auto' }} disabled={!final && !log.length} onClick={toCard}>
          <Icon name="plus" size={12} /> {t('agent.toCard')}
        </button>
      </div>
    </>
  );
}

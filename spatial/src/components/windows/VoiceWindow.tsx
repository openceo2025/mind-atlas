import { useEffect, useRef, useState } from 'react';
import { AXIS_KEYS, get, lookup, requireAi, useStore } from '../../store';
import { startVoiceSession, type VoiceSession, type VoiceState, type VoiceTool } from '../../lib/realtime';
import { cardsContext } from '../../lib/ai';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, useAiBlock } from './common';
import { RequestCancelled } from '../../lib/cost';
import { SPACE_TOOLS, executeSpaceTool, visibleContextCards } from '../../lib/spaceTools';

// チャットと同じ道具一式を使う（作る・直す・消す・つなぐ・束ねる・軸・移動）
const TOOLS: VoiceTool[] = SPACE_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));

async function execute(name: string, args: Record<string, unknown>) {
  const result = await executeSpaceTool(name, args);
  return { ok: result.ok, text: result.text };
}

interface Line {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export function VoiceWindow(_: { win: FloatWin }) {
  const title = useStore((s) => s.title);
  const block = useAiBlock();
  const [state, setState] = useState<VoiceState | 'idle'>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const session = useRef<VoiceSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => session.current?.stop(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines]);

  const start = async () => {
    if (!requireAi()) return;
    setError('');
    const s = get();
    const axes = AXIS_KEYS.map((k) => `${k.toUpperCase()}: ${lookup(s.axes[k])?.title ?? ''}`).join(', ');
    const contextText = [`Space: ${title}`, `Current axes: ${axes}`, cardsContext(visibleContextCards(60), 14000)].join('\n\n');
    try {
      session.current = await startVoiceSession({
        contextText,
        tools: TOOLS,
        execute,
        onState: (st) => setState(st),
        onTranscript: (role, text, final) =>
          setLines((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === role && !last.final) return [...prev.slice(0, -1), { role, text, final }];
            return [...prev, { role, text, final }].slice(-40);
          }),
        onError: (m) => setError(m),
      });
    } catch (e) {
      if (e instanceof RequestCancelled) {
        setState('idle');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === 'insecure' ? t('voice.insecure') : msg);
      setState('error');
    }
  };

  const live = state === 'live' || state === 'listening' || state === 'responding';

  return (
    <>
      <div className="fwin-body voice-body" ref={listRef}>
        {block && <AiNotice block={block} />}
        <p className="hint-block">{t('voice.intro')}</p>
        {lines.map((l, i) => (
          <div key={i} className={`msg ${l.role} ${l.final ? '' : 'partial'}`}>
            <p>{l.text}</p>
          </div>
        ))}
        {error && <div className="ai-note warn">{error}</div>}
      </div>
      <div className="fwin-foot voice-foot">
        {!live ? (
          <button className="btn primary" style={{ flex: 1 }} disabled={Boolean(block) || state === 'connecting'} onClick={() => void start()}>
            <Icon name="play" size={14} /> {state === 'connecting' ? t('voice.connecting') : t('voice.start')}
          </button>
        ) : (
          <>
            <button
              className={`ptt ${state === 'listening' ? 'on' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                session.current?.begin();
              }}
              onPointerUp={() => session.current?.end()}
              onPointerLeave={() => state === 'listening' && session.current?.end()}
            >
              <Icon name="mic" size={18} />
              {state === 'listening' ? t('voice.listening') : state === 'responding' ? t('voice.responding') : t('voice.hold')}
            </button>
            <button className="btn" onClick={() => session.current?.stop()}>
              <Icon name="stop" size={14} /> {t('voice.stop')}
            </button>
          </>
        )}
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  AXIS_KEYS,
  addRelation,
  createCard,
  createConcept,
  get,
  layoutCards,
  lookup,
  requireAi,
  revealCard,
  setAxis,
  useStore,
} from '../../store';
import { startVoiceSession, type VoiceSession, type VoiceState, type VoiceTool } from '../../lib/realtime';
import { cardsContext } from '../../lib/ai';
import { t } from '../../i18n';
import { USER_RELATION_TYPES, type AxisKey, type Card, type FloatWin, type RelationType } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, useAiBlock } from './common';

const TOOLS: VoiceTool[] = [
  {
    name: 'add_card',
    description: 'Add a new card to the current MindAtlas space.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string', enum: ['note', 'idea', 'issue', 'hypothesis', 'quote'] },
      },
      required: ['title'],
    },
  },
  {
    name: 'link_cards',
    description: 'Connect two existing cards (matched by title) with a relation.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string', enum: USER_RELATION_TYPES } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'set_axis',
    description: 'Arrange the space along a semantic axis. axis is x, y or z; label is the concept (e.g. "cost").',
    parameters: {
      type: 'object',
      properties: { axis: { type: 'string', enum: ['x', 'y', 'z'] }, label: { type: 'string' }, low: { type: 'string' }, high: { type: 'string' } },
      required: ['axis', 'label'],
    },
  },
  {
    name: 'focus_card',
    description: 'Move the view to a card matched by title.',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
];

function findCard(title: string): Card | undefined {
  const q = title.trim().toLowerCase();
  const all = Object.values(get().cards).filter((c) => c.kind !== 'concept');
  return all.find((c) => c.title.toLowerCase() === q) ?? all.find((c) => c.title.toLowerCase().includes(q) || q.includes(c.title.toLowerCase()));
}

async function execute(name: string, args: Record<string, unknown>) {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
  if (name === 'add_card') {
    const kind = (['note', 'idea', 'issue', 'hypothesis', 'quote'].includes(s('kind')) ? s('kind') : 'note') as Card['kind'];
    createCard({ title: s('title'), body: s('body'), kind, createdBy: 'ai' }, undefined, { select: false });
    return { ok: true, text: `added "${s('title')}"` };
  }
  if (name === 'link_cards') {
    const a = findCard(s('from'));
    const b = findCard(s('to'));
    if (!a || !b) return { ok: false, text: 'card not found' };
    const type = (USER_RELATION_TYPES.includes(s('type') as RelationType) ? s('type') : 'related') as RelationType;
    addRelation(a.id, b.id, type);
    return { ok: true, text: `linked "${a.title}" → "${b.title}" (${type})` };
  }
  if (name === 'set_axis') {
    const axis = (AXIS_KEYS.includes(s('axis') as AxisKey) ? s('axis') : 'x') as AxisKey;
    const label = s('label');
    const existing = Object.values(get().cards).find((c) => c.kind === 'concept' && c.title.toLowerCase() === label.toLowerCase());
    const concept = existing ?? createConcept(label, s('low'), s('high'));
    setAxis(axis, concept.id, true);
    return { ok: true, text: `${axis} axis is now "${concept.title}"` };
  }
  if (name === 'focus_card') {
    const c = findCard(s('title'));
    if (!c) return { ok: false, text: 'card not found' };
    revealCard(c.id);
    return { ok: true, text: `focused "${c.title}"` };
  }
  return { ok: false, text: 'unknown tool' };
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
    const contextText = [`Space: ${title}`, `Current axes: ${axes}`, cardsContext(layoutCards(s).slice(0, 40), 14000)].join('\n\n');
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

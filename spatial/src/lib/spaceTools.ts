// AI が空間を触るための道具。チャットと音声で同じものを使う。
// 旧 MindAtlas の voiceTools と同じ考え方で、「読む」道具と「変える」道具を分けている。
import {
  addRelationRaw,
  applyAxes,
  canvasCards,
  createCard,
  createConcept,
  deleteCards,
  ensureConcept,
  focusCard,
  get,
  group,
  layoutCards,
  lookup,
  relayout,
  removeRelation,
  updateCard,
} from '../store';
import { CONCEPT_KEYS } from '../data/concepts';
import { AXIS_KEYS } from '../store/core';
import { USER_RELATION_TYPES, type AxisKey, type Card, type CardKind, type RelationType } from '../types';
import { webSearch } from './service';
import { reportUsage } from './cost';

export interface SpaceTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
}

const KINDS: CardKind[] = ['note', 'idea', 'issue', 'hypothesis', 'quote', 'document', 'article', 'person', 'company', 'link', 'topic'];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');
const list = (args: Record<string, unknown>, key: string) => (Array.isArray(args[key]) ? (args[key] as unknown[]).map((x) => String(x)) : []);

/** AI が返した id やタイトルから、実際のカードを探す */
function resolveCard(ref: string): Card | undefined {
  const key = ref.trim();
  if (!key) return undefined;
  const direct = lookup(key);
  if (direct) return direct;
  const all = Object.values(get().cards);
  const lower = key.toLowerCase();
  return (
    all.find((c) => c.title.toLowerCase() === lower) ??
    all.find((c) => c.title.toLowerCase().includes(lower)) ??
    all.find((c) => lower.includes(c.title.toLowerCase()) && c.title.length > 2)
  );
}

function brief(card: Card) {
  return { id: card.id, title: card.title, kind: card.kind, tags: card.tags, body: card.body.slice(0, 200) };
}

export const SPACE_TOOLS: SpaceTool[] = [
  {
    name: 'get_space_overview',
    description: 'Look at the current space: its title, the three semantic axes, how many cards there are, and the cards in view.',
    parameters: obj({}),
  },
  {
    name: 'search_cards',
    description: 'Find cards in this space by words in their title, body or tags (any of the words; best matches first). Use this before changing or deleting anything.',
    parameters: obj({ query: { type: 'string', description: 'Words to look for.' }, limit: { type: 'number' } }, ['query']),
  },
  {
    name: 'read_card',
    description: 'Read one card in full: its whole body, tags, url, group, and every card it is connected to (with the relation type and direction).',
    parameters: obj({ card: { type: 'string', description: 'Card id or exact title.' } }, ['card']),
  },
  {
    name: 'get_related_cards',
    description: 'Walk the connections from a card: its children (cards derived from it), parents, related cards and group members, up to the given depth.',
    parameters: obj({ card: { type: 'string', description: 'Card id or exact title.' }, depth: { type: 'number', description: '1 or 2 (default 1).' } }, ['card']),
  },
  {
    name: 'list_cards',
    description: 'List every card in this space, page by page (id, title, kind, a short start of the body).',
    parameters: obj({ offset: { type: 'number' }, limit: { type: 'number' } }),
  },
  {
    name: 'web_search',
    description: 'Search the web for current or outside facts that the cards do not contain. Returns an answer with source URLs. Each search costs credits, so search only when it helps.',
    parameters: obj({ query: { type: 'string', description: 'A self-contained search query (resolve "this"/"it" from the conversation).' } }, ['query']),
  },
  {
    name: 'create_cards',
    description: 'Create one or more cards in the space. They settle into their meaning automatically.',
    parameters: obj(
      {
        cards: {
          type: 'array',
          items: obj(
            {
              title: { type: 'string' },
              body: { type: 'string' },
              kind: { type: 'string', enum: KINDS },
              tags: { type: 'array', items: { type: 'string' } },
              near: { type: 'string', description: 'Card id or title this one belongs with; a "derived" relation is added.' },
            },
            ['title'],
          ),
        },
      },
      ['cards'],
    ),
  },
  {
    name: 'update_card',
    description: 'Change a card: its title, body, kind or tags. Only the given fields change.',
    parameters: obj(
      {
        card: { type: 'string', description: 'Card id or exact title.' },
        title: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string', enum: KINDS },
        tags: { type: 'array', items: { type: 'string' } },
      },
      ['card'],
    ),
  },
  {
    name: 'delete_cards',
    description: 'Delete cards. Say which ones by id or exact title. The user can undo this.',
    parameters: obj({ cards: { type: 'array', items: { type: 'string' } } }, ['cards']),
  },
  {
    name: 'link_cards',
    description: 'Connect two cards with a relation.',
    parameters: obj(
      { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string', enum: USER_RELATION_TYPES } },
      ['from', 'to'],
    ),
  },
  {
    name: 'unlink_cards',
    description: 'Remove the relations between two cards.',
    parameters: obj({ from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']),
  },
  {
    name: 'group_cards',
    description: 'Bundle several cards into one lump of thought.',
    parameters: obj({ cards: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, ['cards']),
  },
  {
    name: 'set_axis',
    description: 'Arrange the space: put a concept or a card on the X, Y or Z axis. Pass an empty label to clear the axis.',
    parameters: obj(
      {
        axis: { type: 'string', enum: ['x', 'y', 'z'] },
        label: { type: 'string', description: 'Concept name (e.g. "cost"), a card id/title to use as the axis, or "" to clear it.' },
        low: { type: 'string' },
        high: { type: 'string' },
      },
      ['axis'],
    ),
  },
  {
    name: 'focus_card',
    description: 'Move the view to a card so the user can see it.',
    parameters: obj({ card: { type: 'string' } }, ['card']),
  },
];

export async function executeSpaceTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const state = get();
  if (state.readOnly && !READ_TOOLS.includes(name)) {
    return { ok: false, text: 'This space is read-only.' };
  }

  if (name === 'read_card') {
    const card = resolveCard(str(args, 'card'));
    if (!card) return { ok: false, text: `No card matches "${str(args, 'card')}".` };
    const group = card.groupId ? lookup(card.groupId) : undefined;
    return {
      ok: true,
      text: `Card "${card.title}".`,
      data: {
        id: card.id,
        title: card.title,
        kind: card.kind,
        subtitle: card.subtitle,
        tags: card.tags,
        url: card.url,
        body: card.body.slice(0, 6000),
        hasImage: Boolean(card.image),
        group: group ? { id: group.id, title: group.title } : undefined,
        members: card.members?.map((m) => lookup(m)).filter(Boolean).map((m) => ({ id: m!.id, title: m!.title })),
        relations: connections(card.id),
      },
    };
  }

  if (name === 'get_related_cards') {
    const card = resolveCard(str(args, 'card'));
    if (!card) return { ok: false, text: `No card matches "${str(args, 'card')}".` };
    const depth = Math.max(1, Math.min(2, Number(args.depth) || 1));
    const found = neighborhood([card.id], depth, 40).filter((c) => c.id !== card.id);
    return {
      ok: true,
      text: `${found.length} cards are connected to "${card.title}".`,
      data: { card: { id: card.id, title: card.title }, relations: connections(card.id), cards: found.map(brief) },
    };
  }

  if (name === 'list_cards') {
    const all = Object.values(state.cards).filter((c) => c.kind !== 'concept');
    const offset = Math.max(0, Number(args.offset) || 0);
    const limit = Math.min(80, Number(args.limit) || 50);
    return {
      ok: true,
      text: `Cards ${offset + 1}-${Math.min(all.length, offset + limit)} of ${all.length}.`,
      data: all.slice(offset, offset + limit).map((c) => ({ id: c.id, title: c.title, kind: c.kind, body: c.body.slice(0, 80) })),
    };
  }

  if (name === 'web_search') {
    const query = str(args, 'query');
    if (!query) return { ok: false, text: 'query is required.' };
    // 検索ごとに費用がかかるが、確認は出さない（使うかどうかは AI に任せる）
    const r = await webSearch(query);
    reportUsage(r.usage);
    const sources = [...(r.citations ?? []), ...(r.sources ?? [])].filter((s, i, arr) => s.url && arr.findIndex((x) => x.url === s.url) === i).slice(0, 8);
    return { ok: true, text: `Searched the web for "${query}".`, data: { answer: r.text.slice(0, 3500), sources } };
  }

  if (name === 'get_space_overview') {
    const cards = layoutCards(state);
    return {
      ok: true,
      text: `Space "${state.title}" with ${cards.length} cards.`,
      data: {
        title: state.title,
        axes: Object.fromEntries(AXIS_KEYS.map((k) => [k, lookup(state.axes[k])?.title ?? null])),
        cardCount: cards.length,
        cards: cards.slice(0, 60).map(brief),
      },
    };
  }

  if (name === 'search_cards') {
    const q = str(args, 'query').toLowerCase();
    const words = q.split(/[\s,、。]+/).filter(Boolean);
    const limit = Math.min(30, Number(args.limit) || 12);
    // 言葉のどれかを含むものを、多く含む順に（タイトルに含むものを先に）
    const hits = Object.values(state.cards)
      .filter((c) => c.kind !== 'concept')
      .map((c) => {
        const title = c.title.toLowerCase();
        const text = `${c.subtitle ?? ''} ${c.body} ${c.tags.join(' ')}`.toLowerCase();
        const score = (title.includes(q) || text.includes(q) ? 4 : 0) + words.reduce((n, w) => n + (title.includes(w) ? 2 : text.includes(w) ? 1 : 0), 0);
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.c);
    return { ok: true, text: `${hits.length} cards match "${q}".`, data: hits.map(brief) };
  }

  if (name === 'create_cards') {
    const items = Array.isArray(args.cards) ? (args.cards as Record<string, unknown>[]) : [];
    const made: string[] = [];
    for (const item of items.slice(0, 20)) {
      const title = str(item, 'title');
      if (!title) continue;
      const kind = (KINDS as string[]).includes(str(item, 'kind')) ? (str(item, 'kind') as CardKind) : 'note';
      const id = createCard(
        { kind, title, body: str(item, 'body'), tags: list(item, 'tags').slice(0, 6), createdBy: 'ai' },
        undefined,
        { select: false },
      );
      const near = resolveCard(str(item, 'near'));
      if (near && near.id !== id) addRelationRaw(near.id, id, 'derived');
      made.push(id);
    }
    relayout({ stagger: false, mode: 'soft' });
    return { ok: made.length > 0, text: `Created ${made.length} cards.`, data: made.map((id) => lookup(id)).filter(Boolean).map((c) => brief(c!)) };
  }

  if (name === 'update_card') {
    const card = resolveCard(str(args, 'card'));
    if (!card) return { ok: false, text: `No card matches "${str(args, 'card')}".` };
    const patch: Partial<Card> = {};
    if (str(args, 'title')) patch.title = str(args, 'title');
    if (typeof args.body === 'string') patch.body = args.body;
    if ((KINDS as string[]).includes(str(args, 'kind'))) patch.kind = str(args, 'kind') as CardKind;
    if (Array.isArray(args.tags)) patch.tags = list(args, 'tags').slice(0, 8);
    if (!Object.keys(patch).length) return { ok: false, text: 'Nothing to change.' };
    updateCard(card.id, patch);
    return { ok: true, text: `Updated "${card.title}".`, data: brief(lookup(card.id)!) };
  }

  if (name === 'delete_cards') {
    const ids = list(args, 'cards')
      .map((ref) => resolveCard(ref)?.id)
      .filter((id): id is string => Boolean(id));
    if (!ids.length) return { ok: false, text: 'No matching cards to delete.' };
    const titles = ids.map((id) => lookup(id)?.title ?? id);
    deleteCards(ids);
    return { ok: true, text: `Deleted ${ids.length} cards: ${titles.join(', ')}.` };
  }

  if (name === 'link_cards' || name === 'unlink_cards') {
    const from = resolveCard(str(args, 'from'));
    const to = resolveCard(str(args, 'to'));
    if (!from || !to) return { ok: false, text: 'One of the cards was not found.' };
    if (name === 'unlink_cards') {
      const gone = get().relations.filter((r) => (r.from === from.id && r.to === to.id) || (r.from === to.id && r.to === from.id));
      gone.forEach((r) => removeRelation(r.id));
      return { ok: gone.length > 0, text: `Removed ${gone.length} relations between "${from.title}" and "${to.title}".` };
    }
    const type = (USER_RELATION_TYPES as readonly string[]).includes(str(args, 'type')) ? (str(args, 'type') as RelationType) : 'related';
    addRelationRaw(from.id, to.id, type);
    return { ok: true, text: `Connected "${from.title}" and "${to.title}" (${type}).` };
  }

  if (name === 'group_cards') {
    const ids = list(args, 'cards')
      .map((ref) => resolveCard(ref)?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length < 2) return { ok: false, text: 'Bundling needs at least two cards.' };
    const id = group(ids, str(args, 'title') || undefined);
    return { ok: Boolean(id), text: id ? `Bundled ${ids.length} cards.` : 'Could not bundle those cards.' };
  }

  if (name === 'set_axis') {
    const axis = str(args, 'axis').toLowerCase() as AxisKey;
    if (!AXIS_KEYS.includes(axis)) return { ok: false, text: 'axis must be x, y or z.' };
    const label = str(args, 'label');
    if (!label) {
      applyAxes({ ...get().axes, [axis]: '' });
      return { ok: true, text: `Cleared the ${axis.toUpperCase()} axis.` };
    }
    const concept = CONCEPT_KEYS.find((key) => key === label.toLowerCase());
    const existingConcept = Object.values(get().cards).find((c) => c.kind === 'concept' && c.title.toLowerCase() === label.toLowerCase());
    const card = resolveCard(label);
    const id = concept
      ? ensureConcept(concept)
      : existingConcept?.id ?? (card && card.kind !== 'concept' ? card.id : createConcept(label, str(args, 'low'), str(args, 'high')).id);
    applyAxes({ ...get().axes, [axis]: id });
    return { ok: true, text: `${axis.toUpperCase()} axis is now "${lookup(id)?.title ?? label}".` };
  }

  if (name === 'focus_card') {
    const card = resolveCard(str(args, 'card'));
    if (!card) return { ok: false, text: `No card matches "${str(args, 'card')}".` };
    focusCard(card.id);
    return { ok: true, text: `Showing "${card.title}".` };
  }

  return { ok: false, text: `Unknown tool ${name}.` };
}

/** 空間を読むだけの道具（読み取り専用のスペースでも使える） */
const READ_TOOLS = ['get_space_overview', 'search_cards', 'read_card', 'get_related_cards', 'list_cards', 'web_search', 'focus_card'];

/** あるカードのつながり（向きと種類、相手のタイトル） */
function connections(id: string) {
  const s = get();
  const out: { type: string; direction: 'to' | 'from'; id: string; title: string; label?: string }[] = [];
  for (const r of s.relations) {
    if (r.suggested || (r.from !== id && r.to !== id)) continue;
    const other = lookup(r.from === id ? r.to : r.from);
    if (other) out.push({ type: r.type, direction: r.from === id ? 'to' : 'from', id: other.id, title: other.title, label: r.label });
  }
  const c = s.cards[id];
  if (c?.groupId && s.cards[c.groupId]) out.push({ type: 'member-of', direction: 'to', id: c.groupId, title: s.cards[c.groupId].title, label: undefined });
  return out;
}

/**
 * 選んだカードの周り：つながっているカード（子・親・関連・出典）とグループの仲間を、
 * 近いものから順に集める。AI に質問するとき、選んだカードと一緒に渡す。
 */
export function neighborhood(ids: string[], depth = 1, limit = 40): Card[] {
  const s = get();
  const seen = new Set(ids.filter((id) => s.cards[id]));
  let frontier = [...seen];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const c = s.cards[id];
      const near = [
        ...s.relations.filter((r) => !r.suggested && (r.from === id || r.to === id)).map((r) => (r.from === id ? r.to : r.from)),
        ...(c?.members ?? []),
        ...(c?.groupId ? [c.groupId] : []),
      ];
      for (const n of near) {
        if (seen.has(n) || !s.cards[n] || s.cards[n].kind === 'concept') continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return [...seen].slice(0, limit).map((id) => s.cards[id]);
}

/** 渡すカードどうしのつながり（AI が構造を読めるように） */
export function relationsContext(cards: Card[]) {
  const ids = new Set(cards.map((c) => c.id));
  const lines = get()
    .relations.filter((r) => !r.suggested && ids.has(r.from) && ids.has(r.to))
    .map((r) => `- [${r.from}] --${r.type}--> [${r.to}]${r.label ? ` (${r.label})` : ''}`);
  return lines.length ? `## Connections between these cards\n${lines.slice(0, 120).join('\n')}` : '';
}

/** 画面で読めているカードを優先して、AI に渡すカードを選ぶ */
export function visibleContextCards(limit = 60): Card[] {
  const s = get();
  const { w, h } = s.viewport;
  const onScreen = (c: Card) => {
    const x = c.x * s.camera.zoom + s.camera.x;
    const y = c.y * s.camera.zoom + s.camera.y;
    return x > -200 && x < w + 200 && y > -200 && y < h + 200;
  };
  const cards = canvasCards(s);
  const seen = cards.filter(onScreen);
  const rest = cards.filter((c) => !seen.includes(c));
  return [...seen, ...rest].slice(0, limit);
}

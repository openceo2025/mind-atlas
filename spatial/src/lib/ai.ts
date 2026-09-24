// LLM を使う AI 操作。配置（意味軸）には使わず、要約・比較・展開などの「考える補助」に使う。
// hosted では既存のクレジット課金を通り、ローカルでは開発ブリッジのキーで動く。
import { getLocale, t, type Locale } from '../i18n';
import type { Card, CardKind, RelationType } from '../types';
import { aiTurn, saveAiPreference, ServiceError, type AiPreference, type AiTurnMessage } from './service';
import { confirmRequestCost, reportUsage } from './cost';
import { SPACE_TOOLS, executeSpaceTool, relationsContext } from './spaceTools';
import { routeSpaceRequest } from './decisions';

const LANGUAGE: Record<Locale, string> = {
  en: 'English',
  ja: 'Japanese',
  es: 'Spanish',
  'pt-BR': 'Brazilian Portuguese',
  fr: 'French',
  de: 'German',
  ko: 'Korean',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  id: 'Indonesian',
  hi: 'Hindi',
  ar: 'Arabic',
};

export interface AiModelChoice {
  provider: string;
  model?: string;
  reasoningEffort?: string;
}

const MODEL_KEY = 'mindatlas-spatial-model';
let choice: AiModelChoice = { provider: 'openai' };
let appliedAccountKey = '';

export function getAiModel() {
  return choice;
}

function rememberModel(next: AiModelChoice) {
  choice = next;
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(next));
  } catch {
    // この画面の間だけ有効
  }
}

export function loadSavedModel() {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw) choice = JSON.parse(raw) as AiModelChoice;
  } catch {
    // 既定のモデルを使う
  }
}

/** 設定で選んだモデル。ブラウザに覚え、ログイン中はアカウントにも保存する（旧 MindAtlas と共通） */
export async function chooseAiModel(next: AiModelChoice, saveToAccount: boolean) {
  rememberModel(next);
  if (!saveToAccount) return;
  const saved = await saveAiPreference({ provider: next.provider, model: next.model ?? '', reasoningEffort: next.reasoningEffort ?? '' });
  appliedAccountKey = accountKey(saved);
}

/** アカウントに保存されたモデルを使う。別の端末や旧 MindAtlas で選び直したときも追従する */
export function applyAccountAiModel(preference: AiPreference | null | undefined) {
  if (!preference?.provider) return;
  const key = accountKey(preference);
  if (key === appliedAccountKey) return;
  appliedAccountKey = key;
  rememberModel({ provider: preference.provider, model: preference.model || undefined, reasoningEffort: preference.reasoningEffort || undefined });
}

function accountKey(preference: AiPreference) {
  return `${preference.provider}|${preference.model}|${preference.reasoningEffort}|${preference.updatedAt ?? ''}`;
}

/** 選んだモデルが提供されなくなっていたら、その会社の既定モデルで一度だけやり直す */
type TurnPayload = { messages: AiTurnMessage[]; contextText?: string; tools?: { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[] };

async function turn(payload: TurnPayload) {
  await confirmRequestCost({ chars: payload.messages.reduce((n, m) => n + m.content.length, 0) + (payload.contextText?.length ?? 0) });
  const send = async () => {
    const result = await aiTurn({ ...choice, ...payload });
    reportUsage(result.usage);
    return result;
  };
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== 'model_not_enabled' || !choice.model) throw error;
    rememberModel({ provider: choice.provider });
    return await send();
  }
}

const SYSTEM = [
  'You are the thinking assistant inside MindAtlas, a spatial canvas where ideas are cards placed along semantic axes.',
  'Cards have ids, kinds, titles, bodies and tags. Relations connect cards.',
  'Be concrete and faithful to the given cards; do not invent facts that are not implied by them unless asked to brainstorm.',
].join(' ');

export function cardsContext(cards: Card[], maxChars = 24000) {
  let out = '';
  for (const c of cards) {
    const block = [
      `### [${c.id}] ${c.title}`,
      `kind: ${c.kind}${c.tags.length ? ` | tags: ${c.tags.join(', ')}` : ''}${c.url ? ` | url: ${c.url}` : ''}`,
      c.subtitle ? c.subtitle : '',
      c.body ? c.body.slice(0, 2400) : '',
      c.facts?.length ? c.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (out.length + block.length > maxChars) break;
    out += `${block}\n\n`;
  }
  return out.trim();
}

function language() {
  return LANGUAGE[getLocale()] ?? 'English';
}

/** モデルが JSON 以外を返したとき。raw は画面での代替表示に使う。 */
export class AiFormatError extends Error {
  constructor(public raw: string) {
    super(t('error.aiFormat'));
  }
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiFormatError(text);
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    throw new AiFormatError(text);
  }
}

type ToolSpec = { type: 'function'; name: string; description: string; parameters: Record<string, unknown> };

const toolSpec = (name: string): ToolSpec[] =>
  SPACE_TOOLS.filter((tool) => tool.name === name).map((tool) => ({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters }));

/** 道具の呼び出しを実行して、会話に結果を足す */
async function runToolCalls(messages: AiTurnMessage[], text: string, calls: NonNullable<AiTurnMessage['toolCalls']>, onStep?: (step: ChatStep) => void) {
  messages.push({ role: 'assistant', content: text, toolCalls: calls });
  for (const call of calls) {
    let args: Record<string, unknown> = {};
    try {
      args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    const outcome = await executeSpaceTool(call.name, args).catch((error: unknown) => ({
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    }));
    onStep?.({ tool: call.name, ok: outcome.ok, text: outcome.text });
    messages.push({
      role: 'tool',
      name: call.name,
      toolCallId: call.callId,
      content: [outcome.text, 'data' in outcome && outcome.data !== undefined ? JSON.stringify(outcome.data) : '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000),
    });
  }
}

/**
 * JSON で答えてもらう AI 操作。web が true なら、必要なときに AI がネット検索してから答える
 * （要約・展開・抽出など、あらゆる AI 操作で外の情報を足して考えられるように）。
 */
async function runJson<T>(task: string, context: string, opts: { web?: boolean } = {}): Promise<T> {
  const prompt = [
    SYSTEM,
    task,
    opts.web ? 'If current or outside facts would clearly improve the answer, call web_search first (at most twice); otherwise answer from the cards.' : '',
    `Write every human-readable string in ${language()}.`,
    'Reply with a single JSON object only, no prose, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const messages: AiTurnMessage[] = [{ role: 'user', content: prompt }];
  const tools = opts.web ? toolSpec('web_search') : undefined;
  for (let i = 0; tools && i < 2; i += 1) {
    const result = await turn({ messages, contextText: context, tools });
    const calls = result.toolCalls ?? [];
    if (!calls.length) return extractJson<T>(result.text);
    await runToolCalls(messages, result.text, calls);
  }
  const result = await turn({ messages, contextText: context });
  return extractJson<T>(result.text);
}

// ── 要約 ─────────────────────────────────────────────
export type Lens = 'points' | 'risk' | 'opportunity';

export interface SummaryResult {
  lead: string;
  points: { text: string; sourceId?: string }[];
  tags: string[];
}

export async function summarize(cards: Card[], lens: Lens, variant: number): Promise<SummaryResult> {
  const focus = {
    points: 'the key points',
    risk: 'risks, blockers and weaknesses',
    opportunity: 'opportunities, tailwinds and strengths',
  }[lens];
  let r: SummaryResult;
  try {
    r = await runJson<SummaryResult>(
      [
        `Summarize the cards below, focusing on ${focus}.`,
        variant > 0 ? `This is re-run #${variant}: choose a noticeably different angle than an obvious summary.` : '',
        'Return {"lead": string (2-3 sentences), "points": [{"text": string (one sentence), "sourceId": id of the card it comes from}] (3-5 items), "tags": string[] (2-4 short hashtags without #)}.',
      ].join('\n'),
      cardsContext(cards),
      { web: true },
    );
  } catch (error) {
    // 散文で返ってきた場合は、そのまま要約文として見せる
    if (!(error instanceof AiFormatError) || !error.raw.trim()) throw error;
    return { lead: error.raw.trim().slice(0, 1200), points: [], tags: [] };
  }
  return { lead: String(r.lead ?? ''), points: Array.isArray(r.points) ? r.points.slice(0, 6) : [], tags: Array.isArray(r.tags) ? r.tags.slice(0, 5) : [] };
}

// ── 展開 ─────────────────────────────────────────────
export interface Draft {
  kind: CardKind;
  title: string;
  body: string;
  tags: string[];
  relation?: RelationType;
}

const DRAFT_KINDS: CardKind[] = ['idea', 'hypothesis', 'issue', 'quote', 'note'];

function cleanDrafts(items: unknown): Draft[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((d: Record<string, unknown>) => ({
      kind: DRAFT_KINDS.includes(d.kind as CardKind) ? (d.kind as CardKind) : 'idea',
      title: String(d.title ?? '').slice(0, 120),
      body: String(d.body ?? '').slice(0, 1200),
      tags: Array.isArray(d.tags) ? d.tags.map((x) => String(x).replace(/^#/, '')).slice(0, 3) : [],
      relation: (['derived', 'supports', 'contradicts', 'related'] as RelationType[]).includes(d.relation as RelationType) ? (d.relation as RelationType) : 'derived',
    }))
    .filter((d) => d.title);
}

export async function expand(card: Card, neighbors: Card[]): Promise<Draft[]> {
  const r = await runJson<{ items: unknown }>(
    [
      `Expand the focus card [${card.id}] "${card.title}" into the cards its own content asks for. Follow the card, not a template.`,
      'If the card lists things (dates, days, steps, places, people, options, sections), make one card per item, in the same order, keeping each item\'s own label as the title. Do not merge or drop items, and do not add commentary items.',
      'Only when the card has no such list, branch the thinking instead: one idea (a concrete action), one issue (a risk or open question), one hypothesis (a testable claim).',
      'Use the neighboring cards only as background. Do not repeat what the cards already say. Produce at most 12 cards.',
      'Return {"items": [{"kind": "note"|"idea"|"issue"|"hypothesis"|"quote", "title": short title, "body": 1-2 sentences, "tags": [1-2 short tags], "relation": "derived"|"supports"|"contradicts"}]}.',
    ].join('\n'),
    [cardsContext([card, ...neighbors.slice(0, 12)]), relationsContext([card, ...neighbors.slice(0, 12)])].filter(Boolean).join('\n\n'),
    { web: true },
  );
  return cleanDrafts(r.items);
}

export async function extractIdeas(card: Card): Promise<Draft[]> {
  const r = await runJson<{ items: unknown }>(
    [
      `Extract the 3-5 most important standalone points from the card [${card.id}] "${card.title}".`,
      'Each point becomes a new card: classify it as "quote" (a fact or statement worth keeping), "issue" (a problem or risk), "hypothesis" (a claim) or "idea" (an action).',
      'Return {"items": [{"kind": ..., "title": short title, "body": the point in 1-2 sentences, "tags": [1-2 short tags]}]}.',
    ].join('\n'),
    cardsContext([card]),
    { web: true },
  );
  return cleanDrafts(r.items).map((d) => ({ ...d, relation: 'derived' }));
}

// ── 関係の分類 ─────────────────────────────────────────
export interface RelationSuggestion {
  from: string;
  to: string;
  type: RelationType;
  reason: string;
}

export async function classifyRelations(cards: Card[], pairs: [string, string][]): Promise<RelationSuggestion[]> {
  const r = await runJson<{ relations: unknown }>(
    [
      'For each candidate pair of cards, decide the relation type from the first card to the second.',
      'Types: "supports" (evidence for), "contradicts" (conflicts with or is a risk to), "derived" (the second follows from the first), "related" (same theme), or "none".',
      `Candidate pairs: ${pairs.map(([a, b]) => `[${a}]→[${b}]`).join(', ')}.`,
      'Return {"relations": [{"from": id, "to": id, "type": type, "reason": one short sentence}]} and omit pairs typed "none".',
    ].join('\n'),
    cardsContext(cards),
  );
  const ok: RelationType[] = ['supports', 'contradicts', 'derived', 'related'];
  return (Array.isArray(r.relations) ? r.relations : [])
    .map((x: Record<string, unknown>) => ({ from: String(x.from), to: String(x.to), type: x.type as RelationType, reason: String(x.reason ?? '') }))
    .filter((x) => ok.includes(x.type) && pairs.some(([a, b]) => (a === x.from && b === x.to) || (a === x.to && b === x.from)));
}

export async function nameClusters(groups: Card[][]): Promise<string[]> {
  const context = groups.map((g, i) => `## Group ${i + 1}\n${g.map((c) => `- ${c.title}`).join('\n')}`).join('\n\n');
  const r = await runJson<{ labels: unknown }>(
    `Give each group of card titles a short name (2-6 words) that captures what its members share. Return {"labels": [one name per group, in order]}.`,
    context,
  );
  return Array.isArray(r.labels) ? r.labels.map((x) => String(x)) : [];
}

export async function suggestAxisEnds(label: string): Promise<{ low: string; high: string; description: string }> {
  const r = await runJson<{ low: string; high: string; description: string }>(
    `The user wants a semantic axis called "${label}" to arrange idea cards. Return {"low": 1-3 word label for the low end, "high": 1-3 word label for the high end, "description": one sentence describing what a high value means}.`,
    '',
  );
  return { low: String(r.low ?? ''), high: String(r.high ?? ''), description: String(r.description ?? '') };
}

// ── チャット ─────────────────────────────────────────
const MAX_TOOL_TURNS = 10;

export interface ChatStep {
  tool: string;
  ok: boolean;
  text: string;
}

/**
 * チャット。道具を渡してあるので、AI はカードを作る・直す・消す・つなぐ・軸を変える
 * といった操作を自分で行い、終わってから答えを返す。
 */
export async function chat(
  history: AiTurnMessage[],
  cards: Card[],
  spaceTitle: string,
  opts: { onStep?: (step: ChatStep) => void } = {},
) {
  // まず判断モデルに読ませる。既にあるカードを消す・つなぐ・束ねる・寄るだけなら
  // ここで終わり、チャットモデルは一度も呼ばれない（往復ぶんの費用がまるごと消える）。
  const said = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const routed = await routeSpaceRequest(said, cards).catch(() => ({}) as { action?: undefined; tool?: undefined });
  if (routed.action) {
    opts.onStep?.({ tool: routed.action.tool, ok: true, text: routed.action.done });
    return routed.action.done;
  }

  const intro = [
    SYSTEM,
    `The user is working in the space "${spaceTitle}". The cards below are what the user can see right now.`,
    'The first cards in the context are the ones the user selected; the rest are cards connected to them. "Connections" lists the relations (derived = the second card was born from the first; contains = group membership).',
    'You can read anything in this space yourself: search_cards, read_card (whole body and connections), get_related_cards (walk children/parents/relations) and list_cards. Look things up as many times as you need before answering instead of saying you cannot see something.',
    'Use web_search for current or outside facts the cards do not contain.',
    'You can change the space with the tools: create, update, delete, link, bundle cards, set an axis or focus a card. Change things only when the user asks for a change; never guess a card id — search or use the ids in the context.',
    'After the tools have run, tell the user briefly what you changed.',
    `Answer in ${language()} unless the user writes in another language. Use Markdown lists when helpful.`,
  ].join('\n');
  const messages: AiTurnMessage[] = history.map((m, i) => (i === 0 && m.role === 'user' ? { role: 'user', content: `${intro}\n\n${m.content}` } : m));
  // 道具が絞れているなら、その道具だけを渡す（毎ターンの入力が 3〜4 割減る）
  // 読む道具とネット検索は、道具を絞ったときも必ず渡す
  const needed = routed.tool ? new Set([routed.tool, 'get_space_overview', 'search_cards', 'read_card', 'get_related_cards', 'list_cards', 'web_search']) : null;
  const tools = SPACE_TOOLS.filter((tool) => !needed || needed.has(tool.name)).map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const contextText = [cardsContext(cards, 30000), relationsContext(cards)].filter(Boolean).join('\n\n');

  for (let i = 0; i < MAX_TOOL_TURNS; i += 1) {
    const result = await turn({ messages, contextText, tools });
    const calls = result.toolCalls ?? [];
    if (!calls.length) return result.text;
    await runToolCalls(messages, result.text, calls, opts.onStep);
  }
  const last = await turn({ messages, contextText });
  return last.text;
}

// 判断モデルに投げる「この製品ならではの問い」をまとめた場所。
// ここに置くのは、文章を書く必要がなく、選ぶ・是か非かで答えが出るものだけ。
import { CARD_KINDS, type Card, type CardKind, type RelationType } from '../types';
import { askDecisions, choice, decideEnabled, noul, pickChoice, pickNoul } from './decide';
import { t } from '../i18n';
import { activeWords, type WordView } from './relStyle';
import {
  addRelation,
  deleteCards,
  focusCard,
  get,
  group,
  isAxisCard,
  lookup,
  relayout,
  setBusy,
  updateCard,
  updateRelation,
} from '../store';

const NONE = '__none__';
const brief = (card: Card, n: number) => ({ card: n, title: card.title, text: [card.subtitle, card.body].filter(Boolean).join(' ').slice(0, 220), tags: card.tags });

// ── 1) 関係の判定 ─────────────────────────────────────────
// 選択肢は、いまの空間で使える言葉（セットの言葉＋自分の言葉）。向きのある言葉は
// 「a → b」と「b → a」を別の選択肢にして、向きもいっしょに選ばせる。
function wordOptions(words: WordView[], a: string, b: string) {
  const fill = (text: string, x: string, y: string) => text.replaceAll('{a}', x).replaceAll('{b}', y);
  const options: Record<string, string> = {};
  for (const w of words) {
    if (w.directed) {
      options[`${w.id}>`] = fill(w.meaning, a, b);
      options[`${w.id}<`] = fill(w.meaning, b, a);
    } else {
      options[w.id] = fill(w.meaning, a, b);
    }
  }
  options[NONE] = 'none of these fits; they are not meaningfully connected in these ways';
  return options;
}

/** 選択肢の答えを「言葉」と「向き」に戻す。reversed なら b → a の向き */
function parsePick(value: string, words: WordView[]) {
  const reversed = value.endsWith('<');
  const id = value.replace(/[<>]$/, '');
  return words.some((w) => w.id === id) ? { type: id as RelationType, reversed } : null;
}

export interface JudgedRelation {
  from: string;
  to: string;
  type: RelationType;
  label: string;
  judged: number;
}

/**
 * 組ごとに、いまの言葉のどれで結ぶか（と向き）を選ばせる。「どれでもない」を選べるので、
 * 近いだけで意味のない組はここで落ちる。確信度はそのまま札に出す。
 */
export async function judgeRelations(pairs: [string, string][], minConfidence = 0.45): Promise<JudgedRelation[]> {
  if (!decideEnabled() || !pairs.length) return [];
  const ids = [...new Set(pairs.flat())];
  const cards = ids.map((id) => lookup(id)).filter(Boolean) as Card[];
  if (cards.length < 2) return [];
  const words = activeWords();
  const index = new Map(cards.map((c, i) => [c.id, i + 1]));
  const questions = Object.fromEntries(
    pairs.map(([a, b], i) => {
      const x = `card ${index.get(a)}`;
      const y = `card ${index.get(b)}`;
      return [`p${i}`, choice(`Which statement describes how ${x} and ${y} are connected? Judge this pair only, from what the cards say.`, wordOptions(words, x, y))];
    }),
  );
  const answers = await askDecisions('relations', { cards: cards.map((c, i) => brief(c, i + 1)) }, questions);
  const out: JudgedRelation[] = [];
  pairs.forEach(([a, b], i) => {
    const picked = pickChoice(answers[`p${i}`], minConfidence);
    if (!picked || picked.value === NONE) return;
    const word = parsePick(picked.value, words);
    if (!word) return;
    const [from, to] = word.reversed ? [b, a] : [a, b];
    out.push({ from, to, type: word.type, judged: picked.confidence, label: t('relation.judged', { n: Math.round(picked.confidence * 100) }) });
  });
  return out;
}

/**
 * 人が引いたばかりの線に、言葉を選ばせる。待っている間に人が言葉を選んだら、そちらを優先する。
 * 判定できなかったときは「言葉なし」のまま残す。
 */
export async function judgeDrawnRelation(relationId: string) {
  const rel = get().relations.find((r) => r.id === relationId);
  if (!rel || !decideEnabled()) return;
  const key = `judge:${relationId}`;
  setBusy(key, true);
  try {
    const [judged] = await judgeRelations([[rel.from, rel.to]], 0.35);
    const now = get().relations.find((r) => r.id === relationId);
    if (!judged || !now || now.type !== 'related') return;
    updateRelation(relationId, { type: judged.type, from: judged.from, to: judged.to, judged: judged.judged }, { undoable: false });
  } catch {
    // 判断モデルが使えなければ、言葉なしの線のまま人が選ぶ
  } finally {
    setBusy(key, false);
  }
}

// ── 2) チャットの道具選び ──────────────────────────────────
/** 判断モデルが引き受けた仕事。これが返ったらチャットモデルは一度も呼ばない */
export interface RoutedAction {
  done: string;
  tool: string;
}

const INTENTS: Record<string, string> = {
  answer: 'the user asks a question, wants an explanation, a summary or new written material',
  delete: 'the user asks to remove or throw away cards that already exist',
  link: 'the user asks to connect two existing cards to each other',
  group: 'the user asks to bundle several existing cards into one lump',
  focus: 'the user asks to show, find or move to one existing card',
  remind: 'the user asks to be reminded about a card at some time, or to change or cancel such a reminder',
  change: 'the user asks to create new cards, rewrite a card, or change an axis',
};

const INTENT_TOOL: Record<string, string> = { delete: 'delete_cards', link: 'link_cards', group: 'group_cards', focus: 'focus_card', remind: 'set_reminder' };

/**
 * ユーザーの一言を、まず判断モデルに読ませる。既にあるカードを消す・つなぐ・束ねる・
 * 寄るだけなら、対象のカードも判断モデルに選ばせてその場で実行し、チャットモデルには
 * 一切触らない。迷ったとき（確信度が足りないとき）は、これまで通りの道へ戻す。
 */
export async function routeSpaceRequest(message: string, cards: Card[]): Promise<{ action?: RoutedAction; tool?: string }> {
  const text = message.trim();
  if (!decideEnabled() || !text || get().readOnly || !cards.length) return {};
  // 軸になっているカードと概念カードは、消す・束ねるの対象にならない
  const list = cards.filter((c) => c.kind !== 'concept' && !isAxisCard(c.id)).slice(0, 40);
  if (!list.length) return {};
  const state = { request: text, cards: list.map((c, i) => brief(c, i + 1)) };
  const answers = await askDecisions('chat-route', state, {
    intent: choice('What is the user asking the app to do?', INTENTS),
  });
  const intent = pickChoice(answers.intent, 0.7);
  if (!intent || intent.value === 'answer') return {};
  const tool = INTENT_TOOL[intent.value];
  if (!tool) return { tool: undefined };
  // 時刻の読み取りはチャットモデルに任せる（今の時刻を調べてから set_reminder を呼ぶ）
  if (intent.value === 'remind') return { tool };

  // 対象のカードは「これは対象か」を1枚ずつ聞く（数を数えさせると当てにならない）
  const targetQuestions: Record<string, ReturnType<typeof noul>> = {};
  list.forEach((_, i) => {
    targetQuestions[`t${i}`] = noul(`Card ${i + 1} is one of the cards the user is pointing at in "${text}".`);
  });
  const words = activeWords();
  if (intent.value === 'link') {
    targetQuestions.kind = choice(
      'Which word does the user want for the link between them?',
      { ...Object.fromEntries(words.map((w) => [w.id, `${w.label}: ${w.meaning.replaceAll('{a}', 'the first card').replaceAll('{b}', 'the second card')}`])), [NONE]: 'the user did not say' },
    );
  }
  const picked = await askDecisions('chat-targets', state, targetQuestions);
  const targets = list
    .map((card, i) => ({ card, p: pickNoul(picked[`t${i}`]) ?? 0 }))
    .filter((entry) => entry.p >= 0.7)
    .sort((a, b) => b.p - a.p);
  if (!targets.length) return { tool };

  const titles = targets.map((entry) => entry.card.title);
  if (intent.value === 'delete') {
    const ids = targets.map((entry) => entry.card.id);
    const before = Object.keys(get().cards).length;
    deleteCards(ids);
    const removed = before - Object.keys(get().cards).length;
    // 実際に消えた枚数で報告する（消せないカードを指していたらチャットモデルへ回す）
    if (!removed) return { tool };
    return { action: { tool, done: t('chat.done.deleted', { n: removed, titles: titles.slice(0, 4).join('、') }) } };
  }
  if (intent.value === 'focus') {
    focusCard(targets[0].card.id);
    return { action: { tool, done: t('chat.done.focused', { title: titles[0] }) } };
  }
  if (intent.value === 'group') {
    if (targets.length < 2) return { tool };
    group(targets.map((entry) => entry.card.id));
    return { action: { tool, done: t('chat.done.grouped', { n: targets.length }) } };
  }
  if (intent.value === 'link') {
    if (targets.length < 2) return { tool };
    const kind = pickChoice(picked.kind, 0.4)?.value;
    addRelation(targets[0].card.id, targets[1].card.id, kind && words.some((w) => w.id === kind) ? kind : 'related');
    return { action: { tool, done: t('chat.done.linked', { a: titles[0], b: titles[1] }) } };
  }
  return { tool };
}

// ── 3) 取り込んだカードの種別とタグ ─────────────────────────
const KIND_MEANING: Partial<Record<CardKind, string>> = {
  note: 'a plain note or a piece of text',
  idea: 'an idea or a proposal',
  hypothesis: 'a hypothesis, something assumed to be true for now',
  issue: 'a problem, a risk or an open question',
  quote: 'a quotation from somewhere else',
  document: 'a document, a report or a specification',
  article: 'a news article or a blog post',
  link: 'a link to a web page',
  image: 'a picture',
  dataset: 'data, numbers, a table or a spreadsheet',
  company: 'an organisation or a company',
  person: 'a person',
  summary: 'a summary of other material',
  topic: 'the overall subject of the whole space',
};

/** その空間でよく使われているタグ（揺れを増やさないよう、まずここから選ばせる） */
function frequentTags(limit = 12) {
  const counts = new Map<string, number>();
  for (const card of Object.values(get().cards)) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

/**
 * 取り込んだばかりのカードに、種別と（あれば）既存のタグを付ける。
 * 失敗しても取り込み自体は済んでいるので、静かに諦めてよい。
 */
export async function classifyNewCards(ids: string[]) {
  if (!decideEnabled() || !ids.length) return;
  const cards = ids.map((id) => lookup(id)).filter((c): c is Card => Boolean(c) && c!.kind !== 'group' && c!.kind !== 'concept').slice(0, 20);
  if (!cards.length) return;
  const tags = frequentTags();
  const kindOptions = Object.fromEntries(CARD_KINDS.filter((k) => KIND_MEANING[k]).map((k) => [k, KIND_MEANING[k]!]));
  const questions: Record<string, ReturnType<typeof choice>> = {};
  cards.forEach((card, i) => {
    questions[`k${i}`] = choice(`What kind of card is card ${i + 1}?`, kindOptions);
    if (tags.length && !card.tags.length) {
      questions[`g${i}`] = choice(
        `Which of the tags already used in this space fits card ${i + 1}?`,
        { ...Object.fromEntries(tags.map((tag) => [tag, null])), [NONE]: 'none of them fits' },
      );
    }
  });
  const answers = await askDecisions('classify-cards', { cards: cards.map((c, i) => brief(c, i + 1)), tags }, questions);
  let changed = false;
  cards.forEach((card, i) => {
    const patch: Partial<Card> = {};
    const kind = pickChoice(answers[`k${i}`], 0.6)?.value as CardKind | undefined;
    if (kind && CARD_KINDS.includes(kind) && kind !== card.kind) patch.kind = kind;
    const tag = pickChoice(answers[`g${i}`], 0.6)?.value;
    if (tag && tag !== NONE && !card.tags.includes(tag)) patch.tags = [...card.tags, tag];
    if (!Object.keys(patch).length) return;
    updateCard(card.id, patch, { relayout: false });
    changed = true;
  });
  if (changed) relayout({ stagger: false, mode: 'soft' });
}

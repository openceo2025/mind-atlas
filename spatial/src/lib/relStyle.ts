// 線の見た目と読み方。言葉の定義は relationCatalog.ts、ここはそれを画面の言葉に直す場所。
import type { Relation, RelationType, RelationWord } from '../types';
import { t, type MessageKey } from '../i18n';
import { get } from '../store/core';
import { CUSTOM_PREFIX, DEFAULT_VOCABULARY, VOCABULARIES, WORDS, type Core, type VocabularyId } from './relationCatalog';

const SYSTEM_STYLE: Record<string, { color: string; dash: string }> = {
  related: { color: '#8aa0c8', dash: '' },
  source: { color: '#6ae3ff', dash: '2 5' },
  derived: { color: '#6ae3ff', dash: '7 5' },
  contains: { color: '#ffb347', dash: '1 6' },
  'axis-of': { color: '#ffd166', dash: '' },
  'compared-with': { color: '#a98bff', dash: '9 4' },
};

/** 画面で使う言葉 1 つ分 */
export interface WordView {
  id: string;
  label: string;
  back: string;
  directed: boolean;
  color: string;
  dash: string;
  /** 判断モデルへの説明（{a} → {b} の向き） */
  meaning: string;
  core?: Core;
  custom?: boolean;
}

export const vocabularyOf = (s = get()): VocabularyId => s.vocabulary ?? DEFAULT_VOCABULARY;
export const vocabularyName = (id: VocabularyId) => t(`vocab.${id}` as MessageKey);
export const vocabularyHint = (id: VocabularyId) => t(`vocab.${id}.hint` as MessageKey);

function customView(w: RelationWord): WordView {
  return {
    id: w.id,
    label: w.label,
    back: w.directed ? w.back || w.label : w.label,
    directed: w.directed,
    color: w.color,
    dash: '',
    meaning: w.directed ? `reading from {a} to {b}: "${w.label}" — ${w.meaning}` : `{a} and {b}: "${w.label}" — ${w.meaning}`,
    custom: true,
  };
}

/** 言葉の ID から画面用の定義を引く。アプリの線（関連・出典など）なら null */
export function wordView(type: RelationType, s = get()): WordView | null {
  if (type.startsWith(CUSTOM_PREFIX)) {
    const w = s.relationWords.find((x) => x.id === type);
    return w ? customView(w) : null;
  }
  const def = WORDS[type];
  if (!def) return null;
  return {
    id: def.id,
    label: t(`word.${def.id}` as MessageKey),
    back: def.directed ? t(`word.${def.id}.back` as MessageKey) : t(`word.${def.id}` as MessageKey),
    directed: def.directed,
    color: def.color,
    dash: def.dash,
    meaning: def.meaning,
    core: def.core,
  };
}

/** いまの空間で選べる言葉（セットの言葉＋自分の言葉） */
export function activeWords(s = get()): WordView[] {
  const set = VOCABULARIES[vocabularyOf(s)].map((id) => wordView(id, s)!);
  return [...set, ...s.relationWords.map(customView)];
}

/**
 * 表示に使う言葉。別のセットで引いた線でも、いまのセットに同じ土台の言葉があればそちらで見せる
 * （データは書き換えない）。
 */
export function shownWord(type: RelationType, s = get()): WordView | null {
  const w = wordView(type, s);
  if (!w || w.custom || !w.core) return w;
  const ids = VOCABULARIES[vocabularyOf(s)];
  if (ids.includes(w.id)) return w;
  const twin = ids.find((id) => WORDS[id].core === w.core);
  return twin ? wordView(twin, s) : w;
}

export function relStyle(type: RelationType, s = get()): { color: string; dash: string } {
  const w = shownWord(type, s);
  if (w) return { color: w.color, dash: w.dash };
  return SYSTEM_STYLE[type] ?? SYSTEM_STYLE.related;
}

/** 線の名前（順方向） */
export function relLabel(type: RelationType, s = get()) {
  const w = shownWord(type, s);
  if (w) return w.label;
  return SYSTEM_STYLE[type] ? t(`relation.${type}` as MessageKey) : t('relation.related');
}

/**
 * 見ているカードから読んだ線の言葉。向きのある言葉は、矢印の先のカードから見ると裏の言葉になる
 * （「だから」の線は、結論のカードから見ると「なぜなら」）。
 */
export function relReading(rel: Pick<Relation, 'from' | 'to' | 'type'>, viewer?: string | null, s = get()) {
  const w = shownWord(rel.type, s);
  const reversed = Boolean(w?.directed && viewer && viewer === rel.to);
  const text = w ? (reversed ? w.back : w.label) : relLabel(rel.type, s);
  return { text, reversed, directed: Boolean(w?.directed), word: w };
}

/** 線を 1 文で読む（「A だから B」）。見ているカードが主語になる */
export function relSentence(rel: Pick<Relation, 'from' | 'to' | 'type'>, titles: { from: string; to: string }, viewer?: string | null, s = get()) {
  const w = shownWord(rel.type, s);
  const reversed = Boolean(w?.directed && viewer && viewer === rel.to);
  const a = reversed ? titles.to : titles.from;
  const b = reversed ? titles.from : titles.to;
  if (!w) return `${a} — ${relLabel(rel.type, s)} — ${b}`;
  if (w.custom) return `${a} ${reversed ? w.back : w.label} ${b}`;
  const key = `word.${w.id}.${reversed ? 'sayBack' : 'say'}` as MessageKey;
  return t(key, { a, b });
}

/**
 * チャットモデルが返す古い名前（supports / contradicts）を、いまのセットの言葉に直す。
 * セットに同じ土台の言葉が無ければ「考える」の言葉を使う。
 */
export function legacyWord(type: string, s = get()): RelationType {
  const ids = VOCABULARIES[vocabularyOf(s)];
  const find = (cores: Core[], fallback: string) => ids.find((id) => cores.includes(WORDS[id].core)) ?? fallback;
  if (type === 'supports') return find(['implies~', 'implies!'], 'so');
  if (type === 'contradicts') return find(['oppose~', 'rebut~', 'excl!'], 'but');
  return type;
}

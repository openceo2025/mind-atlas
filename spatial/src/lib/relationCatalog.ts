// 関係線の「言葉」の定義表。画面の言葉（翻訳）は i18n に、ここには意味と論理の性質だけを置く。
// 推論（inference.ts）と検査スクリプトが読めるよう、ストアや i18n には依存しない。
//
// 言葉は必ず「土台（core）」を 1 つ持つ。セットは言葉の選び方にすぎず、土台が同じ言葉は
// どのセットでも同じ計算に乗る。自分で作った言葉には土台がないので、計算には使わない。

export type VocabularyId = 'think' | 'cause' | 'logic';

/**
 * 土台の関係。末尾の ! は「必ず」（演繹）、~ は「たいてい」（論証）。
 * 向きのある土台は from → to の向きで読む。
 */
export type Core =
  | 'same~' // つまり：同じことの言い換え（対称）
  | 'implies~' // だから／根拠：from は to の理由
  | 'oppose~' // でも：ぶつかる（対称）
  | 'kind' // たとえば：to は from の具体例（from が一般、to が具体）
  | 'cause' // 結果：from が原因、to が結果
  | 'cause+' // 強める
  | 'cause-' // 弱める
  | 'implies!' // 十分条件：from ⇒ to
  | 'equiv!' // 同値：from ⇔ to（対称）
  | 'contra!' // 矛盾：from ⇔ ¬to（対称）
  | 'excl!' // 両立しない：¬(from ∧ to)（対称）
  | 'rebut~' // 反論：from は to を弱める
  | 'member' // 属する：from ∈ to
  | 'subset' // 含まれる：from ⊆ to
  | 'part'; // 構成要素：from は to の部品

export interface WordDef {
  id: string;
  core: Core;
  directed: boolean;
  color: string;
  dash: string;
  /** 判断モデルに渡す意味（英語）。{a} と {b} にカードが入る。向きのある言葉は a → b の向き */
  meaning: string;
}

const word = (id: string, core: Core, directed: boolean, color: string, dash: string, meaning: string): WordDef => ({ id, core, directed, color, dash, meaning });

export const WORDS: Record<string, WordDef> = {
  // ① 考える
  same: word('same', 'same~', false, '#4d8dff', '', '{a} and {b} say the same thing in other words ("{a}, in other words {b}")'),
  so: word('so', 'implies~', true, '#3ddc97', '', '{a} is a reason for {b} ("{a}, so {b}" / "{b}, because {a}")'),
  example: word('example', 'kind', true, '#a98bff', '', '{b} is a concrete example or a kind of {a} ("{a}, for example {b}")'),
  but: word('but', 'oppose~', false, '#ff6b7a', '', '{a} and {b} pull against each other or cannot both hold ("{a}, but {b}")'),
  // ② 原因を探る
  effect: word('effect', 'cause', true, '#ffb347', '', '{a} causes {b}; {b} is a result of {a}'),
  up: word('up', 'cause+', true, '#ff8a5c', '', '{a} strengthens or increases {b}'),
  down: word('down', 'cause-', true, '#5cc8ff', '', '{a} weakens, reduces or prevents {b} (a countermeasure or a brake)'),
  // ③ 論理・論証（演繹は実線、論証は破線）
  suff: word('suff', 'implies!', true, '#3ddc97', '', 'whenever {a} is true, {b} is necessarily true ({a} is a sufficient condition for {b}; {b} is a necessary condition for {a})'),
  equiv: word('equiv', 'equiv!', false, '#4d8dff', '', '{a} is true exactly when {b} is true (logically equivalent; necessary and sufficient)'),
  contra: word('contra', 'contra!', false, '#ff4d6d', '', '{a} is the negation of {b}: exactly one of them is true'),
  excl: word('excl', 'excl!', false, '#ff8fa3', '', '{a} and {b} cannot both be true, although both may be false'),
  ground: word('ground', 'implies~', true, '#3ddc97', '7 5', '{a} is evidence or an argument for the claim {b}, without proving it'),
  rebut: word('rebut', 'rebut~', true, '#ff6b7a', '7 5', '{a} is an objection or counter-argument against {b}, without refuting it outright'),
  member: word('member', 'member', true, '#a98bff', '', '{a} is a single member (an instance) of the class or set {b}'),
  subset: word('subset', 'subset', true, '#c7a6ff', '', 'every {a} is a {b}: {a} is a subclass or subset of {b}'),
  part: word('part', 'part', true, '#e0b86a', '4 3', '{a} is a component or part of {b} (not a kind of {b})'),
};

export const VOCABULARY_IDS: VocabularyId[] = ['think', 'cause', 'logic'];

export const VOCABULARIES: Record<VocabularyId, string[]> = {
  think: ['same', 'so', 'example', 'but'],
  cause: ['effect', 'up', 'down', 'but'],
  logic: ['suff', 'equiv', 'contra', 'excl', 'ground', 'rebut', 'member', 'subset', 'part'],
};

export const DEFAULT_VOCABULARY: VocabularyId = 'think';

/** 「論理・論証」の言葉は、演繹・論証・集合の 3 つに分けて見せる */
export const WORD_GROUPS: Partial<Record<VocabularyId, [string, string[]][]>> = {
  logic: [
    ['deduction', ['suff', 'equiv', 'contra', 'excl']],
    ['argument', ['ground', 'rebut']],
    ['sets', ['member', 'subset', 'part']],
  ],
};

/** 自分の言葉に選べる色 */
export const CUSTOM_COLORS = ['#9fb4d8', '#f78fb3', '#7bed9f', '#ffd166', '#70a1ff', '#eccc68'];

/** 演繹（必ず）の土台。対偶や伝播はこれだけで計算する */
export const STRICT_CORES: Core[] = ['implies!', 'equiv!', 'contra!', 'excl!', 'member', 'subset', 'part'];

/** 以前の種類 → 今の言葉 */
export const LEGACY_TYPES: Record<string, string> = { supports: 'so', contradicts: 'but' };

/** アプリが自分で引く線（言葉ではない）。related は「まだ言葉を選んでいない線」 */
export const SYSTEM_TYPES = ['related', 'source', 'derived', 'contains', 'axis-of', 'compared-with'] as const;

/** ユーザーが作った言葉の ID には必ずこの接頭辞が付く */
export const CUSTOM_PREFIX = 'u:';

export const isVocabulary = (v: unknown): v is VocabularyId => typeof v === 'string' && (VOCABULARY_IDS as string[]).includes(v);

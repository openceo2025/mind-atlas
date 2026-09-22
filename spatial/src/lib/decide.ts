// 判断モデル（System One / Jev）への細い窓口。
// 文章を書かせるのではなく「選ぶ・採点する・是か非か」を型で聞く。出力トークンは無料で、
// 入力もチャットモデルの 1/50 程度なので、分類・採点・道具選びはこちらへ逃がす。
import { aiDecide, type DecideAnswer, type DecideQuestion } from './service';
import { get } from '../store/core';

export type { DecideAnswer, DecideQuestion };

/** 質問の作り方（criteria の形が型ごとに違うので、間違えないように包む） */
export const noul = (instructions: string, criteria?: { true: string; false: string }): DecideQuestion => ({
  type: 'noul',
  instructions,
  ...(criteria ? { criteria } : {}),
});

export const choice = (instructions: string, options: Record<string, string | null>): DecideQuestion => ({
  type: 'choice',
  instructions,
  criteria: options,
});

/** levels は低い側から高い側へ並べた 2〜10 段階の説明 */
export const score = (instructions: string, levels: string[]): DecideQuestion => ({
  type: 'score',
  instructions,
  criteria: levels,
});

let downUntil = 0;

/** いまこの空間で判断モデルを使えるか */
export function decideEnabled() {
  const s = get();
  return Boolean(s.session.decide?.configured && s.session.aiEnabled && Date.now() >= downUntil);
}

export function decideLimits() {
  const d = get().session.decide;
  return { maxQuestions: d?.maxQuestions ?? 96, maxChars: d?.maxChars ?? 60_000 };
}

/**
 * まとめて聞く。質問が多いときは上限ごとに切って投げ、答えを1つに合わせて返す。
 * 落ちたときは空を返してしばらく休む（呼び出し側は必ず従来の道に戻れること）。
 */
export async function askDecisions(
  purpose: string,
  state: unknown,
  questions: Record<string, DecideQuestion>,
): Promise<Record<string, DecideAnswer>> {
  const names = Object.keys(questions);
  if (!decideEnabled() || !names.length) return {};
  const { maxQuestions } = decideLimits();
  const answers: Record<string, DecideAnswer> = {};
  try {
    for (let i = 0; i < names.length; i += maxQuestions) {
      const slice = names.slice(i, i + maxQuestions);
      const result = await aiDecide({
        purpose,
        state,
        questions: Object.fromEntries(slice.map((name) => [name, questions[name]])),
      });
      Object.assign(answers, result.answers ?? {});
    }
  } catch {
    // 鍵が無い・混んでいる・上限。従来の経路で続けられるよう、静かに諦める
    downUntil = Date.now() + 60_000;
    return answers;
  }
  return answers;
}

/** choice の答え。確信度が足りなければ何も選ばなかったことにする */
export function pickChoice(answer: DecideAnswer | undefined, minConfidence = 0.6) {
  if (!answer?.choice) return null;
  const confidence = answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0;
  if (confidence < minConfidence) return null;
  return { value: answer.choice, confidence };
}

/** score の答えを 0..1 に均す（水準数に依らない位置） */
export function pickScore(answer: DecideAnswer | undefined, levels: number, minConfidence = 0) {
  if (answer?.score === undefined || levels < 2) return null;
  if ((answer.confidence ?? 1) < minConfidence) return null;
  const value = Math.max(0, Math.min(1, answer.score / (levels - 1)));
  return { value, confidence: answer.confidence ?? 1 };
}

/** noul の答え（その通りである確率） */
export function pickNoul(answer: DecideAnswer | undefined) {
  return typeof answer?.noul === 'number' ? answer.noul : null;
}

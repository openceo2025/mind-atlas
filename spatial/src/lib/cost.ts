// AIに送る前の「どれくらい使うか」の見積り。設定で ON のときだけ画面に出す。
// 実際の課金はサーバーが予約→確定で行うので、ここは目安。
import { getAiModel } from './ai';
import { get, toast } from '../store/core';
import { t } from '../i18n';

const CHARS_PER_TOKEN = 3.2; // 日本語混じりでも大きく外さない目安
const DEFAULT_OUTPUT_TOKENS = 1024;

export interface CostInput {
  /** 送るテキスト（プロンプト＋文脈）の長さ */
  chars?: number;
  /** 想定する出力トークン数 */
  outputTokens?: number;
  /** 音声など、トークンで測れないものの最低見積り（USD） */
  minimumUsd?: number;
}

export function estimateRequestCost({ chars = 0, outputTokens = DEFAULT_OUTPUT_TOKENS, minimumUsd = 0 }: CostInput) {
  const s = get();
  const choice = getAiModel();
  const service = s.session.chatServices.find((x) => x.id === choice.provider);
  const model = service?.models.find((m) => m.model === (choice.model || service.defaultModel));
  const inputTokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const pricing = model?.pricing;
  const usd = pricing
    ? Math.max(minimumUsd, (inputTokens * pricing.inputUsdPer1M + outputTokens * pricing.outputUsdPer1M) / 1_000_000)
    : minimumUsd;
  const limitUsd = (s.session.creditLimitMicroUsd ?? 0) / 1_000_000;
  const percent = limitUsd > 0 ? (usd / limitUsd) * 100 : null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, usd, percent };
}

function formatPercent(percent: number) {
  if (percent >= 1) return percent.toFixed(1);
  if (percent >= 0.01) return percent.toFixed(2);
  return '<0.01';
}

/** 設定が ON なら、AIに投げる直前に見積りを表示する */
export function noticeRequestCost(input: CostInput) {
  const s = get();
  if (!s.costNotice || s.session.mode !== 'hosted') return;
  const { totalTokens, percent } = estimateRequestCost(input);
  toast(
    t('cost.estimate', {
      tokens: totalTokens.toLocaleString(),
      percent: percent === null ? '?' : formatPercent(percent),
    }),
    { ms: 2600 },
  );
}

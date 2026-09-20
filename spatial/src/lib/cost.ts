// AIに使うクレジットの見積りと実績。
// 見積り：サーバーが予約に使う数え方（文字数÷reserveCharsPerToken ＋ 出力上限）に合わせる。
// 実績：応答に入っている usage をそのまま出す。
import { getAiModel } from './ai';
import { get, set, toast } from '../store/core';
import type { AiUsage } from './service';
import { t } from '../i18n';

export interface CostInput {
  /** 送るテキスト（プロンプト＋文脈）の長さ */
  chars?: number;
  /** 想定する出力トークン数。省略時はサーバーの出力上限 */
  outputTokens?: number;
  /** 音声など、トークンで測れないものの最低見積り（USD） */
  minimumUsd?: number;
}

/** ユーザーが確認ダイアログで取り消したとき。エラーとしては表示しない */
export class RequestCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'RequestCancelled';
  }
}

export function estimateRequestCost({ chars = 0, outputTokens, minimumUsd = 0 }: CostInput) {
  const s = get();
  const limits = s.session.aiLimits;
  const choice = getAiModel();
  const service = s.session.chatServices.find((x) => x.id === choice.provider);
  const model = service?.models.find((m) => m.model === (choice.model || service.defaultModel));
  const inputTokens = Math.max(1, Math.ceil(chars / (limits?.reserveCharsPerToken ?? 2)));
  const output = outputTokens ?? limits?.maxOutputTokens ?? 1024;
  const pricing = model?.pricing;
  const usd = pricing
    ? Math.max(minimumUsd, (inputTokens * pricing.inputUsdPer1M + output * pricing.outputUsdPer1M) / 1_000_000)
    : minimumUsd;
  return { inputTokens, outputTokens: output, totalTokens: inputTokens + output, usd, percent: percentOfCredit(usd) };
}

function percentOfCredit(usd: number) {
  const limitUsd = (get().session.creditLimitMicroUsd ?? 0) / 1_000_000;
  return limitUsd > 0 ? (usd / limitUsd) * 100 : null;
}

function formatPercent(percent: number | null) {
  if (percent === null) return '?';
  if (percent >= 1) return percent.toFixed(1);
  if (percent >= 0.01) return percent.toFixed(2);
  return '<0.01';
}

/**
 * AIに送ってよいか尋ねる。「消費の見込みを表示する」がオフのときは何も出さずに通す。
 * 取り消されたら RequestCancelled を投げる。
 */
export async function confirmRequestCost(input: CostInput) {
  const s = get();
  if (!s.costNotice || s.session.mode !== 'hosted') return;
  const { totalTokens, percent } = estimateRequestCost(input);
  const ok = await ask(t('cost.confirmTitle'), t('cost.estimate', { tokens: totalTokens.toLocaleString(), percent: formatPercent(percent) }));
  if (!ok) throw new RequestCancelled();
}

function ask(title: string, body: string) {
  return new Promise<boolean>((resolve) => {
    set({
      confirmAsk: {
        title,
        body,
        resolve: (ok: boolean) => {
          set({ confirmAsk: null });
          resolve(ok);
        },
      },
    });
  });
}

/** 応答が返ったら、実際に使った量を出す（設定に関係なく常に表示） */
export function reportUsage(usage: AiUsage | undefined) {
  if (!usage || get().session.mode !== 'hosted') return;
  const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  const percent = typeof usage.estimatedCostUsd === 'number' ? percentOfCredit(usage.estimatedCostUsd) : null;
  if (!tokens && percent === null) return;
  toast(
    t('cost.used', {
      tokens: tokens.toLocaleString(),
      percent: formatPercent(percent),
      remaining: typeof usage.creditRemainingPercent === 'number' ? Math.round(usage.creditRemainingPercent) : '?',
    }),
    { ms: 2600 },
  );
}

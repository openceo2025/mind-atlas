import { priceForInputTokens } from "./model-pricing.mjs";

// State Council 2026 holiday calendar. Weekends remain off-peak even on make-up
// workdays, as DeepSeek explicitly defines peak as Monday-Friday in UTC.
// https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html
const CHINA_HOLIDAYS_2026 = [
  ["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"],
  ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"],
];

export function isDeepSeekOffPeak(at = new Date()) {
  const date = new Date(at);
  const weekday = date.getUTCDay();
  const hour = date.getUTCHours();
  if (weekday === 0 || weekday === 6 || !((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))) return true;
  const chinaDay = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Extend this calendar when the next official year's schedule is published.
  return chinaDay.startsWith("2026-") && CHINA_HOLIDAYS_2026.some(([start, end]) => chinaDay.slice(5) >= start && chinaDay.slice(5) <= end);
}

export function modelPriceAtTime(modelPrice, at = new Date()) {
  return modelPrice.offPeak && isDeepSeekOffPeak(at) ? modelPrice.offPeak : modelPrice;
}

// Reservations use the undiscounted ceiling. Settlement uses provider-reported
// usage and the rate at request start; a missing cache field never earns a discount.
export function settleModelTokenUsage(modelPrice, providerId, raw, fallbackInput, fallbackOutput, at = new Date()) {
  const tokens = (value, fallback = 0) => Number.isFinite(Number(value)) && value !== null && value !== undefined ? Math.max(0, Number(value)) : fallback;
  const anthropic = providerId === "anthropic";
  const cacheWrite = anthropic ? tokens(raw?.cache_creation_input_tokens) : 0;
  const cached = anthropic ? tokens(raw?.cache_read_input_tokens) : tokens(raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? raw?.input_tokens_details?.cached_tokens);
  const inputTokens = tokens(raw?.prompt_tokens ?? raw?.input_tokens, fallbackInput) + (anthropic ? cached + cacheWrite : 0);
  const outputTokens = tokens(raw?.completion_tokens ?? raw?.output_tokens, fallbackOutput);
  const read = Math.min(cached, inputTokens);
  const write = Math.min(cacheWrite, inputTokens - read);
  const write1h = Math.min(write, tokens(raw?.cache_creation?.ephemeral_1h_input_tokens));
  const tier = priceForInputTokens(modelPriceAtTime(modelPrice, at), inputTokens);
  const amount = (inputTokens - read - write) * tier.inputUsdPer1M
    + read * (tier.cachedInputUsdPer1M ?? tier.inputUsdPer1M)
    + (write - write1h) * (tier.cacheWriteUsdPer1M ?? tier.inputUsdPer1M)
    + write1h * (tier.cacheWrite1hUsdPer1M ?? tier.inputUsdPer1M)
    + outputTokens * tier.outputUsdPer1M;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostMicroUsd: Math.max(1, Math.ceil(Number(amount.toFixed(8)))) };
}

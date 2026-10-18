// Built-in per-1M-token prices (USD, Standard tier, short context) used to meter AI credits.
// Exact prices live here or in MIND_ATLAS_MODEL_PRICES_JSON (authoritative
// overrides). Newly discovered models use an explicitly flagged estimate.
//
// Sources, checked 2026-10-18 (audit: docs/hosted-model-audit-2026-10-18.md):
//   OpenAI    https://developers.openai.com/api/docs/pricing
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//              Claude Haiku 5.5 short-context rates are used below (<=100K input tokens);
//              its input/output rates increase to $0.50/$2.50 per MTok above 100K.
//   DeepSeek  https://api-docs.deepseek.com/quick_start/pricing (peak-hour rates, the higher of the two)

export function mergeModelPrices(overrides = {}, now = new Date()) {
  return {
    ...createBuiltinModelPrices(now),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

export function createBuiltinModelPrices(_now = new Date()) {
  const prices = {
    "openai:gpt-6-astra": openAiPrice(10, 50, 1, true),
    "openai:gpt-6.1-sol": openAiPrice(2, 10, 0.1, true),
    "openai:gpt-6-sol": openAiPrice(2, 10, 0.2, true),
    "openai:gpt-6-luna": openAiPrice(0.1, 0.5, 0.01, true),
    "openai:gpt-5.6-sol": openAiPrice(4, 20, 0.4, true),
    "openai:gpt-5.6-terra": openAiPrice(2, 12, 0.2, true),
    "openai:gpt-5.6-luna": openAiPrice(0.2, 1.2, 0.02, true),
    "openai:gpt-5.5": openAiPrice(5, 30, 0.5, true),
    "openai:gpt-5.5-pro": { ...price(30, 180), longContext: { aboveInputTokens: 272_000, ...price(60, 270) } },
    "openai:gpt-5.4": openAiPrice(2.5, 15, 0.25, true),
    "openai:gpt-5.4-mini": openAiPrice(0.75, 4.5, 0.075),
    "openai:gpt-5.4-nano": openAiPrice(0.2, 1.25, 0.02),
    "openai:gpt-5.4-pro": { ...price(30, 180), longContext: { aboveInputTokens: 272_000, ...price(60, 270) } },
    "openai:gpt-5.3-codex": openAiPrice(1.75, 14, 0.175),
    "openai:gpt-5.2": openAiPrice(1.75, 14, 0.175),
    "openai:gpt-5.2-pro": price(21, 168),
    "openai:gpt-5.1": openAiPrice(1.25, 10, 0.125),
    "openai:gpt-5": openAiPrice(1.25, 10, 0.125),
    "openai:gpt-5-mini": openAiPrice(0.25, 2, 0.025),
    "openai:gpt-5-nano": openAiPrice(0.05, 0.4, 0.005),
    "openai:gpt-5-pro": price(15, 120),
    "openai:o3": openAiPrice(2, 8, 0.5),
    "openai:o3-pro": price(20, 80),
    "openai:o3-mini": openAiPrice(1.1, 4.4, 0.55),
    "openai:o4-mini": openAiPrice(1.1, 4.4, 0.275),
    "openai:o1": openAiPrice(15, 60, 7.5),
    "openai:o1-pro": price(150, 600),
    "openai:gpt-4.1": openAiPrice(2, 8, 0.5),
    "openai:gpt-4.1-mini": openAiPrice(0.4, 1.6, 0.1),
    "openai:gpt-4.1-nano": openAiPrice(0.1, 0.4, 0.025),
    "openai:gpt-4o": openAiPrice(2.5, 10, 1.25),
    "openai:gpt-4o-mini": openAiPrice(0.15, 0.6, 0.075),
    "openai:gpt-4-turbo": price(10, 30),
    "openai:gpt-4": price(30, 60),
    "openai:gpt-3.5-turbo": price(0.5, 1.5),

    "anthropic:claude-fable-5-1": price(10, 50),
    "anthropic:claude-fable-5": price(10, 50),
    "anthropic:claude-mythos-5-1": price(10, 50),
    "anthropic:claude-mythos-5": price(10, 50),
    "anthropic:claude-opus-5-5": price(4, 20),
    "anthropic:claude-opus-5": price(5, 25),
    "anthropic:claude-opus-4-8": price(5, 25),
    "anthropic:claude-opus-4-7": price(5, 25),
    "anthropic:claude-opus-4-6": price(5, 25),
    "anthropic:claude-opus-4-5": price(5, 25),
    "anthropic:claude-opus-4-1": price(15, 75),
    "anthropic:claude-sonnet-5": price(2, 10),
    "anthropic:claude-sonnet-5-5": price(2, 10),
    "anthropic:claude-sonnet-4-6": price(3, 15),
    "anthropic:claude-sonnet-4-5": price(3, 15),
    // Official short-context tier (<=100K input tokens); long-context tier is $0.50/$2.50.
    "anthropic:claude-haiku-5-5": {
      ...price(0.1, 0.5),
      longContext: { aboveInputTokens: 100_000, ...price(0.5, 2.5) },
    },
    "anthropic:claude-haiku-4-5": price(1, 5),
    "anthropic:claude-haiku-3-5": price(0.8, 4),

    "deepseek:deepseek-flash": deepSeekPrice(0.3, 1.2, 0.006),
    // Legacy DeepSeek IDs route to V4.1-Flash and are billed at the Flash rate.
    "deepseek:deepseek-v4-flash": deepSeekPrice(0.3, 1.2, 0.006),
    "deepseek:deepseek-v4-flash-vision-exp": deepSeekPrice(0.3, 1.2, 0.006),
    // Pro remains available: the initial September retirement announcement was reversed.
    "deepseek:deepseek-v4-pro": deepSeekPrice(1.32, 3.96, 0.044),

    // Decision model (System One): input only, output is free.
    // https://docs.typesafe.ai/api, checked 2026-09-23
    "typesafe:jev-latest": price(0.042, 0),
    "typesafe:jev-1": price(0.042, 0),
  };
  for (const [key, entry] of Object.entries(prices)) {
    if (!key.startsWith("anthropic:")) continue;
    const readMultiplier = /(?:fable|mythos)-5-1$/.test(key) ? 0.025 : /(?:opus|sonnet)-5-5$/.test(key) ? 0.05 : 0.1;
    for (const tier of [entry, entry.longContext].filter(Boolean)) {
      const rate = (multiplier) => Number((tier.inputUsdPer1M * multiplier).toFixed(12));
      tier.cachedInputUsdPer1M = rate(readMultiplier);
      tier.cacheWriteUsdPer1M = rate(1.25);
      tier.cacheWrite1hUsdPer1M = rate(2);
    }
  }
  return prices;
}

export function hasModelPrice(modelPrices, providerId, model) {
  return Boolean(resolveExactModelPrice(modelPrices, providerId, model));
}

// A long-context tier applies to the whole request, including output, rather
// than only the input tokens above the threshold. Explicit price overrides
// without a longContext field keep their configured flat rate.
export function priceForInputTokens(modelPrice, inputTokens) {
  const tier = modelPrice.longContext;
  return tier && inputTokens > tier.aboveInputTokens ? tier : modelPrice;
}

export function estimateTokenCostMicroUsd(modelPrice, inputTokens, outputTokens) {
  const tier = priceForInputTokens(modelPrice, inputTokens);
  return Math.max(1, Math.ceil(inputTokens * Number(tier.inputUsdPer1M) + outputTokens * Number(tier.outputUsdPer1M)));
}

// Model ids follow a size ladder; a new model usually joins one of these rungs.
const MODEL_TIERS = [
  { id: "nano", test: (model) => /(^|[-_.])nano([-_.]|$)|luna/.test(model) },
  { id: "mini", test: (model) => /(^|[-_.])(mini|flash|haiku|small|lite|air)([-_.]|$)|terra/.test(model) },
  { id: "large", test: (model) => /(^|[-_.])(pro|max|ultra|opus|fable|mythos)([-_.]|$)/.test(model) },
];

/** Rough release generation, used for ordering and for estimating a new model's price. */
export function modelGeneration(providerId, model) {
  const value = String(model ?? "").toLowerCase();
  if (providerId === "openai") {
    const reasoning = value.match(/^o(\d)/);
    if (reasoning) return 4.5 + Number(reasoning[1]) / 10;
    if (value.startsWith("gpt-4o") || value.startsWith("chatgpt-4o")) return 4.05;
    if (value.startsWith("gpt-4-turbo")) return 4.02;
    const gpt = value.match(/^(?:gpt|chatgpt)-(\d+(?:\.\d+)?)/);
    return gpt ? Number(gpt[1]) : 0;
  }
  if (providerId === "anthropic") {
    const claude = value.match(/^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
    return claude ? Number(claude[1]) + Number(claude[2] ?? 0) / 10 : 0;
  }
  const version = value.match(/v(\d+(?:\.\d+)?)/);
  return version ? Number(version[1]) : 0;
}

export function modelTier(model) {
  const value = String(model ?? "").toLowerCase();
  return MODEL_TIERS.find((tier) => tier.test(value))?.id ?? "standard";
}

/**
 * A price for a model nobody has published rates for yet, so it can be offered the day
 * it ships. Takes the dearest known rate on the same rung of the same provider (the whole
 * provider when that rung is empty), which bills at or above the real cost in practice.
 * Returns null when the provider has no known price at all.
 */
export function estimateModelPrice(modelPrices, providerId, model) {
  const tier = modelTier(model);
  const prefix = `${providerId}:`;
  const known = Object.entries(modelPrices)
    .filter(([key, value]) => key.startsWith(prefix) && !key.endsWith(":*") && value && Number.isFinite(Number(value.inputUsdPer1M)))
    .map(([key, value]) => {
      const id = key.slice(prefix.length);
      return { tier: modelTier(id), generation: modelGeneration(providerId, id), value };
    });
  if (!known.length) return null;
  // Older generations (GPT-4 at $30/$60) would wildly overprice a new model, so only the
  // current and previous generation count.
  const newest = Math.max(...known.map((entry) => entry.generation));
  const recent = known.filter((entry) => entry.generation >= newest - 1);
  const sameProvider = recent.length ? recent : known;
  const sameTier = sameProvider.filter((entry) => entry.tier === tier);
  const pool = sameTier.length ? sameTier : sameProvider;
  return {
    inputUsdPer1M: Math.max(...pool.map((entry) => Number(entry.value.inputUsdPer1M))),
    outputUsdPer1M: Math.max(...pool.map((entry) => Number(entry.value.outputUsdPer1M))),
    estimated: true,
    tier,
  };
}

export function resolveExactModelPrice(modelPrices, providerId, model) {
  for (const key of modelPriceKeys(providerId, model)) {
    const modelPrice = modelPrices[key];
    if (modelPrice) return modelPrice;
  }
  return null;
}

export function modelPriceKeys(providerId, model) {
  const exactKey = `${providerId}:${model}`;
  const normalizedModel = normalizeModelPriceId(providerId, model);
  return normalizedModel && normalizedModel !== model
    ? [exactKey, `${providerId}:${normalizedModel}`]
    : [exactKey];
}

export function normalizeModelPriceId(providerId, model) {
  const value = String(model ?? "");
  if (providerId === "openai") {
    // Dated snapshots (gpt-5.4-2026-03-05, o3-2025-04-16) and context variants
    // (gpt-3.5-turbo-16k) cost the same as their alias.
    return value.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d+k$/, "");
  }
  if (providerId === "anthropic") {
    return normalizeAnthropicModelPriceId(value);
  }
  if (providerId === "deepseek") {
    // Retired names that DeepSeek still accepts and routes to the current Flash model.
    if (value === "deepseek-chat" || value === "deepseek-reasoner" || value === "deepseek-v4-flash") return "deepseek-flash";
  }
  return value;
}

// 長い（具体的な）名前から先に照合する。claude-opus-5-5 を claude-opus-5 と取り違えると、
// 一つ前の世代の値段で課金してしまう。
const ANTHROPIC_PRICE_PREFIXES = [
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-mythos-5-1",
    "claude-mythos-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-opus-4-1",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-5-5",
    "claude-haiku-4-5",
    "claude-haiku-3-5",
].sort((a, b) => b.length - a.length);

function normalizeAnthropicModelPriceId(model) {
  return ANTHROPIC_PRICE_PREFIXES.find((prefix) => model === prefix || (model.startsWith(prefix) && /^-\d{8}$/.test(model.slice(prefix.length)))) ?? model;
}

function openAiPrice(input, output, cachedInput, longContext = false) {
  return {
    ...price(input, output), cachedInputUsdPer1M: cachedInput,
    ...(longContext ? { longContext: { aboveInputTokens: 272_000, ...price(input * 2, output * 1.5), cachedInputUsdPer1M: cachedInput * 2 } } : {}),
  };
}

function deepSeekPrice(input, output, cachedInput) {
  return {
    ...price(input, output), cachedInputUsdPer1M: cachedInput,
    offPeak: { ...price(input / 2, output / 2), cachedInputUsdPer1M: cachedInput / 2 },
  };
}

function price(inputUsdPer1M, outputUsdPer1M) {
  return { inputUsdPer1M, outputUsdPer1M };
}

// Built-in per-1M-token prices (USD, Standard tier, short context) used to meter AI credits.
// A model the provider lists is offered only when it has a price here or in
// MIND_ATLAS_MODEL_PRICES_JSON (which overrides these entries).
//
// Sources, checked 2026-09-19:
//   OpenAI    https://developers.openai.com/api/docs/pricing
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//   DeepSeek  https://api-docs.deepseek.com/quick_start/pricing (peak-hour rates, the higher of the two)

export function mergeModelPrices(overrides = {}, now = new Date()) {
  return {
    ...createBuiltinModelPrices(now),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

export function createBuiltinModelPrices(_now = new Date()) {
  return {
    "openai:gpt-6-astra": price(10, 50),
    "openai:gpt-5.6-sol": price(4, 20),
    "openai:gpt-5.6-terra": price(2, 12),
    "openai:gpt-5.6-luna": price(0.2, 1.2),
    "openai:gpt-5.5": price(5, 30),
    "openai:gpt-5.5-pro": price(30, 180),
    "openai:gpt-5.4": price(2.5, 15),
    "openai:gpt-5.4-mini": price(0.75, 4.5),
    "openai:gpt-5.4-nano": price(0.2, 1.25),
    "openai:gpt-5.4-pro": price(30, 180),
    "openai:gpt-5.3-codex": price(1.75, 14),
    "openai:gpt-5.2": price(1.75, 14),
    "openai:gpt-5.2-pro": price(21, 168),
    "openai:gpt-5.1": price(1.25, 10),
    "openai:gpt-5": price(1.25, 10),
    "openai:gpt-5-mini": price(0.25, 2),
    "openai:gpt-5-nano": price(0.05, 0.4),
    "openai:gpt-5-pro": price(15, 120),
    "openai:o3": price(2, 8),
    "openai:o3-pro": price(20, 80),
    "openai:o3-mini": price(1.1, 4.4),
    "openai:o4-mini": price(1.1, 4.4),
    "openai:o1": price(15, 60),
    "openai:o1-pro": price(150, 600),
    "openai:gpt-4.1": price(2, 8),
    "openai:gpt-4.1-mini": price(0.4, 1.6),
    "openai:gpt-4.1-nano": price(0.1, 0.4),
    "openai:gpt-4o": price(2.5, 10),
    "openai:gpt-4o-mini": price(0.15, 0.6),
    "openai:gpt-4-turbo": price(10, 30),
    "openai:gpt-4": price(30, 60),
    "openai:gpt-3.5-turbo": price(0.5, 1.5),

    "anthropic:claude-fable-5": price(10, 50),
    "anthropic:claude-mythos-5": price(10, 50),
    "anthropic:claude-opus-5": price(5, 25),
    "anthropic:claude-opus-4-8": price(5, 25),
    "anthropic:claude-opus-4-7": price(5, 25),
    "anthropic:claude-opus-4-6": price(5, 25),
    "anthropic:claude-opus-4-5": price(5, 25),
    "anthropic:claude-opus-4-1": price(15, 75),
    "anthropic:claude-sonnet-5": price(2, 10),
    "anthropic:claude-sonnet-4-6": price(3, 15),
    "anthropic:claude-sonnet-4-5": price(3, 15),
    "anthropic:claude-haiku-4-5": price(1, 5),
    "anthropic:claude-haiku-3-5": price(0.8, 4),

    "deepseek:deepseek-flash": price(0.3, 1.2),
    "deepseek:deepseek-v4-pro": price(1.32, 3.96),
  };
}

export function hasModelPrice(modelPrices, providerId, model) {
  return Boolean(resolveExactModelPrice(modelPrices, providerId, model));
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

function normalizeAnthropicModelPriceId(model) {
  const patterns = [
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-opus-4-1",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-haiku-3-5",
  ];
  return patterns.find((prefix) => model.startsWith(prefix)) ?? model;
}

function price(inputUsdPer1M, outputUsdPer1M) {
  return { inputUsdPer1M, outputUsdPer1M };
}

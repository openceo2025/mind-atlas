const SONNET_5_INTRO_PRICING_END = Date.parse("2026-09-01T00:00:00Z");

export function mergeModelPrices(overrides = {}, now = new Date()) {
  return {
    ...createBuiltinModelPrices(now),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

export function createBuiltinModelPrices(now = new Date()) {
  const sonnet5Intro = now.getTime() < SONNET_5_INTRO_PRICING_END;
  return {
    "openai:gpt-5.5": price(5, 22.5),
    "openai:gpt-5.5-pro": price(15, 90),
    "openai:gpt-5.4": price(2.5, 11.25),
    "openai:gpt-5.4-mini": price(0.375, 2.25),
    "openai:gpt-5.4-nano": price(0.1, 0.625),
    "openai:gpt-5.4-pro": price(30, 135),
    "openai:gpt-4.1": price(2, 8),
    "openai:gpt-4.1-mini": price(0.4, 1.6),
    "openai:gpt-4.1-nano": price(0.1, 0.4),
    "openai:gpt-4o": price(2.5, 10),
    "openai:gpt-4o-mini": price(0.15, 0.6),

    "anthropic:claude-fable-5": price(10, 50),
    "anthropic:claude-mythos-5": price(10, 50),
    "anthropic:claude-opus-4-8": price(5, 25),
    "anthropic:claude-opus-4-7": price(5, 25),
    "anthropic:claude-opus-4-6": price(5, 25),
    "anthropic:claude-opus-4-5": price(5, 25),
    "anthropic:claude-opus-4-1": price(15, 75),
    "anthropic:claude-sonnet-5": price(sonnet5Intro ? 2 : 3, sonnet5Intro ? 10 : 15),
    "anthropic:claude-sonnet-4-6": price(3, 15),
    "anthropic:claude-sonnet-4-5": price(3, 15),
    "anthropic:claude-haiku-4-5": price(1, 5),
    "anthropic:claude-haiku-3-5": price(0.8, 4),

    "deepseek:deepseek-v4-flash": price(0.14, 0.28),
    "deepseek:deepseek-v4-pro": price(0.435, 0.87),
    "deepseek:deepseek-chat": price(0.14, 0.28),
    "deepseek:deepseek-reasoner": price(0.14, 0.28),
  };
}

export function hasModelPrice(modelPrices, providerId, model) {
  return Boolean(resolveExactModelPrice(modelPrices, providerId, model));
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
    return value.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  }
  if (providerId === "anthropic") {
    return normalizeAnthropicModelPriceId(value);
  }
  if (providerId === "deepseek") {
    if (value === "deepseek-chat" || value === "deepseek-reasoner") return "deepseek-v4-flash";
  }
  return value;
}

function normalizeAnthropicModelPriceId(model) {
  const patterns = [
    "claude-fable-5",
    "claude-mythos-5",
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

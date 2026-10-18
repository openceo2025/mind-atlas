// Official shutdown dates, audited 2026-10-18. Future dates are not early removals.
// Provider model API shutdown_date values supplement this fallback for aliases.
// https://developers.openai.com/api/docs/deprecations
// https://platform.claude.com/docs/en/about-claude/model-deprecations
const SHUTDOWNS = [
  ["openai", "2024-09-13", ["gpt-3.5-turbo-16k", "gpt-3.5-turbo-16k-0613", "gpt-3.5-turbo-0613", "gpt-3.5-turbo-0301"]],
  ["openai", "2026-07-23", ["gpt-5-chat-latest", "gpt-5-codex", "gpt-5.1-chat-latest", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini", "gpt-5.2-codex"]],
  ["openai", "2026-08-10", ["gpt-5.2-chat-latest", "gpt-5.3-chat-latest"]],
  ["openai", "2026-09-28", ["gpt-3.5-turbo-1106", "gpt-3.5-turbo-instruct"]],
  ["openai", "2026-10-01", ["gpt-5.4-cyber"]],
  ["openai", "2026-10-23", ["gpt-3.5-turbo", "gpt-3.5-turbo-0125", "gpt-4", "gpt-4-0613", "gpt-4-1106-preview", "gpt-4-turbo", "gpt-4-turbo-2024-04-09", "gpt-4.1-nano", "gpt-4.1-nano-2025-04-14", "gpt-4o-2024-05-13", "o1", "o1-2024-12-17", "o1-pro", "o1-pro-2025-03-19", "o3-mini", "o3-mini-2025-01-31", "o4-mini", "o4-mini-2025-04-16"]],
  ["openai", "2026-12-11", ["gpt-5", "gpt-5-2025-08-07", "gpt-5-mini", "gpt-5-mini-2025-08-07", "gpt-5-nano", "gpt-5-nano-2025-08-07", "gpt-5-pro", "gpt-5-pro-2025-10-06", "o3", "o3-2025-04-16", "o3-pro", "o3-pro-2025-06-10"]],
  ["openai", "2027-01-14", ["gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20", "gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4.1", "gpt-4.1-2025-04-14", "gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"]],
  ["openai", "2027-04-01", ["gpt-5.3-codex", "gpt-5.4-nano", "gpt-5.1"]],
  ["anthropic", "2026-02-19", ["claude-haiku-3-5", "claude-3-5-haiku-20241022", "claude-3-7-sonnet-20250219"]],
  ["anthropic", "2026-06-15", ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]],
  ["anthropic", "2026-08-05", ["claude-opus-4-1", "claude-opus-4-1-20250805"]],
  ["anthropic", "2026-11-30", ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"]],
  ["deepseek", "2026-07-24", ["deepseek-chat", "deepseek-reasoner"]],
  ["deepseek", "2026-09-10", ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]],
];

export function hostedModelLifecycle(providerId, model, at = new Date(), reportedShutdown = null) {
  const known = SHUTDOWNS.find(([provider, , models]) => provider === providerId && models.includes(model))?.[1];
  const dates = [known, reportedShutdown].filter((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (!dates.length) return { status: "active" };
  const shutdownDate = dates[0];
  return { status: new Date(at).toISOString().slice(0, 10) >= shutdownDate ? "retired" : "deprecated", shutdownDate };
}

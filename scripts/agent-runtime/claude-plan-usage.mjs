/**
 * The Claude plan's usage windows, as Claude Code's own /usage screen reads
 * them (OpenCEO ADR 0087, chosen by the owner).
 *
 * Claude Code tells a headless run how much of a window is used only once it
 * warns; its interactive /usage screen asks Anthropic directly. This does the
 * same, on this machine only:
 *
 * - The signed-in Claude Code's OAuth access token is read from its own
 *   credentials file. It is never written, logged, returned or refreshed
 *   here: refreshing would rotate Claude Code's own credentials. An expired
 *   token simply means "not known" until Claude Code signs in or refreshes.
 * - The endpoint is undocumented. Any answer that does not look as expected
 *   is "not known", never a guess.
 * - At most one request a minute.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** Where the signed-in Claude Code keeps its credentials. */
export function claudeCredentialsPath(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  return join(dir, ".credentials.json");
}

/**
 * The windows in an answer, as remaining percentages: `five_hour` and
 * `seven_day`, each `{ utilization, resets_at }` with utilization in
 * percent used. Anything else is left out.
 */
export function parseClaudePlanUsage(body) {
  const windows = [];
  for (const [key, id, label] of [
    ["five_hour", "claude-plan-five-hour", "5H"],
    ["seven_day", "claude-plan-seven-day", "7D"],
  ]) {
    const window = body && typeof body === "object" ? body[key] : null;
    const used = Number(window?.utilization);
    if (!window || !Number.isFinite(used) || used < 0 || used > 100) continue;
    const reset = Date.parse(String(window.resets_at ?? ""));
    const remaining = Math.max(0, Math.min(100, 100 - used));
    windows.push({
      id,
      vendor: "claude",
      vendorLabel: "CLAUDE",
      kind: "rate_limit",
      label,
      available: true,
      displayValue: `${Math.round(remaining)}%`,
      value: remaining,
      unit: "%",
      barPercent: remaining,
      resetAt: Number.isNaN(reset) ? "" : new Date(reset).toISOString(),
      detail: "Claude plan usage, as Claude Code's /usage reads it.",
      source: "claude-oauth-usage",
      defaultVisible: true,
    });
  }
  return windows;
}

/** Reads the usage windows now and then; [] when they cannot be known. */
export function createClaudePlanUsage({ fetchImpl = globalThis.fetch, readText = readFile, now = Date.now, env = process.env } = {}) {
  let cached = { at: 0, value: [] };
  let inFlight = null;

  async function read() {
    let token = "";
    try {
      const raw = JSON.parse(await readText(claudeCredentialsPath(env), "utf8"));
      const oauth = raw?.claudeAiOauth ?? {};
      if (typeof oauth.accessToken === "string") token = oauth.accessToken;
      // Expired: Claude Code refreshes it when it next runs; not done here.
      if (Number(oauth.expiresAt) && Number(oauth.expiresAt) <= now()) token = "";
    } catch {
      token = "";
    }
    if (!token) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(CLAUDE_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return parseClaudePlanUsage(await response.json());
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get() {
      if (now() - cached.at < CACHE_MS) return cached.value;
      if (!inFlight) {
        inFlight = read()
          .then((value) => {
            cached = { at: now(), value };
            return value;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return await inFlight;
    },
  };
}

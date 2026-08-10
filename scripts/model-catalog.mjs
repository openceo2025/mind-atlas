// Live model discovery for the local bridge.
//
// Mode: local-only.
//
// The bridge used to serve hardcoded model lists from environment variables, so
// a model released after the list was written could never be selected. This
// module asks each configured provider for its real catalogue at startup, keeps
// it cached, and refreshes it periodically. When a provider has no credentials
// or the request fails, the configured list is used and the result says so, so
// the UI never presents a stale list as if it were live.

const DEFAULT_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12_000;

/** Reasoning-capable families. Anything else only gets `default`. */
const REASONING_PATTERNS = [
  /^gpt-5/i,
  /^o[1345](?:-|$)/i,
  /^claude-(opus|sonnet|haiku|fable|mythos)/i,
  /^deepseek-(v[4-9]|r[1-9]|reasoner)/i,
];

export function supportsReasoningEffort(model) {
  const id = String(model ?? "").trim();
  if (!id) return false;
  return REASONING_PATTERNS.some((pattern) => pattern.test(id));
}

/**
 * Effort levels this model can actually take. A non-reasoning model must not
 * offer a picker full of levels it will reject.
 */
export function effortsForModel(model, serviceEfforts) {
  const efforts = Array.isArray(serviceEfforts) ? serviceEfforts.filter(Boolean) : [];
  if (!efforts.length) return ["default"];
  if (!supportsReasoningEffort(model)) return ["default"];
  return efforts.includes("default") ? efforts : ["default", ...efforts];
}

export function defaultEffortForModel(model, serviceEfforts, preferred) {
  const available = effortsForModel(model, serviceEfforts);
  if (preferred && available.includes(preferred)) return preferred;
  for (const candidate of ["medium", "high", "default"]) {
    if (available.includes(candidate)) return candidate;
  }
  return available[0] ?? "default";
}

const FAMILY_LABELS = new Map([
  ["gpt", "GPT"],
  ["claude", "Claude"],
  ["deepseek", "DeepSeek"],
]);

const WORD_LABELS = new Map([
  ["mini", "Mini"],
  ["nano", "Nano"],
  ["pro", "Pro"],
  ["flash", "Flash"],
  ["turbo", "Turbo"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
  ["mythos", "Mythos"],
  ["codex", "Codex"],
  ["spark", "Spark"],
  ["sol", "Sol"],
  ["terra", "Terra"],
  ["luna", "Luna"],
  ["chat", "Chat"],
  ["reasoner", "Reasoner"],
  ["latest", "Latest"],
  ["preview", "Preview"],
]);

/**
 * Human label that always keeps the version number.
 *
 * `claude-opus-4-8` -> `Claude Opus 4.8`
 * `claude-fable-5`  -> `Claude Fable 5`
 * `deepseek-v4-pro[1m]` -> `DeepSeek V4 Pro [1m]`
 * `gpt-5.5-pro` -> `GPT-5.5 Pro`
 *
 * Bare Claude Code aliases (`opus`, `sonnet`) carry no version, so the caller
 * passes the concrete model the alias resolves to and it is shown alongside.
 */
export function modelDisplayName(model, resolvedModel = "") {
  const id = String(model ?? "").trim();
  if (!id) return "";
  const resolved = String(resolvedModel ?? "").trim();
  // A bare Claude Code alias carries no version, which is exactly the number
  // the picker has to show. Label what the alias actually resolves to.
  if (resolved && resolved !== id && !/\d/.test(id)) return modelDisplayName(resolved);

  const suffixMatch = /\[([^\]]+)\]\s*$/.exec(id);
  const suffix = suffixMatch ? ` [${suffixMatch[1]}]` : "";
  const core = suffix ? id.slice(0, suffixMatch.index) : id;

  // A dated snapshot id keeps its date so two snapshots stay distinguishable,
  // but the date must never be folded into the version number.
  const dateMatch = /[-_](\d{4})[-_]?(\d{2})[-_]?(\d{2})$/.exec(core);
  const dated = dateMatch ? ` (${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]})` : "";
  const withoutDate = dateMatch ? core.slice(0, dateMatch.index) : core;

  // `o3`, `o4-mini`: a lowercase reasoning family, not a word to capitalize.
  if (/^o\d/i.test(withoutDate)) {
    const oBase = withoutDate.toLowerCase().split(/[-_]/).map((part, index) => (
      index === 0 ? part : WORD_LABELS.get(part) ?? part.charAt(0).toUpperCase() + part.slice(1)
    )).join(" ");
    return `${oBase}${dated}${suffix}`;
  }

  const parts = withoutDate.split(/[-_]/).filter(Boolean);
  const labelled = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lower = part.toLowerCase();
    if (index === 0 && FAMILY_LABELS.has(lower)) {
      labelled.push(FAMILY_LABELS.get(lower));
      continue;
    }
    if (WORD_LABELS.has(lower)) {
      labelled.push(WORD_LABELS.get(lower));
      continue;
    }
    // Version fragments: join a bare number to the previous number with a dot
    // so `opus-4-8` reads as `Opus 4.8` rather than `Opus 4 8`.
    if (/^\d+$/.test(part) && labelled.length && /\d$/.test(labelled[labelled.length - 1])) {
      labelled[labelled.length - 1] = `${labelled[labelled.length - 1]}.${part}`;
      continue;
    }
    if (/^v\d/i.test(part)) {
      labelled.push(part.toUpperCase());
      continue;
    }
    if (/^\d/.test(part)) {
      labelled.push(part);
      continue;
    }
    labelled.push(part.charAt(0).toUpperCase() + part.slice(1));
  }

  let base = `${labelled.join(" ")}${dated}${suffix}`.trim() || id;
  // OpenAI writes the family and version joined: `GPT-5.5`, not `GPT 5.5`.
  base = base.replace(/^GPT (?=[0-9])/, "GPT-");
  return resolved && resolved !== id ? `${base} (${resolved})` : base;
}

/** Strip a trailing snapshot date so it cannot be read as a version number. */
export function stripSnapshotDate(model) {
  return String(model ?? "").replace(/[-_]\d{4}[-_]?\d{2}[-_]?\d{2}$/, "");
}

/**
 * Ranks newer versions first so the freshest model is the obvious choice.
 * The snapshot date is compared only to break ties between the same version.
 */
export function compareModelRecency(left, right) {
  const version = (value) => {
    const numbers = stripSnapshotDate(value).match(/\d+(?:\.\d+)?/g) ?? [];
    return numbers.slice(0, 3).reduce((total, part, index) => total + Number(part) / 10 ** (index * 3), 0);
  };
  const snapshot = (value) => {
    const match = /[-_](\d{4})[-_]?(\d{2})[-_]?(\d{2})$/.exec(String(value ?? ""));
    return match ? Number(`${match[1]}${match[2]}${match[3]}`) : 0;
  };
  const versionDelta = version(right) - version(left);
  if (versionDelta !== 0) return versionDelta;
  const snapshotDelta = snapshot(right) - snapshot(left);
  if (snapshotDelta !== 0) return snapshotDelta;
  return String(left).localeCompare(String(right));
}

/**
 * Return only models the native Claude clients have recently used or explicitly
 * marked as accessible. `additionalModelOptionsCache` is deliberately ignored:
 * it can advertise a rollout model even when Claude Code silently falls back
 * to another model for this account.
 */
export function extractClaudeSubscriptionModels(nativeState, now = Date.now(), maxAgeMs = 120 * 24 * 60 * 60 * 1000) {
  const candidates = [];
  const addCandidate = (value, observedAt = now) => {
    const model = String(value ?? "").trim();
    if (!/^claude-(opus|sonnet|haiku|fable|mythos)-\d/i.test(model)) return;
    const at = Number(observedAt);
    if (Number.isFinite(at) && at > 0 && now - at > maxAgeMs) return;
    candidates.push({ model, at: Number.isFinite(at) ? at : now });
  };

  const slots = nativeState?.clientDataCacheSlots;
  if (slots && typeof slots === "object" && !Array.isArray(slots)) {
    for (const slot of Object.values(slots)) {
      if (!slot || typeof slot !== "object") continue;
      addCandidate(slot.model, slot.at);
    }
  }

  if (Array.isArray(nativeState?.modelAccessCache)) {
    for (const entry of nativeState.modelAccessCache) {
      if (typeof entry === "string") {
        addCandidate(entry);
        continue;
      }
      if (!entry || typeof entry !== "object" || entry.allowed === false || entry.available === false) continue;
      addCandidate(entry.model ?? entry.value ?? entry.id, entry.at ?? entry.updatedAt);
    }
  }

  const newestByFamily = new Map();
  for (const candidate of candidates) {
    const family = /^claude-([a-z]+)/i.exec(candidate.model)?.[1]?.toLowerCase();
    if (!family) continue;
    const current = newestByFamily.get(family);
    const recency = current ? compareModelRecency(candidate.model, current.model) : -1;
    if (!current || recency < 0 || (recency === 0 && candidate.at > current.at)) {
      newestByFamily.set(family, candidate);
    }
  }

  return [...newestByFamily.values()]
    .sort((left, right) => compareModelRecency(left.model, right.model) || right.at - left.at)
    .map((entry) => entry.model);
}

export class ModelCatalog {
  /**
   * @param {{ providers: Array<{ id: string, kind: "openai"|"anthropic", baseUrl: string,
   *           apiKey?: string, authToken?: string, fallbackModels: string[],
   *           accept?: (model: string) => boolean }>,
   *           cacheMs?: number, timeoutMs?: number,
   *           fetchImpl?: typeof fetch, log?: (message: string) => void }} options
   */
  constructor(options = {}) {
    this.providers = new Map((options.providers ?? []).map((provider) => [provider.id, provider]));
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.log = options.log ?? (() => {});
    /** @type {Map<string, { models: string[], liveModels: string[], source: string, fetchedAt: number, error: string }>} */
    this.cache = new Map();
    this.inFlight = new Map();
    this.refreshTimer = null;
  }

  configure(id, patch) {
    const existing = this.providers.get(id);
    if (existing) this.providers.set(id, { ...existing, ...patch });
  }

  /** Refresh every credentialled provider once, then on an interval. */
  start(refreshMs = 30 * 60 * 1000) {
    void this.refreshAll();
    if (refreshMs <= 0) return;
    this.refreshTimer = setInterval(() => void this.refreshAll(), refreshMs);
    this.refreshTimer.unref?.();
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async refreshAll() {
    const results = await Promise.allSettled([...this.providers.keys()].map((id) => this.get(id, { force: true })));
    return results.length;
  }

  /** Cached provider entry, or the configured fallback if nothing is cached. */
  peek(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const provider = this.providers.get(id);
    return {
      models: provider?.fallbackModels ?? [],
      liveModels: [],
      source: "configured",
      fetchedAt: 0,
      error: provider && !credentialFor(provider) ? "No API credential is configured for this provider." : "",
    };
  }

  async get(id, { force = false } = {}) {
    const provider = this.providers.get(id);
    if (!provider) return { models: [], liveModels: [], source: "configured", fetchedAt: 0, error: `Unknown provider: ${id}` };

    const cached = this.cache.get(id);
    if (!force && cached && Date.now() - cached.fetchedAt < this.cacheMs) return cached;
    if (this.inFlight.has(id)) return await this.inFlight.get(id);

    const promise = this.#fetchProvider(provider)
      .then((entry) => {
        this.cache.set(id, entry);
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(id);
      });
    this.inFlight.set(id, promise);
    return await promise;
  }

  async #fetchProvider(provider) {
    const credential = credentialFor(provider);
    const fallback = {
      models: provider.fallbackModels ?? [],
      liveModels: [],
      source: "configured",
      fetchedAt: Date.now(),
      error: "",
    };
    if (!credential) {
      return { ...fallback, error: "No API credential is configured for this provider." };
    }
    try {
      const url = provider.kind === "anthropic"
        ? `${trimSlash(provider.baseUrl)}/v1/models?limit=200`
        : `${trimSlash(provider.baseUrl)}/models`;
      const headers = provider.kind === "anthropic"
        ? { "x-api-key": credential, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${credential}` };
      const response = await this.#fetchWithTimeout(url, { method: "GET", headers });
      if (!response.ok) {
        return { ...fallback, error: `Provider model list returned HTTP ${response.status}.` };
      }
      const raw = await response.json();
      const ids = extractModelIds(raw).filter((model) => (provider.accept ? provider.accept(model) : true));
      if (!ids.length) return { ...fallback, error: "Provider returned no usable models." };
      // The configured models stay available even when live discovery omits
      // them, so a pinned model never disappears from the picker.
      const liveModels = [...new Set(ids)].sort(compareModelRecency);
      const merged = [...new Set([...liveModels, ...(provider.fallbackModels ?? [])])].sort(compareModelRecency);
      return { models: merged, liveModels, source: "live", fetchedAt: Date.now(), error: "" };
    } catch (error) {
      const reason = String(error?.message ?? error).slice(0, 200);
      this.log(`[bridge] model discovery failed for ${provider.id}: ${reason}`);
      return { ...fallback, error: `Provider model list could not be fetched: ${reason}` };
    }
  }

  async #fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function credentialFor(provider) {
  return String(provider?.apiKey || provider?.authToken || "").trim();
}

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

export function extractModelIds(raw) {
  const data = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.models) ? raw.models : [];
  const ids = data
    .map((entry) => (typeof entry === "string" ? entry : String(entry?.id ?? entry?.model ?? "")))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function createModelCatalog(options) {
  return new ModelCatalog(options);
}

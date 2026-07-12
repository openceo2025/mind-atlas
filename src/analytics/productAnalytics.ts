import { isAboutDemoMode } from "../aboutDemo";
import { getHostedServiceUrl, isHostedServiceMode } from "../hosted/serviceClient";

export type AnalyticsConsent = "accepted" | "declined" | "unset";
export type ProductEventName =
  | "landing_view"
  | "about_demo_interacted"
  | "app_opened"
  | "tutorial_started"
  | "tutorial_completed"
  | "tutorial_skipped"
  | "template_selected"
  | "first_node_created"
  | "activation_reached"
  | "meaningful_edit"
  | "google_login_started"
  | "checkout_started"
  | "shared_atlas_imported";

const CONSENT_KEY = "mind-atlas-analytics-consent-v1";
const ACTOR_KEY = "mind-atlas-analytics-actor-v1";
const ATTRIBUTION_KEY = "mind-atlas-analytics-attribution-v1";
const SESSION_KEY = "mind-atlas-analytics-session-v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const queue: ProductEventPayload[] = [];
let flushTimer: number | null = null;

type Attribution = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  referrerHost: string;
};

type AttributionState = { first: Attribution; last: Attribution };

type ProductEventPayload = {
  id: string;
  name: ProductEventName;
  occurredAt: string;
  locale: string;
  pageGroup: string;
  referrerHost: string;
  utm: Omit<Attribution, "referrerHost">;
  firstTouch: Attribution;
  deviceClass: string;
  experimentId: string;
  variant: string;
  properties: Record<string, string | number | boolean>;
};

export function analyticsRuntimeEnabled() {
  return isHostedServiceMode() && !isAboutDemoMode() && typeof window !== "undefined";
}

export async function fetchAnalyticsAvailability() {
  if (!analyticsRuntimeEnabled()) return false;
  try {
    const response = await fetch(`${getHostedServiceUrl()}/api/analytics/config`, { credentials: "include" });
    if (!response.ok) return false;
    const data = await response.json() as { enabled?: boolean };
    return data.enabled === true;
  } catch {
    return false;
  }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (!analyticsRuntimeEnabled()) return "declined";
  const value = window.localStorage.getItem(CONSENT_KEY);
  return value === "accepted" || value === "declined" ? value : "unset";
}

export function setAnalyticsConsent(consent: Exclude<AnalyticsConsent, "unset">) {
  if (!analyticsRuntimeEnabled()) return;
  window.localStorage.setItem(CONSENT_KEY, consent);
  if (consent === "declined") {
    window.localStorage.removeItem(ACTOR_KEY);
    window.localStorage.removeItem(ATTRIBUTION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    queue.splice(0, queue.length);
    return;
  }
  ensureActorId();
  ensureAttribution();
}

export function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, string | number | boolean> = {},
  options: { immediate?: boolean; pageGroup?: string } = {},
) {
  if (!analyticsRuntimeEnabled() || getAnalyticsConsent() !== "accepted") return;
  const attribution = ensureAttribution();
  queue.push({
    id: randomId(),
    name,
    occurredAt: new Date().toISOString(),
    locale: document.documentElement.lang || navigator.language || "unknown",
    pageGroup: options.pageGroup ?? pageGroupFromPath(location.pathname),
    referrerHost: attribution.last.referrerHost,
    utm: {
      source: attribution.last.source,
      medium: attribution.last.medium,
      campaign: attribution.last.campaign,
      content: attribution.last.content,
      term: attribution.last.term,
    },
    firstTouch: attribution.first,
    deviceClass: detectDeviceClass(),
    experimentId: safeParam(new URLSearchParams(location.search).get("experiment_id")),
    variant: safeParam(new URLSearchParams(location.search).get("variant")),
    properties,
  });
  if (queue.length >= 20 || options.immediate) void flushProductEvents();
  else scheduleFlush();
}

export async function flushProductEvents() {
  if (!analyticsRuntimeEnabled() || getAnalyticsConsent() !== "accepted" || queue.length === 0) return;
  if (flushTimer != null) window.clearTimeout(flushTimer);
  flushTimer = null;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ actorId: ensureActorId(), sessionId: ensureSessionId(), events });
  try {
    const response = await fetch(`${getHostedServiceUrl()}/api/analytics/events`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok && response.status !== 204) throw new Error(`analytics ${response.status}`);
  } catch {
    if (queue.length < 100) queue.unshift(...events);
  }
}

export function startAnalyticsLifecycle() {
  if (!analyticsRuntimeEnabled() || getAnalyticsConsent() !== "accepted") return () => {};
  trackProductEvent("landing_view");
  trackProductEvent("app_opened", {}, { immediate: true });
  const flush = () => {
    if (queue.length === 0) return;
    const body = JSON.stringify({ actorId: ensureActorId(), sessionId: ensureSessionId(), events: queue.splice(0, 20) });
    navigator.sendBeacon?.(`${getHostedServiceUrl()}/api/analytics/events`, new Blob([body], { type: "application/json" }));
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flushOnHidden);
  return () => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", flushOnHidden);
  };
}

function flushOnHidden() {
  if (document.visibilityState === "hidden") void flushProductEvents();
}

function ensureActorId() {
  let value = window.localStorage.getItem(ACTOR_KEY) ?? "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
    value = randomId();
    window.localStorage.setItem(ACTOR_KEY, value);
  }
  return value;
}

function ensureSessionId() {
  const now = Date.now();
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? "null") as { id?: string; lastSeenAt?: number } | null;
    if (stored?.id && Number(stored.lastSeenAt) > now - SESSION_IDLE_MS) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: stored.id, lastSeenAt: now }));
      return stored.id;
    }
  } catch {
    // Replace malformed session state.
  }
  const id = randomId();
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastSeenAt: now }));
  return id;
}

function ensureAttribution(): AttributionState {
  const current = readCurrentAttribution();
  let state: AttributionState | null = null;
  try {
    state = JSON.parse(window.localStorage.getItem(ATTRIBUTION_KEY) ?? "null") as AttributionState | null;
  } catch {
    state = null;
  }
  const first = state?.first ?? current;
  const last = {
    source: current.source || state?.last?.source || first.source,
    medium: current.medium || state?.last?.medium || first.medium,
    campaign: current.campaign || state?.last?.campaign || first.campaign,
    content: current.content || state?.last?.content || first.content,
    term: current.term || state?.last?.term || first.term,
    referrerHost: current.referrerHost || state?.last?.referrerHost || first.referrerHost,
  };
  const next = { first, last };
  window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(next));
  return next;
}

function readCurrentAttribution(): Attribution {
  const params = new URLSearchParams(location.search);
  let referrerHost = "";
  try {
    referrerHost = document.referrer ? new URL(document.referrer).host : "";
  } catch {
    referrerHost = "";
  }
  return {
    source: safeParam(params.get("utm_source")),
    medium: safeParam(params.get("utm_medium")),
    campaign: safeParam(params.get("utm_campaign")),
    content: safeParam(params.get("utm_content")),
    term: safeParam(params.get("utm_term")),
    referrerHost: safeParam(referrerHost),
  };
}

function pageGroupFromPath(pathname: string) {
  if (pathname.endsWith("/about.html")) return "about";
  if (pathname.endsWith("/privacy.html")) return "privacy";
  if (pathname.endsWith("/terms.html")) return "terms";
  return "app";
}

function detectDeviceClass() {
  if (/ipad|tablet|kindle|silk/i.test(navigator.userAgent)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(navigator.userAgent)) return "mobile";
  return "desktop";
}

function safeParam(value: string | null) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => void flushProductEvents(), 1500);
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "_");
}

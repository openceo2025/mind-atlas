import { isAboutDemoMode } from "../aboutDemo";
import { getHostedServiceUrl, isHostedServiceMode } from "../hosted/serviceClient";

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

const queue: ProductEventPayload[] = [];
const legacyLocalStorageKeys = [
  "mind-atlas-analytics-consent-v1",
  "mind-atlas-analytics-actor-v1",
  "mind-atlas-analytics-attribution-v1",
];
const legacySessionStorageKey = "mind-atlas-analytics-session-v1";
let flushTimer: number | null = null;
let analyticsAvailable = false;
let actorId = "";
let sessionId = "";
let attributionState: AttributionState | null = null;
let lifecycleStarted = false;

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
  if (!analyticsRuntimeEnabled()) {
    analyticsAvailable = false;
    return false;
  }
  clearLegacyAnalyticsStorage();
  try {
    const response = await fetch(`${getHostedServiceUrl()}/api/analytics/config`, { credentials: "include" });
    if (!response.ok) return false;
    const data = await response.json() as { enabled?: boolean };
    analyticsAvailable = data.enabled === true;
    return analyticsAvailable;
  } catch {
    analyticsAvailable = false;
    return false;
  }
}

function clearLegacyAnalyticsStorage() {
  try {
    for (const key of legacyLocalStorageKeys) window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(legacySessionStorageKey);
  } catch {
    // Analytics remains storage-free when browser storage is unavailable.
  }
}

export function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, string | number | boolean> = {},
  options: { immediate?: boolean; pageGroup?: string } = {},
) {
  if (!analyticsRuntimeEnabled() || !analyticsAvailable) return;
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
  if (!analyticsRuntimeEnabled() || !analyticsAvailable || queue.length === 0) return;
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
  if (!analyticsRuntimeEnabled() || !analyticsAvailable || lifecycleStarted) return () => {};
  lifecycleStarted = true;
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
    lifecycleStarted = false;
  };
}

function flushOnHidden() {
  if (document.visibilityState === "hidden") void flushProductEvents();
}

function ensureActorId() {
  if (!actorId) actorId = randomId();
  return actorId;
}

function ensureSessionId() {
  if (!sessionId) sessionId = randomId();
  return sessionId;
}

function ensureAttribution(): AttributionState {
  const current = readCurrentAttribution();
  const state = attributionState;
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
  attributionState = next;
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

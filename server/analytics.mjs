import crypto from "node:crypto";
import { getEnv } from "./service-config.mjs";
import { insertProductEvents } from "./service-db.mjs";

export const CLIENT_ANALYTICS_EVENTS = new Set([
  "landing_view",
  "about_demo_interacted",
  "app_opened",
  "tutorial_started",
  "tutorial_completed",
  "tutorial_skipped",
  "template_selected",
  "first_node_created",
  "activation_reached",
  "meaningful_edit",
  "google_login_started",
  "checkout_started",
  "shared_atlas_imported",
]);

export const SERVER_ANALYTICS_EVENTS = new Set([
  "google_login_completed",
  "cloud_save_completed",
  "share_link_created",
  "share_link_opened",
  "checkout_completed",
  "subscription_activated",
  "subscription_cancelled",
  "invoice_paid",
  "payment_failed",
  "ai_request_started",
  "ai_request_succeeded",
  "ai_request_failed",
]);

const PROPERTY_ALLOWLIST = new Map([
  ["about_demo_interacted", new Set(["demo_kind", "interaction"])],
  ["tutorial_completed", new Set(["duration_ms"])],
  ["tutorial_skipped", new Set(["step"])],
  ["template_selected", new Set(["template_id"])],
  ["first_node_created", new Set(["method", "node_count", "max_depth"])],
  ["activation_reached", new Set(["node_count", "max_depth"])],
  ["meaningful_edit", new Set(["kind", "node_count", "max_depth"])],
  ["shared_atlas_imported", new Set(["notebook_id"])],
  ["cloud_save_completed", new Set(["notebook_id", "operation", "size_bytes"])],
  ["share_link_created", new Set(["notebook_id", "new_share"])],
  ["share_link_opened", new Set(["notebook_id", "owner_user_id"])],
  ["checkout_completed", new Set(["currency", "amount_minor"])],
  ["subscription_activated", new Set(["currency", "amount_minor", "billing_interval"])],
  ["subscription_cancelled", new Set(["cancel_at_period_end"])],
  ["invoice_paid", new Set(["currency", "amount_minor"])],
  ["payment_failed", new Set(["currency", "amount_minor", "failure_code"])],
  ["ai_request_started", new Set(["feature", "provider", "model"])],
  ["ai_request_succeeded", new Set(["feature", "provider", "model", "duration_ms", "cost_micro_usd"])],
  ["ai_request_failed", new Set(["feature", "provider", "model", "duration_ms", "error_code"])],
]);

const SAFE_PAGE_GROUPS = new Set(["app", "about", "privacy", "terms", "share", "other"]);
const SAFE_DEVICE_CLASSES = new Set(["desktop", "mobile", "tablet", "unknown"]);

export function analyticsEnabled() {
  return getEnv("MIND_ATLAS_ANALYTICS_ENABLED", "0") === "1";
}

export function clientAnalyticsEnabled() {
  return analyticsEnabled() && getEnv("MIND_ATLAS_CLIENT_ANALYTICS_ENABLED", "0") === "1";
}

export function normalizeClientAnalyticsBatch(payload, { userId = null } = {}) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.events)) {
    throw new AnalyticsValidationError("events must be an array");
  }
  if (payload.events.length < 1 || payload.events.length > 20) {
    throw new AnalyticsValidationError("events must contain between 1 and 20 items");
  }
  const actorId = safeOpaqueId(payload.actorId, 64);
  const sessionId = safeOpaqueId(payload.sessionId, 64);
  if (!actorId || !sessionId) throw new AnalyticsValidationError("actorId and sessionId are required");
  const hmacKey = getEnv("MIND_ATLAS_ANALYTICS_HMAC_KEY");
  if (!hmacKey) throw new Error("MIND_ATLAS_ANALYTICS_HMAC_KEY is required when analytics is enabled");

  return payload.events.map((raw) => {
    const eventName = safeText(raw?.name, 64);
    if (!CLIENT_ANALYTICS_EVENTS.has(eventName)) throw new AnalyticsValidationError(`event is not allowed: ${eventName || "unknown"}`);
    const eventId = safeOpaqueId(raw?.id, 80);
    if (!eventId) throw new AnalyticsValidationError("event id is required");
    const occurredAt = normalizeOccurredAt(raw?.occurredAt);
    return {
      eventId: `client:${eventId}`,
      eventName,
      source: "client",
      actorHash: hmacIdentifier(hmacKey, "actor", actorId),
      sessionHash: hmacIdentifier(hmacKey, "session", sessionId),
      userId,
      occurredAt,
      locale: safeLocale(raw?.locale),
      pageGroup: safePageGroup(raw?.pageGroup),
      referrerHost: safeHost(raw?.referrerHost),
      utmSource: safeText(raw?.utm?.source, 120),
      utmMedium: safeText(raw?.utm?.medium, 120),
      utmCampaign: safeText(raw?.utm?.campaign, 160),
      utmContent: safeText(raw?.utm?.content, 160),
      utmTerm: safeText(raw?.utm?.term, 160),
      firstReferrerHost: safeHost(raw?.firstTouch?.referrerHost),
      firstUtmSource: safeText(raw?.firstTouch?.source, 120),
      firstUtmMedium: safeText(raw?.firstTouch?.medium, 120),
      firstUtmCampaign: safeText(raw?.firstTouch?.campaign, 160),
      firstUtmContent: safeText(raw?.firstTouch?.content, 160),
      firstUtmTerm: safeText(raw?.firstTouch?.term, 160),
      deviceClass: safeDeviceClass(raw?.deviceClass),
      experimentId: safeText(raw?.experimentId, 80),
      variant: safeText(raw?.variant, 80),
      properties: sanitizeProperties(eventName, raw?.properties),
    };
  });
}

export async function recordServerAnalyticsEvent(eventName, options = {}) {
  if (!analyticsEnabled() || !SERVER_ANALYTICS_EVENTS.has(eventName)) return { inserted: 0, duplicates: 0 };
  const eventId = safeOpaqueId(options.eventId, 180) || `server:${eventName}:${crypto.randomUUID()}`;
  return await insertProductEvents([{
    eventId: eventId.startsWith("server:") ? eventId : `server:${eventId}`,
    eventName,
    source: "server",
    actorHash: options.actorHash ?? null,
    sessionHash: options.sessionHash ?? null,
    userId: options.userId ?? null,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    locale: safeLocale(options.locale),
    pageGroup: safePageGroup(options.pageGroup),
    referrerHost: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    utmTerm: "",
    firstReferrerHost: "",
    firstUtmSource: "",
    firstUtmMedium: "",
    firstUtmCampaign: "",
    firstUtmContent: "",
    firstUtmTerm: "",
    deviceClass: "unknown",
    experimentId: "",
    variant: "",
    properties: sanitizeProperties(eventName, options.properties),
  }]);
}

export async function recordServerAnalyticsEventSafe(eventName, options = {}) {
  try {
    return await recordServerAnalyticsEvent(eventName, options);
  } catch (error) {
    console.error(`[analytics] failed to record ${eventName}:`, error instanceof Error ? error.message : String(error));
    return { inserted: 0, duplicates: 0 };
  }
}

export function sanitizeProperties(eventName, value) {
  const allowed = PROPERTY_ALLOWLIST.get(eventName);
  if (!allowed || !value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of allowed) {
    const raw = value[key];
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = Math.max(-1_000_000_000, Math.min(1_000_000_000, raw));
    else if (typeof raw === "string") result[key] = safeText(raw, 160);
  }
  return result;
}

export function hmacIdentifier(key, namespace, value) {
  return crypto.createHmac("sha256", key).update(`${namespace}:${value}`).digest("hex");
}

export class AnalyticsValidationError extends Error {}

function safeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function safeOpaqueId(value, maxLength) {
  const text = safeText(value, maxLength);
  return /^[A-Za-z0-9_-]{16,180}$/.test(text) ? text : "";
}

function safeLocale(value) {
  const text = safeText(value, 24);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(text) ? text : "unknown";
}

function safeHost(value) {
  const text = safeText(value, 253).toLowerCase();
  if (!text || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(text)) return "";
  return text;
}

function safePageGroup(value) {
  const text = safeText(value, 24);
  return SAFE_PAGE_GROUPS.has(text) ? text : "other";
}

function safeDeviceClass(value) {
  const text = safeText(value, 16);
  return SAFE_DEVICE_CLASSES.has(text) ? text : "unknown";
}

function normalizeOccurredAt(value) {
  const parsed = new Date(typeof value === "string" ? value : Date.now());
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime()) || Math.abs(parsed.getTime() - now) > 24 * 60 * 60 * 1000) {
    return new Date(now).toISOString();
  }
  return parsed.toISOString();
}

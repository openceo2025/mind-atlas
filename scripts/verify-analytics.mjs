import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL ||= "postgres://analytics-test:analytics-test@127.0.0.1:9/analytics-test";
process.env.MIND_ATLAS_ANALYTICS_HMAC_KEY ||= "analytics-test-key-with-at-least-thirty-two-characters";

const { AnalyticsValidationError, hmacIdentifier, normalizeClientAnalyticsBatch, sanitizeProperties } = await import("../server/analytics.mjs");
const { classifyDimensions, dailyVisitorHash } = await import("../server/traffic-analytics.mjs");

const batch = normalizeClientAnalyticsBatch({
  actorId: "actor_0123456789abcdef0123456789abcdef",
  sessionId: "session_0123456789abcdef0123456789abcdef",
  events: [{
    id: "event_0123456789abcdef0123456789abcdef",
    name: "activation_reached",
    occurredAt: new Date().toISOString(),
    locale: "ja",
    pageGroup: "app",
    referrerHost: "example.com",
    utm: { source: "x", medium: "social", campaign: "launch" },
    deviceClass: "mobile",
    properties: {
      node_count: 7,
      max_depth: 3,
      title: "must not be stored",
      body: "must not be stored",
      url: "https://example.com/private",
      email: "person@example.com",
    },
  }],
});

assert.equal(batch.length, 1);
assert.deepEqual(batch[0].properties, { node_count: 7, max_depth: 3 });
assert.equal(batch[0].actorHash.length, 64);
assert.equal(batch[0].sessionHash.length, 64);
assert.notEqual(batch[0].actorHash, batch[0].sessionHash);
assert.equal(batch[0].referrerHost, "example.com");
assert.equal("title" in batch[0].properties, false);

assert.throws(
  () => normalizeClientAnalyticsBatch({ actorId: "actor_0123456789abcdef", sessionId: "session_0123456789abcdef", events: [{ id: "event_0123456789abcdef", name: "email_collected" }] }),
  AnalyticsValidationError,
);
assert.throws(
  () => normalizeClientAnalyticsBatch({ actorId: "actor_0123456789abcdef", sessionId: "session_0123456789abcdef", events: Array.from({ length: 21 }, (_, index) => ({ id: `event_0123456789abcdef_${index}`, name: "app_opened" })) }),
  AnalyticsValidationError,
);
assert.deepEqual(sanitizeProperties("meaningful_edit", { kind: "body", node_count: 4, node_title: "secret" }), { kind: "body", node_count: 4 });
assert.equal(hmacIdentifier("key", "actor", "same"), hmacIdentifier("key", "actor", "same"));
assert.notEqual(dailyVisitorHash("key", "2026-07-11", "127.0.0.1", "Browser"), dailyVisitorHash("key", "2026-07-12", "127.0.0.1", "Browser"));

assert.deepEqual(classifyDimensions({
  referrer_host: "x.com",
  utm_source: "promo",
  utm_medium: "social",
  utm_campaign: "launch",
  accept_language: "ja-JP,ja;q=0.9",
  user_agent: "Mozilla/5.0 (iPhone; Mobile)",
}, "/ja/about.html"), {
  pageGroup: "about",
  landingPage: "/ja/about.html",
  referrerHost: "x.com",
  utmSource: "promo",
  utmMedium: "social",
  utmCampaign: "launch",
  locale: "ja",
  deviceClass: "mobile",
});

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/analytics/productAnalytics.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server/mind-atlas-service.mjs", import.meta.url), "utf8");
assert.ok(client.includes("isAboutDemoMode()"), "about demos must not send product analytics");
assert.ok(client.includes('getAnalyticsConsent() !== "accepted"'), "client events must require consent");
assert.ok(app.includes("metrics.nodeCount >= 5 && metrics.maxDepth >= 2"), "activation threshold should require five nodes and depth two");
assert.ok(app.includes("analyticsIgnoreNextNotebookRef"), "template/import changes should not directly activate users");
assert.ok(server.includes("analyticsEventMaxBytes"), "analytics endpoint should have a dedicated body cap");
assert.ok(server.includes("analyticsIpMax"), "analytics endpoint should have a dedicated IP rate limit");

console.log("Analytics verification passed.");

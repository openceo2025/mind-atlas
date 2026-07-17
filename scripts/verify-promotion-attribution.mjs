import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildPromotionRedirect,
  decodePromotionContext,
  encodePromotionContext,
  matchPromotionShortPath,
  promotionContextFromGoogleStart,
} from "../server/promotion-attribution.mjs";

assert.deepEqual(matchPromotionShortPath("/go/sticky_2026w29/openceo/sticky_master_01"), {
  campaign: "sticky_2026w29",
  partner: "openceo",
  asset: "sticky_master_01",
});
assert.equal(matchPromotionShortPath("/go/has%20space/openceo/asset"), null);
assert.equal(matchPromotionShortPath("/go/a/b"), null);

const redirect = buildPromotionRedirect(
  "/go/sticky_2026w29/openceo/sticky_master_01",
  new URLSearchParams("platform=x&locale=ja"),
);
assert.equal(redirect.location, "/?utm_source=openceo&utm_medium=x&utm_campaign=sticky_2026w29&utm_content=sticky_master_01&locale=ja");

const context = promotionContextFromGoogleStart(redirect.location, "cloud_save");
assert.deepEqual(context, {
  campaign: "sticky_2026w29",
  partner: "openceo",
  asset: "sticky_master_01",
  platform: "x",
  locale: "ja",
  trigger: "cloud_save",
});
assert.deepEqual(decodePromotionContext(encodePromotionContext(context)), context);
assert.equal(promotionContextFromGoogleStart("/?utm_campaign=bad%20value", "not_allowed").campaign, "");
assert.equal(promotionContextFromGoogleStart("/", "not_allowed").trigger, "account");
assert.deepEqual(decodePromotionContext("not-base64-json"), {
  campaign: "",
  partner: "",
  asset: "",
  platform: "",
  locale: "",
  trigger: "account",
});

const service = fs.readFileSync(new URL("../server/mind-atlas-service.mjs", import.meta.url), "utf8");
const serviceDb = fs.readFileSync(new URL("../server/service-db.mjs", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/hosted/serviceClient.ts", import.meta.url), "utf8");
const report = fs.readFileSync(new URL("../server/analytics-report.mjs", import.meta.url), "utf8");
assert.ok(service.includes("buildPromotionRedirect(url.pathname, url.searchParams)"));
assert.ok(service.includes('oauthAttributionCookieName = "ma_oauth_attribution"'));
assert.ok(service.includes('recordServerAnalyticsEventSafe("google_user_created"'));
assert.ok(serviceDb.includes("(xmax = 0) as created"));
assert.ok(client.includes('url.searchParams.set("trigger", trigger)'));
assert.ok(report.includes("cloudSavedWithin24h"));
assert.ok(report.includes("buildGoogleUserRetention"));

console.log("Promotion attribution verification passed.");

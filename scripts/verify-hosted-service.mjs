import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filePath) => fs.readFileSync(path.join(rootDir, filePath), "utf8");

const packageJson = JSON.parse(read("package.json"));
const server = read("server/mind-atlas-service.mjs");
const serviceDb = read("server/service-db.mjs");
const admin = read("server/admin.mjs");
const envExample = read(".env.example");
const serviceEnv = read("deploy/conoha/env.service.example");
const conohaNginx = read("deploy/conoha/nginx.conf");
const stagingEnv = read("deploy/staging/env.service.docker.example");
const docs = read("docs/vps-service.md");
const stagingDocs = read("docs/staging-service.md");
const stagingLocalEnv = read("deploy/staging/env.service.local.example");

for (const filePath of [
  "server/mind-atlas-service.mjs",
  "server/service-db.mjs",
  "server/admin.mjs",
  "Dockerfile.staging",
  "docker-compose.staging.yml",
  "docker-compose.staging.local.example.yml",
  "deploy/staging/nginx.conf",
  "deploy/staging/env.service.docker.example",
  "deploy/staging/env.service.local.example",
  "deploy/conoha/mind-atlas.service",
  "deploy/conoha/nginx.conf",
  "deploy/conoha/env.service.example",
  "docs/vps-service.md",
  "docs/staging-service.md",
  "scripts/verify-google-staging-ready.mjs",
  "scripts/verify-stripe-staging-ready.mjs",
  "scripts/verify-openai-staging-ready.mjs",
  "scripts/verify-core-provider-staging-ready.mjs",
  "scripts/verify-live-staging-ui.mjs",
  "scripts/verify-live-staging-e2e.mjs",
]) {
  assert.equal(fs.existsSync(path.join(rootDir, filePath)), true, `${filePath} should exist`);
}

for (const filePath of [
  "server/mind-atlas-service.mjs",
  "server/service-db.mjs",
  "server/admin.mjs",
  "scripts/verify-google-staging-ready.mjs",
  "scripts/verify-stripe-staging-ready.mjs",
  "scripts/verify-openai-staging-ready.mjs",
  "scripts/verify-core-provider-staging-ready.mjs",
  "scripts/verify-live-staging-ui.mjs",
  "scripts/verify-live-staging-e2e.mjs",
]) {
  execFileSync(process.execPath, ["--check", filePath], { cwd: rootDir, stdio: "pipe" });
}

for (const scriptName of [
  "service:start",
  "service:migrate",
  "service:admin",
  "staging:local:up",
  "staging:local:down",
  "staging:google:doctor",
  "staging:stripe:doctor",
  "staging:openai:doctor",
  "staging:providers:doctor",
  "staging:ui:doctor",
  "staging:e2e:doctor",
  "staging:verify",
  "verify:hosted-public-ui",
]) {
  assert.ok(packageJson.scripts?.[scriptName], `package.json should define ${scriptName}`);
}

for (const route of [
  "/api/service/session",
  "/api/auth/google/start",
  "/api/auth/google/callback",
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/billing/stripe/webhook",
  "/api/ai/text-partner-turn",
  "/api/realtime/calls",
  "/api/audio/transcriptions",
  "/api/tools/web-search",
]) {
  assert.ok(server.includes(route), `hosted service should expose ${route}`);
}

for (const provider of [
  "openai",
  "anthropic",
  "glm",
  "deepseek",
  "gemini",
  "qwen",
  "composer",
  "kimi",
  "mimo",
  "minimax",
  "grok",
]) {
  assert.ok(server.includes(`provider("${provider}"`), `provider catalog should include ${provider}`);
}

for (const requiredEnv of [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD",
  "MIND_ATLAS_SERVICE_CHAT_INPUT_MAX_CHARS",
  "MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN",
  "MIND_ATLAS_SERVICE_HIGH_COST_OUTPUT_USD_PER_1M",
  "MIND_ATLAS_SERVICE_HIGH_COST_MAX_OUTPUT_TOKENS",
  "MIND_ATLAS_MODEL_PRICE_POLICY",
  "MIND_ATLAS_PROVIDER_MODEL_FETCH",
  "MIND_ATLAS_PROVIDER_MODEL_CACHE_MS",
  "MIND_ATLAS_PROVIDER_MODEL_FETCH_TIMEOUT_MS",
  "MIND_ATLAS_PROVIDER_MODEL_MAX_COUNT",
  "MIND_ATLAS_REALTIME_MODELS",
  "MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS",
  "MIND_ATLAS_WEB_SEARCH_MIN_MICRO_USD",
  "MIND_ATLAS_WEB_SEARCH_MAX_QUERY_CHARS",
  "MIND_ATLAS_STAGING_MOCK_AUTH",
  "MIND_ATLAS_STAGING_MOCK_BILLING",
  "MIND_ATLAS_STAGING_MOCK_PROVIDERS",
]) {
  if (!requiredEnv.startsWith("MIND_ATLAS_STAGING_")) {
    assert.ok(envExample.includes(`${requiredEnv}=`), `.env.example should document ${requiredEnv}`);
    assert.ok(serviceEnv.includes(`${requiredEnv}=`), `ConoHa env template should document ${requiredEnv}`);
  }
  assert.ok(stagingEnv.includes(`${requiredEnv}=`), `staging env template should document ${requiredEnv}`);
  assert.ok(stagingLocalEnv.includes(`${requiredEnv}=`), `local staging env template should document ${requiredEnv}`);
}

for (const providerEnv of [
  "MIND_ATLAS_OPENAI_API_KEY",
  "MIND_ATLAS_ANTHROPIC_API_KEY",
  "MIND_ATLAS_GLM_API_KEY",
  "MIND_ATLAS_DEEPSEEK_API_KEY",
  "MIND_ATLAS_GEMINI_API_KEY",
  "MIND_ATLAS_QWEN_API_KEY",
  "MIND_ATLAS_COMPOSER_API_KEY",
  "MIND_ATLAS_KIMI_API_KEY",
  "MIND_ATLAS_MIMO_API_KEY",
  "MIND_ATLAS_MINIMAX_API_KEY",
  "MIND_ATLAS_GROK_API_KEY",
]) {
  assert.ok(serviceEnv.includes(`${providerEnv}=`), `deploy env template should include ${providerEnv}`);
  assert.ok(stagingEnv.includes(`${providerEnv}=`), `staging env template should include ${providerEnv}`);
  assert.ok(stagingLocalEnv.includes(`${providerEnv}=`), `local staging env template should include ${providerEnv}`);
}

for (const adminCommand of ["doctor", "usage", "grant-credit", "grant-admin", "set-credit"]) {
  assert.ok(admin.includes(commandNeedle(adminCommand)), `admin CUI should expose ${adminCommand}`);
  assert.ok(docs.includes(`service:admin -- ${adminCommand}`), `docs should mention ${adminCommand}`);
}

assert.ok(docs.includes("VITE_MIND_ATLAS_PUBLIC_SERVICE=true"), "docs should include public build command");
assert.ok(docs.includes("mind-atlas.org/api/billing/stripe/webhook"), "docs should include Stripe webhook URL");
assert.ok(server.includes("reserveUsageCredit"), "hosted service should reserve credit before upstream calls");
assert.ok(server.includes("meterReservedUsage"), "hosted service should settle reserved credit after usage");
assert.ok(server.includes("refundUsageReservation"), "hosted service should refund reserved credit after upstream failures");
assert.ok(server.includes("enforceBrowserOrigin(request, url)"), "hosted service should enforce browser origin on mutable API requests");
assert.ok(server.includes("function isBrowserMutableApiRequest"), "hosted service should define mutable API origin scope");
assert.ok(server.includes('url.pathname !== "/api/billing/stripe/webhook"'), "Stripe webhooks should bypass browser origin checks and rely on Stripe signatures");
assert.ok(server.includes('"origin_not_allowed"'), "hosted service should distinguish origin rejection from provider failures");
assert.equal(server.includes("baseUrl: provider.baseUrl"), false, "public hosted responses should not expose provider base URLs");
assert.ok(server.includes("MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS"), "hosted service should make Stripe webhook timestamp tolerance configurable");
assert.ok(server.includes("timestampAgeSeconds > stripeWebhookToleranceSeconds"), "Stripe webhook signature verification should reject stale signatures");
assert.ok(server.includes("function isPathWithin"), "hosted static serving should check resolved path boundaries");
assert.ok(server.includes("decodePathname"), "hosted static serving should reject malformed encoded paths");
assert.ok(server.includes("function isFable5ChatModel"), "hosted service should identify Claude Fable 5 models");
assert.ok(server.includes('overageAllowed: fable5OnePass ? "fable5_one_pass"'), "hosted service should mark Fable 5 one-pass reservations");
assert.ok(server.includes("reservationMicroUsd: fable5OnePass ? Math.max(1, Math.round(remaining))"), "Fable 5 should reserve the full remaining token");
assert.ok(server.includes("minimumSettlementMicroUsd: fable5OnePass ? Math.max(1, Math.round(remaining))"), "Fable 5 should settle at least the full remaining token");
assert.ok(server.includes("applyMinimumSettlementUsage"), "hosted service should force one-pass minimum settlement when required");
assert.ok(docs.includes("one-pass hosted-service exception"), "docs should explain the Fable 5 one-pass exception");
assert.ok(docs.includes("MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS"), "docs should include Stripe webhook timestamp tolerance");
assert.ok(conohaNginx.includes("client_max_body_size 30m"), "ConoHa nginx should allow hosted dictation uploads");
assert.ok(conohaNginx.includes("X-Content-Type-Options"), "ConoHa nginx should send nosniff header");
assert.ok(conohaNginx.includes('X-Frame-Options "SAMEORIGIN"'), "ConoHa nginx should allow same-origin demo framing only");
assert.ok(conohaNginx.includes("Permissions-Policy"), "ConoHa nginx should send a permissions policy");
assert.ok(serviceDb.includes("export async function reserveCredit"), "service DB should expose atomic credit reservation");
assert.ok(serviceDb.includes("export async function settleCreditReservation"), "service DB should expose reservation settlement");
assert.ok(stagingDocs.includes("npm run staging:google:doctor"), "staging docs should include Google OAuth doctor");
assert.ok(stagingDocs.includes("npm run staging:stripe:doctor"), "staging docs should include Stripe doctor");
assert.ok(stagingDocs.includes("npm run staging:openai:doctor"), "staging docs should include OpenAI doctor");
assert.ok(stagingDocs.includes("npm run staging:providers:doctor"), "staging docs should include core provider doctor");
assert.ok(stagingDocs.includes("npm run staging:ui:doctor"), "staging docs should include live staging UI doctor");
assert.ok(stagingDocs.includes("npm run staging:e2e:doctor"), "staging docs should include live staging E2E doctor");
assert.ok(
  stagingDocs.includes("http://127.0.0.1:8088/api/auth/google/callback"),
  "staging docs should include the local Google OAuth callback",
);
assert.ok(
  stagingDocs.includes("http://127.0.0.1:8088/api/billing/stripe/webhook"),
  "staging docs should include the local Stripe webhook forwarding URL",
);

console.log("Hosted service verification passed");

function commandNeedle(command) {
  return `command === "${command}"`;
}

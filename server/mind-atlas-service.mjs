import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  buildEntitlement,
  deleteExpiredSessions,
  getSessionUser,
  getUserSubscription,
  forgetStripeEvent,
  isSubscriptionActive,
  markStripeEventProcessed,
  markStripeEventProcessing,
  migrateDatabase,
  MONTHLY_CREDIT_MICRO_USD,
  recordUsageEvent,
  reserveCredit,
  refundStaleCreditReservations,
  settleCreditReservation,
  upsertGoogleUser,
  upsertSubscriptionByStripeCustomer,
  upsertSubscriptionByUserId,
  createSession,
  deleteSession,
} from "./service-db.mjs";
import { getEnv, parseJsonEnv, parseListEnv, readIntEnv, serviceRootDir } from "./service-config.mjs";
import { hasModelPrice, mergeModelPrices, resolveExactModelPrice } from "./model-pricing.mjs";
import { stripePatchFromStripeSubscription } from "./stripe-subscription.mjs";

const serviceHost = getEnv("MIND_ATLAS_SERVICE_HOST", "127.0.0.1");
const servicePort = readIntEnv("MIND_ATLAS_SERVICE_PORT", 8788);
const publicOrigin = getEnv("MIND_ATLAS_PUBLIC_ORIGIN", "https://mind-atlas.org").replace(/\/+$/, "");
const distDir = path.resolve(serviceRootDir, getEnv("MIND_ATLAS_DIST_DIR", "dist"));
const sessionCookieName = "ma_session";
const oauthStateCookieName = "ma_oauth_state";
const oauthReturnCookieName = "ma_oauth_return";
const cookieSecure = getEnv("MIND_ATLAS_COOKIE_SECURE", publicOrigin.startsWith("https://") ? "1" : "0") !== "0";
const googleClientId = getEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = getEnv("GOOGLE_CLIENT_SECRET");
const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
const stripeWebhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
const stripePriceId = getEnv("STRIPE_PRICE_ID");
const stripePortalReturnPath = getEnv("MIND_ATLAS_STRIPE_PORTAL_RETURN_PATH", "/");
const openAiApiKey = getEnv("MIND_ATLAS_OPENAI_API_KEY", getEnv("OPENAI_API_KEY"));
const openAiBaseUrl = getEnv("MIND_ATLAS_OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
const realtimeModel = getEnv("MIND_ATLAS_REALTIME_MODEL", "gpt-realtime-2");
const realtimeVoice = getEnv("MIND_ATLAS_REALTIME_VOICE", "marin");
const realtimeTranscriptionModel = getEnv("MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL", "gpt-4o-transcribe");
const transcriptionModel = getEnv("MIND_ATLAS_TRANSCRIPTION_MODEL", "gpt-4o-transcribe");
const maxOutputTokens = readIntEnv("MIND_ATLAS_SERVICE_MAX_OUTPUT_TOKENS", 4096);
const realtimeMaxOutputTokens = readIntEnv("MIND_ATLAS_REALTIME_MAX_OUTPUT_TOKENS", 512);
const realtimeMaxSessionSeconds = readIntEnv("MIND_ATLAS_REALTIME_MAX_SESSION_SECONDS", 300);
const highCostMaxOutputTokens = readIntEnv("MIND_ATLAS_SERVICE_HIGH_COST_MAX_OUTPUT_TOKENS", 2048);
const highCostOutputUsdPer1m = Number(getEnv("MIND_ATLAS_SERVICE_HIGH_COST_OUTPUT_USD_PER_1M", "50"));
const realtimeSessionMicroUsd = readIntEnv("MIND_ATLAS_REALTIME_SESSION_MICRO_USD", 750_000);
const transcriptionMinMicroUsd = readIntEnv("MIND_ATLAS_TRANSCRIPTION_MIN_MICRO_USD", 2_000);
const transcriptionUsdPerMinute = Number(getEnv("MIND_ATLAS_TRANSCRIPTION_USD_PER_MINUTE", "0.006"));
const webSearchMinMicroUsd = readIntEnv("MIND_ATLAS_WEB_SEARCH_MIN_MICRO_USD", 15_000);
const defaultInputUsdPer1m = Number(getEnv("MIND_ATLAS_DEFAULT_INPUT_USD_PER_1M", "1.5"));
const defaultOutputUsdPer1m = Number(getEnv("MIND_ATLAS_DEFAULT_OUTPUT_USD_PER_1M", "8"));
const modelPrices = mergeModelPrices(parseJsonEnv("MIND_ATLAS_MODEL_PRICES_JSON", {}));
const modelPricePolicy = getEnv("MIND_ATLAS_MODEL_PRICE_POLICY", "allow-default").toLowerCase();
const jsonBodyMaxBytes = readIntEnv("MIND_ATLAS_SERVICE_JSON_MAX_BYTES", 2 * 1024 * 1024);
const formBodyMaxBytes = readIntEnv("MIND_ATLAS_SERVICE_FORM_MAX_BYTES", 28 * 1024 * 1024);
const stripeWebhookMaxBytes = readIntEnv("MIND_ATLAS_STRIPE_WEBHOOK_MAX_BYTES", 1024 * 1024);
const stripeWebhookToleranceSeconds = readIntEnv("MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS", 300);
const chatInputMaxChars = readIntEnv("MIND_ATLAS_SERVICE_CHAT_INPUT_MAX_CHARS", 300_000);
const chatReserveCharsPerToken = Math.max(1, Number(getEnv("MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN", "2")) || 2);
const maxRequestEstimateMicroUsd = readIntEnv("MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD", 2_000_000);
const webSearchQueryMaxChars = readIntEnv("MIND_ATLAS_WEB_SEARCH_MAX_QUERY_CHARS", 1000);
const providerModelFetchEnabled = readBoolEnv("MIND_ATLAS_PROVIDER_MODEL_FETCH", true);
const providerModelCacheMs = readIntEnv("MIND_ATLAS_PROVIDER_MODEL_CACHE_MS", 5 * 60 * 1000);
const providerModelRefreshMs = readIntEnv("MIND_ATLAS_PROVIDER_MODEL_REFRESH_MS", providerModelCacheMs);
const providerModelFetchTimeoutMs = readIntEnv("MIND_ATLAS_PROVIDER_MODEL_FETCH_TIMEOUT_MS", 10_000);
const providerModelMaxCount = readIntEnv("MIND_ATLAS_PROVIDER_MODEL_MAX_COUNT", 80);
const ipRateLimitWindowMs = readIntEnv("MIND_ATLAS_RATE_LIMIT_WINDOW_MS", 60_000);
const ipRateLimitMax = readIntEnv("MIND_ATLAS_RATE_LIMIT_IP_MAX", 180);
const authRateLimitMax = readIntEnv("MIND_ATLAS_RATE_LIMIT_AUTH_MAX", 20);
const userAiRateLimitMax = readIntEnv("MIND_ATLAS_RATE_LIMIT_USER_AI_MAX", 30);
const userAiConcurrentRequests = readIntEnv("MIND_ATLAS_AI_CONCURRENT_REQUESTS", 2);
const realtimeConcurrentSessions = readIntEnv("MIND_ATLAS_REALTIME_CONCURRENT_SESSIONS", 1);
const sessionIdleDays = readIntEnv("MIND_ATLAS_SESSION_IDLE_DAYS", 7);
const staleReservationMinutes = readIntEnv("MIND_ATLAS_STALE_RESERVATION_MINUTES", 30);
const maintenanceIntervalMs = readIntEnv("MIND_ATLAS_MAINTENANCE_INTERVAL_MS", 5 * 60 * 1000);
const stagingMockAuth = readBoolEnv("MIND_ATLAS_STAGING_MOCK_AUTH", false);
const stagingMockBilling = readBoolEnv("MIND_ATLAS_STAGING_MOCK_BILLING", false);
const stagingMockProviders = readBoolEnv("MIND_ATLAS_STAGING_MOCK_PROVIDERS", false);
const stagingMockEmail = getEnv("MIND_ATLAS_STAGING_MOCK_EMAIL", "staging-user@example.test");
const stagingMockName = getEnv("MIND_ATLAS_STAGING_MOCK_NAME", "Staging User");
const openAiApiKeyUsable = isUsableServiceSecret(openAiApiKey);

const providerCatalog = createProviderCatalog();
const providerModelCache = new Map();
const providerModelAvailabilityCache = new Map();
const rateLimitBuckets = new Map();
const userConcurrencyCounts = new Map();
const activeRealtimeSessions = new Map();

assertSafeProductionConfig();
await migrateDatabase();
await runServiceMaintenanceOnce("startup");

const server = http.createServer(async (request, response) => {
  try {
    enforceRateLimit(request);
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? "/", publicOrigin);
    enforceBrowserOrigin(request, url);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "mind-atlas-service",
        publicService: true,
        configured: {
          google: stagingMockAuth || Boolean(googleClientId && googleClientSecret),
          stripe: stagingMockBilling || Boolean(stripeSecretKey && stripePriceId),
          openai: stagingMockProviders || openAiApiKeyUsable,
          anthropic: providerCatalog.some((provider) => provider.id === "anthropic" && provider.configured),
          deepseek: providerCatalog.some((provider) => provider.id === "deepseek" && provider.configured),
          stagingMocks: {
            auth: stagingMockAuth,
            billing: stagingMockBilling,
            providers: stagingMockProviders,
          },
        },
        providers: providerCatalog.map((provider) => ({
          id: provider.id,
          label: provider.label,
          configured: provider.configured,
        })),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/service/session") {
      const session = await createSessionResponse(await authenticate(request));
      sendJson(response, 200, session);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/chat/options") {
      sendJson(response, 200, await createChatOptionsResponse());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/google/start") {
      await handleGoogleStart(request, response, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/google/callback") {
      await handleGoogleCallback(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = parseCookies(request.headers.cookie)[sessionCookieName];
      await deleteSession(token);
      setCookie(response, sessionCookieName, "", { maxAge: 0 });
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/billing/checkout") {
      await handleBillingCheckout(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/billing/portal") {
      await handleBillingPortal(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/billing/mock-checkout") {
      await handleMockBillingCheckout(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/billing/stripe/webhook") {
      await handleStripeWebhook(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/text-partner-turn") {
      await handleTextPartnerTurn(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/calls") {
      await handleRealtimeCall(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audio/transcriptions") {
      await handleAudioTranscription(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tools/web-search") {
      await handleWebSearch(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(response, request.method, url.pathname);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error instanceof ServiceError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Mind Atlas service failed";
    if (status >= 500) console.error(error);
    sendJson(response, status, createServiceErrorPayload(status, message));
  }
});

server.listen(servicePort, serviceHost, () => {
  console.log(`Mind Atlas service listening on http://${serviceHost}:${servicePort}`);
  console.log(`Public origin: ${publicOrigin}`);
  console.log(`Static dist: ${distDir}`);
});
scheduleProviderModelRefresh();
scheduleServiceMaintenance();

function assertSafeProductionConfig() {
  if (!isProductionOrigin()) return;
  const enabledMocks = [
    stagingMockAuth ? "MIND_ATLAS_STAGING_MOCK_AUTH" : "",
    stagingMockBilling ? "MIND_ATLAS_STAGING_MOCK_BILLING" : "",
    stagingMockProviders ? "MIND_ATLAS_STAGING_MOCK_PROVIDERS" : "",
  ].filter(Boolean);
  if (enabledMocks.length) {
    throw new Error(`Refusing to start production service with staging mocks enabled: ${enabledMocks.join(", ")}`);
  }
  if (!cookieSecure) throw new Error("Refusing to start production service without secure cookies");
  if (modelPricePolicy !== "require-model") {
    throw new Error("Refusing to start production service unless MIND_ATLAS_MODEL_PRICE_POLICY=require-model");
  }
  if (realtimeMaxOutputTokens < 1 || realtimeMaxOutputTokens > 4096) {
    throw new Error("MIND_ATLAS_REALTIME_MAX_OUTPUT_TOKENS must be between 1 and 4096");
  }
  if (realtimeMaxSessionSeconds < 30 || realtimeMaxSessionSeconds > 1800) {
    throw new Error("MIND_ATLAS_REALTIME_MAX_SESSION_SECONDS must be between 30 and 1800");
  }
}

function isProductionOrigin() {
  const origin = new URL(publicOrigin);
  return origin.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
}

async function runServiceMaintenanceOnce(reason) {
  try {
    const [deletedSessions, refundedReservations] = await Promise.all([
      deleteExpiredSessions(sessionIdleDays),
      refundStaleCreditReservations({ olderThanMinutes: staleReservationMinutes }),
    ]);
    if (deletedSessions || refundedReservations) {
      console.log(`Mind Atlas service maintenance (${reason}): deletedSessions=${deletedSessions} refundedReservations=${refundedReservations}`);
    }
  } catch (error) {
    console.error(`Mind Atlas service maintenance failed (${reason})`, error);
  }
}

function scheduleServiceMaintenance() {
  if (maintenanceIntervalMs <= 0) return;
  const timer = setInterval(() => {
    void runServiceMaintenanceOnce("interval");
  }, maintenanceIntervalMs);
  timer.unref?.();
}

function enforceRateLimit(request) {
  const url = new URL(request.url ?? "/", publicOrigin);
  if (url.pathname === "/health") return;
  const ip = requestClientIp(request);
  consumeRateLimit(`ip:${ip}`, ipRateLimitMax, ipRateLimitWindowMs);
  if (url.pathname.startsWith("/api/auth/")) {
    consumeRateLimit(`auth:${ip}`, authRateLimitMax, 10 * 60 * 1000);
  }
}

function enforceUserRateLimit(userId, scope, maxRequests) {
  consumeRateLimit(`user:${scope}:${userId}`, maxRequests, ipRateLimitWindowMs);
}

function consumeRateLimit(key, maxRequests, windowMs) {
  if (maxRequests <= 0 || windowMs <= 0) return;
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= maxRequests) {
    throw new ServiceError(429, "Rate limit exceeded");
  }
  current.count += 1;
}

function requestClientIp(request) {
  const forwardedFor = stringValue(request.headers["x-forwarded-for"]).split(",")[0]?.trim();
  return forwardedFor || stringValue(request.headers["x-real-ip"]) || request.socket?.remoteAddress || "unknown";
}

function enterUserConcurrency(key, limit) {
  if (limit <= 0) return () => {};
  const count = userConcurrencyCounts.get(key) ?? 0;
  if (count >= limit) throw new ServiceError(429, "Too many concurrent AI requests");
  userConcurrencyCounts.set(key, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = Math.max(0, (userConcurrencyCounts.get(key) ?? 1) - 1);
    if (next) userConcurrencyCounts.set(key, next);
    else userConcurrencyCounts.delete(key);
  };
}

function attachReleaseOnResponse(response, release) {
  let released = false;
  const once = () => {
    if (released) return;
    released = true;
    release();
  };
  response.once?.("finish", once);
  response.once?.("close", once);
  response.once?.("error", once);
}

function enterRealtimeSession(userId) {
  if (realtimeConcurrentSessions <= 0) return () => {};
  const key = `realtime:${userId}`;
  const now = Date.now();
  const existing = (activeRealtimeSessions.get(key) ?? []).filter((item) => item.expiresAt > now);
  if (existing.length >= realtimeConcurrentSessions) {
    activeRealtimeSessions.set(key, existing);
    throw new ServiceError(429, "Too many concurrent Realtime sessions");
  }
  const entry = { id: crypto.randomUUID(), expiresAt: now + realtimeMaxSessionSeconds * 1000 };
  existing.push(entry);
  activeRealtimeSessions.set(key, existing);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const next = (activeRealtimeSessions.get(key) ?? []).filter((item) => item.id !== entry.id && item.expiresAt > Date.now());
    if (next.length) activeRealtimeSessions.set(key, next);
    else activeRealtimeSessions.delete(key);
  };
  const timer = setTimeout(release, realtimeMaxSessionSeconds * 1000);
  timer.unref?.();
  return () => {
    clearTimeout(timer);
    release();
  };
}

async function handleGoogleStart(_request, response, url) {
  if (stagingMockAuth) {
    await handleMockGoogleLogin(response, url);
    return;
  }
  if (!googleClientId || !googleClientSecret) throw new ServiceError(503, "Google OAuth is not configured");
  const state = crypto.randomBytes(24).toString("base64url");
  const returnTo = safeReturnPath(url.searchParams.get("returnTo") || "/");
  setCookie(response, oauthStateCookieName, state, { maxAge: 600 });
  setCookie(response, oauthReturnCookieName, returnTo, { maxAge: 600 });
  const redirect = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  redirect.searchParams.set("client_id", googleClientId);
  redirect.searchParams.set("redirect_uri", `${publicOrigin}/api/auth/google/callback`);
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", "openid email profile");
  redirect.searchParams.set("state", state);
  redirect.searchParams.set("access_type", "offline");
  redirect.searchParams.set("prompt", "select_account");
  redirectResponse(response, redirect.toString());
}

async function handleGoogleCallback(request, response, url) {
  const cookies = parseCookies(request.headers.cookie);
  const expectedState = cookies[oauthStateCookieName];
  const receivedState = url.searchParams.get("state") ?? "";
  if (!expectedState || expectedState !== receivedState) throw new ServiceError(400, "Google OAuth state did not match");
  const code = url.searchParams.get("code") ?? "";
  if (!code) throw new ServiceError(400, "Google OAuth code is missing");

  const token = await fetchFormJson("https://oauth2.googleapis.com/token", {
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: `${publicOrigin}/api/auth/google/callback`,
    grant_type: "authorization_code",
  });
  const accessToken = stringValue(token.access_token);
  if (!accessToken) throw new ServiceError(502, "Google OAuth token response did not include an access token");
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await readUpstreamJson(profileResponse);
  const email = stringValue(profile.email);
  const sub = stringValue(profile.sub);
  if (!email || !sub) throw new ServiceError(502, "Google profile did not include email/sub");
  if (profile.email_verified !== true) throw new ServiceError(403, "Google account email is not verified");
  const user = await upsertGoogleUser({
    sub,
    email,
    name: stringValue(profile.name),
    picture: stringValue(profile.picture),
  });
  const sessionToken = await createSession(user.id);
  setCookie(response, sessionCookieName, sessionToken, { maxAge: 30 * 24 * 60 * 60 });
  setCookie(response, oauthStateCookieName, "", { maxAge: 0 });
  const returnTo = safeReturnPath(cookies[oauthReturnCookieName] || "/");
  setCookie(response, oauthReturnCookieName, "", { maxAge: 0 });
  redirectResponse(response, `${publicOrigin}${returnTo}`);
}

async function handleMockGoogleLogin(response, url) {
  const returnTo = safeReturnPath(url.searchParams.get("returnTo") || "/");
  const user = await upsertGoogleUser({
    sub: getEnv("MIND_ATLAS_STAGING_MOCK_GOOGLE_SUB", "mock-google-staging-user"),
    email: stagingMockEmail,
    name: stagingMockName,
    picture: "",
  });
  const sessionToken = await createSession(user.id);
  setCookie(response, sessionCookieName, sessionToken, { maxAge: 30 * 24 * 60 * 60 });
  redirectResponse(response, `${publicOrigin}${returnTo}`);
}

async function handleBillingCheckout(request, response) {
  const user = await requireUser(request);
  if (stagingMockBilling) {
    sendJson(response, 200, { url: `${publicOrigin}/api/billing/mock-checkout?returnTo=${encodeURIComponent("/?billing=success")}` });
    return;
  }
  if (!stripeSecretKey || !stripePriceId) throw new ServiceError(503, "Stripe Billing is not configured");
  const subscription = await getUserSubscription(user.id);
  const params = {
    mode: "subscription",
    success_url: `${publicOrigin}/?billing=success`,
    cancel_url: `${publicOrigin}/?billing=cancelled`,
    client_reference_id: user.id,
    customer_email: subscription?.stripe_customer_id ? undefined : user.email,
    customer: subscription?.stripe_customer_id,
    "line_items[0][price]": stripePriceId,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][mind_atlas_user_id]": user.id,
    "metadata[mind_atlas_user_id]": user.id,
  };
  const checkout = await stripeFormRequest("/v1/checkout/sessions", compactObject(params));
  sendJson(response, 200, { url: checkout.url });
}

async function handleBillingPortal(request, response) {
  const user = await requireUser(request);
  if (stagingMockBilling) {
    sendJson(response, 200, { url: `${publicOrigin}/?billing=portal-mock` });
    return;
  }
  if (!stripeSecretKey) throw new ServiceError(503, "Stripe Billing is not configured");
  const subscription = await getUserSubscription(user.id);
  if (!subscription?.stripe_customer_id) throw new ServiceError(400, "Stripe customer is not available yet");
  const portal = await stripeFormRequest("/v1/billing_portal/sessions", {
    customer: subscription.stripe_customer_id,
    return_url: `${publicOrigin}${safeReturnPath(stripePortalReturnPath)}`,
  });
  sendJson(response, 200, { url: portal.url });
}

async function handleMockBillingCheckout(request, response, url) {
  if (!stagingMockBilling) throw new ServiceError(404, "Not found");
  const user = await requireUser(request);
  const startedAt = Math.floor(Date.now() / 1000);
  const periodSeconds = readIntEnv("MIND_ATLAS_STAGING_MOCK_PERIOD_SECONDS", 30 * 24 * 60 * 60);
  await upsertSubscriptionByUserId(user.id, {
    stripeCustomerId: `mock_cus_${user.id}`,
    stripeSubscriptionId: `mock_sub_${user.id}`,
    status: "active",
    priceId: stripePriceId || "mock_price_monthly_10_usd",
    currentPeriodStart: new Date(startedAt * 1000).toISOString(),
    currentPeriodEnd: new Date((startedAt + periodSeconds) * 1000).toISOString(),
    cancelAtPeriodEnd: false,
  });
  redirectResponse(response, `${publicOrigin}${safeReturnPath(url.searchParams.get("returnTo") || "/?billing=success")}`);
}

async function handleStripeWebhook(request, response) {
  if (!stripeWebhookSecret) throw new ServiceError(503, "Stripe webhook secret is not configured");
  const rawBody = await readRawBody(request, stripeWebhookMaxBytes);
  verifyStripeSignature(rawBody, request.headers["stripe-signature"] ?? "");
  const event = JSON.parse(rawBody.toString("utf8"));
  const eventId = stringValue(event.id);
  if (eventId) {
    const shouldProcess = await markStripeEventProcessing(eventId, stringValue(event.type));
    if (!shouldProcess) {
      sendJson(response, 200, { received: true, duplicate: true });
      return;
    }
  }
  try {
    await applyStripeEvent(event);
    await markStripeEventProcessed(eventId);
  } catch (error) {
    await forgetStripeEvent(eventId);
    throw error;
  }
  sendJson(response, 200, { received: true });
}

async function handleTextPartnerTurn(request, response) {
  const { user, subscription, credit } = await requireAiEntitlement(request, response);
  const payload = await readJson(request);
  const provider = providerCatalog.find((item) => item.id === stringValue(payload.provider));
  if (!provider) throw new ServiceError(400, "Unknown chat provider");
  if (!provider.configured) throw new ServiceError(503, `${provider.label} is not configured`);
  const model = await resolveProviderModel(provider, payload.model);
  const outputTokenLimit = maxOutputTokensForModel(provider.id, model);
  const requestEstimate = enforceChatRequestLimits({ credit, provider, model, payload, outputTokenLimit });
  const startedAt = Date.now();
  const requestId = `req_${crypto.randomUUID()}`;
  const reservation = await reserveUsageCredit({
    user,
    subscription,
    requestId,
    provider: provider.id,
    model,
    amountMicroUsd: requestEstimate.reservationMicroUsd,
    metadata: {
      kind: "chat",
      estimatedInputTokens: requestEstimate.estimatedInputTokens,
      inputOnlyCost: requestEstimate.inputOnlyCost,
      requestCeiling: requestEstimate.requestCeiling,
      ...(requestEstimate.minimumSettlementMicroUsd ? { minimumSettlementMicroUsd: requestEstimate.minimumSettlementMicroUsd } : {}),
      outputTokenLimit,
      ...(requestEstimate.overageAllowed ? { overageAllowed: requestEstimate.overageAllowed } : {}),
    },
  });
  let result;
  try {
    result = await callProviderToolTurn(provider, { ...payload, model, maxOutputTokens: outputTokenLimit });
  } catch (error) {
    await refundUsageReservation({ user, subscription, reservation, provider: provider.id, model, reason: "chat_upstream_error" });
    throw error;
  }
  const usage = applyMinimumSettlementUsage(
    normalizeUsage(result.raw?.usage, provider.id, result.model, Date.now() - startedAt, payload, result.text),
    requestEstimate.minimumSettlementMicroUsd,
  );
  const account = await meterReservedUsage({
    user,
    subscription,
    requestId,
    provider: provider.id,
    model: result.model,
    usage,
    reservation,
    metadata: {
      kind: "chat",
      requestedModel: model,
      ...(usage.rawEstimatedCostMicroUsd ? { rawEstimatedCostMicroUsd: usage.rawEstimatedCostMicroUsd } : {}),
    },
  });
  sendJson(response, 200, {
    text: result.text,
    toolCalls: result.toolCalls,
    provider: provider.id,
    model: result.model,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostMicroUsd / 1_000_000,
      durationMs: usage.durationMs,
      creditRemainingPercent: creditPercent(account),
    },
  });
}

async function handleRealtimeCall(request, response) {
  const { user, subscription } = await requireAiEntitlement(request, null, { attachConcurrency: false });
  if (!stagingMockProviders && !openAiApiKeyUsable) throw new ServiceError(503, "OpenAI API key is not configured");
  const payload = await readJson(request);
  const startedAt = Date.now();
  const requestId = `rt_${crypto.randomUUID()}`;
  const model = resolveRealtimeModel(payload.model);
  const sdp = stringValue(payload.sdp);
  if (!sdp.trim()) throw new ServiceError(400, "sdp is required");
  const releaseRealtimeSession = enterRealtimeSession(user.id);
  let reservation;
  try {
    reservation = await reserveUsageCredit({
      user,
      subscription,
      requestId,
      provider: "openai",
      model,
      amountMicroUsd: realtimeSessionMicroUsd,
      metadata: { kind: "realtime_session_reservation", maxSessionSeconds: realtimeMaxSessionSeconds, maxOutputTokens: realtimeMaxOutputTokens },
    });
  } catch (error) {
    releaseRealtimeSession();
    throw error;
  }
  if (stagingMockProviders) {
    const account = await meterReservedUsage({
      user,
      subscription,
      requestId,
      provider: "openai",
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostMicroUsd: realtimeSessionMicroUsd,
        durationMs: Date.now() - startedAt,
      },
      reservation,
      metadata: { kind: "realtime_session_reservation", mock: true },
    });
    response.writeHead(200, {
      "Content-Type": "application/sdp",
      "X-Mind-Atlas-Credit-Remaining-Percent": String(Math.round(creditPercent(account))),
      "X-Mind-Atlas-Realtime-Max-Session-Seconds": String(realtimeMaxSessionSeconds),
    });
    response.end(createMockRealtimeSdp());
    releaseRealtimeSession();
    return;
  }
  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set("session", JSON.stringify(buildRealtimeSessionConfig({ ...payload, model })));
  let text;
  try {
    const upstream = await fetch(`${openAiBaseUrl}/realtime/calls`, {
      method: "POST",
      headers: bearerHeaders(openAiApiKey),
      body: formData,
    });
    text = await upstream.text();
    if (!upstream.ok) {
      console.warn("OpenAI Realtime call failed", { status: upstream.status, bodyPreview: text.slice(0, 500) });
      throw new ServiceError(upstream.status, `OpenAI Realtime call failed with ${upstream.status}`);
    }
  } catch (error) {
    releaseRealtimeSession();
    await refundUsageReservation({ user, subscription, reservation, provider: "openai", model, reason: "realtime_upstream_error" });
    throw error;
  }
  const account = await meterReservedUsage({
    user,
    subscription,
    requestId,
    provider: "openai",
    model,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostMicroUsd: realtimeSessionMicroUsd,
      durationMs: Date.now() - startedAt,
    },
    reservation,
    metadata: { kind: "realtime_session_reservation" },
  });
  response.writeHead(200, {
    "Content-Type": "application/sdp",
    "X-Mind-Atlas-Credit-Remaining-Percent": String(Math.round(creditPercent(account))),
    "X-Mind-Atlas-Realtime-Max-Session-Seconds": String(realtimeMaxSessionSeconds),
  });
  response.end(text);
}

async function handleAudioTranscription(request, response) {
  const { user, subscription } = await requireAiEntitlement(request, response);
  if (!stagingMockProviders && !openAiApiKeyUsable) throw new ServiceError(503, "OpenAI API key is not configured");
  const startedAt = Date.now();
  const requestId = `tr_${crypto.randomUUID()}`;
  const formData = await readFormData(request);
  const audio = formData.get("audio");
  if (!audio || typeof audio === "string") throw new ServiceError(400, "audio file is required");
  if (typeof audio.size === "number" && audio.size > 26 * 1024 * 1024) throw new ServiceError(413, "Audio file is too large for transcription");
  if (!isAllowedAudioMimeType(audio.type)) throw new ServiceError(415, "Audio file type is not supported");
  const transcriptionCostMicroUsd = estimateTranscriptionMicroUsd(audio);
  const reservation = await reserveUsageCredit({
    user,
    subscription,
    requestId,
    provider: "openai",
    model: transcriptionModel,
    amountMicroUsd: transcriptionCostMicroUsd,
    metadata: { kind: "audio_transcription", audioSizeBytes: audio.size, audioMimeType: audio.type },
  });
  if (stagingMockProviders) {
    const text = getEnv("MIND_ATLAS_STAGING_MOCK_TRANSCRIPT", "Mock dictation transcript from staging.");
    const usage = {
      inputTokens: 0,
      outputTokens: estimateTokens(text),
      totalTokens: estimateTokens(text),
      estimatedCostMicroUsd: transcriptionCostMicroUsd,
      durationMs: Date.now() - startedAt,
    };
    const account = await meterReservedUsage({
      user,
      subscription,
      requestId,
      provider: "openai",
      model: transcriptionModel,
      usage,
      reservation,
      metadata: { kind: "audio_transcription", audioSizeBytes: audio.size, audioMimeType: audio.type, mock: true },
    });
    sendJson(response, 200, {
      text,
      model: transcriptionModel,
      durationMs: usage.durationMs,
      audioSizeBytes: audio.size,
      audioMimeType: audio.type,
      creditRemainingPercent: creditPercent(account),
    });
    return;
  }
  const upstreamForm = new FormData();
  upstreamForm.set("model", transcriptionModel);
  upstreamForm.set("file", audio, audio.name || "dictation.webm");
  let data;
  try {
    const upstream = await fetch(`${openAiBaseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: bearerHeaders(openAiApiKey),
      body: upstreamForm,
    });
    data = await readUpstreamJson(upstream);
  } catch (error) {
    await refundUsageReservation({ user, subscription, reservation, provider: "openai", model: transcriptionModel, reason: "transcription_upstream_error" });
    throw error;
  }
  const usage = {
    inputTokens: 0,
    outputTokens: estimateTokens(data.text),
    totalTokens: estimateTokens(data.text),
    estimatedCostMicroUsd: transcriptionCostMicroUsd,
    durationMs: Date.now() - startedAt,
  };
  const account = await meterReservedUsage({
    user,
    subscription,
    requestId,
    provider: "openai",
    model: transcriptionModel,
    usage,
    reservation,
    metadata: { kind: "audio_transcription", audioSizeBytes: audio.size, audioMimeType: audio.type },
  });
  sendJson(response, 200, {
    text: stringValue(data.text),
    model: transcriptionModel,
    durationMs: usage.durationMs,
    audioSizeBytes: audio.size,
    audioMimeType: audio.type,
    creditRemainingPercent: creditPercent(account),
  });
}

async function handleWebSearch(request, response) {
  const { user, subscription } = await requireAiEntitlement(request, response);
  if (!stagingMockProviders && !openAiApiKeyUsable) throw new ServiceError(503, "OpenAI API key is not configured");
  const startedAt = Date.now();
  const requestId = `ws_${crypto.randomUUID()}`;
  const payload = await readJson(request);
  const query = stringValue(payload.query).trim();
  if (!query) throw new ServiceError(400, "query is required");
  if (query.length > webSearchQueryMaxChars) throw new ServiceError(413, "Web search query is too large");
  const webSearchModel = getEnv("MIND_ATLAS_WEB_SEARCH_MODEL", stagingMockProviders ? "mock-web-search" : "gpt-4.1-mini");
  const webSearchMaxOutputTokens = readIntEnv("MIND_ATLAS_WEB_SEARCH_MAX_OUTPUT_TOKENS", 2048);
  const webSearchReserveMicroUsd = stagingMockProviders
    ? webSearchMinMicroUsd
    : Math.max(webSearchMinMicroUsd, estimateCostMicroUsd("openai", webSearchModel, estimateTokens(query), webSearchMaxOutputTokens));
  const queryMetadata = createPrivateQueryMetadata(query);
  const reservation = await reserveUsageCredit({
    user,
    subscription,
    requestId,
    provider: "openai",
    model: webSearchModel,
    amountMicroUsd: webSearchReserveMicroUsd,
    metadata: { kind: "web_search", ...queryMetadata },
  });
  if (stagingMockProviders) {
    const model = webSearchModel;
    const text = `Mock web search result for: ${query}`;
    const usage = applyMinimumEstimatedCost(
      normalizeUsage(null, "openai", model, Date.now() - startedAt, payload, text),
      webSearchMinMicroUsd,
    );
    const account = await meterReservedUsage({
      user,
      subscription,
      requestId,
      provider: "openai",
      model,
      usage,
      reservation,
      metadata: { kind: "web_search", ...queryMetadata, mock: true },
    });
    sendJson(response, 200, {
      text,
      citations: [{ title: "Mock source", url: "https://example.test/mind-atlas-staging" }],
      sources: [{ title: "Mock source", url: "https://example.test/mind-atlas-staging" }],
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostMicroUsd / 1_000_000,
        durationMs: usage.durationMs,
        creditRemainingPercent: creditPercent(account),
      },
    });
    return;
  }
  let data;
  try {
    const upstream = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: bearerHeaders(openAiApiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: webSearchModel,
        tools: [{ type: "web_search" }],
        input: query,
        max_output_tokens: webSearchMaxOutputTokens,
      }),
    });
    data = await readUpstreamJson(upstream);
  } catch (error) {
    await refundUsageReservation({ user, subscription, reservation, provider: "openai", model: webSearchModel, reason: "web_search_upstream_error" });
    throw error;
  }
  const text = extractResponseText(data);
  const resultModel = stringValue(data.model) || webSearchModel;
  const usage = applyMinimumEstimatedCost(
    normalizeUsage(data.usage, "openai", resultModel, Date.now() - startedAt, payload, text),
    webSearchMinMicroUsd,
  );
  const account = await meterReservedUsage({
    user,
    subscription,
    requestId,
    provider: "openai",
    model: resultModel,
    usage,
    reservation,
    metadata: { kind: "web_search", ...queryMetadata },
  });
  sendJson(response, 200, {
    text,
    citations: extractResponseCitations(data),
    sources: extractResponseCitations(data),
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostMicroUsd / 1_000_000,
      durationMs: usage.durationMs,
      creditRemainingPercent: creditPercent(account),
    },
  });
}

async function callProviderToolTurn(provider, payload) {
  if (stagingMockProviders) return createMockProviderToolTurn(provider, payload);
  if (provider.kind === "anthropic") return await callAnthropicToolTurn(provider, payload);
  return await callOpenAiCompatibleToolTurn(provider, payload);
}

function createMockProviderToolTurn(provider, payload) {
  const model = stringValue(payload.model) || provider.defaultModel;
  const userText = Array.isArray(payload.messages)
    ? payload.messages.map((message) => message?.role === "user" ? stringValue(message.content) : "").filter(Boolean).at(-1) ?? ""
    : "";
  const text = `[staging:${provider.id}] ${provider.label} mock reply for "${userText.slice(0, 120) || "Mind Atlas request"}"`;
  const inputTokens = estimateTokens(JSON.stringify(payload.messages ?? "") + JSON.stringify(payload.context ?? ""));
  const outputTokens = estimateTokens(text);
  return {
    text,
    toolCalls: [],
    model,
    raw: {
      model,
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
  };
}

async function callOpenAiCompatibleToolTurn(provider, payload) {
  const model = stringValue(payload.model) || provider.defaultModel;
  const tools = normalizeChatTools(payload.tools);
  const outputTokenLimit = readPayloadMaxOutputTokens(payload);
  const body = {
    model,
    messages: [
      { role: "system", content: buildPartnerSystemPrompt(payload) },
      ...buildChatMessages(payload.messages),
    ],
  };
  if (usesChatCompletionsMaxCompletionTokens(provider, model)) {
    body.max_completion_tokens = outputTokenLimit;
  } else {
    body.max_tokens = outputTokenLimit;
  }
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  applyReasoningEffort(body, payload.reasoningEffort);
  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: bearerHeaders(provider.apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const raw = await readUpstreamJson(upstream);
  return {
    text: extractAssistantText(raw),
    toolCalls: extractChatToolCalls(raw),
    model: stringValue(raw.model) || model,
    raw,
  };
}

async function callAnthropicToolTurn(provider, payload) {
  const model = stringValue(payload.model) || provider.defaultModel;
  const tools = normalizeAnthropicTools(payload.tools);
  const outputTokenLimit = readPayloadMaxOutputTokens(payload);
  const body = {
    model,
    system: buildPartnerSystemPrompt(payload),
    max_tokens: outputTokenLimit,
    messages: buildAnthropicMessages(payload.messages),
  };
  if (tools.length) body.tools = tools;
  const upstream = await fetch(anthropicEndpoint(provider.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const raw = await readUpstreamJson(upstream);
  return {
    text: extractAnthropicText(raw),
    toolCalls: extractAnthropicToolCalls(raw),
    model: stringValue(raw.model) || model,
    raw,
  };
}

function buildPartnerSystemPrompt(payload) {
  // Prefer the client context engine's compact markdown context; fall back to
  // the legacy JSON dump for older cached browser bundles.
  const contextText = stringValue(payload.contextText).trim();
  const contextBlock = contextText
    ? `Current Mind Atlas notebook context:\n${contextText.slice(0, 48000)}`
    : `Current Mind Atlas context:\n${JSON.stringify(payload.context ?? {}, null, 2).slice(0, 24000)}`;
  return [
    "You are Mind Atlas AI Partner.",
    "Mind Atlas is a local-first spatial tree notebook made of celestial nodes.",
    "Use the provided Mind Atlas context and tools. Notebook edit tools execute directly when available; file-picker actions cannot be performed through this API.",
    "Keep replies concise. After tool use, briefly say what changed.",
    payload.summary?.text ? `Previous session summary:\n${payload.summary.text}` : "",
    payload.voiceLogContext ? `Recent AI Partner log:\n${payload.voiceLogContext}` : "",
    contextBlock,
  ].filter(Boolean).join("\n\n");
}

function buildRealtimeSessionConfig(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + realtimeMaxSessionSeconds;
  return {
    type: "realtime",
    model: stringValue(payload.model) || realtimeModel,
    instructions: buildPartnerSystemPrompt(payload),
    expires_at: expiresAt,
    max_output_tokens: realtimeMaxOutputTokens,
    audio: {
      input: {
        transcription: {
          model: realtimeTranscriptionModel,
        },
      },
      output: {
        voice: stringValue(payload.voice) || realtimeVoice,
      },
    },
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    tool_choice: "auto",
  };
}

async function createSessionResponse(user) {
  const { subscription, credit, entitlement } = await buildEntitlement(user);
  return {
    publicService: true,
    authenticated: Boolean(user),
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          pictureUrl: user.picture_url,
          role: user.role === "admin" ? "admin" : "user",
        }
      : null,
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start?.toISOString?.() ?? subscription.current_period_start ?? undefined,
          currentPeriodEnd: subscription.current_period_end?.toISOString?.() ?? subscription.current_period_end ?? undefined,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        }
      : null,
    credit: credit
      ? {
          periodKey: credit.period_key,
          remainingPercent: creditPercent(credit),
          limitPercent: 100,
          exhausted: Number(credit.credit_remaining_micro_usd) <= 0,
          updatedAt: credit.updated_at?.toISOString?.() ?? credit.updated_at ?? undefined,
        }
      : null,
    entitlement,
    chatOptions: await createChatOptionsResponse(),
  };
}

async function authenticate(request) {
  const token = parseCookies(request.headers.cookie)[sessionCookieName];
  return await getSessionUser(token, sessionIdleDays);
}

async function requireUser(request) {
  const user = await authenticate(request);
  if (!user) throw new ServiceError(401, "Google login is required");
  return user;
}

async function requireAiEntitlement(request, response = null, options = {}) {
  const user = await requireUser(request);
  enforceUserRateLimit(user.id, "ai", userAiRateLimitMax);
  const { subscription, credit, entitlement } = await buildEntitlement(user);
  if (!isSubscriptionActive(subscription)) throw new ServiceError(402, "Subscription is required for AI features");
  if (entitlement.reason === "billing_period_unavailable") {
    throw new ServiceError(409, "Subscription billing period is unavailable");
  }
  if (!entitlement.aiEnabled || Number(credit?.credit_remaining_micro_usd ?? 0) <= 0) {
    throw new ServiceError(402, "Mind Atlas token for this billing period is exhausted");
  }
  if (options.attachConcurrency !== false && response) {
    attachReleaseOnResponse(response, enterUserConcurrency(`ai:${user.id}`, userAiConcurrentRequests));
  }
  return { user, subscription, credit };
}

async function createChatOptionsResponse() {
  const services = await Promise.all(providerCatalog.map(async (provider) => {
    const modelList = await getProviderModelList(provider);
    return {
      id: provider.id,
      label: provider.label,
      configured: provider.configured,
      defaultModel: modelList.defaultModel,
      defaultReasoningEffort: provider.defaultReasoningEffort,
      supportedReasoningEfforts: provider.supportedReasoningEfforts,
      models: modelList.models.map((model) => ({
        model,
        displayName: modelDisplayName(provider, model),
        pricing: publicModelPricing(provider.id, model),
        defaultReasoningEffort: provider.defaultReasoningEffort,
        supportedReasoningEfforts: provider.supportedReasoningEfforts,
      })),
      detail: provider.configured
        ? providerModelDetail(provider, modelList)
        : `${provider.label} key not configured`,
    };
  }));
  return {
    defaultService: services.find((service) => service.id === "openai" && service.configured)?.id
      ?? services.find((service) => service.configured)?.id
      ?? "openai",
    services,
  };
}

function createProviderCatalog() {
  return [
    provider("openai", "OpenAI", "openai-compatible", "MIND_ATLAS_OPENAI", openAiBaseUrl, ["gpt-4.1-mini", "gpt-4.1"], ["none"], "none", openAiApiKey),
    provider("anthropic", "Anthropic", "anthropic", "MIND_ATLAS_ANTHROPIC", "https://api.anthropic.com", ["claude-sonnet-4-5", "claude-opus-4-1"], ["default", "low", "medium", "high", "max"], "default"),
    provider("glm", "GLM", "openai-compatible", "MIND_ATLAS_GLM", "https://open.bigmodel.cn/api/paas/v4", ["glm-4.5", "glm-4.5-air"]),
    provider("deepseek", "DeepSeek", "openai-compatible", "MIND_ATLAS_DEEPSEEK", "https://api.deepseek.com/v1", ["deepseek-chat", "deepseek-reasoner"]),
    provider("gemini", "Gemini", "openai-compatible", "MIND_ATLAS_GEMINI", "https://generativelanguage.googleapis.com/v1beta/openai", ["gemini-2.5-flash", "gemini-2.5-pro"]),
    provider("qwen", "Qwen", "openai-compatible", "MIND_ATLAS_QWEN", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", ["qwen-plus", "qwen-max"]),
    provider("composer", "Composer", "openai-compatible", "MIND_ATLAS_COMPOSER", "", ["composer"]),
    provider("kimi", "Kimi", "openai-compatible", "MIND_ATLAS_KIMI", "https://api.moonshot.ai/v1", ["kimi-k2", "moonshot-v1-32k"]),
    provider("mimo", "Mimo", "openai-compatible", "MIND_ATLAS_MIMO", "", ["mimo-chat"]),
    provider("minimax", "MiniMax", "openai-compatible", "MIND_ATLAS_MINIMAX", "https://api.minimax.io/v1", ["MiniMax-M1", "abab6.5s-chat"]),
    provider("grok", "Grok", "openai-compatible", "MIND_ATLAS_GROK", "https://api.x.ai/v1", ["grok-4", "grok-3"]),
  ];
}

function provider(id, label, kind, envPrefix, fallbackBaseUrl, fallbackModels, supportedReasoningEfforts = ["default", "none", "low", "medium", "high"], defaultReasoningEffort = "default", overrideApiKey = "") {
  const apiKey = overrideApiKey || getProviderApiKey(id, envPrefix);
  const baseUrl = getEnv(`${envPrefix}_BASE_URL`, fallbackBaseUrl).replace(/\/+$/, "");
  const parsedModels = parseProviderModels(id, envPrefix, fallbackModels);
  const models = parsedModels.models;
  const defaultModel = getEnv(`${envPrefix}_MODEL`, models[0] ?? "");
  return {
    id,
    label,
    kind,
    apiKey,
    baseUrl,
    envPrefix,
    fallbackModels,
    models: models.length ? models : [defaultModel].filter(Boolean),
    modelsFromEnv: parsedModels.fromEnv,
    defaultModel,
    configured: stagingMockProviders || Boolean(isUsableServiceSecret(apiKey) && (kind === "anthropic" || baseUrl)),
    supportedReasoningEfforts,
    defaultReasoningEffort,
  };
}

async function resolveProviderModel(provider, requestedModel) {
  const modelList = await getProviderModelList(provider);
  const model = stringValue(requestedModel) || modelList.defaultModel;
  if (!model) throw new ServiceError(503, `${provider.label} has no enabled model`);
  if (!modelList.models.includes(model)) {
    throw new ServiceError(400, `${model} is not enabled for ${provider.label}`);
  }
  return model;
}

function resolveRealtimeModel(requestedModel) {
  const model = stringValue(requestedModel) || realtimeModel;
  const allowedModels = parseListEnv("MIND_ATLAS_REALTIME_MODELS", [realtimeModel]);
  if (!allowedModels.includes(model)) throw new ServiceError(400, `${model} is not enabled for Realtime Talk`);
  return model;
}

function getProviderApiKey(id, envPrefix) {
  const direct = getEnv(`${envPrefix}_API_KEY`);
  if (direct) return direct;
  if (id === "openai") return getEnv("OPENAI_API_KEY");
  if (id === "anthropic") return getEnv("ANTHROPIC_API_KEY", getEnv("MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY"));
  if (id === "deepseek") return getEnv("MIND_ATLAS_DEEPSEEK_AUTH_TOKEN", getEnv("DEEPSEEK_API_KEY", getEnv("MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN")));
  return "";
}

function isUsableServiceSecret(value) {
  const normalized = stringValue(value).trim();
  if (!normalized) return false;
  if (/^(mock|placeholder)$/i.test(normalized)) return false;
  if (/^(replace-with|your-)/i.test(normalized)) return false;
  if (/^\.+$/.test(normalized)) return false;
  return true;
}

function parseProviderModels(id, envPrefix, fallbackModels) {
  const direct = parseListEnv(`${envPrefix}_MODELS`, []);
  if (direct.length) return { models: direct, fromEnv: true };
  if (id === "openai") {
    const chatModels = parseListEnv("MIND_ATLAS_OPENAI_CHAT_MODELS", []);
    if (chatModels.length) return { models: chatModels, fromEnv: true };
  }
  return { models: fallbackModels, fromEnv: false };
}

async function getProviderModelList(provider, options = {}) {
  const localModels = localProviderModels(provider);
  if (!provider.configured || stagingMockProviders || !providerModelFetchEnabled) {
    const source = stagingMockProviders ? "mock" : "configured";
    return {
      models: localModels,
      defaultModel: selectDefaultProviderModel(provider, localModels),
      source,
      fetchedCount: localModels.length,
      hiddenUnpricedCount: 0,
    };
  }

  const cacheKey = `${provider.id}:${provider.kind}:${provider.baseUrl}`;
  const cached = providerModelCache.get(cacheKey);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const fetched = await fetchProviderModelIds(provider);
    const filtered = await filterProviderModelIds(provider, fetched);
    if (!filtered.length) {
      throw new Error(`${provider.label} did not return chat-capable models`);
    }
    const models = orderProviderModels(provider, filtered);
    const value = {
      models,
      defaultModel: selectDefaultProviderModel(provider, models),
      source: "live",
      fetchedCount: filtered.length,
      hiddenUnpricedCount: Math.max(0, filtered.length - models.length),
    };
    cacheProviderModels(cacheKey, value);
    return value;
  } catch (error) {
    const value = {
      models: localModels,
      defaultModel: selectDefaultProviderModel(provider, localModels),
      source: "fallback",
      error: sanitizeProviderError(error),
      fetchedCount: 0,
      hiddenUnpricedCount: 0,
    };
    cacheProviderModels(cacheKey, value, Math.min(providerModelCacheMs, 60_000));
    return value;
  }
}

function scheduleProviderModelRefresh() {
  if (!providerModelFetchEnabled || stagingMockProviders || providerModelRefreshMs <= 0) return;
  const refresh = async () => {
    const configuredProviders = providerCatalog.filter((provider) => provider.configured);
    await Promise.allSettled(configuredProviders.map((provider) => getProviderModelList(provider, { force: true })));
  };
  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, providerModelRefreshMs);
  timer.unref?.();
}

function cacheProviderModels(cacheKey, value, ttlMs = providerModelCacheMs) {
  if (ttlMs <= 0) return;
  providerModelCache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchProviderModelIds(provider) {
  const url = provider.kind === "anthropic"
    ? anthropicEndpoint(provider.baseUrl, "/v1/models")
    : `${provider.baseUrl}/models`;
  const headers = provider.kind === "anthropic"
    ? {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      }
    : bearerHeaders(provider.apiKey);
  const response = await fetchWithTimeout(url, { method: "GET", headers });
  const raw = await readUpstreamJson(response);
  return extractProviderModelIds(raw);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerModelFetchTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function extractProviderModelIds(raw) {
  const data = Array.isArray(raw?.data) ? raw.data : [];
  return uniqueStrings(data.map((item) => stringValue(item?.id))).filter(Boolean);
}

async function filterProviderModelIds(provider, models) {
  const filtered = uniqueStrings(models).filter((model) => !isPlaceholderModel(model));
  if (provider.id === "openai") return filtered.filter(isOpenAiChatModel);
  if (provider.id === "anthropic") {
    const anthropicModels = filtered.filter((model) => {
      const normalized = model.toLowerCase();
      return normalized.startsWith("claude-");
    });
    return await filterActuallyAvailableAnthropicModels(provider, anthropicModels);
  }
  if (provider.id === "deepseek") return filtered.filter((model) => model.toLowerCase().startsWith("deepseek-"));
  return filtered;
}

async function filterActuallyAvailableAnthropicModels(provider, models) {
  const output = [];
  for (const model of models) {
    if (!requiresAnthropicAvailabilityProbe(model)) {
      output.push(model);
      continue;
    }
    if (await probeAnthropicModelAvailability(provider, model)) output.push(model);
  }
  return output;
}

function requiresAnthropicAvailabilityProbe(model) {
  const normalized = model.toLowerCase();
  return normalized.startsWith("claude-fable-5") || normalized.startsWith("claude-mythos-5");
}

async function probeAnthropicModelAvailability(provider, model) {
  const cacheKey = `${provider.id}:${model}`;
  const cached = providerModelAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.available;
  try {
    const response = await fetchWithTimeout(anthropicEndpoint(provider.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "OK" }],
      }),
    });
    const text = await response.text();
    const unavailable = isAnthropicModelUnavailable(text);
    const available = response.ok || !unavailable;
    const ttl = unavailable ? Math.min(providerModelRefreshMs, 5 * 60 * 1000) : providerModelCacheMs;
    providerModelAvailabilityCache.set(cacheKey, { available, expiresAt: Date.now() + Math.max(30_000, ttl) });
    return available;
  } catch {
    return true;
  }
}

function isAnthropicModelUnavailable(text) {
  return /not available|not have access|use opus|fable.*access|mythos.*access/i.test(stringValue(text));
}

function isOpenAiChatModel(model) {
  const normalized = model.toLowerCase();
  if (!/^(gpt-|chatgpt-)/.test(normalized)) return false;
  return ![
    "audio",
    "dall-e",
    "embedding",
    "image",
    "instruct",
    "moderation",
    "realtime",
    "search",
    "transcribe",
    "tts",
    "whisper",
  ].some((blocked) => normalized.includes(blocked));
}

function orderProviderModels(provider, fetchedModels) {
  const preferred = localProviderModels(provider).filter((model) => fetchedModels.includes(model));
  const output = [...preferred, ...fetchedModels.filter((model) => !preferred.includes(model))];
  const priced = modelPricePolicy === "require-model"
    ? output.filter((model) => hasExactModelPrice(provider.id, model))
    : output;
  return uniqueStrings(priced).slice(0, Math.max(1, providerModelMaxCount));
}

function localProviderModels(provider) {
  const configured = uniqueStrings(provider.models).filter((model) => !isPlaceholderModel(model));
  if (configured.length) return filterPricedProviderModels(provider, configured);
  const fallback = uniqueStrings(provider.fallbackModels).filter((model) => !isPlaceholderModel(model));
  if (fallback.length) return filterPricedProviderModels(provider, fallback);
  return filterPricedProviderModels(provider, uniqueStrings(provider.models).filter(Boolean));
}

function filterPricedProviderModels(provider, models) {
  if (modelPricePolicy !== "require-model") return models;
  return models.filter((model) => hasExactModelPrice(provider.id, model));
}

function selectDefaultProviderModel(provider, models) {
  const preferred = [
    stringValue(provider.defaultModel),
    ...localProviderModels(provider),
  ].filter((model) => model && !isPlaceholderModel(model));
  for (const model of preferred) {
    if (models.includes(model)) return model;
  }
  return models[0] ?? "";
}

function providerModelDetail(provider, modelList) {
  if (modelList.source === "live") {
    const policyNote = modelPricePolicy === "require-model" ? " priced" : "";
    const hiddenNote = modelList.hiddenUnpricedCount ? `; ${modelList.hiddenUnpricedCount} unpriced models hidden` : "";
    return `${provider.label} key configured; ${modelList.models.length}${policyNote} models fetched${hiddenNote}`;
  }
  if (modelList.source === "fallback") {
    return `${provider.label} key configured; model fetch fallback: ${modelList.error}`;
  }
  return `${provider.label} key configured; ${modelList.models.length} configured models`;
}

function publicModelPricing(providerId, model) {
  const price = resolveExactModelPrice(modelPrices, providerId, model);
  if (!price) return undefined;
  return {
    inputUsdPer1M: Number(price.inputUsdPer1M),
    outputUsdPer1M: Number(price.outputUsdPer1M),
  };
}

function modelDisplayName(provider, model) {
  if (provider.id === "anthropic" && model.startsWith("claude-fable-5")) return "Claude Fable 5";
  if (provider.id === "anthropic" && model.startsWith("claude-mythos-5")) return "Claude Mythos 5";
  if (provider.id === "anthropic" && model.startsWith("claude-opus-4-8")) return "Claude Opus 4.8";
  if (provider.id === "anthropic" && model.startsWith("claude-opus-4-1")) return "Claude Opus 4.1";
  if (provider.id === "anthropic" && model.startsWith("claude-sonnet-5")) return "Claude Sonnet 5";
  if (provider.id === "anthropic" && model.startsWith("claude-haiku-4-5")) return "Claude Haiku 4.5";
  return model;
}

function isFable5ChatModel(providerId, model) {
  return providerId === "anthropic" && stringValue(model).toLowerCase().startsWith("claude-fable-5");
}

function sanitizeProviderError(error) {
  if (error?.name === "AbortError") return "model list request timed out";
  return stringValue(error?.message || error)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-...")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ...")
    .replace(/\s+/g, " ")
    .slice(0, 240) || "model list request failed";
}

function isPlaceholderModel(value) {
  return /staging|mock|placeholder|replace-with|your-/i.test(stringValue(value));
}

function hasExactModelPrice(providerId, model) {
  return hasModelPrice(modelPrices, providerId, model);
}

function anthropicEndpoint(baseUrl, endpoint) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const pathPart = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (normalized.endsWith("/v1") && pathPart.startsWith("/v1/")) {
    return `${normalized}${pathPart.slice(3)}`;
  }
  return `${normalized}${pathPart}`;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => stringValue(value).trim()).filter(Boolean))];
}

function buildChatMessages(messages) {
  return Array.isArray(messages)
    ? messages.map((message) => {
        if (message?.role === "tool") {
          return {
            role: "tool",
            tool_call_id: stringValue(message.toolCallId),
            name: stringValue(message.name),
            content: stringValue(message.content),
          };
        }
        return {
          role: message?.role === "assistant" ? "assistant" : "user",
          content: stringValue(message?.content),
          ...(Array.isArray(message?.toolCalls) && message.toolCalls.length
            ? { tool_calls: message.toolCalls.map((call) => ({ id: call.callId, type: "function", function: { name: call.name, arguments: call.arguments } })) }
            : {}),
        };
      })
    : [];
}

function buildAnthropicMessages(messages) {
  const output = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === "assistant") {
      const content = [];
      const text = stringValue(message.content);
      if (text) content.push({ type: "text", text });
      for (const call of Array.isArray(message.toolCalls) ? message.toolCalls : []) {
        content.push({ type: "tool_use", id: stringValue(call.callId), name: stringValue(call.name), input: safeJsonParse(call.arguments, {}) });
      }
      output.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
      continue;
    }
    if (message?.role === "tool") {
      output.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: stringValue(message.toolCallId), content: stringValue(message.content) }],
      });
      continue;
    }
    output.push({ role: "user", content: stringValue(message?.content) });
  }
  return output;
}

function normalizeChatTools(tools) {
  return Array.isArray(tools)
    ? tools.map((tool) => ({
        type: "function",
        function: {
          name: stringValue(tool.name),
          description: stringValue(tool.description),
          parameters: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
        },
      }))
    : [];
}

function normalizeAnthropicTools(tools) {
  return Array.isArray(tools)
    ? tools.map((tool) => ({
        name: stringValue(tool.name),
        description: stringValue(tool.description),
        input_schema: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
      }))
    : [];
}

function extractAssistantText(raw) {
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
  return "";
}

function extractChatToolCalls(raw) {
  const calls = raw?.choices?.[0]?.message?.tool_calls;
  return Array.isArray(calls)
    ? calls.map((call) => ({
        name: stringValue(call?.function?.name),
        arguments: typeof call?.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call?.function?.arguments ?? {}),
        callId: stringValue(call?.id),
      })).filter((call) => call.name)
    : [];
}

function extractAnthropicText(raw) {
  return Array.isArray(raw?.content)
    ? raw.content.map((item) => item?.type === "text" && typeof item.text === "string" ? item.text : "").join("")
    : "";
}

function extractAnthropicToolCalls(raw) {
  return Array.isArray(raw?.content)
    ? raw.content.filter((item) => item?.type === "tool_use").map((item) => ({
        name: stringValue(item.name),
        arguments: JSON.stringify(item.input ?? {}),
        callId: stringValue(item.id),
      }))
    : [];
}

function normalizeUsage(rawUsage, providerId, model, durationMs, payload, text) {
  const inputTokens = numberValue(rawUsage?.prompt_tokens) ?? numberValue(rawUsage?.input_tokens) ?? estimateTokens(JSON.stringify(payload?.messages ?? "") + JSON.stringify(payload?.context ?? ""));
  const outputTokens = numberValue(rawUsage?.completion_tokens) ?? numberValue(rawUsage?.output_tokens) ?? estimateTokens(text);
  const totalTokens = numberValue(rawUsage?.total_tokens) ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostMicroUsd: estimateCostMicroUsd(providerId, model, inputTokens, outputTokens),
    durationMs,
  };
}

function applyMinimumEstimatedCost(usage, minimumMicroUsd) {
  return {
    ...usage,
    estimatedCostMicroUsd: Math.max(Number(usage.estimatedCostMicroUsd ?? 0), Math.max(0, Number(minimumMicroUsd ?? 0))),
  };
}

function applyMinimumSettlementUsage(usage, minimumMicroUsd) {
  const minimum = Math.max(0, Math.round(Number(minimumMicroUsd ?? 0)));
  if (minimum <= 0) return usage;
  const estimatedCostMicroUsd = Math.max(1, Math.round(Number(usage.estimatedCostMicroUsd ?? 1)));
  if (estimatedCostMicroUsd >= minimum) return usage;
  return {
    ...usage,
    estimatedCostMicroUsd: minimum,
    rawEstimatedCostMicroUsd: estimatedCostMicroUsd,
  };
}

function enforceChatRequestLimits({ credit, provider, model, payload, outputTokenLimit = maxOutputTokens }) {
  const estimatedChars = estimateChatInputChars(payload);
  if (estimatedChars > chatInputMaxChars) {
    throw new ServiceError(413, "Chat request is too large for hosted service mode");
  }

  const fable5OnePass = isFable5ChatModel(provider.id, model);
  const estimatedInputTokens = Math.max(1, Math.ceil(estimatedChars / chatReserveCharsPerToken));
  const inputOnlyCost = estimateCostMicroUsd(provider.id, model, estimatedInputTokens, 0);
  const remaining = Number(credit?.credit_remaining_micro_usd ?? 0);
  if (inputOnlyCost > remaining) {
    throw new ServiceError(402, "Mind Atlas token for this billing period is too low for this request");
  }

  const requestCeiling = estimateCostMicroUsd(provider.id, model, estimatedInputTokens, outputTokenLimit);
  if (maxRequestEstimateMicroUsd > 0 && requestCeiling > maxRequestEstimateMicroUsd) {
    throw new ServiceError(413, "Chat request exceeds the hosted service per-request safety limit");
  }
  return {
    estimatedInputTokens,
    inputOnlyCost,
    requestCeiling,
    reservationMicroUsd: fable5OnePass ? Math.max(1, Math.round(remaining)) : requestCeiling,
    minimumSettlementMicroUsd: fable5OnePass ? Math.max(1, Math.round(remaining)) : undefined,
    overageAllowed: fable5OnePass ? "fable5_one_pass" : undefined,
  };
}

function readPayloadMaxOutputTokens(payload) {
  const requested = Number(payload?.maxOutputTokens);
  if (Number.isFinite(requested) && requested > 0) return Math.min(maxOutputTokens, Math.trunc(requested));
  return maxOutputTokens;
}

function maxOutputTokensForModel(providerId, model) {
  if (!Number.isFinite(highCostOutputUsdPer1m) || highCostOutputUsdPer1m <= 0) return maxOutputTokens;
  const price = resolveModelPrice(providerId, model);
  const outputRate = Number(price.outputUsdPer1M);
  if (!Number.isFinite(outputRate) || outputRate < highCostOutputUsdPer1m) return maxOutputTokens;
  return Math.max(1, Math.min(maxOutputTokens, highCostMaxOutputTokens));
}

function estimateChatInputChars(payload) {
  return stringValue(payload?.messages ? JSON.stringify(payload.messages) : "").length
    + stringValue(payload?.context ? JSON.stringify(payload.context) : "").length
    + stringValue(payload?.contextText).length
    + stringValue(payload?.tools ? JSON.stringify(payload.tools) : "").length
    + stringValue(payload?.summary ? JSON.stringify(payload.summary) : "").length
    + stringValue(payload?.voiceLogContext).length;
}

async function reserveUsageCredit({ user, subscription, requestId, provider, model, amountMicroUsd, metadata = {} }) {
  const reservedMicroUsd = Math.max(1, Math.round(amountMicroUsd ?? 1));
  const account = await reserveCredit({
    userId: user.id,
    subscription,
    amountMicroUsd: reservedMicroUsd,
    requestId,
    metadata: { provider, model, reservedMicroUsd, ...metadata },
  });
  if (!account) throw new ServiceError(402, "Mind Atlas token for this billing period is too low for this request");
  return { requestId, reservedMicroUsd, provider, model, metadata };
}

async function refundUsageReservation({ user, subscription, reservation, provider, model, reason }) {
  if (!reservation) return;
  try {
    await settleCreditReservation({
      userId: user.id,
      subscription,
      requestId: reservation.requestId,
      reservedMicroUsd: reservation.reservedMicroUsd,
      actualMicroUsd: 0,
      metadata: {
        provider,
        model,
        reservedMicroUsd: reservation.reservedMicroUsd,
        refundReason: reason,
        ...reservation.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to refund Mind Atlas credit reservation", error);
  }
}

async function meterReservedUsage({ user, subscription, requestId, provider, model, usage, reservation, metadata = {} }) {
  const estimatedCostMicroUsd = Math.max(1, Math.round(usage.estimatedCostMicroUsd ?? 1));
  const account = await settleCreditReservation({
    userId: user.id,
    subscription,
    reservedMicroUsd: reservation.reservedMicroUsd,
    actualMicroUsd: estimatedCostMicroUsd,
    requestId,
    metadata: {
      provider,
      model,
      reservedMicroUsd: reservation.reservedMicroUsd,
      ...reservation.metadata,
      ...metadata,
    },
  });
  await recordUsageEvent({
    userId: user.id,
    requestId,
    provider,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    estimatedCostMicroUsd,
    creditSpentMicroUsd: estimatedCostMicroUsd,
    durationMs: usage.durationMs ?? null,
  });
  return account;
}

function estimateCostMicroUsd(providerId, model, inputTokens, outputTokens) {
  const price = resolveModelPrice(providerId, model);
  const inputRate = Number(price.inputUsdPer1M);
  const outputRate = Number(price.outputUsdPer1M);
  return Math.max(1, Math.ceil(((inputTokens * inputRate) + (outputTokens * outputRate)) / 1_000_000 * 1_000_000));
}

function resolveModelPrice(providerId, model) {
  const providerKey = `${providerId}:*`;
  const exactPrice = resolveExactModelPrice(modelPrices, providerId, model);
  const providerPrice = modelPrices[providerKey];
  if (modelPricePolicy === "require-model" && !exactPrice) {
    throw new ServiceError(503, `Pricing is not configured for ${providerId}:${model}`);
  }
  if ((modelPricePolicy === "require-provider" || modelPricePolicy === "require-model") && !exactPrice && !providerPrice) {
    throw new ServiceError(503, `Pricing is not configured for ${providerId}`);
  }
  const price = exactPrice ?? providerPrice ?? {};
  return {
    inputUsdPer1M: Number(price.inputUsdPer1M ?? defaultInputUsdPer1m),
    outputUsdPer1M: Number(price.outputUsdPer1M ?? defaultOutputUsdPer1m),
  };
}

function estimateTranscriptionMicroUsd(audio) {
  const size = typeof audio?.size === "number" ? audio.size : 0;
  // WebM/Opus browser recordings are commonly tens of kbps. This rough
  // duration estimate keeps hosted dictation from becoming unmetered when the
  // upstream API does not return token usage.
  const estimatedSeconds = size > 0 ? Math.max(1, (size * 8) / 24_000) : 1;
  const estimatedMinutes = estimatedSeconds / 60;
  const estimated = Math.ceil(estimatedMinutes * transcriptionUsdPerMinute * 1_000_000);
  return Math.max(transcriptionMinMicroUsd, estimated);
}

function isAllowedAudioMimeType(type) {
  const normalized = stringValue(type).split(";")[0].trim().toLowerCase();
  return [
    "audio/aac",
    "audio/flac",
    "audio/m4a",
    "audio/mp3",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/webm",
    "audio/x-m4a",
    "audio/x-wav",
    "video/webm",
  ].includes(normalized);
}

function createPrivateQueryMetadata(query) {
  return {
    queryHash: crypto.createHash("sha256").update(query).digest("hex"),
    queryLength: query.length,
  };
}

function createMockRealtimeSdp() {
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Mind Atlas staging mock Realtime",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    "a=mid:0",
    "a=sctp-port:5000",
    "",
  ].join("\r\n");
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(stringValue(value).length / 4));
}

function creditPercent(account) {
  const limit = Number(account?.credit_limit_micro_usd ?? MONTHLY_CREDIT_MICRO_USD);
  const remaining = Number(account?.credit_remaining_micro_usd ?? 0);
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, (remaining / limit) * 100));
}

async function applyStripeEvent(event) {
  const object = event?.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    const userId = stringValue(object.client_reference_id) || stringValue(object.metadata?.mind_atlas_user_id);
    if (!userId) return;
    const subscriptionId = stringValue(object.subscription);
    const subscription = subscriptionId ? await stripeGet(`/v1/subscriptions/${subscriptionId}`) : null;
    await upsertSubscriptionByUserId(userId, stripePatchFromStripeSubscription(subscription, object.customer, stripePriceId));
    return;
  }
  if (event.type?.startsWith("customer.subscription.")) {
    const customerId = stringValue(object.customer);
    const userId = stringValue(object.metadata?.mind_atlas_user_id);
    await upsertStripeSubscription(customerId, stripePatchFromStripeSubscription(object, customerId, stripePriceId), userId);
    return;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const customerId = stringValue(object.customer);
    const subscriptionId = stripeInvoiceSubscriptionId(object);
    const subscription = subscriptionId ? await stripeGet(`/v1/subscriptions/${subscriptionId}`) : null;
    const userId = stringValue(subscription?.metadata?.mind_atlas_user_id)
      || stringValue(object.subscription_details?.metadata?.mind_atlas_user_id)
      || stringValue(object.metadata?.mind_atlas_user_id);
    await upsertStripeSubscription(customerId, stripePatchFromStripeSubscription(subscription, customerId, stripePriceId), userId);
  }
}

async function upsertStripeSubscription(customerId, patch, fallbackUserId = "") {
  const updated = customerId ? await upsertSubscriptionByStripeCustomer(customerId, patch) : null;
  if (updated || !fallbackUserId) return updated;
  return await upsertSubscriptionByUserId(fallbackUserId, patch);
}

function stripeInvoiceSubscriptionId(invoice) {
  return stringValue(invoice?.subscription)
    || stringValue(invoice?.parent?.subscription_details?.subscription)
    || stringValue(invoice?.lines?.data?.[0]?.subscription);
}

async function stripeGet(pathname) {
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  return await readUpstreamJson(response);
}

async function stripeFormRequest(pathname, params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return await readUpstreamJson(response);
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new ServiceError(400, "Stripe signature is missing");
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new ServiceError(400, "Stripe signature timestamp is invalid");
  const timestampAgeSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (stripeWebhookToleranceSeconds > 0 && timestampAgeSeconds > stripeWebhookToleranceSeconds) {
    throw new ServiceError(400, "Stripe signature timestamp is outside the allowed tolerance");
  }
  const expected = crypto.createHmac("sha256", stripeWebhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new ServiceError(400, "Stripe signature verification failed");
  }
}

async function fetchFormJson(url, params) {
  const body = new URLSearchParams(params);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return await readUpstreamJson(response);
}

async function readJson(request) {
  const raw = await readRawBody(request, jsonBodyMaxBytes);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ServiceError(400, "Request body must be valid JSON");
  }
}

async function readFormData(request) {
  const raw = await readRawBody(request, formBodyMaxBytes);
  const webRequest = new Request("http://mind-atlas.local", {
    method: request.method,
    headers: nodeHeadersToFetchHeaders(request.headers),
    body: raw,
  });
  return await webRequest.formData();
}

async function readRawBody(request, maxBytes = jsonBodyMaxBytes) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ServiceError(413, "Request body is too large");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ServiceError(413, "Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readUpstreamJson(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.warn("Upstream returned malformed JSON", { status: response.status, bodyPreview: text.slice(0, 500) });
    throw new ServiceError(response.ok ? 502 : response.status, "Upstream returned malformed JSON");
  }
  if (!response.ok) {
    console.warn("Upstream request failed", { status: response.status, bodyPreview: text.slice(0, 500) });
    throw new ServiceError(response.status, `Upstream request failed with ${response.status}`);
  }
  return data;
}

async function serveStatic(response, method, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const distRoot = await fsp.realpath(path.resolve(distDir));
  const normalized = path.normalize(decodePathname(safePath).replace(/^[/\\]+/, ""));
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    throw new ServiceError(403, "Forbidden");
  }
  let filePath = path.resolve(distRoot, normalized);
  if (!isPathWithin(filePath, distRoot)) throw new ServiceError(403, "Forbidden");
  if (!fs.existsSync(filePath)) filePath = path.join(distRoot, "index.html");
  const realFilePath = await fsp.realpath(filePath);
  if (!isPathWithin(realFilePath, distRoot)) throw new ServiceError(403, "Forbidden");
  const stat = await fsp.stat(realFilePath);
  response.writeHead(200, {
    "Content-Type": contentType(realFilePath),
    "Content-Length": stat.size,
    "Cache-Control": realFilePath.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(realFilePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function decodePathname(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ServiceError(400, "Request path is invalid");
  }
}

function isPathWithin(filePath, rootDir) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createServiceErrorPayload(status, message) {
  const code = serviceErrorCode(status, message);
  return {
    error: serviceErrorMessage(code, status, message),
    code,
  };
}

function serviceErrorCode(status, message) {
  const text = stringValue(message).toLowerCase();
  if (text.includes("google login")) return "auth_required";
  if (status === 402 && text.includes("subscription")) return "subscription_required";
  if (text.includes("billing period")) return "billing_period_unavailable";
  if (status === 402 && (text.includes("exhausted") || text.includes("too low"))) return "credit_exhausted";
  if (status === 413 && text.includes("audio")) return "audio_too_large";
  if (status === 413 || text.includes("too large") || text.includes("per-request safety limit")) return "request_too_large";
  if (text.includes("not enabled for") || text.includes("no enabled model")) return "model_not_enabled";
  if (text.includes("pricing is not configured")) return "pricing_not_configured";
  if (text.includes("not configured") || text.includes("api key")) return "service_not_configured";
  if (status === 403 && text.includes("origin")) return "origin_not_allowed";
  if (status === 403) return "request_forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500 || status === 401 || status === 403) return "provider_unavailable";
  if (status === 400) return "bad_request";
  return "service_error";
}

function serviceErrorMessage(code, status, message) {
  switch (code) {
    case "auth_required":
      return "Google login is required.";
    case "subscription_required":
      return "An active Mind Atlas Pro subscription is required for AI features.";
    case "billing_period_unavailable":
      return "Mind Atlas token renewal date is still syncing.";
    case "credit_exhausted":
      return "Mind Atlas token for this billing period is exhausted.";
    case "audio_too_large":
      return "The audio file is too large for hosted dictation.";
    case "request_too_large":
      return "The request is too large for hosted AI limits.";
    case "model_not_enabled":
      return "The selected model is not enabled.";
    case "pricing_not_configured":
      return "Pricing is not configured for this model.";
    case "service_not_configured":
      return "Mind Atlas service is not fully configured.";
    case "origin_not_allowed":
      return "Request origin is not allowed.";
    case "request_forbidden":
      return "This request is not allowed.";
    case "provider_unavailable":
      return "The AI provider is temporarily unavailable.";
    case "rate_limited":
      return "Too many requests. Please wait a little and try again.";
    case "bad_request":
      return scrubServiceErrorMessage(message) || "The request could not be accepted.";
    default:
      return status >= 500 ? "Mind Atlas service failed." : scrubServiceErrorMessage(message) || "Mind Atlas service request failed.";
  }
}

function scrubServiceErrorMessage(message) {
  return stringValue(message)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [secret]")
    .replace(/\b(sk|rk|pk|whsec|ghp|glpat)_[A-Za-z0-9._-]+/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .trim()
    .slice(0, 220);
}

function redirectResponse(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function setCors(request, response) {
  const allowed = allowedOrigins();
  const origin = request.headers.origin;
  if (origin && allowed.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function enforceBrowserOrigin(request, url) {
  if (!isBrowserMutableApiRequest(request, url)) return;
  const origin = stringValue(request.headers.origin).replace(/\/+$/, "");
  if (origin) {
    if (!allowedOrigins().includes(origin)) {
      throw new ServiceError(403, "Request origin is not allowed");
    }
    return;
  }
  const referer = stringValue(request.headers.referer);
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin.replace(/\/+$/, "");
      if (allowedOrigins().includes(refererOrigin)) return;
    } catch {
      // fall through to fail-closed error
    }
  }
  if (isProductionOrigin()) {
    throw new ServiceError(403, "Request origin is not allowed");
  }
}

function isBrowserMutableApiRequest(request, url) {
  const method = stringValue(request.method).toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  return url.pathname !== "/api/billing/stripe/webhook";
}

function allowedOrigins() {
  return parseListEnv("MIND_ATLAS_ALLOWED_ORIGIN", [publicOrigin])
    .map((origin) => origin.replace(/\/+$/, ""))
    .filter((origin) => origin && origin !== "*");
}

function setCookie(response, name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (cookieSecure) parts.push("Secure");
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  response.setHeader("Set-Cookie", appendHeader(response.getHeader("Set-Cookie"), parts.join("; ")));
}

function appendHeader(current, value) {
  if (!current) return value;
  return Array.isArray(current) ? [...current, value] : [current, value];
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header).split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return ["", ""];
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }).filter(([key]) => key),
  );
}

function bearerHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

function readBoolEnv(name, fallback = false) {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const value = raw.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function nodeHeadersToFetchHeaders(headers) {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) output.append(key, item);
    } else if (value !== undefined) {
      output.set(key, value);
    }
  }
  return output;
}

function applyReasoningEffort(body, effort) {
  const value = stringValue(effort);
  if (!value || value === "default" || value === "none") return;
  if (!supportsReasoningEffort(body.model)) return;
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") {
    body.reasoning_effort = value;
  }
}

function usesChatCompletionsMaxCompletionTokens(provider, model) {
  if (provider?.id !== "openai") return false;
  return supportsReasoningEffort(model);
}

function supportsReasoningEffort(model) {
  const normalized = stringValue(model).toLowerCase();
  return /^o\d/.test(normalized) || normalized.startsWith("gpt-5") || normalized.includes("reasoning");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((content) => typeof content?.text === "string" ? content.text : "")
      .join("");
  }
  return "";
}

function extractResponseCitations(data) {
  const citations = [];
  const text = JSON.stringify(data);
  for (const match of text.matchAll(/"url"\s*:\s*"([^"]+)"/g)) {
    const url = match[1].replace(/\\\//g, "/");
    if (!citations.some((item) => item.url === url)) citations.push({ url });
  }
  return citations.slice(0, 12);
}

function safeJsonParse(value, fallback) {
  try {
    return typeof value === "string" ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function safeReturnPath(value) {
  const pathValue = String(value || "/");
  if (!pathValue.startsWith("/") || pathValue.startsWith("//")) return "/";
  return pathValue;
}

function numberValue(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".webmanifest") return "application/manifest+json";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

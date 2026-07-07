import fs from "node:fs";
import path from "node:path";
import { getEnv, serviceRootDir } from "./service-config.mjs";
import { mergeModelPrices } from "./model-pricing.mjs";
import { stripePatchFromStripeSubscription } from "./stripe-subscription.mjs";

const [command, ...args] = process.argv.slice(2);
let dbModule = null;

try {
  if (!command || command === "help") {
    printHelp();
  } else if (command === "doctor") {
    await runDoctor();
  } else if (command === "migrate") {
    const db = await getDb();
    await db.migrateDatabase();
    console.log("Database migration complete.");
  } else if (command === "users") {
    const db = await getDb();
    await db.migrateDatabase();
    const users = await db.listUsers(Number(args[0] ?? 100));
    console.table(users.map((user) => ({
      email: user.email,
      name: user.name,
      role: user.role,
      subscription: user.subscription_status ?? "none",
      token: formatPercent(user.credit_remaining_micro_usd, user.credit_limit_micro_usd),
      period: user.period_key ?? "",
      renews: user.current_period_end?.toISOString?.() ?? user.current_period_end ?? "",
      created: user.created_at?.toISOString?.() ?? user.created_at,
    })));
  } else if (command === "user") {
    const db = await getDb();
    await db.migrateDatabase();
    const user = await db.findUserByEmail(requireArg(args[0], "email"));
    if (!user) {
      console.error("User not found.");
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(user, null, 2));
    }
  } else if (command === "usage") {
    const db = await getDb();
    await db.migrateDatabase();
    const result = await db.listUsageEvents(requireArg(args[0], "email"), Number(args[1] ?? 30));
    if (!result) {
      console.error("User not found.");
      process.exitCode = 1;
    } else {
      console.log(`Usage events for ${result.user.email}`);
      console.table(result.events.map((event) => ({
        created: event.created_at?.toISOString?.() ?? event.created_at,
        provider: event.provider,
        model: event.model,
        input: event.input_tokens,
        output: event.output_tokens,
        estimate: formatMicroUsd(event.estimated_cost_micro_usd),
        spent: formatMicroUsd(event.credit_spent_micro_usd),
        ms: event.duration_ms ?? "",
        request: event.request_id,
      })));
    }
  } else if (command === "grant-admin") {
    const db = await getDb();
    await db.migrateDatabase();
    const user = await db.setUserRole(requireArg(args[0], "email"), "admin");
    if (!user) throw new Error("User not found");
    console.log(`Admin role granted: ${user.email}`);
  } else if (command === "grant-credit") {
    const db = await getDb();
    await db.migrateDatabase();
    const email = requireArg(args[0], "email");
    const percent = Number(requireArg(args[1], "percent"));
    if (!Number.isFinite(percent) || percent <= 0) throw new Error("percent must be a positive number");
    const result = await db.grantCreditPercent(email, percent);
    if (!result) throw new Error("User not found");
    console.log(`Granted ${percent}% token to ${result.user.email}. Current token: ${formatPercent(result.account.credit_remaining_micro_usd, result.account.credit_limit_micro_usd)}`);
  } else if (command === "set-credit") {
    const db = await getDb();
    await db.migrateDatabase();
    const email = requireArg(args[0], "email");
    const percent = Number(requireArg(args[1], "percent"));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("percent must be a number from 0 to 100");
    const result = await db.setCreditPercent(email, percent);
    if (!result) throw new Error("User not found");
    console.log(`Set ${result.user.email} token to ${formatPercent(result.account.credit_remaining_micro_usd, result.account.credit_limit_micro_usd)}`);
  } else if (command === "sync-stripe-periods") {
    const db = await getDb();
    await db.migrateDatabase();
    const rows = await listSubscriptionsForStripeSync(db, args[0] ?? "");
    if (!rows.length) {
      console.log("No Stripe subscriptions to sync.");
    } else {
      const results = [];
      for (const row of rows) {
        const subscription = await stripeGetSubscription(row.stripe_subscription_id);
        const patch = stripePatchFromStripeSubscription(subscription, row.stripe_customer_id, getEnv("STRIPE_PRICE_ID"));
        const updated = await db.upsertSubscriptionByUserId(row.user_id, patch);
        const migratedCreditPeriod = !row.current_period_start && updated.current_period_start
          ? await rekeyLatestCreditAccountToSubscriptionPeriod(db, row.user_id, db.creditPeriodKey(updated))
          : "";
        results.push({
          email: row.email,
          status: updated.status,
          currentPeriodStart: updated.current_period_start?.toISOString?.() ?? updated.current_period_start,
          currentPeriodEnd: updated.current_period_end?.toISOString?.() ?? updated.current_period_end,
          periodSynced: Boolean(updated.current_period_start && updated.current_period_end),
          migratedCreditPeriod,
        });
      }
      console.table(results);
    }
  } else if (command === "reap-stale-reservations") {
    const db = await getDb();
    await db.migrateDatabase();
    const minutes = Number(args[0] ?? 30);
    if (!Number.isFinite(minutes) || minutes < 1) throw new Error("minutes must be a positive number");
    const refunded = await db.refundStaleCreditReservations({ olderThanMinutes: minutes });
    console.log(`Refunded stale reservations: ${refunded}`);
  } else if (command === "cleanup-sessions") {
    const db = await getDb();
    await db.migrateDatabase();
    const idleDays = Number(args[0] ?? getEnv("MIND_ATLAS_SESSION_IDLE_DAYS", "7"));
    if (!Number.isFinite(idleDays) || idleDays < 1) throw new Error("idleDays must be a positive number");
    const deleted = await db.deleteExpiredSessions(idleDays);
    console.log(`Deleted expired sessions: ${deleted}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (dbModule?.pool) await dbModule.pool.end();
}

async function getDb() {
  dbModule ??= await import("./service-db.mjs");
  return dbModule;
}

async function listSubscriptionsForStripeSync(db, email = "") {
  const params = [];
  const emailFilter = email ? "and lower(users.email) = lower($1)" : "";
  if (email) params.push(email);
  const result = await db.pool.query(
    `
      select
        users.id as user_id,
        users.email,
        subscriptions.stripe_customer_id,
        subscriptions.stripe_subscription_id,
        subscriptions.current_period_start,
        subscriptions.current_period_end
      from subscriptions
      join users on users.id = subscriptions.user_id
      where subscriptions.stripe_subscription_id is not null
        and subscriptions.stripe_subscription_id <> ''
        ${emailFilter}
      order by users.email
    `,
    params,
  );
  return result.rows;
}

async function rekeyLatestCreditAccountToSubscriptionPeriod(db, userId, targetPeriodKey) {
  if (!targetPeriodKey) return "";
  const target = await db.pool.query("select 1 from credit_accounts where user_id = $1 and period_key = $2", [userId, targetPeriodKey]);
  if (target.rows[0]) return "";
  const latest = await db.pool.query(
    "select period_key from credit_accounts where user_id = $1 order by created_at desc limit 1",
    [userId],
  );
  const sourcePeriodKey = latest.rows[0]?.period_key;
  if (!sourcePeriodKey || sourcePeriodKey === targetPeriodKey) return "";
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update credit_accounts set period_key = $3, updated_at = now() where user_id = $1 and period_key = $2",
      [userId, sourcePeriodKey, targetPeriodKey],
    );
    await client.query(
      "update credit_ledger set period_key = $3 where user_id = $1 and period_key = $2",
      [userId, sourcePeriodKey, targetPeriodKey],
    );
    await client.query("commit");
    return `${sourcePeriodKey} -> ${targetPeriodKey}`;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function stripeGetSubscription(subscriptionId) {
  const stripeSecretKey = getEnv("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required for sync-stripe-periods");
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Stripe subscription fetch failed for ${subscriptionId}: ${data?.error?.message ?? response.statusText}`);
  }
  return data;
}

async function runDoctor() {
  const checks = [];
  const add = (item, ok, detail = "", required = true) => {
    checks.push({ item, ok: Boolean(ok), detail, required });
  };

  const publicOrigin = getEnv("MIND_ATLAS_PUBLIC_ORIGIN");
  const cookieSecureRaw = getEnv("MIND_ATLAS_COOKIE_SECURE");
  const cookieSecure = cookieSecureRaw ? cookieSecureRaw !== "0" : publicOrigin.startsWith("https://");
  const distDir = path.resolve(serviceRootDir, getEnv("MIND_ATLAS_DIST_DIR", "dist"));
  const distIndex = path.join(distDir, "index.html");
  const configuredProviders = chatProviderChecks().filter((provider) => provider.configured);

  add("DATABASE_URL", hasEnv("DATABASE_URL"), "required for PostgreSQL");
  add("dist/index.html", fs.existsSync(distIndex), distIndex);
  add("public origin", Boolean(publicOrigin), publicOrigin || "MIND_ATLAS_PUBLIC_ORIGIN missing");
  add("secure cookies", !publicOrigin.startsWith("https://") || cookieSecure, cookieSecure ? "enabled" : "disabled");
  const mockAuth = enabledEnv("MIND_ATLAS_STAGING_MOCK_AUTH");
  const mockBilling = enabledEnv("MIND_ATLAS_STAGING_MOCK_BILLING");
  const mockProviders = enabledEnv("MIND_ATLAS_STAGING_MOCK_PROVIDERS");
  const modelPricePolicy = getEnv("MIND_ATLAS_MODEL_PRICE_POLICY", "allow-default").toLowerCase();
  const productionOrigin = isProductionOrigin(publicOrigin);
  const modelPrices = mergeModelPrices(parseJsonEnv("MIND_ATLAS_MODEL_PRICES_JSON", {}));
  const missingProviderPrices = configuredProviders
    .filter((provider) => !modelPrices[`${provider.id}:*`])
    .map((provider) => provider.label);
  const missingModelPrices = configuredProviders
    .flatMap((provider) => providerConfiguredModels(provider.id).map((model) => ({ provider, model })))
    .filter(({ provider, model }) => !modelPrices[`${provider.id}:${model}`])
    .map(({ provider, model }) => `${provider.id}:${model}`);
  add("Google OAuth", mockAuth || (hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET")), mockAuth ? "staging mock enabled" : "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  add("Stripe Checkout", mockBilling || (hasEnv("STRIPE_SECRET_KEY") && hasEnv("STRIPE_PRICE_ID")), mockBilling ? "staging mock enabled" : "STRIPE_SECRET_KEY and STRIPE_PRICE_ID");
  add("Stripe webhook", mockBilling || hasEnv("STRIPE_WEBHOOK_SECRET"), mockBilling ? "staging mock enabled" : "STRIPE_WEBHOOK_SECRET");
  add("OpenAI realtime/tools", mockProviders || hasAnyUsableEnv(["MIND_ATLAS_OPENAI_API_KEY", "OPENAI_API_KEY"]), mockProviders ? "staging mock enabled" : "required for Realtime, Dictation, and web_search");
  add("chat providers", configuredProviders.length > 0, configuredProviders.map((provider) => provider.label).join(", ") || "none configured");
  add(
    "production mocks disabled",
    !productionOrigin || (!mockAuth && !mockBilling && !mockProviders),
    productionOrigin ? `auth=${mockAuth} billing=${mockBilling} providers=${mockProviders}` : "not production origin",
  );
  add(
    "model price policy",
    ["allow-default", "require-provider", "require-model"].includes(modelPricePolicy) && (!productionOrigin || modelPricePolicy === "require-model"),
    modelPricePolicy,
  );
  add(
    "realtime safety caps",
    envIntInRange("MIND_ATLAS_REALTIME_MAX_OUTPUT_TOKENS", 512, 1, 4096)
      && envIntInRange("MIND_ATLAS_REALTIME_MAX_SESSION_SECONDS", 300, 30, 1800),
    `maxOutput=${getEnv("MIND_ATLAS_REALTIME_MAX_OUTPUT_TOKENS", "512")} maxSeconds=${getEnv("MIND_ATLAS_REALTIME_MAX_SESSION_SECONDS", "300")}`,
  );
  add(
    "provider price coverage",
    modelPricePolicy !== "require-provider" || missingProviderPrices.length === 0,
    modelPricePolicy === "require-provider"
      ? (missingProviderPrices.length ? `missing provider:* prices for ${missingProviderPrices.join(", ")}` : "configured provider:* prices present")
      : "not required by current model price policy",
    modelPricePolicy === "require-provider",
  );
  add(
    "model price coverage",
    modelPricePolicy !== "require-model" || missingModelPrices.length === 0,
    missingModelPrices.length ? `missing model prices for ${missingModelPrices.join(", ")}` : "configured model prices present",
    modelPricePolicy === "require-model",
  );

  if (hasEnv("DATABASE_URL")) {
    try {
      const db = await getDb();
      await db.migrateDatabase();
      await db.pool.query("select 1");
      add("database migration", true, "migrations ok");
    } catch (error) {
      add("database migration", false, error instanceof Error ? error.message : String(error));
    }
  }

  console.table(checks.map((check) => ({
    check: check.item,
    status: check.ok ? "ok" : "fail",
    detail: check.detail,
  })));
  if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
}

function chatProviderChecks() {
  const mockProviders = enabledEnv("MIND_ATLAS_STAGING_MOCK_PROVIDERS");
  return [
    { id: "openai", label: "OpenAI", configured: mockProviders || hasAnyUsableEnv(["MIND_ATLAS_OPENAI_API_KEY", "OPENAI_API_KEY"]) },
    { id: "anthropic", label: "Anthropic", configured: mockProviders || hasAnyUsableEnv(["MIND_ATLAS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY"]) },
    { id: "glm", label: "GLM", configured: mockProviders || hasUsableEnv("MIND_ATLAS_GLM_API_KEY") },
    { id: "deepseek", label: "DeepSeek", configured: mockProviders || hasAnyUsableEnv(["MIND_ATLAS_DEEPSEEK_API_KEY", "MIND_ATLAS_DEEPSEEK_AUTH_TOKEN", "DEEPSEEK_API_KEY", "MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN"]) },
    { id: "gemini", label: "Gemini", configured: mockProviders || hasUsableEnv("MIND_ATLAS_GEMINI_API_KEY") },
    { id: "qwen", label: "Qwen", configured: mockProviders || hasUsableEnv("MIND_ATLAS_QWEN_API_KEY") },
    { id: "composer", label: "Composer", configured: mockProviders || hasUsableEnv("MIND_ATLAS_COMPOSER_API_KEY") },
    { id: "kimi", label: "Kimi", configured: mockProviders || hasUsableEnv("MIND_ATLAS_KIMI_API_KEY") },
    { id: "mimo", label: "Mimo", configured: mockProviders || hasUsableEnv("MIND_ATLAS_MIMO_API_KEY") },
    { id: "minimax", label: "MiniMax", configured: mockProviders || hasUsableEnv("MIND_ATLAS_MINIMAX_API_KEY") },
    { id: "grok", label: "Grok", configured: mockProviders || hasUsableEnv("MIND_ATLAS_GROK_API_KEY") },
  ];
}

function printHelp() {
  console.log(`Mind Atlas service admin

Usage:
  npm run service:migrate
  npm run service:admin -- doctor
  npm run service:admin -- users [limit]
  npm run service:admin -- user <email>
  npm run service:admin -- usage <email> [limit]
  npm run service:admin -- grant-admin <email>
  npm run service:admin -- grant-credit <email> <percent>
  npm run service:admin -- set-credit <email> <percent>
  npm run service:admin -- sync-stripe-periods [email]
  npm run service:admin -- reap-stale-reservations [minutes]
  npm run service:admin -- cleanup-sessions [idleDays]
`);
}

function hasEnv(name) {
  return Boolean(getEnv(name));
}

function hasAnyEnv(names) {
  return names.some((name) => hasEnv(name));
}

function providerConfiguredModels(providerId) {
  const envName = `MIND_ATLAS_${providerId.toUpperCase()}_MODELS`;
  return getEnv(envName)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && !/staging|mock|placeholder|replace-with|your-/i.test(item));
}

function hasUsableEnv(name) {
  const value = getEnv(name);
  return Boolean(value) && !isPlaceholderSecret(value);
}

function hasAnyUsableEnv(names) {
  return names.some((name) => hasUsableEnv(name));
}

function isPlaceholderSecret(value) {
  return /^(mock|placeholder)$/i.test(value)
    || /^(replace-with|your-)/i.test(value)
    || /^\.+$/.test(value);
}

function enabledEnv(name) {
  const value = getEnv(name).toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function envIntInRange(name, fallback, min, max) {
  const value = Number(getEnv(name, String(fallback)));
  return Number.isInteger(value) && value >= min && value <= max;
}

function isProductionOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseJsonEnv(name, fallback = {}) {
  const raw = getEnv(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function requireArg(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function formatPercent(remaining, limit) {
  const remainingNumber = Number(remaining ?? 0);
  const limitNumber = Number(limit ?? 0);
  if (!limitNumber) return "0%";
  return `${Math.round((remainingNumber / limitNumber) * 100)}%`;
}

function formatMicroUsd(value) {
  return `$${(Number(value ?? 0) / 1_000_000).toFixed(6)}`;
}

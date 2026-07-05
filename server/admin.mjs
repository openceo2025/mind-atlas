import fs from "node:fs";
import path from "node:path";
import { getEnv, serviceRootDir } from "./service-config.mjs";
import { mergeModelPrices } from "./model-pricing.mjs";

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
    "model price policy",
    ["allow-default", "require-provider", "require-model"].includes(modelPricePolicy),
    modelPricePolicy,
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

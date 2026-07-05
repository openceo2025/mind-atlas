import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, "deploy/staging/env.service.local");
const errors = [];

if (!fs.existsSync(envPath)) {
  errors.push("deploy/staging/env.service.local is missing.");
  printResult();
  process.exit(1);
}

const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));

expectValue("MIND_ATLAS_STAGING_MOCK_AUTH", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_BILLING", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_PROVIDERS", "0");
expectSecret("GOOGLE_CLIENT_ID", "Google OAuth client ID");
expectSecret("GOOGLE_CLIENT_SECRET", "Google OAuth client secret");
expectSecret("STRIPE_SECRET_KEY", "Stripe test secret key", /^sk_test_/);
expectSecret("STRIPE_PRICE_ID", "Stripe recurring price ID", /^price_/);
expectSecret("STRIPE_WEBHOOK_SECRET", "Stripe webhook signing secret", /^whsec_/);
expectSecret("MIND_ATLAS_OPENAI_API_KEY", "OpenAI API key", /^sk-/);
expectModelList("MIND_ATLAS_OPENAI_MODELS");
expectModelName("MIND_ATLAS_OPENAI_MODEL", false);
expectModelName("MIND_ATLAS_WEB_SEARCH_MODEL", true);

printResult();
process.exit(errors.length > 0 ? 1 : 0);

function expectValue(key, expected) {
  const actual = env.get(key);
  if (actual !== expected) {
    errors.push(`${key} must be ${expected}; current value is ${displayValue(actual)}.`);
  }
}

function expectSecret(key, label, pattern = /^.+$/) {
  const actual = env.get(key) ?? "";
  if (!pattern.test(actual) || isPlaceholder(actual)) {
    errors.push(`${key} must be a valid ${label}.`);
  }
}

function expectModelList(key) {
  const actual = env.get(key) ?? "";
  const models = actual.split(",").map((item) => item.trim()).filter(Boolean);
  if (!models.length) {
    errors.push(`${key} must include at least one real OpenAI model.`);
    return;
  }
  for (const model of models) {
    if (isStagingModel(model)) errors.push(`${key} includes staging/mock model ${model}.`);
  }
}

function expectModelName(key, required) {
  const actual = env.get(key) ?? "";
  if (!actual && !required) return;
  if (!actual) {
    errors.push(`${key} must be set to a real OpenAI model.`);
    return;
  }
  if (isStagingModel(actual)) errors.push(`${key} is still a staging/mock model.`);
}

function isStagingModel(value) {
  return /staging|mock/i.test(value);
}

function isPlaceholder(value) {
  if (!value) return true;
  return /replace-with|your-|placeholder|\.\.\.|^mock$/i.test(value);
}

function displayValue(value) {
  if (value === undefined) return "(missing)";
  if (value === "") return "(empty)";
  return value;
}

function parseEnvFile(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function printResult() {
  if (errors.length === 0) {
    console.log("OpenAI staging config is ready.");
    console.log("");
    console.log("Restart the local staging profile:");
    console.log("  npm run staging:local:up");
    return;
  }

  console.error("OpenAI staging config is not ready yet.");
  console.error("");
  for (const error of errors) console.error(`- ${error}`);
  console.error("");
  console.error("Expected next-step values:");
  console.error("- MIND_ATLAS_STAGING_MOCK_AUTH=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_BILLING=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_PROVIDERS=0");
  console.error("- MIND_ATLAS_OPENAI_API_KEY=sk-...");
  console.error("");
  console.error("Keep other provider keys as mock/blank until each provider is intentionally tested.");
}

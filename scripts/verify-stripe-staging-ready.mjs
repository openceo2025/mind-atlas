import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, "deploy/staging/env.service.local");
const errors = [];
const warnings = [];

if (!fs.existsSync(envPath)) {
  errors.push("deploy/staging/env.service.local is missing.");
  printResult();
  process.exit(1);
}

const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));

expectValue("MIND_ATLAS_STAGING_MOCK_AUTH", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_BILLING", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_PROVIDERS", "1");
expectPrefix("GOOGLE_CLIENT_ID", /^.+$/, "Google OAuth client ID");
expectPrefix("GOOGLE_CLIENT_SECRET", /^.+$/, "Google OAuth client secret");
expectPrefix("STRIPE_SECRET_KEY", /^sk_test_/, "Stripe test secret key");
expectPrefix("STRIPE_PRICE_ID", /^price_/, "Stripe recurring price ID");
expectPrefix("STRIPE_WEBHOOK_SECRET", /^whsec_/, "Stripe webhook signing secret");

if (isPlaceholder(env.get("GOOGLE_CLIENT_ID"))) errors.push("GOOGLE_CLIENT_ID still looks like a placeholder.");
if (isPlaceholder(env.get("GOOGLE_CLIENT_SECRET"))) errors.push("GOOGLE_CLIENT_SECRET still looks like a placeholder.");

try {
  const output = execFileSync("stripe", ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!/stripe version/i.test(output)) warnings.push("Stripe CLI responded, but the version output looked unusual.");
} catch {
  errors.push("Stripe CLI is not available. Install it and make sure `stripe version` works in PowerShell.");
}

printResult();
process.exit(errors.length > 0 ? 1 : 0);

function expectValue(key, expected) {
  const actual = env.get(key);
  if (actual !== expected) {
    errors.push(`${key} must be ${expected}; current value is ${displayValue(actual)}.`);
  }
}

function expectPrefix(key, pattern, label) {
  const actual = env.get(key) ?? "";
  if (!pattern.test(actual) || isPlaceholder(actual)) {
    errors.push(`${key} must be a valid ${label}.`);
  }
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
    console.log("Stripe test staging config is ready.");
    if (warnings.length) {
      console.log("");
      for (const warning of warnings) console.log(`Warning: ${warning}`);
    }
    console.log("");
    console.log("Keep this running in a separate PowerShell before checkout testing:");
    console.log("  stripe listen --forward-to http://127.0.0.1:8088/api/billing/stripe/webhook");
    console.log("");
    console.log("Then restart the local staging profile:");
    console.log("  npm run staging:local:up");
    return;
  }

  console.error("Stripe test staging config is not ready yet.");
  console.error("");
  for (const error of errors) console.error(`- ${error}`);
  console.error("");
  console.error("Expected local staging values:");
  console.error("- MIND_ATLAS_STAGING_MOCK_AUTH=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_BILLING=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_PROVIDERS=1");
  console.error("- STRIPE_SECRET_KEY=sk_test_...");
  console.error("- STRIPE_PRICE_ID=price_...");
  console.error("- STRIPE_WEBHOOK_SECRET=whsec_...");
  console.error("");
  console.error("Do not paste Stripe secrets into chat. Put them only in deploy/staging/env.service.local.");
}

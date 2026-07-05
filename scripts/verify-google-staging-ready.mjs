import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, "deploy/staging/env.service.local");
const composePath = path.join(rootDir, "docker-compose.staging.local.yml");
const requiredOrigin = "http://127.0.0.1:8088";
const requiredRedirectUri = `${requiredOrigin}/api/auth/google/callback`;

const errors = [];

if (!fs.existsSync(composePath)) {
  errors.push("docker-compose.staging.local.yml is missing.");
}

if (!fs.existsSync(envPath)) {
  errors.push("deploy/staging/env.service.local is missing.");
  printResult(errors);
  process.exit(1);
}

const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));

expectValue("MIND_ATLAS_PUBLIC_ORIGIN", requiredOrigin);
expectValue("MIND_ATLAS_STAGING_MOCK_AUTH", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_BILLING", "1");
expectValue("MIND_ATLAS_STAGING_MOCK_PROVIDERS", "1");
expectPresentSecret("GOOGLE_CLIENT_ID");
expectPresentSecret("GOOGLE_CLIENT_SECRET");

printResult(errors);
process.exit(errors.length > 0 ? 1 : 0);

function expectValue(key, expected) {
  const actual = env.get(key);
  if (actual !== expected) {
    errors.push(`${key} must be ${expected}; current value is ${displayValue(actual)}.`);
  }
}

function expectPresentSecret(key) {
  const actual = env.get(key);
  if (isPlaceholder(actual)) {
    errors.push(`${key} must be filled with the Google OAuth web client value.`);
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

function printResult(currentErrors) {
  if (currentErrors.length === 0) {
    console.log("Google OAuth staging config is ready.");
    console.log("");
    console.log("Next command:");
    console.log("  npm run staging:local:up");
    return;
  }

  console.error("Google OAuth staging config is not ready yet.");
  console.error("");
  for (const error of currentErrors) {
    console.error(`- ${error}`);
  }
  console.error("");
  console.error("Create a Google OAuth web client with:");
  console.error(`- Authorized JavaScript origin: ${requiredOrigin}`);
  console.error(`- Authorized redirect URI: ${requiredRedirectUri}`);
  console.error("");
  console.error("Then put the client ID and client secret into:");
  console.error("  deploy/staging/env.service.local");
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, "deploy/staging/env.service.local");
const errors = [];
const warnings = [];
const providerSummaries = [];

if (!fs.existsSync(envPath)) {
  errors.push("deploy/staging/env.service.local is missing.");
  printResult();
  process.exit(1);
}

const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));

expectValue("MIND_ATLAS_STAGING_MOCK_AUTH", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_BILLING", "0");
expectValue("MIND_ATLAS_STAGING_MOCK_PROVIDERS", "0");
expectSecret(["MIND_ATLAS_OPENAI_API_KEY", "OPENAI_API_KEY"], "OpenAI API key", /^sk-/);
expectSecret(["MIND_ATLAS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY"], "Anthropic API key");
expectSecret(["MIND_ATLAS_DEEPSEEK_API_KEY", "MIND_ATLAS_DEEPSEEK_AUTH_TOKEN", "DEEPSEEK_API_KEY", "MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN"], "DeepSeek API key");

if (errors.length === 0) {
  await checkProviderModels({
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    apiKey: firstEnv("MIND_ATLAS_OPENAI_API_KEY", "OPENAI_API_KEY"),
    baseUrl: firstEnv("MIND_ATLAS_OPENAI_BASE_URL") || "https://api.openai.com/v1",
  });
  await checkProviderModels({
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    apiKey: firstEnv("MIND_ATLAS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY"),
    baseUrl: firstEnv("MIND_ATLAS_ANTHROPIC_BASE_URL") || "https://api.anthropic.com",
  });
  await checkProviderModels({
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    apiKey: firstEnv("MIND_ATLAS_DEEPSEEK_API_KEY", "MIND_ATLAS_DEEPSEEK_AUTH_TOKEN", "DEEPSEEK_API_KEY", "MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN"),
    baseUrl: firstEnv("MIND_ATLAS_DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1",
  });
}

printResult();
process.exit(errors.length > 0 ? 1 : 0);

async function checkProviderModels(provider) {
  try {
    const models = await fetchProviderModels(provider);
    if (!models.length) {
      errors.push(`${provider.label} returned no chat-capable models.`);
      return;
    }
    providerSummaries.push(`${provider.label}: ${models.slice(0, 8).join(", ")}${models.length > 8 ? ` (+${models.length - 8} more)` : ""}`);
  } catch (error) {
    errors.push(`${provider.label} model list request failed: ${sanitizeError(error)}`);
  }
}

async function fetchProviderModels(provider) {
  const url = provider.kind === "anthropic"
    ? anthropicEndpoint(provider.baseUrl, "/v1/models")
    : `${provider.baseUrl.replace(/\/+$/, "")}/models`;
  const headers = provider.kind === "anthropic"
    ? {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      }
    : { Authorization: `Bearer ${provider.apiKey}` };
  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || text || `HTTP ${response.status}`);
  }
  const ids = uniqueStrings((Array.isArray(data?.data) ? data.data : []).map((item) => item?.id));
  return filterProviderModels(provider.id, ids);
}

function filterProviderModels(providerId, models) {
  const filtered = uniqueStrings(models).filter((model) => !isPlaceholder(model));
  if (providerId === "openai") return filtered.filter(isOpenAiChatModel);
  if (providerId === "anthropic") {
    return filtered.filter((model) => {
      const normalized = model.toLowerCase();
      return normalized.startsWith("claude-") && !normalized.includes("fable");
    });
  }
  if (providerId === "deepseek") return filtered.filter((model) => model.toLowerCase().startsWith("deepseek-"));
  return filtered;
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

function expectValue(key, expected) {
  const actual = env.get(key);
  if (actual !== expected) {
    errors.push(`${key} must be ${expected}; current value is ${displayValue(actual)}.`);
  }
}

function expectSecret(keys, label, pattern = /^.+$/) {
  const value = firstEnv(...keys);
  if (!pattern.test(value) || isPlaceholder(value)) {
    errors.push(`${keys.join(" or ")} must contain a valid ${label}.`);
  }
}

function firstEnv(...keys) {
  for (const key of keys) {
    const value = env.get(key);
    if (value) return value;
  }
  return "";
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
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function isPlaceholder(value) {
  if (!value) return true;
  return /replace-with|your-|placeholder|\.\.\.|staging|mock/i.test(value);
}

function sanitizeError(error) {
  return String(error?.message || error || "request failed")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-...")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ...")
    .replace(/\s+/g, " ")
    .slice(0, 240);
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
    console.log("Core provider staging config is ready.");
    console.log("");
    for (const summary of providerSummaries) console.log(`- ${summary}`);
    if (warnings.length) {
      console.log("");
      for (const warning of warnings) console.log(`Warning: ${warning}`);
    }
    console.log("");
    console.log("Restart the local staging profile:");
    console.log("  npm run staging:local:up");
    return;
  }

  console.error("Core provider staging config is not ready yet.");
  console.error("");
  for (const error of errors) console.error(`- ${error}`);
  console.error("");
  console.error("Expected local staging values:");
  console.error("- MIND_ATLAS_STAGING_MOCK_AUTH=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_BILLING=0");
  console.error("- MIND_ATLAS_STAGING_MOCK_PROVIDERS=0");
  console.error("- MIND_ATLAS_OPENAI_API_KEY=sk-...");
  console.error("- MIND_ATLAS_ANTHROPIC_API_KEY=...");
  console.error("- MIND_ATLAS_DEEPSEEK_API_KEY=...");
  console.error("");
  console.error("Do not paste provider secrets into chat. Put them only in deploy/staging/env.service.local.");
}

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";

loadLocalEnvFiles();

const port = Number(process.env.MIND_ATLAS_BRIDGE_PORT ?? process.env.PORT ?? 8787);
const host = process.env.MIND_ATLAS_BRIDGE_HOST ?? "127.0.0.1";
const bridgeProtocol = process.env.MIND_ATLAS_BRIDGE_PROTOCOL ?? "http";
const httpsKeyPath = process.env.MIND_ATLAS_HTTPS_KEY ?? "";
const httpsCertPath = process.env.MIND_ATLAS_HTTPS_CERT ?? "";

const openAiApiKey = process.env.MIND_ATLAS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
const openAiMode = process.env.MIND_ATLAS_OPENAI_MODE ?? "responses";
const defaultModel = process.env.MIND_ATLAS_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
const defaultMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_MAX_OUTPUT_TOKENS", 8192);
const openAiMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_OPENAI_MAX_OUTPUT_TOKENS", defaultMaxOutputTokens);
const localMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_LOCAL_MAX_OUTPUT_TOKENS", defaultMaxOutputTokens);
const localPromptContextCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_CONTEXT_CHAR_LIMIT", 2400);
const localPartnerLogCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_LOG_CHAR_LIMIT", 700);
const localPartnerSummaryCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_SUMMARY_CHAR_LIMIT", 450);
const localPartnerSystemCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_SYSTEM_CHAR_LIMIT", 3600);
const webSearchMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_WEB_SEARCH_MAX_OUTPUT_TOKENS", 2048);
const openAiImageModel = process.env.MIND_ATLAS_OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const openAiImageSize = process.env.MIND_ATLAS_OPENAI_IMAGE_SIZE ?? "1024x1024";
const openAiTranscriptionModel = process.env.MIND_ATLAS_OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";
const openAiChatModels = parseStringList(process.env.MIND_ATLAS_OPENAI_CHAT_MODELS, [defaultModel, "gpt-5.5-pro", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);

const localBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_LOCAL_BASE_URL ?? "http://127.0.0.1:1234/v1");
const localApiKey = process.env.MIND_ATLAS_LOCAL_API_KEY ?? "lm-studio";
const deprecatedLocalModel = process.env.MIND_ATLAS_LOCAL_MODEL ?? "";

const codexUseWsl = process.env.MIND_ATLAS_CODEX_USE_WSL === "true";
const codexBin = resolveCodexBin(process.env.MIND_ATLAS_CODEX_BIN ?? "codex", codexUseWsl);
const codexWorkspace = process.env.MIND_ATLAS_CODEX_WORKSPACE ?? process.cwd();
const codexModel = process.env.MIND_ATLAS_CODEX_MODEL ?? "";
const codexReasoningEffort = normalizeReasoningEffort(process.env.MIND_ATLAS_CODEX_REASONING_EFFORT ?? "medium");
const codexSandbox = normalizeCodexSandbox(process.env.MIND_ATLAS_CODEX_SANDBOX ?? "workspace-write");
const codexTimeoutMs = Number(process.env.MIND_ATLAS_CODEX_TIMEOUT_MS ?? 60 * 60 * 1000);
const codexDisabled = process.env.MIND_ATLAS_CODEX_DISABLED === "true";
const codexModelsOverride = process.env.MIND_ATLAS_CODEX_MODELS ?? "";
const codexLogDir = resolve(process.env.MIND_ATLAS_CODEX_LOG_DIR ?? join(process.cwd(), "server-data", "codex-runs"));
let codexOptionsCache = null;
let codexSearchFlagSupportCache = null;
let providerUsageCache = null;

const openClawBin = resolveOpenClawBin(process.env.MIND_ATLAS_OPENCLAW_BIN ?? "openclaw");
const openClawThinking = "off";
const openClawAgent = process.env.MIND_ATLAS_OPENCLAW_AGENT ?? "";
const openClawTimeoutMs = Number(process.env.MIND_ATLAS_OPENCLAW_TIMEOUT_MS ?? 10 * 60 * 1000);
const openClawPromptCharLimit = readPositiveIntEnv("MIND_ATLAS_OPENCLAW_PROMPT_CHAR_LIMIT", 24_000);
const openClawDisabled = process.env.MIND_ATLAS_OPENCLAW_DISABLED === "true";
const openClawLogDir = resolve(process.env.MIND_ATLAS_OPENCLAW_LOG_DIR ?? join(process.cwd(), "server-data", "openclaw-runs"));
let openClawOptionsCache = null;

const claudeBin = process.env.MIND_ATLAS_CLAUDE_BIN ?? "claude";
const claudeModel = process.env.MIND_ATLAS_CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? "";
const claudeBaseUrl = stringOr(process.env.MIND_ATLAS_CLAUDE_ANTHROPIC_BASE_URL, stringOr(process.env.MIND_ATLAS_CLAUDE_BASE_URL, process.env.ANTHROPIC_BASE_URL ?? "")).replace(/\/+$/, "");
const claudeApiKey = process.env.MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY ?? process.env.MIND_ATLAS_CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
const claudeAuthToken = process.env.MIND_ATLAS_CLAUDE_ANTHROPIC_AUTH_TOKEN ?? process.env.MIND_ATLAS_CLAUDE_AUTH_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN ?? "";
const claudeDeepSeekAuthToken = process.env.MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN ?? process.env.DEEPSEEK_API_KEY ?? "";
const claudeWorkspace = process.env.MIND_ATLAS_CLAUDE_WORKSPACE ?? codexWorkspace;
const claudeTimeoutMs = Number(process.env.MIND_ATLAS_CLAUDE_TIMEOUT_MS ?? 60 * 60 * 1000);
const claudePromptCharLimit = readPositiveIntEnv("MIND_ATLAS_CLAUDE_PROMPT_CHAR_LIMIT", 32_000);
const claudeDisabled = process.env.MIND_ATLAS_CLAUDE_DISABLED === "true";
const claudeLogDir = resolve(process.env.MIND_ATLAS_CLAUDE_LOG_DIR ?? join(process.cwd(), "server-data", "claude-runs"));
const claudeDeepSeekBaseUrl = "https://api.deepseek.com/anthropic";

const anthropicChatBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_ANTHROPIC_BASE_URL ?? process.env.MIND_ATLAS_CLAUDE_ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com");
const anthropicChatApiKey = process.env.MIND_ATLAS_ANTHROPIC_API_KEY ?? claudeApiKey;
const anthropicChatAuthToken = process.env.MIND_ATLAS_ANTHROPIC_AUTH_TOKEN ?? claudeAuthToken;
const anthropicChatDefaultModel = process.env.MIND_ATLAS_ANTHROPIC_MODEL ?? claudeModel ?? "claude-opus-4-8";
const anthropicChatModels = parseStringList(process.env.MIND_ATLAS_ANTHROPIC_MODELS, [anthropicChatDefaultModel || "claude-opus-4-8", "claude-opus-4-8", "claude-fable-5"]);
const anthropicChatMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_ANTHROPIC_MAX_OUTPUT_TOKENS", openAiMaxOutputTokens);

const deepSeekChatBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_DEEPSEEK_ANTHROPIC_BASE_URL ?? process.env.MIND_ATLAS_DEEPSEEK_BASE_URL ?? claudeDeepSeekBaseUrl);
const deepSeekChatAuthToken = process.env.MIND_ATLAS_DEEPSEEK_AUTH_TOKEN ?? claudeDeepSeekAuthToken;
const deepSeekChatDefaultModel = process.env.MIND_ATLAS_DEEPSEEK_MODEL ?? "deepseek-v4-pro[1m]";
const deepSeekChatModels = parseStringList(process.env.MIND_ATLAS_DEEPSEEK_MODELS, [deepSeekChatDefaultModel, "deepseek-v4-pro[1m]", "deepseek-v4-flash"]);
const deepSeekChatMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_DEEPSEEK_MAX_OUTPUT_TOKENS", openAiMaxOutputTokens);
const deepSeekBalanceBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_DEEPSEEK_BALANCE_BASE_URL ?? "https://api.deepseek.com");

const realtimeModel = process.env.MIND_ATLAS_REALTIME_MODEL ?? "gpt-realtime-2";
const realtimeVoice = process.env.MIND_ATLAS_REALTIME_VOICE ?? "marin";
const realtimeTranscriptionModel = process.env.MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";
const realtimeReasoningEffort = normalizeRealtimeReasoningEffort(process.env.MIND_ATLAS_REALTIME_REASONING_EFFORT ?? "low");
const allowMockWithoutKey = process.env.MIND_ATLAS_ALLOW_MOCK_WITHOUT_KEY !== "false";
const cloudNotebookDir = resolve(process.env.MIND_ATLAS_CLOUD_DIR ?? join(process.cwd(), "server-data", "notebooks"));
const MAX_PROCESS_OUTPUT_CHARS = readPositiveIntEnv("MIND_ATLAS_PROCESS_OUTPUT_CHAR_LIMIT", 1_500_000);

process.on("uncaughtException", (error) => {
  console.error("[bridge] uncaught exception");
  console.error(error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[bridge] unhandled rejection");
  console.error(reason);
});

function resolveCodexBin(configuredBin, useWsl) {
  const value = String(configuredBin || "codex").trim() || "codex";
  if (useWsl) return value;
  if (process.platform === "win32" && value.toLowerCase() === "codex") {
    if (hasNonWindowsAppsCodexOnPath()) return value;
    const discovered = findVsCodeCodexBin();
    if (discovered) return discovered;
  }
  if (!looksLikePath(value) || existsSync(value)) return value;

  const discovered = findVsCodeCodexBin();
  if (discovered) {
    console.warn(`Configured MIND_ATLAS_CODEX_BIN was not found: ${value}`);
    console.warn(`Using discovered Codex executable instead: ${discovered}`);
    return discovered;
  }

  console.warn(`Configured MIND_ATLAS_CODEX_BIN was not found: ${value}`);
  console.warn("Falling back to 'codex' from PATH.");
  return "codex";
}

function hasNonWindowsAppsCodexOnPath() {
  const pathEntries = String(process.env.PATH ?? "").split(";");
  return pathEntries.some((entry) => {
    const directory = entry.trim();
    if (!directory || /\\WindowsApps(?:\\|$)/i.test(directory)) return false;
    return ["codex.exe", "codex.cmd", "codex"].some((name) => existsSync(join(directory, name)));
  });
}

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value);
}

function findVsCodeCodexBin() {
  if (process.platform !== "win32") return "";
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) return "";
  const extensionRoots = [
    join(userProfile, ".vscode", "extensions"),
    join(userProfile, ".vscode-insiders", "extensions"),
    join(userProfile, ".cursor", "extensions"),
  ];

  for (const root of extensionRoots) {
    if (!existsSync(root)) continue;
    const matches = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("openai.chatgpt-"))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    for (const name of matches) {
      const candidate = join(root, name, "bin", "windows-x86_64", "codex.exe");
      if (existsSync(candidate)) return candidate;
    }
  }

  return "";
}

function resolveOpenClawBin(configuredBin) {
  const value = String(configuredBin || "openclaw").trim() || "openclaw";
  if (looksLikePath(value)) return existsSync(value) ? value : value;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const npmEntrypoint = appData ? join(appData, "npm", "node_modules", "openclaw", "openclaw.mjs") : "";
    if (npmEntrypoint && existsSync(npmEntrypoint)) return npmEntrypoint;
    const npmShim = appData ? join(appData, "npm", "openclaw.cmd") : "";
    if (npmShim && existsSync(npmShim)) return npmShim;
  }
  return value;
}

const server = createBridgeServer(async (request, response) => {
  setCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        bridge: "mind-atlas-bridge",
        openaiConfigured: Boolean(openAiApiKey),
        openAiBaseUrl,
        openAiMode,
        defaultModel,
        maxOutputTokens: openAiMaxOutputTokens,
        localMaxOutputTokens,
        realtimeModel,
        realtimeReasoningEffort,
        transcriptionModel: openAiTranscriptionModel,
        realtimeTranscriptionModel,
        mockFallback: allowMockWithoutKey,
        providers: [
          {
            id: "chat",
            label: "Chat",
            configured: Boolean(openAiApiKey || anthropicChatApiKey || anthropicChatAuthToken || deepSeekChatAuthToken) || allowMockWithoutKey,
            model: defaultModel,
            detail: "OpenAI, Opus, DeepSeek, and Local chat services share the browser Chat entry",
          },
          {
            id: "openai",
            label: "OpenAI",
            configured: Boolean(openAiApiKey) || allowMockWithoutKey,
            model: defaultModel,
            baseUrl: openAiBaseUrl,
            detail: openAiApiKey ? `API key configured; image model ${openAiImageModel}` : "mock fallback",
          },
          {
            id: "local",
            label: "LM Studio",
            configured: true,
            model: "loaded-model",
            baseUrl: localBaseUrl,
            detail: deprecatedLocalModel
              ? "MIND_ATLAS_LOCAL_MODEL is ignored; Local uses the model currently loaded in LM Studio"
              : "Local uses the model currently loaded in LM Studio",
          },
          {
            id: "codex",
            label: "Codex CLI",
            configured: !codexDisabled,
            model: codexModel || "codex-default",
            detail: `${codexUseWsl ? `wsl ${codexBin}` : codexBin}; ${codexSandbox}; ${codexWorkspace}`,
          },
          {
            id: "openclaw",
            label: "OpenClaw CLI",
            configured: !openClawDisabled,
            model: "openclaw-default",
            detail: `${openClawBin}; ${openClawThinking}; ${openClawAgent || "default-agent"}`,
          },
          {
            id: "claude",
            label: "Claude Code",
            configured: !claudeDisabled,
            model: claudeModel || "claude-code-default",
            baseUrl: claudeBaseUrl || undefined,
            detail: `${claudeBin}; ${claudeWorkspace}; ${claudeApiKey || claudeAuthToken || claudeDeepSeekAuthToken ? "auth configured" : "auth not configured"}`,
          },
        ],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/codex/options") {
      const result = await createCodexOptionsResponse();
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/chat/options") {
      const result = createChatOptionsResponse();
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/provider-usage") {
      const result = await createProviderUsageResponse(url.searchParams.get("refresh") === "1");
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/openclaw/options") {
      const result = await createOpenClawOptionsResponse();
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/codex/runs/recover") {
      const payload = await readJson(request);
      const result = await createCodexRunRecoveryResponse(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/git/push") {
      const payload = await readJson(request);
      const result = await createGitPushResponse(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/respond") {
      const payload = await readJson(request);
      const result = await createAiResponse(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/text-partner-turn") {
      const payload = await readJson(request);
      const result = await createTextPartnerTurn(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/client-secret") {
      const payload = await readJson(request);
      const result = await createRealtimeClientSecret(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/realtime/calls") {
      const payload = await readJson(request);
      const answer = await createRealtimeCall(payload);
      response.writeHead(200, { "Content-Type": "application/sdp; charset=utf-8" });
      response.end(answer);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/audio/transcriptions") {
      const result = await createAudioTranscription(request);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tools/web-search") {
      const payload = await readJson(request);
      const result = await createWebSearchResponse(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/cloud/notebooks") {
      const result = await listCloudNotebooks();
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/cloud/notebooks") {
      const result = await saveCloudNotebookPackage(request);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/cloud/notebooks/")) {
      await sendCloudNotebookPackage(url.pathname.slice("/api/cloud/notebooks/".length), response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error instanceof BridgeError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof Error ? error.message : "Unknown bridge error",
    });
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Mind Atlas bridge cannot start because ${host}:${port} is already in use.`);
    console.error("Stop the existing bridge/dev server, then retry.");
    if (process.platform === "win32") {
      console.error(`PowerShell check: Get-NetTCPConnection -LocalPort ${port} | Select-Object LocalAddress,LocalPort,State,OwningProcess`);
    }
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Mind Atlas bridge listening on ${bridgeProtocol}://${host}:${port}`);
  console.log(openAiApiKey ? `OpenAI upstream: ${openAiBaseUrl}` : "OpenAI key not set; mock text responses are enabled.");
  console.log(`Local upstream: ${localBaseUrl}`);
  console.log(`Codex command: ${codexUseWsl ? "wsl " : ""}${codexBin}`);
  console.log(`OpenClaw command: ${openClawBin}`);
  console.log(`Claude Code command: ${claudeBin}${claudeBaseUrl ? ` (${claudeBaseUrl})` : ""}`);
});

function loadLocalEnvFiles() {
  const fileEnv = {
    ...readDotEnvFile(".env"),
    ...readDotEnvFile(".env.local"),
  };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readDotEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return {};

  const parsed = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function createBridgeServer(handler) {
  if (bridgeProtocol !== "https") return createHttpServer(handler);
  if (!httpsKeyPath || !httpsCertPath || !existsSync(httpsKeyPath) || !existsSync(httpsCertPath)) {
    throw new Error("MIND_ATLAS_HTTPS_KEY and MIND_ATLAS_HTTPS_CERT are required when MIND_ATLAS_BRIDGE_PROTOCOL=https");
  }
  return createHttpsServer({
    key: readFileSync(httpsKeyPath),
    cert: readFileSync(httpsCertPath),
  }, handler);
}

async function createAiResponse(payload) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const provider = stringOr(payload?.provider, "openai");
  const prompt = stringOr(payload?.prompt, "");
  const context = payload?.context ?? {};
  // /api/ai/respond is for node anchored AI runs only. Keep it scoped to
  // prompt + explicit Mind Atlas node context; AI Partner log belongs to
  // /api/ai/text-partner-turn and Realtime endpoints.

  if (!prompt.trim()) {
    throw new BridgeError(400, "prompt is required");
  }

  if (provider === "chat" || provider === "openai" || provider === "local") {
    return await createChatAiResponse({
      prompt,
      context,
      settings: normalizeChatSettings(payload?.chat, provider, payload?.model),
      startedAt,
      requestId,
    });
  }

  if (provider === "codex") {
    return await createCodexResponse({
      prompt,
      context,
      model: stringOr(payload?.model, codexModel),
      codex: payload?.codex ?? {},
      startedAt,
    });
  }

  if (provider === "openclaw") {
    return await createOpenClawResponse({
      prompt,
      context,
      openclaw: payload?.openclaw ?? {},
      startedAt,
    });
  }

  if (provider === "claude") {
    return await createClaudeCodeResponse({
      prompt,
      context,
      model: stringOr(payload?.model, claudeModel),
      claude: payload?.claude ?? {},
      startedAt,
    });
  }

  const model = stringOr(payload?.model, defaultModel);
  if (!openAiApiKey) {
    if (!allowMockWithoutKey) throw new BridgeError(503, "OpenAI API key is not configured");
    const output = createMockOutput(prompt, context);
    return {
      id: requestId,
      provider: "mock",
      model,
      output,
      rawText: JSON.stringify(output, null, 2),
      usage: { durationMs: Date.now() - startedAt },
    };
  }

  if (shouldGenerateImage(prompt)) {
    return await createOpenAiImageResponse({
      prompt,
      model: openAiImageModel,
      startedAt,
      requestId,
    });
  }

  const system = buildSystemInstruction();
  const user = buildUserInstruction(prompt, context);
  const data = openAiMode === "chat-completions"
    ? await callChatCompletions(openAiBaseUrl, openAiApiKey, model, system, user, openAiMaxOutputTokens)
    : await callResponses(openAiBaseUrl, openAiApiKey, model, system, user, openAiMaxOutputTokens);
  const rawText = extractModelText(data);
  const output = withCompletionNotice(
    normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt),
    data,
    openAiMaxOutputTokens,
  );

  return {
    id: data.id ?? requestId,
    provider: openAiMode === "chat-completions" ? "openai-compatible" : "openai",
    model,
    output,
    rawText,
    usage: normalizeUsage(data.usage, "openai", Date.now() - startedAt, data, openAiMaxOutputTokens),
  };
}

async function createChatAiResponse({ prompt, context, settings, startedAt, requestId }) {
  if (settings.service === "local") {
    const model = await resolveLoadedLocalModel();
    return await createOpenAiCompatibleResponse({
      baseUrl: localBaseUrl,
      apiKey: localApiKey,
      model,
      prompt,
      context,
      provider: "local",
      startedAt,
      reasoningEffort: "default",
    });
  }

  if (settings.service === "anthropic" || settings.service === "deepseek") {
    return await createAnthropicCompatibleResponse({
      prompt,
      context,
      settings,
      startedAt,
      requestId,
    });
  }

  const model = stringOr(settings.model, defaultModel);
  if (!openAiApiKey) {
    if (!allowMockWithoutKey) throw new BridgeError(503, "OpenAI API key is not configured");
    const output = createMockOutput(prompt, context);
    return {
      id: requestId,
      provider: "mock",
      model,
      output,
      rawText: JSON.stringify(output, null, 2),
      usage: { durationMs: Date.now() - startedAt },
    };
  }

  if (shouldGenerateImage(prompt)) {
    return await createOpenAiImageResponse({
      prompt,
      model: openAiImageModel,
      startedAt,
      requestId,
    });
  }

  const system = buildSystemInstruction();
  const user = buildUserInstruction(prompt, context);
  const data = openAiMode === "chat-completions"
    ? await callChatCompletions(openAiBaseUrl, openAiApiKey, model, system, user, openAiMaxOutputTokens, settings.reasoningEffort)
    : await callResponses(openAiBaseUrl, openAiApiKey, model, system, user, openAiMaxOutputTokens, settings.reasoningEffort);
  const rawText = extractModelText(data);
  const output = withCompletionNotice(
    normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt),
    data,
    openAiMaxOutputTokens,
  );

  return {
    id: data.id ?? requestId,
    provider: openAiMode === "chat-completions" ? "openai-compatible" : "openai",
    model,
    output,
    rawText,
    usage: normalizeUsage(data.usage, "openai", Date.now() - startedAt, data, openAiMaxOutputTokens),
  };
}

async function createAnthropicCompatibleResponse({ prompt, context, settings, startedAt, requestId }) {
  const providerConfig = anthropicProviderConfig(settings);
  const model = stringOr(settings.model, providerConfig.defaultModel);
  if (!providerConfig.apiKey && !providerConfig.authToken) {
    throw new BridgeError(503, `${providerConfig.label} API key is not configured`);
  }
  const data = await callAnthropicMessages({
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    authToken: providerConfig.authToken,
    model,
    system: buildSystemInstruction(),
    messages: [{ role: "user", content: buildUserInstruction(prompt, context) }],
    tools: [],
    maxOutputTokens: providerConfig.maxOutputTokens,
    effort: settings.reasoningEffort,
  });
  const rawText = extractAnthropicText(data);
  const output = withCompletionNotice(
    normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt),
    data,
    providerConfig.maxOutputTokens,
  );
  return {
    id: data.id ?? requestId,
    provider: settings.service,
    model: stringOr(data.model, model),
    output,
    rawText,
    usage: normalizeUsage(data.usage, settings.service, Date.now() - startedAt, data, providerConfig.maxOutputTokens),
  };
}

async function createOpenAiCompatibleResponse({ baseUrl, apiKey, model, prompt, context, provider, startedAt, reasoningEffort = "default" }) {
  const system = buildSystemInstruction();
  const user = provider === "local" ? buildLocalUserInstruction(prompt, context) : buildUserInstruction(prompt, context);
  const maxOutputTokens = provider === "local" ? localMaxOutputTokens : openAiMaxOutputTokens;
  const data = await callChatCompletions(baseUrl, apiKey, model, system, user, maxOutputTokens, reasoningEffort);
  const rawText = extractModelText(data);
  const output = withCompletionNotice(
    normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt),
    data,
    maxOutputTokens,
  );
  const responseModel = stringOr(data?.model, model || "loaded-local-model");
  return {
    id: data.id ?? randomUUID(),
    provider,
    model: responseModel,
    output,
    rawText,
    usage: normalizeUsage(data.usage, provider, Date.now() - startedAt, data, maxOutputTokens),
  };
}

async function resolveLoadedLocalModel() {
  let data;
  try {
    const upstream = await fetch(`${localBaseUrl}/models`, {
      method: "GET",
      headers: openAiHeaders(localApiKey),
    });
    data = await readUpstreamJson(upstream);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError(
      503,
      `Could not inspect LM Studio loaded models at ${localBaseUrl}/models. Start LM Studio local server and load a model, then retry Local. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const loadedModel = extractLoadedLocalModelId(data);
  if (!loadedModel) {
    throw new BridgeError(409, "LM Studio model is unloaded. Load one model in LM Studio, then retry Local.");
  }
  return loadedModel;
}

function extractLoadedLocalModelId(data) {
  const models = Array.isArray(data?.data) ? data.data : [];
  for (const model of models) {
    const id = stringOr(model?.id, "");
    if (id) return id;
  }
  return "";
}

async function createTextPartnerTurn(payload) {
  const startedAt = Date.now();
  const provider = stringOr(payload?.provider, "openai");
  if (!["openai", "anthropic", "deepseek", "local"].includes(provider)) {
    throw new BridgeError(400, "text partner provider must be openai, anthropic, deepseek, or local");
  }
  const settings = normalizeChatSettings(payload, provider, payload?.model);
  const context = payload?.context ?? {};
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) throw new BridgeError(400, "messages are required");
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const summary = payload?.summary?.text ? String(payload.summary.text).slice(0, 4000) : "";
  const voiceLogContext = stringOr(payload?.voiceLogContext, "").slice(0, 14000);

  if (settings.service === "local") {
    const model = await resolveLoadedLocalModel();
    const data = await callChatToolTurn(localBaseUrl, localApiKey, model, "local", context, messages, tools, summary, voiceLogContext);
    return textPartnerResultWithoutRaw(data, "local", startedAt, localMaxOutputTokens);
  }

  if (settings.service === "anthropic" || settings.service === "deepseek") {
    const providerConfig = anthropicProviderConfig(settings);
    const model = stringOr(settings.model, providerConfig.defaultModel);
    if (!providerConfig.apiKey && !providerConfig.authToken) {
      throw new BridgeError(503, `${providerConfig.label} API key is not configured`);
    }
    const data = await callAnthropicToolTurn(providerConfig, model, context, messages, tools, summary, voiceLogContext, settings.reasoningEffort);
    return textPartnerResultWithoutRaw(data, settings.service, startedAt, providerConfig.maxOutputTokens);
  }

  const model = stringOr(settings.model, defaultModel);
  if (!openAiApiKey) {
    if (!allowMockWithoutKey) throw new BridgeError(503, "OpenAI API key is not configured");
    return {
      text: "Mock AI/Partner response because OpenAI API key is not configured.",
      toolCalls: [],
      provider: "mock",
      model,
      usage: { durationMs: Date.now() - startedAt },
    };
  }

  const data = openAiMode === "chat-completions"
    ? await callChatToolTurn(openAiBaseUrl, openAiApiKey, model, "openai", context, messages, tools, summary, voiceLogContext, settings.reasoningEffort)
    : await callResponsesToolTurn(openAiBaseUrl, openAiApiKey, model, context, messages, tools, summary, voiceLogContext, settings.reasoningEffort);
  return textPartnerResultWithoutRaw(data, "openai", startedAt, openAiMaxOutputTokens);
}

function textPartnerResultWithoutRaw(data, provider, startedAt, maxOutputTokens) {
  return {
    text: stringOr(data?.text, ""),
    toolCalls: Array.isArray(data?.toolCalls) ? data.toolCalls : [],
    provider: stringOr(data?.provider, provider),
    model: stringOr(data?.model, ""),
    usage: normalizeUsage(data?.raw?.usage, provider, Date.now() - startedAt, data?.raw, maxOutputTokens),
  };
}

async function callResponsesToolTurn(baseUrl, apiKey, model, context, messages, tools, summary, voiceLogContext, reasoningEffort = "default") {
  const body = {
    model,
    instructions: buildMindAtlasPartnerInstructions({
      mode: "text",
      summary,
      voiceLogContext,
      context,
    }),
    input: buildTextPartnerInput(messages),
    tools: normalizeRealtimeTools(tools),
    tool_choice: "auto",
    max_output_tokens: openAiMaxOutputTokens,
  };
  applyOpenAiReasoning(body, reasoningEffort);
  const upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const raw = await readUpstreamJson(upstream);
  return {
    text: extractAssistantText(raw),
    toolCalls: extractResponsesToolCalls(raw),
    provider: "openai",
    model,
    raw,
  };
}

async function callChatToolTurn(baseUrl, apiKey, model, provider, context, messages, tools, summary, voiceLogContext, reasoningEffort = "default") {
  const local = provider === "local";
  const systemContent = buildMindAtlasPartnerInstructions({
    mode: "text",
    summary: local ? truncateText(summary, localPartnerSummaryCharLimit) : summary,
    voiceLogContext: local ? truncateFromStart(voiceLogContext, localPartnerLogCharLimit) : voiceLogContext,
    context: local ? compactAiContextForLocal(context) : context,
    contextCharLimit: local ? localPromptContextCharLimit : 8000,
    compactedForLocal: local,
  });
  const body = {
    messages: [
      {
        role: "system",
        content: local ? fitLocalPartnerSystemPrompt(systemContent) : systemContent,
      },
      ...buildChatPartnerMessages(local ? compactPartnerMessagesForLocal(messages) : messages),
    ],
    tools: normalizeChatTools(tools, { compact: local }),
    tool_choice: "auto",
    max_tokens: provider === "local" ? localMaxOutputTokens : openAiMaxOutputTokens,
  };
  if (model) body.model = model;
  applyChatCompletionsReasoning(body, reasoningEffort);
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const raw = await readUpstreamJson(upstream);
  return {
    text: extractAssistantText(raw),
    toolCalls: extractChatToolCalls(raw),
    provider,
    model: stringOr(raw?.model, model || "loaded-local-model"),
    raw,
  };
}

async function callAnthropicToolTurn(providerConfig, model, context, messages, tools, summary, voiceLogContext, effort) {
  const raw = await callAnthropicMessages({
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    authToken: providerConfig.authToken,
    model,
    system: buildMindAtlasPartnerInstructions({
      mode: "text",
      summary,
      voiceLogContext,
      context,
    }),
    messages: buildAnthropicPartnerMessages(messages),
    tools: normalizeAnthropicTools(tools),
    maxOutputTokens: providerConfig.maxOutputTokens,
    effort,
  });
  return {
    text: extractAnthropicText(raw),
    toolCalls: extractAnthropicToolCalls(raw),
    provider: providerConfig.provider,
    model: stringOr(raw?.model, model),
    raw,
  };
}

async function callAnthropicMessages({ baseUrl, apiKey, authToken, model, system, messages, tools, maxOutputTokens, effort }) {
  const body = {
    model,
    max_tokens: maxOutputTokens,
    system,
    messages,
  };
  if (tools.length) body.tools = tools;
  applyAnthropicEffort(body, effort);
  const upstream = await fetch(anthropicMessagesUrl(baseUrl), {
    method: "POST",
    headers: anthropicHeaders({ apiKey, authToken }),
    body: JSON.stringify(body),
  });
  return await readUpstreamJson(upstream);
}

function anthropicProviderConfig(settings) {
  if (settings.service === "deepseek") {
    return {
      provider: "deepseek",
      label: "DeepSeek",
      baseUrl: deepSeekChatBaseUrl,
      apiKey: "",
      authToken: deepSeekChatAuthToken,
      defaultModel: deepSeekChatDefaultModel,
      maxOutputTokens: deepSeekChatMaxOutputTokens,
    };
  }
  return {
    provider: "anthropic",
    label: "Opus",
    baseUrl: anthropicChatBaseUrl,
    apiKey: anthropicChatApiKey,
    authToken: anthropicChatAuthToken,
    defaultModel: anthropicChatDefaultModel || "claude-opus-4-8",
    maxOutputTokens: anthropicChatMaxOutputTokens,
  };
}

async function createOpenAiImageResponse({ prompt, model, startedAt, requestId }) {
  const data = await callImageGenerations(openAiBaseUrl, openAiApiKey, model, prompt);
  const generatedAttachments = await extractGeneratedImageAttachments(data, prompt);
  if (!generatedAttachments.length) {
    throw new BridgeError(502, "OpenAI image generation completed without image data.");
  }

  const title = imageTitleFromPrompt(prompt);
  const output = normalizeAiOutput({
    title,
    body: `画像を生成しました。返答ノードの添付ファイルを確認してください。\n\nPrompt: ${prompt}`,
    summary: `${generatedAttachments.length} image attachment(s) generated from the prompt.`,
    suggestedStatus: "done",
    tags: ["image", "openai", "generated"],
  }, prompt);

  return {
    id: data.id ?? requestId,
    provider: "openai",
    model,
    output,
    generatedAttachments,
    rawText: JSON.stringify({
      id: data.id,
      created: data.created,
      model,
      attachmentCount: generatedAttachments.length,
      revisedPrompts: generatedAttachments.map((attachment) => attachment.revisedPrompt).filter(Boolean),
    }, null, 2),
    usage: normalizeUsage(data.usage, "openai", Date.now() - startedAt),
  };
}

async function createCodexOptionsResponse() {
  const fallback = createFallbackCodexOptions();
  if (codexDisabled) return fallback;
  const cacheIsFresh = codexOptionsCache && Date.now() - codexOptionsCache.createdAt < 60_000;
  if (cacheIsFresh) return codexOptionsCache.value;

  try {
    const models = await readCodexModels();
    const value = {
      ...fallback,
      models: models.length ? models : fallback.models,
      defaultModel: codexModel || models[0]?.model || fallback.defaultModel,
      defaultReasoningEffort: codexReasoningEffort,
    };
    codexOptionsCache = { createdAt: Date.now(), value };
    return value;
  } catch {
    codexOptionsCache = { createdAt: Date.now(), value: fallback };
    return fallback;
  }
}

function createChatOptionsResponse() {
  return {
    defaultService: "openai",
    services: [
      {
        id: "openai",
        label: "OpenAI",
        configured: Boolean(openAiApiKey) || allowMockWithoutKey,
        defaultModel,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["default", "none", "minimal", "low", "medium", "high", "xhigh"],
        models: createChatModelOptions(openAiChatModels, "medium", ["default", "none", "minimal", "low", "medium", "high", "xhigh"]),
        baseUrl: openAiBaseUrl,
        detail: openAiApiKey ? "OpenAI key configured" : "mock fallback",
      },
      {
        id: "anthropic",
        label: "Opus",
        configured: Boolean(anthropicChatApiKey || anthropicChatAuthToken),
        defaultModel: anthropicChatDefaultModel || "claude-opus-4-8",
        defaultReasoningEffort: "default",
        supportedReasoningEfforts: ["default", "low", "medium", "high", "max"],
        models: createChatModelOptions(anthropicChatModels, "default", ["default", "low", "medium", "high", "max"]),
        baseUrl: anthropicChatBaseUrl,
        detail: anthropicChatApiKey || anthropicChatAuthToken ? "Anthropic key configured" : "Anthropic key not configured",
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        configured: Boolean(deepSeekChatAuthToken),
        defaultModel: deepSeekChatDefaultModel,
        defaultReasoningEffort: "max",
        supportedReasoningEfforts: ["default", "low", "medium", "high", "max"],
        models: createChatModelOptions(deepSeekChatModels, "max", ["default", "low", "medium", "high", "max"]),
        baseUrl: deepSeekChatBaseUrl,
        detail: deepSeekChatAuthToken ? "DeepSeek key configured" : "DeepSeek key not configured",
      },
      {
        id: "local",
        label: "Local",
        configured: true,
        defaultModel: "",
        defaultReasoningEffort: "default",
        supportedReasoningEfforts: ["default"],
        models: [
          {
            model: "",
            displayName: "Loaded local model",
            defaultReasoningEffort: "default",
            supportedReasoningEfforts: ["default"],
          },
        ],
        baseUrl: localBaseUrl,
        detail: deprecatedLocalModel
          ? "MIND_ATLAS_LOCAL_MODEL is ignored; Local uses the model currently loaded in LM Studio"
          : "Local uses the model currently loaded in LM Studio",
      },
    ],
  };
}

async function createProviderUsageResponse(forceRefresh = false) {
  const cacheIsFresh = providerUsageCache && Date.now() - providerUsageCache.createdAt < 45_000;
  if (!forceRefresh && cacheIsFresh) return providerUsageCache.value;

  const [openAiMetrics, deepSeekMetrics] = await Promise.all([
    createOpenAiRateLimitMetrics(),
    createDeepSeekBalanceMetrics(),
  ]);
  const value = {
    fetchedAt: new Date().toISOString(),
    metrics: [
      ...openAiMetrics,
      ...deepSeekMetrics,
    ],
  };
  providerUsageCache = { createdAt: Date.now(), value };
  return value;
}

async function createOpenAiRateLimitMetrics() {
  try {
    const response = await readCodexAppServerRateLimits();
    const snapshot = response?.rateLimitsByLimitId?.codex ?? response?.rateLimits;
    return [
      createOpenAiRateLimitMetric("openai-rate-primary", snapshot?.primary, "CODEX 5H", snapshot?.planType),
      createOpenAiRateLimitMetric("openai-rate-secondary", snapshot?.secondary, "CODEX 7D", snapshot?.planType),
    ];
  } catch {
    return [
      createUnavailableProviderMetric("openai-rate-primary", "openai", "OPENAI", "rate_limit", "CODEX 5H", "codex", "Codex rate limits unavailable"),
      createUnavailableProviderMetric("openai-rate-secondary", "openai", "OPENAI", "rate_limit", "CODEX 7D", "codex", "Codex rate limits unavailable"),
    ];
  }
}

function createOpenAiRateLimitMetric(id, window, fallbackLabel, planType) {
  const usedPercent = numberOrUndefined(window?.usedPercent);
  if (usedPercent === undefined) {
    return createUnavailableProviderMetric(id, "openai", "OPENAI", "rate_limit", fallbackLabel, "codex", "Codex rate limit window unavailable");
  }
  const remainingPercent = clampNumber(100 - usedPercent, 0, 100);
  return {
    id,
    vendor: "openai",
    vendorLabel: "OPENAI",
    kind: "rate_limit",
    label: formatRateLimitWindowLabel(window?.windowDurationMins, fallbackLabel),
    available: true,
    displayValue: `${Math.round(remainingPercent)}%`,
    value: remainingPercent,
    unit: "%",
    barPercent: remainingPercent,
    resetAt: unixSecondsToIso(window?.resetsAt),
    detail: planType ? `Codex ${String(planType).toUpperCase()} plan remaining` : "Codex remaining rate limit",
    source: "codex",
    defaultVisible: true,
  };
}

async function createDeepSeekBalanceMetrics() {
  if (!deepSeekChatAuthToken) {
    return [
      createUnavailableProviderMetric(
        "deepseek-balance",
        "deepseek",
        "DEEPSEEK",
        "balance",
        "BALANCE",
        "api",
        "DeepSeek API key not configured",
      ),
    ];
  }
  try {
    const upstream = await fetch(`${deepSeekBalanceBaseUrl}/user/balance`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${deepSeekChatAuthToken}`,
      },
    });
    if (!upstream.ok) throw new Error(`DeepSeek balance failed with ${upstream.status}`);
    const data = await upstream.json();
    const balanceInfos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
    const balance = balanceInfos.find((item) => String(item?.currency).toUpperCase() === "USD") ?? balanceInfos[0];
    const totalBalance = numberOrUndefined(balance?.total_balance);
    if (!balance || totalBalance === undefined) throw new Error("DeepSeek balance payload was empty");
    const currency = String(balance.currency || "USD").toUpperCase();
    const granted = numberOrUndefined(balance.granted_balance);
    const toppedUp = numberOrUndefined(balance.topped_up_balance);
    return [{
      id: "deepseek-balance",
      vendor: "deepseek",
      vendorLabel: "DEEPSEEK",
      kind: "balance",
      label: "BALANCE",
      available: data?.is_available === true,
      displayValue: `${currency} ${formatBalance(totalBalance)}`,
      value: totalBalance,
      unit: currency,
      barPercent: data?.is_available === true && totalBalance > 0 ? 100 : 0,
      detail: [
        granted !== undefined ? `granted ${currency} ${formatBalance(granted)}` : "",
        toppedUp !== undefined ? `topped up ${currency} ${formatBalance(toppedUp)}` : "",
      ].filter(Boolean).join("; "),
      source: "api",
      defaultVisible: true,
    }];
  } catch {
    return [
      createUnavailableProviderMetric(
        "deepseek-balance",
        "deepseek",
        "DEEPSEEK",
        "balance",
        "BALANCE",
        "api",
        "DeepSeek balance unavailable",
      ),
    ];
  }
}

function createUnavailableProviderMetric(id, vendor, vendorLabel, kind, label, source, detail) {
  return {
    id,
    vendor,
    vendorLabel,
    kind,
    label,
    available: false,
    displayValue: "N/A",
    barPercent: 0,
    detail,
    source,
    defaultVisible: true,
  };
}

function formatRateLimitWindowLabel(durationMinutes, fallbackLabel) {
  const minutes = numberOrUndefined(durationMinutes);
  if (minutes === undefined || minutes <= 0) return fallbackLabel;
  if (minutes % (24 * 60) === 0) return `CODEX ${minutes / (24 * 60)}D`;
  if (minutes % 60 === 0) return `CODEX ${minutes / 60}H`;
  return `CODEX ${minutes}M`;
}

function unixSecondsToIso(value) {
  const seconds = numberOrUndefined(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function formatBalance(value) {
  return Number(value).toFixed(2);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function createOpenClawOptionsResponse() {
  const fallback = createFallbackOpenClawOptions();
  if (openClawDisabled) return fallback;
  const cacheIsFresh = openClawOptionsCache && Date.now() - openClawOptionsCache.createdAt < 60_000;
  if (cacheIsFresh) return openClawOptionsCache.value;

  try {
    const commandSpec = buildOpenClawCommand(["models", "list", "--json"]);
    const result = await runProcess(commandSpec.command, commandSpec.args, "", 15_000, process.cwd());
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `OpenClaw models exited with ${result.exitCode}`);
    const parsed = parseJsonText(result.stdout);
    const listedModels = Array.isArray(parsed?.models) ? parsed.models : [];
    const models = listedModels
      .filter((model) => model?.available !== false && model?.missing !== true)
      .map(normalizeOpenClawModelOption)
      .filter(Boolean);
    const taggedDefault = listedModels.find((model) => Array.isArray(model?.tags) && model.tags.includes("default"));
    const taggedDefaultModel = stringOr(taggedDefault?.key, "");
    const value = {
      ...fallback,
      models: models.length ? models : fallback.models,
      defaultModel: models.some((model) => model.model === taggedDefaultModel)
        ? taggedDefaultModel
        : models[0]?.model ?? fallback.defaultModel,
    };
    openClawOptionsCache = { createdAt: Date.now(), value };
    return value;
  } catch {
    openClawOptionsCache = { createdAt: Date.now(), value: fallback };
    return fallback;
  }
}

function createFallbackOpenClawOptions() {
  return {
    models: [],
    defaultModel: "",
    defaultTimeoutMs: openClawTimeoutMs,
  };
}

function normalizeOpenClawModelOption(model) {
  const key = stringOr(model?.key, "");
  if (!key) return null;
  return {
    model: key,
    displayName: stringOr(model?.name, key),
    input: stringOr(model?.input, ""),
    contextWindow: numberOrUndefined(model?.contextWindow),
    local: model?.local === true,
  };
}

function createChatModelOptions(models, defaultReasoningEffort, supportedReasoningEfforts) {
  return Array.from(new Set(models.map((model) => String(model || "").trim()).filter(Boolean)))
    .map((model) => ({
      model,
      displayName: model,
      defaultReasoningEffort,
      supportedReasoningEfforts,
    }));
}

async function readCodexModels() {
  const overrideModels = parseCodexModelOverride(codexModelsOverride);
  if (overrideModels.length) return overrideModels;

  const command = codexUseWsl ? "wsl" : codexBin;
  const args = codexUseWsl ? [codexBin, "debug", "models"] : ["debug", "models"];
  const result = await runProcess(command, args, "", 10_000, codexWorkspace);
  if (result.exitCode !== 0) return [];
  const parsed = parseJsonText(result.stdout);
  const models = Array.isArray(parsed?.models) ? parsed.models : [];
  return models.map(normalizeCodexModelOption).filter(Boolean);
}

function createFallbackCodexOptions() {
  const fallbackModels = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"].map((model) => ({
    model,
    displayName: model.toUpperCase(),
    description: "Codex CLI model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  }));
  return {
    models: fallbackModels,
    defaultModel: codexModel || "gpt-5.5",
    defaultReasoningEffort: codexReasoningEffort,
    defaultWorkspace: codexWorkspace,
    defaultSandbox: codexSandbox,
    defaultTimeoutMs: codexTimeoutMs,
  };
}

async function createCodexRunRecoveryResponse(payload) {
  const candidate = await findRecoverableCodexRun(payload);
  if (!candidate) return { found: false };

  const responsePath = join(candidate.directory, "response.json");
  if (existsSync(responsePath)) {
    const cached = parseJsonText(await readFile(responsePath, "utf8"));
    if (cached && typeof cached === "object") {
      return {
        found: true,
        result: {
          ...cached,
          codexLogPath: cached.codexLogPath || candidate.directory,
        },
        logPath: candidate.directory,
        metadata: candidate.metadata,
      };
    }
  }

  const prompt = await readOptionalText(join(candidate.directory, "prompt.txt"));
  const stdout = await readOptionalText(join(candidate.directory, "stdout.jsonl"));
  const stderr = await readOptionalText(join(candidate.directory, "stderr.txt"));
  const lastMessage = await readOptionalText(join(candidate.directory, "last-message.md"));
  const events = parseJsonText(await readOptionalText(join(candidate.directory, "events.json"))) || parseCodexJsonl(stdout);
  const startedAt = Date.parse(stringOr(candidate.metadata.startedAt, ""));
  const completedAt = Date.parse(stringOr(candidate.metadata.completedAt, ""));
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) ? Math.max(0, completedAt - startedAt) : 0;
  const settings = normalizeCodexSettings({
    model: candidate.metadata.model,
    reasoningEffort: candidate.metadata.reasoningEffort,
    sandbox: candidate.metadata.sandbox,
    workspace: candidate.metadata.workspace,
    webSearch: candidate.metadata.webSearch === true,
    skipGitRepoCheck: candidate.metadata.skipGitRepoCheck === true,
    fullAccessApproved: candidate.metadata.sandbox === "danger-full-access",
    continueMode: candidate.metadata.continueMode,
    resumeThreadId: candidate.metadata.resumeThreadId,
    clientRunId: candidate.metadata.clientRunId,
    requestNodeId: candidate.metadata.requestNodeId,
    sourceNodeId: candidate.metadata.sourceNodeId,
  }, candidate.metadata.model, {});
  const result = {
    stdout,
    stderr,
    exitCode: Number.isFinite(Number(candidate.metadata.exitCode)) ? Number(candidate.metadata.exitCode) : 0,
    lastMessage,
    events: Array.isArray(events) ? events : [],
    usage: extractCodexUsage(stdout),
    codexThreadId: stringOr(candidate.metadata.codexThreadId, ""),
    codexLogPath: candidate.directory,
  };
  const response = buildCodexResponseFromRun({
    prompt,
    context: {},
    settings,
    result,
    gitStatus: stringOr(candidate.metadata.gitStatus, ""),
    durationMs,
  });
  await saveCodexResponseLog(candidate.directory, response);
  return { found: true, result: response, logPath: candidate.directory, metadata: candidate.metadata };
}

async function findRecoverableCodexRun(payload) {
  const metadataFiles = await listCodexMetadataFiles(codexLogDir);
  const candidates = [];
  for (const filePath of metadataFiles) {
    const metadata = parseJsonText(await readOptionalText(filePath));
    if (!metadata || typeof metadata !== "object") continue;
    if (!matchesCodexRecoveryRequest(metadata, payload)) continue;
    candidates.push({ metadata, directory: resolve(filePath, "..") });
  }
  candidates.sort((left, right) => Date.parse(stringOr(right.metadata.startedAt, "")) - Date.parse(stringOr(left.metadata.startedAt, "")));
  return candidates[0] ?? null;
}

async function listCodexMetadataFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listCodexMetadataFiles(entryPath));
    } else if (entry.isFile() && entry.name === "metadata.json") {
      files.push(entryPath);
    }
  }
  return files;
}

function matchesCodexRecoveryRequest(metadata, payload) {
  const runId = stringOr(payload?.runId, "");
  const requestNodeId = stringOr(payload?.requestNodeId, "");
  const sourceNodeId = stringOr(payload?.sourceNodeId, "");
  const threadId = stringOr(payload?.threadId, "");
  const workspace = normalizeWorkspaceForMatch(payload?.workspace);
  const metadataWorkspace = normalizeWorkspaceForMatch(metadata?.workspace);
  if (runId && metadata?.clientRunId && metadata.clientRunId !== runId) return false;
  if (requestNodeId && metadata?.requestNodeId && metadata.requestNodeId !== requestNodeId) return false;
  if (sourceNodeId && metadata?.sourceNodeId && metadata.sourceNodeId !== sourceNodeId) return false;
  const exactMatch = (runId && metadata?.clientRunId === runId) || (requestNodeId && metadata?.requestNodeId === requestNodeId);
  if (!exactMatch) {
    if (threadId && metadata?.codexThreadId !== threadId && metadata?.resumeThreadId !== threadId) return false;
    if (!threadId && workspace && metadataWorkspace !== workspace) return false;
  }
  if (workspace && metadataWorkspace && metadataWorkspace !== workspace && !threadId && !runId && !requestNodeId) return false;
  const startedAfter = Date.parse(stringOr(payload?.startedAfter, ""));
  const startedAt = Date.parse(stringOr(metadata?.startedAt, ""));
  if (Number.isFinite(startedAfter) && Number.isFinite(startedAt) && startedAt < startedAfter - 2 * 60 * 1000) return false;
  return Boolean(exactMatch || threadId || workspace);
}

function normalizeWorkspaceForMatch(value) {
  return stringOr(value, "").replace(/[\\\/]+$/, "").toLowerCase();
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseCodexModelOverride(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((model) => ({
      model,
      displayName: model,
      defaultReasoningEffort: codexReasoningEffort,
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    }));
}

function parseStringList(value, fallback = []) {
  const parsed = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed.length ? parsed : fallback.filter(Boolean)));
}

function normalizeChatSettings(input, provider, model) {
  const requestedService = stringOr(input?.service, provider);
  const service = requestedService === "anthropic" || requestedService === "deepseek" || requestedService === "local"
    ? requestedService
    : "openai";
  return {
    service,
    model: stringOr(input?.model, stringOr(model, defaultChatModelForService(service))),
    reasoningEffort: normalizeChatReasoningEffort(input?.reasoningEffort),
  };
}

function defaultChatModelForService(service) {
  if (service === "anthropic") return anthropicChatDefaultModel || "claude-opus-4-8";
  if (service === "deepseek") return deepSeekChatDefaultModel;
  if (service === "local") return "";
  return defaultModel;
}

function normalizeChatReasoningEffort(value) {
  return ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value) ? value : "default";
}

function normalizeRealtimeReasoningEffort(value) {
  return ["default", "low", "medium", "high"].includes(value) ? value : "default";
}

function normalizeCodexModelOption(model) {
  const slug = stringOr(model?.slug ?? model?.model, "");
  if (!slug) return null;
  const supported = Array.isArray(model?.supported_reasoning_levels)
    ? model.supported_reasoning_levels.map((item) => normalizeReasoningEffort(item?.effort)).filter(Boolean)
    : ["low", "medium", "high", "xhigh"];
  return {
    model: slug,
    displayName: stringOr(model?.display_name, slug),
    description: stringOr(model?.description, ""),
    defaultReasoningEffort: normalizeReasoningEffort(model?.default_reasoning_level ?? codexReasoningEffort),
    supportedReasoningEfforts: supported.length ? supported : ["low", "medium", "high", "xhigh"],
  };
}

async function createCodexResponse({ prompt, context, model, codex, startedAt }) {
  if (codexDisabled) throw new BridgeError(503, "Codex CLI is disabled");
  const settings = normalizeCodexSettings(codex, model, context);
  settings.webSearch = true;
  settings.skipGitRepoCheck = await shouldSkipCodexGitRepoCheck(settings.workspace);
  const codexPrompt = buildCodexPrompt(prompt, context, settings);
  const beforeGitStatus = await collectGitStatus(settings.workspace);
  const result = await runCodex(codexPrompt, settings);
  const durationMs = Date.now() - startedAt;
  const afterGitStatus = await collectGitStatus(settings.workspace);
  const gitStatus = diffGitStatus(beforeGitStatus, afterGitStatus);
  const response = buildCodexResponseFromRun({ prompt, context, settings, result, gitStatus, durationMs });
  await saveCodexResponseLog(result.codexLogPath, response);
  return response;
}

function buildCodexResponseFromRun({ prompt, context, settings, result, gitStatus = "", durationMs }) {
  const body = [
    result.lastMessage || result.stdout || "Codex did not produce a final message.",
    result.exitCode !== 0 && result.stderr.trim() ? `\n\nstderr:\n${result.stderr.trim()}` : "",
  ].join("").trim();
  const modelId = settings.model || "codex-cli";
  return {
    id: randomUUID(),
    provider: "codex",
    model: modelId,
    output: normalizeAiOutput({
      title: "Codex result",
      body,
      summary: body.split("\n").find(Boolean) ?? "Codex run completed.",
      suggestedStatus: result.exitCode === 0 ? "needs_review" : "needs_review",
      tags: ["codex", "code"],
    }, prompt),
    codexNodes: buildCodexNodes({
      prompt,
      context,
      settings,
      result,
      gitStatus,
      durationMs,
    }),
    codexThreadId: result.codexThreadId,
    codexLogPath: result.codexLogPath,
    rawText: result.stdout,
    usage: {
      ...normalizeCodexUsage(result.usage),
      durationMs,
    },
  };
}

async function saveCodexResponseLog(logPath, response) {
  if (!logPath) return;
  try {
    await writeFile(join(logPath, "response.json"), JSON.stringify(response, null, 2), "utf8");
  } catch (error) {
    console.warn(`[bridge] failed to save Codex response log: ${error instanceof Error ? error.message : error}`);
  }
}

async function createOpenClawResponse({ prompt, context, openclaw, startedAt }) {
  if (openClawDisabled) throw new BridgeError(503, "OpenClaw CLI is disabled");
  const settings = normalizeOpenClawSettings(openclaw);
  const openClawPrompt = buildOpenClawPrompt(prompt, context, settings);
  const result = await runOpenClaw(openClawPrompt, settings);
  const durationMs = Date.now() - startedAt;
  const parsed = parseOpenClawJson(result.stdout);
  const finalText = extractOpenClawText(parsed) || result.stdout.trim();
  const body = [
    finalText || "OpenClaw did not produce a final message.",
    result.exitCode !== 0 && result.stderr.trim() ? `\n\nstderr:\n${result.stderr.trim()}` : "",
  ].join("").trim();
  const output = normalizeAiOutput({
    title: result.exitCode === 0 ? "OpenClaw result" : "OpenClaw issue",
    body,
    summary: (finalText || result.stderr || "OpenClaw run completed.").split("\n").find(Boolean)?.slice(0, 220) ?? "OpenClaw run completed.",
    suggestedStatus: "needs_review",
    tags: ["openclaw", "code"],
  }, prompt);
  const response = {
    id: randomUUID(),
    provider: "openclaw",
    model: stringOr(parsed?.model, stringOr(parsed?.meta?.agentMeta?.model, settings.model || "openclaw-cli")),
    output,
    openClawSessionKey: result.openClawSessionKey,
    openClawLogPath: result.openClawLogPath,
    rawText: result.stdout,
    usage: {
      ...normalizeOpenClawUsage(parsed?.usage ?? parsed?.meta?.agentMeta?.usage ?? parsed),
      durationMs,
    },
  };
  await saveOpenClawResponseLog(result.openClawLogPath, response);
  return response;
}

async function runOpenClaw(prompt, settings) {
  assertExistingWorkspace(settings.workspace, "OpenClaw");
  const startedAt = new Date().toISOString();
  const sessionKey = buildOpenClawSessionKey(settings);
  const boundedPrompt = truncateText(prompt, openClawPromptCharLimit);
  const args = [
    "agent",
    "--local",
    "--json",
    "--message",
    boundedPrompt,
    "--thinking",
    settings.thinking,
    "--timeout",
    String(Math.max(1, Math.ceil(settings.timeoutMs / 1000))),
    "--session-key",
    sessionKey,
  ];
  if (settings.model) args.push("--model", settings.model);
  if (settings.agent) args.push("--agent", settings.agent);

  const commandSpec = buildOpenClawCommand(args);
  const result = await runProcess(commandSpec.command, commandSpec.args, "", settings.timeoutMs, settings.workspace);
  const completedAt = new Date().toISOString();
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new BridgeError(502, result.stderr.trim() || `OpenClaw CLI exited with ${result.exitCode}`);
  }
  const openClawLogPath = await saveOpenClawRunLog({
    settings,
    prompt: boundedPrompt,
    result,
    command: commandSpec.command,
    args: commandSpec.args,
    startedAt,
    completedAt,
    openClawSessionKey: sessionKey,
  });
  return { ...result, openClawSessionKey: sessionKey, openClawLogPath };
}

function buildOpenClawCommand(args) {
  if (/\.mjs$/i.test(openClawBin)) {
    return { command: process.execPath, args: [openClawBin, ...args] };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(openClawBin)) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", openClawBin, ...args] };
  }
  return { command: openClawBin, args };
}

function buildOpenClawPrompt(prompt, context, settings) {
  const rootSurfaceRun = context?.selectedNode?.id === "atlas-root" && context?.scope === "minimal";
  const contextSummary = JSON.stringify({
    selectedNode: context?.selectedNode,
    selectedNodes: context?.selectedNodes,
    path: context?.path,
    siblingNodes: context?.siblingNodes,
    scope: context?.scope,
    stats: context?.stats,
  }, null, 2);
  return [
    "You are OpenClaw CLI invoked from Mind Atlas.",
    rootSurfaceRun
      ? "Mind Atlas is a spatial tree notebook. This is a root-surface AI Partner run: use the user request, OpenClaw defaults, and only the minimal root context below."
      : "Mind Atlas is a spatial tree notebook. This is a node-anchored run: use only the explicit node context below, plus files/tools you can access through OpenClaw.",
    rootSurfaceRun
      ? "Return a concise final answer suitable for saving in the AI Partner log."
      : "Return a concise final answer suitable for saving as a child Mind Atlas node.",
    "Do not change OpenClaw or LM Studio configuration unless the user explicitly asks for that in this prompt.",
    "Mind Atlas did not override the OpenClaw work root; use the OpenClaw agent default workspace if it has one.",
    settings.model ? `OpenClaw model override: ${settings.model}` : "OpenClaw model: configured default",
    settings.agent ? `OpenClaw agent: ${settings.agent}` : "OpenClaw agent: default",
    settings.resumeSessionKey
      ? `Continuing OpenClaw session key: ${settings.resumeSessionKey}`
      : rootSurfaceRun
        ? "Starting a new OpenClaw session key for this AI Partner turn."
        : "Starting a new OpenClaw session key for this branch.",
    "",
    "# User request",
    prompt,
    "",
    "# Mind Atlas context",
    truncateText(contextSummary, Math.max(2000, Math.floor(openClawPromptCharLimit * 0.55))),
  ].join("\n");
}

function normalizeOpenClawSettings(input) {
  const continueMode = input?.continueMode === "new" ? "new" : "auto";
  return {
    model: stringOr(input?.model, ""),
    thinking: openClawThinking,
    agent: stringOr(input?.agent, openClawAgent),
    workspace: "",
    timeoutMs: Number.isFinite(Number(input?.timeoutMs)) ? Number(input.timeoutMs) : openClawTimeoutMs,
    continueMode,
    resumeSessionKey: continueMode === "new" ? "" : stringOr(input?.resumeSessionKey, ""),
    sessionKey: stringOr(input?.sessionKey, ""),
    clientRunId: stringOr(input?.clientRunId, ""),
    requestNodeId: stringOr(input?.requestNodeId, ""),
    sourceNodeId: stringOr(input?.sourceNodeId, ""),
  };
}

function buildOpenClawSessionKey(settings) {
  const existing = settings.resumeSessionKey || settings.sessionKey;
  if (existing) return sanitizeOpenClawSessionKey(existing);
  const seed = settings.requestNodeId || settings.clientRunId || settings.sourceNodeId || randomUUID();
  return sanitizeOpenClawSessionKey(`mind-atlas-${seed}`);
}

function sanitizeOpenClawSessionKey(value) {
  return String(value || "mind-atlas")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || `mind-atlas-${randomUUID()}`;
}

function parseOpenClawJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some CLI versions may print diagnostics before the final JSON line.
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice().reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return null;
}

function extractOpenClawText(data) {
  if (!data) return "";
  const candidates = [
    data.text,
    data.output,
    data.response,
    data.reply,
    data.message,
    data.final,
    data.result?.text,
    data.result?.output,
    data.result?.message,
    data.result?.response,
    data.data?.text,
    data.data?.output,
    data.finalAssistantVisibleText,
    data.finalAssistantRawText,
    Array.isArray(data.payloads) ? data.payloads.map((payload) => payload?.text).filter(Boolean).join("\n") : "",
  ];
  for (const candidate of candidates) {
    const text = contentText(candidate);
    if (text.trim()) return text.trim();
  }
  const messageArrays = [data.messages, data.items, data.events, data.result?.messages, data.data?.messages].filter(Array.isArray);
  for (const messages of messageArrays) {
    for (const item of messages.slice().reverse()) {
      const text = contentText(item?.content ?? item?.text ?? item?.message ?? item?.output);
      if (text.trim()) return text.trim();
    }
  }
  return "";
}

function contentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => contentText(item?.text ?? item?.content ?? item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    return contentText(value.text ?? value.content ?? value.output ?? value.message);
  }
  return "";
}

function normalizeOpenClawUsage(value) {
  return withoutUndefined({
    inputTokens: numberOrUndefined(value?.input_tokens ?? value?.inputTokens ?? value?.prompt_tokens ?? value?.promptTokens ?? value?.input),
    outputTokens: numberOrUndefined(value?.output_tokens ?? value?.outputTokens ?? value?.completion_tokens ?? value?.completionTokens ?? value?.output),
    totalTokens: numberOrUndefined(value?.total_tokens ?? value?.totalTokens ?? value?.total),
  });
}

async function saveOpenClawRunLog({ settings, prompt, result, command, args, startedAt, completedAt, openClawSessionKey }) {
  const workspaceName = toSafeFilePart(basename(resolve(stringOr(settings.workspace, "workspace"))) || "workspace");
  const sessionName = toSafeFilePart(openClawSessionKey || "no-session");
  const runName = `${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${toSafeFilePart(randomUUID()).slice(0, 8)}`;
  const directory = join(openClawLogDir, workspaceName, sessionName, runName);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "prompt.txt"), prompt, "utf8"),
    writeFile(join(directory, "stdout.json"), result.stdout, "utf8"),
    writeFile(join(directory, "stderr.txt"), result.stderr, "utf8"),
    writeFile(join(directory, "metadata.json"), JSON.stringify({
      startedAt,
      completedAt,
      workspace: settings.workspace,
      model: settings.model,
      thinking: settings.thinking,
      agent: settings.agent,
      continueMode: settings.continueMode,
      resumeSessionKey: settings.resumeSessionKey,
      openClawSessionKey,
      clientRunId: settings.clientRunId,
      requestNodeId: settings.requestNodeId,
      sourceNodeId: settings.sourceNodeId,
      command,
      args,
      exitCode: result.exitCode,
    }, null, 2), "utf8"),
  ]);
  return directory;
}

async function saveOpenClawResponseLog(logPath, response) {
  if (!logPath) return;
  try {
    await writeFile(join(logPath, "response.json"), JSON.stringify(response, null, 2), "utf8");
  } catch (error) {
    console.warn(`[bridge] failed to save OpenClaw response log: ${error instanceof Error ? error.message : error}`);
  }
}

async function createClaudeCodeResponse({ prompt, context, model, claude, startedAt }) {
  if (claudeDisabled) throw new BridgeError(503, "Claude Code CLI is disabled");
  const settings = normalizeClaudeSettings(claude, model, context);
  const claudePrompt = buildClaudePrompt(prompt, context, settings);
  const result = await runClaudeCode(claudePrompt, settings);
  const durationMs = Date.now() - startedAt;
  const parsed = parseClaudeJson(result.stdout);
  const finalText = extractClaudeText(parsed) || result.stdout.trim();
  const body = [
    finalText || "Claude Code did not produce a final message.",
    result.stderr.trim() ? `\n\nstderr:\n${result.stderr.trim()}` : "",
  ].join("").trim();
  const output = normalizeAiOutput({
    title: result.exitCode === 0 ? "Claude Code result" : "Claude Code issue",
    body,
    summary: (finalText || result.stderr || "Claude Code run completed.").split("\n").find(Boolean)?.slice(0, 220) ?? "Claude Code run completed.",
    suggestedStatus: "needs_review",
    tags: ["claude", "code"],
  }, prompt);
  const response = {
    id: randomUUID(),
    provider: "claude",
    model: stringOr(parsed?.model, settings.model || "claude-code"),
    output,
    claudeLogPath: result.claudeLogPath,
    rawText: result.stdout,
    usage: {
      ...normalizeClaudeUsage(parsed),
      durationMs,
    },
  };
  await saveClaudeResponseLog(result.claudeLogPath, response);
  return response;
}

async function runClaudeCode(prompt, settings) {
  assertExistingWorkspace(settings.workspace, "Claude Code");
  const startedAt = new Date().toISOString();
  const boundedPrompt = truncateText(prompt, claudePromptCharLimit);
  const args = [
    "-p",
    "--output-format",
    "json",
  ];
  if (settings.reasoningEffort && settings.reasoningEffort !== "default") {
    args.push("--effort", settings.reasoningEffort);
  }
  if (settings.permissionMode && settings.permissionMode !== "default") {
    args.push("--permission-mode", settings.permissionMode);
  }
  const commandSpec = buildClaudeCommand(args);
  const result = await runProcess(commandSpec.command, commandSpec.args, boundedPrompt, settings.timeoutMs, settings.workspace, buildClaudeEnv(settings));
  const completedAt = new Date().toISOString();
  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new BridgeError(502, result.stderr.trim() || `Claude Code CLI exited with ${result.exitCode}`);
  }
  const claudeLogPath = await saveClaudeRunLog({
    settings,
    prompt: boundedPrompt,
    result,
    command: commandSpec.command,
    args: commandSpec.args,
    startedAt,
    completedAt,
  });
  return { ...result, claudeLogPath };
}

function buildClaudeCommand(args) {
  if (/\.mjs$/i.test(claudeBin)) {
    return { command: process.execPath, args: [claudeBin, ...args] };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(claudeBin)) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", claudeBin, ...args] };
  }
  return { command: claudeBin, args };
}

function buildClaudeEnv(settings) {
  const env = { ...process.env };
  const baseUrl = settings.baseUrl || claudeBaseUrl;
  const model = settings.model || claudeModel;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  const auth = resolveClaudeAuthForBaseUrl(baseUrl);
  if (auth.apiKey) env.ANTHROPIC_API_KEY = auth.apiKey;
  if (auth.authToken) env.ANTHROPIC_AUTH_TOKEN = auth.authToken;
  if (model) env.ANTHROPIC_MODEL = model;
  env.API_TIMEOUT_MS = stringOr(process.env.API_TIMEOUT_MS, String(settings.timeoutMs));
  for (const [source, target] of [
    ["MIND_ATLAS_CLAUDE_DEFAULT_FABLE_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL"],
    ["MIND_ATLAS_CLAUDE_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"],
    ["MIND_ATLAS_CLAUDE_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
    ["MIND_ATLAS_CLAUDE_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"],
    ["MIND_ATLAS_CLAUDE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"],
    ["MIND_ATLAS_CLAUDE_EFFORT_LEVEL", "CLAUDE_CODE_EFFORT_LEVEL"],
  ]) {
    const configured = process.env[source] ?? process.env[target];
    if (configured) env[target] = configured;
  }
  applyDeepSeekClaudeDefaults(env, baseUrl, model);
  return env;
}

function resolveClaudeAuthForBaseUrl(baseUrl) {
  if (baseUrl === claudeDeepSeekBaseUrl) {
    return { apiKey: "", authToken: claudeDeepSeekAuthToken || claudeAuthToken };
  }
  if (!baseUrl || isAnthropicClaudeBaseUrl(baseUrl)) {
    return { apiKey: claudeApiKey, authToken: claudeApiKey ? "" : claudeAuthToken };
  }
  return { apiKey: claudeApiKey, authToken: claudeAuthToken };
}

function isAnthropicClaudeBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

function applyDeepSeekClaudeDefaults(env, baseUrl, model) {
  if (baseUrl !== claudeDeepSeekBaseUrl) return;
  const proModel = model || "deepseek-v4-pro[1m]";
  env.ANTHROPIC_DEFAULT_OPUS_MODEL ||= proModel;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL ||= proModel;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||= "deepseek-v4-flash";
  env.CLAUDE_CODE_SUBAGENT_MODEL ||= "deepseek-v4-flash";
  env.CLAUDE_CODE_EFFORT_LEVEL ||= "max";
}

function buildClaudePrompt(prompt, context, settings) {
  const contextSummary = JSON.stringify({
    selectedNode: context?.selectedNode,
    selectedNodes: context?.selectedNodes,
    path: context?.path,
    siblingNodes: context?.siblingNodes,
    scope: context?.scope,
    stats: context?.stats,
  }, null, 2);
  return [
    "You are Claude Code invoked from Mind Atlas.",
    "Mind Atlas is a spatial tree notebook. This is a node-anchored run: use the explicit node context below, plus the files and tools available in the configured work root.",
    "Return a concise final answer suitable for saving as a child Mind Atlas node.",
    "Do not change Claude Code configuration unless the user explicitly asks for that in this prompt.",
    settings.workspace ? `User-selected work root: ${settings.workspace}` : "No Mind Atlas work root was provided; use the bridge default workspace.",
    settings.baseUrl ? `Claude API base URL override: ${settings.baseUrl}` : "Claude API base URL: bridge environment default.",
    settings.model ? `Claude model: ${settings.model}` : "Claude model: bridge environment default.",
    `Claude effort: ${settings.reasoningEffort || "default"}.`,
    `Claude permission mode: ${settings.permissionMode || "default"} (not equivalent to Codex OS sandbox).`,
    "",
    "# User request",
    prompt,
    "",
    "# Mind Atlas context",
    truncateText(contextSummary, Math.max(2000, Math.floor(claudePromptCharLimit * 0.55))),
  ].join("\n");
}

function normalizeClaudeSettings(input, model, context) {
  const workspace = stringOr(input?.workspace, stringOr(extractWorkspaceFromContext(context), claudeWorkspace));
  return {
    model: stringOr(input?.model, model || claudeModel),
    baseUrl: stringOr(input?.baseUrl, claudeBaseUrl).replace(/\/+$/, ""),
    reasoningEffort: normalizeClaudeReasoningEffort(input?.reasoningEffort),
    permissionMode: normalizeClaudePermissionMode(input?.permissionMode),
    workspace,
    timeoutMs: Number.isFinite(Number(input?.timeoutMs)) ? Number(input.timeoutMs) : claudeTimeoutMs,
    clientRunId: stringOr(input?.clientRunId, ""),
    requestNodeId: stringOr(input?.requestNodeId, ""),
    sourceNodeId: stringOr(input?.sourceNodeId, ""),
  };
}

function normalizeClaudeReasoningEffort(value) {
  return ["low", "medium", "high", "xhigh", "max"].includes(value) ? value : "default";
}

function normalizeClaudePermissionMode(value) {
  return ["acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"].includes(value) ? value : "default";
}

function parseClaudeJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some CLI versions may print diagnostics before the final JSON object.
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice().reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return null;
}

function extractClaudeText(data) {
  if (!data) return "";
  const candidates = [
    data.result,
    data.text,
    data.output,
    data.response,
    data.message,
    data.final,
    data.content,
    data.assistant_response,
  ];
  for (const candidate of candidates) {
    const text = contentText(candidate);
    if (text.trim()) return text.trim();
  }
  const messageArrays = [data.messages, data.items, data.events].filter(Array.isArray);
  for (const messages of messageArrays) {
    for (const item of messages.slice().reverse()) {
      const text = contentText(item?.content ?? item?.text ?? item?.message ?? item?.output);
      if (text.trim()) return text.trim();
    }
  }
  return "";
}

function normalizeClaudeUsage(value) {
  const usage = value?.usage ?? value;
  return withoutUndefined({
    inputTokens: numberOrUndefined(usage?.input_tokens ?? usage?.inputTokens ?? usage?.prompt_tokens ?? usage?.promptTokens),
    outputTokens: numberOrUndefined(usage?.output_tokens ?? usage?.outputTokens ?? usage?.completion_tokens ?? usage?.completionTokens),
    totalTokens: numberOrUndefined(usage?.total_tokens ?? usage?.totalTokens),
    estimatedCostUsd: numberOrUndefined(value?.total_cost_usd ?? value?.totalCostUsd ?? usage?.cost_usd ?? usage?.estimatedCostUsd),
  });
}

async function saveClaudeRunLog({ settings, prompt, result, command, args, startedAt, completedAt }) {
  const workspaceName = toSafeFilePart(basename(resolve(stringOr(settings.workspace, "workspace"))) || "workspace");
  const runName = `${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${toSafeFilePart(randomUUID()).slice(0, 8)}`;
  const directory = join(claudeLogDir, workspaceName, runName);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "prompt.txt"), prompt, "utf8"),
    writeFile(join(directory, "stdout.json"), result.stdout, "utf8"),
    writeFile(join(directory, "stderr.txt"), result.stderr, "utf8"),
    writeFile(join(directory, "metadata.json"), JSON.stringify({
      startedAt,
      completedAt,
      workspace: settings.workspace,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKeyConfigured: Boolean(claudeApiKey),
      authTokenConfigured: Boolean(claudeAuthToken),
      deepSeekAuthTokenConfigured: Boolean(claudeDeepSeekAuthToken),
      clientRunId: settings.clientRunId,
      requestNodeId: settings.requestNodeId,
      sourceNodeId: settings.sourceNodeId,
      command,
      args,
      exitCode: result.exitCode,
    }, null, 2), "utf8"),
  ]);
  return directory;
}

async function saveClaudeResponseLog(logPath, response) {
  if (!logPath) return;
  try {
    await writeFile(join(logPath, "response.json"), JSON.stringify(response, null, 2), "utf8");
  } catch (error) {
    console.warn(`[bridge] failed to save Claude Code response log: ${error instanceof Error ? error.message : error}`);
  }
}

async function runCodex(prompt, settings) {
  assertExistingWorkspace(settings.workspace, "Codex");
  const result = await runCodexOnce(prompt, settings);
  if (!shouldRetryWindowsSandboxSetupFailure(result, settings)) {
    return {
      ...result,
      effectiveSandbox: settings.sandbox,
    };
  }

  console.warn(`[bridge] Codex Windows sandbox failed to initialize for ${settings.workspace}; retrying with policy-preserving full access.`);
  const fallbackSettings = {
    ...settings,
    sandbox: "danger-full-access",
    fullAccessApproved: true,
    sandboxFallbackFrom: settings.sandbox,
  };
  const fallbackResult = await runCodexOnce(buildWindowsSandboxFallbackPrompt(prompt, settings.sandbox), fallbackSettings);
  return {
    ...fallbackResult,
    requestedSandbox: settings.sandbox,
    effectiveSandbox: "danger-full-access",
    sandboxFallbackFrom: settings.sandbox,
  };
}

async function runCodexOnce(prompt, settings) {
  const startedAt = new Date().toISOString();
  const outputFile = join(tmpdir(), `mind-atlas-codex-${Date.now()}-${randomUUID()}.txt`);
  const workspace = codexUseWsl ? toWslPath(settings.workspace) : settings.workspace;
  const sandbox = settings.sandbox === "danger-full-access" && !settings.fullAccessApproved ? "workspace-write" : settings.sandbox;
  const searchFlagSupported = settings.webSearch ? await codexSupportsSearchFlag() : false;
  const resumeThreadId = stringOr(settings.resumeThreadId, "");
  const codexArgs = [
    "--ask-for-approval",
    "never",
    "exec",
  ];
  if (resumeThreadId) {
    codexArgs.push("resume", "--json", "--output-last-message", codexUseWsl ? toWslPath(outputFile) : outputFile);
    codexArgs.push("-c", `model_reasoning_effort="${settings.reasoningEffort}"`);
    if (sandbox === "danger-full-access") codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
    if (settings.model) codexArgs.push("--model", settings.model);
    if (settings.skipGitRepoCheck) codexArgs.push("--skip-git-repo-check");
    codexArgs.push(resumeThreadId, "-");
  } else {
    codexArgs.push("--json");
    if (searchFlagSupported) codexArgs.push("--search");
    if (sandbox === "danger-full-access") {
      codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      codexArgs.push("--sandbox", sandbox);
    }
    codexArgs.push(
      "--cd",
      workspace,
      "--color",
      "never",
      "--output-last-message",
      codexUseWsl ? toWslPath(outputFile) : outputFile,
      "-c",
      `model_reasoning_effort="${settings.reasoningEffort}"`,
    );
    if (settings.skipGitRepoCheck) codexArgs.push("--skip-git-repo-check");
    if (settings.model) codexArgs.push("--model", settings.model);
    codexArgs.push("-");
  }

  const command = codexUseWsl ? "wsl" : codexBin;
  const args = codexUseWsl ? [codexBin, ...codexArgs] : codexArgs;
  const result = await runProcess(command, args, prompt, settings.timeoutMs, settings.workspace);
  const completedAt = new Date().toISOString();
  const lastMessage = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
  try {
    if (existsSync(outputFile)) unlinkSync(outputFile);
  } catch {
    // best effort cleanup
  }

  if (result.exitCode !== 0 && !lastMessage.trim() && !result.stdout.trim()) {
    throw new BridgeError(502, result.stderr.trim() || `Codex CLI exited with ${result.exitCode}`);
  }
  const events = parseCodexJsonl(result.stdout);
  const codexThreadId = extractCodexThreadId(events) || resumeThreadId;
  const codexLogPath = await saveCodexRunLog({
    settings,
    prompt,
    result,
    lastMessage,
    events,
    codexThreadId,
    command,
    args,
    startedAt,
    completedAt,
    resumeThreadId,
  });
  return { ...result, lastMessage, events, usage: extractCodexUsage(result.stdout), codexThreadId, codexLogPath };
}

function shouldRetryWindowsSandboxSetupFailure(result, settings) {
  if (process.platform !== "win32" || codexUseWsl || settings.sandbox === "danger-full-access") return false;
  const text = `${result.lastMessage}\n${result.stderr}\n${result.stdout}`.toLowerCase();
  return text.includes("windows sandbox: spawn setup refresh");
}

function buildWindowsSandboxFallbackPrompt(prompt, requestedSandbox) {
  const policy = requestedSandbox === "read-only"
    ? "This remains a read-only run. Do not create, edit, delete, move, rename, or format any file."
    : "This remains a workspace-write run. Only modify files inside the configured workspace, and do not write outside it.";
  return [
    "Mind Atlas Windows sandbox recovery notice:",
    `The requested sandbox policy is ${requestedSandbox}, but the Codex Windows sandbox failed to initialize with "windows sandbox: spawn setup refresh".`,
    "This retry runs without the broken OS sandbox only so shell commands and file reads can work.",
    policy,
    "Do not treat this recovery as permission to broaden the task or access unrelated locations.",
    "",
    prompt,
  ].join("\n");
}

function extractCodexThreadId(events) {
  const threadEvent = events.find((event) => event?.type === "thread.started" && typeof event.thread_id === "string");
  return stringOr(threadEvent?.thread_id, "");
}

async function saveCodexRunLog({ settings, prompt, result, lastMessage, events, codexThreadId, command, args, startedAt, completedAt, resumeThreadId }) {
  const workspaceName = toSafeFilePart(basename(resolve(stringOr(settings.workspace, "workspace"))) || "workspace");
  const threadName = toSafeFilePart(codexThreadId || "no-thread");
  const runName = `${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${toSafeFilePart(randomUUID()).slice(0, 8)}`;
  const directory = join(codexLogDir, workspaceName, threadName, runName);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "prompt.txt"), prompt, "utf8"),
    writeFile(join(directory, "stdout.jsonl"), result.stdout, "utf8"),
    writeFile(join(directory, "stderr.txt"), result.stderr, "utf8"),
    writeFile(join(directory, "last-message.md"), lastMessage, "utf8"),
    writeFile(join(directory, "events.json"), JSON.stringify(events, null, 2), "utf8"),
    writeFile(join(directory, "metadata.json"), JSON.stringify({
      startedAt,
      completedAt,
      workspace: settings.workspace,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      sandbox: settings.sandbox,
      webSearch: settings.webSearch,
      skipGitRepoCheck: settings.skipGitRepoCheck,
      continueMode: settings.continueMode,
      resumeThreadId,
      codexThreadId,
      clientRunId: settings.clientRunId,
      requestNodeId: settings.requestNodeId,
      sourceNodeId: settings.sourceNodeId,
      sandboxFallbackFrom: settings.sandboxFallbackFrom,
      command,
      args,
      exitCode: result.exitCode,
    }, null, 2), "utf8"),
  ]);
  return directory;
}

function toSafeFilePart(value) {
  return String(value || "item")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

async function codexSupportsSearchFlag() {
  if (codexSearchFlagSupportCache !== null) return codexSearchFlagSupportCache;
  if (codexDisabled) {
    codexSearchFlagSupportCache = false;
    return codexSearchFlagSupportCache;
  }

  const command = codexUseWsl ? "wsl" : codexBin;
  const args = codexUseWsl ? [codexBin, "exec", "--help"] : ["exec", "--help"];
  try {
    const result = await runProcess(command, args, "", 10_000, codexWorkspace);
    const helpText = `${result.stdout}\n${result.stderr}`;
    codexSearchFlagSupportCache = result.exitCode === 0 && /(^|\s)--search(\s|,|$)/.test(helpText);
  } catch {
    codexSearchFlagSupportCache = false;
  }
  return codexSearchFlagSupportCache;
}

async function shouldSkipCodexGitRepoCheck(workspace) {
  const candidate = stringOr(workspace, codexWorkspace);
  if (!candidate || !existsSync(candidate)) return true;
  const command = codexUseWsl ? "wsl" : "git";
  const args = codexUseWsl
    ? ["git", "-C", toWslPath(candidate), "rev-parse", "--is-inside-work-tree"]
    : ["-C", candidate, "rev-parse", "--is-inside-work-tree"];
  try {
    const result = await runProcess(command, args, "", 10_000, candidate);
    return result.exitCode !== 0 || result.stdout.trim() !== "true";
  } catch {
    return true;
  }
}

function normalizeCodexSettings(input, model, context) {
  const workspace = stringOr(input?.workspace, stringOr(extractWorkspaceFromContext(context), codexWorkspace));
  const requestedSandbox = normalizeCodexSandbox(input?.sandbox ?? codexSandbox);
  const fullAccessApproved = input?.fullAccessApproved === true;
  const sandbox = requestedSandbox === "danger-full-access" && !fullAccessApproved ? "workspace-write" : requestedSandbox;
  const continueMode = input?.continueMode === "new" ? "new" : "auto";
  return {
    model: stringOr(input?.model, model || codexModel || "gpt-5.5"),
    reasoningEffort: normalizeReasoningEffort(input?.reasoningEffort ?? codexReasoningEffort),
    sandbox,
    workspace,
    webSearch: true,
    skipGitRepoCheck: false,
    timeoutMs: Number.isFinite(Number(input?.timeoutMs)) ? Number(input.timeoutMs) : codexTimeoutMs,
    fullAccessApproved,
    continueMode,
    resumeThreadId: continueMode === "new" ? "" : stringOr(input?.resumeThreadId, ""),
    clientRunId: stringOr(input?.clientRunId, ""),
    requestNodeId: stringOr(input?.requestNodeId, ""),
    sourceNodeId: stringOr(input?.sourceNodeId, ""),
  };
}

function extractWorkspaceFromContext(context) {
  const nodes = [
    context?.selectedNode,
    ...(Array.isArray(context?.selectedNodes) ? context.selectedNodes : []),
    ...(Array.isArray(context?.path) ? context.path : []),
  ].filter(Boolean);
  for (const node of nodes) {
    const value = extractWorkspaceFromText([node.title, node.summary, node.body, ...(node.tags ?? [])].join("\n"));
    if (value) return value;
  }
  return "";
}

function extractWorkspaceFromText(text) {
  const match = String(text).match(/(?:workspace|workroot|work root|作業ルート|作業root)\s*[:=]\s*([^\r\n]+)/i);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function parseCodexJsonl(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractCodexUsage(stdout) {
  const events = parseCodexJsonl(stdout);
  const completed = [...events].reverse().find((event) => event?.type === "turn.completed" && event?.usage);
  return completed?.usage ?? {};
}

function normalizeCodexUsage(usage) {
  return withoutUndefined({
    inputTokens: numberOrUndefined(usage?.input_tokens ?? usage?.inputTokens),
    outputTokens: numberOrUndefined(usage?.output_tokens ?? usage?.outputTokens),
    totalTokens: numberOrUndefined(usage?.total_tokens ?? usage?.totalTokens),
  });
}

async function collectGitStatus(workspace) {
  if (!workspace) return "";
  try {
    const result = await runProcess("git", ["-C", workspace, "status", "--short"], "", 5_000, workspace);
    return result.exitCode === 0 ? result.stdout.trim() : "";
  } catch {
    return "";
  }
}

async function createGitPushResponse(payload) {
  const workspaceInput = stringOr(payload?.workspace, "");
  if (!workspaceInput) throw new BridgeError(400, "Valid workspace is required for git push.");
  const workspace = resolve(workspaceInput);
  if (!existsSync(workspace)) throw new BridgeError(400, "Valid workspace is required for git push.");
  const result = await runProcess("git", ["-C", workspace, "push"], "", 10 * 60 * 1000, workspace);
  return {
    ok: result.exitCode === 0,
    workspace,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

function diffGitStatus(before, after) {
  const beforeLines = new Set(String(before).split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return String(after)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !beforeLines.has(line))
    .join("\n");
}

function buildCodexNodes({ prompt, context, settings, result, gitStatus, durationMs }) {
  const commandEvents = result.events
    .filter((event) => event?.type === "item.completed")
    .map((event) => event?.item)
    .filter((item) => item?.type === "command_execution" && item?.command);
  const threadEvent = result.events.find((event) => event?.type === "thread.started");
  const finalText = result.lastMessage || extractLastAgentMessage(result.events) || "";
  const statusLabel = result.exitCode === 0 ? "completed" : `exited with ${result.exitCode}`;
  const issueText = [
    finalText,
    result.stderr,
    result.stdout,
  ].filter(Boolean).join("\n");
  const codexLimit = result.exitCode !== 0 ? describeCodexTokenLimit(issueText, new Date().toISOString()) : null;
  const detailBody = buildCodexDetailsBody({
    commandEvents,
    durationMs,
    gitStatus,
    result,
    settings,
    statusLabel,
    threadId: result.codexThreadId || threadEvent?.thread_id,
    logPath: result.codexLogPath,
  });
  const nodes = [{
    kind: result.exitCode === 0 ? "final" : "error",
    nodeType: "tool_result",
    title: result.exitCode === 0 ? "Codex final" : codexLimit ? "Codex token limit" : "Codex issue",
    body: [
      codexLimit?.body ?? (finalText || "Codex did not produce a final message."),
      result.exitCode !== 0 && result.stderr.trim() ? `\nstderr:\n${result.stderr.trim()}` : "",
    ].filter(Boolean).join("\n").trim(),
    summary: codexLimit?.summary ?? ((finalText || result.stderr || "Codex run completed.").split("\n").find(Boolean)?.slice(0, 220) ?? "Codex run completed."),
    suggestedStatus: result.exitCode === 0 ? "needs_review" : "error",
    tags: ["codex", result.exitCode === 0 ? "final" : "error", ...(codexLimit ? ["token-limit"] : [])],
  }];

  if (shouldOfferFullAccessApproval(result, finalText, settings)) {
    nodes.push(createFullAccessApprovalNode({ prompt, context, settings }));
  }

  if (gitStatus && settings.workspace) {
    nodes.push(createGitPushActionNode({ settings, result }));
  }

  if (detailBody) {
    nodes.push({
      kind: "summary",
      nodeType: "tool_result",
      title: "Codex details",
      body: detailBody,
      summary: `${settings.model} / ${settings.reasoningEffort} / ${formatDuration(durationMs)} / ${commandEvents.length} command(s)`,
      suggestedStatus: "done",
      tags: ["codex", "details"],
    });
  }

  return nodes;
}

function buildCodexDetailsBody({ commandEvents, durationMs, gitStatus, result, settings, statusLabel, threadId, logPath }) {
  const sections = [
    [
      "# Run",
      `Status: ${statusLabel}`,
      `Worked for: ${formatDuration(durationMs)}`,
      `Model: ${settings.model}`,
      `Reasoning: ${settings.reasoningEffort}`,
      `Sandbox: ${settings.sandbox}`,
      result.sandboxFallbackFrom ? `Sandbox recovery: ${result.sandboxFallbackFrom} -> danger-full-access after Windows sandbox setup failure` : "",
      `Workspace: ${settings.workspace}`,
      threadId ? `Thread: ${threadId}` : "",
      logPath ? `Log path: ${logPath}` : "",
      `Web search: ${settings.webSearch ? "on" : "off"}`,
      `Skip git repo check: ${settings.skipGitRepoCheck ? "on" : "off"}`,
    ].filter(Boolean).join("\n"),
  ];

  if (commandEvents.length) {
    sections.push([
      "# Commands",
      ...commandEvents.map((item, index) => [
        `## Command ${index + 1}`,
        formatCommandEvent(item),
      ].join("\n")),
    ].join("\n\n"));
  }

  if (gitStatus) {
    sections.push([
      "# Changed files",
      gitStatus,
    ].join("\n"));
  }

  return sections.filter(Boolean).join("\n\n");
}

function formatCommandEvent(item) {
  return [
    "Command:",
    String(item.command),
    "",
    `Status: ${item.status ?? "unknown"}`,
    typeof item.exit_code === "number" ? `Exit code: ${item.exit_code}` : "",
    item.aggregated_output ? "\nOutput:" : "",
    item.aggregated_output ? truncateText(String(item.aggregated_output), 8000) : "",
  ].filter(Boolean).join("\n");
}

function extractLastAgentMessage(events) {
  const message = [...events].reverse().find((event) => event?.item?.type === "agent_message" && typeof event.item.text === "string");
  return message?.item?.text ?? "";
}

function describeCodexTokenLimit(message, nowIso) {
  if (!isCodexTokenLimitMessage(message)) return null;
  const resetText = extractCodexLimitResetText(message, nowIso);
  const body = [
    "Codex token limit reached.",
    resetText ? `Limit reset: ${resetText}` : "Limit reset: not reported by Codex.",
    "",
    "Original error:",
    message,
  ].join("\n");
  return {
    body,
    summary: resetText ? `Codex token limit reached. Reset: ${resetText}.` : "Codex token limit reached. Reset time was not reported.",
  };
}

function isCodexTokenLimitMessage(message) {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("token limit") ||
    normalized.includes("usage limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("too many requests")
  );
}

function extractCodexLimitResetText(message, nowIso) {
  const explicit =
    matchFirst(String(message), [
      /\b(?:resets?|reset|retry|try again|available again|come back)\s+(?:at|after|on)\s+([^\r\n.]+)/i,
      /\b(?:resets?|retry|try again|available again|come back)\s+in\s+([^\r\n.]+)/i,
      /\buntil\s+([^\r\n.]+)/i,
    ]) ?? "";
  if (!explicit) return "";

  const cleaned = explicit.replace(/\s+/g, " ").trim();
  if (/^\d+\s*(?:s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)\b/i.test(cleaned)) {
    const relative = addRelativeDuration(nowIso, cleaned);
    return relative ? `${relative} (${cleaned} from now)` : cleaned;
  }

  const absolute = parseResetDate(cleaned, nowIso);
  return absolute || cleaned;
}

function matchFirst(value, patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function addRelativeDuration(nowIso, value) {
  const now = new Date(nowIso);
  let ms = 0;
  const matches = String(value).matchAll(/(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)/gi);
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit.startsWith("h")) ms += amount * 60 * 60 * 1000;
    else if (unit.startsWith("m")) ms += amount * 60 * 1000;
    else ms += amount * 1000;
  }
  if (!ms) return "";
  return formatResetDate(new Date(now.getTime() + ms));
}

function parseResetDate(value, nowIso) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return formatResetDate(direct);

  const timeMatch = String(value).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!timeMatch) return "";
  const now = new Date(nowIso);
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] ?? 0);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return "";
  const resetAt = new Date(now);
  resetAt.setHours(hours, minutes, 0, 0);
  if (resetAt.getTime() <= now.getTime()) resetAt.setDate(resetAt.getDate() + 1);
  return formatResetDate(resetAt);
}

function formatResetDate(date) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shouldOfferFullAccessApproval(result, finalText, settings) {
  if (settings.sandbox === "danger-full-access" || result.sandboxFallbackFrom) return false;
  const text = `${finalText}\n${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    "read-only",
    "readonly",
    "permission denied",
    "access is denied",
    "requires full access",
    "danger-full-access",
    "cannot write",
    "can't write",
    "cannot create",
  ].some((needle) => text.includes(needle));
}

function createFullAccessApprovalNode({ prompt, context, settings }) {
  const sourceNodeId = stringOr(context?.selectedNode?.id, "");
  const contextOptions = context?.options ?? {
    scope: context?.scope ?? "focused",
    ancestorDepth: 2,
    descendantDepth: 2,
    lateralRadius: 1,
    attachmentMode: "metadata",
    maxAttachmentCount: 3,
    maxAttachmentBytes: 2 * 1024 * 1024,
    selectedNodeIds: [],
  };
  const approvedSettings = {
    ...settings,
    sandbox: "danger-full-access",
    fullAccessApproved: true,
  };
  const baseAction = {
    kind: "codex_full_access",
    prompt,
    sourceNodeId,
    runId: `codex-approval-${Date.now()}-${randomUUID()}`,
    contextOptions,
    settings: approvedSettings,
  };
  return {
    kind: "approval_request",
    nodeType: "approval_request",
    title: "Full access approval",
    body: [
      "Codex appears to need filesystem access outside the current sandbox.",
      "Approve only when this request should be retried with danger-full-access.",
      `Workspace: ${settings.workspace}`,
    ].join("\n"),
    summary: "Codex is asking whether to retry with Full access.",
    suggestedStatus: "blocked",
    tags: ["codex", "approval"],
    children: [
      {
        kind: "approval_option",
        nodeType: "approval_request",
        title: "Approve Full access",
        body: "Retry this Codex request with danger-full-access.",
        summary: "Approve and retry with Full access.",
        suggestedStatus: "waiting",
        tags: ["codex", "approval", "approve"],
        action: {
          ...baseAction,
          label: "Approve Full",
          decision: "approve",
        },
      },
      {
        kind: "approval_option",
        nodeType: "approval_request",
        title: "Deny Full access",
        body: "Do not retry this Codex request with Full access.",
        summary: "Deny Full access.",
        suggestedStatus: "waiting",
        tags: ["codex", "approval", "deny"],
        action: {
          ...baseAction,
          label: "Deny",
          decision: "deny",
        },
      },
    ],
  };
}

function createGitPushActionNode({ settings, result }) {
  return {
    kind: "approval_option",
    nodeType: "approval_request",
    title: "Push changes",
    body: [
      "Push the current workspace branch to its configured remote.",
      `Workspace: ${settings.workspace}`,
      result.codexThreadId ? `Codex thread: ${result.codexThreadId}` : "",
    ].filter(Boolean).join("\n"),
    summary: "Push Codex changes to the remote repository.",
    suggestedStatus: "waiting",
    tags: ["codex", "git", "push"],
    action: {
      kind: "git_push",
      label: "Push",
      workspace: settings.workspace,
      runId: `git-push-${Date.now()}-${randomUUID()}`,
    },
  };
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function truncateText(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...truncated` : text;
}

function truncateFromStart(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `[Earlier context truncated]\n${text.slice(text.length - maxLength)}` : text;
}

function readCodexAppServerRateLimits() {
  if (codexDisabled) return Promise.reject(new Error("Codex is disabled"));
  return new Promise((resolvePromise, rejectPromise) => {
    const command = codexUseWsl ? "wsl" : codexBin;
    const args = codexUseWsl ? [codexBin, "app-server"] : ["app-server"];
    let child;
    try {
      child = spawn(command, args, {
        cwd: normalizeProcessCwd(codexWorkspace),
        env: process.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    let settled = false;
    let initialized = false;
    let stdoutBuffer = "";
    const timer = setTimeout(() => finish(new Error("Codex rate limit request timed out")), 10_000);

    const send = (message) => {
      if (settled || child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // best effort cleanup
      }
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };

    const processLine = (line) => {
      const message = parseJsonText(line);
      if (!message || typeof message !== "object") return;
      if (message.id === 1 && !initialized) {
        if (message.error) {
          finish(new Error(stringOr(message.error?.message, "Codex app-server initialization failed")));
          return;
        }
        initialized = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 2 });
        return;
      }
      if (message.id === 2) {
        if (message.error) {
          finish(new Error(stringOr(message.error?.message, "Codex rate limits unavailable")));
          return;
        }
        finish(null, message.result);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      lines.map((line) => line.trim()).filter(Boolean).forEach(processLine);
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdout.on("error", (error) => finish(error));
    child.stderr.on("data", () => {
      // Drain app-server diagnostics without exposing account details.
    });
    child.stderr.on("error", () => {
      // Rate-limit data comes from stdout; stderr is diagnostics only.
    });
    child.on("error", (error) => finish(error));
    child.on("close", () => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer.trim());
      if (!settled) finish(new Error("Codex app-server closed before returning rate limits"));
    });

    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "mind_atlas",
          title: "Mind Atlas",
          version: "0.1.1",
        },
      },
    });
  });
}

function runProcess(command, args, stdin, timeoutMs, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: normalizeProcessCwd(cwd),
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new BridgeError(502, `${command} failed to start: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let stdinError = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BridgeError(504, `${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk.toString());
    });
    child.stdout.on("error", (error) => {
      stderr += `\nstdout stream error: ${error.message}`;
    });
    child.stderr.on("error", (error) => {
      stderr += `\nstderr stream error: ${error.message}`;
    });
    child.stdin.on("error", (error) => {
      stdinError = error.message;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BridgeError(502, `${command} failed to start: ${error.message}`));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdinNote = stdinError ? `\nstdin stream error: ${stdinError}` : "";
      resolve({ exitCode: exitCode ?? 0, stdout, stderr: `${stderr}${stdinNote}` });
    });
    try {
      child.stdin.end(stdin);
    } catch (error) {
      stdinError = error instanceof Error ? error.message : String(error);
    }
  });
}

function normalizeProcessCwd(cwd) {
  const candidate = String(cwd || "").trim();
  return candidate && existsSync(candidate) ? candidate : process.cwd();
}

function assertExistingWorkspace(workspace, label) {
  const candidate = String(workspace || "").trim();
  if (!candidate) return;
  if (!existsSync(candidate)) {
    throw new BridgeError(400, `${label} workspace does not exist: ${candidate}`);
  }
}

function appendBoundedOutput(current, chunk) {
  const next = current + chunk;
  if (next.length <= MAX_PROCESS_OUTPUT_CHARS) return next;
  return `${next.slice(0, MAX_PROCESS_OUTPUT_CHARS)}\n[Mind Atlas bridge truncated process output at ${MAX_PROCESS_OUTPUT_CHARS} characters]`;
}

async function createRealtimeClientSecret(payload) {
  if (!openAiApiKey) throw new BridgeError(503, "OpenAI API key is not configured");

  const body = {
    session: buildRealtimeSessionConfig(payload),
  };
  const upstream = await fetch(`${openAiBaseUrl}/realtime/client_secrets`, {
    method: "POST",
    headers: openAiHeaders(openAiApiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  return await readUpstreamJson(upstream);
}

async function createRealtimeCall(payload) {
  if (!openAiApiKey) throw new BridgeError(503, "OpenAI API key is not configured");

  const sdp = stringOr(payload?.sdp, "");
  if (!sdp.trim()) throw new BridgeError(400, "sdp is required");

  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set("session", JSON.stringify(buildRealtimeSessionConfig(payload)));

  const upstream = await fetch(`${openAiBaseUrl}/realtime/calls`, {
    method: "POST",
    headers: openAiHeaders(openAiApiKey),
    body: formData,
  });

  const text = await upstream.text();
  if (!upstream.ok) throw new BridgeError(upstream.status, text || `OpenAI Realtime call failed with ${upstream.status}`);
  return text;
}

async function createAudioTranscription(request) {
  const startedAt = Date.now();
  if (!openAiApiKey) {
    if (allowMockWithoutKey) {
      return {
        text: "Mock transcription because OpenAI API key is not configured.",
        model: openAiTranscriptionModel,
        durationMs: Date.now() - startedAt,
      };
    }
    throw new BridgeError(503, "OpenAI API key is not configured");
  }

  const formData = await readFormData(request);
  const audio = formData.get("audio");
  if (!audio || typeof audio === "string") throw new BridgeError(400, "audio file is required");
  if (typeof audio.size === "number" && audio.size > 26 * 1024 * 1024) {
    throw new BridgeError(413, "Audio file is too large for transcription");
  }
  if (typeof audio.size === "number" && audio.size < 128) {
    throw new BridgeError(400, "No usable audio was captured");
  }

  const audioMimeType = normalizeAudioMimeType(audio.type);
  const audioFileName = normalizeAudioFileName(audio.name, audioMimeType);
  const audioBytes = Buffer.from(await audio.arrayBuffer());
  const upstreamAudio = new Blob([audioBytes], { type: audioMimeType });

  const upstreamForm = new FormData();
  upstreamForm.set("model", openAiTranscriptionModel);
  upstreamForm.set("file", upstreamAudio, audioFileName);

  const upstream = await fetch(`${openAiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: openAiHeaders(openAiApiKey),
    body: upstreamForm,
  });
  const data = await readUpstreamJson(upstream);
  return {
    text: stringOr(data.text, ""),
    model: openAiTranscriptionModel,
    durationMs: Date.now() - startedAt,
    audioSizeBytes: audioBytes.byteLength,
    audioMimeType,
  };
}

function normalizeAudioMimeType(value) {
  const mimeType = stringOr(value, "").split(";")[0].trim().toLowerCase();
  if (mimeType === "audio/mp4" || mimeType === "audio/mpeg" || mimeType === "audio/mp3" || mimeType === "audio/wav" || mimeType === "audio/webm" || mimeType === "audio/ogg") {
    return mimeType;
  }
  return "audio/webm";
}

function normalizeAudioFileName(value, mimeType) {
  const extension = mimeType === "audio/mp4"
    ? ".mp4"
    : mimeType === "audio/mpeg" || mimeType === "audio/mp3"
      ? ".mp3"
      : mimeType === "audio/wav"
        ? ".wav"
        : mimeType === "audio/ogg"
          ? ".ogg"
          : ".webm";
  const base = basename(stringOr(value, "dictation").replace(/[\\/:*?"<>|]+/g, "-"), extname(stringOr(value, ""))).slice(0, 80) || "dictation";
  return `${base}${extension}`;
}

async function createWebSearchResponse(payload) {
  const startedAt = Date.now();
  if (!openAiApiKey) {
    if (allowMockWithoutKey) {
      const query = stringOr(payload?.query, "");
      return {
        text: `Mock web search result for: ${query}`,
        citations: [],
        sources: [],
        usage: { durationMs: Date.now() - startedAt },
      };
    }
    throw new BridgeError(503, "OpenAI API key is not configured");
  }

  const query = stringOr(payload?.query, "");
  if (!query.trim()) throw new BridgeError(400, "query is required");
  const model = stringOr(payload?.model, defaultModel);
  const data = await callWebSearch(openAiBaseUrl, openAiApiKey, model, query);
  const citations = extractWebSearchCitations(data);
  return {
    text: extractModelText(data),
    citations,
    sources: dedupeSources(citations),
    usage: normalizeUsage(data.usage, "openai", Date.now() - startedAt, data, webSearchMaxOutputTokens),
    raw: data,
  };
}

async function listCloudNotebooks() {
  await mkdir(cloudNotebookDir, { recursive: true });
  const entries = await readdir(cloudNotebookDir, { withFileTypes: true });
  const notebooks = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.toLowerCase().endsWith(".mindatlaspkg")) continue;
    const filePath = join(cloudNotebookDir, name);
    const stats = await stat(filePath);
    notebooks.push({
      name,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    });
  }
  notebooks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    directory: cloudNotebookDir,
    notebooks,
  };
}

async function saveCloudNotebookPackage(request) {
  await mkdir(cloudNotebookDir, { recursive: true });
  const formData = await readFormData(request);
  const file = formData.get("package");
  if (!file || typeof file === "string") throw new BridgeError(400, "package file is required");
  const originalName = typeof file.name === "string" ? file.name : "mind-atlas.mindatlaspkg";
  const safeName = createCloudNotebookFileName(originalName);
  const filePath = safeCloudNotebookPath(safeName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);
  return {
    name: safeName,
    size: bytes.byteLength,
    updatedAt: new Date().toISOString(),
    directory: cloudNotebookDir,
  };
}

async function sendCloudNotebookPackage(rawName, response) {
  const name = decodeURIComponent(String(rawName ?? ""));
  const filePath = safeCloudNotebookPath(name);
  if (!existsSync(filePath)) throw new BridgeError(404, "Cloud notebook package not found");
  const bytes = readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": "application/x-mindatlas-package",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(basename(filePath))}"`,
    "Content-Length": String(bytes.byteLength),
  });
  response.end(bytes);
}

function createCloudNotebookFileName(originalName) {
  const extension = extname(originalName).toLowerCase() === ".mindatlaspkg" ? ".mindatlaspkg" : ".mindatlaspkg";
  const sanitizedBase = basename(originalName, extname(originalName))
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "Mind Atlas";
  const base = stripExistingCloudNotebookSequence(sanitizedBase, extension);
  let index = 1;
  while (true) {
    const candidate = `${base}-${String(index).padStart(3, "0")}${extension}`;
    if (!existsSync(join(cloudNotebookDir, candidate))) return candidate;
    index += 1;
  }
}

function stripExistingCloudNotebookSequence(name, extension) {
  let base = String(name);
  while (/-\d{3}$/.test(base)) {
    const prefix = base.replace(/-\d{3}$/, "");
    const currentExists = existsSync(join(cloudNotebookDir, `${base}${extension}`));
    const prefixExists = existsSync(join(cloudNotebookDir, `${prefix}${extension}`));
    if (!currentExists && !prefixExists) break;
    base = prefix;
  }
  return base || "Mind Atlas";
}

function safeCloudNotebookPath(name) {
  const safeName = basename(name);
  if (!safeName.toLowerCase().endsWith(".mindatlaspkg")) {
    throw new BridgeError(400, "Cloud notebook file must be a .mindatlaspkg package");
  }
  const resolved = resolve(cloudNotebookDir, safeName);
  const relativePath = relative(cloudNotebookDir, resolved);
  if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(":")) {
    throw new BridgeError(400, "Invalid cloud notebook path");
  }
  return resolved;
}

async function callResponses(baseUrl, apiKey, model, system, user, maxOutputTokens = openAiMaxOutputTokens, reasoningEffort = "default") {
  const body = {
    model,
    instructions: system,
    input: user,
    max_output_tokens: maxOutputTokens,
  };
  applyOpenAiReasoning(body, reasoningEffort);
  const upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return await readUpstreamJson(upstream);
}

async function callWebSearch(baseUrl, apiKey, model, query) {
  const body = {
    model,
    input: query,
    tools: [{ type: "web_search" }],
    max_output_tokens: webSearchMaxOutputTokens,
  };
  let upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!upstream.ok && upstream.status === 400) {
    upstream = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        ...body,
        tools: [{ type: "web_search_preview" }],
      }),
    });
  }
  return await readUpstreamJson(upstream);
}

async function callImageGenerations(baseUrl, apiKey, model, prompt) {
  const body = {
    model,
    prompt,
    n: 1,
  };
  if (openAiImageSize) body.size = openAiImageSize;

  const upstream = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return await readUpstreamJson(upstream);
}

async function callChatCompletions(baseUrl, apiKey, model, system, user, maxOutputTokens = openAiMaxOutputTokens, reasoningEffort = "default") {
  const body = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxOutputTokens,
  };
  if (model) body.model = model;
  applyChatCompletionsReasoning(body, reasoningEffort);
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return await readUpstreamJson(upstream);
}

function buildSystemInstruction() {
  return [
    "You are an AI collaborator working inside Mind Atlas, a spatial tree notebook co-edited by the human and AI.",
    "Mind Atlas is the surrounding thought tool and document structure. Do not speak as if you are Mind Atlas itself.",
    "The selected notebook node is the active context. The user's request is preserved as a separate child node, and your single response will become one child of that request.",
    "Return one direct answer to the user's message. Do not propose extra child nodes, hidden branches, follow-up nodes, or multiple alternative outputs.",
    "You may summarize, critique, or suggest next actions inside the body of the single answer, but do not claim you changed files or remote systems.",
    "Return JSON only. Do not wrap it in Markdown.",
    "Shape: {\"title\":\"short node title\",\"body\":\"full response\",\"summary\":\"one sentence\",\"suggestedStatus\":\"needs_review|done|waiting\",\"tags\":[\"tag\"]}",
    "Write in the user's language unless the prompt asks otherwise.",
  ].join("\n");
}

function buildUserInstruction(prompt, context) {
  return [
    "User prompt:",
    prompt,
    "",
    "Mind Atlas context JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function buildLocalUserInstruction(prompt, context) {
  return [
    "User prompt:",
    truncateText(prompt, 1800),
    "",
    "Mind Atlas compact context JSON:",
    "The context was compacted for a local model with a smaller context window. Prefer the selected node, path, and explicit selected nodes over omitted descendants.",
    JSON.stringify(compactAiContextForLocal(context), null, 2).slice(0, localPromptContextCharLimit),
  ].join("\n");
}

function buildCodexPrompt(prompt, context, settings) {
  return [
    "You are Codex CLI being invoked from Mind Atlas.",
    "Use the provided Mind Atlas context as project orientation, then work in the configured workspace.",
    "You may read and edit files within the active sandbox. Do not request or assume danger-full-access unless the task truly requires it.",
    "If the task is blocked by sandbox permissions, explain exactly what access is required and stop.",
    settings.webSearch
      ? "Mind Atlas Web search is enabled. Use web-search capability only if this Codex CLI environment exposes it; otherwise continue without failing and mention any need for current external verification."
      : "Mind Atlas Web search is disabled. Do not browse the web unless the user explicitly asks and the environment permits it.",
    "Return a concise final answer that can be stored as a Mind Atlas child node.",
    "",
    "Codex run settings:",
    JSON.stringify({
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      sandbox: settings.sandbox,
      workspace: settings.workspace,
      webSearch: settings.webSearch,
      skipGitRepoCheck: settings.skipGitRepoCheck,
    }, null, 2),
    "",
    "User task:",
    prompt,
    "",
    "Mind Atlas context JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function buildMindAtlasPartnerInstructions({ mode, extraInstructions = "", summary = "", voiceLogContext = "", notificationSummary = "", context = null, contextCharLimit = 8000, compactedForLocal = false }) {
  const contextText = context ? JSON.stringify(context, null, 2).slice(0, contextCharLimit) : "";
  const voiceMode = mode === "voice";
  return [
    "You are operating inside Mind Atlas, a spatial tree notebook made of celestial nodes.",
    "Mind Atlas has an active node, optional multi-selection, AI context scopes, attachments, notification pulses, unread notifications, approval requests, errors, and completed results.",
    "Codex work roots are inherited from parent nodes. Multiple Codex work roots and runs may coexist in one universe.",
    "You may operate Mind Atlas broadly through tools: search, focus, select, add, update, run AI, inspect notifications, and search the web.",
    "Do not use run_ai_from_active_node to answer the current global conversation, inspect existing nodes, pick up tasks, summarize state, or check notifications. That tool starts a separate node-anchored AI run and creates notebook nodes. Use it only when the user explicitly asks for a persistent node-based AI result or delegation to a specific node context.",
    "Destructive operations require approval. If a tool reports approval is required, do not claim the operation was executed.",
    "After tool use, briefly say what changed.",
    voiceMode ? "Keep responses concise enough for voice." : "This is a text conversation. Be concise, but include enough detail to be useful in the AI/Partner log.",
    "Do not create a celestial response node unless a tool explicitly creates or edits nodes.",
    "Write in the user's language unless the user asks otherwise.",
    compactedForLocal ? "The context below is compacted for a local model with a smaller context window. If detail is missing, ask for a narrower node scope instead of failing." : "",
    extraInstructions,
    summary ? `Previous session summary:\n${summary}` : "",
    notificationSummary ? `Current notification summary:\n${notificationSummary}` : "",
    voiceLogContext ? `Persistent AI/Partner log context:\n${voiceLogContext}` : "",
    contextText ? `Selected context JSON:\n${contextText}` : "",
  ].filter(Boolean).join("\n\n");
}

function fitLocalPartnerSystemPrompt(value) {
  if (value.length <= localPartnerSystemCharLimit) return value;
  const marker = "Selected context JSON:\n";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return truncateText(value, localPartnerSystemCharLimit);
  const prefix = value.slice(0, markerIndex + marker.length);
  const remaining = Math.max(400, localPartnerSystemCharLimit - prefix.length - 38);
  return `${prefix}[Context truncated for local model]\n${value.slice(value.length - remaining)}`;
}

function buildRealtimeSessionConfig(payload) {
  const extraInstructions = stringOr(payload?.instructions, "");
  const summary = payload?.summary?.text ? String(payload.summary.text).slice(0, 4000) : "";
  const voiceLogContext = stringOr(payload?.voiceLogContext, "").slice(0, 14000);
  const notificationSummary = stringOr(payload?.notificationSummary, "").slice(0, 4000);
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const model = stringOr(payload?.model, realtimeModel);
  const config = {
    type: "realtime",
    model,
    instructions: buildMindAtlasPartnerInstructions({
      mode: "voice",
      extraInstructions,
      summary,
      voiceLogContext,
      notificationSummary,
      context: payload?.context ?? null,
    }),
    tools,
    tool_choice: "auto",
    audio: {
      input: {
        turn_detection: null,
        transcription: {
          model: realtimeTranscriptionModel,
        },
      },
      output: {
        voice: stringOr(payload?.voice, realtimeVoice),
      },
    },
  };
  if (supportsRealtimeReasoning(model) && realtimeReasoningEffort !== "default") {
    config.reasoning = { effort: realtimeReasoningEffort };
  }
  return config;
}

function supportsRealtimeReasoning(model) {
  return String(model || "").toLowerCase().includes("realtime-2");
}

function compactAiContextForLocal(context) {
  if (!context || typeof context !== "object") return context ?? null;
  return {
    scope: context.scope,
    options: context.options
      ? {
          scope: context.options.scope,
          ancestorDepth: context.options.ancestorDepth,
          descendantDepth: context.options.descendantDepth,
          lateralRadius: context.options.lateralRadius,
          attachmentMode: context.options.attachmentMode,
        }
      : undefined,
    stats: context.stats,
    selectedNode: compactAiNodeSnapshot(context.selectedNode, 2, 1600, 12),
    selectedNodes: Array.isArray(context.selectedNodes)
      ? context.selectedNodes.slice(0, 8).map((node) => compactAiNodeSnapshot(node, 1, 900, 8))
      : undefined,
    path: Array.isArray(context.path) ? context.path.slice(-6).map((node) => compactAiNodeSnapshot(node, 0, 500, 0)) : [],
    siblingNodes: Array.isArray(context.siblingNodes)
      ? context.siblingNodes.slice(0, 12).map((node) => compactAiNodeSnapshot(node, 1, 450, 6))
      : [],
    descendantCount: context.descendantCount,
    compactedFor: "local-llm",
  };
}

function compactAiNodeSnapshot(node, depthRemaining, bodyLimit, childLimit) {
  if (!node || typeof node !== "object") return null;
  const children = Array.isArray(node.children) ? node.children : [];
  return {
    id: stringOr(node.id, ""),
    title: stringOr(node.title, ""),
    body: truncateText(stringOr(node.body, ""), bodyLimit),
    summary: truncateText(stringOr(node.summary, ""), 320),
    status: stringOr(node.status, ""),
    author: stringOr(node.author, ""),
    nodeType: stringOr(node.nodeType, ""),
    tags: Array.isArray(node.tags) ? node.tags.slice(0, 12) : [],
    attachments: Array.isArray(node.attachments)
      ? node.attachments.slice(0, 6).map((attachment) => ({
          name: stringOr(attachment?.name, ""),
          kind: stringOr(attachment?.kind, ""),
          mimeType: stringOr(attachment?.mimeType, ""),
          size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : undefined,
        }))
      : [],
    children:
      depthRemaining > 0
        ? children.slice(0, childLimit).map((child) => compactAiNodeSnapshot(child, depthRemaining - 1, Math.max(260, Math.floor(bodyLimit * 0.45)), Math.max(4, Math.floor(childLimit * 0.7))))
        : children.length
          ? children.slice(0, childLimit || 10).map((child) => ({
              id: stringOr(child?.id, ""),
              title: stringOr(child?.title, ""),
              summary: truncateText(stringOr(child?.summary, ""), 180),
              childCount: Array.isArray(child?.children) ? child.children.length : 0,
            }))
          : [],
    omittedChildren: Math.max(0, children.length - (depthRemaining > 0 ? childLimit : childLimit || 10)),
  };
}

function compactPartnerMessagesForLocal(messages) {
  return messages.slice(-6).map((message) => ({
    ...message,
    content: truncateText(stringOr(message?.content, ""), 1200),
  }));
}

function buildTextPartnerInput(messages) {
  return messages.map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: textPartnerMessageContent(message),
  }));
}

function buildChatPartnerMessages(messages) {
  return messages.map((message) => {
    if (message?.role === "tool") {
      return {
        role: "tool",
        tool_call_id: stringOr(message.toolCallId, ""),
        content: textPartnerMessageContent(message),
      };
    }
    const output = {
      role: message?.role === "assistant" ? "assistant" : "user",
      content: textPartnerMessageContent(message),
    };
    if (message?.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      output.tool_calls = message.toolCalls.map((call) => ({
        id: stringOr(call.callId, `call_${randomUUID()}`),
        type: "function",
        function: {
          name: stringOr(call.name, ""),
          arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
        },
      }));
    }
    return output;
  });
}

function textPartnerMessageContent(message) {
  const content = stringOr(message?.content, "");
  if (message?.role !== "tool") return content;
  return [
    `Tool result${message.name ? `: ${message.name}` : ""}`,
    message.toolCallId ? `Tool call id: ${message.toolCallId}` : "",
    content,
  ].filter(Boolean).join("\n");
}

function normalizeRealtimeTools(tools, { compact = false } = {}) {
  return tools
    .filter((tool) => tool?.type === "function" && tool?.name)
    .map((tool) => ({
      type: "function",
      name: String(tool.name),
      description: compact ? truncateText(stringOr(tool.description, ""), 120) : stringOr(tool.description, ""),
      parameters: compact
        ? compactJsonSchema(tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} })
        : tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
    }));
}

function normalizeChatTools(tools, options = {}) {
  return normalizeRealtimeTools(tools, options).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function normalizeAnthropicTools(tools, options = {}) {
  return normalizeRealtimeTools(tools, options).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function buildAnthropicPartnerMessages(messages) {
  return messages.map((message) => {
    if (message?.role === "assistant") {
      const content = [];
      const text = stringOr(message.content, "");
      if (text) content.push({ type: "text", text });
      if (Array.isArray(message.toolCalls)) {
        for (const call of message.toolCalls) {
          const name = stringOr(call?.name, "");
          if (!name) continue;
          content.push({
            type: "tool_use",
            id: stringOr(call.callId, `toolu_${randomUUID()}`),
            name,
            input: parseJsonText(typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {})) ?? {},
          });
        }
      }
      return {
        role: "assistant",
        content: content.length ? content : [{ type: "text", text: "" }],
      };
    }
    if (message?.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: stringOr(message.toolCallId, ""),
            content: textPartnerMessageContent(message),
          },
        ],
      };
    }
    return {
      role: "user",
      content: textPartnerMessageContent(message),
    };
  });
}

function applyOpenAiReasoning(body, effort) {
  const normalized = normalizeOpenAiReasoningEffort(effort);
  if (!normalized) return;
  body.reasoning = { effort: normalized };
}

function applyChatCompletionsReasoning(body, effort) {
  const normalized = normalizeOpenAiReasoningEffort(effort);
  if (!normalized) return;
  body.reasoning_effort = normalized;
}

function normalizeOpenAiReasoningEffort(effort) {
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort) ? effort : "";
}

function applyAnthropicEffort(body, effort) {
  const normalized = normalizeAnthropicEffort(effort);
  if (!normalized) return;
  body.effort = normalized;
}

function normalizeAnthropicEffort(effort) {
  if (effort === "xhigh") return "max";
  return ["low", "medium", "high", "max"].includes(effort) ? effort : "";
}

function anthropicMessagesUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/v1\/messages$/i.test(base)) return base;
  if (/\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function anthropicHeaders({ apiKey, authToken }) {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function compactJsonSchema(value) {
  if (Array.isArray(value)) return value.map(compactJsonSchema);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value)
    .filter(([key]) => !["description", "title", "examples", "default", "$comment"].includes(key))
    .map(([key, child]) => [key, compactJsonSchema(child)]);
  return Object.fromEntries(entries);
}

function extractResponsesToolCalls(raw) {
  const calls = [];
  const output = Array.isArray(raw?.output) ? raw.output : [];
  for (const item of output) {
    if (item?.type === "function_call" && item.name) {
      calls.push({
        name: String(item.name),
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        callId: stringOr(item.call_id ?? item.id, ""),
      });
    }
  }
  return calls;
}

function extractChatToolCalls(raw) {
  const toolCalls = raw?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((call) => ({
      name: stringOr(call?.function?.name, ""),
      arguments: stringOr(call?.function?.arguments, "{}"),
      callId: stringOr(call?.id, ""),
    }))
    .filter((call) => call.name);
}

function extractAnthropicToolCalls(raw) {
  const content = Array.isArray(raw?.content) ? raw.content : [];
  return content
    .filter((item) => item?.type === "tool_use" && item.name)
    .map((item) => ({
      name: String(item.name),
      arguments: JSON.stringify(item.input ?? {}),
      callId: stringOr(item.id, ""),
    }));
}

function createMockOutput(prompt, context) {
  const selected = context?.selectedNode ?? {};
  const title = `AI: ${String(selected.title ?? "Response").slice(0, 38)}`;
  const body = [
    "Mock AI response from mind-atlas-bridge.",
    "",
    `Prompt: ${prompt}`,
    "",
    `Selected node: ${selected.title ?? "Untitled"}`,
    "Set MIND_ATLAS_OPENAI_API_KEY or OPENAI_API_KEY on the bridge process to use a real provider.",
  ].join("\n");
  return normalizeAiOutput({
    title,
    body,
    summary: "Bridge is reachable; this is a mock response because no provider key is configured.",
    suggestedStatus: "needs_review",
    tags: ["ai", "mock"],
  }, prompt);
}

function shouldGenerateImage(prompt) {
  const normalized = prompt.toLowerCase();
  const hasImageNoun = /(画像|写真|イラスト|絵|図|ビジュアル|image|picture|photo|illustration|drawing|artwork)/i.test(normalized);
  const hasCreateVerb = /(生成|作成|作って|つくって|描いて|出力|generate|create|make|draw|render)/i.test(normalized);
  return hasImageNoun && hasCreateVerb;
}

async function extractGeneratedImageAttachments(data, prompt) {
  const items = Array.isArray(data?.data) ? data.data : [];
  const attachments = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const revisedPrompt = stringOr(item?.revised_prompt, "");
    const baseName = imageFileName(prompt, index);
    const base64 = stringOr(item?.b64_json ?? item?.base64_json, "");
    if (base64) {
      attachments.push({
        name: baseName,
        kind: "image",
        mimeType: "image/png",
        size: Buffer.byteLength(base64, "base64"),
        path: baseName,
        base64,
        revisedPrompt,
      });
      continue;
    }

    const imageUrl = stringOr(item?.url, "");
    if (!imageUrl) continue;
    const fetched = await fetchImageAsBase64(imageUrl);
    attachments.push({
      name: baseName,
      kind: "image",
      mimeType: fetched.mimeType,
      size: fetched.size,
      path: baseName,
      base64: fetched.base64,
      revisedPrompt,
    });
  }

  return attachments;
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new BridgeError(response.status, `Failed to fetch generated image from ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    base64: bytes.toString("base64"),
    size: bytes.byteLength,
    mimeType: response.headers.get("content-type")?.split(";")[0] || "image/png",
  };
}

function imageTitleFromPrompt(prompt) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Generated image";
  return `Generated image: ${cleaned.slice(0, 44)}`;
}

function imageFileName(prompt, index) {
  const cleaned = prompt
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .toLowerCase();
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${cleaned || "generated-image"}-${suffix}-${index + 1}.png`;
}

function normalizeAiOutput(value, prompt) {
  const title = stringOr(value?.title, "AI response").trim().slice(0, 80) || "AI response";
  const body = stringOr(value?.body, stringOr(value?.answer, "")).trim() || `No text was returned for: ${prompt}`;
  const summary = stringOr(value?.summary, body.split("\n").find(Boolean) ?? "AI response.").trim().slice(0, 280);
  const suggestedStatus = ["needs_review", "done", "waiting"].includes(value?.suggestedStatus) ? value.suggestedStatus : "needs_review";
  const tags = Array.isArray(value?.tags)
    ? value.tags.map((item) => String(item).replace(/^#/, "").trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];

  return { title, body, summary, suggestedStatus, tags };
}

function parseJsonText(rawText) {
  const trimmed = rawText.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function extractModelText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    const values = [];
    for (const item of data.output) {
      if (typeof item?.text === "string") values.push(item.text);
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") values.push(content.text);
          if (typeof content?.value === "string") values.push(content.value);
        }
      }
    }
    if (values.length) return values.join("\n");
  }
  const choice = data.choices?.[0];
  if (choice?.message?.content) return choice.message.content;
  return JSON.stringify(data);
}

function extractAssistantText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    const values = [];
    for (const item of data.output) {
      if (item?.type === "function_call") continue;
      if (typeof item?.text === "string") values.push(item.text);
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") values.push(content.text);
          if (typeof content?.value === "string") values.push(content.value);
        }
      }
    }
    return values.join("\n");
  }
  const choice = data.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  const anthropicText = extractAnthropicText(data);
  if (anthropicText) return anthropicText;
  return "";
}

function extractAnthropicText(data) {
  if (!Array.isArray(data?.content)) return "";
  const values = [];
  for (const item of data.content) {
    if (item?.type === "text" && typeof item.text === "string") values.push(item.text);
    if (typeof item?.text === "string" && item?.type !== "tool_use") values.push(item.text);
  }
  return values.join("\n");
}

function extractWebSearchCitations(data) {
  const citations = [];
  visit(data);
  return citations.filter((citation) => citation.url);

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const type = String(value.type ?? "");
    const url = value.url ?? value.uri;
    if (typeof url === "string" && (type.includes("citation") || type.includes("url") || value.title)) {
      citations.push({
        title: typeof value.title === "string" ? value.title : undefined,
        url,
      });
    }
    for (const item of Object.values(value)) visit(item);
  }
}

function dedupeSources(citations) {
  const seen = new Set();
  const sources = [];
  for (const citation of citations) {
    if (!citation.url || seen.has(citation.url)) continue;
    seen.add(citation.url);
    sources.push(citation);
  }
  return sources;
}

function normalizeUsage(usage, provider, durationMs, rawResponse, maxOutputTokens) {
  const inputTokens = numberOrUndefined(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = numberOrUndefined(usage?.output_tokens ?? usage?.completion_tokens);
  const totalTokens = numberOrUndefined(usage?.total_tokens) ?? addOptional(inputTokens, outputTokens);
  const estimatedCostUsd = estimateCost(provider, inputTokens, outputTokens);
  const completion = describeCompletion(rawResponse, maxOutputTokens);
  return withoutUndefined({
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    durationMs,
    maxOutputTokens: numberOrUndefined(maxOutputTokens),
    finishReason: completion.finishReason,
    outputLimitHit: completion.outputLimitHit,
  });
}

function withCompletionNotice(output, rawResponse, maxOutputTokens) {
  const completion = describeCompletion(rawResponse, maxOutputTokens);
  if (!completion.outputLimitHit) return output;
  const details = [
    `maxOutputTokens=${maxOutputTokens}`,
    completion.finishReason ? `finishReason=${completion.finishReason}` : "",
  ].filter(Boolean).join(", ");
  const notice = [
    "",
    "",
    `[Mind Atlas bridge note: This response may have been cut off by the bridge output token limit (${details}).`,
    "Increase MIND_ATLAS_OPENAI_MAX_OUTPUT_TOKENS or MIND_ATLAS_LOCAL_MAX_OUTPUT_TOKENS if this answer is incomplete.]",
  ].join("\n");
  return {
    ...output,
    body: output.body.includes("[Mind Atlas bridge note:") ? output.body : `${output.body}${notice}`,
    summary: output.summary || "AI response may have reached the bridge output token limit.",
    tags: Array.from(new Set([...(Array.isArray(output.tags) ? output.tags : []), "token-limit"])).slice(0, 8),
  };
}

function describeCompletion(rawResponse, maxOutputTokens) {
  const finishReason = extractFinishReason(rawResponse);
  const outputTokens = numberOrUndefined(rawResponse?.usage?.output_tokens ?? rawResponse?.usage?.completion_tokens);
  const limit = numberOrUndefined(maxOutputTokens);
  const reason = String(finishReason ?? "").toLowerCase();
  const outputLimitHit =
    reason === "length" ||
    reason === "max_output_tokens" ||
    reason === "max_tokens" ||
    reason.includes("max_output") ||
    (typeof outputTokens === "number" && typeof limit === "number" && outputTokens >= limit);
  return withoutUndefined({
    finishReason,
    outputLimitHit: outputLimitHit || undefined,
  });
}

function extractFinishReason(rawResponse) {
  if (typeof rawResponse?.stop_reason === "string" && rawResponse.stop_reason) return rawResponse.stop_reason;
  const choiceReason = rawResponse?.choices?.[0]?.finish_reason;
  if (typeof choiceReason === "string" && choiceReason) return choiceReason;
  const incompleteReason = rawResponse?.incomplete_details?.reason;
  if (typeof incompleteReason === "string" && incompleteReason) return incompleteReason;
  if (rawResponse?.status === "incomplete") return "incomplete";
  if (Array.isArray(rawResponse?.output)) {
    const incompleteItem = rawResponse.output.find((item) => typeof item?.status === "string" && item.status !== "completed");
    if (incompleteItem?.status) return String(incompleteItem.status);
  }
  return undefined;
}

function estimateCost(provider, inputTokens, outputTokens) {
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return undefined;
  const prefix = provider === "local"
    ? "MIND_ATLAS_LOCAL"
    : provider === "anthropic"
      ? "MIND_ATLAS_ANTHROPIC"
      : provider === "deepseek"
        ? "MIND_ATLAS_DEEPSEEK"
        : "MIND_ATLAS_OPENAI";
  const inputRate = Number(process.env[`${prefix}_INPUT_USD_PER_1M`] ?? 0);
  const outputRate = Number(process.env[`${prefix}_OUTPUT_USD_PER_1M`] ?? 0);
  if (!inputRate && !outputRate) return undefined;
  return ((inputTokens ?? 0) / 1_000_000) * inputRate + ((outputTokens ?? 0) / 1_000_000) * outputRate;
}

async function readUpstreamJson(upstream) {
  const text = await upstream.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!upstream.ok) {
    const detail = data?.error?.message ?? text ?? `Upstream failed with ${upstream.status}`;
    throw new BridgeError(upstream.status, detail);
  }
  return data;
}

async function readFormData(request) {
  const webRequest = new Request("http://127.0.0.1/upload", {
    method: "POST",
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: "half",
  });
  return await webRequest.formData();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new BridgeError(413, "Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new BridgeError(400, "Request body must be JSON"));
      }
    });
    request.on("error", reject);
  });
}

function openAiHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Safety-Identifier": "mind-atlas-local-user",
    ...extra,
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function setCors(request, response) {
  const defaultOrigins = "http://127.0.0.1:5173,http://localhost:5173";
  const configuredOrigins = process.env.MIND_ATLAS_ALLOWED_ORIGIN;
  const allowedOrigins = (configuredOrigins ?? defaultOrigins)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.origin;
  const origin = allowedOrigins.includes("*")
    ? "*"
    : requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : !configuredOrigins && isDefaultAllowedDevOrigin(requestOrigin)
        ? requestOrigin
      : allowedOrigins[0] ?? "http://127.0.0.1:5173";
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin, Access-Control-Request-Private-Network");
}

function isDefaultAllowedDevOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (!["5173", "4173"].includes(port)) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return isPrivateIpv4(host);
  } catch {
    return false;
  }
}

function isPrivateIpv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readPositiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  if (Number.isInteger(value) && value > 0) return value;
  return fallback;
}

function addOptional(left, right) {
  if (typeof left !== "number" && typeof right !== "number") return undefined;
  return (left ?? 0) + (right ?? 0);
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeReasoningEffort(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "xhigh") {
    return normalized;
  }
  if (normalized === "extra-high" || normalized === "extrahigh") return "xhigh";
  return "medium";
}

function normalizeCodexSandbox(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "read-only" || normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return "workspace-write";
}

function toWslPath(value) {
  const normalized = String(value).replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

class BridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

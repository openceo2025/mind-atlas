import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";

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
const localMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_LOCAL_MAX_OUTPUT_TOKENS", Math.min(defaultMaxOutputTokens, 2048));
const localPromptContextCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_CONTEXT_CHAR_LIMIT", 2400);
const localPartnerLogCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_LOG_CHAR_LIMIT", 700);
const localPartnerSummaryCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_SUMMARY_CHAR_LIMIT", 450);
const localPartnerSystemCharLimit = readPositiveIntEnv("MIND_ATLAS_LOCAL_PARTNER_SYSTEM_CHAR_LIMIT", 3600);
const webSearchMaxOutputTokens = readPositiveIntEnv("MIND_ATLAS_WEB_SEARCH_MAX_OUTPUT_TOKENS", 2048);
const openAiImageModel = process.env.MIND_ATLAS_OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const openAiImageSize = process.env.MIND_ATLAS_OPENAI_IMAGE_SIZE ?? "1024x1024";
const openAiTranscriptionModel = process.env.MIND_ATLAS_OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";

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

const realtimeModel = process.env.MIND_ATLAS_REALTIME_MODEL ?? "gpt-realtime";
const realtimeVoice = process.env.MIND_ATLAS_REALTIME_VOICE ?? "marin";
const realtimeTranscriptionModel = process.env.MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";
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
        transcriptionModel: openAiTranscriptionModel,
        realtimeTranscriptionModel,
        mockFallback: allowMockWithoutKey,
        providers: [
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
        ],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/codex/options") {
      const result = await createCodexOptionsResponse();
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
});

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

  if (provider === "local") {
    const model = await resolveLoadedLocalModel();
    const result = await createOpenAiCompatibleResponse({
      baseUrl: localBaseUrl,
      apiKey: localApiKey,
      model,
      prompt,
      context,
      provider: "local",
      startedAt,
    });
    return result;
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

async function createOpenAiCompatibleResponse({ baseUrl, apiKey, model, prompt, context, provider, startedAt }) {
  const system = buildSystemInstruction();
  const user = provider === "local" ? buildLocalUserInstruction(prompt, context) : buildUserInstruction(prompt, context);
  const maxOutputTokens = provider === "local" ? localMaxOutputTokens : openAiMaxOutputTokens;
  const data = await callChatCompletions(baseUrl, apiKey, model, system, user, maxOutputTokens);
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
  if (provider !== "openai" && provider !== "local") {
    throw new BridgeError(400, "text partner provider must be openai or local");
  }
  const context = payload?.context ?? {};
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) throw new BridgeError(400, "messages are required");
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  const summary = payload?.summary?.text ? String(payload.summary.text).slice(0, 4000) : "";
  const voiceLogContext = stringOr(payload?.voiceLogContext, "").slice(0, 14000);

  if (provider === "local") {
    const model = await resolveLoadedLocalModel();
    const data = await callChatToolTurn(localBaseUrl, localApiKey, model, "local", context, messages, tools, summary, voiceLogContext);
    return textPartnerResultWithoutRaw(data, "local", startedAt, localMaxOutputTokens);
  }

  const model = stringOr(payload?.model, defaultModel);
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
    ? await callChatToolTurn(openAiBaseUrl, openAiApiKey, model, "openai", context, messages, tools, summary, voiceLogContext)
    : await callResponsesToolTurn(openAiBaseUrl, openAiApiKey, model, context, messages, tools, summary, voiceLogContext);
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

async function callResponsesToolTurn(baseUrl, apiKey, model, context, messages, tools, summary, voiceLogContext) {
  const upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
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
    }),
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

async function callChatToolTurn(baseUrl, apiKey, model, provider, context, messages, tools, summary, voiceLogContext) {
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

async function runCodex(prompt, settings) {
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

function normalizeCodexSettings(input, model, context) {
  const workspace = stringOr(extractWorkspaceFromContext(context), stringOr(input?.workspace, codexWorkspace));
  const requestedSandbox = normalizeCodexSandbox(input?.sandbox ?? codexSandbox);
  const fullAccessApproved = input?.fullAccessApproved === true;
  const sandbox = requestedSandbox === "danger-full-access" && !fullAccessApproved ? "workspace-write" : requestedSandbox;
  const continueMode = input?.continueMode === "new" ? "new" : "auto";
  return {
    model: stringOr(input?.model, model || codexModel || "gpt-5.5"),
    reasoningEffort: normalizeReasoningEffort(input?.reasoningEffort ?? codexReasoningEffort),
    sandbox,
    workspace,
    webSearch: input?.webSearch === true,
    skipGitRepoCheck: input?.skipGitRepoCheck === true,
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

function runProcess(command, args, stdin, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: normalizeProcessCwd(cwd),
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
  if (!openAiApiKey) {
    if (allowMockWithoutKey) {
      const query = stringOr(payload?.query, "");
      return {
        text: `Mock web search result for: ${query}`,
        citations: [],
        sources: [],
      };
    }
    throw new BridgeError(503, "OpenAI API key is not configured");
  }

  const query = stringOr(payload?.query, "");
  if (!query.trim()) throw new BridgeError(400, "query is required");
  const data = await callWebSearch(openAiBaseUrl, openAiApiKey, stringOr(payload?.model, defaultModel), query);
  const citations = extractWebSearchCitations(data);
  return {
    text: extractModelText(data),
    citations,
    sources: dedupeSources(citations),
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

async function callResponses(baseUrl, apiKey, model, system, user, maxOutputTokens = openAiMaxOutputTokens) {
  const upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      instructions: system,
      input: user,
      max_output_tokens: maxOutputTokens,
    }),
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

async function callChatCompletions(baseUrl, apiKey, model, system, user, maxOutputTokens = openAiMaxOutputTokens) {
  const body = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxOutputTokens,
  };
  if (model) body.model = model;
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

function buildMindAtlasPartnerInstructions({ mode, extraInstructions = "", summary = "", voiceLogContext = "", context = null, contextCharLimit = 8000, compactedForLocal = false }) {
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
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];
  return {
    type: "realtime",
    model: stringOr(payload?.model, realtimeModel),
    instructions: buildMindAtlasPartnerInstructions({
      mode: "voice",
      extraInstructions,
      summary,
      voiceLogContext,
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
  return messages.map((message) => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: textPartnerMessageContent(message),
  }));
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
  return "";
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
  const prefix = provider === "local" ? "MIND_ATLAS_LOCAL" : "MIND_ATLAS_OPENAI";
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

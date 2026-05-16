import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.MIND_ATLAS_BRIDGE_PORT ?? process.env.PORT ?? 8787);

const openAiApiKey = process.env.MIND_ATLAS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");
const openAiMode = process.env.MIND_ATLAS_OPENAI_MODE ?? "responses";
const defaultModel = process.env.MIND_ATLAS_OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5";

const localBaseUrl = normalizeBaseUrl(process.env.MIND_ATLAS_LOCAL_BASE_URL ?? "http://127.0.0.1:1234/v1");
const localApiKey = process.env.MIND_ATLAS_LOCAL_API_KEY ?? "lm-studio";
const localModel = process.env.MIND_ATLAS_LOCAL_MODEL ?? "local-model";

const codexBin = process.env.MIND_ATLAS_CODEX_BIN ?? "codex";
const codexUseWsl = process.env.MIND_ATLAS_CODEX_USE_WSL === "true";
const codexWorkspace = process.env.MIND_ATLAS_CODEX_WORKSPACE ?? process.cwd();
const codexModel = process.env.MIND_ATLAS_CODEX_MODEL ?? "";
const codexTimeoutMs = Number(process.env.MIND_ATLAS_CODEX_TIMEOUT_MS ?? 180000);
const codexDisabled = process.env.MIND_ATLAS_CODEX_DISABLED === "true";

const realtimeModel = process.env.MIND_ATLAS_REALTIME_MODEL ?? "gpt-realtime";
const realtimeVoice = process.env.MIND_ATLAS_REALTIME_VOICE ?? "marin";
const allowMockWithoutKey = process.env.MIND_ATLAS_ALLOW_MOCK_WITHOUT_KEY !== "false";

const server = createServer(async (request, response) => {
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
        realtimeModel,
        mockFallback: allowMockWithoutKey,
        providers: [
          {
            id: "openai",
            label: "OpenAI",
            configured: Boolean(openAiApiKey) || allowMockWithoutKey,
            model: defaultModel,
            baseUrl: openAiBaseUrl,
            detail: openAiApiKey ? "API key configured" : "mock fallback",
          },
          {
            id: "local",
            label: "LM Studio",
            configured: true,
            model: localModel,
            baseUrl: localBaseUrl,
            detail: "OpenAI-compatible local endpoint",
          },
          {
            id: "codex",
            label: "Codex CLI",
            configured: !codexDisabled,
            model: codexModel || undefined,
            detail: codexUseWsl ? `wsl ${codexBin}` : codexBin,
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ai/respond") {
      const payload = await readJson(request);
      const result = await createAiResponse(payload);
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

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error instanceof BridgeError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof Error ? error.message : "Unknown bridge error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mind Atlas bridge listening on http://127.0.0.1:${port}`);
  console.log(openAiApiKey ? `OpenAI upstream: ${openAiBaseUrl}` : "OpenAI key not set; mock text responses are enabled.");
  console.log(`Local upstream: ${localBaseUrl}`);
  console.log(`Codex command: ${codexUseWsl ? "wsl " : ""}${codexBin}`);
});

async function createAiResponse(payload) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const provider = stringOr(payload?.provider, "openai");
  const prompt = stringOr(payload?.prompt, "");
  const context = payload?.context ?? {};

  if (!prompt.trim()) {
    throw new BridgeError(400, "prompt is required");
  }

  if (provider === "local") {
    const model = stringOr(payload?.model, localModel);
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

  const system = buildSystemInstruction();
  const user = buildUserInstruction(prompt, context);
  const data = openAiMode === "chat-completions"
    ? await callChatCompletions(openAiBaseUrl, openAiApiKey, model, system, user)
    : await callResponses(openAiBaseUrl, openAiApiKey, model, system, user);
  const rawText = extractModelText(data);
  const output = normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt);

  return {
    id: data.id ?? requestId,
    provider: openAiMode === "chat-completions" ? "openai-compatible" : "openai",
    model,
    output,
    rawText,
    usage: normalizeUsage(data.usage, "openai", Date.now() - startedAt),
  };
}

async function createOpenAiCompatibleResponse({ baseUrl, apiKey, model, prompt, context, provider, startedAt }) {
  const system = buildSystemInstruction();
  const user = buildUserInstruction(prompt, context);
  const data = await callChatCompletions(baseUrl, apiKey, model, system, user);
  const rawText = extractModelText(data);
  const output = normalizeAiOutput(parseJsonText(rawText) ?? { body: rawText }, prompt);
  return {
    id: data.id ?? randomUUID(),
    provider,
    model,
    output,
    rawText,
    usage: normalizeUsage(data.usage, provider, Date.now() - startedAt),
  };
}

async function createCodexResponse({ prompt, context, model, startedAt }) {
  if (codexDisabled) throw new BridgeError(503, "Codex CLI is disabled");
  const codexPrompt = buildCodexPrompt(prompt, context);
  const result = await runCodex(codexPrompt, model);
  const body = [
    result.lastMessage || result.stdout || "Codex did not produce a final message.",
    result.exitCode !== 0 && result.stderr.trim() ? `\n\nstderr:\n${result.stderr.trim()}` : "",
  ].join("").trim();
  return {
    id: randomUUID(),
    provider: "codex",
    model: model || "codex-cli",
    output: normalizeAiOutput({
      title: "Codex result",
      body,
      summary: body.split("\n").find(Boolean) ?? "Codex run completed.",
      suggestedStatus: result.exitCode === 0 ? "needs_review" : "needs_review",
      tags: ["codex", "code"],
    }, prompt),
    rawText: result.stdout,
    usage: { durationMs: Date.now() - startedAt },
  };
}

async function runCodex(prompt, model) {
  const outputFile = join(tmpdir(), `mind-atlas-codex-${Date.now()}-${randomUUID()}.txt`);
  const workspace = codexUseWsl ? toWslPath(codexWorkspace) : codexWorkspace;
  const codexArgs = [
    "--ask-for-approval",
    "never",
    "exec",
    "--sandbox",
    "read-only",
    "--cd",
    workspace,
    "--color",
    "never",
    "--output-last-message",
    codexUseWsl ? toWslPath(outputFile) : outputFile,
  ];
  if (model) codexArgs.push("--model", model);
  codexArgs.push("-");

  const command = codexUseWsl ? "wsl" : codexBin;
  const args = codexUseWsl ? [codexBin, ...codexArgs] : codexArgs;
  const result = await runProcess(command, args, prompt, codexTimeoutMs, codexWorkspace);
  const lastMessage = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
  try {
    if (existsSync(outputFile)) unlinkSync(outputFile);
  } catch {
    // best effort cleanup
  }

  if (result.exitCode !== 0 && !lastMessage.trim() && !result.stdout.trim()) {
    throw new BridgeError(502, result.stderr.trim() || `Codex CLI exited with ${result.exitCode}`);
  }
  return { ...result, lastMessage };
}

function runProcess(command, args, stdin, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BridgeError(504, `${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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
      resolve({ exitCode: exitCode ?? 0, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
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

async function callResponses(baseUrl, apiKey, model, system, user) {
  const upstream = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      instructions: system,
      input: user,
      max_output_tokens: 1800,
    }),
  });
  return await readUpstreamJson(upstream);
}

async function callChatCompletions(baseUrl, apiKey, model, system, user) {
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: openAiHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1800,
    }),
  });
  return await readUpstreamJson(upstream);
}

function buildSystemInstruction() {
  return [
    "You are an AI collaborator working inside Mind Atlas, a spatial tree notebook co-edited by the human and AI.",
    "Mind Atlas is the surrounding thought tool and document structure. Do not speak as if you are Mind Atlas itself.",
    "The selected celestial node is the active context. The user's request is preserved as a separate child node, and your single response will become one child of that request.",
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

function buildCodexPrompt(prompt, context) {
  return [
    "You are Codex CLI being invoked from Mind Atlas.",
    "Run in analysis/proposal mode. Do not modify files. If code changes are needed, describe the patch or commands instead of applying them.",
    "Return a concise final answer that can be stored as a Mind Atlas child node.",
    "",
    "User task:",
    prompt,
    "",
    "Mind Atlas context JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function buildRealtimeSessionConfig(payload) {
  const context = payload?.context ? JSON.stringify(payload.context, null, 2).slice(0, 8000) : "";
  const extraInstructions = stringOr(payload?.instructions, "");
  return {
    type: "realtime",
    model: stringOr(payload?.model, realtimeModel),
    instructions: [
      "You are speaking inside Mind Atlas, a spatial tree notebook.",
      "Stay anchored to the selected celestial node and keep responses concise enough for voice.",
      extraInstructions,
      context ? `Selected context JSON:\n${context}` : "",
    ].filter(Boolean).join("\n\n"),
    audio: {
      input: {
        turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
      },
      output: {
        voice: stringOr(payload?.voice, realtimeVoice),
      },
    },
  };
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

function normalizeUsage(usage, provider, durationMs) {
  const inputTokens = numberOrUndefined(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = numberOrUndefined(usage?.output_tokens ?? usage?.completion_tokens);
  const totalTokens = numberOrUndefined(usage?.total_tokens) ?? addOptional(inputTokens, outputTokens);
  const estimatedCostUsd = estimateCost(provider, inputTokens, outputTokens);
  return withoutUndefined({
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    durationMs,
  });
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
  const allowedOrigins = (process.env.MIND_ATLAS_ALLOWED_ORIGIN ?? defaultOrigins)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.origin;
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] ?? "http://127.0.0.1:5173";
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

function addOptional(left, right) {
  if (typeof left !== "number" && typeof right !== "number") return undefined;
  return (left ?? 0) + (right ?? 0);
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
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

import type {
  AiBridgeHealth,
  AiResponsePayload,
  AiResponseResult,
  AudioTranscriptionResult,
  ChatOptionsResult,
  CloudNotebookListResult,
  CloudNotebookSaveResult,
  CodexOptionsResult,
  CodexRunRecoveryRequest,
  CodexRunRecoveryResult,
  GitPushResult,
  RealtimeSessionConfig,
  TextPartnerTurnPayload,
  TextPartnerTurnResult,
  WebSearchResult,
} from "../types";

const FALLBACK_BRIDGE_URL = "http://127.0.0.1:8787";
let preferredBridgeUrl: string | null = null;
let bridgeProbePromise: Promise<string> | null = null;

export function getBridgeUrl() {
  return getBridgeUrlCandidates()[0];
}

export function getBridgeUrlCandidates() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const configuredUrl = env?.VITE_MIND_ATLAS_BRIDGE_URL ?? FALLBACK_BRIDGE_URL;
  const primary = trimTrailingSlash(resolveBridgeUrl(configuredUrl));
  const candidates = [primary];
  const localFallback = resolveLocalBridgeFallback(configuredUrl);
  if (localFallback) candidates.push(trimTrailingSlash(localFallback));
  return Array.from(new Set(candidates));
}

function resolveBridgeUrl(value: string) {
  if (typeof window === "undefined") return value;
  try {
    const bridgeUrl = new URL(value);
    const pageHost = window.location.hostname;
    if (window.location.protocol === "https:" && bridgeUrl.protocol === "http:") {
      bridgeUrl.protocol = "https:";
    }
    const bridgeHostIsLocal = bridgeUrl.hostname === "127.0.0.1" || bridgeUrl.hostname === "localhost";
    const pageHostIsLocal = pageHost === "127.0.0.1" || pageHost === "localhost";
    if (bridgeHostIsLocal && !pageHostIsLocal) {
      bridgeUrl.hostname = pageHost;
      return bridgeUrl.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function resolveLocalBridgeFallback(value: string) {
  if (typeof window === "undefined") return "";
  try {
    const bridgeUrl = new URL(value);
    if (window.location.protocol === "https:" && bridgeUrl.protocol === "http:") {
      bridgeUrl.protocol = "https:";
    }
    const bridgeHostIsLocal = bridgeUrl.hostname === "127.0.0.1" || bridgeUrl.hostname === "localhost";
    const pageHostIsLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    return bridgeHostIsLocal && !pageHostIsLocal ? bridgeUrl.toString() : "";
  } catch {
    return "";
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export async function getAiBridgeHealth(): Promise<AiBridgeHealth> {
  const response = await fetchBridgeGet("/health");
  return await readJsonResponse<AiBridgeHealth>(response);
}

export async function requestAiResponse(payload: AiResponsePayload): Promise<AiResponseResult> {
  const response = await fetchBridge("/api/ai/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<AiResponseResult>(response);
}

export async function requestTextPartnerTurn(payload: TextPartnerTurnPayload): Promise<TextPartnerTurnResult> {
  const response = await fetchBridge("/api/ai/text-partner-turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<TextPartnerTurnResult>(response);
}

export async function getChatOptions(): Promise<ChatOptionsResult> {
  const response = await fetchBridgeGet("/api/chat/options");
  return await readJsonResponse<ChatOptionsResult>(response);
}

export async function getCodexOptions(): Promise<CodexOptionsResult> {
  const response = await fetchBridgeGet("/api/codex/options");
  return await readJsonResponse<CodexOptionsResult>(response);
}

export async function recoverCodexRun(payload: CodexRunRecoveryRequest): Promise<CodexRunRecoveryResult> {
  const response = await fetchBridge("/api/codex/runs/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<CodexRunRecoveryResult>(response);
}

export async function requestGitPush(workspace: string): Promise<GitPushResult> {
  const response = await fetchBridge("/api/git/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return await readJsonResponse<GitPushResult>(response);
}

export async function createRealtimeClientSecret(payload: RealtimeSessionConfig) {
  const response = await fetchBridge("/api/realtime/client-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<Record<string, unknown>>(response);
}

export async function createRealtimeCall(payload: RealtimeSessionConfig & { sdp: string }) {
  const response = await fetchBridge("/api/realtime/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Realtime call failed with ${response.status}`);
  }
  return await response.text();
}

export async function transcribeAudio(blob: Blob, fileName = "dictation.webm"): Promise<AudioTranscriptionResult> {
  const formData = new FormData();
  formData.set("audio", blob, fileName);
  const response = await fetchBridge("/api/audio/transcriptions", {
    method: "POST",
    body: formData,
  });
  return await readJsonResponse<AudioTranscriptionResult>(response);
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const response = await fetchBridge("/api/tools/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return await readJsonResponse<WebSearchResult>(response);
}

export async function saveCloudNotebookPackage(blob: Blob, fileName: string): Promise<CloudNotebookSaveResult> {
  const formData = new FormData();
  formData.set("package", blob, fileName);
  const response = await fetchBridge("/api/cloud/notebooks", {
    method: "POST",
    body: formData,
  });
  return await readJsonResponse<CloudNotebookSaveResult>(response);
}

export async function listCloudNotebookPackages(): Promise<CloudNotebookListResult> {
  const response = await fetchBridgeGet("/api/cloud/notebooks");
  return await readJsonResponse<CloudNotebookListResult>(response);
}

export async function downloadCloudNotebookPackage(name: string): Promise<Blob> {
  const response = await fetchBridgeGet(`/api/cloud/notebooks/${encodeURIComponent(name)}`);
  if (!response.ok) {
    const text = await response.text();
    let message = `Cloud notebook download failed with ${response.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      message = data.error ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return await response.blob();
}

async function fetchBridgeGet(path: string, init: RequestInit = {}) {
  const candidates = getBridgeUrlCandidates();
  let lastError: unknown = null;
  for (const baseUrl of preferredBridgeUrl ? [preferredBridgeUrl, ...candidates.filter((candidate) => candidate !== preferredBridgeUrl)] : candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...init, method: init.method ?? "GET" });
      preferredBridgeUrl = baseUrl;
      return response;
    } catch (error) {
      lastError = error;
      if (preferredBridgeUrl === baseUrl) preferredBridgeUrl = null;
    }
  }
  throw createBridgeFetchError(path, lastError, candidates);
}

async function fetchBridge(path: string, init: RequestInit) {
  const baseUrl = await getReachableBridgeUrl();
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if (preferredBridgeUrl === baseUrl) preferredBridgeUrl = null;
    const candidates = getBridgeUrlCandidates();
    const diagnostics = await probeBridgeHealthForDiagnostics(candidates);
    throw createBridgeFetchError(path, error, candidates, diagnostics);
  }
}

async function getReachableBridgeUrl() {
  if (preferredBridgeUrl) return preferredBridgeUrl;
  if (!bridgeProbePromise) {
    bridgeProbePromise = probeBridgeHealth().finally(() => {
      bridgeProbePromise = null;
    });
  }
  return await bridgeProbePromise;
}

async function probeBridgeHealth() {
  const candidates = getBridgeUrlCandidates();
  let lastError: unknown = null;
  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        preferredBridgeUrl = baseUrl;
        return baseUrl;
      }
      lastError = new Error(`Bridge health failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw createBridgeFetchError("/health", lastError, candidates);
}

function createBridgeFetchError(path: string, error: unknown, candidates: string[], diagnostics = "") {
  const reason = error instanceof Error ? error.message : String(error ?? "Unknown network error");
  return new Error(
    [
      "Failed to fetch Mind Atlas bridge.",
      `Path: ${path}`,
      `Tried: ${candidates.join(", ")}`,
      ...(diagnostics ? [`Health after failure: ${diagnostics}`] : []),
      `Reason: ${reason}`,
    ].join("\n"),
  );
}

async function probeBridgeHealthForDiagnostics(candidates: string[]) {
  const results: string[] = [];
  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      results.push(`${baseUrl}/health -> ${response.status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error ?? "failed");
      results.push(`${baseUrl}/health -> failed (${reason})`);
    }
  }
  return results.join("; ");
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error ?? "Unknown JSON parse error");
    const preview = text.trim().slice(0, 600);
    throw new Error(
      [
        `Bridge returned malformed JSON with ${response.status}.`,
        `Reason: ${reason}`,
        preview ? `Preview: ${preview}` : "",
      ].filter(Boolean).join("\n"),
    );
  }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Bridge request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

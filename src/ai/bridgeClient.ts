import type {
  AiBridgeHealth,
  AiResponsePayload,
  AiResponseResult,
  AgentRunInboxResult,
  AudioTranscriptionResult,
  ChatOptionsResult,
  CloudNotebookListResult,
  CloudNotebookSaveResult,
  CodexOptionsResult,
  CodexRunRecoveryRequest,
  CodexRunRecoveryResult,
  GitPushResult,
  OpenClawOptionsResult,
  ProviderUsageResult,
  RealtimeSessionConfig,
  TextPartnerTurnPayload,
  TextPartnerTurnResult,
  WebSearchResult,
} from "../types";
import { formatAppMessage } from "../i18n/format";
import { formatHostedServiceError, getHostedServiceUrl, isHostedServiceMode, notifyHostedServiceSessionChanged } from "../hosted/serviceClient";

const FALLBACK_BRIDGE_URL = "http://127.0.0.1:8787";
let preferredBridgeUrl: string | null = null;
let bridgeProbePromise: Promise<string> | null = null;

export function getBridgeUrl() {
  return getBridgeUrlCandidates()[0];
}

export function getBridgeUrlCandidates() {
  if (isHostedServiceMode()) return [getHostedServiceUrl()];
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
  const result = await readJsonResponse<TextPartnerTurnResult>(response);
  notifyHostedServiceSessionChanged();
  return result;
}

export async function getChatOptions(): Promise<ChatOptionsResult> {
  const response = await fetchBridgeGet("/api/chat/options");
  return await readJsonResponse<ChatOptionsResult>(response);
}

export async function getCodexOptions(): Promise<CodexOptionsResult> {
  const response = await fetchBridgeGet("/api/codex/options");
  return await readJsonResponse<CodexOptionsResult>(response);
}

export async function getOpenClawOptions(): Promise<OpenClawOptionsResult> {
  const response = await fetchBridgeGet("/api/openclaw/options");
  return await readJsonResponse<OpenClawOptionsResult>(response);
}

export async function getProviderUsage(forceRefresh = false): Promise<ProviderUsageResult> {
  const response = await fetchBridgeGet(`/api/provider-usage${forceRefresh ? "?refresh=1" : ""}`);
  return await readJsonResponse<ProviderUsageResult>(response);
}

export async function recoverCodexRun(payload: CodexRunRecoveryRequest): Promise<CodexRunRecoveryResult> {
  const response = await fetchBridge("/api/codex/runs/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<CodexRunRecoveryResult>(response);
}

export async function getAgentRunInbox(): Promise<AgentRunInboxResult> {
  const response = await fetchBridgeGet("/api/agent-runs/inbox");
  return await readJsonResponse<AgentRunInboxResult>(response);
}

export async function acknowledgeAgentRuns(payload: { ids?: string[]; clientRunIds?: string[] }): Promise<{ acknowledged: number }> {
  const response = await fetchBridge("/api/agent-runs/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<{ acknowledged: number }>(response);
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

export async function createRealtimeCall(payload: RealtimeSessionConfig & { sdp: string }): Promise<{ sdp: string; maxSessionSeconds?: number }> {
  const response = await fetchBridge("/api/realtime/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 402) notifyHostedServiceSessionChanged();
    throw new Error(readBridgeErrorText(response.status, text, `Realtime call failed with ${response.status}`));
  }
  const sdp = await response.text();
  const maxSessionSeconds = Number(response.headers.get("X-Mind-Atlas-Realtime-Max-Session-Seconds") ?? "");
  notifyHostedServiceSessionChanged();
  return {
    sdp,
    maxSessionSeconds: Number.isFinite(maxSessionSeconds) && maxSessionSeconds > 0 ? maxSessionSeconds : undefined,
  };
}

export async function transcribeAudio(blob: Blob, fileName = "dictation.webm"): Promise<AudioTranscriptionResult> {
  const formData = new FormData();
  formData.set("audio", blob, fileName);
  const response = await fetchBridge("/api/audio/transcriptions", {
    method: "POST",
    body: formData,
  });
  const result = await readJsonResponse<AudioTranscriptionResult>(response);
  notifyHostedServiceSessionChanged();
  return result;
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const response = await fetchBridge("/api/tools/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const result = await readJsonResponse<WebSearchResult>(response);
  notifyHostedServiceSessionChanged();
  return result;
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
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: init.method ?? "GET",
        credentials: isHostedServiceMode() ? "include" : init.credentials,
      });
      preferredBridgeUrl = baseUrl;
      return response;
    } catch (error) {
      lastError = error;
      if (preferredBridgeUrl === baseUrl) preferredBridgeUrl = null;
    }
  }
  const diagnostics = await probeBridgeHealthForDiagnostics(candidates);
  throw createBridgeFetchError(path, lastError, candidates, diagnostics);
}

async function fetchBridge(path: string, init: RequestInit) {
  const baseUrl = await getReachableBridgeUrl();
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: isHostedServiceMode() ? "include" : init.credentials,
    });
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
      const response = await fetch(`${baseUrl}/health`, { credentials: isHostedServiceMode() ? "include" : "same-origin" });
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
  if (isHostedServiceMode()) {
    return new Error(
      [
        formatAppMessage("error.bridge.connectionFailed"),
        `Path: ${path}`,
        diagnostics ? `Health: ${diagnostics}` : "",
        `Reason: ${reason}`,
        formatAppMessage("error.bridge.checkSettings"),
      ].filter(Boolean).join("\n"),
    );
  }
  return new Error(
    [
      "Failed to fetch Mind Atlas bridge.",
      `Path: ${path}`,
      `Tried: ${candidates.join(", ")}`,
      ...(diagnostics ? [`Health after failure: ${diagnostics}`] : []),
      `Reason: ${reason}`,
      "Check that the bridge process is running, the page and bridge protocols both use HTTPS for LAN/mobile testing, the dev certificate is trusted, the firewall allows port 8787, and MIND_ATLAS_ALLOWED_ORIGIN includes this page origin.",
    ].join("\n"),
  );
}

async function probeBridgeHealthForDiagnostics(candidates: string[]) {
  const results: string[] = [];
  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/health`, { credentials: isHostedServiceMode() ? "include" : "same-origin" });
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
    if (isHostedServiceMode() && response.status === 402) notifyHostedServiceSessionChanged();
    const message = isHostedServiceMode()
      ? formatHostedServiceError(response.status, data, `Bridge request failed with ${response.status}`)
      : typeof data.error === "string" ? data.error : `Bridge request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function readBridgeErrorText(status: number, text: string, fallbackMessage: string) {
  if (!isHostedServiceMode()) return text || fallbackMessage;
  try {
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return formatHostedServiceError(status, data, fallbackMessage);
  } catch {
    return formatHostedServiceError(status, { error: text }, fallbackMessage);
  }
}

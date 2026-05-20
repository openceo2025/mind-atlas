import type {
  AiBridgeHealth,
  AiResponsePayload,
  AiResponseResult,
  AudioTranscriptionResult,
  CloudNotebookListResult,
  CloudNotebookSaveResult,
  CodexOptionsResult,
  RealtimeSessionConfig,
  TextPartnerTurnPayload,
  TextPartnerTurnResult,
  WebSearchResult,
} from "../types";

const FALLBACK_BRIDGE_URL = "http://127.0.0.1:8787";

export function getBridgeUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const configuredUrl = env?.VITE_MIND_ATLAS_BRIDGE_URL ?? FALLBACK_BRIDGE_URL;
  return resolveBridgeUrl(configuredUrl).replace(/\/+$/, "");
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

export async function getAiBridgeHealth(): Promise<AiBridgeHealth> {
  const response = await fetch(`${getBridgeUrl()}/health`);
  return await readJsonResponse<AiBridgeHealth>(response);
}

export async function requestAiResponse(payload: AiResponsePayload): Promise<AiResponseResult> {
  const response = await fetch(`${getBridgeUrl()}/api/ai/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<AiResponseResult>(response);
}

export async function requestTextPartnerTurn(payload: TextPartnerTurnPayload): Promise<TextPartnerTurnResult> {
  const response = await fetch(`${getBridgeUrl()}/api/ai/text-partner-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<TextPartnerTurnResult>(response);
}

export async function getCodexOptions(): Promise<CodexOptionsResult> {
  const response = await fetch(`${getBridgeUrl()}/api/codex/options`);
  return await readJsonResponse<CodexOptionsResult>(response);
}

export async function createRealtimeClientSecret(payload: RealtimeSessionConfig) {
  const response = await fetch(`${getBridgeUrl()}/api/realtime/client-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await readJsonResponse<Record<string, unknown>>(response);
}

export async function createRealtimeCall(payload: RealtimeSessionConfig & { sdp: string }) {
  const response = await fetch(`${getBridgeUrl()}/api/realtime/calls`, {
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
  const response = await fetch(`${getBridgeUrl()}/api/audio/transcriptions`, {
    method: "POST",
    body: formData,
  });
  return await readJsonResponse<AudioTranscriptionResult>(response);
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const response = await fetch(`${getBridgeUrl()}/api/tools/web-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return await readJsonResponse<WebSearchResult>(response);
}

export async function saveCloudNotebookPackage(blob: Blob, fileName: string): Promise<CloudNotebookSaveResult> {
  const formData = new FormData();
  formData.set("package", blob, fileName);
  const response = await fetch(`${getBridgeUrl()}/api/cloud/notebooks`, {
    method: "POST",
    body: formData,
  });
  return await readJsonResponse<CloudNotebookSaveResult>(response);
}

export async function listCloudNotebookPackages(): Promise<CloudNotebookListResult> {
  const response = await fetch(`${getBridgeUrl()}/api/cloud/notebooks`);
  return await readJsonResponse<CloudNotebookListResult>(response);
}

export async function downloadCloudNotebookPackage(name: string): Promise<Blob> {
  const response = await fetch(`${getBridgeUrl()}/api/cloud/notebooks/${encodeURIComponent(name)}`);
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Bridge request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

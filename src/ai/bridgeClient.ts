import type { AiBridgeHealth, AiResponsePayload, AiResponseResult, RealtimeSessionConfig } from "../types";

const FALLBACK_BRIDGE_URL = "http://127.0.0.1:8787";

export function getBridgeUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_MIND_ATLAS_BRIDGE_URL ?? FALLBACK_BRIDGE_URL).replace(/\/+$/, "");
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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Bridge request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

import type { HostedServiceSession } from "../types";
import { HOSTED_SERVICE_SESSION_REFRESH_EVENT } from "../events";

const PUBLIC_SERVICE_FLAG = "VITE_MIND_ATLAS_PUBLIC_SERVICE";
const SERVICE_URL_FLAG = "VITE_MIND_ATLAS_SERVICE_URL";

export function isHostedServiceMode() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.[PUBLIC_SERVICE_FLAG] ?? "";
  return value === "1" || value.toLowerCase() === "true";
}

export function getHostedServiceUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const configured = env?.[SERVICE_URL_FLAG]?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export async function fetchHostedServiceSession(): Promise<HostedServiceSession> {
  const response = await hostedFetch("/api/service/session");
  return await readHostedJson<HostedServiceSession>(response);
}

export function startHostedGoogleLogin() {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const url = new URL(`${getHostedServiceUrl()}/api/auth/google/start`);
  url.searchParams.set("returnTo", returnTo || "/");
  window.location.assign(url.toString());
}

export async function startHostedBillingCheckout() {
  const response = await hostedFetch("/api/billing/checkout", { method: "POST" });
  const data = await readHostedJson<{ url: string }>(response);
  if (data.url && typeof window !== "undefined") window.location.assign(data.url);
}

export async function openHostedBillingPortal() {
  const response = await hostedFetch("/api/billing/portal", { method: "POST" });
  const data = await readHostedJson<{ url: string }>(response);
  if (data.url && typeof window !== "undefined") window.location.assign(data.url);
}

export async function logoutHostedService() {
  const response = await hostedFetch("/api/auth/logout", { method: "POST" });
  await readHostedJson<{ ok: boolean }>(response);
}

export function notifyHostedServiceSessionChanged() {
  if (!isHostedServiceMode() || typeof window === "undefined") return;
  window.dispatchEvent(new Event(HOSTED_SERVICE_SESSION_REFRESH_EVENT));
}

export function formatHostedServiceError(status: number, data: Record<string, unknown> = {}, fallbackMessage = "") {
  const code = typeof data.code === "string" ? data.code : "";
  const raw = typeof data.error === "string" ? data.error : fallbackMessage;
  const text = `${code} ${raw}`.toLowerCase();

  if (code === "auth_required" || text.includes("google login")) {
    return "Googleログインが必要です。右上のAI機能からログインしてください。";
  }
  if (code === "subscription_required" || text.includes("subscription")) {
    return "AI機能は月額登録後に利用できます。Notebook本体はこのまま使えます。";
  }
  if (code === "credit_exhausted" || text.includes("token is exhausted") || text.includes("too low")) {
    return "今月のAI利用トークンを使い切りました。次回更新日までAIリクエストは停止します。";
  }
  if (code === "request_too_large" || code === "audio_too_large" || status === 413) {
    return "今回の入力が大きすぎます。対象ノードや添付、音声の長さを減らしてもう一度試してください。";
  }
  if (code === "model_not_enabled") {
    return "選択中のモデルは現在利用できません。別のモデルを選んでください。";
  }
  if (code === "pricing_not_configured") {
    return "このモデルは利用上限の計算が未設定です。公開前の安全設定により停止しています。";
  }
  if (code === "service_not_configured") {
    return "AIサービスのサーバー設定がまだ完了していません。管理者側のキー設定が必要です。";
  }
  if (code === "provider_unavailable" || status === 429 || status >= 500) {
    return "AIサービスに接続できませんでした。少し待つか、別のモデルで再試行してください。";
  }
  if (status === 400) {
    return "リクエスト内容を確認してください。入力、モデル、または添付が現在の公開設定に合っていない可能性があります。";
  }
  return scrubHostedServiceError(raw) || `Mind Atlas service request failed with ${status}`;
}

async function hostedFetch(path: string, init: RequestInit = {}) {
  return await fetch(`${getHostedServiceUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
}

async function readHostedJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error ?? "Unknown JSON parse error");
    throw new Error(`Mind Atlas service returned malformed JSON: ${reason}`);
  }
  if (!response.ok) {
    const message = formatHostedServiceError(response.status, data, `Mind Atlas service request failed with ${response.status}`);
    throw new Error(message);
  }
  return data as T;
}

function scrubHostedServiceError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [secret]")
    .replace(/\b(sk|rk|pk|whsec|ghp|glpat)_[A-Za-z0-9._-]+/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .trim()
    .slice(0, 220);
}

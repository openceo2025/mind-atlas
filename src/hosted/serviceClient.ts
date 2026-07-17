import type {
  AtlasNode,
  CloudNotebookDeleteResult,
  CloudNotebookListResult,
  CloudNotebookLoadResult,
  CloudNotebookSaveResult,
  CloudNotebookShareResult,
  HostedServiceSession,
} from "../types";
import { HOSTED_SERVICE_SESSION_REFRESH_EVENT } from "../events";
import { isAboutDemoMode } from "../aboutDemo";
import { formatAppMessage } from "../i18n/format";

const PUBLIC_SERVICE_FLAG = "VITE_MIND_ATLAS_PUBLIC_SERVICE";
const SERVICE_URL_FLAG = "VITE_MIND_ATLAS_SERVICE_URL";

export function isHostedServiceMode() {
  if (isAboutDemoMode()) return false;
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

export type HostedGoogleLoginTrigger = "cloud_save" | "share" | "account" | "remix";

export function startHostedGoogleLogin(trigger: HostedGoogleLoginTrigger = "account") {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const url = new URL(`${getHostedServiceUrl()}/api/auth/google/start`);
  url.searchParams.set("returnTo", returnTo || "/");
  url.searchParams.set("trigger", trigger);
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

export async function listHostedCloudNotebooks(): Promise<CloudNotebookListResult> {
  const response = await hostedFetch("/api/cloud/notebooks");
  return await readHostedJson<CloudNotebookListResult>(response);
}

export async function saveHostedCloudNotebook(root: AtlasNode, title = root.title): Promise<CloudNotebookSaveResult> {
  const response = await hostedFetch("/api/cloud/notebooks", {
    method: "POST",
    body: JSON.stringify({ root, title }),
  });
  return await readHostedJson<CloudNotebookSaveResult>(response);
}

export async function loadHostedCloudNotebook(id: string): Promise<CloudNotebookLoadResult> {
  const response = await hostedFetch(`/api/cloud/notebooks/${encodeURIComponent(id)}`);
  return await readHostedJson<CloudNotebookLoadResult>(response);
}

export async function updateHostedCloudNotebook(id: string, root: AtlasNode, title = root.title): Promise<CloudNotebookSaveResult> {
  const response = await hostedFetch(`/api/cloud/notebooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ root, title }),
  });
  return await readHostedJson<CloudNotebookSaveResult>(response);
}

export async function renameHostedCloudNotebook(id: string, title: string): Promise<CloudNotebookSaveResult> {
  const response = await hostedFetch(`/api/cloud/notebooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return await readHostedJson<CloudNotebookSaveResult>(response);
}

export async function deleteHostedCloudNotebook(id: string): Promise<CloudNotebookDeleteResult> {
  const response = await hostedFetch(`/api/cloud/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  return await readHostedJson<CloudNotebookDeleteResult>(response);
}

export async function shareHostedCloudNotebook(id: string): Promise<CloudNotebookShareResult> {
  const response = await hostedFetch(`/api/cloud/notebooks/${encodeURIComponent(id)}/share`, { method: "POST" });
  return await readHostedJson<CloudNotebookShareResult>(response);
}

export async function createHostedCloudShare(root: AtlasNode, title = root.title): Promise<CloudNotebookShareResult> {
  const response = await hostedFetch("/api/share/notebooks", {
    method: "POST",
    body: JSON.stringify({ root, title }),
  });
  return await readHostedJson<CloudNotebookShareResult>(response);
}

export async function loadHostedSharedNotebook(token: string): Promise<CloudNotebookLoadResult> {
  const response = await hostedFetch(`/api/share/notebooks/${encodeURIComponent(token)}`);
  return await readHostedJson<CloudNotebookLoadResult>(response);
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
    return formatAppMessage("service.authRequired");
  }
  if (code === "billing_period_unavailable" || text.includes("renewal date") || text.includes("billing period")) {
    return formatAppMessage("service.billingPeriodUnavailable");
  }
  if (code === "subscription_required" || text.includes("subscription")) {
    return formatAppMessage("service.subscriptionRequired");
  }
  if (code === "credit_exhausted" || text.includes("exhausted") || text.includes("too low")) {
    return formatAppMessage("service.creditExhausted");
  }
  if (code === "cloud_notebook_too_large") {
    return formatAppMessage("service.cloudNotebookTooLarge");
  }
  if (code === "request_too_large" || code === "audio_too_large" || status === 413) {
    return formatAppMessage("service.requestTooLarge");
  }
  if (code === "model_not_enabled") {
    return formatAppMessage("service.modelNotEnabled");
  }
  if (code === "pricing_not_configured") {
    return formatAppMessage("service.pricingNotConfigured");
  }
  if (code === "service_not_configured") {
    return formatAppMessage("service.notConfigured");
  }
  if (code === "provider_unavailable" || status === 429 || status >= 500) {
    return formatAppMessage("service.providerUnavailable");
  }
  if (status === 400) {
    return formatAppMessage("service.badRequest");
  }
  return scrubHostedServiceError(raw) || formatAppMessage("service.generic", { status });
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

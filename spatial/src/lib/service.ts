// hosted（公開サービス）とローカル開発ブリッジの両方に話す軽量クライアント。
// 公開ビルドでは VITE_MIND_ATLAS_PUBLIC_SERVICE=true で固定され、ブリッジには一切つながない。
import { t, type MessageKey } from '../i18n';
import type { Space } from '../types';

export const HOSTED = import.meta.env.VITE_MIND_ATLAS_PUBLIC_SERVICE === 'true';

export const SESSION_CHANGED_EVENT = 'mindatlas:session-changed';

export function serviceBaseUrl() {
  if (HOSTED) {
    const configured = (import.meta.env.VITE_MIND_ATLAS_SERVICE_URL as string | undefined)?.trim();
    return (configured || window.location.origin).replace(/\/+$/, '');
  }
  const configured = (import.meta.env.VITE_MIND_ATLAS_BRIDGE_URL as string | undefined)?.trim() || 'http://127.0.0.1:8787';
  try {
    const url = new URL(configured);
    if (window.location.protocol === 'https:' && url.protocol === 'http:') url.protocol = 'https:';
    const pageHost = window.location.hostname;
    const local = (h: string) => h === '127.0.0.1' || h === 'localhost';
    if (local(url.hostname) && !local(pageHost)) url.hostname = pageHost;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return configured.replace(/\/+$/, '');
  }
}

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${serviceBaseUrl()}${path}`, {
      ...init,
      credentials: HOSTED ? 'include' : 'same-origin',
      headers: {
        ...(init.body instanceof FormData || !init.body ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new ServiceError(0, 'network', HOSTED ? t('error.network') : t('error.bridgeUnreachable'));
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!response.ok) {
    const code = typeof data.code === 'string' ? data.code : '';
    const raw = typeof data.error === 'string' ? data.error : '';
    if (response.status === 402 || response.status === 401) notifySessionChanged();
    throw new ServiceError(response.status, code, describeServiceError(response.status, code, raw));
  }
  return data as T;
}

const ERROR_KEYS: Record<string, MessageKey> = {
  auth_required: 'error.authRequired',
  subscription_required: 'error.subscriptionRequired',
  credit_exhausted: 'error.creditExhausted',
  billing_period_unavailable: 'error.billingPeriod',
  request_too_large: 'error.tooLarge',
  space_too_large: 'error.spaceTooLarge',
  model_not_enabled: 'error.modelNotEnabled',
  pricing_not_configured: 'error.modelNotEnabled',
  service_not_configured: 'error.notConfigured',
  rate_limited: 'error.rateLimited',
};

export function describeServiceError(status: number, code: string, raw: string) {
  if (ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
  if (status === 401) return t('error.authRequired');
  if (status === 402) return t('error.subscriptionRequired');
  if (status === 413) return t('error.tooLarge');
  if (status === 429) return t('error.rateLimited');
  if (status === 503 && !HOSTED) return t('error.bridgeKeyMissing');
  if (status >= 500) return t('error.provider');
  return scrub(raw) || t('error.generic', { status });
}

function scrub(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [secret]')
    .replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9._-]+/g, '[secret]')
    .trim()
    .slice(0, 200);
}

export function notifySessionChanged() {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

// ── セッション・アカウント ─────────────────────────────
export interface HostedSession {
  publicService: boolean;
  authenticated: boolean;
  user: { id: string; email: string; name: string; pictureUrl: string; role: string } | null;
  subscription: { status: string; currentPeriodEnd?: string; cancelAtPeriodEnd: boolean } | null;
  credit: { remainingPercent: number; exhausted: boolean; limitMicroUsd?: number } | null;
  aiLimits?: { reserveCharsPerToken: number; maxOutputTokens: number };
  chatOptions?: { defaultService?: string; services?: ChatService[] };
  entitlement: { aiEnabled: boolean; reason?: string } | null;
  aiPreference?: AiPreference | null;
}

/** アカウントに保存された AI モデル（旧 MindAtlas と共通） */
export interface AiPreference {
  provider: string;
  model: string;
  reasoningEffort: string;
  updatedAt?: string;
}

export interface SessionState {
  mode: 'hosted' | 'local';
  loaded: boolean;
  authenticated: boolean;
  user: HostedSession['user'];
  subscriptionActive: boolean;
  subscription: HostedSession['subscription'];
  creditPercent: number | null;
  creditLimitMicroUsd: number | null;
  aiLimits: { reserveCharsPerToken: number; maxOutputTokens: number } | null;
  chatServices: ChatService[];
  aiEnabled: boolean;
  aiReason?: string;
  bridgeOnline?: boolean;
  aiPreference?: AiPreference | null;
}

export async function fetchSession(): Promise<SessionState> {
  if (!HOSTED) {
    try {
      const response = await api('/health');
      const ok = response.ok;
      return { mode: 'local', loaded: true, authenticated: false, user: null, subscriptionActive: false, subscription: null, creditPercent: null, creditLimitMicroUsd: null, aiLimits: null, chatServices: [], aiEnabled: ok, bridgeOnline: ok };
    } catch {
      return { mode: 'local', loaded: true, authenticated: false, user: null, subscriptionActive: false, subscription: null, creditPercent: null, creditLimitMicroUsd: null, aiLimits: null, chatServices: [], aiEnabled: false, bridgeOnline: false };
    }
  }
  const data = await json<HostedSession>(await api('/api/service/session'));
  const active = ['active', 'trialing'].includes(data.subscription?.status ?? '');
  return {
    mode: 'hosted',
    loaded: true,
    authenticated: data.authenticated,
    user: data.user,
    subscriptionActive: active,
    subscription: data.subscription,
    creditPercent: data.credit?.remainingPercent ?? null,
    creditLimitMicroUsd: data.credit?.limitMicroUsd ?? null,
    aiLimits: data.aiLimits ?? null,
    chatServices: (data.chatOptions?.services ?? []).filter((service) => service.configured),
    aiEnabled: Boolean(data.entitlement?.aiEnabled),
    aiReason: data.entitlement?.reason,
    aiPreference: data.aiPreference ?? null,
  };
}

export async function saveAiPreference(preference: Pick<AiPreference, 'provider' | 'model' | 'reasoningEffort'>) {
  const data = await json<{ preference: AiPreference }>(
    await api('/api/account/ai-preference', { method: 'POST', body: JSON.stringify(preference) }),
  );
  return data.preference;
}

export function startLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const url = new URL(`${serviceBaseUrl()}/api/auth/google/start`);
  url.searchParams.set('returnTo', returnTo || '/');
  url.searchParams.set('trigger', 'account');
  window.location.assign(url.toString());
}

export async function logout() {
  await json(await api('/api/auth/logout', { method: 'POST' }));
  notifySessionChanged();
}

export async function startCheckout() {
  const data = await json<{ url: string }>(await api('/api/billing/checkout', { method: 'POST' }));
  if (data.url) window.location.assign(data.url);
}

export async function openBillingPortal() {
  const data = await json<{ url: string }>(await api('/api/billing/portal', { method: 'POST' }));
  if (data.url) window.location.assign(data.url);
}

// ── AI ───────────────────────────────────────────────
export interface ChatModel {
  model: string;
  displayName?: string;
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number; estimated?: boolean };
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: string[];
}
export interface ChatService {
  id: string;
  label: string;
  configured: boolean;
  defaultModel: string;
  models: ChatModel[];
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: string[];
}

export async function fetchChatOptions(): Promise<ChatService[]> {
  const data = await json<{ services?: ChatService[] }>(await api('/api/chat/options'));
  return (data.services ?? []).filter((s) => s.configured);
}

export interface AiToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AiTurnMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant が道具を使うと決めたとき */
  toolCalls?: AiToolCall[];
  /** role: 'tool' の返答 */
  toolCallId?: string;
  name?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  creditRemainingPercent?: number;
}

export interface AiTurnResult {
  text: string;
  provider: string;
  model: string;
  toolCalls?: AiToolCall[];
  usage?: AiUsage;
}

export async function aiTurn(payload: {
  provider: string;
  model?: string;
  messages: AiTurnMessage[];
  contextText?: string;
  reasoningEffort?: string;
  tools?: { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[];
}) {
  const result = await json<AiTurnResult>(
    await api('/api/ai/text-partner-turn', {
      method: 'POST',
      body: JSON.stringify({ ...payload, product: 'spatial', tools: payload.tools ?? [] }),
    }),
  );
  notifySessionChanged();
  return result;
}

export interface WebSearchResult {
  usage?: AiUsage;
  text: string;
  citations?: { url: string; title?: string }[];
  sources?: { url: string; title?: string }[];
}

export async function webSearch(query: string) {
  const result = await json<WebSearchResult>(await api('/api/tools/web-search', { method: 'POST', body: JSON.stringify({ query }) }));
  notifySessionChanged();
  return result;
}

export async function transcribe(blob: Blob) {
  const form = new FormData();
  form.set('audio', blob, 'dictation.webm');
  const result = await json<{ text: string }>(await api('/api/audio/transcriptions', { method: 'POST', body: form }));
  notifySessionChanged();
  return result;
}

export async function createRealtimeCall(payload: Record<string, unknown>) {
  const response = await api('/api/realtime/calls', { method: 'POST', body: JSON.stringify(payload) });
  if (!response.ok) await json(response);
  const sdp = await response.text();
  const max = Number(response.headers.get('X-Mind-Atlas-Realtime-Max-Session-Seconds') ?? '');
  notifySessionChanged();
  return {
    sdp,
    maxSessionSeconds: Number.isFinite(max) && max > 0 ? max : undefined,
    sessionId: response.headers.get('X-Mind-Atlas-Realtime-Session-Id') ?? '',
  };
}

/** 通話の終わりを伝える。話した時間ぶんだけ課金され、次のセッションもすぐ始められる */
export async function endRealtimeCall(sessionId: string) {
  if (!sessionId) return;
  await api(`/api/realtime/calls/${encodeURIComponent(sessionId)}/end`, { method: 'POST' }).catch(() => undefined);
  notifySessionChanged();
}

// ── 埋め込み ─────────────────────────────────────────
export interface EmbeddingResult {
  model: string;
  dims: number;
  /** base64 化した float32 配列 */
  vectors: string[];
}

export async function fetchEmbeddings(texts: string[]) {
  return await json<EmbeddingResult>(await api('/api/embeddings', { method: 'POST', body: JSON.stringify({ texts }) }));
}

// ── スペース（クラウド保存・共有） ──────────────────────
export interface CloudSpaceEntry {
  id: string;
  title: string;
  cardCount: number;
  updatedAt: string;
  shareToken?: string | null;
}

export async function listCloudSpaces() {
  return (await json<{ spaces: CloudSpaceEntry[]; usedBytes: number; limitBytes: number }>(await api('/api/spaces'))).spaces;
}

export async function loadCloudSpace(id: string) {
  return await json<{ space: Space; entry: CloudSpaceEntry }>(await api(`/api/spaces/${encodeURIComponent(id)}`));
}

export async function saveCloudSpace(space: Space) {
  const body = JSON.stringify({ space: { ...space, cloudId: undefined, cloudUpdatedAt: undefined } });
  const path = space.cloudId ? `/api/spaces/${encodeURIComponent(space.cloudId)}` : '/api/spaces';
  return await json<{ entry: CloudSpaceEntry }>(await api(path, { method: space.cloudId ? 'PUT' : 'POST', body }));
}

export async function deleteCloudSpace(id: string) {
  await json(await api(`/api/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function shareCloudSpace(id: string, enabled: boolean) {
  return await json<{ shareToken: string | null; url: string | null }>(
    await api(`/api/spaces/${encodeURIComponent(id)}/share`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  );
}

export async function loadSharedSpace(token: string) {
  return await json<{ space: Space; title: string }>(await api(`/api/public/spaces/${encodeURIComponent(token)}`));
}

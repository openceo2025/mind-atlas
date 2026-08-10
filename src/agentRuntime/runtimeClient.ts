// Local-only client for the agent runtime bridge surface.
//
// Every export here is a no-op / throws in hosted public mode, so a hosted
// build can never reach a local agent endpoint even if a component slipped
// through a gating mistake.

import type {
  AgentCapabilitiesResult,
  AgentRunEvent,
  AgentRunFinal,
  AgentRunManifest,
} from "./types";
import { getBridgeUrl } from "../ai/bridgeClient";
import { isHostedServiceMode } from "../hosted/serviceClient";

export function isAgentRuntimeAvailable() {
  return !isHostedServiceMode();
}

function assertLocal() {
  if (!isAgentRuntimeAvailable()) {
    throw new Error("Local agent runs are not available in hosted public mode.");
  }
}

export interface StartAgentRunPayload {
  provider: "codex" | "claude";
  clientRunId?: string;
  requestNodeId?: string;
  sourceNodeId?: string;
  workspace: string;
  workspaceMode?: "shared" | "worktree";
  prompt: string;
  title?: string;
  model?: string;
  effort?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  sessionMode?: "auto" | "new" | "resume" | "fork";
  session?: { threadId?: string; sessionId?: string } | null;
  claudeSettings?: Record<string, unknown>;
  evidence?: Array<{ id: string; kind: string; displayName: string; localPath: string; mimeType: string; size: number }>;
  atlasSnapshot?: unknown;
}

export interface AgentRunDescription {
  manifest: AgentRunManifest;
  final: AgentRunFinal | null;
}

export async function getAgentCapabilities(options: { refresh?: boolean; workspace?: string; authMode?: string } = {}) {
  assertLocal();
  const params = new URLSearchParams();
  if (options.refresh) params.set("refresh", "1");
  if (options.workspace) params.set("workspace", options.workspace);
  if (options.authMode) params.set("authMode", options.authMode);
  const query = params.toString();
  return await requestJson<AgentCapabilitiesResult>(`/api/agent-capabilities${query ? `?${query}` : ""}`);
}

export interface AgentWorkspaceInfo {
  /** True for any readable directory, including a folder without Git. */
  workspaceAvailable: boolean;
  workspaceKind: "git" | "directory" | "unavailable";
  /** True only when Git metadata and repository identity are available. */
  available: boolean;
  requestedWorkspace: string;
  resolvedWorkspace: string;
  gitRoot: string;
  repositoryName: string;
  commonGitDir: string;
  repositoryId: string;
  branch: string;
  head: string;
  dirtyCount: number;
  changedFiles: string[];
  statusPreview: string;
  diffPreview: string;
  detail: string;
  managedMissionWorktree: boolean;
}

export async function inspectAgentWorkspace(workspace: string) {
  assertLocal();
  const params = new URLSearchParams({ workspace });
  return await requestJson<AgentWorkspaceInfo>(`/api/agent-workspace/inspect?${params.toString()}`);
}

export async function startAgentRun(payload: StartAgentRunPayload) {
  assertLocal();
  return await requestJson<AgentRunDescription>("/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function describeAgentRun(runId: string) {
  assertLocal();
  return await requestJson<AgentRunDescription>(`/api/agent-runs/${encodeURIComponent(runId)}`);
}

export async function listAgentRuns(limit = 50) {
  assertLocal();
  return await requestJson<{ runs: AgentRunManifest[] }>(`/api/agent-runs?limit=${limit}`);
}

/**
 * Resolve the runtime run started for a browser-generated client run id. Used
 * by the workspace to attach to a run dispatched through `/api/ai/respond`.
 */
export async function findAgentRunByClientId(clientRunId: string) {
  assertLocal();
  const response = await fetch(`${getBridgeUrl()}/api/agent-runs/by-client/${encodeURIComponent(clientRunId)}`);
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { manifest?: AgentRunManifest } | null;
  return data?.manifest ?? null;
}

export async function interruptAgentRun(runId: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/interrupt`, {});
}

export async function steerAgentRun(runId: string, text: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/steer`, { text });
}

export async function compactAgentRun(runId: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/compact`, {});
}

export async function checkpointAgentRun(runId: string, message = "") {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/checkpoint`, { message });
}

export async function revertAgentRunCheckpoint(runId: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/checkpoint/revert`, { confirmation: runId });
}

export async function removeAgentRunWorktree(runId: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/worktree/remove`, { confirmation: runId });
}

export async function cleanupAgentRuntime() {
  assertLocal();
  return await controlRequest("/api/agent-runtime/cleanup", {});
}

export async function resolveAgentApproval(runId: string, requestId: string, decision: string) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(requestId)}`, { decision });
}

export async function resolveAgentUserInput(runId: string, requestId: string, answers: Record<string, string[]>) {
  assertLocal();
  return await controlRequest(`/api/agent-runs/${encodeURIComponent(runId)}/user-input/${encodeURIComponent(requestId)}`, { answers });
}

export interface AgentHandoffResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  handoff?: Record<string, unknown>;
  plan?: {
    kind: string;
    title?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    manualSteps?: string[];
    steps?: string[];
    continuity?: { kind: string; label: string; deepLinkAvailable?: boolean; desktopAvailable?: boolean };
  };
  ownership?: { state: string };
  launched?: boolean;
}

export async function prepareAgentHandoff(runId: string, options: { launch?: boolean; atlasContext?: unknown } = {}) {
  assertLocal();
  const response = await fetch(`${getBridgeUrl()}/api/agent-runs/${encodeURIComponent(runId)}/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ launch: options.launch === true, atlasContext: options.atlasContext ?? null }),
  });
  return (await response.json()) as AgentHandoffResult;
}

export async function reclaimAgentRun(runId: string) {
  assertLocal();
  const response = await fetch(`${getBridgeUrl()}/api/agent-runs/${encodeURIComponent(runId)}/reclaim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return (await response.json()) as {
    ok: boolean;
    reason?: string;
    detail?: string;
    ownership?: { state: string };
    reconciliation?: Record<string, unknown>;
  };
}

export async function getAgentRuntimeInbox() {
  assertLocal();
  return await requestJson<{ items: AgentRunDescription[] }>("/api/agent-runtime/inbox");
}

export async function acknowledgeAgentRuntimeRuns(runIds: string[], clientRunIds: string[] = []) {
  assertLocal();
  return await requestJson<{ acknowledged: number }>("/api/agent-runtime/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runIds, clientRunIds }),
  });
}

export interface AgentRunStreamHandlers {
  onManifest?: (manifest: AgentRunManifest) => void;
  onEvent: (event: AgentRunEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * Subscribe to a run's normalized event stream. Reconnects from the last
 * delivered sequence so a dropped connection never loses events.
 */
export function subscribeToAgentRun(runId: string, handlers: AgentRunStreamHandlers, startSequence = 0) {
  assertLocal();
  let closed = false;
  let lastSequence = startSequence;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const response = await fetch(
        `${getBridgeUrl()}/api/agent-runs/${encodeURIComponent(runId)}/events?since=${lastSequence}`,
        { headers: { Accept: "text/event-stream" }, signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error(`Run stream failed with ${response.status}`);
      attempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const lines = frame.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event: "));
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (eventLine?.slice(7).trim() === "manifest") {
            handlers.onManifest?.(payload as AgentRunManifest);
            continue;
          }
          const event = payload as AgentRunEvent;
          if (typeof event?.sequence !== "number" || event.sequence <= lastSequence) continue;
          lastSequence = event.sequence;
          handlers.onEvent(event);
        }
      }
      if (!closed) scheduleRetry();
    } catch (error) {
      if (closed) return;
      if ((error as Error)?.name === "AbortError") return;
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    if (closed) return;
    attempt += 1;
    if (attempt > 12) {
      handlers.onClose?.();
      return;
    }
    const delay = Math.min(10_000, 400 * 2 ** (attempt - 1));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  void connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller?.abort();
  };
}

async function controlRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${getBridgeUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; reason?: string; detail?: string };
  return { ok: Boolean(data.ok), reason: data.reason ?? "", detail: data.detail ?? "" };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getBridgeUrl()}${path}`, init);
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Agent runtime returned malformed JSON with ${response.status}.`);
  }
  if (!response.ok) {
    const message = (data as { error?: string })?.error ?? `Agent runtime request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

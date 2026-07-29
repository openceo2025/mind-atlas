// Local-only HTTP surface for the agent runtime.
//
// Mode: local-only. Every route here exposes Codex / Claude Code / local
// workspaces and must never be reachable from the hosted service. The hosted
// entry (`server/mind-atlas-service.mjs`) does not import this module, and
// `npm run verify:hosted-service` asserts that.
//
// Security posture (plan section 21):
// - loopback binding is enforced by the bridge host setting;
// - mutating routes require an allowed Origin (or no Origin, i.e. a non-browser
//   client on this machine);
// - request bodies are size limited;
// - workspaces are checked against an allow-list before a run starts.

import { boundText } from "./types.mjs";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SSE_HEARTBEAT_MS = 15_000;

const RUN_PATH = /^\/api\/agent-runs\/([A-Za-z0-9-]{6,80})(\/[A-Za-z0-9/_-]*)?$/;

/**
 * @param {{ manager: import("./runtime-manager.mjs").AgentRuntimeManager,
 *           handoff: import("./handoff-coordinator.mjs").HandoffCoordinator,
 *           atlasTools: { handle: (name: string, args: object) => Promise<object>, setSnapshot: Function } | null,
 *           isAllowedOrigin: (origin: string) => boolean,
 *           isAllowedWorkspace: (workspace: string) => { ok: boolean, detail?: string } }} context
 */
export function createAgentRuntimeRoutes(context) {
  const { manager, handoff, isAllowedOrigin, isAllowedWorkspace } = context;

  return async function handleAgentRuntimeRequest(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith("/api/agent-")) return false;
    // The legacy inbox/ack endpoints stay owned by the bridge during migration.
    if (path === "/api/agent-runs/inbox" || path === "/api/agent-runs/ack") return false;

    const method = request.method ?? "GET";
    const mutating = method !== "GET" && method !== "HEAD";
    if (mutating && !originAllowed(request, isAllowedOrigin)) {
      sendJson(response, 403, { error: "Origin is not allowed to control local agent runs." });
      return true;
    }

    if (method === "GET" && path === "/api/agent-capabilities") {
      const capabilities = await manager.getCapabilities({
        refresh: url.searchParams.get("refresh") === "1",
        workspace: url.searchParams.get("workspace") ?? "",
        claudeSettings: { authMode: url.searchParams.get("authMode") ?? "" },
      });
      sendJson(response, 200, capabilities);
      return true;
    }

    if (method === "GET" && path === "/api/agent-workspace/inspect") {
      const workspace = url.searchParams.get("workspace") ?? "";
      const workspaceCheck = isAllowedWorkspace(workspace);
      if (!workspaceCheck.ok) {
        sendJson(response, 400, { error: workspaceCheck.detail ?? "Workspace is not allowed." });
        return true;
      }
      sendJson(response, 200, await manager.inspectWorkspace(workspace));
      return true;
    }

    if (method === "GET" && path === "/api/agent-runs") {
      const runs = await manager.listRuns({ limit: clampInt(url.searchParams.get("limit"), 1, 200, 50) });
      sendJson(response, 200, { runs });
      return true;
    }

    if (method === "GET" && path === "/api/agent-runtime/inbox") {
      const inbox = await manager.inbox({ limit: clampInt(url.searchParams.get("limit"), 1, 200, 100) });
      sendJson(response, 200, inbox);
      return true;
    }

    if (method === "POST" && path === "/api/agent-runtime/ack") {
      const body = await readJsonBody(request);
      const result = await manager.acknowledge(asStringArray(body?.runIds), asStringArray(body?.clientRunIds));
      sendJson(response, 200, result);
      return true;
    }

    if (method === "POST" && path === "/api/agent-runtime/cleanup") {
      sendJson(response, 200, await manager.cleanup());
      return true;
    }

    if (method === "POST" && path === "/api/agent-runs") {
      const body = await readJsonBody(request);
      const workspaceCheck = isAllowedWorkspace(String(body?.workspace ?? ""));
      if (!workspaceCheck.ok) {
        sendJson(response, 400, { error: workspaceCheck.detail ?? "Workspace is not allowed." });
        return true;
      }
      const run = await manager.startRun(normalizeRunRequest(body));
      sendJson(response, run ? 200 : 500, run ?? { error: "Run could not be created." });
      return true;
    }

    // Resolve a runtime run from the browser's own client run id so the
    // workspace can attach to a run that was started through /api/ai/respond.
    if (method === "GET" && path.startsWith("/api/agent-runs/by-client/")) {
      const clientRunId = decodeURIComponent(path.slice("/api/agent-runs/by-client/".length));
      const runs = await manager.listRuns({ limit: 200 });
      const found = runs.find((entry) => entry.clientRunId && entry.clientRunId === clientRunId);
      if (!found) {
        sendJson(response, 404, { error: "No run for that client run id yet." });
        return true;
      }
      sendJson(response, 200, { manifest: found });
      return true;
    }

    const match = RUN_PATH.exec(path);
    if (!match) return false;
    const runId = match[1];
    const suffix = (match[2] ?? "").replace(/^\//, "");

    if (method === "GET" && !suffix) {
      const run = await manager.describeRun(runId);
      if (!run) {
        sendJson(response, 404, { error: "Unknown run" });
        return true;
      }
      sendJson(response, 200, run);
      return true;
    }

    if (method === "GET" && suffix === "events") {
      await streamRunEvents(request, response, manager, runId, url);
      return true;
    }

    if (method === "POST" && suffix === "interrupt") {
      sendControlResult(response, await manager.interrupt(runId));
      return true;
    }

    if (method === "POST" && suffix === "steer") {
      const body = await readJsonBody(request);
      const input = Array.isArray(body?.input)
        ? body.input.map((entry) => ({ type: "text", text: boundText(String(entry?.text ?? entry ?? ""), 32_000) }))
        : [{ type: "text", text: boundText(String(body?.text ?? ""), 32_000) }];
      sendControlResult(response, await manager.steer(runId, input));
      return true;
    }

    if (method === "POST" && suffix === "compact") {
      sendControlResult(response, await manager.compact(runId));
      return true;
    }

    if (method === "POST" && suffix === "checkpoint") {
      const body = await readJsonBody(request);
      sendControlResult(response, await manager.checkpoint(runId, String(body?.message ?? "")));
      return true;
    }

    if (method === "POST" && suffix === "checkpoint/revert") {
      const body = await readJsonBody(request);
      sendControlResult(response, await manager.revertCheckpoint(runId, String(body?.confirmation ?? "")));
      return true;
    }

    if (method === "POST" && suffix === "worktree/remove") {
      const body = await readJsonBody(request);
      sendControlResult(response, await manager.removeWorktree(runId, String(body?.confirmation ?? "")));
      return true;
    }

    if (method === "POST" && suffix.startsWith("approvals/")) {
      const requestId = suffix.slice("approvals/".length);
      const body = await readJsonBody(request);
      sendControlResult(response, await manager.resolveApproval(runId, requestId, String(body?.decision ?? "")));
      return true;
    }

    if (method === "POST" && suffix.startsWith("user-input/")) {
      const requestId = suffix.slice("user-input/".length);
      const body = await readJsonBody(request);
      sendControlResult(response, await manager.resolveUserInput(runId, requestId, body?.answers ?? {}));
      return true;
    }

    if (method === "POST" && suffix === "handoff") {
      const body = await readJsonBody(request);
      const result = await handoff.prepareHandoff(runId, {
        launch: body?.launch === true,
        atlasContext: body?.atlasContext ?? null,
      });
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    if (method === "POST" && suffix === "reclaim") {
      const result = await handoff.reclaim(runId);
      sendJson(response, result.ok ? 200 : 409, result);
      return true;
    }

    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}

async function streamRunEvents(request, response, manager, runId, url) {
  const describe = await manager.describeRun(runId);
  if (!describe) {
    sendJson(response, 404, { error: "Unknown run" });
    return;
  }
  const lastEventId = Number(request.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0);
  const since = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(`event: manifest\ndata: ${JSON.stringify(describe.manifest)}\n\n`);

  let closed = false;
  const write = (event) => {
    if (closed) return;
    try {
      response.write(`id: ${event.sequence}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      closed = true;
    }
  };

  // Buffer live events while the replay is still streaming so nothing is lost
  // and nothing is delivered out of order.
  const buffered = [];
  let replaying = true;
  const unsubscribe = manager.subscribe(runId, (event) => {
    if (replaying) buffered.push(event);
    else write(event);
  });

  const replay = await manager.replay(runId, since);
  for (const event of replay) write(event);
  const highest = replay.length ? replay[replay.length - 1].sequence : since;
  replaying = false;
  for (const event of buffered) {
    if (event.sequence > highest) write(event);
  }

  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      response.write(`: keep-alive ${Date.now()}\n\n`);
    } catch {
      closed = true;
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    try { response.end(); } catch {}
  };
  request.on("close", finish);
  request.on("error", finish);
  response.on("error", finish);
}

function normalizeRunRequest(body) {
  const provider = body?.provider === "claude" ? "claude" : "codex";
  return {
    provider,
    clientRunId: String(body?.clientRunId ?? ""),
    requestNodeId: String(body?.requestNodeId ?? ""),
    sourceNodeId: String(body?.sourceNodeId ?? ""),
    workspace: String(body?.workspace ?? ""),
    workspaceMode: body?.workspaceMode === "worktree" ? "worktree" : "shared",
    prompt: boundText(String(body?.prompt ?? ""), 400_000),
    title: boundText(String(body?.title ?? ""), 300),
    model: String(body?.model ?? ""),
    effort: String(body?.effort ?? ""),
    sandboxMode: String(body?.sandboxMode ?? ""),
    approvalPolicy: String(body?.approvalPolicy ?? ""),
    permissionMode: String(body?.permissionMode ?? ""),
    sessionMode: String(body?.sessionMode ?? "auto"),
    // Browser control is per run and explicit; the adapter still refuses it
    // when the runtime or auth route does not support it.
    browser: body?.browser === true,
    session: body?.session && typeof body.session === "object" ? body.session : null,
    claudeSettings: body?.claudeSettings && typeof body.claudeSettings === "object" ? body.claudeSettings : {},
    evidence: Array.isArray(body?.evidence)
      ? body.evidence.slice(0, 20).map((entry) => ({
        id: String(entry?.id ?? ""),
        kind: String(entry?.kind ?? ""),
        displayName: String(entry?.displayName ?? ""),
        localPath: String(entry?.localPath ?? ""),
        mimeType: String(entry?.mimeType ?? ""),
        size: Number(entry?.size ?? 0),
      }))
      : [],
    git: body?.git && typeof body.git === "object" ? body.git : null,
    // Sanitized run-scoped notebook snapshot for the read-only Atlas tools.
    atlasSnapshot: body?.atlasSnapshot && typeof body.atlasSnapshot === "object" ? body.atlasSnapshot : null,
  };
}

function sendControlResult(response, result) {
  if (result?.ok) {
    sendJson(response, 200, result);
    return;
  }
  const status = result?.reason === "unknown_run" ? 404 : result?.reason === "unsupported" ? 409 : 400;
  sendJson(response, status, result ?? { ok: false, reason: "failed" });
}

function originAllowed(request, isAllowedOrigin) {
  const origin = String(request.headers.origin ?? "");
  if (!origin) return true;
  return isAllowedOrigin(origin);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "")).filter(Boolean) : [];
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({});
      }
    });
    request.on("error", reject);
  });
}

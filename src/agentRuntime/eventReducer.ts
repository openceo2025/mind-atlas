// Pure reducer from normalized run events to the workspace view model.
//
// Rules:
// - unknown event kinds never throw; they become bounded diagnostics;
// - duplicate/out-of-order sequences are ignored;
// - the normalized final message is authoritative for the answer;
// - text deltas accumulate into `streamingAnswer` until a completed message
//   replaces it, so a reconnect mid-stream cannot duplicate text.

import type {
  AgentApprovalRequest,
  AgentFileChangeEntry,
  AgentRunEvent,
  AgentRunManifest,
  AgentRunViewModel,
  AgentSubagentEntry,
  AgentTerminalEntry,
  AgentTimelineEntry,
  AgentUserQuestion,
} from "./types";

const MAX_TIMELINE_ENTRIES = 2000;
const MAX_WARNINGS = 200;

export function createRunViewModel(runId: string, manifest: AgentRunManifest | null = null): AgentRunViewModel {
  return {
    runId,
    manifest,
    status: manifest?.status ?? "queued",
    answer: "",
    streamingAnswer: "",
    reasoning: "",
    plan: null,
    timeline: [],
    fileChanges: [],
    terminal: [],
    subagents: [],
    diff: "",
    approvals: [],
    questions: [],
    usage: { providerSession: null, accountPlan: null, thinkingEstimate: null },
    warnings: [],
    errors: [],
    artifacts: [],
    lastSequence: 0,
    compactionCount: 0,
    session: manifest?.session ?? null,
  };
}

export function reduceRunEvent(model: AgentRunViewModel, event: AgentRunEvent): AgentRunViewModel {
  if (typeof event?.sequence !== "number" || event.sequence <= model.lastSequence) return model;
  const next: AgentRunViewModel = { ...model, lastSequence: event.sequence };

  switch (event.kind) {
    case "lifecycle":
      return applyLifecycle(next, event);
    case "message_delta":
      next.streamingAnswer = `${next.streamingAnswer}${text(event.delta)}`;
      return next;
    case "message_completed": {
      const value = text(event.text);
      next.answer = value;
      next.streamingAnswer = "";
      return pushTimeline(next, event, {
        label: "Answer",
        detail: truncate(value, 400),
        severity: "success",
        expandable: value.length > 400,
      });
    }
    case "reasoning_summary": {
      const value = text(event.delta) || asLines(event.summary);
      next.reasoning = `${next.reasoning}${value}`;
      return next;
    }
    case "plan_updated": {
      const steps = Array.isArray(event.steps)
        ? (event.steps as Array<{ step?: unknown; status?: unknown }>).map((entry) => ({
          step: text(entry?.step),
          status: text(entry?.status),
        }))
        : [];
      next.plan = { explanation: text(event.explanation), steps };
      return pushTimeline(next, event, {
        label: "Plan updated",
        detail: steps.map((entry) => `${entry.status ? `[${entry.status}] ` : ""}${entry.step}`).join("\n"),
        severity: "info",
        expandable: steps.length > 3,
      });
    }
    case "command_started": {
      next.terminal = upsertTerminal(next.terminal, event, {
        command: text(event.command),
        cwd: text(event.cwd),
        status: "running",
        startedAt: event.createdAt,
      });
      return pushTimeline(next, event, {
        label: "Command",
        detail: text(event.command),
        status: "running",
        severity: "info",
        expandable: text(event.command).length > 200,
      });
    }
    case "command_output":
      next.terminal = upsertTerminal(next.terminal, event, {
        output: text(event.chunk),
        status: "running",
      }, true);
      return pushTimeline(next, event, {
        label: "Command output",
        detail: text(event.chunk),
        severity: "info",
        expandable: true,
      });
    case "command_completed": {
      const exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
      next.terminal = upsertTerminal(next.terminal, event, {
        command: text(event.command),
        output: text(event.output),
        status: text(event.status) || (exitCode === 0 ? "completed" : "failed"),
        exitCode,
        durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
        completedAt: event.createdAt,
      });
      return pushTimeline(next, event, {
        label: "Command finished",
        detail: [text(event.command), text(event.output)].filter(Boolean).join("\n"),
        status: text(event.status) || (exitCode === 0 ? "completed" : "failed"),
        exitCode,
        durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
        severity: exitCode === null || exitCode === 0 ? "info" : "warning",
        expandable: true,
      });
    }
    case "file_change": {
      const changes = Array.isArray(event.changes) ? (event.changes as Array<Record<string, unknown>>) : [];
      const status = text(event.status);
      for (const change of changes) {
        const path = text(change.path);
        if (!path) continue;
        const existing = next.fileChanges.findIndex((entry) => entry.path === path);
        const record: AgentFileChangeEntry = {
          path,
          kind: text(change.kind),
          status,
          added: typeof change.added === "number" ? change.added : null,
          removed: typeof change.removed === "number" ? change.removed : null,
        };
        next.fileChanges = existing >= 0
          ? next.fileChanges.map((entry, index) => (index === existing ? { ...entry, ...record } : entry))
          : [...next.fileChanges, record];
      }
      return pushTimeline(next, event, {
        label: "File change",
        detail: changes.map((change) => text(change.path)).filter(Boolean).join("\n") || text(event.detail),
        status,
        severity: status === "failed" ? "warning" : "info",
        expandable: changes.length > 3,
      });
    }
    case "diff_updated":
      next.diff = text(event.diff);
      return next;
    case "tool_started":
      return pushTimeline(next, event, {
        label: `Tool: ${text(event.tool) || text(event.toolKind) || "unknown"}`,
        detail: text(event.detail),
        status: "running",
        severity: "info",
        expandable: text(event.detail).length > 200,
      });
    case "tool_progress":
      return pushTimeline(next, event, {
        label: `Tool progress: ${text(event.tool)}`,
        detail: text(event.detail),
        severity: "info",
        expandable: true,
      });
    case "tool_completed":
      return pushTimeline(next, event, {
        label: `Tool: ${text(event.tool) || text(event.toolKind) || "unknown"}`,
        detail: [text(event.detail), text(event.error)].filter(Boolean).join("\n"),
        status: text(event.status) || "completed",
        durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
        severity: text(event.status) === "failed" || text(event.error) ? "warning" : "info",
        expandable: true,
      });
    case "subagent":
      next.subagents = upsertSubagent(next.subagents, event);
      return pushTimeline(next, event, {
        label: `Sub-agent ${text(event.activity)}`,
        detail: [text(event.agentPath), text(event.agentThreadId)].filter(Boolean).join("\n"),
        severity: "info",
        expandable: false,
      });
    case "approval_requested": {
      const request: AgentApprovalRequest = {
        requestId: text(event.requestId),
        category: text(event.category),
        reason: text(event.reason),
        command: text(event.command),
        cwd: text(event.cwd),
        grantRoot: text(event.grantRoot),
        choices: Array.isArray(event.choices)
          ? (event.choices as Array<{ id?: unknown; label?: unknown }>).map((choice) => ({
            id: text(choice?.id),
            label: text(choice?.label) || text(choice?.id),
          })).filter((choice) => choice.id)
          : [],
        createdAt: event.createdAt,
      };
      next.approvals = [...next.approvals.filter((entry) => entry.requestId !== request.requestId), request];
      return pushTimeline(next, event, {
        label: `Approval requested (${request.category || "provider"})`,
        detail: [request.reason, request.command, request.grantRoot].filter(Boolean).join("\n"),
        severity: "warning",
        expandable: true,
      });
    }
    case "approval_resolved": {
      const requestId = text(event.requestId);
      const decision = text(event.decision);
      next.approvals = next.approvals.map((entry) =>
        entry.requestId === requestId ? { ...entry, resolvedWith: decision } : entry);
      return pushTimeline(next, event, {
        label: "Approval answered",
        detail: decision,
        severity: decision === "decline" ? "warning" : "success",
        expandable: false,
      });
    }
    case "user_input_requested": {
      const question: AgentUserQuestion = {
        requestId: text(event.requestId),
        createdAt: event.createdAt,
        autoResolutionMs: typeof event.autoResolutionMs === "number" ? event.autoResolutionMs : null,
        questions: Array.isArray(event.questions)
          ? (event.questions as Array<Record<string, unknown>>).map((entry) => ({
            id: text(entry.id),
            header: text(entry.header),
            question: text(entry.question),
            allowOther: entry.allowOther === true,
            isSecret: entry.isSecret === true,
            options: Array.isArray(entry.options)
              ? (entry.options as Array<Record<string, unknown>>).map((option) => ({
                id: text(option.id),
                label: text(option.label) || text(option.id),
                description: text(option.description),
              })).filter((option) => option.id)
              : [],
          }))
          : [],
      };
      next.questions = [...next.questions.filter((entry) => entry.requestId !== question.requestId), question];
      return pushTimeline(next, event, {
        label: "Question from the agent",
        detail: question.questions.map((entry) => entry.question).join("\n"),
        severity: "warning",
        expandable: true,
      });
    }
    case "user_input_resolved": {
      const requestId = text(event.requestId);
      next.questions = next.questions.map((entry) => (entry.requestId === requestId ? { ...entry, resolved: true } : entry));
      return pushTimeline(next, event, { label: "Question answered", detail: "", severity: "success", expandable: false });
    }
    case "retry":
      return pushTimeline(next, event, {
        label: "Provider retry",
        detail: text(event.message),
        severity: "warning",
        expandable: true,
      });
    case "usage_updated":
      return applyUsage(next, event);
    case "artifact_created":
      next.artifacts = [...next.artifacts, { kind: text(event.artifactKind), path: text(event.path) }];
      return pushTimeline(next, event, {
        label: `Artifact: ${text(event.artifactKind)}`,
        detail: text(event.path),
        severity: "info",
        expandable: false,
      });
    case "warning": {
      const message = text(event.message);
      if (text(event.code) === "context_compacted") next.compactionCount += 1;
      next.warnings = [...next.warnings, message].slice(-MAX_WARNINGS);
      return pushTimeline(next, event, {
        label: `Warning: ${text(event.code) || "provider"}`,
        detail: message,
        severity: "warning",
        expandable: message.length > 200,
      });
    }
    case "error": {
      const message = text(event.message);
      next.errors = [...next.errors, message].slice(-MAX_WARNINGS);
      return pushTimeline(next, event, {
        label: `Error: ${text(event.code) || "provider"}`,
        detail: message,
        severity: "error",
        expandable: true,
      });
    }
    case "diagnostic":
      return pushTimeline(next, event, {
        label: text(event.code) || "diagnostic",
        detail: text(event.message),
        severity: "info",
        expandable: text(event.message).length > 200,
      });
    default:
      // Unknown provider event: retained as a bounded diagnostic, never fatal.
      return pushTimeline(next, event, {
        label: `Unrecognized event: ${String(event.kind)}`,
        detail: truncate(safeJson(event), 800),
        severity: "info",
        expandable: true,
      });
  }
}

function applyLifecycle(model: AgentRunViewModel, event: AgentRunEvent): AgentRunViewModel {
  const status = text(event.status);
  const next = { ...model };
  if (status === "session") {
    const session = event.session as AgentRunViewModel["session"];
    next.session = session ?? next.session;
    return pushTimeline(next, event, {
      label: "Provider session",
      detail: describeSession(session),
      severity: "info",
      expandable: false,
    });
  }
  if (status && status !== "stopping") {
    next.status = status as AgentRunViewModel["status"];
  } else if (status === "stopping") {
    next.status = "stopping";
  }
  return pushTimeline(next, event, {
    label: statusLabel(status),
    detail: text(event.message),
    severity: status === "failed" ? "error" : status === "interrupted" ? "warning" : status === "completed" ? "success" : "info",
    expandable: false,
  });
}

function applyUsage(model: AgentRunViewModel, event: AgentRunEvent): AgentRunViewModel {
  const usage = (event.usage ?? {}) as Record<string, unknown>;
  const scope = text(usage.scope);
  const next = { ...model, usage: { ...model.usage } };
  if (scope === "account_plan") {
    next.usage.accountPlan = {
      authMode: text(usage.authMode),
      status: text(usage.status),
      rateLimitType: text(usage.rateLimitType),
      resetsAt: typeof usage.resetsAt === "number" ? usage.resetsAt : null,
      isUsingOverage: usage.isUsingOverage === true,
      utilization: numberOr(usage.utilization, null),
    };
    return next;
  }
  if (scope === "thinking_estimate") {
    next.usage.thinkingEstimate = {
      estimatedTokens: typeof usage.estimatedTokens === "number" ? usage.estimatedTokens : null,
    };
    return next;
  }
  const previous = next.usage.providerSession;
  next.usage.providerSession = {
    totalTokens: numberOr(usage.totalTokens, previous?.totalTokens ?? null),
    inputTokens: numberOr(usage.inputTokens, previous?.inputTokens ?? null),
    cachedInputTokens: numberOr(usage.cachedInputTokens, previous?.cachedInputTokens ?? null),
    cacheWriteInputTokens: numberOr(usage.cacheWriteInputTokens, previous?.cacheWriteInputTokens ?? null),
    outputTokens: numberOr(usage.outputTokens, previous?.outputTokens ?? null),
    reasoningOutputTokens: numberOr(usage.reasoningOutputTokens, previous?.reasoningOutputTokens ?? null),
    contextWindow: numberOr(usage.contextWindow, previous?.contextWindow ?? null),
    maxOutputTokens: numberOr(usage.maxOutputTokens, previous?.maxOutputTokens ?? null),
    costUsd: numberOr(usage.costUsd, previous?.costUsd ?? null),
    model: text(usage.model) || previous?.model || "",
    lastTurnTokens: numberOr(usage.lastTurnTokens, previous?.lastTurnTokens ?? null),
    isEstimate: false,
  };
  return next;
}

function pushTimeline(
  model: AgentRunViewModel,
  event: AgentRunEvent,
  entry: Omit<AgentTimelineEntry, "id" | "sequence" | "createdAt" | "kind">,
): AgentRunViewModel {
  const timeline = [
    ...model.timeline,
    {
      id: event.eventId,
      sequence: event.sequence,
      createdAt: event.createdAt,
      kind: event.kind,
      ...entry,
    },
  ];
  return { ...model, timeline: timeline.slice(-MAX_TIMELINE_ENTRIES) };
}

function upsertTerminal(
  entries: AgentTerminalEntry[],
  event: AgentRunEvent,
  patch: Partial<AgentTerminalEntry>,
  appendOutput = false,
) {
  const itemId = text(event.itemId) || `command-${event.sequence}`;
  const index = entries.findIndex((entry) => entry.itemId === itemId);
  const previous = index >= 0 ? entries[index] : null;
  const record: AgentTerminalEntry = {
    itemId,
    command: patch.command || previous?.command || "",
    cwd: patch.cwd || previous?.cwd || "",
    output: appendOutput
      ? `${previous?.output || ""}${patch.output || ""}`.slice(-200_000)
      : patch.output || previous?.output || "",
    status: patch.status || previous?.status || "",
    exitCode: patch.exitCode !== undefined ? patch.exitCode : previous?.exitCode ?? null,
    durationMs: patch.durationMs !== undefined ? patch.durationMs : previous?.durationMs ?? null,
    startedAt: patch.startedAt || previous?.startedAt || event.createdAt,
    completedAt: patch.completedAt || previous?.completedAt || "",
  };
  const next = index >= 0
    ? entries.map((entry, entryIndex) => (entryIndex === index ? record : entry))
    : [...entries, record];
  return next.slice(-200);
}

function upsertSubagent(entries: AgentSubagentEntry[], event: AgentRunEvent) {
  const id = text(event.itemId) || text(event.agentThreadId) || text(event.agentPath) || `subagent-${event.sequence}`;
  const index = entries.findIndex((entry) => entry.id === id);
  const previous = index >= 0 ? entries[index] : null;
  const activity = text(event.activity) || previous?.activity || "updated";
  const status = text(event.status)
    || (/(completed|finished|done|closed)/i.test(activity) ? "completed" : /(failed|error)/i.test(activity) ? "failed" : "running");
  const record: AgentSubagentEntry = {
    id,
    activity,
    status,
    label: text(event.label) || previous?.label || "Sub-agent",
    detail: text(event.detail) || previous?.detail || "",
    agentThreadId: text(event.agentThreadId) || previous?.agentThreadId || "",
    agentPath: text(event.agentPath) || previous?.agentPath || "",
    startedAt: previous?.startedAt || event.createdAt,
    updatedAt: event.createdAt,
  };
  const next = index >= 0
    ? entries.map((entry, entryIndex) => (entryIndex === index ? record : entry))
    : [...entries, record];
  return next.slice(-200);
}

function statusLabel(status: string) {
  switch (status) {
    case "queued": return "Queued";
    case "starting": return "Starting";
    case "running": return "Running";
    case "stopping": return "Stopping";
    case "waiting_for_approval": return "Waiting for approval";
    case "waiting_for_user_input": return "Waiting for your answer";
    case "transferring": return "Handing off";
    case "native_owned": return "Owned by the native application";
    case "reconciliation_required": return "Reconciling";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "interrupted": return "Interrupted";
    default: return status || "Lifecycle";
  }
}

function describeSession(session: AgentRunViewModel["session"]) {
  if (!session) return "";
  const parts = [
    session.action ? `action: ${session.action}` : "",
    session.threadId ? `thread: ${session.threadId}` : "",
    session.sessionId && session.sessionId !== session.threadId ? `session: ${session.sessionId}` : "",
    session.fellBack ? "fell back to a new session" : "",
  ];
  return parts.filter(Boolean).join("\n");
}

function text(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function asLines(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join("\n") : "";
}

function numberOr(value: unknown, fallback: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

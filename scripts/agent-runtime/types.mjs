// Shared constants and small pure helpers for the local agent runtime.
//
// Mode: local-only. This module must never be imported by
// `server/mind-atlas-service.mjs` or any hosted build path.

export const AGENT_EVENT_SCHEMA_VERSION = 1;
export const AGENT_MANIFEST_SCHEMA_VERSION = 1;

/** @typedef {"codex"|"claude"} AgentProviderId */

export const AGENT_PROVIDERS = ["codex", "claude"];

export const AGENT_RUNTIME_ROUTES = [
  "codex-app-server",
  "codex-exec",
  "claude-stream-json",
  "claude-json",
];

export const AGENT_RUN_STATUSES = [
  "queued",
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_user_input",
  "transferring",
  "native_owned",
  "reconciliation_required",
  "completed",
  "failed",
  "interrupted",
];

export const AGENT_TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted"]);

/**
 * Allowed state transitions. `transferring` must settle back to a Mind Atlas
 * state or move to `native_owned`; only an explicit reclaim leaves
 * `native_owned`.
 */
const TRANSITIONS = {
  queued: ["starting", "failed", "interrupted"],
  starting: ["running", "failed", "interrupted", "completed"],
  running: [
    "waiting_for_approval",
    "waiting_for_user_input",
    "transferring",
    "completed",
    "failed",
    "interrupted",
  ],
  waiting_for_approval: ["running", "failed", "interrupted", "completed"],
  waiting_for_user_input: ["running", "failed", "interrupted", "completed"],
  transferring: ["native_owned", "running", "completed", "failed", "interrupted"],
  native_owned: ["reconciliation_required"],
  reconciliation_required: ["completed", "failed", "running"],
  completed: ["transferring"],
  failed: ["transferring"],
  interrupted: ["transferring"],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export const AGENT_EVENT_KINDS = [
  "lifecycle",
  "message_delta",
  "message_completed",
  "plan_updated",
  "reasoning_summary",
  "command_started",
  "command_output",
  "command_completed",
  "file_change",
  "diff_updated",
  "tool_started",
  "tool_progress",
  "tool_completed",
  "subagent",
  "approval_requested",
  "approval_resolved",
  "user_input_requested",
  "user_input_resolved",
  "retry",
  "usage_updated",
  "artifact_created",
  "warning",
  "error",
  "diagnostic",
];

/**
 * Secret shapes that must never reach the run journal, the browser, or a
 * handoff package. Patterns are deliberately broad: over-redaction is
 * acceptable, leakage is not.
 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
];

const SECRET_ASSIGNMENT = /\b((?:[A-Za-z0-9_]*)(?:API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|SECRET|PASSWORD|PASSWD|CLIENT[_-]?SECRET|DATABASE[_-]?URL|CONNECTION[_-]?STRING)[A-Za-z0-9_]*)(\s*[:=]\s*)("?)([^\s"']{6,})\3/gi;

const AUTH_HEADER = /\b(authorization|x-api-key|proxy-authorization)(\s*:\s*)([^\s]+)/gi;

/** Redact secrets from arbitrary text before it is journaled or broadcast. */
export function redactText(value) {
  if (typeof value !== "string" || !value) return value;
  let text = value;
  text = text.replace(SECRET_ASSIGNMENT, (_match, key, separator, quote) => `${key}${separator}${quote}[redacted]${quote}`);
  text = text.replace(AUTH_HEADER, (_match, header, separator) => `${header}${separator}[redacted]`);
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text;
}

/** Recursively redact strings inside a JSON-safe structure with a depth guard. */
export function redactValue(value, depth = 0) {
  if (depth > 8) return "[redacted-depth]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/^(env|environment|headers|secrets|credentials)$/i.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

/** Bound a string to `maxChars`, marking the truncation explicitly. */
export function boundText(value, maxChars) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export function isTerminalStatus(status) {
  return AGENT_TERMINAL_STATUSES.has(status);
}

export function providerOfRoute(route) {
  return route.startsWith("codex") ? "codex" : "claude";
}

/**
 * Reduce a capability object so nothing is advertised that the runtime has not
 * proven. Any capability without evidence is turned off and given a reason.
 */
export function reduceCapabilities(capabilities) {
  const supports = { ...(capabilities.supports ?? {}) };
  const unavailableReasons = { ...(capabilities.unavailableReasons ?? {}) };
  for (const [key, value] of Object.entries(supports)) {
    if (value === true) continue;
    supports[key] = false;
    if (!unavailableReasons[key]) unavailableReasons[key] = "not reported by the installed runtime";
  }
  return { ...capabilities, supports, unavailableReasons };
}

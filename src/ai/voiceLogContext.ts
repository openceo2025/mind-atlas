import type { VoiceLogEntry, VoiceSessionSummary } from "../types";

const MAX_CONTEXT_CHARS = 12000;
const MAX_ENTRY_TEXT_CHARS = 1000;
const MAX_ENTRIES = 50;

export function buildVoiceLogContext(
  entries: VoiceLogEntry[],
  summary: VoiceSessionSummary | null,
  options: { maxChars?: number; maxEntries?: number } = {},
) {
  const maxChars = options.maxChars ?? MAX_CONTEXT_CHARS;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const recentEntries = entries.slice(-maxEntries);
  const lines = [
    "Persistent Mind Atlas AI/Partner log context.",
    "This is the actual cross-session global conversation history visible in the AI/Partner log. Use it when the user asks what was discussed before or continues a global conversation.",
    "If the answer is not present here, say that it is not in the provided AI/Partner log context.",
    summary?.text ? `Saved session summary (${formatLogTime(summary.createdAt)}):\n${truncateText(summary.text, 1600)}` : "",
    recentEntries.length ? "Recent AI/Partner log entries:" : "Recent AI/Partner log entries: none.",
    ...recentEntries.map(formatVoiceLogEntry),
  ].filter(Boolean);
  return truncateFromStart(lines.join("\n\n"), maxChars);
}

function formatVoiceLogEntry(entry: VoiceLogEntry) {
  const parts = [
    `[${formatLogTime(entry.createdAt)}] ${entry.role}${entry.title ? ` / ${entry.title}` : ""}${entry.status ? ` / ${entry.status}` : ""}`,
    entry.toolName ? `tool: ${entry.toolName}` : "",
    truncateText(entry.text, MAX_ENTRY_TEXT_CHARS),
  ].filter(Boolean);
  return parts.join("\n");
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 18)}\n...[truncated]`;
}

function truncateFromStart(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `[Earlier AI/Partner log context truncated]\n${value.slice(value.length - maxChars)}`;
}

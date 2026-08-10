// Mind Atlas always grants Claude Code's read-only public web tools.
// File, shell, and browser-control permissions remain governed separately.

export const CLAUDE_DEFAULT_WEB_TOOLS = Object.freeze(["WebSearch", "WebFetch"]);

export function appendClaudeDefaultWebToolArgs(args) {
  if (!Array.isArray(args)) throw new TypeError("Claude CLI args must be an array");
  if (args.includes("--allowedTools") || args.includes("--allowed-tools")) return args;
  args.push("--allowedTools", CLAUDE_DEFAULT_WEB_TOOLS.join(","));
  return args;
}

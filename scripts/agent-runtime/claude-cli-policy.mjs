// Mind Atlas always grants Claude Code's read-only public web tools.
// File, shell, and browser-control permissions remain governed separately.

export const CLAUDE_DEFAULT_WEB_TOOLS = Object.freeze(["WebSearch", "WebFetch"]);

/** Every tool of the Mind Atlas MCP server a run is given (atlas-mcp-server.mjs). */
export const CLAUDE_ATLAS_TOOLS = "mcp__mind_atlas";

/**
 * @param {string[]} args
 * @param {string[]} [extra] more tools granted to this run, such as the Mind
 *   Atlas server when it is attached. The owner decided agents may read and
 *   write the notebook without asking (OpenCEO ADR 0059).
 */
export function appendClaudeDefaultWebToolArgs(args, extra = []) {
  if (!Array.isArray(args)) throw new TypeError("Claude CLI args must be an array");
  if (args.includes("--allowedTools") || args.includes("--allowed-tools")) return args;
  args.push("--allowedTools", [...CLAUDE_DEFAULT_WEB_TOOLS, ...extra].join(","));
  return args;
}

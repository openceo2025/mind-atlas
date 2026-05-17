import { webSearch } from "../ai/bridgeClient";
import {
  findNode,
  normalizeAiContextOptions,
  useAtlasStore,
} from "../store/atlasStore";
import type { AiContextScope, AiExecutionMode, AtlasNode, RealtimeToolDefinition, WorkStatus } from "../types";

export interface VoiceToolCall {
  name: string;
  arguments: string | Record<string, unknown>;
  callId?: string;
}

export interface VoiceToolExecutionResult {
  ok: boolean;
  text: string;
  data?: unknown;
  approvalRequired?: boolean;
}

type VoiceToolHandler = (args: Record<string, unknown>) => Promise<VoiceToolExecutionResult> | VoiceToolExecutionResult;

type VoiceToolSpec = RealtimeToolDefinition & {
  handler: VoiceToolHandler;
};

const scopeValues: AiContextScope[] = ["minimal", "focused", "subtree", "neighborhood", "selected", "custom"];
const aiModes: AiExecutionMode[] = ["openai", "local", "codex"];
const statuses: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];

const toolSpecs: VoiceToolSpec[] = [
  {
    type: "function",
    name: "get_atlas_state_summary",
    description: "Get a compact summary of the current Mind Atlas state, active node, selected nodes, and unread notifications.",
    parameters: objectSchema({}),
    handler: () => {
      const state = useAtlasStore.getState();
      const active = findNode(state.atlasRoot, state.selectedNodeId);
      return ok("Atlas state summary.", {
        activeNode: active ? nodeSummary(active) : null,
        multiSelectedNodeIds: state.multiSelectedNodeIds,
        aiContextOptions: state.aiContextOptions,
        codexSettings: {
          model: state.codexSettings.model,
          reasoningEffort: state.codexSettings.reasoningEffort,
          sandbox: state.codexSettings.sandbox,
          workspace: state.codexSettings.workspace,
          webSearch: state.codexSettings.webSearch,
          skipGitRepoCheck: state.codexSettings.skipGitRepoCheck,
          timeoutMs: state.codexSettings.timeoutMs,
        },
        unreadNotifications: Object.values(state.unreadNotifications).map((item) => ({
          nodeId: item.nodeId,
          kind: item.kind,
          title: item.title,
        })),
      });
    },
  },
  {
    type: "function",
    name: "search_nodes",
    description: "Search notebook nodes by title, body, summary, tags, status, or provider metadata.",
    parameters: objectSchema({
      query: { type: "string", description: "Search text." },
      limit: { type: "number", description: "Maximum number of matches. Default 10." },
    }, ["query"]),
    handler: (args) => {
      const query = stringArg(args, "query").toLowerCase();
      const limit = clampNumber(numberArg(args, "limit", 10), 1, 30);
      const state = useAtlasStore.getState();
      const matches: Array<{ score: number; node: AtlasNode; path: string[] }> = [];
      visitNode(state.atlasRoot, [], (node, path) => {
        const text = [
          node.title,
          node.subtitle,
          node.body,
          node.summary,
          node.nextDecision,
          node.status,
          node.provider ?? "",
          node.runMode ?? "",
          node.tags.join(" "),
        ].join("\n").toLowerCase();
        if (!text.includes(query)) return;
        const titleHit = node.title.toLowerCase().includes(query) ? 4 : 0;
        matches.push({ score: titleHit + Math.min(3, text.split(query).length - 1), node, path: [...path, node.title] });
      });
      matches.sort((left, right) => right.score - left.score);
      return ok(`Found ${matches.length} matching node(s).`, {
        matches: matches.slice(0, limit).map((match) => ({
          id: match.node.id,
          title: match.node.title,
          status: match.node.status,
          summary: match.node.summary,
          path: match.path,
        })),
      });
    },
  },
  {
    type: "function",
    name: "focus_node",
    description: "Move focus to a node by id and make it active.",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
    handler: (args) => {
      const nodeId = stringArg(args, "nodeId");
      const state = useAtlasStore.getState();
      const node = findNode(state.atlasRoot, nodeId);
      if (!node) return fail(`Node not found: ${nodeId}`);
      state.focusNode(nodeId);
      return ok(`Focused ${node.title}.`, { node: nodeSummary(node) });
    },
  },
  {
    type: "function",
    name: "select_node",
    description: "Make a node active without changing its content.",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
    handler: (args) => {
      const nodeId = stringArg(args, "nodeId");
      const state = useAtlasStore.getState();
      const node = findNode(state.atlasRoot, nodeId);
      if (!node) return fail(`Node not found: ${nodeId}`);
      state.selectNodeInPlace(nodeId);
      return ok(`Selected ${node.title}.`, { node: nodeSummary(node) });
    },
  },
  {
    type: "function",
    name: "toggle_multi_select_node",
    description: "Toggle whether a node is included in multi-selection.",
    parameters: objectSchema({ nodeId: { type: "string" } }, ["nodeId"]),
    handler: (args) => {
      const nodeId = stringArg(args, "nodeId");
      const state = useAtlasStore.getState();
      if (!findNode(state.atlasRoot, nodeId)) return fail(`Node not found: ${nodeId}`);
      state.toggleMultiSelectedNode(nodeId);
      return ok("Multi-selection toggled.", { multiSelectedNodeIds: useAtlasStore.getState().multiSelectedNodeIds });
    },
  },
  {
    type: "function",
    name: "clear_multi_selection",
    description: "Clear all multi-selected nodes.",
    parameters: objectSchema({}),
    handler: () => {
      useAtlasStore.getState().clearMultiSelection();
      return ok("Multi-selection cleared.");
    },
  },
  {
    type: "function",
    name: "add_child_node",
    description: "Add a child notebook node under a parent or the active node.",
    parameters: objectSchema({
      parentId: { type: "string", description: "Parent node id. If omitted, active node is used." },
      title: { type: "string" },
      body: { type: "string" },
    }),
    handler: (args) => {
      const state = useAtlasStore.getState();
      const parentId = stringArg(args, "parentId", state.selectedNodeId);
      const title = stringArg(args, "title", "Untitled voice note");
      const body = stringArg(args, "body", "");
      const id = state.addChildNode(parentId, body, { title, focus: true });
      if (!id) return fail("Could not create child node.");
      return ok(`Created child node ${title}.`, { nodeId: id });
    },
  },
  {
    type: "function",
    name: "update_node_text",
    description: "Update title, body, summary, next decision, or tags for a node.",
    parameters: objectSchema({
      nodeId: { type: "string", description: "Node id. If omitted, active node is used." },
      title: { type: "string" },
      body: { type: "string" },
      summary: { type: "string" },
      nextDecision: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    }),
    handler: (args) => {
      const state = useAtlasStore.getState();
      const nodeId = stringArg(args, "nodeId", state.selectedNodeId);
      const node = findNode(state.atlasRoot, nodeId);
      if (!node) return fail(`Node not found: ${nodeId}`);
      state.updateNode(nodeId, {
        title: optionalString(args, "title"),
        body: optionalString(args, "body"),
        summary: optionalString(args, "summary"),
        nextDecision: optionalString(args, "nextDecision"),
        tags: stringArrayArg(args, "tags"),
      });
      return ok(`Updated ${node.title}.`, { nodeId });
    },
  },
  {
    type: "function",
    name: "set_node_status",
    description: "Set a node status.",
    parameters: objectSchema({
      nodeId: { type: "string", description: "Node id. If omitted, active node is used." },
      status: { type: "string", enum: statuses },
      nextDecision: { type: "string" },
    }, ["status"]),
    handler: (args) => {
      const state = useAtlasStore.getState();
      const nodeId = stringArg(args, "nodeId", state.selectedNodeId);
      const status = enumArg(args, "status", statuses);
      state.setNodeStatus(nodeId, status, optionalString(args, "nextDecision"));
      return ok(`Status set to ${status}.`, { nodeId, status });
    },
  },
  {
    type: "function",
    name: "undo",
    description: "Undo the last notebook edit.",
    parameters: objectSchema({}),
    handler: () => {
      useAtlasStore.getState().undo();
      return ok("Undo completed.");
    },
  },
  {
    type: "function",
    name: "redo",
    description: "Redo the last undone notebook edit.",
    parameters: objectSchema({}),
    handler: () => {
      useAtlasStore.getState().redo();
      return ok("Redo completed.");
    },
  },
  {
    type: "function",
    name: "run_ai_from_active_node",
    description: "Send a prompt to OpenAI, Local, or Codex from the active node using current Mind Atlas context settings.",
    parameters: objectSchema({
      prompt: { type: "string" },
      mode: { type: "string", enum: aiModes },
      scope: { type: "string", enum: scopeValues },
    }, ["prompt", "mode"]),
    handler: async (args) => {
      const prompt = stringArg(args, "prompt");
      const mode = enumArg(args, "mode", aiModes);
      const scope = optionalEnumArg(args, "scope", scopeValues);
      const state = useAtlasStore.getState();
      await state.runAiOnSelectedNode(prompt, mode, scope ? normalizeAiContextOptions({ ...state.aiContextOptions, scope }) : state.aiContextOptions);
      return ok(`${mode} request started from the active node.`, { mode });
    },
  },
  {
    type: "function",
    name: "get_notifications",
    description: "Return unread Mind Atlas notifications and their node summaries.",
    parameters: objectSchema({}),
    handler: () => {
      const state = useAtlasStore.getState();
      const notifications = Object.values(state.unreadNotifications).map((item) => {
        const node = findNode(state.atlasRoot, item.nodeId);
        return {
          nodeId: item.nodeId,
          kind: item.kind,
          title: item.title,
          node: node ? nodeSummary(node) : null,
        };
      });
      return ok(`${notifications.length} unread notification(s).`, { notifications });
    },
  },
  {
    type: "function",
    name: "summarize_notifications",
    description: "Summarize unread notifications in priority order.",
    parameters: objectSchema({}),
    handler: () => {
      const state = useAtlasStore.getState();
      const notifications = Object.values(state.unreadNotifications);
      const ranked = notifications.sort((left, right) => notificationScore(right.kind) - notificationScore(left.kind));
      const lines = ranked.map((item) => {
        const node = findNode(state.atlasRoot, item.nodeId);
        return `${item.kind}: ${node?.title ?? item.title} - ${node?.summary || node?.nextDecision || item.title}`;
      });
      return ok(lines.length ? lines.join("\n") : "No unread notifications.", { count: lines.length });
    },
  },
  {
    type: "function",
    name: "web_search",
    description: "Search the web through the Mind Atlas bridge and return summarized results with sources.",
    parameters: objectSchema({ query: { type: "string" } }, ["query"]),
    handler: async (args) => {
      const query = stringArg(args, "query");
      const result = await webSearch(query);
      return ok(result.text, result);
    },
  },
  {
    type: "function",
    name: "delete_node",
    description: "Request deletion of a node. This is dangerous and requires human approval.",
    parameters: objectSchema({ nodeId: { type: "string" }, reason: { type: "string" } }, ["nodeId"]),
    handler: (args) => approvalRequired("delete_node", args),
  },
  {
    type: "function",
    name: "reset_notebook",
    description: "Request notebook reset. This is dangerous and requires human approval.",
    parameters: objectSchema({ reason: { type: "string" } }),
    handler: (args) => approvalRequired("reset_notebook", args),
  },
];

export function getVoiceToolDefinitions(): RealtimeToolDefinition[] {
  return toolSpecs.map(({ handler: _handler, ...definition }) => definition);
}

export async function executeVoiceTool(call: VoiceToolCall): Promise<VoiceToolExecutionResult> {
  const spec = toolSpecs.find((item) => item.name === call.name);
  if (!spec) return fail(`Unknown tool: ${call.name}`);
  const args = parseToolArguments(call.arguments);
  useAtlasStore.getState().appendVoiceLogEntry({
    role: "tool",
    title: `Tool: ${call.name}`,
    text: JSON.stringify(args, null, 2),
    toolName: call.name,
    toolCallId: call.callId,
    status: "running",
  });
  try {
    const result = await spec.handler(args);
    useAtlasStore.getState().appendVoiceLogEntry({
      role: result.ok ? "tool" : "error",
      title: `Tool result: ${call.name}`,
      text: result.text,
      toolName: call.name,
      toolCallId: call.callId,
      status: result.approvalRequired ? "approval_required" : result.ok ? "done" : "error",
      metadata: typeof result.data === "object" && result.data !== null ? (result.data as Record<string, unknown>) : { data: result.data },
    });
    return result;
  } catch (error) {
    const result = fail(error instanceof Error ? error.message : "Tool failed.");
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "error",
      title: `Tool error: ${call.name}`,
      text: result.text,
      toolName: call.name,
      toolCallId: call.callId,
      status: "error",
    });
    return result;
  }
}

function parseToolArguments(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string") return value;
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function ok(text: string, data?: unknown): VoiceToolExecutionResult {
  return { ok: true, text, data };
}

function fail(text: string): VoiceToolExecutionResult {
  return { ok: false, text };
}

function approvalRequired(toolName: string, args: Record<string, unknown>): VoiceToolExecutionResult {
  const text = `${toolName} requires human approval and was not executed.`;
  return {
    ok: false,
    text,
    approvalRequired: true,
    data: { toolName, args },
  };
}

function nodeSummary(node: AtlasNode) {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    summary: node.summary,
    nextDecision: node.nextDecision,
    tags: node.tags,
    provider: node.provider,
    runMode: node.runMode,
    childCount: node.children.length,
  };
}

function visitNode(node: AtlasNode, path: string[], visitor: (node: AtlasNode, path: string[]) => void) {
  visitor(node, path);
  node.children.forEach((child) => visitNode(child, [...path, node.title], visitor));
}

function stringArg(args: Record<string, unknown>, key: string, fallback = "") {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : undefined;
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function enumArg<T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = args[key];
  if (typeof value === "string" && values.includes(value as T)) return value as T;
  throw new Error(`${key} must be one of: ${values.join(", ")}`);
}

function optionalEnumArg<T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]): T | undefined {
  const value = args[key];
  if (typeof value !== "string" || !value) return undefined;
  if (values.includes(value as T)) return value as T;
  throw new Error(`${key} must be one of: ${values.join(", ")}`);
}

function notificationScore(kind: string) {
  if (kind === "error") return 5;
  if (kind === "codex") return 4;
  if (kind === "needs_review") return 3;
  if (kind === "cost") return 2;
  return 1;
}

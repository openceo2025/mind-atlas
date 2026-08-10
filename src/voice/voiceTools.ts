import { webSearch } from "../ai/bridgeClient";
import {
  findNode,
  normalizeAiContextOptions,
  useAtlasStore,
} from "../store/atlasStore";
import { rankAtlasNodes, searchAtlasNodes } from "../search/nodeSearch";
import type { AiContextScope, AiExecutionMode, AtlasNode, RealtimeToolDefinition, WebSearchResult, WorkStatus } from "../types";

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

type BulkNodeUpdate = {
  nodeId: string;
  title: string | undefined;
  body: string | undefined;
  summary: string | undefined;
  nextDecision: string | undefined;
  tags: string[] | undefined;
  status: WorkStatus | undefined;
};

const scopeValues: AiContextScope[] = ["minimal", "focused", "subtree", "neighborhood", "selected", "custom"];
const toolCapableAiModes: AiExecutionMode[] = ["chat", "openai", "local"];
const statuses: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];
const runAiPurposes = ["node_ai_run", "persistent_result", "delegate_to_node_context"] as const;

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
        chatSettings: state.chatSettings,
        codexSettings: {
          model: state.codexSettings.model,
          reasoningEffort: state.codexSettings.reasoningEffort,
          sandbox: state.codexSettings.sandbox,
          workspace: state.codexSettings.workspace,
          webSearch: state.codexSettings.webSearch,
          skipGitRepoCheck: state.codexSettings.skipGitRepoCheck,
        },
        openClawSettings: {
          model: state.openClawSettings.model,
          thinking: state.openClawSettings.thinking,
          workspace: state.openClawSettings.workspace,
          timeoutMs: state.openClawSettings.timeoutMs,
          continueMode: state.openClawSettings.continueMode,
        },
        claudeSettings: {
          model: state.claudeSettings.model,
          baseUrl: state.claudeSettings.baseUrl,
          reasoningEffort: state.claudeSettings.reasoningEffort,
          permissionMode: state.claudeSettings.permissionMode,
          workspace: state.claudeSettings.workspace,
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
    description: "Search all notebook nodes with exact text or a safe regular expression. Use this when wording, names, ids, tags, or patterns must match precisely.",
    parameters: objectSchema({
      query: { type: "string", description: "Search text." },
      regex: { type: "boolean", description: "Treat query as a regular expression. Default false." },
      case_sensitive: { type: "boolean", description: "Use case-sensitive matching. Default false." },
      limit: { type: "number", description: "Maximum number of matches. Default 10." },
    }, ["query"]),
    handler: (args) => {
      const limit = clampNumber(numberArg(args, "limit", 10), 1, 30);
      const state = useAtlasStore.getState();
      const result = searchAtlasNodes(state.atlasRoot, {
        query: stringArg(args, "query"),
        regex: booleanArg(args, "regex"),
        caseSensitive: booleanArg(args, "case_sensitive"),
        includeMetadata: true,
        limit,
      });
      if (result.error) return fail(result.error);
      return ok(`Found ${result.total} matching node(s); returning ${result.matches.length}.`, {
        total: result.total,
        matches: result.matches.map((match) => ({
          id: match.nodeId,
          title: match.title,
          path: match.path,
          matchedField: match.field,
          snippet: match.snippet,
        })),
      });
    },
  },
  {
    type: "function",
    name: "semantic_search_nodes",
    description: "Rank all notebook nodes by local text relevance without sending the whole atlas or calling an embedding service. Supply related concepts or synonyms when the user's wording may differ from the notebook. Returns only bounded top snippets and node ids.",
    parameters: objectSchema({
      query: { type: "string", description: "The user's search concept." },
      concepts: {
        type: "array",
        items: { type: "string" },
        maxItems: 12,
        description: "Optional related words, translations, abbreviations, or synonyms inferred from the request.",
      },
      limit: { type: "number", description: "Maximum number of ranked matches. Default 10." },
    }, ["query"]),
    handler: (args) => {
      const state = useAtlasStore.getState();
      const result = rankAtlasNodes(state.atlasRoot, {
        query: stringArg(args, "query"),
        concepts: stringArrayArg(args, "concepts"),
        limit: clampNumber(numberArg(args, "limit", 10), 1, 30),
      });
      if (result.error) return fail(result.error);
      return ok(`Ranked ${result.total} relevant node(s); returning ${result.matches.length}.`, {
        total: result.total,
        method: "local_weighted_text_relevance",
        matches: result.matches.map((match) => ({
          id: match.nodeId,
          title: match.title,
          path: match.path,
          matchedField: match.field,
          snippet: match.snippet,
          score: match.score,
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
    description: "Add one child notebook node under a parent or the active node.",
    parameters: objectSchema({
      parentId: { type: "string", description: "Parent node id. If omitted, active node is used." },
      title: { type: "string" },
      body: { type: "string" },
      summary: { type: "string" },
    }, ["body"]),
    handler: handleAddChildNodes,
  },
  {
    type: "function",
    name: "add_child_nodes",
    description: "Add one or more child notebook nodes under a parent or the active node. Use this for both single-node and multi-node creation.",
    parameters: objectSchema({
      parentId: { type: "string", description: "Parent node id. If omitted, active node is used." },
      nodes: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            summary: { type: "string" },
          },
          required: ["body"],
          additionalProperties: false,
        },
      },
      title: { type: "string", description: "Legacy single-node title. Prefer nodes[].title." },
      body: { type: "string", description: "Legacy single-node body. Prefer nodes[].body." },
      summary: { type: "string", description: "Legacy single-node summary. Prefer nodes[].summary." },
    }),
    handler: handleAddChildNodes,
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
    name: "set_node_reminders",
    description:
      "Set or reschedule reminder notification deadlines for one or more nodes. Each node can receive a different reminderAt timestamp. Use ISO 8601 timestamps whenever possible.",
    parameters: objectSchema({
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            nodeId: { type: "string", description: "Target node id." },
            reminderAt: {
              type: "string",
              description: "Reminder deadline as an ISO 8601 timestamp or another browser-parseable date string.",
            },
          },
          required: ["nodeId", "reminderAt"],
          additionalProperties: false,
        },
      },
    }, ["updates"]),
    handler: (args) => {
      const updates = reminderUpdateArrayArg(args, "updates");
      if (!updates.length) return fail("No reminder updates were provided.");
      const result = useAtlasStore.getState().setNodeReminders(updates);
      const failedText = result.failed.length
        ? ` ${result.failed.length} failed: ${result.failed.map((item) => `${item.nodeId || "(missing)"} (${item.reason})`).join("; ")}`
        : "";
      return ok(`Updated ${result.updated.length} node reminder(s).${failedText}`, result);
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
    description:
      "Run a separate node-anchored Chat/OpenAI/Local AI job from the active node. This creates AI request/result celestial nodes under the active node and is NOT for answering the current global conversation. Do not use this for Codex, OpenClaw, or Claude Code; those agent CLI modes are intentionally excluded from Mind Atlas tool orchestration. Use only when the user explicitly asks to delegate a tool-capable chat model to a specific node context or create a persistent node-based chat result. Do not use this tool for listing, picking up, summarizing, inspecting, searching, checking notifications, or answering from existing Mind Atlas state; use search_nodes or semantic_search_nodes, get_notifications, summarize_notifications, get_atlas_state_summary, and answer directly instead.",
    parameters: objectSchema({
      prompt: {
        type: "string",
        description: "Prompt for the separate node-anchored AI job. This will create notebook nodes.",
      },
      mode: {
        type: "string",
        enum: toolCapableAiModes,
        description: "Tool-capable chat provider for the separate node-based run. Codex, OpenClaw, and Claude Code are not allowed here.",
      },
      scope: { type: "string", enum: scopeValues },
      purpose: {
        type: "string",
        enum: runAiPurposes,
        description:
          "Explicit reason this must create a persistent node-based AI run instead of answering in the current global conversation.",
      },
      createsNotebookNodes: {
        type: "boolean",
        description: "Must be true to acknowledge this tool creates AI request/result notebook nodes.",
      },
      userRequestQuote: {
        type: "string",
        description: "Short quote or paraphrase showing the user explicitly asked for a node-anchored AI run.",
      },
    }, ["prompt", "mode", "purpose", "createsNotebookNodes", "userRequestQuote"]),
    handler: async (args) => {
      const purpose = optionalEnumArg(args, "purpose", runAiPurposes);
      const createsNotebookNodes = args.createsNotebookNodes === true;
      const userRequestQuote = stringArg(args, "userRequestQuote");
      if (!purpose || !createsNotebookNodes || !userRequestQuote) {
        return fail(
          [
            "run_ai_from_active_node was not executed because it creates AI request/result notebook nodes.",
            "Use it only when the user explicitly asks for a separate node-anchored AI run or persistent node-based AI result.",
            "For picking up nodes, listing tasks, summarizing state, inspecting notifications, or answering the current AI Partner conversation, use search_nodes or semantic_search_nodes, get_notifications, summarize_notifications, get_atlas_state_summary, and then answer directly in AI Partner log.",
          ].join("\n"),
        );
      }
      const prompt = stringArg(args, "prompt");
      const mode = enumArg(args, "mode", toolCapableAiModes);
      const scope = optionalEnumArg(args, "scope", scopeValues);
      const state = useAtlasStore.getState();
      await state.runAiOnSelectedNode(prompt, mode, scope ? normalizeAiContextOptions({ ...state.aiContextOptions, scope }) : state.aiContextOptions);
      return ok(
        [
          `Started a separate node-anchored ${mode} run from the active node.`,
          "Its result will appear as notebook nodes, not as this global conversation's final answer.",
          "Continue the global response without waiting for it unless the user explicitly asked you to monitor that node.",
        ].join("\n"),
        { mode, purpose, createsNotebookNodes: true, userRequestQuote },
      );
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
          suggestedAction: notificationSuggestedAction(item.kind),
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
        return `${item.kind}: ${node?.title ?? item.title} - ${node?.summary || node?.nextDecision || item.title} (${notificationSuggestedAction(item.kind)})`;
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
      return ok(formatWebSearchToolText(result), result);
    },
  },
  {
    type: "function",
    name: "delete_node",
    description: "Delete a notebook node. If nodeId is omitted, the active node is deleted. Root notebook deletion is not allowed.",
    parameters: objectSchema({ nodeId: { type: "string" }, reason: { type: "string" } }),
    handler: (args) => {
      const state = useAtlasStore.getState();
      const nodeId = stringArg(args, "nodeId", state.selectedNodeId);
      if (!nodeId || nodeId === state.atlasRoot.id) return fail("The root notebook node cannot be deleted.");
      const node = findNode(state.atlasRoot, nodeId);
      if (!node) return fail(`Node not found: ${nodeId}`);
      state.deleteNode(nodeId);
      return ok(`Deleted ${node.title}. Use undo if this was not intended.`, { nodeId, title: node.title, undoAvailable: true });
    },
  },
  {
    type: "function",
    name: "import_notebook",
    description: "Explain that notebook import or replacement requires the user to operate the browser file picker manually.",
    parameters: objectSchema({
      reason: { type: "string" },
      sourceDescription: { type: "string", description: "Describe the user-provided source. Do not attempt to open a file picker." },
    }),
    handler: () => fail("Notebook import is not executable through AI tools because the browser file picker must be operated by the user."),
  },
  {
    type: "function",
    name: "bulk_update_nodes",
    description: "Apply simple text/status updates to multiple existing notebook nodes.",
    parameters: objectSchema({
      reason: { type: "string" },
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            nodeId: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            summary: { type: "string" },
            nextDecision: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: statuses },
          },
          required: ["nodeId"],
          additionalProperties: false,
        },
      },
    }, ["updates"]),
    handler: handleBulkUpdateNodes,
  },
  {
    type: "function",
    name: "run_codex_full_access",
    description: "Explain that Codex full-access retries cannot be started from hosted AI tools.",
    parameters: objectSchema({
      reason: { type: "string" },
      workspace: { type: "string" },
      requestNodeId: { type: "string" },
    }, ["reason"]),
    handler: () => fail("Codex full-access retries are not executable through hosted AI tools."),
  },
  {
    type: "function",
    name: "request_file_picker_action",
    description: "Request an operation that needs a browser or OS file picker. Voice Partner cannot open file pickers directly; the user must perform the picker action.",
    parameters: objectSchema({
      action: { type: "string" },
      reason: { type: "string" },
    }, ["action"]),
    handler: () => fail("Browser or OS file picker actions must be performed by the user and cannot be executed through AI tools."),
  },
  {
    type: "function",
    name: "reset_notebook",
    description: "Reset the notebook to the initial state. Undo can restore the previous notebook during the current session.",
    parameters: objectSchema({ reason: { type: "string" } }),
    handler: () => {
      useAtlasStore.getState().resetNotebook();
      return ok("Notebook reset. Use undo if this was not intended.", { undoAvailable: true });
    },
  },
];

export function getVoiceToolDefinitions(): RealtimeToolDefinition[] {
  return toolSpecs.map(({ handler: _handler, ...definition }) => definition);
}

export async function executeVoiceTool(call: VoiceToolCall): Promise<VoiceToolExecutionResult> {
  const spec = toolSpecs.find((item) => item.name === call.name);
  if (!spec) return fail(`Unknown tool: ${call.name}`);
  let args: Record<string, unknown>;
  try {
    args = parseToolArguments(call.arguments);
  } catch (error) {
    const result = fail(error instanceof Error ? error.message : "Invalid tool arguments.");
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
      role: result.approvalRequired || result.ok ? "tool" : "error",
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
  if (typeof value !== "string") {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    throw new Error("Tool arguments must be a JSON object.");
  }
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  throw new Error("Tool arguments must be a JSON object.");
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

function handleAddChildNodes(args: Record<string, unknown>) {
  const state = useAtlasStore.getState();
  const parentId = stringArg(args, "parentId", state.selectedNodeId);
  const nodeDrafts = nodeDraftArrayArg(args, "nodes");
  const drafts = nodeDrafts.length
    ? nodeDrafts
    : [{ title: stringArg(args, "title", "Untitled note"), body: stringArg(args, "body"), summary: optionalString(args, "summary") ?? "" }];
  const ids = state.addChildNodes(parentId, drafts, { focus: true });
  if (!ids.length) return fail("Could not create child nodes.");
  return ok(`Created ${ids.length} child node(s).`, { nodeIds: ids });
}

function handleBulkUpdateNodes(args: Record<string, unknown>) {
  const updates = bulkUpdateArrayArg(args, "updates");
  if (!updates.length) return fail("No valid node updates were provided.");

  const state = useAtlasStore.getState();
  const updated: Array<{ nodeId: string; title: string }> = [];
  const failed: Array<{ nodeId: string; reason: string }> = [];

  for (const update of updates) {
    const node = findNode(useAtlasStore.getState().atlasRoot, update.nodeId);
    if (!node) {
      failed.push({ nodeId: update.nodeId, reason: "not_found" });
      continue;
    }
    if (update.title !== undefined || update.body !== undefined || update.summary !== undefined || update.nextDecision !== undefined || update.tags !== undefined) {
      useAtlasStore.getState().updateNode(update.nodeId, {
        title: update.title,
        body: update.body,
        summary: update.summary,
        nextDecision: update.nextDecision,
        tags: update.tags,
      });
    }
    if (update.status) {
      useAtlasStore.getState().setNodeStatus(update.nodeId, update.status);
    }
    updated.push({ nodeId: update.nodeId, title: node.title });
  }

  return ok(`Updated ${updated.length} node(s).${failed.length ? ` ${failed.length} failed.` : ""}`, { updated, failed, activeNodeId: state.selectedNodeId });
}

function formatWebSearchToolText(result: WebSearchResult) {
  const sourceLines = result.sources
    .slice(0, 6)
    .map((source, index) => `${index + 1}. ${source.title || source.url} - ${source.url}`);
  return [
    result.text,
    sourceLines.length ? "\nSources:" : "",
    ...sourceLines,
  ].filter(Boolean).join("\n");
}

function nodeSummary(node: AtlasNode) {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    summary: node.summary,
    nextDecision: node.nextDecision,
    tags: node.tags,
    reminderAt: node.reminderAt,
    reminderFiredAt: node.reminderFiredAt,
    provider: node.provider,
    runMode: node.runMode,
    childCount: node.children.length,
  };
}

function stringArg(args: Record<string, unknown>, key: string, fallback = "") {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanArg(args: Record<string, unknown>, key: string, fallback = false) {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : undefined;
}

function nodeDraftArrayArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const body = typeof record.body === "string" ? record.body.trim() : "";
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      if (!title && !body && !summary) return null;
      return { title, body, summary };
    })
    .filter((item): item is { title: string; body: string; summary: string } => item !== null);
}

function reminderUpdateArrayArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
      const reminderAt = typeof record.reminderAt === "string" ? record.reminderAt.trim() : "";
      if (!nodeId || !reminderAt) return null;
      return { nodeId, reminderAt };
    })
    .filter((item): item is { nodeId: string; reminderAt: string } => item !== null);
}

function bulkUpdateArrayArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
      if (!nodeId) return null;
      return {
        nodeId,
        title: typeof record.title === "string" ? record.title : undefined,
        body: typeof record.body === "string" ? record.body : undefined,
        summary: typeof record.summary === "string" ? record.summary : undefined,
        nextDecision: typeof record.nextDecision === "string" ? record.nextDecision : undefined,
        tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag).trim()).filter(Boolean) : undefined,
        status: typeof record.status === "string" && statuses.includes(record.status as WorkStatus) ? record.status as WorkStatus : undefined,
      };
    })
    .filter((item): item is BulkNodeUpdate => item !== null);
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
  if (kind === "codex" || kind === "openclaw" || kind === "claude") return 4;
  if (kind === "needs_review") return 3;
  if (kind === "cost") return 2;
  return 1;
}

function notificationSuggestedAction(kind: string) {
  if (kind === "error") return "Focus the node and explain the error before proposing a fix.";
  if (kind === "needs_review") return "Focus the node and summarize what needs human review.";
  if (kind === "codex" || kind === "openclaw" || kind === "claude") return "Focus the agent result node and summarize completed work.";
  if (kind === "cost") return "Summarize cost or usage impact.";
  return "Focus the node if the user wants more detail.";
}

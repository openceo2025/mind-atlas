import type {
  AgentSessionAction,
  AgentSessionInfo,
  AiNodeContext,
  AtlasNode,
  ChatContextMessage,
} from "../types";

// Unified context engine (CLAUDE.md 1-3 / 2-1-6).
//
// One priority-driven planner produces every model-facing context artifact:
// - conversation: the branch history (ancestor human_prompt / ai_reply pairs)
//   replayed as real user/assistant messages,
// - contextText: compact markdown for everything that is not conversation
//   (breadcrumb, document chain, outline skeleton, children, pinned nodes),
// - agent prompts (full and resume-delta) for Codex / Claude Code / OpenClaw.
//
// Branching a node tree means switching chat history: the ancestor path IS the
// conversation, siblings of the path are other branches and stay out unless
// pinned. Output must stay stable across calls for identical trees so provider
// prompt caching works; never embed timestamps, stats, or run metadata.

export interface ContextEngineOptions {
  pinnedNodeIds?: string[];
  charBudget?: number;
  conversationCharBudget?: number;
  maxTurnChars?: number;
  maxNodeBodyChars?: number;
  maxPinnedNodes?: number;
  maxChildLines?: number;
  maxSiblingLinesPerLevel?: number;
  /**
   * How many of the most recent turns are replayed word for word. Older turns
   * become one-line summaries: same information, a fraction of the tokens, and
   * no risk of a long reply being cut mid-sentence.
   */
  verbatimTurnLimit?: number;
}

export interface ContextPlanBlock {
  id: string;
  label: string;
  chars: number;
  nodeIds: string[];
}

export interface ContextPlanStats {
  estimatedTokens: number;
  contextChars: number;
  conversationChars: number;
  includedNodeCount: number;
  conversationTurnCount: number;
  droppedTurnCount: number;
  truncated: boolean;
}

export interface ContextPlan {
  targetNodeId: string;
  breadcrumb: string;
  /** Stable prefix followed by the volatile tail. */
  contextText: string;
  /** Everything that stays put across runs on this branch. Cacheable prefix. */
  stableContextText: string;
  /** Current node id and body: changes on every run, so it goes last. */
  volatileContextText: string;
  conversation: ChatContextMessage[];
  stats: ContextPlanStats;
  includedNodeIds: string[];
  blocks: ContextPlanBlock[];
}

interface ConversationTurn {
  role: "user" | "assistant";
  node: AtlasNode;
}

const DEFAULT_OPTIONS: Required<Omit<ContextEngineOptions, "pinnedNodeIds">> = {
  charBudget: 48_000,
  conversationCharBudget: 28_000,
  maxTurnChars: 8_000,
  maxNodeBodyChars: 4_000,
  maxPinnedNodes: 8,
  maxChildLines: 12,
  maxSiblingLinesPerLevel: 12,
  verbatimTurnLimit: 4,
};

export const CONTEXT_BUDGET_PRESETS = {
  chat: { charBudget: 48_000, conversationCharBudget: 28_000 },
  local: { charBudget: 2_200, conversationCharBudget: 1_200, maxTurnChars: 700, maxNodeBodyChars: 600, maxChildLines: 4, maxSiblingLinesPerLevel: 4, verbatimTurnLimit: 2 },
  // Agents re-read the workspace themselves, so the branch conversation is a
  // pointer, not the payload. Only the last exchange stays verbatim.
  agent: { charBudget: 16_000, conversationCharBudget: 9_000, maxTurnChars: 3_000, maxNodeBodyChars: 3_000, verbatimTurnLimit: 2 },
} satisfies Record<string, ContextEngineOptions>;

export function buildContextPlan(
  root: AtlasNode,
  targetNodeId: string,
  optionsInput: ContextEngineOptions = {},
): ContextPlan | null {
  const options = { ...DEFAULT_OPTIONS, ...optionsInput };
  const path = findNodePath(root, targetNodeId);
  if (!path) return null;
  const target = path[path.length - 1];
  const pinnedIds = uniqueIds(optionsInput.pinnedNodeIds ?? []).filter((id) => id !== targetNodeId);
  const includedNodeIds = new Set<string>();
  const blocks: ContextPlanBlock[] = [];

  // --- conversation replay -------------------------------------------------
  const allTurns = collectConversationTurns(path);
  const { turns, dropped } = fitConversationTurns(
    allTurns,
    options.conversationCharBudget,
    options.maxTurnChars,
    options.verbatimTurnLimit,
  );
  const conversation: ChatContextMessage[] = mergeAdjacentTurns(
    turns.map((turn) => ({ role: turn.role, content: capText(nodeBodyText(turn.node), options.maxTurnChars) })),
  );
  turns.forEach((turn) => includedNodeIds.add(turn.node.id));
  const conversationChars = conversation.reduce((sum, message) => sum + message.content.length, 0);
  const turnNodeIds = new Set(allTurns.map((turn) => turn.node.id));
  const lastTurnNode = turns.at(-1)?.node;

  // --- contextText blocks, priority order ----------------------------------
  let remaining = Math.max(600, options.charBudget - conversationChars);
  // Payload order is stable-first, volatile-last, because provider prompt
  // caching only reuses an unchanged prefix. Anything that changes on every run
  // (the current node id, its body, the task) must sit after everything that
  // stays put across runs on the same branch, or each run invalidates the cache
  // and pays full price for the whole prompt.
  const stableSections: string[] = [];
  const volatileSections: string[] = [];
  const push = (
    id: string,
    label: string,
    lines: string[],
    nodeIds: string[],
    phase: "stable" | "volatile" = "stable",
  ) => {
    const text = lines.join("\n").trim();
    if (!text) return;
    const block = { id, label, chars: text.length, nodeIds };
    blocks.push(block);
    remaining -= text.length;
    nodeIds.forEach((nodeId) => includedNodeIds.add(nodeId));
    (phase === "stable" ? stableSections : volatileSections).push(text);
  };
  let truncated = dropped.length > 0;

  const breadcrumb = path.map((node) => nodeTitleText(node)).join(" > ");

  // Pinned nodes (multi-selection): explicit user intent, right after target.
  if (pinnedIds.length) {
    const lines: string[] = ["## Pinned nodes"];
    const ids: string[] = [];
    for (const id of pinnedIds.slice(0, options.maxPinnedNodes)) {
      const node = findNode(root, id);
      if (!node) continue;
      const body = capText(nodeBodyText(node), Math.min(options.maxNodeBodyChars, Math.max(300, Math.floor(remaining / 3))));
      lines.push(`### ${nodeTitleText(node)} (id: ${node.id})`, body || "(empty)");
      ids.push(node.id);
    }
    if (pinnedIds.length > options.maxPinnedNodes) {
      lines.push(`(+${pinnedIds.length - options.maxPinnedNodes} more pinned nodes omitted)`);
      truncated = true;
    }
    if (ids.length) push("pinned", "Pinned nodes", lines, ids);
  }

  // Document chain: ancestor nodes that are not conversation turns (topic /
  // chapter / note nodes). Nearest ancestors first; degrade body -> summary.
  {
    const documentNodes = path
      .slice(0, -1)
      .filter((node) => !turnNodeIds.has(node.id) && nodeBodyText(node).trim())
      .reverse();
    if (documentNodes.length) {
      const lines: string[] = ["## Document chain (ancestors, nearest first)"];
      const ids: string[] = [];
      let localBudget = Math.max(0, Math.floor(remaining * 0.5));
      for (const node of documentNodes) {
        const full = nodeBodyText(node);
        let rendered: string;
        if (localBudget > 600) {
          rendered = capText(full, Math.min(options.maxNodeBodyChars, localBudget));
        } else if (node.summary.trim()) {
          rendered = singleLine(node.summary);
        } else {
          rendered = "";
        }
        if (rendered.length < full.length) truncated = true;
        lines.push(`### ${nodeTitleText(node)} (id: ${node.id})`, rendered || "(body omitted)");
        localBudget -= rendered.length;
        ids.push(node.id);
      }
      push("documents", "Document chain", lines, ids);
    }
  }

  // Earlier conversation, summarized one line per dropped turn.
  if (dropped.length) {
    const lines = ["## Earlier conversation (summarized)"];
    for (const turn of dropped) {
      lines.push(`- ${turn.role === "user" ? "User" : "Assistant"}: ${summaryLine(turn.node)}`);
    }
    push("earlier", "Earlier conversation", lines, dropped.map((turn) => turn.node.id));
  }

  // Outline skeleton: sibling titles per ancestor level. Locates the branch in
  // the whole notebook without spending body budget.
  if (remaining > 400) {
    const lines: string[] = ["## Outline skeleton (sibling titles per level)"];
    const ids: string[] = [];
    for (let level = 1; level < path.length; level += 1) {
      const parent = path[level - 1];
      const current = path[level];
      const siblings = parent.children.filter((child) => child.id !== current.id);
      if (!siblings.length) continue;
      const shown = siblings.slice(0, options.maxSiblingLinesPerLevel);
      lines.push(`- under "${nodeTitleText(parent)}": ${shown.map((node) => quoteTitle(node)).join(", ")}${siblings.length > shown.length ? ` (+${siblings.length - shown.length} more)` : ""}`);
      shown.forEach((node) => ids.push(node.id));
      if (siblings.length > shown.length) truncated = true;
    }
    if (lines.length > 1) push("skeleton", "Outline skeleton", lines, ids);
  }

  // Children of the target node: title + one-line summary.
  if (target.children.length && remaining > 200) {
    const shown = target.children.slice(0, options.maxChildLines);
    const lines = [
      "## Child nodes",
      ...shown.map((node) => `- ${nodeTitleText(node)} (id: ${node.id})${summaryLine(node) ? ` - ${summaryLine(node)}` : ""}`),
    ];
    if (target.children.length > shown.length) {
      lines.push(`(+${target.children.length - shown.length} more children)`);
      truncated = true;
    }
    push("children", "Child nodes", lines, shown.map((node) => node.id));
  }

  // Attachment metadata for target + pinned. Content embedding is a later,
  // capability-aware step; metadata keeps the model aware files exist.
  {
    const attachmentOwners = [target, ...pinnedIds.map((id) => findNode(root, id)).filter((node): node is AtlasNode => Boolean(node))];
    const lines: string[] = [];
    for (const owner of attachmentOwners) {
      for (const attachment of owner.attachments) {
        lines.push(`- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes) on "${nodeTitleText(owner)}"`);
      }
    }
    if (lines.length) push("attachments", "Attachments", ["## Attachments (metadata)", ...lines], [target.id]);
  }

  // --- volatile tail: what changes on every run ----------------------------
  push("breadcrumb", "Breadcrumb", [`Position: ${breadcrumb}`, `Current node id: ${target.id}`], [target.id], "volatile");

  // Current node body. Skip when the target is already the newest replayed
  // turn; its body is in the conversation and repeating it wastes budget.
  if (!lastTurnNode || lastTurnNode.id !== target.id) {
    const body = capText(nodeBodyText(target), Math.min(options.maxNodeBodyChars, Math.max(600, remaining)));
    if (body.length < nodeBodyText(target).length) truncated = true;
    push("current", "Current node", [`## Current node: ${nodeTitleText(target)} (id: ${target.id})`, body], [target.id], "volatile");
  }

  const stableContextText = ["# Mind Atlas notebook context", "", ...stableSections].join("\n\n").trim();
  const volatileContextText = volatileSections.join("\n\n").trim();
  const contextText = [stableContextText, volatileContextText].filter(Boolean).join("\n\n").trim();
  const stats: ContextPlanStats = {
    estimatedTokens: Math.ceil((contextText.length + conversationChars) / 3.8),
    contextChars: contextText.length,
    conversationChars,
    includedNodeCount: includedNodeIds.size,
    conversationTurnCount: conversation.length,
    droppedTurnCount: dropped.length,
    truncated,
  };

  return {
    targetNodeId,
    breadcrumb,
    contextText,
    stableContextText,
    volatileContextText,
    conversation,
    stats,
    includedNodeIds: [...includedNodeIds],
    blocks,
  };
}

// --- agent prompt rendering -------------------------------------------------

export function renderAgentContextPrompt(plan: ContextPlan, task: string): string {
  // Stable first, then the conversation (which grows by appending), then the
  // volatile position and the task. This keeps the prompt prefix identical
  // across runs on the same branch so provider caching stays warm.
  const lines: string[] = [plan.stableContextText, "", WORKSPACE_FIRST_NOTE, ""];
  if (plan.conversation.length) {
    lines.push("# Conversation so far (this notebook branch)");
    for (const message of plan.conversation) {
      lines.push(`${message.role === "user" ? "User" : "Assistant"}:`, message.content, "");
    }
  }
  if (plan.volatileContextText) lines.push(plan.volatileContextText, "");
  lines.push("# Task", task);
  return lines.join("\n").trim();
}

/**
 * The notebook is a pointer, not a mirror of the repository. Re-injecting file
 * contents that the agent can read itself is the most expensive thing Mind
 * Atlas can do, and it goes stale the moment the agent edits the file.
 */
const WORKSPACE_FIRST_NOTE = [
  "# How to use this context",
  "- The notebook above is orientation, not a copy of the repository.",
  "- Read files from the work root yourself; never assume a file matches a node body.",
  "- Where a node names a path, open that path instead of trusting the quoted text.",
].join("\n");

export function renderAgentDeltaPrompt(
  root: AtlasNode,
  targetNodeId: string,
  task: string,
  options: { maxNodeBodyChars?: number } = {},
): string {
  const path = findNodePath(root, targetNodeId);
  const maxChars = options.maxNodeBodyChars ?? 4_000;
  // A resumed session already holds the branch conversation, the ancestor
  // documents and everything it read from the work root. Re-sending any of it
  // is pure cost, so the delta carries only what actually moved: where we are
  // now and what to do next.
  const lines = [
    "You are resuming your previous session for this Mind Atlas branch.",
    "Earlier conversation, ancestor documents and workspace state are already in your session history. Do not ask for them again and do not assume they changed.",
    "Anything you need from the repository, read from disk now: your earlier reads may be stale.",
    "",
  ];
  if (path) {
    const target = path[path.length - 1];
    lines.push(`Position: ${path.map((node) => nodeTitleText(node)).join(" > ")}`);
    const body = capText(nodeBodyText(target), maxChars);
    if (body.trim()) lines.push("", `## Current node: ${nodeTitleText(target)} (id: ${target.id})`, body);
  }
  lines.push("", "# Task", task);
  return lines.join("\n").trim();
}

// --- session policy ----------------------------------------------------------

export type AgentKind = "codex" | "claude" | "openclaw";

export interface AgentSessionResolution extends AgentSessionInfo {
  action: AgentSessionAction;
  latestRunNodeId?: string;
}

export const AGENT_SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function agentSessionIdOf(node: AtlasNode, agent: AgentKind): string {
  if (agent === "codex") return node.codexThreadId ?? node.aiDialogSettings?.codexSettings.resumeThreadId ?? "";
  if (agent === "claude") return node.claudeSessionId ?? "";
  return node.openClawSessionKey ?? node.aiDialogSettings?.openClawSettings.resumeSessionKey ?? "";
}

// Decide continue / fork / new without user input.
//
// The unit of a session is the BRANCH, not the node. One node starts a session
// explicitly (`new`) and becomes the origin; every descendant continues that
// same session. This is what keeps cost down: a continued session keeps its
// provider-side history and prompt cache, while a per-node cold start pays to
// rediscover the repository on every single run.
//
// continue: the inherited session's most recent carrier node sits on the
//           current path, so we are extending the tip of that branch and the
//           linear CLI-side history already matches it. Applies to every agent
//           including Claude Code, which resumes the same session id.
// fork:     the branch genuinely diverged - the session's latest run happened
//           on a sibling branch. Claude Code can fork, so the sibling gets its
//           own copy instead of interleaving two branches into one transcript.
// new:      no session, a stale session, the user asked for one, or divergence
//           on a CLI that cannot fork (Codex threads and OpenClaw keys are
//           linear, so a diverged branch has to start over).
export function resolveAgentSession(
  root: AtlasNode,
  targetNodeId: string,
  agent: AgentKind,
  options: { forceNew?: boolean; staleMs?: number; now?: number } = {},
): AgentSessionResolution {
  if (options.forceNew) return { action: "new", reason: "user-requested-new-session" };
  const path = findNodePath(root, targetNodeId);
  if (!path) return { action: "new", reason: "node-not-found" };

  let inheritedId = "";
  for (const node of path.slice().reverse()) {
    const id = agentSessionIdOf(node, agent);
    if (id) {
      inheritedId = id;
      break;
    }
  }
  if (!inheritedId) return { action: "new", reason: "no-prior-session" };

  let latest: AtlasNode | undefined;
  visitTree(root, (node) => {
    if (agentSessionIdOf(node, agent) !== inheritedId) return;
    if (!latest || Date.parse(node.createdAt) > Date.parse(latest.createdAt)) latest = node;
  });

  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? AGENT_SESSION_STALE_MS;
  if (latest && Number.isFinite(Date.parse(latest.createdAt)) && now - Date.parse(latest.createdAt) > staleMs) {
    return { action: "new", resumeId: inheritedId, reason: "session-stale" };
  }

  const pathIds = new Set(path.map((node) => node.id));
  if (!latest || pathIds.has(latest.id)) {
    // Extending the tip of the branch that owns this session: continue it.
    // Every agent takes this path, so a descendant node inherits the origin
    // session instead of cold starting.
    return { action: "continue", resumeId: inheritedId, latestRunNodeId: latest?.id, reason: "extending-branch-tip" };
  }

  if (agent === "claude" || agent === "codex") {
    // A sibling branch already advanced this session. Both Claude Code
    // (`--fork-session`) and the Codex app-server (`thread/fork`) can branch a
    // session, so this branch gets its own copy of the history instead of
    // starting from nothing. Transports that cannot fork - `codex exec` and
    // OpenClaw - degrade this to a new session downstream.
    return { action: "fork", resumeId: inheritedId, latestRunNodeId: latest.id, reason: "branch-diverged-fork" };
  }
  return { action: "new", resumeId: inheritedId, latestRunNodeId: latest.id, reason: "branch-diverged-linear-session" };
}

// --- slim legacy context ------------------------------------------------------

// Compatibility copy of AiNodeContext for older bridge/hosted deployments and
// bridge-side fallbacks (mock output, workspace inference). Deliberately tiny.
export function buildSlimLegacyContext(root: AtlasNode, targetNodeId: string): AiNodeContext | null {
  const path = findNodePath(root, targetNodeId);
  if (!path) return null;
  const target = path[path.length - 1];
  const toSlimSnapshot = (node: AtlasNode, bodyChars: number) => ({
    id: node.id,
    title: node.title,
    body: capText(node.body, bodyChars),
    summary: capText(node.summary, 240),
    status: node.status,
    author: node.author,
    nodeType: node.nodeType,
    tags: node.tags,
    provider: node.provider,
    runMode: node.runMode,
    aiRunId: node.aiRunId,
    codexThreadId: node.codexThreadId,
    openClawSessionKey: node.openClawSessionKey,
    claudeSessionId: node.claudeSessionId,
    attachments: node.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    children: [],
  });
  const selectedNode = toSlimSnapshot(target, 2_000);
  const pathSnapshots = path.map((node) => toSlimSnapshot(node, 500));
  const text = JSON.stringify({ selectedNode, path: pathSnapshots });
  return {
    selectedNode,
    path: pathSnapshots,
    siblingNodes: [],
    descendantCount: countDescendants(target),
    scope: "minimal",
    stats: {
      scope: "minimal",
      includedNodeCount: path.length,
      estimatedInputTokens: Math.ceil(text.length / 3.8),
      includedAttachmentCount: 0,
      includedAttachmentBytes: 0,
      sections: { selected: 1, path: path.length, siblings: 0 },
    },
    exportedAt: new Date(0).toISOString(),
  };
}

// --- internals ----------------------------------------------------------------

function collectConversationTurns(path: AtlasNode[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const node of path) {
    if (node.nodeType === "human_prompt") {
      turns.push({ role: "user", node });
    } else if (node.nodeType === "ai_reply" || (node.nodeType === "tool_result" && node.aiRunId)) {
      turns.push({ role: "assistant", node });
    }
  }
  return turns;
}

// Keep the newest turns whole within the budget, cutting only at a user-turn
// boundary so the replay always opens with a user message (Anthropic requires
// it, and it reads correctly everywhere else).
function fitConversationTurns(
  turns: ConversationTurn[],
  budget: number,
  maxTurnChars: number,
  verbatimTurnLimit: number,
) {
  if (!turns.length) return { turns: [] as ConversationTurn[], dropped: [] as ConversationTurn[] };
  // A hard cap on verbatim turns, independent of the budget. Without it a
  // branch with a few short turns replays its whole history word for word and
  // the payload grows with every node.
  const limit = Math.max(1, verbatimTurnLimit);
  let start = Math.max(0, turns.length - limit);
  let used = 0;
  for (let index = turns.length - 1; index >= start; index -= 1) {
    const cost = Math.min(nodeBodyText(turns[index].node).length, maxTurnChars) + 16;
    if (used + cost > budget && index < turns.length - 1) {
      start = index + 1;
      break;
    }
    used += cost;
  }
  while (start < turns.length && turns[start].role !== "user") start += 1;
  return { turns: turns.slice(start), dropped: turns.slice(0, start) };
}

function mergeAdjacentTurns(messages: ChatContextMessage[]): ChatContextMessage[] {
  const merged: ChatContextMessage[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

function nodeBodyText(node: AtlasNode) {
  return node.body?.trim() ? node.body : node.summary || node.title || "";
}

function nodeTitleText(node: AtlasNode) {
  return singleLine(node.title || node.summary || "Untitled").slice(0, 120);
}

function quoteTitle(node: AtlasNode) {
  return `"${nodeTitleText(node)}"`;
}

function summaryLine(node: AtlasNode) {
  return singleLine(node.summary || node.body || "").slice(0, 160);
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Truncate from the middle, keeping the opening and the closing text.
 *
 * Cutting only the tail silently deletes the end of a document, which is where
 * conclusions, acceptance criteria and "what to do next" usually live. Cutting
 * only the head deletes the specification. Keeping both ends and stating the
 * size of the elision preserves the parts a reader actually needs and makes the
 * loss visible instead of silent.
 */
export function capText(value: string, maxChars: number) {
  const limit = Math.max(0, maxChars);
  if (value.length <= limit) return value;
  // Too small to show both ends usefully: keep the opening.
  if (limit < 240) return `${value.slice(0, limit)}\n[...Mind Atlas omitted ${value.length - limit} characters]`;
  // Favour the opening slightly; it carries the specification more often.
  const headChars = Math.floor(limit * 0.6);
  const tailChars = limit - headChars;
  const head = value.slice(0, headChars);
  const tail = value.slice(value.length - tailChars);
  const omitted = value.length - headChars - tailChars;
  return `${head}\n\n[...Mind Atlas omitted ${omitted} characters from the middle...]\n\n${tail}`;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function findNodePath(root: AtlasNode, id: string): AtlasNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const result = findNodePath(child, id);
    if (result) return [root, ...result];
  }
  return null;
}

function findNode(root: AtlasNode, id: string): AtlasNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

function visitTree(node: AtlasNode, visit: (node: AtlasNode) => void) {
  visit(node);
  for (const child of node.children) visitTree(child, visit);
}

function countDescendants(node: AtlasNode): number {
  return node.children.length + node.children.reduce((count, child) => count + countDescendants(child), 0);
}

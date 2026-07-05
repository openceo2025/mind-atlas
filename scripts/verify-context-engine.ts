import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_PRESETS,
  buildContextPlan,
  buildSlimLegacyContext,
  renderAgentContextPrompt,
  renderAgentDeltaPrompt,
  resolveAgentSession,
} from "../src/context/contextEngine.ts";
import type { AtlasNode, NotebookNodeType } from "../src/types.ts";

// Tree shape: a book-like document chain with an AI conversation branch.
//
// root "Book"
//  root
//    act-1 (note)
//      chapter-1 (note)
//        req-1 (human_prompt) -> rep-1 (ai_reply) -> req-2 (human_prompt) -> rep-2 (ai_reply)
//        chapter-1-alt (note, sibling branch)
const rep2 = node("rep-2", "Second answer", "Answer two: the letter is a cipher.", [], {
  nodeType: "ai_reply",
  author: "ai",
  aiRunId: "run-2",
  createdAt: "2026-07-01T00:04:00.000Z",
});
const req2 = node("req-2", "Chat request", "What does the letter mean?", [rep2], {
  nodeType: "human_prompt",
  aiRunId: "run-2",
  createdAt: "2026-07-01T00:03:00.000Z",
});
const rep1 = node("rep-1", "First answer", "Answer one: the station scene sets the mystery.", [req2], {
  nodeType: "ai_reply",
  author: "ai",
  aiRunId: "run-1",
  createdAt: "2026-07-01T00:02:00.000Z",
});
const req1 = node("req-1", "Chat request", "Summarize this chapter.", [rep1], {
  nodeType: "human_prompt",
  aiRunId: "run-1",
  createdAt: "2026-07-01T00:01:00.000Z",
});
const root = node("root", "Book", "Novel planning notebook.", [
  node("act-1", "Act 1", "Opening act.", [
    node("chapter-1", "Chapter 1", "The protagonist arrives at the station.", [
      req1,
      node("chapter-1-alt", "Alt take", "Alternative chapter idea."),
    ]),
    node("chapter-2", "Chapter 2", "The first investigation."),
  ]),
  node("act-2", "Act 2", "Complications."),
]);

// --- conversation replay ------------------------------------------------------
const plan = buildContextPlan(root, "rep-2", { pinnedNodeIds: [] });
assert.ok(plan);
assert.equal(plan.conversation.length, 4);
assert.equal(plan.conversation[0].role, "user");
assert.equal(plan.conversation[0].content, "Summarize this chapter.");
assert.equal(plan.conversation[3].role, "assistant");
assert.match(plan.conversation[3].content, /cipher/);
// Target body is the last assistant turn, so it must not repeat in contextText.
assert.doesNotMatch(plan.contextText, /Answer two: the letter is a cipher/);
assert.match(plan.contextText, /Position: Book > Act 1 > Chapter 1 >/);
// Document chain keeps ancestor note bodies; skeleton shows sibling branches.
assert.match(plan.contextText, /The protagonist arrives at the station/);
assert.match(plan.contextText, /Outline skeleton/);
assert.match(plan.contextText, /"Alt take"/);
assert.match(plan.contextText, /"Chapter 2"/);
// No run metadata or timestamps may leak into model-facing text.
assert.doesNotMatch(plan.contextText, /aiRunId|exportedAt|LogPath|estimatedTokens/);
assert.ok(plan.stats.estimatedTokens > 0);

// --- pinned nodes ---------------------------------------------------------------
const pinnedPlan = buildContextPlan(root, "rep-2", { pinnedNodeIds: ["act-2"] });
assert.ok(pinnedPlan);
assert.match(pinnedPlan.contextText, /## Pinned nodes/);
assert.match(pinnedPlan.contextText, /Complications/);

// --- budget degradation: replay keeps newest turns, opens with a user turn ------
const tight = buildContextPlan(root, "rep-2", { conversationCharBudget: 120, charBudget: 3000 });
assert.ok(tight);
assert.ok(tight.conversation.length < 4);
assert.equal(tight.conversation[0]?.role, "user");
assert.ok(tight.stats.droppedTurnCount > 0);
assert.match(tight.contextText, /Earlier conversation \(summarized\)/);

// --- agent prompt rendering -----------------------------------------------------
const agentPrompt = renderAgentContextPrompt(plan, "Refactor the cipher explanation.");
assert.match(agentPrompt, /# Conversation so far/);
assert.match(agentPrompt, /# Task\nRefactor the cipher explanation\./);
const deltaPrompt = renderAgentDeltaPrompt(root, "rep-2", "Continue the work.");
assert.match(deltaPrompt, /resuming your previous session/);
assert.match(deltaPrompt, /Position: Book > Act 1 > Chapter 1 >/);
assert.match(deltaPrompt, /# Task\nContinue the work\./);
assert.ok(deltaPrompt.length < agentPrompt.length);

// --- session policy -------------------------------------------------------------
const NOW = Date.parse("2026-07-02T00:00:00.000Z");

// Codex: extending the branch tip continues the thread.
rep2.codexThreadId = "thread-a";
req2.codexThreadId = "thread-a";
{
  const session = resolveAgentSession(root, "rep-2", "codex", { now: NOW });
  assert.equal(session.action, "continue");
  assert.equal(session.resumeId, "thread-a");
}
// Codex: a sibling branch advanced the same thread -> divergence -> new session.
{
  const divergedTip = node("rep-3", "Sibling result", "Other branch output.", [], {
    nodeType: "ai_reply",
    author: "ai",
    aiRunId: "run-3",
    createdAt: "2026-07-01T01:00:00.000Z",
  });
  divergedTip.codexThreadId = "thread-a";
  const altBranch = findNode(root, "chapter-1-alt");
  altBranch.children.push(divergedTip);
  const session = resolveAgentSession(root, "rep-2", "codex", { now: NOW });
  assert.equal(session.action, "new");
  assert.equal(session.reason, "branch-diverged-linear-session");
  altBranch.children.pop();
}
// Codex: stale sessions are not resumed.
{
  const session = resolveAgentSession(root, "rep-2", "codex", { now: NOW + 30 * 24 * 60 * 60 * 1000 });
  assert.equal(session.action, "new");
  assert.equal(session.reason, "session-stale");
}
// Claude: always fork from the nearest ancestor snapshot.
rep2.claudeSessionId = "session-c";
{
  const session = resolveAgentSession(root, "rep-2", "claude", { now: NOW });
  assert.equal(session.action, "fork");
  assert.equal(session.resumeId, "session-c");
}
// No prior session -> new.
{
  const session = resolveAgentSession(root, "chapter-2", "openclaw", { now: NOW });
  assert.equal(session.action, "new");
  assert.equal(session.reason, "no-prior-session");
}
// Explicit user override wins.
{
  const session = resolveAgentSession(root, "rep-2", "codex", { now: NOW, forceNew: true });
  assert.equal(session.action, "new");
}

// --- slim legacy context ---------------------------------------------------------
const slim = buildSlimLegacyContext(root, "rep-2");
assert.ok(slim);
assert.equal(slim.selectedNode.id, "rep-2");
assert.equal(slim.scope, "minimal");
assert.equal(slim.path.length, 7);
assert.ok(JSON.stringify(slim).length < 4000);

// --- local budget preset stays tiny ----------------------------------------------
const localPlan = buildContextPlan(root, "rep-2", { pinnedNodeIds: [], ...CONTEXT_BUDGET_PRESETS.local });
assert.ok(localPlan);
assert.ok(localPlan.stats.contextChars + localPlan.stats.conversationChars < 3200);

console.log("Context engine verification passed");

function node(
  id: string,
  title: string,
  body: string,
  children: AtlasNode[] = [],
  overrides: Partial<AtlasNode> & { nodeType?: NotebookNodeType } = {},
): AtlasNode {
  const now = "2026-06-11T00:00:00.000Z";
  return {
    id,
    kind: id === "root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: "",
    body,
    author: "human",
    status: "waiting",
    color: "#88aaff",
    texture: "speckled",
    radius: id === "root" ? 80 : 28,
    summary: body,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
    ...overrides,
  };
}

function findNode(current: AtlasNode, id: string): AtlasNode {
  if (current.id === id) return current;
  for (const child of current.children) {
    const found = child.id === id ? child : child.children.length ? tryFind(child, id) : null;
    if (found) return found;
  }
  throw new Error(`node not found: ${id}`);
}

function tryFind(current: AtlasNode, id: string): AtlasNode | null {
  if (current.id === id) return current;
  for (const child of current.children) {
    const found = tryFind(child, id);
    if (found) return found;
  }
  return null;
}

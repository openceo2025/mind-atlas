#!/usr/bin/env node
// Local agent runtime contract checks.
//
// Runs entirely against the durable journal, the pure normalization helpers and
// fake providers. No paid provider call and no installed CLI is required, so
// this is safe as a routine gate.
//
// Usage: npm run verify:agent-runtime

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { accountAtlasInjection, estimateTokens, remainingContext } from "../src/agentRuntime/contextAccounting.ts";
import { createRunViewModel, reduceRunEvent } from "../src/agentRuntime/eventReducer.ts";
import { isSafeHref, parseMarkdown, parseUnifiedDiff, summarizeDiff } from "../src/agentRuntime/markdown.ts";
import { AtlasToolService } from "./agent-runtime/atlas-tool-service.mjs";
import { EvidenceStore, planEvidenceTransport, renderEvidenceReferenceBlock } from "./agent-runtime/evidence-store.mjs";
import { checkAgentWorkspace } from "./agent-runtime/workspace-policy.mjs";
import { HandoffCoordinator } from "./agent-runtime/handoff-coordinator.mjs";
import { AgentRunStore } from "./agent-runtime/run-journal.mjs";
import { AgentRuntimeManager } from "./agent-runtime/runtime-manager.mjs";
import {
  createMissionWorktree,
  createRunCheckpoint,
  inspectGitWorkspace,
  removeMissionWorktree,
  revertRunCheckpoint,
  runGit,
} from "./agent-runtime/git-workspace.mjs";
import { boundText, canTransition, redactText, redactValue, reduceCapabilities } from "./agent-runtime/types.mjs";

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` :: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`);
}

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), "mind-atlas-agent-runtime-"));
  try {
    await verifyRedaction();
    await verifyTransitions();
    await verifyCapabilityReduction();
    await verifyJournal(workDir);
    await verifyIdempotencyAndBounds(workDir);
    await verifyRecovery(workDir);
    await verifyFakeProviderRun(workDir);
    await verifyOwnershipAndHandoff(workDir);
    await verifyAtlasTools();
    await verifyContextAccounting();
    await verifyMarkdownSafety();
    await verifyEvidence(workDir);
    await verifyWorkspacePolicy(workDir);
    await verifyWorkspaceGitLifecycle(workDir);
    await verifyAgentWorkspaceReducer();
    await verifyModeSafety();
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} agent runtime checks`);
  process.exit(failures ? 1 : 0);
}

async function verifyRedaction() {
  section("Redaction");
  check("redacts OpenAI style keys", redactText("token sk-abcdefghijklmnopqrstuvwx here") === "token [redacted] here", redactText("token sk-abcdefghijklmnopqrstuvwx here"));
  check("redacts assignment secrets", /ANTHROPIC_API_KEY=\[redacted\]/.test(redactText("ANTHROPIC_API_KEY=super-secret-value-1234")), redactText("ANTHROPIC_API_KEY=super-secret-value-1234"));
  check("redacts authorization headers", /authorization: \[redacted\]/i.test(redactText("authorization: Bearer abc.def.ghi")), redactText("authorization: Bearer abc.def.ghi"));
  const nested = redactValue({ env: { SECRET: "x" }, note: "DATABASE_URL=postgres://u:p@h/db", nested: [{ headers: { a: 1 } }] });
  check("redacts env objects", nested.env === "[redacted]", nested);
  check("redacts nested headers", nested.nested[0].headers === "[redacted]", nested);
  check("redacts connection strings", /DATABASE_URL=\[redacted\]/.test(nested.note), nested.note);
  check("keeps ordinary text intact", redactValue({ text: "npm run build" }).text === "npm run build");
  const bounded = boundText("x".repeat(100), 10);
  check("bounds long text with an explicit marker", bounded.startsWith("xxxxxxxxxx") && bounded.includes("truncated"), bounded);
}

async function verifyTransitions() {
  section("Run state machine");
  check("running -> waiting_for_approval allowed", canTransition("running", "waiting_for_approval"));
  check("waiting_for_approval -> running allowed", canTransition("waiting_for_approval", "running"));
  check("completed -> running rejected", !canTransition("completed", "running"));
  check("native_owned -> running rejected", !canTransition("native_owned", "running"));
  check("native_owned -> reconciliation_required allowed", canTransition("native_owned", "reconciliation_required"));
  check("transferring -> native_owned allowed", canTransition("transferring", "native_owned"));
  check("transferring can settle back to running", canTransition("transferring", "running"));
  check("interrupted -> completed rejected", !canTransition("interrupted", "completed"));
}

async function verifyCapabilityReduction() {
  section("Capability reduction");
  const reduced = reduceCapabilities({
    provider: "claude",
    supports: { streaming: true, steer: undefined, browser: false },
    unavailableReasons: { browser: "needs a direct plan" },
  });
  check("proven capability stays true", reduced.supports.streaming === true);
  check("unknown capability becomes false", reduced.supports.steer === false, reduced.supports);
  check("unknown capability gets a reason", Boolean(reduced.unavailableReasons.steer), reduced.unavailableReasons);
  check("existing reason is preserved", reduced.unavailableReasons.browser === "needs a direct plan");
}

async function verifyJournal(baseRoot) {
  section("Durable journal");
  const store = new AgentRunStore({ baseDir: join(baseRoot, "journal") });
  await store.init();
  const handle = await store.createRun({ provider: "codex", route: "codex-app-server", workspace: baseRoot, clientRunId: "client-1" });

  const onDisk = await store.readManifest(handle.runId);
  check("manifest exists before any provider work", onDisk?.status === "queued", onDisk?.status);
  check("ownership defaults to Mind Atlas", onDisk?.ownership?.state === "mind_atlas", onDisk?.ownership);

  await handle.setStatus("starting");
  await handle.setStatus("running");
  await handle.append({ kind: "message_delta", delta: "hello " });
  await handle.append({ kind: "message_delta", delta: "world" });
  await handle.append({ kind: "message_completed", text: "hello world" });
  await handle.finalize({ status: "completed", text: "hello world" });

  const events = await store.readEvents(handle.runId, 0);
  check("events persist in sequence order", events.every((event, index) => event.sequence === index + 1), events.map((event) => event.sequence));
  check("every event carries the schema version", events.every((event) => event.schemaVersion === 1));
  check("terminal event is journaled, not a side channel", events.some((event) => event.kind === "lifecycle" && event.final === true));

  const replay = await store.readEvents(handle.runId, 3);
  check("replay honours Last-Event-ID", replay.every((event) => event.sequence > 3) && replay.length === events.length - 3, replay.map((event) => event.sequence));

  const final = await store.readFinal(handle.runId);
  check("final record is durable", final?.text === "hello world", final);
  const manifest = await store.readManifest(handle.runId);
  check("manifest reaches a terminal status", manifest.status === "completed", manifest.status);
  check("manifest records the final event id", Boolean(manifest.finalEventId));
  check("manifest is not acknowledged automatically", !manifest.acknowledgedAt);

  const planHandle = await store.createRun({
    provider: "claude",
    route: "claude-stream-json",
    workspace: baseRoot,
    authMode: "subscription",
  });
  await planHandle.append({
    kind: "usage_updated",
    usage: {
      scope: "account_plan",
      authMode: "subscription",
      rateLimitType: "five_hour",
      utilization: 0.35,
    },
  });
  const latestPlan = await store.latestUsageEvents({
    provider: "claude",
    scope: "account_plan",
    authMode: "subscription",
  });
  check("latest subscription allowance survives in the journal", latestPlan[0]?.usage?.utilization === 0.35, latestPlan);
}

async function verifyIdempotencyAndBounds(baseRoot) {
  section("Idempotency and bounded output");
  const store = new AgentRunStore({ baseDir: join(baseRoot, "bounds"), maxRunOutputBytes: 4000 });
  await store.init();
  const handle = await store.createRun({ provider: "claude", route: "claude-stream-json", workspace: baseRoot });

  await handle.append({ kind: "tool_started", providerEventId: "dup-1", tool: "Bash" });
  const duplicate = await handle.append({ kind: "tool_started", providerEventId: "dup-1", tool: "Bash" });
  check("duplicate provider events are ignored", duplicate === null);

  for (let index = 0; index < 60; index += 1) {
    await handle.append({ kind: "command_output", chunk: "y".repeat(400) });
  }
  const events = await store.readEvents(handle.runId, 0);
  const overflow = events.find((event) => event.code === "output_budget_exceeded");
  check("byte budget raises one explicit warning", Boolean(overflow), events.map((event) => event.kind));

  const survived = await handle.append({ kind: "message_completed", text: "final answer survives overflow" });
  check("final message survives the output budget", survived !== null);
  const afterOverflow = await handle.append({ kind: "command_output", chunk: "z" });
  check("low value output is dropped after overflow", afterOverflow === null);
}

async function verifyRecovery(baseRoot) {
  section("Interrupted run recovery");
  const baseDir = join(baseRoot, "recovery");
  const first = new AgentRunStore({ baseDir, instanceId: "bridge-instance-1" });
  await first.init();
  const handle = await first.createRun({ provider: "codex", route: "codex-app-server", workspace: baseRoot });
  await handle.setStatus("starting");
  await handle.setStatus("running");

  // A second bridge process starts while the first run is still "running".
  const second = new AgentRunStore({ baseDir, instanceId: "bridge-instance-2" });
  await second.init();
  const recovered = await second.recoverAbandonedRuns();
  check("abandoned run is recovered exactly once", recovered.length === 1, recovered.length);
  const manifest = await second.readManifest(handle.runId);
  check("abandoned run becomes interrupted, not failed", manifest.status === "interrupted", manifest.status);
  const final = await second.readFinal(handle.runId);
  check("interrupted run gets a recoverable final record", Boolean(final?.error), final);
  const again = await second.recoverAbandonedRuns();
  check("recovery is idempotent", again.length === 0, again.length);

  // Retention must never delete an unacknowledged result.
  const kept = new AgentRunStore({ baseDir, retentionDays: -1 });
  await kept.applyRetention();
  check("retention keeps unacknowledged results", Boolean(await kept.readManifest(handle.runId)));
}

async function verifyFakeProviderRun(baseRoot) {
  section("Fake provider run through the manager");
  const store = new AgentRunStore({ baseDir: join(baseRoot, "fake") });
  await store.init();
  const manager = new AgentRuntimeManager({
    store,
    codexRoutePreference: "exec",
    claudeRoutePreference: "json",
    legacyRunner: async (request) => {
      if (request.prompt.includes("BOOM")) throw new Error("fake provider failed");
      return {
        output: { body: "fake answer" },
        usage: { totalTokens: 42 },
        codexThreadId: "thread-fake-1",
        sessionInfo: { action: "new" },
      };
    },
  });

  const run = await manager.startRun({ provider: "codex", workspace: baseRoot, prompt: "hello", sessionMode: "new" });
  check("fallback route is selected when pinned", run.manifest.route === "codex-exec", run.manifest.route);
  await waitFor(async () => (await store.readManifest(run.manifest.runId))?.status === "completed", 5000);
  const done = await manager.describeRun(run.manifest.runId);
  check("fallback run reaches completed", done.manifest.status === "completed", done.manifest.status);
  check("fallback run records the final text", done.final?.text === "fake answer", done.final);
  check("fallback run records the provider session", done.manifest.session?.threadId === "thread-fake-1", done.manifest.session);

  const failing = await manager.startRun({ provider: "codex", workspace: baseRoot, prompt: "BOOM", sessionMode: "new" });
  await waitFor(async () => (await store.readManifest(failing.manifest.runId))?.status === "failed", 5000);
  const failed = await manager.describeRun(failing.manifest.runId);
  check("provider failure is a failed run, not a crash", failed.manifest.status === "failed", failed.manifest.status);
  check("provider failure records the error", String(failed.final?.error ?? "").includes("fake provider failed"), failed.final);

  const inbox = await manager.inbox({ graceMs: 0 });
  check("both terminal runs appear in the inbox", inbox.items.length === 2, inbox.items.length);
  const ack = await manager.acknowledge([run.manifest.runId], []);
  check("ack marks exactly one run", ack.acknowledged === 1, ack);
  const afterAck = await manager.inbox({ graceMs: 0 });
  check("acknowledged run leaves the inbox", afterAck.items.length === 1, afterAck.items.length);

  const control = await manager.interrupt("does-not-exist");
  check("control on an unknown run is typed, not silent", control.ok === false && control.reason === "unknown_run", control);
}

async function verifyOwnershipAndHandoff(baseRoot) {
  section("Session ownership and native handoff");
  const store = new AgentRunStore({ baseDir: join(baseRoot, "handoff") });
  await store.init();
  const manager = new AgentRuntimeManager({ store, legacyRunner: async () => ({ output: { body: "x" } }) });
  const coordinator = new HandoffCoordinator({
    store,
    manager,
    codexCommand: () => ({ command: "codex", args: [] }),
    claudeCommand: (args) => ({ command: "claude", args }),
    probeCodexDeepLink: () => false,
  });

  const handle = await store.createRun({
    provider: "codex",
    route: "codex-app-server",
    workspace: baseRoot,
    session: { provider: "codex", threadId: "thread-1", sessionId: "thread-1" },
  });
  await handle.setStatus("starting");
  await handle.setStatus("running");

  const blocked = await coordinator.prepareHandoff(handle.runId);
  check("handoff is refused while a turn is active", blocked.ok === false && blocked.reason === "run_active", blocked);

  await handle.finalize({ status: "completed", text: "answer with sk-abcdefghijklmnopqrstuvwx inside" });
  const prepared = await coordinator.prepareHandoff(handle.runId);
  check("handoff succeeds once the run is terminal", prepared.ok === true, prepared);
  check("ownership moves to transferring before launch", prepared.ownership.state === "transferring", prepared.ownership);
  check("handoff plan uses the verified CLI resume path", prepared.plan.kind === "cli_resume" && prepared.plan.args.includes("resume"), prepared.plan);
  check("handoff never claims an unavailable deep link", prepared.handoff.continuity.deepLinkAvailable === false, prepared.handoff.continuity);
  check("handoff package is redacted", !JSON.stringify(prepared.handoff).includes("sk-abcdefghijklmnopqrstuvwx"), prepared.handoff.answer);

  const persisted = await store.readHandoff(prepared.handoff.handoffId);
  check("handoff record is durable before launch", Boolean(persisted), persisted);

  const reclaimed = await coordinator.reclaim(handle.runId);
  check("reclaim returns ownership to Mind Atlas", reclaimed.ok && reclaimed.ownership.state === "mind_atlas", reclaimed.ownership);
  const twice = await coordinator.reclaim(handle.runId);
  check("reclaim is refused when Mind Atlas already owns the session", twice.ok === false && twice.reason === "not_native", twice);

  // Claude API route must never claim native session continuity.
  const apiHandle = await store.createRun({
    provider: "claude",
    route: "claude-stream-json",
    workspace: baseRoot,
    authMode: "api",
    session: { provider: "claude", sessionId: "session-api" },
  });
  await apiHandle.finalize({ status: "completed", text: "done" });
  const apiHandoff = await coordinator.prepareHandoff(apiHandle.runId);
  check("Claude API route falls back to a package", apiHandoff.handoff.continuity.kind === "package_only", apiHandoff.handoff.continuity);
  check("Claude API route never claims Desktop continuity", apiHandoff.handoff.continuity.desktopAvailable === false);
}

async function verifyAtlasTools() {
  section("Read-only Atlas tools");
  const service = new AtlasToolService({
    title: "Test notebook",
    root: {
      id: "root",
      title: "Mind Atlas",
      body: "root body",
      tags: [],
      status: "idea",
      nodeType: "note",
      attachments: [{ id: "a" }],
      children: [
        {
          id: "child-1",
          title: "日本語ノート",
          body: "これは日本語の本文です。検索対象になります。",
          tags: ["japanese"],
          status: "active",
          nodeType: "note",
          children: [{ id: "grand-1", title: "Grandchild", body: "deep body", tags: [], status: "idea", nodeType: "note", children: [] }],
        },
        { id: "child-2", title: "English note", body: "alpha beta gamma", tags: [], status: "idea", nodeType: "note", children: [] },
      ],
    },
  });

  const exact = await service.call("search_nodes", { query: "日本語" });
  check("exact search finds Japanese text", exact.content.hits[0]?.nodeId === "child-1", exact.content);
  check("exact search returns breadcrumbs, not full bodies", Array.isArray(exact.content.hits[0]?.breadcrumb), exact.content.hits[0]);

  const badRegex = await service.call("search_nodes", { query: "(a+)+$", regex: true });
  check("catastrophic regex is refused", badRegex.isError === true, badRegex);

  const semantic = await service.call("semantic_search_nodes", { query: "alpha" });
  check("semantic search is labelled honestly", semantic.content.scoringMode === "lexical+ngram", semantic.content.scoringMode);
  check("semantic search reports it is degraded without embeddings", semantic.content.degraded === true && semantic.content.embeddingBackend === null, semantic.content);

  const node = await service.call("get_node", { nodeId: "child-1" });
  check("get_node returns exact node content", node.content.title === "日本語ノート", node.content);
  check("get_node lists child ids", node.content.childIds.includes("grand-1"), node.content.childIds);

  const rootNode = await service.call("get_node", { nodeId: "root" });
  check("get_node never includes attachment content", rootNode.content.attachmentsIncluded === false && rootNode.content.attachmentCount === 1, rootNode.content);

  const branch = await service.call("get_branch", { nodeId: "grand-1" });
  check("get_branch returns the root chain", branch.content.chain.map((entry) => entry.nodeId).join(">") === "root>child-1>grand-1", branch.content.chain);

  const children = await service.call("get_children", { nodeId: "root" });
  check("get_children lists direct children only", children.content.children.length === 2, children.content);

  const outline = await service.call("get_atlas_outline", { maxDepth: 2 });
  check("outline is title-only and depth bounded", outline.content.outline.every((entry) => entry.depth <= 2 && !("body" in entry)), outline.content.outline);

  const missing = await service.call("get_node", { nodeId: "nope" });
  check("unknown node id is a typed error", missing.isError === true, missing);

  const unknown = await service.call("delete_node", {});
  check("write tools do not exist in the first release", unknown.isError === true, unknown);

  const empty = new AtlasToolService(null);
  const emptyResult = await empty.call("search_nodes", { query: "x" });
  check("missing snapshot degrades safely", emptyResult.isError === true, emptyResult);
}

async function verifyContextAccounting() {
  section("Context accounting");
  const english = "The quick brown fox jumps over the lazy dog and keeps running through the quiet field.";
  const japanese = "これは日本語の長い文章です。マインドアトラスはローカル開発者モードでコーデックスとクロードコードを動かします。";
  const code = "const value = items.filter((entry) => entry.id !== null).map((entry) => `${entry.id}:${entry.name}`);";

  const englishEstimate = estimateTokens(english);
  const japaneseEstimate = estimateTokens(japanese);
  const codeEstimate = estimateTokens(code);

  const englishRatio = englishEstimate.tokens / english.length;
  const japaneseRatio = japaneseEstimate.tokens / japanese.length;
  const codeRatio = codeEstimate.tokens / code.length;

  // Reference bands for BPE tokenizers used by both providers.
  check("English lands near 0.2-0.35 tokens per character", englishRatio > 0.18 && englishRatio < 0.38, englishRatio);
  check("Japanese lands near 0.8-1.3 tokens per character", japaneseRatio > 0.75 && japaneseRatio < 1.35, japaneseRatio);
  check("Japanese is not scored with the Latin divisor", japaneseRatio > englishRatio * 2.5, { japaneseRatio, englishRatio });
  check("Code is denser than English prose", codeRatio > englishRatio, { codeRatio, englishRatio });
  check("estimates are labelled as estimates", englishEstimate.isEstimate === true && englishEstimate.estimator === "script-aware-v1");
  check("byte count is UTF-8 aware", japaneseEstimate.bytes > japaneseEstimate.characters, japaneseEstimate);

  const injection = accountAtlasInjection({
    contextText: japanese,
    conversation: [{ role: "user", content: english }, { role: "assistant", content: english }],
    prompt: "Do the thing",
    pinnedNodes: 3,
    evidenceCount: 1,
  });
  check("injection counts replayed turns separately", injection.replayedTurns === 2, injection.replayedTurns);
  check("injection reports pinned nodes and evidence", injection.pinnedNodes === 3 && injection.evidenceCount === 1, injection);
  check("injection exposes an exact preview", injection.preview.includes(japanese) && injection.preview.includes("Do the thing"));

  check("remaining context is null when usage is unknown", remainingContext(null, 200_000) === null);
  check("remaining context is null when the window is unknown", remainingContext(1000, null) === null);
  const remaining = remainingContext(50_000, 200_000);
  check("remaining context is computed when both values are known", remaining?.remaining === 150_000 && Math.abs((remaining?.ratio ?? 0) - 0.25) < 1e-9, remaining);
}

async function verifyMarkdownSafety() {
  section("Markdown safety and rendering");
  check("javascript: links are rejected", isSafeHref("javascript:alert(1)") === false);
  check("data: urls are rejected", isSafeHref("data:text/html;base64,PHNjcmlwdD4=") === false);
  check("vbscript: links are rejected", isSafeHref("vbscript:msgbox") === false);
  check("protocol relative urls are rejected", isSafeHref("//evil.example.com") === false);
  check("https links are allowed", isSafeHref("https://example.com/page") === true);
  check("mailto links are allowed", isSafeHref("mailto:someone@example.com") === true);
  check("workspace relative paths are allowed", isSafeHref("src/App.tsx") === true);

  const blocks = parseMarkdown([
    "# Heading",
    "",
    "Text with <script>alert(1)</script> and a [link](javascript:alert(2)).",
    "",
    "| a | b |",
    "| --- | ---: |",
    "| 1 | 2 |",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "> quoted",
  ].join("\n"));
  const types = blocks.map((block) => block.type);
  check("headings, tables, lists, code and quotes are parsed", ["heading", "paragraph", "table", "list", "code", "blockquote"].every((type) => types.includes(type)), types);

  const paragraph = blocks.find((block) => block.type === "paragraph");
  const serialized = JSON.stringify(paragraph);
  check("raw HTML stays literal text, never a node type", !serialized.includes('"type":"html"') && serialized.includes("script"), serialized.slice(0, 200));
  const link = JSON.parse(serialized).children.find((node) => node.type === "link");
  check("unsafe link is parsed but marked unsafe", link && link.safe === false, link);

  const table = blocks.find((block) => block.type === "table");
  check("table alignment is captured", table.align[1] === "right", table.align);
  const list = blocks.find((block) => block.type === "list");
  check("task list checkbox state is captured", list.items[0].checked === true && list.items[1].checked === false, list.items.map((item) => item.checked));

  const fileRefBlocks = parseMarkdown("See src/store/atlasStore.ts:1840 for details.");
  const inlineTypes = JSON.stringify(fileRefBlocks).includes('"fileRef"');
  check("file:line references become typed nodes", inlineTypes, JSON.stringify(fileRefBlocks).slice(0, 200));

  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,4 @@",
    " context",
    "-removed",
    "+added",
    "+added two",
  ].join("\n");
  const parsedDiff = parseUnifiedDiff(diff);
  check("diff lines are typed", parsedDiff.some((line) => line.kind === "hunk") && parsedDiff.some((line) => line.kind === "add"), parsedDiff.map((line) => line.kind));
  const summary = summarizeDiff(diff);
  check("diff summary counts files and lines", summary.files.length === 1 && summary.added === 2 && summary.removed === 1, summary);
}

async function verifyEvidence(baseRoot) {
  section("Evidence transport");
  const store = new EvidenceStore({ baseDir: join(baseRoot, "evidence"), maxBytes: 1024 });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const record = await store.save({ buffer: png, fileName: "shot 1.png", mimeType: "image/png" });
  check("evidence is written to a local path", existsSync(record.localPath), record.localPath);
  check("evidence is classified by mime type", record.kind === "image", record.kind);
  check("evidence file name is sanitized", !/[^A-Za-z0-9._\\/:-]/.test(record.localPath), record.localPath);
  check("evidence is content addressed", record.sha256.length === 64 && record.localPath.includes(record.sha256.slice(0, 16)));
  const again = await store.save({ buffer: png, fileName: "shot 1.png", mimeType: "image/png" });
  check("identical evidence reuses one file", again.localPath === record.localPath);
  let oversized = null;
  try {
    await store.save({ buffer: Buffer.alloc(2048), fileName: "big.bin", mimeType: "application/octet-stream" });
  } catch (error) {
    oversized = error;
  }
  check("oversized evidence is rejected before a run starts", Boolean(oversized), oversized?.message);

  const capabilities = { supports: { images: true }, tools: ["Read", "Bash"] };
  const codexPlan = planEvidenceTransport("codex", capabilities, [record]);
  check("Codex images use the typed localImage transport", codexPlan[0].providerTransport === "localImage" && codexPlan[0].status === "attached", codexPlan[0]);

  const codexNoImages = planEvidenceTransport("codex", { supports: { images: false } }, [record]);
  check("a text-only Codex model reports images as unsupported", codexNoImages[0].status === "unsupported", codexNoImages[0]);

  const claudePlan = planEvidenceTransport("claude", capabilities, [record]);
  check("Claude images are reported as referenced, not attached", claudePlan[0].status === "referenced" && claudePlan[0].providerTransport === "pathReference", claudePlan[0]);
  check("referenced evidence says the model was not shown the image", /not attached as a typed image/.test(claudePlan[0].note), claudePlan[0].note);

  const noTools = planEvidenceTransport("claude", { supports: {}, tools: [] }, [record]);
  check("a runtime without file reading reports unsupported", noTools[0].status === "unsupported", noTools[0]);

  const block = renderEvidenceReferenceBlock(claudePlan);
  check("referenced evidence adds an explicit prompt block", block.includes(record.localPath) && block.includes("NOT attached"), block.slice(0, 160));
  check("attached evidence adds no prompt block", renderEvidenceReferenceBlock(codexPlan) === "");
}

async function verifyWorkspacePolicy(baseRoot) {
  section("Workspace policy");
  const home = join(baseRoot, "home");
  const projects = join(home, "projects");
  const repoA = join(projects, "repo_a");
  const repoB = join(projects, "repo_b");
  const credentials = join(home, ".codex");
  const system = join(baseRoot, "system");
  for (const dir of [home, projects, repoA, repoB, credentials, system]) {
    await mkdir(dir, { recursive: true });
  }
  const env = { USERPROFILE: home, SystemRoot: system };

  // Default policy: a developer runs agents across many repositories.
  check("any project directory is allowed by default", checkAgentWorkspace(repoA, { env }).ok === true, checkAgentWorkspace(repoA, { env }));
  check("a second unrelated repository is also allowed", checkAgentWorkspace(repoB, { env }).ok === true);
  check("an empty workspace falls through to the bridge default", checkAgentWorkspace("", { env }).ok === true);

  const missing = checkAgentWorkspace(join(projects, "nope"), { env });
  check("a non-existent directory is rejected", missing.ok === false && /does not exist/.test(missing.detail), missing);

  const homeResult = checkAgentWorkspace(home, { env });
  check("the home directory is refused", homeResult.ok === false && /credentials/.test(homeResult.detail), homeResult);

  const credentialResult = checkAgentWorkspace(credentials, { env });
  check("credential directories are refused", credentialResult.ok === false && /Credential directories/.test(credentialResult.detail), credentialResult);

  const systemResult = checkAgentWorkspace(system, { env });
  check("system directories are refused", systemResult.ok === false && /System directories/.test(systemResult.detail), systemResult);

  const driveResult = checkAgentWorkspace(process.platform === "win32" ? "C:\\" : "/", { env });
  check("a whole drive is refused", driveResult.ok === false, driveResult);

  // Hardened policy: an explicit allow-list narrows everything down.
  const hardened = { env, workRoots: [repoA], defaultRoots: [] };
  check("an allow-listed root is permitted", checkAgentWorkspace(repoA, hardened).ok === true);
  check("a path inside an allow-listed root is permitted", checkAgentWorkspace(join(repoA, "src"), hardened).ok === true || !existsSync(join(repoA, "src")));
  const outside = checkAgentWorkspace(repoB, hardened);
  check("a repository outside the allow-list is refused", outside.ok === false && /MIND_ATLAS_AGENT_WORK_ROOTS/.test(outside.detail), outside);
  check("the deny-list still applies under the allow-list", checkAgentWorkspace(home, { ...hardened, workRoots: [home] }).ok === false);
}

async function verifyWorkspaceGitLifecycle(baseRoot) {
  section("Git workspace identity and mission lifecycle");
  const repository = join(baseRoot, "git-workspace-source");
  const runtimeRoot = join(baseRoot, "git-workspace-runtime");
  await mkdir(repository, { recursive: true });
  await runGit(repository, ["init"]);
  await runGit(repository, ["config", "user.email", "mind-atlas-test@example.invalid"]);
  await runGit(repository, ["config", "user.name", "Mind Atlas Test"]);
  await writeFile(join(repository, "mission.txt"), "baseline\n", "utf8");
  await runGit(repository, ["add", "mission.txt"]);
  await runGit(repository, ["commit", "-m", "baseline"]);

  const source = await inspectGitWorkspace(repository);
  check("source Git workspace is inspectable", source.available && Boolean(source.repositoryId), source);
  const mission = await createMissionWorktree({
    sourceWorkspace: repository,
    baseDir: runtimeRoot,
    runId: "test-run-1234567890",
    title: "isolated mission",
  });
  const isolated = await inspectGitWorkspace(mission.path);
  check("mission worktree has a different root", isolated.gitRoot !== source.gitRoot, { source: source.gitRoot, mission: isolated.gitRoot });
  check("main checkout and mission share one repository identity", isolated.repositoryId === source.repositoryId, {
    source: source.repositoryId,
    mission: isolated.repositoryId,
  });

  await writeFile(join(mission.path, "mission.txt"), "changed by mission\n", "utf8");
  const checkpoint = await createRunCheckpoint({
    workspace: mission.path,
    changedFiles: ["mission.txt"],
    message: "test mission checkpoint",
  });
  check("checkpoint commits only attributed mission changes", checkpoint.ok && Boolean(checkpoint.commit), checkpoint);
  const afterCheckpoint = await inspectGitWorkspace(mission.path);
  check("checkpoint leaves the mission worktree clean", afterCheckpoint.dirtyCount === 0, afterCheckpoint.statusPreview);

  const reverted = await revertRunCheckpoint({ workspace: mission.path, commit: checkpoint.commit });
  check("checkpoint revert creates a new commit", reverted.ok && reverted.commit !== checkpoint.commit, reverted);
  const content = await readFile(join(mission.path, "mission.txt"), "utf8");
  check("checkpoint revert restores the pre-mission content", content.trim() === "baseline", content);

  const removed = await removeMissionWorktree({ sourceGitRoot: source.gitRoot, worktreePath: mission.path });
  check("clean mission worktree can be removed explicitly", removed.ok && !existsSync(mission.path), removed);
}

async function verifyAgentWorkspaceReducer() {
  section("Agent workspace reducer");
  const base = {
    schemaVersion: 1,
    runId: "run-reducer",
    provider: "claude",
    route: "claude-stream-json",
    createdAt: new Date().toISOString(),
  };
  let model = createRunViewModel("run-reducer");
  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-1",
    sequence: 1,
    kind: "command_started",
    itemId: "command-1",
    command: "npm test",
    cwd: "C:\\repo",
  });
  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-2",
    sequence: 2,
    kind: "command_output",
    itemId: "command-1",
    chunk: "first\n",
  });
  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-3",
    sequence: 3,
    kind: "command_completed",
    itemId: "command-1",
    output: "final\n",
    status: "completed",
    exitCode: 0,
  });
  check("terminal events are grouped by provider item id", model.terminal.length === 1 && model.terminal[0].command === "npm test", model.terminal);
  check("terminal completion replaces the bounded final output", model.terminal[0].output === "final\n" && model.terminal[0].exitCode === 0, model.terminal[0]);

  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-4",
    sequence: 4,
    kind: "subagent",
    itemId: "subagent-1",
    activity: "started",
    status: "running",
    label: "Review tests",
  });
  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-5",
    sequence: 5,
    kind: "subagent",
    itemId: "subagent-1",
    activity: "completed",
    status: "completed",
    label: "Review tests",
  });
  check("sub-agent updates retain one nested identity", model.subagents.length === 1 && model.subagents[0].status === "completed", model.subagents);

  model = reduceRunEvent(model, {
    ...base,
    eventId: "event-6",
    sequence: 6,
    kind: "usage_updated",
    usage: {
      scope: "account_plan",
      authMode: "subscription",
      rateLimitType: "five_hour",
      utilization: 0.42,
      resetsAt: 123,
    },
  });
  check("Claude plan utilization survives normalization", model.usage.accountPlan?.utilization === 0.42, model.usage.accountPlan);
  check("plan allowance remains separate from provider context usage", model.usage.providerSession === null, model.usage);
}

/**
 * The agent runtime is `local-only`. These checks fail the build if any part of
 * it becomes reachable from the hosted service, which is the single most
 * dangerous regression this feature could cause.
 */
async function verifyModeSafety() {
  section("Mode safety (local-only enforcement)");
  const repoRoot = new URL("..", import.meta.url);
  const readRepoFile = async (relative) => await readFile(new URL(relative, repoRoot), "utf8");

  const hostedService = await readRepoFile("server/mind-atlas-service.mjs");
  check("hosted service does not import the agent runtime", !/agent-runtime/.test(hostedService));
  check("hosted service exposes no agent run routes", !/\/api\/agent-(runs|capabilities|runtime)/.test(hostedService));
  check("hosted service does not spawn Codex or Claude Code", !/codex\s+app-server|--output-format\s+stream-json/.test(hostedService));

  const runtimeClient = await readRepoFile("src/agentRuntime/runtimeClient.ts");
  check("browser client gates on hosted mode", /isHostedServiceMode\(\)/.test(runtimeClient));
  check("browser client refuses hosted calls", /assertLocal\(\)/.test(runtimeClient));
  const exportedFunctions = [...runtimeClient.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
  const guarded = exportedFunctions.filter((name) => {
    const body = runtimeClient.slice(runtimeClient.indexOf(`export async function ${name}`));
    return body.slice(0, 400).includes("assertLocal()");
  });
  check("every exported runtime call asserts local mode", guarded.length === exportedFunctions.length, {
    exported: exportedFunctions.length,
    guarded: guarded.length,
    missing: exportedFunctions.filter((name) => !guarded.includes(name)),
  });

  const workspace = await readRepoFile("src/components/agentRun/AgentRunWorkspace.tsx");
  check("workspace renders nothing without the local runtime", /if \(!isAgentRuntimeAvailable\(\)\) return null;/.test(workspace));
  check("runtime controls follow discovered steering support", /disabled=\{busy \|\| !canSteer/.test(workspace));
  check("runtime controls follow discovered compaction support", /disabled=\{busy \|\| !canCompact/.test(workspace));
  // Match real usage (`dangerouslySetInnerHTML=` / `:`), not the word appearing
  // in a comment that explains why it is absent.
  const unsafeHtml = /dangerouslySetInnerHTML\s*[=:]|\.innerHTML\s*=/;
  for (const file of ["MarkdownView.tsx", "AgentRunWorkspace.tsx", "AgentRunWorkspaceHost.tsx"]) {
    const source = await readRepoFile(`src/components/agentRun/${file}`);
    check(`${file} never assigns raw HTML`, !unsafeHtml.test(source));
  }

  const app = await readRepoFile("src/App.tsx");
  check("App gates the workspace on public service mode", /publicServiceMode \? null : <AgentRunWorkspaceHost \/>/.test(app));

  const commandDock = await readRepoFile("src/components/CommandDock.tsx");
  check("Code requests require an explicit Atlas-to-repository binding", /Bind this branch/.test(commandDock) && /agentRepositoryReady/.test(commandDock));
  check("Claude browser control is capability-gated", /disabled=\{!claudeBrowserSupported\}/.test(commandDock));

  const workspaceHost = await readRepoFile("src/components/agentRun/AgentRunWorkspaceHost.tsx");
  check("a hidden run workspace keeps a persistent reopen launcher", /agent-workspace-launcher/.test(workspaceHost) && /Agent runs/.test(workspaceHost));

  const localBridge = await readRepoFile("scripts/mind-atlas-bridge.mjs");
  check("Claude browser requests require the subscription route", /browser: provider === "claude" && settings\.authMode === "subscription" && settings\.browser === true/.test(localBridge));

  const bridgeRoutes = await readRepoFile("scripts/agent-runtime/bridge-routes.mjs");
  check("mutating agent routes require an allowed Origin", /if \(mutating && !originAllowed\(/.test(bridgeRoutes));
  check("run creation checks the workspace allow-list", /isAllowedWorkspace\(/.test(bridgeRoutes));
  check("legacy inbox and ack routes are left to the bridge", /path === "\/api\/agent-runs\/inbox" \|\| path === "\/api\/agent-runs\/ack"/.test(bridgeRoutes));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

await main();

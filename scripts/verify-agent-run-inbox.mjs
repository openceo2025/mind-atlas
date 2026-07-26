import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const workspace = process.cwd();
const bridgePath = resolve("scripts/mind-atlas-bridge.mjs");
const fakeClaudePath = resolve("scripts/fixtures/fake-claude-code.mjs");
const inboxDir = await mkdtemp(join(tmpdir(), "mind-atlas-agent-inbox-"));
let bridge = null;

try {
  bridge = await startBridge(8896, { MIND_ATLAS_FAKE_CLAUDE_DELAY_MS: "10" });
  const success = await requestClaude(8896, "fixture-success");
  assert.equal(success.output.body, "Recovered fixture response.");
  await wait(20);
  let inbox = await readInbox(8896);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].status, "completed");
  assert.equal(inbox.items[0].clientRunId, "fixture-success");
  await acknowledge(8896, { clientRunIds: ["fixture-success"] });
  inbox = await readInbox(8896);
  assert.equal(inbox.items.length, 0);
  stopProcessTree(bridge);
  bridge = null;

  bridge = await startBridge(8897, { MIND_ATLAS_FAKE_CLAUDE_EXIT_CODE: "2" });
  const failedResponse = await fetch("http://127.0.0.1:8897/api/ai/respond", requestOptions("fixture-error"));
  assert.equal(failedResponse.status, 502);
  await wait(20);
  inbox = await readInbox(8897);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].status, "error");
  assert.match(inbox.items[0].error, /Fake Claude Code failure/);
  await acknowledge(8897, { ids: [inbox.items[0].id] });
  stopProcessTree(bridge);
  bridge = null;

  bridge = await startBridge(8898, { MIND_ATLAS_FAKE_CLAUDE_DELAY_MS: "30000" });
  void fetch("http://127.0.0.1:8898/api/ai/respond", requestOptions("fixture-interrupted")).catch(() => {});
  await waitForJournal("fixture-interrupted");
  stopProcessTree(bridge);
  bridge = null;
  await wait(100);

  bridge = await startBridge(8899, { MIND_ATLAS_CLAUDE_DISABLED: "true" });
  inbox = await readInbox(8899);
  const interrupted = inbox.items.find((item) => item.clientRunId === "fixture-interrupted");
  assert.equal(interrupted?.status, "interrupted");
  assert.match(interrupted?.error ?? "", /bridge restarted/i);
  await acknowledge(8899, { ids: [interrupted.id] });

  console.log("Agent run inbox verification passed");
} finally {
  if (bridge) stopProcessTree(bridge);
  await rm(inboxDir, { recursive: true, force: true });
}

async function startBridge(port, extraEnv = {}) {
  const child = spawn(process.execPath, [bridgePath], {
    cwd: workspace,
    env: {
      ...process.env,
      MIND_ATLAS_BRIDGE_PORT: String(port),
      MIND_ATLAS_AGENT_RUN_INBOX_DIR: inboxDir,
      MIND_ATLAS_AGENT_RUN_INBOX_GRACE_MS: "1",
      MIND_ATLAS_CLAUDE_BIN: fakeClaudePath,
      MIND_ATLAS_CLAUDE_WORKSPACE: workspace,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Bridge exited before startup: ${diagnostics}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return child;
    } catch {
      // keep polling during startup
    }
    await wait(25);
  }
  stopProcessTree(child);
  throw new Error(`Bridge did not become ready: ${diagnostics}`);
}

async function requestClaude(port, clientRunId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/respond`, requestOptions(clientRunId));
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

function requestOptions(clientRunId) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "claude",
      prompt: `Recovery test ${clientRunId}`,
      context: { selectedNode: { id: "test-node", title: "Test", body: "" }, path: [], selectedNodes: [], siblingNodes: [] },
      claude: {
        clientRunId,
        requestNodeId: `request-${clientRunId}`,
        sourceNodeId: "test-node",
        workspace,
        timeoutMs: 60000,
      },
    }),
  };
}

async function readInbox(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/agent-runs/inbox`);
  assert.equal(response.status, 200);
  return await response.json();
}

async function acknowledge(port, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/agent-runs/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
}

async function waitForJournal(clientRunId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const files = await readdir(inboxDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const record = JSON.parse(await readFile(join(inboxDir, file), "utf8"));
      if (record.clientRunId === clientRunId && record.status === "running") return;
    }
    await wait(25);
  }
  throw new Error(`Running journal was not created for ${clientRunId}`);
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The process may already have exited after taskkill.
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

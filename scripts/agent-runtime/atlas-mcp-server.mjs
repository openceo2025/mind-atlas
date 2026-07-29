#!/usr/bin/env node
// Run-scoped, read-only Mind Atlas MCP server (stdio).
//
// Mode: local-only.
//
// The process receives one argument: the path to a sanitized, run-scoped
// notebook snapshot written by the bridge. It never talks back to the bridge,
// never opens a socket, and exposes no write tools. If the snapshot file is
// missing, every tool reports that no notebook is attached rather than failing
// the provider run.
//
// Usage:
//   node scripts/agent-runtime/atlas-mcp-server.mjs <snapshot.json>

import { readFileSync } from "node:fs";

import { AtlasToolService } from "./atlas-tool-service.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const snapshotPath = process.argv[2] ?? process.env.MIND_ATLAS_ATLAS_SNAPSHOT ?? "";

let snapshot = null;
if (snapshotPath) {
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch (error) {
    process.stderr.write(`mind-atlas mcp: could not read snapshot: ${String(error?.message ?? error)}\n`);
  }
}

const service = new AtlasToolService(snapshot);

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) void handleLine(trimmed);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === undefined) return;
  const { id, method, params } = message;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mind-atlas-atlas-tools", version: "1.0.0" },
        instructions:
          "Read-only Mind Atlas notebook retrieval. Use get_atlas_outline to orient, search_nodes for exact text, semantic_search_nodes for relevance ranking, then get_node / get_branch / get_children for exact content. Never assume a node exists without retrieving it.",
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: service.listTools() } });
    return;
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = params?.arguments ?? {};
    let result;
    try {
      result = await service.call(name, args);
    } catch (error) {
      result = { isError: true, content: `Mind Atlas tool failed: ${String(error?.message ?? error).slice(0, 400)}` };
    }
    send({
      jsonrpc: "2.0",
      id,
      result: {
        isError: Boolean(result.isError),
        content: [{ type: "text", text: typeof result.content === "string" ? result.content : JSON.stringify(result.content, null, 2) }],
      },
    });
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

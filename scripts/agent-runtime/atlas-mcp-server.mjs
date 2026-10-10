#!/usr/bin/env node
// Run-scoped Mind Atlas MCP server (stdio).
//
// Mode: local-only.
//
// Reading: the tools read the copy of the notebook the open Mind Atlas
// browser keeps at the bridge (`atlas-link.mjs`), so they see the notebook as
// it is now. Without the bridge, or before any browser has sent a copy, they
// read the run-scoped snapshot file given as the first argument, if any.
//
// Writing: the write tools (`atlas-write-tools.mjs`) queue an operation at the
// bridge with this run's token; the open browser applies it. The only socket
// this process opens is to the bridge on this machine.
//
// Usage:
//   node scripts/agent-runtime/atlas-mcp-server.mjs [<snapshot.json>]
//   env MIND_ATLAS_BRIDGE_ORIGIN  the bridge on this machine
//       MIND_ATLAS_RUN_TOKEN      this run's token for queuing writes
//       MIND_ATLAS_HTTPS_CA       the bridge's CA, when it serves HTTPS

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { AtlasToolService } from "./atlas-tool-service.mjs";
import { ATLAS_WRITE_TOOL_DEFINITIONS, ATLAS_WRITE_TOOL_NAMES, describeWrite } from "./atlas-write-tools.mjs";

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
const bridgeOrigin = process.env.MIND_ATLAS_BRIDGE_ORIGIN ?? "";
const runToken = process.env.MIND_ATLAS_RUN_TOKEN ?? "";
const bridgeCa = readOptional(process.env.MIND_ATLAS_HTTPS_CA ?? "");
const canWrite = Boolean(bridgeOrigin && runToken);
const COPY_TTL_MS = 2_000;
let copyFetchedAt = 0;
let copyUpdatedAt = "";

function readOptional(path) {
  if (!path) return undefined;
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** One JSON request to the bridge on this machine. */
function bridge(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, bridgeOrigin);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = send(url, {
      method,
      headers: {
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(runToken ? { "x-mind-atlas-run-token": runToken } : {}),
      },
      ...(url.protocol === "https:" ? (bridgeCa ? { ca: bridgeCa } : { rejectUnauthorized: false }) : {}),
      timeout: 60_000,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try {
          const parsed = text ? JSON.parse(text) : {};
          if ((res.statusCode ?? 500) >= 400) reject(new Error(String(parsed?.error ?? `HTTP ${res.statusCode}`)));
          else resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("The bridge did not answer.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Reads the notebook as the open browser last sent it, at most every 2 s. */
async function refreshCopy() {
  if (!bridgeOrigin || Date.now() - copyFetchedAt < COPY_TTL_MS) return;
  copyFetchedAt = Date.now();
  try {
    const answer = await bridge("GET", "/api/atlas-link/copy");
    const copy = answer?.copy;
    if (copy?.root && copy.updatedAt !== copyUpdatedAt) {
      service.setSnapshot({ root: copy.root, title: copy.title });
      copyUpdatedAt = copy.updatedAt;
    }
  } catch {
    // Keep whatever was read last, or the run's own snapshot.
  }
}

async function callTool(name, args) {
  if (ATLAS_WRITE_TOOL_NAMES.includes(name)) {
    if (!canWrite) return { isError: true, content: "Writing to Mind Atlas is not available in this run." };
    const answer = await bridge("POST", "/api/atlas-link/ops", { tool: name, args });
    copyFetchedAt = 0;
    return describeWrite(answer);
  }
  await refreshCopy();
  return service.call(name, args);
}

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
        serverInfo: { name: "mind-atlas-atlas-tools", version: "2.0.0" },
        instructions: canWrite
          ? "The owner's Mind Atlas notebook. Use get_atlas_outline to orient, search_nodes or semantic_search_nodes to find the project card a request belongs to, and get_node / get_branch / get_children for exact content. Record what you find, decide and do as cards under that project card with add_child_nodes, keep card status current with set_node_status, and tidy with update_node_text, move_nodes, bulk_update_nodes or delete_node. Never assume a node exists without retrieving it."
          : "Read-only Mind Atlas notebook retrieval. Use get_atlas_outline to orient, search_nodes for exact text, semantic_search_nodes for relevance ranking, then get_node / get_branch / get_children for exact content. Never assume a node exists without retrieving it.",
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: canWrite ? [...service.listTools(), ...ATLAS_WRITE_TOOL_DEFINITIONS] : service.listTools() },
    });
    return;
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = params?.arguments ?? {};
    let result;
    try {
      result = await callTool(name, args);
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

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
/** One reader per named space (ADR 0089), each refreshed on its own. */
const spaceReaders = new Map();
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

/** The reader for a named space, refreshed at most every 2 s. */
async function readerFor(space) {
  let reader = spaceReaders.get(space);
  if (!reader) {
    reader = { service: new AtlasToolService(null), fetchedAt: 0, updatedAt: "" };
    spaceReaders.set(space, reader);
  }
  if (Date.now() - reader.fetchedAt >= COPY_TTL_MS) {
    reader.fetchedAt = Date.now();
    const answer = await bridge("GET", `/api/atlas-link/copy?space=${encodeURIComponent(space)}`);
    const copy = answer?.copy;
    if (copy?.root && copy.updatedAt !== reader.updatedAt) {
      reader.service.setSnapshot({ root: copy.root, title: copy.title });
      reader.updatedAt = copy.updatedAt;
    }
  }
  return reader.service;
}

const SPACE_TOOLS = [
  {
    name: "list_spaces",
    description:
      "List the spaces: the owner's, one per project, one per person, and any others. Everybody may read and write every space. Use a space's id or title as `space` in the other tools; leave `space` out for the one open in Mind Atlas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_space",
    description:
      "Make a new space, e.g. for a new topic or project that does not fit an existing one. Make one when it helps; do not make many for small things.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["project", "employee", "other"] },
      },
      required: ["title"],
    },
  },
  {
    name: "move_to_space",
    description:
      "Move a branch (a card and everything under it) from one space to another: it is written into the target, then taken out of the source.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "The branch's card id in the source space." },
        from: { type: "string", description: "The source space's id or title; omit for the one open in Mind Atlas." },
        to: { type: "string", description: "The target space's id or title." },
        parentId: { type: "string", description: "Where to put it in the target; its root when omitted." },
      },
      required: ["nodeId", "to"],
    },
  },
];
const SPACE_TOOL_NAMES = SPACE_TOOLS.map((tool) => tool.name);

/** Every tool, each with an optional `space` to say which space it means. */
function withSpace(tools) {
  return tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...(tool.inputSchema?.properties ?? {}),
        space: {
          type: "string",
          description: "Which space: an id or title from list_spaces. Omit for the one open in Mind Atlas.",
        },
      },
    },
  }));
}

async function callTool(name, args) {
  if (SPACE_TOOL_NAMES.includes(name)) {
    if (!bridgeOrigin) return { isError: true, content: "Spaces need the Mind Atlas bridge." };
    if (name === "list_spaces") return { content: await bridge("GET", "/api/atlas-link/spaces") };
    if (!canWrite) return { isError: true, content: "Writing to Mind Atlas is not available in this run." };
    if (name === "create_space") return { content: await bridge("POST", "/api/atlas-link/spaces", args) };
    const moved = await bridge("POST", "/api/atlas-link/move", args);
    copyFetchedAt = 0;
    spaceReaders.clear();
    return { content: moved };
  }
  if (ATLAS_WRITE_TOOL_NAMES.includes(name)) {
    if (!canWrite) return { isError: true, content: "Writing to Mind Atlas is not available in this run." };
    const answer = await bridge("POST", "/api/atlas-link/ops", { tool: name, args });
    copyFetchedAt = 0;
    spaceReaders.delete(String(args?.space ?? ""));
    return describeWrite(answer);
  }
  const space = typeof args?.space === "string" ? args.space.trim() : "";
  if (space && bridgeOrigin) return (await readerFor(space)).call(name, args);
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
          ? "The owner's Mind Atlas on this PC, not the public mind-atlas.org service. Work with Mind Atlas only through these tools; do not use mind-atlas.org, SSH, or Mind Atlas deployment or operations skills unless the owner asks. There are several spaces (list_spaces): the owner's, one per project, one per person, and others. Everybody may read and write any of them; pass `space` to say which, or leave it out for the one open in Mind Atlas. Use get_atlas_outline to orient, search_nodes or semantic_search_nodes to find where a request belongs, and get_node / get_branch / get_children for exact content. Record what you find, decide and do as cards with add_child_nodes, keep card status current with set_node_status, tidy with update_node_text, move_nodes, bulk_update_nodes or delete_node, move a branch to another space with move_to_space, and make a space with create_space when one is needed. Never assume a node exists without retrieving it."
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
      result: {
        tools: canWrite
          ? [...withSpace([...service.listTools(), ...ATLAS_WRITE_TOOL_DEFINITIONS]), ...SPACE_TOOLS]
          : bridgeOrigin
            ? [...withSpace(service.listTools()), SPACE_TOOLS[0]]
            : service.listTools(),
      },
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

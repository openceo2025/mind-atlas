import { completeAtlasLinkOperation, getAtlasLatest, getAtlasLinkOperations, sendAtlasCopy, type AtlasLinkOperation } from "../ai/bridgeClient";
import { useAtlasStore } from "../store/atlasStore";
import type { AtlasNode, WorkStatus } from "../types";

/**
 * The open notebook's side of the agent link (local-only).
 *
 * This browser holds the notebook and is the only thing that changes it. It
 * keeps a sanitized copy at the bridge for agents to read, and applies the
 * writes agents queue there (scripts/agent-runtime/atlas-link.mjs) with the
 * same store actions a person uses, so undo and history cover them. Agents
 * need no approval for any write (OpenCEO ADR 0059); each one is listed in the
 * AI Partner log with the agent's name, and new cards are marked as an AI's.
 */

const COPY_DELAY_MS = 1_500;
/** At most this often, a notebook agents wrote to is saved to the cloud store. */
const AUTOSAVE_MS = 10 * 60_000;

/** Saves the notebook to the cloud store without asking; set by the app. */
type CloudSaver = () => Promise<string>;
let cloudSaver: CloudSaver | null = null;

// ------------------------------------------------- an older notebook here

/**
 * Which copy of each notebook this tab started from, by root id. Per tab:
 * two tabs of one browser share local storage, and an old tab must not pass
 * for the one that wrote last.
 */
const BASE_KEY = "mind-atlas.atlas-link-base:";

function readBase(rootId: string): string {
  try {
    return window.sessionStorage.getItem(BASE_KEY + rootId) ?? "";
  } catch {
    return "";
  }
}

function writeBase(rootId: string, at: string): void {
  try {
    window.sessionStorage.setItem(BASE_KEY + rootId, at);
  } catch {
    // Unavailable storage: the next copy is compared again, nothing is lost.
  }
}

/** Set while this browser's notebook is older than the newest one kept. */
export type AtlasStale = { latestAt: string } | null;
let stale: AtlasStale = null;
const staleListeners = new Set<(value: AtlasStale) => void>();
let keepThisBrowser: () => void = () => undefined;

function setStale(value: AtlasStale): void {
  if (JSON.stringify(value) === JSON.stringify(stale)) return;
  stale = value;
  for (const listener of staleListeners) listener(value);
}

/** Told whenever this browser's notebook is found older, or not any more. */
export function onAtlasStale(listener: (value: AtlasStale) => void): () => void {
  staleListeners.add(listener);
  listener(stale);
  return () => staleListeners.delete(listener);
}

/** Loads the newest notebook the bridge keeps, in place of this one. */
export async function loadAtlasLatest(): Promise<void> {
  const latest = await getAtlasLatest();
  if (!latest?.root || typeof latest.root !== "object") throw new Error("No newer notebook is kept.");
  writeBase(latest.rootId, latest.acceptedAt);
  useAtlasStore.getState().importNotebook(latest.root as AtlasNode);
  setStale(null);
}

/** Keeps this browser's notebook on purpose: it becomes the newest. */
export function keepAtlasHere(): void {
  keepThisBrowser();
}

/** The app hands over its own cloud save, made silent, for agents to use. */
export function setAtlasCloudSaver(saver: CloudSaver | null): void {
  cloudSaver = saver;
}
/** How long one request for writes waits at the bridge for one to arrive. */
const WAIT_MS = 20_000;
/** After a failed request (the bridge is down), before asking again. */
const RETRY_MS = 2_000;
const STATUSES: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];

export function startAtlasLink(): () => void {
  let stopped = false;
  let copyTimer: number | null = null;
  let wroteSinceSave = false;
  let lastSaveAt = Date.now();

  const sendCopy = (force = false) => {
    copyTimer = null;
    const state = useAtlasStore.getState();
    const root = state.atlasRoot;
    let full: unknown = undefined;
    try {
      full = JSON.parse(state.exportNotebook());
    } catch {
      full = undefined;
    }
    void sendAtlasCopy({
      title: root.title,
      root: copyOf(root),
      full,
      basedOn: readBase(root.id),
      ...(force ? { force: true } : {}),
    })
      .then((answer) => {
        if (answer.stale) {
          setStale({ latestAt: answer.latestAt ?? "" });
          return;
        }
        if (answer.updatedAt) writeBase(root.id, answer.updatedAt);
        setStale(null);
      })
      .catch(() => undefined);
  };
  keepThisBrowser = () => sendCopy(true);
  const scheduleCopy = () => {
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(sendCopy, COPY_DELAY_MS);
  };
  const unsubscribe = useAtlasStore.subscribe((state, previous) => {
    if (state.atlasRoot !== previous.atlasRoot) scheduleCopy();
  });

  // Writes are asked for with a request the bridge holds until one arrives,
  // not on a timer: a tab in the background has its timers slowed to once a
  // minute, and an agent's write would wait that long (OpenCEO: "queued but
  // not applied"). An answer to a waiting request is not slowed.
  const loop = async () => {
    while (!stopped) {
      try {
        const ops = await getAtlasLinkOperations(WAIT_MS);
        for (const op of ops) {
          if (stopped) break;
          const result = await applyAtlasOperation(op);
          await completeAtlasLinkOperation(op.id, result).catch(() => undefined);
          if (result.ok && op.tool !== "save_to_cloud") wroteSinceSave = true;
          if (op.tool === "save_to_cloud" && result.ok) lastSaveAt = Date.now();
        }
        // What agents wrote is kept beyond this browser, now and then
        // (OpenCEO: the notebook must not seem lost in another browser).
        if (wroteSinceSave && cloudSaver && Date.now() - lastSaveAt > AUTOSAVE_MS) {
          wroteSinceSave = false;
          lastSaveAt = Date.now();
          void cloudSaver().catch(() => {
            wroteSinceSave = true;
          });
        }
        // What agents read changes now, not after the copy's delay.
        if (ops.length > 0 && !stopped) {
          if (copyTimer !== null) window.clearTimeout(copyTimer);
          sendCopy();
        }
      } catch {
        // The bridge is not running; ask again in a moment.
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS));
      }
    }
  };

  sendCopy();
  void loop();
  return () => {
    stopped = true;
    unsubscribe();
    if (copyTimer !== null) window.clearTimeout(copyTimer);
  };
}

/** What agents may read: text, status and shape, never attachment data. */
export function copyOf(node: AtlasNode): Record<string, unknown> {
  return {
    id: node.id,
    title: node.title,
    body: node.body,
    subtitle: node.subtitle ?? "",
    summary: node.summary ?? "",
    nextDecision: node.nextDecision ?? "",
    tags: node.tags ?? [],
    status: node.status,
    nodeType: node.nodeType ?? "",
    provider: node.provider ?? "",
    runMode: node.runMode ?? "",
    author: node.author,
    attachmentCount: node.attachments?.length ?? 0,
    children: node.children.map(copyOf),
  };
}

type Result = { ok: boolean; text: string; data?: unknown };

/** Applies one agent's write with the store, and logs it. */
export async function applyAtlasOperation(op: AtlasLinkOperation): Promise<Result> {
  let result: Result;
  try {
    result = op.tool === "save_to_cloud" ? await saveToCloud() : apply(op);
  } catch (error) {
    result = { ok: false, text: error instanceof Error ? error.message : "The write failed." };
  }
  const who = op.label || op.provider || "Agent";
  useAtlasStore.getState().appendVoiceLogEntry({
    role: result.ok ? "tool" : "error",
    title: `${who}: ${op.tool}`,
    text: `${result.text}\n${JSON.stringify(op.args, null, 2)}`,
    toolName: op.tool,
    toolCallId: op.id,
    status: result.ok ? "done" : "error",
    metadata: { agentRunId: op.runId, agentProvider: op.provider, agentLabel: op.label },
  });
  return result;
}

function apply(op: AtlasLinkOperation): Result {
  const state = useAtlasStore.getState();
  const args = op.args ?? {};
  const exists = (id: string) => Boolean(id) && findNode(useAtlasStore.getState().atlasRoot, id) !== null;
  switch (op.tool) {
    case "add_child_nodes": {
      const parentId = text(args.parentId);
      if (!exists(parentId)) return fail(`No card with id ${parentId}.`);
      const label = op.label || op.provider;
      const drafts = (Array.isArray(args.nodes) ? args.nodes : [])
        .filter(isRecord)
        .slice(0, 50)
        .map((node) => ({
          title: text(node.title),
          body: text(node.body),
          summary: text(node.summary),
          author: "ai" as const,
          tags: label ? [label] : [],
        }))
        .filter((node) => node.title || node.body || node.summary);
      if (!drafts.length) return fail("nodes must have a title or body.");
      const ids = state.addChildNodes(parentId, drafts, { focus: false });
      if (!ids.length) return fail("Mind Atlas could not add cards there.");
      return ok(`Created ${ids.length} card(s).`, { nodeIds: ids });
    }
    case "update_node_text": {
      const nodeId = text(args.nodeId);
      if (!exists(nodeId)) return fail(`No card with id ${nodeId}.`);
      state.updateNode(nodeId, textPatch(args));
      return ok("Updated.", { nodeId });
    }
    case "set_node_status": {
      const nodeId = text(args.nodeId);
      if (!exists(nodeId)) return fail(`No card with id ${nodeId}.`);
      const status = STATUSES.find((one) => one === args.status);
      if (!status) return fail(`status must be one of ${STATUSES.join(", ")}.`);
      state.setNodeStatus(nodeId, status, typeof args.nextDecision === "string" ? args.nextDecision : undefined);
      return ok(`Status set to ${status}.`, { nodeId });
    }
    case "delete_node": {
      const nodeId = text(args.nodeId);
      if (nodeId === state.atlasRoot.id) return fail("The notebook root cannot be deleted.");
      if (!exists(nodeId)) return fail(`No card with id ${nodeId}.`);
      state.deleteNode(nodeId);
      return ok("Deleted. The owner can undo this in Mind Atlas.", { nodeId });
    }
    case "move_nodes": {
      const moves = (Array.isArray(args.moves) ? args.moves : [])
        .filter(isRecord)
        .map((move) => ({
          nodeId: text(move.node_id),
          parentId: text(move.parent_id),
          index: typeof move.index === "number" && Number.isFinite(move.index) ? move.index : undefined,
        }))
        .filter((move) => move.nodeId && move.parentId)
        .slice(0, 100);
      if (!moves.length) return fail("moves must list node_id and parent_id.");
      const result = state.moveNodesToParents(moves);
      if (!result.moved.length) return fail(`Nothing was moved. ${result.failed.map((one) => `${one.nodeId}: ${one.reason}`).join(" ")}`);
      return ok(`Moved ${result.moved.length} card(s).`, { moved: result.moved, failed: result.failed });
    }
    case "bulk_update_nodes": {
      const updates = (Array.isArray(args.updates) ? args.updates : []).filter(isRecord).slice(0, 50);
      const updated: string[] = [];
      const failed: string[] = [];
      for (const update of updates) {
        const nodeId = text(update.nodeId);
        if (!exists(nodeId)) {
          failed.push(nodeId);
          continue;
        }
        const patch = textPatch(update);
        if (Object.values(patch).some((value) => value !== undefined)) useAtlasStore.getState().updateNode(nodeId, patch);
        const status = STATUSES.find((one) => one === update.status);
        if (status) useAtlasStore.getState().setNodeStatus(nodeId, status);
        updated.push(nodeId);
      }
      if (!updated.length) return fail("No card was updated.");
      return ok(`Updated ${updated.length} card(s).${failed.length ? ` ${failed.length} not found.` : ""}`, { updated, failed });
    }
    default:
      return fail(`Unknown write: ${op.tool}`);
  }
}

async function saveToCloud(): Promise<Result> {
  if (!cloudSaver) return fail("This Mind Atlas cannot save to the cloud store.");
  const name = await cloudSaver();
  return ok(`Saved to the cloud store as ${name}.`, { name });
}

function textPatch(args: Record<string, unknown>) {
  return {
    title: typeof args.title === "string" ? args.title : undefined,
    body: typeof args.body === "string" ? args.body : undefined,
    summary: typeof args.summary === "string" ? args.summary : undefined,
    nextDecision: typeof args.nextDecision === "string" ? args.nextDecision : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map((tag) => String(tag).trim()).filter(Boolean) : undefined,
  };
}

function findNode(node: AtlasNode, id: string): AtlasNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ok(message: string, data?: unknown): Result {
  return { ok: true, text: message, data };
}

function fail(message: string): Result {
  return { ok: false, text: message };
}

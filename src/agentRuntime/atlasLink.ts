import { completeAtlasLinkOperation, getAtlasLinkOperations, sendAtlasCopy, type AtlasLinkOperation } from "../ai/bridgeClient";
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
const POLL_MS = 2_000;
const STATUSES: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];

export function startAtlasLink(): () => void {
  let stopped = false;
  let copyTimer: number | null = null;
  let applying = false;

  const sendCopy = () => {
    copyTimer = null;
    const root = useAtlasStore.getState().atlasRoot;
    void sendAtlasCopy({ title: root.title, root: copyOf(root) }).catch(() => undefined);
  };
  const scheduleCopy = () => {
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(sendCopy, COPY_DELAY_MS);
  };
  const unsubscribe = useAtlasStore.subscribe((state, previous) => {
    if (state.atlasRoot !== previous.atlasRoot) scheduleCopy();
  });

  const poll = async () => {
    if (stopped || applying) return;
    applying = true;
    try {
      const ops = await getAtlasLinkOperations();
      for (const op of ops) {
        if (stopped) break;
        const result = applyAtlasOperation(op);
        await completeAtlasLinkOperation(op.id, result).catch(() => undefined);
      }
    } catch {
      // The bridge is not running; try again on the next tick.
    } finally {
      applying = false;
    }
  };

  sendCopy();
  void poll();
  const interval = window.setInterval(() => void poll(), POLL_MS);
  return () => {
    stopped = true;
    unsubscribe();
    window.clearInterval(interval);
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
export function applyAtlasOperation(op: AtlasLinkOperation): Result {
  let result: Result;
  try {
    result = apply(op);
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

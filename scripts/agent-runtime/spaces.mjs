// Spaces: notebooks the bridge keeps, one per project or person, beside the
// one open in the browser (OpenCEO ADR 0089).
//
// Mode: local-only. Spaces live in the bridge's cloud folder on this machine
// and never reach the public service.
//
// Each space is a JSON Mind Atlas package, `space-<root id>.mindatlaspkg`, in
// the same folder as cloud saves: the galaxy view shows every one of them and
// "load from cloud" opens any, with nothing new on the browser's side. Nobody
// owns a space exclusively: the owner and every agent may read and write any
// of them. A space not open in a browser is written here directly; the one
// open in a browser is written through the browser, as before.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILE = /^space-([A-Za-z0-9_-]{1,120})\.mindatlaspkg$/;
export const SPACE_KINDS = Object.freeze(["owner", "project", "employee", "other"]);
// As the browser and the tools have them (atlas-write-tools.mjs).
const STATUSES = ["running", "needs_review", "waiting", "blocked", "error", "done"];

/** The file a space with this root id is kept in. */
export function spaceFileName(rootId) {
  return `space-${String(rootId).replace(/[^A-Za-z0-9_-]/g, "_")}.mindatlaspkg`;
}

export class SpaceStore {
  /** @param {{ dir: string, now?: () => number }} options */
  constructor(options) {
    this.dir = options.dir;
    this.now = options.now ?? (() => Date.now());
  }

  /** Every space, newest first: id, title, kind, size, when it last changed. */
  async list() {
    await mkdir(this.dir, { recursive: true });
    const out = [];
    for (const name of await readdir(this.dir)) {
      if (!FILE.test(name)) continue;
      const space = await this.#read(join(this.dir, name));
      if (!space) continue;
      out.push({
        id: space.notebook.id,
        title: String(space.notebook.title ?? ""),
        kind: space.space?.kind ?? "other",
        nodeCount: countNodes(space.notebook),
        updatedAt: String(space.space?.updatedAt ?? space.exportedAt ?? ""),
      });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** A space's whole tree and what is known of it, or null. */
  async get(id) {
    const space = await this.#read(join(this.dir, spaceFileName(id)));
    return space ? { root: space.notebook, kind: space.space?.kind ?? "other", acceptedAt: String(space.space?.acceptedAt ?? "") } : null;
  }

  /** Finds a space by id, or else by its exact title. */
  async find(idOrTitle) {
    const key = String(idOrTitle ?? "").trim();
    if (!key) return null;
    const byId = await this.get(key);
    if (byId) return byId;
    const named = (await this.list()).find((one) => one.title === key);
    return named ? await this.get(named.id) : null;
  }

  /** A new, empty space. */
  async create({ title, kind = "other" }) {
    const name = String(title ?? "").trim().slice(0, 120);
    if (!name) throw new Error("A space needs a title.");
    const at = new Date(this.now()).toISOString();
    const root = {
      ...newNode({ title: name, body: "", author: "system" }, at),
      id: `space-root-${randomUUID()}`,
      kind: "root",
    };
    await this.save(root, { kind: SPACE_KINDS.includes(kind) ? kind : "other" });
    return { id: root.id, title: name, kind };
  }

  /** Keeps a space's tree; what is known of it is kept unless given anew. */
  async save(root, meta = {}) {
    if (!root || typeof root !== "object" || typeof root.id !== "string") throw new Error("A space needs a root node.");
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, spaceFileName(root.id));
    const before = await this.#read(file);
    const at = new Date(this.now()).toISOString();
    const manifest = {
      format: "mindatlaspkg",
      version: 1,
      exportedAt: at,
      notebook: root,
      assets: [],
      space: {
        kind: meta.kind ?? before?.space?.kind ?? "other",
        updatedAt: at,
        acceptedAt: meta.acceptedAt ?? before?.space?.acceptedAt ?? at,
      },
    };
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest), "utf8");
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        const retryable = error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
        if (!retryable || attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
      }
    }
  }

  async #read(file) {
    try {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      if (manifest?.format !== "mindatlaspkg" || !manifest.notebook?.id) return null;
      return manifest;
    } catch {
      return null;
    }
  }
}

// ------------------------------------------------- writing a tree directly

/** A node with the fields Mind Atlas fills in when it opens a notebook. */
function newNode(draft, at) {
  return {
    id: `node-agent-${randomUUID()}`,
    kind: "thread",
    nodeType: "note",
    title: String(draft.title ?? ""),
    subtitle: "",
    body: String(draft.body ?? ""),
    author: draft.author ?? "ai",
    status: STATUSES.includes(draft.status) ? draft.status : "waiting",
    color: "",
    summary: String(draft.summary ?? ""),
    nextDecision: String(draft.nextDecision ?? ""),
    tags: Array.isArray(draft.tags) ? draft.tags.map(String) : [],
    attachments: [],
    createdAt: at,
    updatedAt: at,
    children: [],
  };
}

function findNode(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(node, id) {
  for (const child of node.children ?? []) {
    if (child.id === id) return node;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

function countNodes(node) {
  if (!node || typeof node !== "object") return 0;
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

/** A copy of a branch with new ids, so it can live in another space. */
export function freshBranch(node, at) {
  return {
    ...node,
    id: `node-agent-${randomUUID()}`,
    attachments: [],
    updatedAt: at,
    children: (node.children ?? []).map((child) => freshBranch(child, at)),
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function patchOf(args) {
  const patch = {};
  for (const key of ["title", "body", "summary", "nextDecision"]) {
    if (typeof args[key] === "string") patch[key] = args[key];
  }
  if (Array.isArray(args.tags)) patch.tags = args.tags.map((tag) => String(tag).trim()).filter(Boolean);
  return patch;
}

/**
 * Applies one agent's write to a space's tree (changed in place), as the
 * browser applies it to the open notebook. Returns `{ ok, text, data? }`.
 */
export function applyToTree(root, tool, args = {}, label = "", now = () => Date.now()) {
  const at = new Date(now()).toISOString();
  const touch = (node) => {
    node.updatedAt = at;
  };
  switch (tool) {
    case "add_child_nodes": {
      const parent = findNode(root, text(args.parentId));
      if (!parent) return { ok: false, text: `No card with id ${text(args.parentId)}.` };
      const drafts = (Array.isArray(args.nodes) ? args.nodes : [])
        .filter((one) => one && typeof one === "object")
        .slice(0, 50)
        .map((one) => newNode({ title: text(one.title), body: text(one.body), summary: text(one.summary), tags: label ? [label] : [] }, at))
        .filter((one) => one.title || one.body || one.summary);
      if (!drafts.length) return { ok: false, text: "nodes must have a title or body." };
      parent.children = [...(parent.children ?? []), ...drafts];
      touch(parent);
      return { ok: true, text: `Created ${drafts.length} card(s).`, data: { nodeIds: drafts.map((one) => one.id) } };
    }
    case "insert_branch": {
      const parent = findNode(root, text(args.parentId));
      if (!parent) return { ok: false, text: `No card with id ${text(args.parentId)}.` };
      const branch = args.branch && typeof args.branch === "object" ? freshBranch(args.branch, at) : null;
      if (!branch) return { ok: false, text: "branch is required." };
      parent.children = [...(parent.children ?? []), branch];
      touch(parent);
      return { ok: true, text: "Moved in.", data: { nodeId: branch.id } };
    }
    case "update_node_text": {
      const node = findNode(root, text(args.nodeId));
      if (!node) return { ok: false, text: `No card with id ${text(args.nodeId)}.` };
      Object.assign(node, patchOf(args));
      touch(node);
      return { ok: true, text: "Updated.", data: { nodeId: node.id } };
    }
    case "set_node_status": {
      const node = findNode(root, text(args.nodeId));
      if (!node) return { ok: false, text: `No card with id ${text(args.nodeId)}.` };
      if (!STATUSES.includes(args.status)) return { ok: false, text: `status must be one of ${STATUSES.join(", ")}.` };
      node.status = args.status;
      if (typeof args.nextDecision === "string") node.nextDecision = args.nextDecision;
      touch(node);
      return { ok: true, text: `Status set to ${args.status}.`, data: { nodeId: node.id } };
    }
    case "delete_node": {
      const id = text(args.nodeId);
      if (id === root.id) return { ok: false, text: "The space's root cannot be deleted." };
      const parent = findParent(root, id);
      if (!parent) return { ok: false, text: `No card with id ${id}.` };
      parent.children = parent.children.filter((child) => child.id !== id);
      touch(parent);
      return { ok: true, text: "Deleted.", data: { nodeId: id } };
    }
    case "move_nodes": {
      const moved = [];
      const failed = [];
      for (const move of (Array.isArray(args.moves) ? args.moves : []).slice(0, 100)) {
        const nodeId = text(move?.node_id);
        const target = findNode(root, text(move?.parent_id));
        const parent = findParent(root, nodeId);
        const node = parent ? parent.children.find((child) => child.id === nodeId) : null;
        if (!node || !target || findNode(node, target.id)) {
          failed.push({ nodeId, reason: "not found, or into itself" });
          continue;
        }
        parent.children = parent.children.filter((child) => child.id !== nodeId);
        const index = typeof move.index === "number" ? Math.max(0, Math.min(target.children.length, move.index)) : target.children.length;
        target.children = [...target.children.slice(0, index), node, ...target.children.slice(index)];
        touch(target);
        moved.push(nodeId);
      }
      if (!moved.length) return { ok: false, text: `Nothing was moved. ${failed.map((one) => one.nodeId).join(" ")}` };
      return { ok: true, text: `Moved ${moved.length} card(s).`, data: { moved, failed } };
    }
    case "bulk_update_nodes": {
      const updated = [];
      const failed = [];
      for (const update of (Array.isArray(args.updates) ? args.updates : []).slice(0, 50)) {
        const node = findNode(root, text(update?.nodeId));
        if (!node) {
          failed.push(text(update?.nodeId));
          continue;
        }
        Object.assign(node, patchOf(update));
        if (STATUSES.includes(update.status)) node.status = update.status;
        touch(node);
        updated.push(node.id);
      }
      if (!updated.length) return { ok: false, text: "No card was updated." };
      return { ok: true, text: `Updated ${updated.length} card(s).`, data: { updated, failed } };
    }
    default:
      return { ok: false, text: `Unknown write: ${tool}` };
  }
}

/** A space's tree as agents read it: text, status and shape. */
export function readableCopy(node) {
  return {
    id: node.id,
    title: node.title ?? "",
    body: node.body ?? "",
    subtitle: node.subtitle ?? "",
    summary: node.summary ?? "",
    nextDecision: node.nextDecision ?? "",
    tags: node.tags ?? [],
    status: node.status ?? "waiting",
    nodeType: node.nodeType ?? "",
    author: node.author ?? "",
    attachmentCount: Array.isArray(node.attachments) ? node.attachments.length : 0,
    children: (node.children ?? []).map(readableCopy),
  };
}

export { findNode, findParent, countNodes };

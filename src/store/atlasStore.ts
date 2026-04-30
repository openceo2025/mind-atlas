import { create } from "zustand";
import { INITIAL_ATLAS_ZOOM } from "../config/view";
import { atlasRoot, initialWorkAreas } from "../data/atlas";
import type { AtlasEvent, AtlasNode, NodeAttachment, Selection, ViewportState, WorkArea } from "../types";

const NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v1";

interface FocusRequest {
  x: number;
  y: number;
  diameter: number;
  zoom?: number;
  nonce: number;
}

interface AtlasStore {
  atlasRoot: AtlasNode;
  workAreas: WorkArea[];
  selected: Selection;
  selectedNodeId: string;
  viewport: ViewportState;
  focusRequest: FocusRequest | null;
  attachmentPreviewUrls: Record<string, string>;
  selectNode: (id: string) => void;
  focusNode: (id: string) => void;
  focusParentNode: () => void;
  updateNode: (id: string, patch: Partial<Pick<AtlasNode, "title" | "body" | "tags" | "summary" | "nextDecision">>) => void;
  addChildNode: (parentId: string, initialBody?: string) => void;
  addSiblingNode: (id: string) => void;
  addAttachment: (nodeId: string, attachment: NodeAttachment, previewUrl?: string) => void;
  exportNotebook: () => string;
  importNotebook: (root: AtlasNode) => void;
  saveNotebook: () => void;
  selectWorkArea: (id: string) => void;
  selectEvent: (parentId: string, id: string) => void;
  selectArtifact: (parentId: string, id: string) => void;
  setViewport: (viewport: ViewportState) => void;
  focusWorkArea: (id: string) => void;
  focusPoint: (x: number, y: number, diameter: number) => void;
  focusParentLayer: () => void;
  appendInstruction: (workAreaId: string, content: string) => void;
}

export const useAtlasStore = create<AtlasStore>((set, get) => ({
  atlasRoot: loadStoredNotebook() ?? atlasRoot,
  workAreas: initialWorkAreas,
  selected: { kind: "workArea", id: "python-ui" },
  selectedNodeId: "python-ui",
  viewport: { x: 0, y: 0, zoom: 0.82 },
  focusRequest: null,
  attachmentPreviewUrls: {},

  selectNode: (id) => {
    const located = findNodeWithWorldPosition(get().atlasRoot, id);
    if (!located) return;
    const { node, position } = located;
    set((state) => ({
      selected: selectionFromNode(node),
      selectedNodeId: id,
      focusRequest: {
        x: position[0],
        y: position[1],
        diameter: node.radius * 2,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  focusNode: (id) => {
    const located = findNodeWithWorldPosition(get().atlasRoot, id);
    if (!located) return;
    const { node, position } = located;
    set((state) => ({
      selected: selectionFromNode(node),
      selectedNodeId: id,
      focusRequest: {
        x: position[0],
        y: position[1],
        diameter: node.radius * 2,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  focusParentNode: () => {
    const state = get();
    const path = findNodePath(state.atlasRoot, state.selectedNodeId);
    if (!path || path.length <= 2) {
      const atlasDiameter = 420;
      set((current) => ({
        selectedNodeId: "atlas-root",
        focusRequest: {
          x: 0,
          y: 0,
          diameter: atlasDiameter,
          zoom: INITIAL_ATLAS_ZOOM,
          nonce: (current.focusRequest?.nonce ?? 0) + 1,
        },
      }));
      return;
    }
    state.focusNode(path[path.length - 2].id);
  },

  updateNode: (id, patch) => {
    set((state) => {
      const current = findNode(state.atlasRoot, id);
      const nextTitle = patch.title ?? current?.title ?? "";
      const nextBody = patch.body ?? current?.body ?? "";
      const nextPatch = {
        ...patch,
        tags: normalizeTags(patch.tags ?? current?.tags ?? [], nextTitle, nextBody),
        updatedAt: new Date().toISOString(),
      };
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({ ...node, ...withoutUndefined(nextPatch) }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
  },

  addChildNode: (parentId, initialBody = "") => {
    const parent = findNode(get().atlasRoot, parentId);
    if (!parent) return;
    const child = createNotebookNode(parentId, parent.children.length, initialBody ? "New prompt" : "Child note", initialBody);
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, parentId, (node) => ({
        ...node,
        children: [...node.children, child],
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
    get().focusNode(child.id);
  },

  addSiblingNode: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length < 2) return;
    const parent = path[path.length - 2];
    const sibling = createNotebookNode(parent.id, parent.children.length, "Branch note");
    set((current) => {
      const atlasRoot = updateNodeById(current.atlasRoot, parent.id, (node) => ({
        ...node,
        children: [...node.children, sibling],
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
    get().focusNode(sibling.id);
  },

  addAttachment: (nodeId, attachment, previewUrl) => {
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, nodeId, (node) => ({
        ...node,
        attachments: [...node.attachments, attachment],
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return {
        atlasRoot,
        attachmentPreviewUrls: previewUrl
          ? { ...state.attachmentPreviewUrls, [attachment.id]: previewUrl }
          : state.attachmentPreviewUrls,
      };
    });
  },

  exportNotebook: () => JSON.stringify(get().atlasRoot, null, 2),

  importNotebook: (root) => {
    const atlasRoot = ensureNotebookNode(root);
    persistNotebook(atlasRoot);
    set({
      atlasRoot,
      selected: selectionFromNode(atlasRoot.children[0] ?? atlasRoot),
      selectedNodeId: atlasRoot.children[0]?.id ?? atlasRoot.id,
      attachmentPreviewUrls: {},
    });
  },

  saveNotebook: () => persistNotebook(get().atlasRoot),

  selectWorkArea: (id) => {
    const target = get().workAreas.find((area) => area.id === id);
    if (!target) {
      set({ selected: { kind: "workArea", id } });
      return;
    }
    const [x, y] = target.position;
    set((state) => ({
      selected: { kind: "workArea", id },
      selectedNodeId: id,
      focusRequest: {
        x,
        y,
        diameter: target.radius * 2,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },
  selectEvent: (parentId, id) => get().focusNode(id),
  selectArtifact: (parentId, id) => get().focusNode(id),
  setViewport: (viewport) => set({ viewport }),

  focusPoint: (x, y, diameter) => {
    set((state) => ({
      focusRequest: {
        x,
        y,
        diameter,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  focusWorkArea: (id) => {
    const target = get().workAreas.find((area) => area.id === id);
    if (!target) return;
    const [x, y] = target.position;
    set((state) => ({
      selected: { kind: "workArea", id },
      selectedNodeId: id,
      focusRequest: {
        x,
        y,
        diameter: target.radius * 2,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  focusParentLayer: () => {
    const state = get();

    if (state.selected.kind === "artifact" || state.selected.kind === "event" || state.selected.kind === "node") {
      state.focusParentNode();
      return;
    }

    const atlasDiameter = 420;
    set((current) => ({
      focusRequest: {
        x: 0,
        y: 0,
        diameter: atlasDiameter,
        zoom: INITIAL_ATLAS_ZOOM,
        nonce: (current.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  appendInstruction: (workAreaId, content) => {
    const newEvent: AtlasEvent = {
      id: `${workAreaId}-human-${Date.now()}`,
      type: "message",
      actor: "human",
      content,
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      labels: ["follow-up"],
    };

    set((state) => ({
      selected: { kind: "workArea", id: workAreaId },
      workAreas: state.workAreas.map((area) =>
        area.id === workAreaId
          ? {
              ...area,
              status: "running",
              events: [...area.events, newEvent],
              summary:
                "A new human instruction was attached in spatial context. The work area is now waiting for the next agent result.",
              nextDecision: "Wait for the agent response, then inspect the updated artifact from this location.",
            }
          : area,
      ),
    }));
    get().addChildNode(get().selectedNodeId, content);
  },
}));

export function getSelectionWorkArea(workAreas: WorkArea[], selected: Selection): WorkArea {
  const id = selected.kind === "workArea" ? selected.id : selected.kind === "node" ? selected.id : selected.parentId;
  return workAreas.find((area) => area.id === id) ?? workAreas[0];
}

export function findNodePath(root: AtlasNode, id: string): AtlasNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const result = findNodePath(child, id);
    if (result) return [root, ...result];
  }
  return null;
}

export function findNode(root: AtlasNode, id: string): AtlasNode | undefined {
  return findNodePath(root, id)?.at(-1);
}

export function getNodeWorldPosition(path: AtlasNode[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let depth = 1; depth < path.length; depth += 1) {
    const node = path[depth];
    const parent = path[depth - 1];
    if (node.position) {
      x += node.position[0];
      y += node.position[1];
      z += node.position[2];
      continue;
    }

    const siblings = parent.children;
    const index = Math.max(0, siblings.findIndex((item) => item.id === node.id));
    const angle = (Math.PI * 2 * index) / Math.max(siblings.length, 1) - Math.PI / 4 + depth * 0.23;
    const orbit = parent.radius * (depth <= 2 ? 2.08 : 2.32);
    x += Math.cos(angle) * orbit;
    y += Math.sin(angle) * orbit;
    z += 5;
  }

  return [x, y, z];
}

export function findNodeWithWorldPosition(root: AtlasNode, id: string) {
  const path = findNodePath(root, id);
  if (!path) return undefined;
  return { node: path[path.length - 1], path, position: getNodeWorldPosition(path) };
}

function selectionFromNode(node: AtlasNode): Selection {
  if (node.kind === "workArea") return { kind: "workArea", id: node.id };
  if (node.kind === "artifact" && node.sourceParentId) return { kind: "artifact", parentId: node.sourceParentId, id: node.id };
  if (node.kind === "event" && node.sourceParentId) return { kind: "event", parentId: node.sourceParentId, id: node.id };
  return { kind: "node", id: node.id };
}

function loadStoredNotebook() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(NOTEBOOK_STORAGE_KEY);
  if (!raw) return null;
  try {
    return ensureNotebookNode(JSON.parse(raw) as AtlasNode);
  } catch {
    return null;
  }
}

function persistNotebook(root: AtlasNode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(root));
}

function updateNodeById(root: AtlasNode, id: string, updater: (node: AtlasNode) => AtlasNode): AtlasNode {
  if (root.id === id) return updater(root);
  return {
    ...root,
    children: root.children.map((child) => updateNodeById(child, id, updater)),
  };
}

function createNotebookNode(parentId: string, index: number, title: string, body = ""): AtlasNode {
  const now = new Date().toISOString();
  return {
    id: `${parentId}-node-${Date.now()}-${index}`,
    kind: "thread",
    nodeType: "human_prompt",
    title,
    subtitle: "human prompt",
    body,
    author: "human",
    status: "waiting",
    color: "#f5df80",
    radius: 3.8,
    summary: body.split("\n").find(Boolean) ?? "A human-authored notebook node.",
    nextDecision: "Edit this node or branch from it.",
    tags: normalizeTags([], title, body),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    children: [],
  };
}

function normalizeTags(tags: string[], ...textParts: string[]) {
  const values = new Set<string>();
  for (const tag of tags) {
    const cleaned = tag.replace(/^#/, "").trim().toLowerCase();
    if (cleaned) values.add(cleaned);
  }
  for (const part of textParts) {
    const matches = part.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
    for (const match of matches) values.add(match.slice(1).toLowerCase());
  }
  return Array.from(values);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function ensureNotebookNode(node: AtlasNode): AtlasNode {
  const now = new Date().toISOString();
  return {
    ...node,
    nodeType: node.nodeType ?? "note",
    body: node.body ?? node.summary ?? "",
    author: node.author ?? "human",
    tags: node.tags ?? [],
    attachments: node.attachments ?? [],
    createdAt: node.createdAt ?? now,
    updatedAt: node.updatedAt ?? now,
    children: (node.children ?? []).map(ensureNotebookNode),
  };
}

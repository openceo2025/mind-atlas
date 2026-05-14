import { create } from "zustand";
import {
  clearStoredAttachmentBlobs,
  createStoredAttachmentPreviewUrls,
  deleteStoredAttachmentBlob,
  deleteStoredAttachmentBlobs,
} from "../attachmentStorage";
import { planetColorForSeed, planetTextureForSeed } from "../config/planetTheme";
import { atlasRoot, initialWorkAreas } from "../data/atlas";
import { requestAiResponse } from "../ai/bridgeClient";
import type {
  AiContextScope,
  AiContextStats,
  AiExecutionMode,
  AiGeneratedOutput,
  AiNodeContext,
  AiNodeSnapshot,
  AiProvider,
  AiRun,
  AiUsage,
  AtlasEvent,
  AtlasNode,
  NotificationPulse,
  NotificationPulseKind,
  NodeAttachment,
  Selection,
  ViewportState,
  WorkArea,
  WorkStatus,
} from "../types";

const NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v2";
export const NOTEBOOK_NODE_RADIUS = 28;
export const NOTEBOOK_FIRST_SHELL_RADIUS = 360;
export const NOTEBOOK_SHELL_GAP = 340;
export const TOP_LEVEL_PLANAR_LIMIT = 0.5;
export const TOP_LEVEL_DRAG_PLANAR_LIMIT = Math.min(1, TOP_LEVEL_PLANAR_LIMIT * 2);
const FOCUSED_NODE_CAMERA_DISTANCE = 300;
const MIN_CHILD_SCREEN_SEPARATION_RADII = 3.4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const NOTIFICATION_PULSE_DURATION_MS = 8200;
const NOTIFICATION_REPEAT_INTERVAL_MS = 3600;

interface UnreadNotification {
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
  lastPulseAt: number;
}

interface FocusRequest {
  x: number;
  y: number;
  z: number;
  diameter: number;
  nonce: number;
}

interface AtlasStore {
  atlasRoot: AtlasNode;
  workAreas: WorkArea[];
  aiRuns: Record<string, AiRun>;
  notificationPulses: NotificationPulse[];
  unreadNotifications: Record<string, UnreadNotification>;
  selected: Selection;
  selectedNodeId: string;
  viewport: ViewportState;
  focusRequest: FocusRequest | null;
  attachmentPreviewUrls: Record<string, string>;
  birthMarks: Record<string, number>;
  titleEditRequestId: string | null;
  selectNode: (id: string) => void;
  selectNodeInPlace: (id: string) => void;
  focusNode: (id: string) => void;
  focusParentNode: () => void;
  updateNode: (id: string, patch: Partial<Pick<AtlasNode, "title" | "body" | "tags" | "summary" | "nextDecision">>) => void;
  setNodeStatus: (id: string, status: WorkStatus, nextDecision?: string) => void;
  addRootNodeAt: (position: [number, number, number], title?: string) => void;
  addChildNode: (
    parentId: string,
    initialBody?: string,
    options?: { title?: string; position?: [number, number, number]; insertIndex?: number; focus?: boolean; persist?: boolean },
  ) => string | undefined;
  addSiblingNode: (id: string) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, worldPosition: [number, number, number]) => void;
  addAttachment: (nodeId: string, attachment: NodeAttachment, previewUrl?: string) => void;
  removeAttachment: (nodeId: string, attachmentId: string) => void;
  updateNodeAppearance: (id: string, patch: Pick<Partial<AtlasNode>, "color" | "texture">) => void;
  consumeTitleEditRequest: () => void;
  restoreAttachmentPreviews: () => Promise<void>;
  exportNotebook: () => string;
  importNotebook: (root: AtlasNode, datasetName?: string, attachmentPreviewUrls?: Record<string, string>) => void;
  resetNotebook: () => void;
  saveNotebook: () => void;
  selectWorkArea: (id: string) => void;
  selectEvent: (parentId: string, id: string) => void;
  selectArtifact: (parentId: string, id: string) => void;
  setViewport: (viewport: ViewportState) => void;
  focusWorkArea: (id: string) => void;
  focusPoint: (x: number, y: number, diameter: number) => void;
  focusParentLayer: () => void;
  appendInstruction: (workAreaId: string, content: string) => void;
  addQuickChildFromInput: (prompt: string) => string | undefined;
  runAiOnSelectedNode: (prompt: string, mode: AiExecutionMode, scope?: AiContextScope) => Promise<void>;
  tickNotificationPulses: () => void;
}

export const useAtlasStore = create<AtlasStore>((set, get) => ({
  atlasRoot: loadStoredNotebook() ?? atlasRoot,
  workAreas: initialWorkAreas,
  aiRuns: {},
  notificationPulses: [],
  unreadNotifications: {},
  selected: { kind: "node", id: "atlas-root" },
  selectedNodeId: "atlas-root",
  viewport: { x: 0, y: 0, zoom: 0.92 },
  focusRequest: null,
  attachmentPreviewUrls: {},
  birthMarks: {},
  titleEditRequestId: null,

  selectNode: (id) => {
    const located = findNodeWithWorldPosition(get().atlasRoot, id);
    if (!located) return;
    const { node, path, position } = located;
    const visualRadius = getNodeVisualRadius(node, path.length - 1);
    set((state) => {
      const unreadNotifications = { ...state.unreadNotifications };
      delete unreadNotifications[id];
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        unreadNotifications,
        focusRequest: {
          x: position[0],
          y: position[1],
          z: position[2],
          diameter: visualRadius * 2,
          nonce: (state.focusRequest?.nonce ?? 0) + 1,
        },
      };
    });
  },

  selectNodeInPlace: (id) => {
    const node = findNode(get().atlasRoot, id);
    if (!node) return;
    set((state) => {
      const unreadNotifications = { ...state.unreadNotifications };
      delete unreadNotifications[id];
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        unreadNotifications,
      };
    });
  },

  focusNode: (id) => {
    const located = findNodeWithWorldPosition(get().atlasRoot, id);
    if (!located) return;
    const { node, path, position } = located;
    const visualRadius = getNodeVisualRadius(node, path.length - 1);
    set((state) => {
      const unreadNotifications = { ...state.unreadNotifications };
      delete unreadNotifications[id];
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        unreadNotifications,
        focusRequest: {
          x: position[0],
          y: position[1],
          z: position[2],
          diameter: visualRadius * 2,
          nonce: (state.focusRequest?.nonce ?? 0) + 1,
        },
      };
    });
  },

  focusParentNode: () => {
    const state = get();
    const path = findNodePath(state.atlasRoot, state.selectedNodeId);
    if (!path || path.length <= 2) {
      const atlasDiameter = 420;
      set((current) => ({
        selected: { kind: "node", id: "atlas-root" },
        selectedNodeId: "atlas-root",
        focusRequest: {
          x: 0,
          y: 0,
          z: 0,
          diameter: atlasDiameter,
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
        tags: normalizeTags(patch.tags ?? current?.tags ?? [], nextTitle, nextBody, patch.summary ?? current?.summary ?? ""),
        updatedAt: new Date().toISOString(),
      };
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({ ...node, ...withoutUndefined(nextPatch) }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
  },

  setNodeStatus: (id, status, nextDecision) => {
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({
        ...node,
        status,
        ...(nextDecision ? { nextDecision } : {}),
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
  },

  addRootNodeAt: (position, title = "Untitled planet") => {
    const child = createNotebookNode("atlas-root", get().atlasRoot.children.length, title, "", {
      position: clampDirection(position, TOP_LEVEL_DRAG_PLANAR_LIMIT),
    });
    set((state) => {
      const atlasRoot = {
        ...state.atlasRoot,
        children: [...state.atlasRoot.children, child],
        updatedAt: new Date().toISOString(),
      };
      persistNotebook(atlasRoot);
      return {
        atlasRoot,
        birthMarks: { ...state.birthMarks, [child.id]: performance.now() },
        titleEditRequestId: child.id,
      };
    });
    get().focusNode(child.id);
  },

  addChildNode: (parentId, initialBody = "", options = {}) => {
    const parent = findNode(get().atlasRoot, parentId);
    if (!parent) return;
    const parentPath = findNodePath(get().atlasRoot, parentId);
    const childDepth = parentPath?.length ?? 1;
    const insertIndex = typeof options.insertIndex === "number" ? options.insertIndex : parent.children.length;
    const childPosition = options.position
      ? getStoredPositionForWorldDirection(parentPath ?? [get().atlasRoot], options.position, childDepth, parent.children.length + 1)
      : getPhyllotaxisStoredChildPosition(childDepth, parent.children.length + 1, insertIndex, parent.id);
    const child = createNotebookNode(
      parentId,
      parent.children.length,
      options.title ?? (initialBody ? titleFromBody(initialBody) : "Untitled moon"),
      initialBody,
      { position: childPosition },
    );
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, parentId, (node) => ({
        ...node,
        children:
          typeof options.insertIndex === "number"
            ? insertAt(node.children, options.insertIndex, child)
            : [...node.children, child],
        updatedAt: new Date().toISOString(),
      }));
      if (options.persist !== false) {
        persistNotebook(atlasRoot);
      }
      return {
        atlasRoot,
        birthMarks: { ...state.birthMarks, [child.id]: performance.now() },
        titleEditRequestId: options.focus === false ? state.titleEditRequestId : child.id,
      };
    });
    if (options.focus !== false) {
      get().focusNode(child.id);
    }
    return child.id;
  },

  addSiblingNode: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length < 2) return;
    const parent = path[path.length - 2];
    const source = path[path.length - 1];
    const siblingDepth = path.length - 1;
    const siblingPosition =
      source.position && siblingDepth > 1
        ? clampLocalOffset(
            [source.position[0] + 0.08, source.position[1] + 0.02, 0],
            getManualChildSpreadLimit(siblingDepth, parent.children.length + 1),
          )
        : source.position
          ? clampDirection([source.position[0] + 0.08, source.position[1] + 0.02, source.position[2]], TOP_LEVEL_PLANAR_LIMIT)
          : undefined;
    const sibling = createNotebookNode(parent.id, parent.children.length, "Untitled branch", "", {
      position: siblingPosition,
    });
    set((current) => {
      const atlasRoot = updateNodeById(current.atlasRoot, parent.id, (node) => ({
        ...node,
        children: [...node.children, sibling],
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return {
        atlasRoot,
        birthMarks: { ...current.birthMarks, [sibling.id]: performance.now() },
        titleEditRequestId: sibling.id,
      };
    });
    get().focusNode(sibling.id);
  },

  deleteNode: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length <= 1) return;

    const deletedNode = path[path.length - 1];
    const parentNode = path[path.length - 2];
    const deletedNodeIds = collectNodeIds(deletedNode);
    const deletedAttachmentIds = collectAttachmentIds(deletedNode);
    const nextRoot = clearResolvedPropagatedErrors(removeNodeById(state.atlasRoot, id));
    const parentLocation = findNodeWithWorldPosition(nextRoot, parentNode.id);
    const nextSelectedNode = parentLocation?.node ?? nextRoot;
    const nextPosition = parentLocation?.position ?? [0, 0, 0];
    const nextDepth = Math.max(0, (parentLocation?.path.length ?? 1) - 1);
    const nextDiameter = getNodeVisualRadius(nextSelectedNode, nextDepth) * 2;
    const attachmentPreviewUrls = { ...state.attachmentPreviewUrls };
    const birthMarks = { ...state.birthMarks };
    const unreadNotifications = { ...state.unreadNotifications };

    for (const attachmentId of deletedAttachmentIds) {
      const previewUrl = attachmentPreviewUrls[attachmentId];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      delete attachmentPreviewUrls[attachmentId];
    }
    void deleteStoredAttachmentBlobs(deletedAttachmentIds).catch((error) => {
      console.error("Failed to remove stored attachment blobs", error);
    });
    for (const nodeId of deletedNodeIds) {
      delete birthMarks[nodeId];
      delete unreadNotifications[nodeId];
    }

    persistNotebook(nextRoot);
    set((current) => ({
      atlasRoot: nextRoot,
      selected: selectionFromNode(nextSelectedNode),
      selectedNodeId: nextSelectedNode.id,
      attachmentPreviewUrls,
      birthMarks,
      unreadNotifications,
      notificationPulses: current.notificationPulses.filter((pulse) => !deletedNodeIds.includes(pulse.nodeId)),
      titleEditRequestId: current.titleEditRequestId && deletedNodeIds.includes(current.titleEditRequestId) ? null : current.titleEditRequestId,
      focusRequest: {
        x: nextPosition[0],
        y: nextPosition[1],
        z: nextPosition[2],
        diameter: Math.max(nextDiameter, 120),
        nonce: (current.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  moveNode: (id, worldPosition) => {
    if (id === "atlas-root") return;
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length < 2) return;
    const depth = path.length - 1;
    const parentPath = path.slice(0, -1);
    const parent = parentPath[parentPath.length - 1];
    const layerDirection = getStoredPositionForWorldDirection(parentPath, worldPosition, depth, parent.children.length);
    set((current) => {
      const atlasRoot = updateNodeById(current.atlasRoot, id, (node) => ({
        ...node,
        position: layerDirection,
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
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

  removeAttachment: (nodeId, attachmentId) => {
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, nodeId, (node) => ({
        ...node,
        attachments: node.attachments.filter((attachment) => attachment.id !== attachmentId),
        updatedAt: new Date().toISOString(),
      }));
      const attachmentPreviewUrls = { ...state.attachmentPreviewUrls };
      const previewUrl = attachmentPreviewUrls[attachmentId];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      delete attachmentPreviewUrls[attachmentId];
      void deleteStoredAttachmentBlob(attachmentId).catch((error) => {
        console.error("Failed to remove stored attachment blob", error);
      });
      persistNotebook(atlasRoot);
      return { atlasRoot, attachmentPreviewUrls };
    });
  },

  updateNodeAppearance: (id, patch) => {
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({
        ...node,
        ...patch,
        updatedAt: new Date().toISOString(),
      }));
      persistNotebook(atlasRoot);
      return { atlasRoot };
    });
  },

  consumeTitleEditRequest: () => set({ titleEditRequestId: null }),

  restoreAttachmentPreviews: async () => {
    const previewUrls = await createStoredAttachmentPreviewUrls(get().atlasRoot);
    set((state) => {
      const currentAttachmentIds = new Set(collectAttachmentIds(state.atlasRoot));
      const nextPreviewUrls = { ...state.attachmentPreviewUrls };

      for (const [attachmentId, previewUrl] of Object.entries(previewUrls)) {
        if (!currentAttachmentIds.has(attachmentId) || nextPreviewUrls[attachmentId]) {
          URL.revokeObjectURL(previewUrl);
          continue;
        }
        nextPreviewUrls[attachmentId] = previewUrl;
      }

      return { attachmentPreviewUrls: nextPreviewUrls };
    });
  },

  exportNotebook: () => JSON.stringify(get().atlasRoot, null, 2),

  importNotebook: (root, datasetName, nextAttachmentPreviewUrls = {}) => {
    Object.values(get().attachmentPreviewUrls).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    const atlasRoot = {
      ...ensureNotebookNode(root),
      ...(datasetName ? { title: datasetName, subtitle: datasetName, updatedAt: new Date().toISOString() } : {}),
    };
    persistNotebook(atlasRoot);
    set({
      atlasRoot,
      selected: selectionFromNode(atlasRoot.children[0] ?? atlasRoot),
      selectedNodeId: atlasRoot.children[0]?.id ?? atlasRoot.id,
      attachmentPreviewUrls: nextAttachmentPreviewUrls,
      birthMarks: {},
      titleEditRequestId: atlasRoot.children[0]?.id ?? null,
    });
  },

  resetNotebook: () => {
    const atlasRoot = createInitialNotebook();
    const previewUrls = get().attachmentPreviewUrls;
    Object.values(previewUrls).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    void clearStoredAttachmentBlobs().catch((error) => {
      console.error("Failed to clear stored attachment blobs", error);
    });
    clearStoredNotebook();
    set((state) => ({
      atlasRoot,
      selected: { kind: "node", id: atlasRoot.id },
      selectedNodeId: atlasRoot.id,
      focusRequest: {
        x: 0,
        y: 0,
        z: 0,
        diameter: 420,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
      attachmentPreviewUrls: {},
      birthMarks: {},
      titleEditRequestId: null,
    }));
  },

  saveNotebook: () => persistNotebook(get().atlasRoot),

  selectWorkArea: (id) => {
    get().focusNode(id);
  },
  selectEvent: (parentId, id) => get().focusNode(id),
  selectArtifact: (parentId, id) => get().focusNode(id),
  setViewport: (viewport) => set({ viewport }),

  focusPoint: (x, y, diameter) => {
    set((state) => ({
      focusRequest: {
        x,
        y,
        z: 0,
        diameter,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  focusWorkArea: (id) => {
    get().focusNode(id);
  },

  focusParentLayer: () => {
    const state = get();

    if (findNodePath(state.atlasRoot, state.selectedNodeId)) {
      state.focusParentNode();
      return;
    }

    const atlasDiameter = 420;
    set((current) => ({
      focusRequest: {
        x: 0,
        y: 0,
        z: 0,
        diameter: atlasDiameter,
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

  addQuickChildFromInput: (prompt) => {
    const trimmed = prompt.trim();
    if (!trimmed) return undefined;
    return get().addChildNode(get().selectedNodeId, trimmed, {
      title: titleFromBody(trimmed),
      focus: false,
    });
  },

  runAiOnSelectedNode: async (prompt, mode, scope = "focused") => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const startedAt = new Date().toISOString();
    const runId = `ai-run-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const state = get();
    const sourceNodeId = state.selectedNodeId;
    const context = buildAiNodeContext(state.atlasRoot, sourceNodeId, scope);
    if (!context) return;
    const sourcePath = findNodePath(state.atlasRoot, sourceNodeId);
    if (!sourcePath) return;
    const sourceParent = sourcePath?.at(-1);
    if (!sourceParent) return;
    const requestPosition = getPhyllotaxisStoredChildPosition(
      sourcePath.length,
      sourceParent.children.length + 1,
      sourceParent.children.length,
      sourceParent.id,
    );
    const requestNode = createAiRequestNode(sourceNodeId, sourceParent.children.length, runId, mode, trimmed, {
      position: requestPosition,
    });

    const initialRun: AiRun = {
      id: runId,
      nodeId: sourceNodeId,
      requestNodeId: requestNode.id,
      provider: providerForMode(mode),
      mode,
      modelId: "",
      status: "running",
      prompt: trimmed,
      startedAt,
      contextStats: context.stats,
    };

    set((current) => {
      const atlasRoot = updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
        ...node,
        status: "running",
        nextDecision: `${modeLabel(mode)} is reading this node and preparing a child result.`,
        updatedAt: new Date().toISOString(),
        children: [...node.children, requestNode],
      }));
      persistNotebook(atlasRoot);
      return {
        atlasRoot,
        birthMarks: { ...current.birthMarks, [requestNode.id]: performance.now() },
        aiRuns: { ...current.aiRuns, [runId]: initialRun },
      };
    });

    try {
      const result = await requestAiResponse({ prompt: trimmed, context, provider: mode });
      let responseNodeId = "";
      set((current) => {
        const parent = findNode(current.atlasRoot, requestNode.id);
        if (!parent) return current;
        const completedAt = new Date().toISOString();
        const child = createAiResponseNode(
          requestNode.id,
          parent.children.length,
          runId,
          result.provider,
          mode,
          result.model,
          result.output,
          result.usage,
          {
            position: getPhyllotaxisStoredChildPosition(sourcePath.length + 1, parent.children.length + 1, parent.children.length, parent.id),
          },
        );
        responseNodeId = child.id;
        const atlasRoot = updateNodeById(
          updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
            ...node,
            status: result.output.suggestedStatus === "done" ? "needs_review" : result.output.suggestedStatus,
            nextDecision: "Review the child AI request branch.",
            updatedAt: completedAt,
          })),
          requestNode.id,
          (node) => ({
          ...node,
          status: result.output.suggestedStatus === "done" ? "needs_review" : result.output.suggestedStatus,
          nextDecision: "Review the AI result, then keep, edit, or branch from it.",
          updatedAt: completedAt,
          children: [...node.children, child],
          }),
        );
        persistNotebook(atlasRoot);
        return {
          atlasRoot,
          birthMarks: { ...current.birthMarks, [child.id]: performance.now() },
          notificationPulses: [
            ...current.notificationPulses,
            createNotificationPulse(child.id, mode === "codex" ? "codex" : "needs_review", `${modeLabel(mode)} result ready`),
          ],
          unreadNotifications: markUnreadNotification(
            current.unreadNotifications,
            child.id,
            mode === "codex" ? "codex" : "needs_review",
            `${modeLabel(mode)} result ready`,
          ),
          aiRuns: {
            ...current.aiRuns,
            [runId]: {
              ...initialRun,
              provider: result.provider,
              modelId: result.model,
              status: "needs_review",
              completedAt,
              responseNodeId,
              usage: result.usage,
            },
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed.";
      set((current) => {
        const completedAt = new Date().toISOString();
        const parent = findNode(current.atlasRoot, requestNode.id);
        const errorNode = createAiErrorNode(requestNode.id, runId, mode, message, {
          position: getPhyllotaxisStoredChildPosition(
            sourcePath.length + 1,
            (parent?.children.length ?? 0) + 1,
            parent?.children.length ?? 0,
            requestNode.id,
          ),
        });
        const atlasRoot = updateNodeById(
          updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
            ...node,
            status: "error",
            nextDecision: message,
            updatedAt: completedAt,
          })),
          requestNode.id,
          (node) => ({
          ...node,
          status: "error",
          nextDecision: message,
          updatedAt: completedAt,
          children: [...node.children, errorNode],
          }),
        );
        persistNotebook(atlasRoot);
        return {
          atlasRoot,
          birthMarks: { ...current.birthMarks, [errorNode.id]: performance.now() },
          notificationPulses: [...current.notificationPulses, createNotificationPulse(errorNode.id, "error", `${modeLabel(mode)} failed`)],
          unreadNotifications: markUnreadNotification(
            current.unreadNotifications,
            errorNode.id,
            "error",
            `${modeLabel(mode)} failed`,
          ),
          aiRuns: {
            ...current.aiRuns,
            [runId]: {
              ...initialRun,
              status: "error",
              completedAt,
              error: message,
              responseNodeId: errorNode.id,
            },
          },
        };
      });
    }
  },

  tickNotificationPulses: () => {
    const now = performance.now();
    const cutoff = now - NOTIFICATION_PULSE_DURATION_MS - 420;
    set((state) => {
      const notificationPulses = state.notificationPulses.filter((pulse) => pulse.createdAt >= cutoff);
      const unreadNotifications = { ...state.unreadNotifications };
      for (const unread of Object.values(unreadNotifications)) {
        if (now - unread.lastPulseAt < NOTIFICATION_REPEAT_INTERVAL_MS) continue;
        notificationPulses.push(createNotificationPulse(unread.nodeId, unread.kind, unread.title));
        unreadNotifications[unread.nodeId] = { ...unread, lastPulseAt: now };
      }
      return { notificationPulses, unreadNotifications };
    });
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

export function buildAiNodeContext(root: AtlasNode, selectedNodeId: string, scope: AiContextScope = "focused"): AiNodeContext | null {
  const path = findNodePath(root, selectedNodeId);
  if (!path) return null;
  const selectedNode = path[path.length - 1];
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const selectedDepth = getSelectedSnapshotDepth(scope);
  const siblingDepth = scope === "neighborhood" ? 1 : 0;
  const includeSiblings = scope === "neighborhood";
  const selectedSnapshot = nodeToAiSnapshot(selectedNode, selectedDepth);
  const pathSnapshots = scope === "minimal" ? path.slice(-1).map((node) => nodeToAiSnapshot(node, 0)) : path.map((node) => nodeToAiSnapshot(node, 0));
  const siblingSnapshots =
    parent && includeSiblings ? parent.children.filter((node) => node.id !== selectedNode.id).map((node) => nodeToAiSnapshot(node, siblingDepth)) : [];
  const stats = buildAiContextStats(scope, selectedSnapshot, pathSnapshots, siblingSnapshots);
  return {
    selectedNode: selectedSnapshot,
    path: pathSnapshots,
    siblingNodes: siblingSnapshots,
    descendantCount: countDescendants(selectedNode),
    scope,
    stats,
    exportedAt: new Date().toISOString(),
  };
}

export function estimateAiNodeContext(root: AtlasNode, selectedNodeId: string, scope: AiContextScope = "focused"): AiContextStats | null {
  return buildAiNodeContext(root, selectedNodeId, scope)?.stats ?? null;
}

export function getNodeWorldPosition(path: AtlasNode[]): [number, number, number] {
  if (path.length <= 1) return [0, 0, 0];

  let world: Vec3 = [0, 0, 0];
  let direction: Vec3 = [0, 0, 1];
  for (let depth = 1; depth < path.length; depth += 1) {
    const node = path[depth];
    const parent = path[depth - 1];
    const siblings = parent.children;
    const index = Math.max(0, siblings.findIndex((item) => item.id === node.id));

    if (node.position) {
      direction =
        depth === 1
          ? clampDirection(node.position, TOP_LEVEL_DRAG_PLANAR_LIMIT)
          : directionFromStoredChildPosition(direction, node.position, depth, siblings.length);
      world = scale(direction, getShellRadius(depth));
      continue;
    }

    if (depth === 1) {
      direction = topLevelDirection(index, siblings.length);
      world = scale(direction, getShellRadius(depth));
      continue;
    }

    const angle = (Math.PI * 2 * index) / Math.max(siblings.length, 1) + depth * 0.37;
    const spread = getChildSpread(depth, siblings.length);
    direction = childDirection(direction, angle, spread);
    world = scale(direction, getShellRadius(depth));
  }

  return world;
}

export function getNodeVisualRadius(node: Pick<AtlasNode, "kind" | "radius">, depth = 1) {
  if (node.kind === "root") return node.radius;
  return NOTEBOOK_NODE_RADIUS;
}

export function getNodeHitRadius(node: Pick<AtlasNode, "kind" | "radius">, depth = 1) {
  if (node.kind === "root") return node.radius;
  return getNodeVisualRadius(node, depth);
}

export function getShellRadius(depth: number) {
  if (depth <= 1) return NOTEBOOK_FIRST_SHELL_RADIUS;
  return NOTEBOOK_FIRST_SHELL_RADIUS + NOTEBOOK_SHELL_GAP * (depth - 1);
}

export function getPlanarLimitForDepth(depth: number) {
  return depth <= 1 ? TOP_LEVEL_DRAG_PLANAR_LIMIT : TOP_LEVEL_PLANAR_LIMIT;
}

export function getManualChildSpreadLimit(depth: number, siblingCount: number) {
  if (depth <= 1) return Math.asin(TOP_LEVEL_PLANAR_LIMIT);
  return getChildSpread(depth, siblingCount);
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

function createInitialNotebook() {
  return ensureNotebookNode(JSON.parse(JSON.stringify(atlasRoot)) as AtlasNode);
}

function persistNotebook(root: AtlasNode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(root));
}

function clearStoredNotebook() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(NOTEBOOK_STORAGE_KEY);
}

function updateNodeById(root: AtlasNode, id: string, updater: (node: AtlasNode) => AtlasNode): AtlasNode {
  if (root.id === id) return updater(root);
  return {
    ...root,
    children: root.children.map((child) => updateNodeById(child, id, updater)),
  };
}

function removeNodeById(root: AtlasNode, id: string, updatedAt = new Date().toISOString()): AtlasNode {
  let changed = false;
  const children = root.children.flatMap((child) => {
    if (child.id === id) {
      changed = true;
      return [];
    }
    const nextChild = removeNodeById(child, id, updatedAt);
    if (nextChild !== child) changed = true;
    return [nextChild];
  });

  return changed ? { ...root, updatedAt, children } : root;
}

function clearResolvedPropagatedErrors(node: AtlasNode): AtlasNode {
  const children = node.children.map((child) => clearResolvedPropagatedErrors(child));
  const nextNode = children === node.children ? node : { ...node, children };
  if (nextNode.status !== "error" || isIntrinsicErrorNode(nextNode) || hasIntrinsicErrorDescendant(nextNode)) {
    return nextNode;
  }
  return {
    ...nextNode,
    status: "needs_review",
    nextDecision: "Review the remaining branch.",
    updatedAt: new Date().toISOString(),
  };
}

function hasIntrinsicErrorDescendant(node: AtlasNode): boolean {
  return node.children.some((child) => isIntrinsicErrorNode(child) || hasIntrinsicErrorDescendant(child));
}

function isIntrinsicErrorNode(node: AtlasNode) {
  return (
    node.status === "error" &&
    (node.nodeType === "tool_result" || node.kind === "event" || node.author === "system" || node.tags.includes("error"))
  );
}

function collectNodeIds(node: AtlasNode): string[] {
  return [node.id, ...node.children.flatMap((child) => collectNodeIds(child))];
}

function collectAttachmentIds(node: AtlasNode): string[] {
  return [...node.attachments.map((attachment) => attachment.id), ...node.children.flatMap((child) => collectAttachmentIds(child))];
}

function createNotebookNode(
  parentId: string,
  index: number,
  title: string,
  body = "",
  options: { position?: [number, number, number] } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${index}-${now}`;
  return {
    id: `${parentId}-node-${Date.now()}-${crypto.randomUUID?.() ?? index}`,
    kind: "thread",
    nodeType: "human_prompt",
    title,
    subtitle: "human prompt",
    body,
    author: "human",
    status: "waiting",
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: body.split("\n").find(Boolean) ?? "A human-authored notebook node.",
    nextDecision: "Edit this node or branch from it.",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    position: options.position,
    children: [],
  };
}

function createAiRequestNode(
  parentId: string,
  index: number,
  runId: string,
  mode: AiExecutionMode,
  prompt: string,
  options: { position?: [number, number, number] } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-${mode}-${index}`;
  return {
    id: `${parentId}-request-${Date.now()}-${crypto.randomUUID?.() ?? index}`,
    kind: "thread",
    nodeType: "human_prompt",
    title: `${modeLabel(mode)} request`,
    subtitle: "human request",
    body: prompt,
    author: "human",
    status: "running",
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: prompt.split("\n").find(Boolean) ?? `${modeLabel(mode)} request.`,
    nextDecision: `${modeLabel(mode)} is working on this request.`,
    tags: normalizeTags([mode], prompt),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    sourceId: runId,
    aiRunId: runId,
    provider: providerForMode(mode),
    runMode: mode,
    position: options.position,
    children: [],
  };
}

function createAiResponseNode(
  parentId: string,
  index: number,
  runId: string,
  provider: AiProvider,
  mode: AiExecutionMode,
  modelId: string,
  output: AiGeneratedOutput,
  usage?: AiUsage,
  options: { position?: [number, number, number] } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-${index}`;
  const childSuggestions = output.childSuggestions.map((suggestion, suggestionIndex) =>
    createAiSuggestionNode(`${parentId}-${runId}`, suggestionIndex, suggestion.title, suggestion.body, output.suggestedStatus),
  );

  return {
    id: `${parentId}-ai-${Date.now()}-${crypto.randomUUID?.() ?? index}`,
    kind: "thread",
    nodeType: provider === "codex" ? "tool_result" : "ai_reply",
    title: output.title,
    subtitle: `${provider} / ${modelId}`,
    body: output.body,
    author: provider === "codex" ? "tool" : "ai",
    status: output.suggestedStatus,
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: output.summary,
    nextDecision: "Review this generated branch before treating it as accepted knowledge.",
    tags: normalizeTags(output.tags, output.title, output.body, output.summary),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    sourceId: runId,
    aiRunId: runId,
    modelId,
    provider,
    runMode: mode,
    usage,
    position: options.position,
    children: childSuggestions,
  };
}

function createAiErrorNode(
  parentId: string,
  runId: string,
  mode: AiExecutionMode,
  message: string,
  options: { position?: [number, number, number] } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-error`;
  return {
    id: `${parentId}-error-${Date.now()}-${crypto.randomUUID?.() ?? "error"}`,
    kind: "event",
    nodeType: "tool_result",
    title: `${modeLabel(mode)} error`,
    subtitle: "execution error",
    body: message,
    author: "system",
    status: "error",
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: message,
    nextDecision: "Inspect bridge configuration, provider status, or retry with a different mode.",
    tags: normalizeTags([mode, "error"], message),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    sourceId: runId,
    aiRunId: runId,
    provider: providerForMode(mode),
    runMode: mode,
    position: options.position,
    children: [],
  };
}

function createAiSuggestionNode(
  parentId: string,
  index: number,
  title: string,
  body: string,
  status: WorkStatus,
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-suggestion-${index}-${title}`;
  return {
    id: `${parentId}-suggestion-${Date.now()}-${index}-${crypto.randomUUID?.() ?? index}`,
    kind: "concept",
    nodeType: "note",
    title: title || "Suggested branch",
    subtitle: "AI suggested branch",
    body,
    author: "ai",
    status,
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: body.split("\n").find(Boolean) ?? "AI suggested branch.",
    nextDecision: "Promote, edit, or delete this suggested branch.",
    tags: normalizeTags([], title, body),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    children: [],
  };
}

function insertAt<T>(items: T[], index: number, item: T) {
  const target = Math.min(items.length, Math.max(0, index));
  return [...items.slice(0, target), item, ...items.slice(target)];
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

function providerForMode(mode: AiExecutionMode): AiProvider {
  if (mode === "local") return "local";
  if (mode === "codex") return "codex";
  return "openai";
}

function modeLabel(mode: AiExecutionMode) {
  switch (mode) {
    case "openai":
      return "OpenAI";
    case "local":
      return "Local";
    case "codex":
      return "Codex";
  }
}

function createNotificationPulse(nodeId: string, kind: NotificationPulseKind, title: string): NotificationPulse {
  return {
    id: `pulse-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    nodeId,
    kind,
    title,
    createdAt: performance.now(),
  };
}

function markUnreadNotification(
  current: Record<string, UnreadNotification>,
  nodeId: string,
  kind: NotificationPulseKind,
  title: string,
) {
  return {
    ...current,
    [nodeId]: {
      nodeId,
      kind,
      title,
      lastPulseAt: performance.now(),
    },
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function ensureNotebookNode(node: AtlasNode): AtlasNode {
  return ensureNotebookTree(node, [], 1);
}

function ensureNotebookTree(node: AtlasNode, parentPath: AtlasNode[], siblingCount: number): AtlasNode {
  const now = new Date().toISOString();
  const depth = parentPath.length;
  const base: AtlasNode = {
    ...node,
    nodeType: node.nodeType ?? "note",
    body: node.body ?? node.summary ?? "",
    author: node.author ?? "human",
    tags: normalizeTags(node.tags ?? [], node.title, node.body ?? "", node.summary ?? ""),
    attachments: node.attachments ?? [],
    texture: node.texture ?? randomTexture(node.id),
    radius: getNodeVisualRadius(node),
    createdAt: node.createdAt ?? now,
    updatedAt: node.updatedAt ?? now,
    position:
      node.position && depth > 1 && looksLikeLegacyWorldDirection(node.position)
        ? getStoredPositionForWorldDirection(parentPath, node.position, depth, siblingCount)
        : node.position,
    children: [],
  };
  return {
    ...base,
    children: (node.children ?? []).map((child) => ensureNotebookTree(child, [...parentPath, base], node.children.length)),
  };
}

function nodeToAiSnapshot(node: AtlasNode, depthRemaining: number): AiNodeSnapshot {
  return {
    id: node.id,
    title: node.title,
    body: truncateText(node.body, 4000),
    summary: truncateText(node.summary, 600),
    status: node.status,
    author: node.author,
    nodeType: node.nodeType,
    tags: node.tags,
    attachments: node.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    children: depthRemaining > 0 ? node.children.slice(0, 8).map((child) => nodeToAiSnapshot(child, depthRemaining - 1)) : [],
  };
}

function getSelectedSnapshotDepth(scope: AiContextScope) {
  switch (scope) {
    case "minimal":
      return 0;
    case "focused":
      return 1;
    case "subtree":
      return 4;
    case "neighborhood":
      return 2;
  }
}

function buildAiContextStats(
  scope: AiContextScope,
  selectedNode: AiNodeSnapshot,
  path: AiNodeSnapshot[],
  siblingNodes: AiNodeSnapshot[],
): AiContextStats {
  const selectedCount = countSnapshotNodes(selectedNode);
  const pathCount = path.reduce((sum, node) => sum + countSnapshotNodes(node), 0);
  const siblingCount = siblingNodes.reduce((sum, node) => sum + countSnapshotNodes(node), 0);
  const text = JSON.stringify({ selectedNode, path, siblingNodes });
  return {
    scope,
    includedNodeCount: selectedCount + pathCount + siblingCount,
    estimatedInputTokens: Math.ceil(text.length / 3.8),
    sections: {
      selected: selectedCount,
      path: pathCount,
      siblings: siblingCount,
    },
  };
}

function countSnapshotNodes(node: AiNodeSnapshot): number {
  return 1 + node.children.reduce((sum, child) => sum + countSnapshotNodes(child), 0);
}

function countDescendants(node: AtlasNode): number {
  return node.children.length + node.children.reduce((count, child) => count + countDescendants(child), 0);
}

function titleFromBody(body: string) {
  const firstLine = body.split("\n").find((line) => line.trim())?.trim() ?? "";
  return truncateText(firstLine || "Untitled moon", 48).replace(/\n\[truncated\]$/, "...");
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

type Vec3 = [number, number, number];

function topLevelDirection(index: number, count: number): Vec3 {
  if (count <= 1) return [0, 0, -1];
  const ringRadius = count <= 4 ? 0.42 : 0.5;
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return normalize([Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, -1]);
}

function getPhyllotaxisStoredChildPosition(
  depth: number,
  siblingCount: number,
  childIndex: number,
  parentId: string,
): Vec3 {
  const i = childIndex + 1;
  const angle = seededAngle(parentId) + i * GOLDEN_ANGLE;
  if (depth <= 1) {
    const planarRadius = Math.min(TOP_LEVEL_DRAG_PLANAR_LIMIT * 0.92, 0.22 + 0.12 * Math.sqrt(i));
    return clampDirection([Math.cos(angle) * planarRadius, Math.sin(angle) * planarRadius, -1], TOP_LEVEL_DRAG_PLANAR_LIMIT);
  }

  const limit = getManualChildSpreadLimit(depth, siblingCount);
  const amount = Math.min(limit * 0.94, limit * (0.38 + 0.12 * Math.sqrt(i)));
  return clampLocalOffset([Math.cos(angle) * amount, Math.sin(angle) * amount, 0], limit);
}

function seededAngle(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}

function childDirection(parentDirection: Vec3, angle: number, spread: number): Vec3 {
  const forward = normalize(parentDirection);
  const reference: Vec3 = Math.abs(forward[1]) > 0.86 ? [1, 0, 0] : [0, 1, 0];
  const tangentA = normalize(cross(reference, forward));
  const tangentB = normalize(cross(forward, tangentA));
  const tangent = normalize(add(scale(tangentA, Math.cos(angle)), scale(tangentB, Math.sin(angle))));
  return normalize(add(scale(forward, Math.cos(spread)), scale(tangent, Math.sin(spread))));
}

function getChildSpread(depth: number, siblingCount: number) {
  const parentRadius = getShellRadius(Math.max(1, depth - 1));
  const childRadius = getShellRadius(depth);
  const siblingSpread = siblingCount <= 1 ? 0 : Math.min(2.2, siblingCount * 0.22);
  const targetRadii = MIN_CHILD_SCREEN_SEPARATION_RADII + siblingSpread;
  const focusedDistance = FOCUSED_NODE_CAMERA_DISTANCE;
  const visibleDepth = Math.max(focusedDistance * 0.65, childRadius - parentRadius + focusedDistance);
  const requiredScreenRatio = (NOTEBOOK_NODE_RADIUS * targetRadii) / FOCUSED_NODE_CAMERA_DISTANCE;
  return Math.atan((requiredScreenRatio * visibleDepth) / childRadius);
}

function getStoredPositionForWorldDirection(
  parentPath: AtlasNode[],
  worldPosition: Vec3,
  depth: number,
  siblingCount: number,
): Vec3 {
  if (depth <= 1) {
    return clampDirection(worldPosition, TOP_LEVEL_DRAG_PLANAR_LIMIT);
  }

  const parentDirection = normalize(getNodeWorldPosition(parentPath));
  const desiredDirection = normalize(worldPosition);
  return localOffsetFromDirections(parentDirection, desiredDirection, getManualChildSpreadLimit(depth, siblingCount));
}

function directionFromStoredChildPosition(parentDirection: Vec3, storedPosition: Vec3, depth: number, siblingCount: number) {
  const limit = getManualChildSpreadLimit(depth, siblingCount);
  const local = looksLikeLegacyWorldDirection(storedPosition)
    ? localOffsetFromDirections(parentDirection, storedPosition, limit)
    : clampLocalOffset(storedPosition, limit);
  const { tangentA, tangentB } = tangentBasis(parentDirection);
  const amount = Math.hypot(local[0], local[1]);
  if (amount <= 0.0001) return normalize(parentDirection);

  const tangent = normalize(add(scale(tangentA, local[0] / amount), scale(tangentB, local[1] / amount)));
  return normalize(add(scale(normalize(parentDirection), Math.cos(amount)), scale(tangent, Math.sin(amount))));
}

function localOffsetFromDirections(parentDirection: Vec3, desiredDirection: Vec3, limit: number): Vec3 {
  const forward = normalize(parentDirection);
  const desired = normalize(desiredDirection);
  const { tangentA, tangentB } = tangentBasis(forward);
  const dot = Math.min(1, Math.max(-1, forward[0] * desired[0] + forward[1] * desired[1] + forward[2] * desired[2]));
  const angle = Math.min(limit, Math.acos(dot));
  const tangentProjection = normalize(add(scale(tangentA, desired[0] * tangentA[0] + desired[1] * tangentA[1] + desired[2] * tangentA[2]), scale(tangentB, desired[0] * tangentB[0] + desired[1] * tangentB[1] + desired[2] * tangentB[2])));
  if (Math.hypot(tangentProjection[0], tangentProjection[1], tangentProjection[2]) <= 0.0001 || angle <= 0.0001) return [0, 0, 0];
  return [
    (tangentProjection[0] * tangentA[0] + tangentProjection[1] * tangentA[1] + tangentProjection[2] * tangentA[2]) * angle,
    (tangentProjection[0] * tangentB[0] + tangentProjection[1] * tangentB[1] + tangentProjection[2] * tangentB[2]) * angle,
    0,
  ];
}

function clampLocalOffset(position: Vec3, limit: number): Vec3 {
  const amount = Math.hypot(position[0], position[1]);
  if (amount <= limit) return [position[0], position[1], 0];
  const scaleToLimit = amount > 0 ? limit / amount : 0;
  return [position[0] * scaleToLimit, position[1] * scaleToLimit, 0];
}

function tangentBasis(parentDirection: Vec3) {
  const forward = normalize(parentDirection);
  const reference: Vec3 = Math.abs(forward[1]) > 0.86 ? [1, 0, 0] : [0, 1, 0];
  const tangentA = normalize(cross(reference, forward));
  const tangentB = normalize(cross(forward, tangentA));
  return { tangentA, tangentB };
}

function looksLikeLegacyWorldDirection(position: Vec3) {
  return position[2] < -0.2 || Math.hypot(position[0], position[1], position[2]) > 0.7;
}

function clampDirection(vector: Vec3, planarLimit: number): Vec3 {
  const normalized = normalize(vector);
  const x = normalized[0];
  const y = normalized[1];
  const planar = Math.hypot(x, y);
  const limitedPlanar = Math.min(planar, planarLimit);
  const scaleToLimit = planar > 0 ? limitedPlanar / planar : 0;
  return normalize([
    x * scaleToLimit,
    y * scaleToLimit,
    -Math.sqrt(Math.max(0.0001, 1 - limitedPlanar * limitedPlanar)),
  ]);
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function randomTexture(seedText: string): AtlasNode["texture"] {
  return planetTextureForSeed(seedText);
}

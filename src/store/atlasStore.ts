import { create } from "zustand";
import { formatAppMessage } from "../i18n/format";
import {
  createStoredAttachmentPreviewUrls,
  getStoredAttachmentBlob,
  saveStoredAttachmentBlob,
} from "../attachmentStorage";
import { isAboutDemoMode } from "../aboutDemo";
import { planetColorForSeed, planetTextureForSeed } from "../config/planetTheme";
import { atlasRoot, initialWorkAreas } from "../data/atlas";
import { acknowledgeAgentRuns, getAgentRunInbox, getBridgeUrl, getBridgeUrlCandidates, recoverCodexRun, requestAiResponse, requestGitPush } from "../ai/bridgeClient";
import {
  NOTEBOOK_FIRST_SHELL_RADIUS,
  NOTEBOOK_SHELL_GAP,
  TOP_LEVEL_DRAG_PLANAR_LIMIT,
  TOP_LEVEL_PLANAR_LIMIT,
  clampDirection,
  getManualChildSpreadLimit,
  deriveAtlasLayoutFrame,
  getNodeWorldPositionFromPath,
  getPlanarLimitForDepth,
  getShellRadius,
  getStoredPositionForWorldDirection,
  looksLikeLegacyWorldDirection,
  stabilizePhyllotaxisPositions,
  type Vec3,
  type AtlasLayoutMode,
} from "../layout/atlasLayout";
import { sanitizeNotebookForExport } from "../notebookExport";
import {
  CONTEXT_BUDGET_PRESETS,
  buildContextPlan,
  buildSlimLegacyContext,
  renderAgentContextPrompt,
  renderAgentDeltaPrompt,
  resolveAgentSession,
  type AgentKind,
  type AgentSessionResolution,
  type ContextPlan,
} from "../context/contextEngine";
import { hydrateMissingNodeTitlesFromBodies } from "../titleMaintenance";
import {
  clearPersistedNotebook,
  listNotebookSnapshots,
  loadPersistedNotebook,
  migrateLegacyNotebookIfNeeded,
  requestDurableNotebookStorage,
  restoreNotebookSnapshot,
  savePersistedNotebook,
  writeLegacyNotebookRecovery,
  type NotebookPersistenceStatus,
  type NotebookSnapshot,
} from "../notebookPersistence";
import type { OutlineNodeInput } from "../outline/atlasOutline";
import type {
  AiAttachmentMode,
  AiContextOptions,
  AiContextScope,
  AiContextStats,
  AiDialogSettings,
  AiExecutionMode,
  AiGeneratedAttachment,
  AiGeneratedOutput,
  AiNodeContext,
  AiNodeSnapshot,
  AiProvider,
  AiRun,
  AiUsage,
  AgentRunInboxItem,
  AtlasEvent,
  AtlasNodeAction,
  AtlasNode,
  ChatSettings,
  ClaudeSettings,
  CodexGeneratedNode,
  CodexRunRecoveryRequest,
  CodexSettings,
  NotificationPulse,
  NotificationPulseKind,
  NodeAttachment,
  OpenClawSettings,
  Selection,
  ViewportState,
  VoiceLogEntry,
  VoicePartnerSettings,
  VoiceSessionSummary,
  WorkArea,
  WorkStatus,
} from "../types";

const UNREAD_NOTIFICATIONS_STORAGE_KEY = "mind-atlas-unread-notifications-v1";
const NOTIFICATION_READ_STATE_STORAGE_KEY = "mind-atlas-notification-read-state-v1";
const VOICE_LOG_STORAGE_KEY = "mind-atlas-voice-log-v1";
const VOICE_LOG_LAST_SEEN_STORAGE_KEY = "mind-atlas-voice-log-last-seen-v1";
const VOICE_SUMMARY_STORAGE_KEY = "mind-atlas-voice-summary-v1";
const VOICE_SETTINGS_STORAGE_KEY = "mind-atlas-voice-settings-v1";
export const NOTEBOOK_NODE_RADIUS = 28;
const NOTIFICATION_PULSE_DURATION_MS = 8200;
const NOTIFICATION_REPEAT_INTERVAL_MS = 3600;
const HISTORY_LIMIT = 50;
const DEFAULT_AI_CONTEXT_OPTIONS: AiContextOptions = {
  scope: "path-children",
  ancestorDepth: 2,
  descendantDepth: 1,
  lateralRadius: 1,
  attachmentMode: "metadata",
  maxAttachmentCount: 10,
  maxAttachmentBytes: 2 * 1024 * 1024,
  selectedNodeIds: [],
};

export {
  NOTEBOOK_FIRST_SHELL_RADIUS,
  NOTEBOOK_SHELL_GAP,
  TOP_LEVEL_DRAG_PLANAR_LIMIT,
  TOP_LEVEL_PLANAR_LIMIT,
  getManualChildSpreadLimit,
  getPlanarLimitForDepth,
  getShellRadius,
};
const DEFAULT_CODEX_SETTINGS: CodexSettings = {
  model: "gpt-5.5",
  reasoningEffort: "medium",
  sandbox: "workspace-write",
  workspace: "",
  webSearch: true,
  skipGitRepoCheck: false,
  timeoutMs: 60 * 60 * 1000,
  continueMode: "auto",
  resumeThreadId: "",
};
const DEFAULT_OPENCLAW_SETTINGS: OpenClawSettings = {
  model: "",
  thinking: "off",
  workspace: "",
  timeoutMs: 10 * 60 * 1000,
  continueMode: "auto",
  resumeSessionKey: "",
};
const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  authMode: "api",
  model: "",
  baseUrl: "",
  reasoningEffort: "default",
  permissionMode: "default",
  workspace: "",
  timeoutMs: 60 * 60 * 1000,
  continueMode: "auto",
  resumeSessionId: "",
  forkSession: false,
};
const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  service: "openai",
  model: "",
  reasoningEffort: "medium",
};
const DEFAULT_VOICE_PARTNER_SETTINGS: VoicePartnerSettings = {
  realtimeModel: "gpt-realtime-2",
  realtimeVoice: "marin",
};

interface UnreadNotification {
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
  lastPulseAt: number;
  signature?: string;
}

interface NotificationSource {
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
  signature: string;
}

interface FocusRequest {
  x: number;
  y: number;
  z: number;
  diameter: number;
  nonce: number;
  nodeId?: string;
}

interface NotificationSnoozePrompt {
  nodeId: string;
  createdAt: number;
  expiresAt: number;
  nonce: number;
}

interface HistoryEntry {
  atlasRoot: AtlasNode;
  selectedNodeId: string;
}

type ChildNodeDraft = {
  title?: string;
  body?: string;
  summary?: string;
};

type PartnerArchiveMode = Extract<AiExecutionMode, "chat" | "openai" | "local"> | "realtime";

type PartnerTurnArchive = {
  parentNodeId?: string | null;
  prompt: string;
  response: string;
  mode: PartnerArchiveMode;
  provider?: AiProvider;
  model?: string;
  usage?: AiUsage;
  status?: WorkStatus;
};

type NodeReminderUpdate = {
  nodeId: string;
  reminderAt: string;
};

type NodeReminderUpdateResult = {
  updated: Array<{ nodeId: string; reminderAt: string }>;
  failed: Array<{ nodeId: string; reason: string }>;
};

const initialAtlasRoot = atlasRoot;
const initialVoiceLogEntries = loadStoredVoiceLog();
const initialVoiceLogLastSeenAt = loadStoredVoiceLogLastSeenAt(initialVoiceLogEntries);

interface AtlasStore {
  atlasRoot: AtlasNode;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  workAreas: WorkArea[];
  aiRuns: Record<string, AiRun>;
  notificationPulses: NotificationPulse[];
  unreadNotifications: Record<string, UnreadNotification>;
  notificationSnoozePrompt: NotificationSnoozePrompt | null;
  notebookPersistenceStatus: NotebookPersistenceStatus;
  notebookPersistenceError: string;
  notebookSnapshots: NotebookSnapshot[];
  durableNotebookStorage: boolean;
  voiceLogEntries: VoiceLogEntry[];
  voiceLogLastSeenAt: string;
  voiceSessionSummary: VoiceSessionSummary | null;
  voicePartnerSettings: VoicePartnerSettings;
  selected: Selection;
  selectedNodeId: string;
  multiSelectedNodeIds: string[];
  aiContextOptions: AiContextOptions;
  chatSettings: ChatSettings;
  codexSettings: CodexSettings;
  openClawSettings: OpenClawSettings;
  claudeSettings: ClaudeSettings;
  commandInputEditing: boolean;
  activeCommandMode: AiExecutionMode | "note";
  viewport: ViewportState;
  layoutMode: AtlasLayoutMode;
  focusRequest: FocusRequest | null;
  cameraFocusNodeId: string | null;
  attachmentPreviewUrls: Record<string, string>;
  birthMarks: Record<string, number>;
  titleEditRequestId: string | null;
  bodyEditRequestId: string | null;
  selectNode: (id: string) => void;
  selectNodeInPlace: (id: string) => void;
  focusNode: (id: string) => void;
  toggleMultiSelectedNode: (id: string) => void;
  clearMultiSelection: () => void;
  setAiContextOptions: (patch: Partial<AiContextOptions>) => void;
  forceNewAgentSession: boolean;
  requestNewAgentSession: (enabled?: boolean) => void;
  setChatSettings: (patch: Partial<ChatSettings>) => void;
  setCodexSettings: (patch: Partial<CodexSettings>) => void;
  setOpenClawSettings: (patch: Partial<OpenClawSettings>) => void;
  setClaudeSettings: (patch: Partial<ClaudeSettings>) => void;
  loadAiDialogSettingsForNode: (id: string) => void;
  resetAiDialogSettingsToDefaults: () => void;
  setCommandInputEditing: (editing: boolean) => void;
  setActiveCommandMode: (mode: AiExecutionMode | "note") => void;
  appendVoiceLogEntry: (entry: Omit<VoiceLogEntry, "id" | "createdAt"> & Partial<Pick<VoiceLogEntry, "id" | "createdAt">>) => VoiceLogEntry;
  refreshNotebookSnapshots: () => Promise<void>;
  restoreNotebookFromSnapshot: (id: string) => Promise<void>;
  clearVoiceLog: () => void;
  markVoiceLogSeen: () => void;
  setVoiceSessionSummary: (summary: VoiceSessionSummary | null) => void;
  setVoicePartnerSettings: (settings: Partial<VoicePartnerSettings>) => void;
  focusParentNode: () => void;
  updateNode: (id: string, patch: Partial<Pick<AtlasNode, "title" | "body" | "tags" | "summary" | "nextDecision">>) => void;
  updateNodeLive: (id: string, patch: Partial<Pick<AtlasNode, "title" | "body" | "tags" | "summary" | "nextDecision">>, options?: { history?: boolean }) => void;
  setNodeReminder: (id: string, reminderAt: string) => void;
  setNodeReminders: (updates: NodeReminderUpdate[]) => NodeReminderUpdateResult;
  clearNodeReminder: (id: string) => void;
  showNotificationSnoozePrompt: (id: string) => void;
  acknowledgeNodeNotification: (id: string) => void;
  dismissNotificationSnoozePrompt: (id?: string) => void;
  snoozeNodeNotification: (id: string, delayMs: number) => void;
  setNodeStatus: (id: string, status: WorkStatus, nextDecision?: string) => void;
  addRootNodeAt: (position: [number, number, number], title?: string) => void;
  addChildNode: (
    parentId: string,
    initialBody?: string,
    options?: { title?: string; position?: [number, number, number]; insertIndex?: number; focus?: boolean; persist?: boolean },
  ) => string | undefined;
  addChildNodes: (parentId: string, nodes: ChildNodeDraft[], options?: { focus?: boolean }) => string[];
  archivePartnerTurn: (archive: PartnerTurnArchive) => { requestNodeId: string; responseNodeId: string } | undefined;
  pasteNodeSubtree: (parentId: string, copiedRoot: AtlasNode) => string | undefined;
  addSiblingNode: (id: string) => string | undefined;
  promoteNodeOneLevel: (id: string) => void;
  deleteNode: (id: string) => void;
  moveNode: (id: string, worldPosition: [number, number, number]) => void;
  addAttachment: (nodeId: string, attachment: NodeAttachment, previewUrl?: string) => void;
  removeAttachment: (nodeId: string, attachmentId: string) => void;
  updateNodeAppearance: (id: string, patch: Pick<Partial<AtlasNode>, "color" | "texture">) => void;
  requestTitleEdit: (id?: string) => void;
  consumeTitleEditRequest: () => void;
  requestBodyEdit: (id?: string) => void;
  consumeBodyEditRequest: () => void;
  restoreAttachmentPreviews: () => Promise<void>;
  exportNotebook: () => string;
  importNotebook: (root: AtlasNode, datasetName?: string, attachmentPreviewUrls?: Record<string, string>) => void;
  applyOutlineSubtree: (rootId: string, outline: OutlineNodeInput, options?: { focusKey?: string }) => void;
  resetNotebook: () => void;
  saveNotebook: () => void;
  saveNotebookNow: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  selectWorkArea: (id: string) => void;
  selectEvent: (parentId: string, id: string) => void;
  selectArtifact: (parentId: string, id: string) => void;
  setViewport: (viewport: ViewportState) => void;
  setLayoutMode: (mode: AtlasLayoutMode) => void;
  focusWorkArea: (id: string) => void;
  focusPoint: (x: number, y: number, diameter: number) => void;
  focusNodeCameraOnly: (id: string) => void;
  focusParentLayerCameraOnly: () => void;
  focusSingleChildCameraOnly: () => void;
  focusParentLayer: () => void;
  appendInstruction: (workAreaId: string, content: string) => void;
  addQuickChildFromInput: (prompt: string) => string | undefined;
  runAiOnSelectedNode: (prompt: string, mode: AiExecutionMode, options?: AiContextScope | Partial<AiContextOptions>) => Promise<void>;
  runNodeAction: (nodeId: string) => Promise<void>;
  recoverCompletedCodexRuns: () => Promise<void>;
  recoverMissedAgentRuns: () => Promise<void>;
  tickNotificationPulses: () => void;
}

export const useAtlasStore = create<AtlasStore>((set, get) => ({
  atlasRoot: initialAtlasRoot,
  historyPast: [],
  historyFuture: [],
  workAreas: initialWorkAreas,
  aiRuns: {},
  notificationPulses: [],
  unreadNotifications: restoreUnreadNotifications(initialAtlasRoot),
  notificationSnoozePrompt: null,
  notebookPersistenceStatus: "loading",
  notebookPersistenceError: "",
  notebookSnapshots: [],
  durableNotebookStorage: false,
  voiceLogEntries: initialVoiceLogEntries,
  voiceLogLastSeenAt: initialVoiceLogLastSeenAt,
  voiceSessionSummary: loadStoredVoiceSessionSummary(),
  voicePartnerSettings: loadStoredVoicePartnerSettings(),
  selected: { kind: "node", id: "atlas-root" },
  selectedNodeId: "atlas-root",
  multiSelectedNodeIds: [],
  aiContextOptions: DEFAULT_AI_CONTEXT_OPTIONS,
  forceNewAgentSession: false,
  chatSettings: DEFAULT_CHAT_SETTINGS,
  codexSettings: DEFAULT_CODEX_SETTINGS,
  openClawSettings: DEFAULT_OPENCLAW_SETTINGS,
  claudeSettings: DEFAULT_CLAUDE_SETTINGS,
  commandInputEditing: false,
  activeCommandMode: "chat",
  viewport: { x: 0, y: 0, zoom: 0.92 },
  layoutMode: "phyllotaxis",
  focusRequest: null,
  cameraFocusNodeId: null,
  attachmentPreviewUrls: {},
  birthMarks: {},
  titleEditRequestId: null,
  bodyEditRequestId: null,

  selectNode: (id) => {
    const state = get();
    const located = findNodeWithWorldPosition(state.atlasRoot, id, state.layoutMode, id);
    if (!located) return;
    const { node, path, position } = located;
    const visualRadius = getNodeVisualRadius(node, path.length - 1);
    set(() => {
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        cameraFocusNodeId: null,
        focusRequest: {
          x: position[0],
          y: position[1],
          z: position[2],
          diameter: visualRadius * 2,
          nonce: (state.focusRequest?.nonce ?? 0) + 1,
          nodeId: id,
        },
      };
    });
  },

  selectNodeInPlace: (id) => {
    const node = findNode(get().atlasRoot, id);
    if (!node) return;
    set(() => {
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        cameraFocusNodeId: null,
      };
    });
  },

  focusNode: (id) => {
    const state = get();
    const located = findNodeWithWorldPosition(state.atlasRoot, id, state.layoutMode, id);
    if (!located) return;
    const { node, path, position } = located;
    const visualRadius = getNodeVisualRadius(node, path.length - 1);
    set((state) => {
      return {
        selected: selectionFromNode(node),
        selectedNodeId: id,
        cameraFocusNodeId: null,
        focusRequest: {
          x: position[0],
          y: position[1],
          z: position[2],
          diameter: visualRadius * 2,
          nonce: (state.focusRequest?.nonce ?? 0) + 1,
          nodeId: id,
        },
      };
    });
  },

  toggleMultiSelectedNode: (id) => {
    const state = get();
    if (id === state.selectedNodeId || !findNode(state.atlasRoot, id)) return;
    set((current) => {
      const selected = current.multiSelectedNodeIds.includes(id)
        ? current.multiSelectedNodeIds.filter((nodeId) => nodeId !== id)
        : [...current.multiSelectedNodeIds, id];
      return { multiSelectedNodeIds: selected };
    });
  },

  clearMultiSelection: () => set({ multiSelectedNodeIds: [], cameraFocusNodeId: null }),

  requestNewAgentSession: (enabled = true) => {
    set({ forceNewAgentSession: enabled });
  },
  setAiContextOptions: (patch) => {
    set((state) => ({
      ...withAiDialogSettingsSaved(state, {
        contextOptions: normalizeAiContextOptions({
          ...state.aiContextOptions,
          ...patch,
          selectedNodeIds: patch.selectedNodeIds ?? state.aiContextOptions.selectedNodeIds,
        }),
      }),
    }));
  },

  setChatSettings: (patch) => {
    set((state) => ({
      ...withAiDialogSettingsSaved(state, {
        chatSettings: normalizeChatSettings({
          ...state.chatSettings,
          ...patch,
        }),
      }),
    }));
  },

  setCodexSettings: (patch) => {
    set((state) => ({
      ...withAiDialogSettingsSaved(state, {
        codexSettings: normalizeCodexSettings({
          ...state.codexSettings,
          ...patch,
        }),
      }),
    }));
  },

  setOpenClawSettings: (patch) => {
    set((state) => ({
      ...withAiDialogSettingsSaved(state, {
        openClawSettings: normalizeOpenClawSettings({
          ...state.openClawSettings,
          ...patch,
        }),
      }),
    }));
  },

  setClaudeSettings: (patch) => {
    set((state) => ({
      ...withAiDialogSettingsSaved(state, {
        claudeSettings: normalizeClaudeSettings({
          ...state.claudeSettings,
          ...patch,
        }),
      }),
    }));
  },

  loadAiDialogSettingsForNode: (id) => {
    const path = findNodePath(get().atlasRoot, id);
    const settings = path ? findAiDialogSettingsInPath(path) : undefined;
    set((state) => ({
      aiContextOptions: normalizeAiContextOptions(settings?.contextOptions ?? DEFAULT_AI_CONTEXT_OPTIONS),
      chatSettings: normalizeChatSettings(settings?.chatSettings ?? DEFAULT_CHAT_SETTINGS),
      codexSettings: normalizeCodexSettings(settings?.codexSettings ?? DEFAULT_CODEX_SETTINGS),
      openClawSettings: normalizeOpenClawSettings(settings?.openClawSettings ?? DEFAULT_OPENCLAW_SETTINGS),
      claudeSettings: normalizeClaudeSettings(settings?.claudeSettings ?? DEFAULT_CLAUDE_SETTINGS),
    }));
  },

  resetAiDialogSettingsToDefaults: () => {
    set({
      aiContextOptions: normalizeAiContextOptions(DEFAULT_AI_CONTEXT_OPTIONS),
      chatSettings: normalizeChatSettings(DEFAULT_CHAT_SETTINGS),
      codexSettings: normalizeCodexSettings(DEFAULT_CODEX_SETTINGS),
      openClawSettings: normalizeOpenClawSettings(DEFAULT_OPENCLAW_SETTINGS),
      claudeSettings: normalizeClaudeSettings(DEFAULT_CLAUDE_SETTINGS),
    });
  },

  setCommandInputEditing: (editing) => set({ commandInputEditing: editing, ...(editing ? {} : { cameraFocusNodeId: null }) }),

  setActiveCommandMode: (mode) => set({ activeCommandMode: mode }),

  appendVoiceLogEntry: (entry) => {
    const voiceLogEntry: VoiceLogEntry = {
      id: entry.id ?? `voice-log-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      role: entry.role,
      text: entry.text,
      title: entry.title,
      sessionId: entry.sessionId,
      toolName: entry.toolName,
      toolCallId: entry.toolCallId,
      status: entry.status,
      metadata: entry.metadata,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    set((state) => {
      const voiceLogEntries = [...state.voiceLogEntries, voiceLogEntry].slice(-600);
      persistVoiceLog(voiceLogEntries);
      return { voiceLogEntries };
    });
    return voiceLogEntry;
  },

  clearVoiceLog: () => {
    const seenAt = new Date().toISOString();
    persistVoiceLog([]);
    persistVoiceLogLastSeenAt(seenAt);
    set({ voiceLogEntries: [], voiceLogLastSeenAt: seenAt });
  },

  refreshNotebookSnapshots: async () => {
    try {
      const notebookSnapshots = await listNotebookSnapshots();
      set({ notebookSnapshots, notebookPersistenceError: "" });
    } catch (error) {
      const message = notebookPersistenceErrorMessage("Notebook history could not be loaded.", error);
      console.error(message, error);
      set({ notebookPersistenceError: message, notebookPersistenceStatus: "error" });
    }
  },

  restoreNotebookFromSnapshot: async (id) => {
    try {
      const atlasRoot = ensureNotebookNode(await restoreNotebookSnapshot(id));
      const repair = repairDuplicateNodeIds(atlasRoot);
      const nextRoot = repair.root;
      const selectedNode = findNode(nextRoot, get().selectedNodeId) ?? nextRoot;
      const unreadNotifications = restoreUnreadNotifications(nextRoot, get().unreadNotifications);
      persistUnreadNotifications(unreadNotifications);
      set((state) => ({
        ...pushHistory(state),
        atlasRoot: nextRoot,
        selected: selectionFromNode(selectedNode),
        selectedNodeId: selectedNode.id,
        multiSelectedNodeIds: state.multiSelectedNodeIds.filter((nodeId) => Boolean(findNode(nextRoot, nodeId))),
        cameraFocusNodeId: null,
        attachmentPreviewUrls: filterAttachmentPreviewUrls(state.attachmentPreviewUrls, nextRoot),
        birthMarks: {},
        unreadNotifications,
        notificationPulses: [],
        notificationSnoozePrompt: null,
        titleEditRequestId: null,
        bodyEditRequestId: null,
        notebookPersistenceStatus: "ready",
        notebookPersistenceError: "",
      }));
      await get().refreshNotebookSnapshots();
      await get().restoreAttachmentPreviews();
      get().focusNode(selectedNode.id);
    } catch (error) {
      const message = notebookPersistenceErrorMessage("Notebook snapshot could not be restored.", error);
      console.error(message, error);
      set({ notebookPersistenceError: message, notebookPersistenceStatus: "error" });
      throw error;
    }
  },

  markVoiceLogSeen: () => {
    const seenAt = new Date().toISOString();
    persistVoiceLogLastSeenAt(seenAt);
    set({ voiceLogLastSeenAt: seenAt });
  },

  setVoiceSessionSummary: (summary) => {
    persistVoiceSessionSummary(summary);
    set({ voiceSessionSummary: summary });
  },

  setVoicePartnerSettings: (settings) => {
    set((state) => {
      const voicePartnerSettings = normalizeVoicePartnerSettings({
        ...state.voicePartnerSettings,
        ...settings,
      });
      persistVoicePartnerSettings(voicePartnerSettings);
      return { voicePartnerSettings };
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
        cameraFocusNodeId: null,
        focusRequest: {
          x: 0,
          y: 0,
          z: 0,
          diameter: atlasDiameter,
          nonce: (current.focusRequest?.nonce ?? 0) + 1,
          nodeId: state.atlasRoot.id,
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
      return { ...pushHistory(state), atlasRoot };
    });
  },

  updateNodeLive: (id, patch, options = {}) => {
    set((state) => {
      const current = findNode(state.atlasRoot, id);
      if (!current) return state;
      const nextTitle = patch.title ?? current.title;
      const nextBody = patch.body ?? current.body;
      const nextPatch = {
        ...patch,
        tags: normalizeTags(patch.tags ?? current.tags, nextTitle, nextBody, patch.summary ?? current.summary),
        updatedAt: new Date().toISOString(),
      };
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({ ...node, ...withoutUndefined(nextPatch) }));
      persistNotebook(atlasRoot);
      return {
        ...(options.history ? pushHistory(state) : {}),
        atlasRoot,
        historyFuture: options.history ? [] : state.historyFuture,
      };
    });
  },

  setNodeReminder: (id, reminderAt) => {
    const parsedAt = new Date(reminderAt);
    if (Number.isNaN(parsedAt.getTime())) return;
    const normalizedAt = parsedAt.toISOString();
    const updatedAt = new Date().toISOString();
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({
        ...node,
        reminderAt: normalizedAt,
        reminderFiredAt: undefined,
        updatedAt,
      }));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(state),
        atlasRoot,
      };
    });
  },

  setNodeReminders: (updates) => {
    const updatedAt = new Date().toISOString();
    const seen = new Set<string>();
    const normalizedUpdates: NodeReminderUpdate[] = [];
    const failed: NodeReminderUpdateResult["failed"] = [];

    for (const update of updates) {
      const nodeId = update.nodeId.trim();
      if (!nodeId) {
        failed.push({ nodeId, reason: "nodeId is required" });
        continue;
      }
      if (seen.has(nodeId)) {
        failed.push({ nodeId, reason: "duplicate nodeId in request" });
        continue;
      }
      seen.add(nodeId);
      const parsedAt = new Date(update.reminderAt);
      if (Number.isNaN(parsedAt.getTime())) {
        failed.push({ nodeId, reason: "reminderAt must be a valid date or ISO 8601 timestamp" });
        continue;
      }
      normalizedUpdates.push({ nodeId, reminderAt: parsedAt.toISOString() });
    }

    if (!normalizedUpdates.length) return { updated: [], failed };

    let updated: NodeReminderUpdateResult["updated"] = [];
    set((state) => {
      const updateByNodeId = new Map(normalizedUpdates.map((update) => [update.nodeId, update.reminderAt]));
      const foundNodeIds = new Set<string>();
      const atlasRoot = updateNodeTree(state.atlasRoot, (node) => {
        const reminderAt = updateByNodeId.get(node.id);
        if (!reminderAt) return node;
        foundNodeIds.add(node.id);
        return {
          ...node,
          reminderAt,
          reminderFiredAt: undefined,
          updatedAt,
        };
      });

      for (const update of normalizedUpdates) {
        if (foundNodeIds.has(update.nodeId)) {
          updated.push(update);
        } else {
          failed.push({ nodeId: update.nodeId, reason: "node not found" });
        }
      }

      if (!updated.length) return {};

      const updatedIds = new Set(updated.map((item) => item.nodeId));
      const unreadNotifications = updated.reduce(
        (current, item) => markNodeNotificationsRead(atlasRoot, current, item.nodeId),
        state.unreadNotifications,
      );

      persistNotebook(atlasRoot);
      return {
        ...pushHistory(state),
        atlasRoot,
        unreadNotifications,
        notificationPulses: state.notificationPulses.filter((pulse) => !updatedIds.has(pulse.nodeId)),
        notificationSnoozePrompt:
          state.notificationSnoozePrompt && updatedIds.has(state.notificationSnoozePrompt.nodeId)
            ? null
            : state.notificationSnoozePrompt,
      };
    });

    return { updated, failed };
  },

  clearNodeReminder: (id) => {
    const updatedAt = new Date().toISOString();
    set((state) => {
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => {
        const { reminderAt: _reminderAt, reminderFiredAt: _reminderFiredAt, ...rest } = node;
        return {
          ...rest,
          updatedAt,
        };
      });
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(state),
        atlasRoot,
      };
    });
  },

  showNotificationSnoozePrompt: (id) => {
    if (!findNode(get().atlasRoot, id)) return;
    const now = Date.now();
    set((state) => ({
      notificationSnoozePrompt: {
        nodeId: id,
        createdAt: now,
        expiresAt: now + 60_000,
        nonce: (state.notificationSnoozePrompt?.nonce ?? 0) + 1,
      },
    }));
  },

  acknowledgeNodeNotification: (id) => {
    set((state) => ({
      unreadNotifications: markNodeNotificationsRead(state.atlasRoot, state.unreadNotifications, id),
      notificationPulses: state.notificationPulses.filter((pulse) => pulse.nodeId !== id),
      notificationSnoozePrompt: state.notificationSnoozePrompt?.nodeId === id ? null : state.notificationSnoozePrompt,
    }));
  },

  dismissNotificationSnoozePrompt: (id) => {
    set((state) => {
      if (!state.notificationSnoozePrompt) return {};
      if (id && state.notificationSnoozePrompt.nodeId !== id) return {};
      return { notificationSnoozePrompt: null };
    });
  },

  snoozeNodeNotification: (id, delayMs) => {
    if (!Number.isFinite(delayMs) || delayMs <= 0) return;
    const nowMs = Date.now();
    const reminderAt = new Date(nowMs + delayMs).toISOString();
    const updatedAt = new Date(nowMs).toISOString();
    set((state) => {
      if (!findNode(state.atlasRoot, id)) return {};
      const unreadNotifications = markNodeNotificationsRead(state.atlasRoot, state.unreadNotifications, id);
      const atlasRoot = updateNodeById(state.atlasRoot, id, (node) => ({
        ...node,
        reminderAt,
        reminderFiredAt: undefined,
        updatedAt,
      }));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(state),
        atlasRoot,
        unreadNotifications,
        notificationPulses: state.notificationPulses.filter((pulse) => pulse.nodeId !== id),
        notificationSnoozePrompt: state.notificationSnoozePrompt?.nodeId === id ? null : state.notificationSnoozePrompt,
      };
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
      return { ...pushHistory(state), atlasRoot };
    });
  },

  addRootNodeAt: (position, title = "") => {
    const state = get();
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const aiDialogSettings = createInheritedAiDialogSettings([state.atlasRoot], state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const child = createNotebookNode("atlas-root", state.atlasRoot.children.length, title, "", {
      position: clampDirection(position, TOP_LEVEL_DRAG_PLANAR_LIMIT),
      aiDialogSettings,
      codexThreadId: inferCodexThreadIdFromNodePath([state.atlasRoot]),
      codexLogPath: inferCodexLogPathFromNodePath([state.atlasRoot]),
      usedNodeIds,
    });
    set((state) => {
      const atlasRoot = {
        ...state.atlasRoot,
        children: [...state.atlasRoot.children, child],
        updatedAt: new Date().toISOString(),
      };
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(state),
        atlasRoot,
        birthMarks: { ...state.birthMarks, [child.id]: performance.now() },
        titleEditRequestId: child.id,
      };
    });
    get().focusNode(child.id);
  },

  addChildNode: (parentId, initialBody = "", options = {}) => {
    const state = get();
    const parent = findNode(state.atlasRoot, parentId);
    if (!parent) return;
    const parentPath = findNodePath(state.atlasRoot, parentId);
    const childDepth = parentPath?.length ?? 1;
    const inheritedAiDialogSettings = createInheritedAiDialogSettings(parentPath ?? [parent], state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const insertIndex = typeof options.insertIndex === "number" ? options.insertIndex : parent.children.length;
    const childPosition = options.position
      ? getStoredPositionForWorldDirection(parentPath ?? [state.atlasRoot], options.position, childDepth, parent.children.length + 1)
      : undefined;
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const child = createNotebookNode(
      parentId,
      parent.children.length,
      options.title ?? (initialBody ? titleFromBody(initialBody) : ""),
      initialBody,
      {
        position: childPosition,
        aiDialogSettings: inheritedAiDialogSettings,
        codexThreadId: inferCodexThreadIdFromNodePath(parentPath ?? [parent]),
        codexLogPath: inferCodexLogPathFromNodePath(parentPath ?? [parent]),
        usedNodeIds,
      },
    );
    set((state) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(state.atlasRoot, parentId, (node) => ({
        ...node,
        children:
          typeof options.insertIndex === "number"
            ? insertAt(node.children, options.insertIndex, child)
            : [...node.children, child],
        updatedAt: new Date().toISOString(),
      })));
      if (options.persist !== false) {
        persistNotebook(atlasRoot);
      }
      return {
        ...pushHistory(state),
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

  addChildNodes: (parentId, nodes, options = {}) => {
    const state = get();
    const parentPath = findNodePath(state.atlasRoot, parentId);
    const parent = parentPath?.at(-1);
    if (!parentPath || !parent) return [];

    const drafts = nodes
      .map((node) => ({
        title: node.title?.trim() ?? "",
        body: node.body?.trim() ?? "",
        summary: node.summary?.trim() ?? "",
      }))
      .filter((node) => node.title || node.body || node.summary);
    if (!drafts.length) return [];

    const childDepth = parentPath.length;
    const startIndex = parent.children.length;
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const inheritedAiDialogSettings = createInheritedAiDialogSettings(parentPath, state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const inheritedCodexThreadId = inferCodexThreadIdFromNodePath(parentPath);
    const inheritedCodexLogPath = inferCodexLogPathFromNodePath(parentPath);
    const children = drafts.map((draft, offset) => {
      const body = draft.body;
      const title = draft.title || (body ? titleFromBody(body) : "");
      const child = createNotebookNode(parentId, startIndex + offset, title, body, {
        aiDialogSettings: inheritedAiDialogSettings,
        codexThreadId: inheritedCodexThreadId,
        codexLogPath: inheritedCodexLogPath,
        usedNodeIds,
      });
      return draft.summary ? { ...child, summary: draft.summary } : child;
    });
    const ids = children.map((child) => child.id);

    set((current) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, parentId, (node) => ({
        ...node,
        children: [...node.children, ...children],
        updatedAt: new Date().toISOString(),
      })));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
        birthMarks: {
          ...current.birthMarks,
          ...Object.fromEntries(ids.map((id) => [id, performance.now()])),
        },
        titleEditRequestId: options.focus === false ? current.titleEditRequestId : ids.at(-1) ?? current.titleEditRequestId,
      };
    });

    if (options.focus !== false && ids.length) {
      get().focusNode(ids[ids.length - 1]);
    }
    return ids;
  },

  archivePartnerTurn: (archive) => {
    const prompt = archive.prompt.trim();
    const response = archive.response.trim();
    if (!prompt || !response) return undefined;

    const state = get();
    const parentNodeId = archive.parentNodeId || state.selectedNodeId;
    if (!parentNodeId || parentNodeId === state.atlasRoot.id) return undefined;

    const parentPath = findNodePath(state.atlasRoot, parentNodeId);
    const parent = parentPath?.at(-1);
    if (!parentPath || !parent) return undefined;

    const runMode = partnerRunMode(archive.mode);
    const provider = archive.provider ?? partnerProvider(archive.mode);
    const label = partnerModeLabel(archive.mode);
    const runId = `partner-run-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const requestIndex = parent.children.length;
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const requestAiDialogSettings = createInheritedAiDialogSettings(parentPath, state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const requestNode = {
      ...createAiRequestNode(parentNodeId, requestIndex, runId, runMode, prompt, {
        aiDialogSettings: requestAiDialogSettings,
        codexThreadId: inferCodexThreadIdFromNodePath(parentPath),
        codexLogPath: inferCodexLogPathFromNodePath(parentPath),
        usedNodeIds,
      }),
      title: `${label} request`,
      status: "done" as WorkStatus,
      nextDecision: "AI Partner result archived below.",
      tags: normalizeTags(["partner", archive.mode], prompt),
      provider,
    };

    const output: AiGeneratedOutput = {
      title: titleFromBody(response) || `${label} response`,
      body: response,
      summary: response.split("\n").find(Boolean)?.slice(0, 220) ?? `${label} response.`,
      suggestedStatus: archive.status === "waiting" ? "waiting" : archive.status === "needs_review" || archive.status === "error" ? "needs_review" : "done",
      tags: ["partner", archive.mode],
    };
    const responseNode = createAiResponseNode(
      requestNode.id,
      0,
      runId,
      provider,
      runMode,
      archive.model || label,
      output,
      archive.usage,
      {
        aiDialogSettings: requestNode.aiDialogSettings,
        codexThreadId: requestNode.codexThreadId,
        codexLogPath: requestNode.codexLogPath,
        usedNodeIds,
      },
    );
    const archivedRequestNode: AtlasNode = {
      ...requestNode,
      children: [responseNode],
    };
    const completedAt = new Date().toISOString();

    set((current) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, parentNodeId, (node) => ({
        ...node,
        children: [...node.children, archivedRequestNode],
        updatedAt: completedAt,
      })));
      const notificationKind: NotificationPulseKind = archive.status === "error" ? "error" : "needs_review";
      const notificationTitle = archive.status === "error" ? `${label} failed` : `${label} result ready`;
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
        birthMarks: {
          ...current.birthMarks,
          [archivedRequestNode.id]: performance.now(),
          [responseNode.id]: performance.now(),
        },
        notificationPulses: [
          ...current.notificationPulses,
          createNotificationPulse(responseNode.id, notificationKind, notificationTitle),
        ],
        unreadNotifications: markUnreadNotification(
          current.unreadNotifications,
          responseNode.id,
          notificationKind,
          notificationTitle,
        ),
        aiRuns: {
          ...current.aiRuns,
          [runId]: {
            id: runId,
            nodeId: parentNodeId,
            requestNodeId: archivedRequestNode.id,
            responseNodeId: responseNode.id,
            provider,
            mode: runMode,
            modelId: archive.model || label,
            status: archive.status === "error" ? "error" : "done",
            prompt,
            startedAt: archivedRequestNode.createdAt,
            completedAt,
            usage: archive.usage,
          },
        },
      };
    });

    return {
      requestNodeId: archivedRequestNode.id,
      responseNodeId: responseNode.id,
    };
  },

  pasteNodeSubtree: (parentId, copiedRoot) => {
    const state = get();
    const parentPath = findNodePath(state.atlasRoot, parentId);
    const parent = parentPath?.at(-1);
    if (!parentPath || !parent) return undefined;

    const childDepth = parentPath.length;
    const insertIndex = parent.children.length;
    const now = new Date().toISOString();
    const inheritedAiDialogSettings = copiedRoot.aiDialogSettings ?? createInheritedAiDialogSettings(parentPath, state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const inheritedCodexThreadId = copiedRoot.codexThreadId ?? inferCodexThreadIdFromNodePath(parentPath);
    const inheritedCodexLogPath = copiedRoot.codexLogPath ?? inferCodexLogPathFromNodePath(parentPath);
    const inheritedOpenClawSessionKey = copiedRoot.openClawSessionKey ?? inferOpenClawSessionKeyFromNodePath(parentPath);
    const inheritedOpenClawLogPath = copiedRoot.openClawLogPath ?? inferOpenClawLogPathFromNodePath(parentPath);
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const pastedRoot = cloneNodeSubtreeForPaste(
      copiedRoot,
      parent.id,
      now,
      undefined,
      true,
      inheritedAiDialogSettings,
      inheritedCodexThreadId,
      inheritedCodexLogPath,
      inheritedOpenClawSessionKey,
      inheritedOpenClawLogPath,
      usedNodeIds,
    );
    const pastedNodeIds = collectNodeIds(pastedRoot);
    const birthStartedAt = performance.now();

    set((current) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, parent.id, (node) => ({
        ...node,
        children: [...node.children, pastedRoot],
        updatedAt: now,
      })));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
        birthMarks: {
          ...current.birthMarks,
          ...Object.fromEntries(pastedNodeIds.map((id) => [id, birthStartedAt])),
        },
      };
    });

    get().focusNode(pastedRoot.id);
    return pastedRoot.id;
  },

  addSiblingNode: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length < 2) return undefined;
    const parent = path[path.length - 2];
    const siblingDepth = path.length - 1;
    const insertIndex = parent.children.length;
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const inheritedAiDialogSettings = createInheritedAiDialogSettings(path.slice(0, -1), state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const sibling = createNotebookNode(parent.id, parent.children.length, "", "", {
      aiDialogSettings: inheritedAiDialogSettings,
      codexThreadId: inferCodexThreadIdFromNodePath(path.slice(0, -1)),
      codexLogPath: inferCodexLogPathFromNodePath(path.slice(0, -1)),
      usedNodeIds,
    });
    set((current) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, parent.id, (node) => ({
        ...node,
        children: [...node.children, sibling],
        updatedAt: new Date().toISOString(),
      })));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
        birthMarks: { ...current.birthMarks, [sibling.id]: performance.now() },
        titleEditRequestId: sibling.id,
      };
    });
    get().focusNode(sibling.id);
    return sibling.id;
  },

  promoteNodeOneLevel: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length < 3) return;

    const parent = path[path.length - 2];
    const grandparent = path[path.length - 3];
    const source = path[path.length - 1];
    const parentIndex = grandparent.children.findIndex((child) => child.id === parent.id);
    if (parentIndex < 0) return;

    const now = new Date().toISOString();
    const promotedDepth = path.length - 2;
    const insertIndex = parentIndex + 1;
    const promotedPosition = getPromotedSiblingPosition(
      grandparent,
      parent,
      promotedDepth,
      grandparent.children.length + 1,
      insertIndex,
    );
    const promotedNode: AtlasNode = {
      ...source,
      sourceParentId: grandparent.id,
      position: promotedPosition,
      updatedAt: now,
    };
    const nextRoot = clearResolvedPropagatedErrors(
      promoteNodeInTree(state.atlasRoot, grandparent.id, parent.id, id, promotedNode, insertIndex, now),
    );
    persistNotebook(nextRoot);
    set({
      ...pushHistory(state),
      atlasRoot: nextRoot,
      selected: selectionFromNode(promotedNode),
      selectedNodeId: promotedNode.id,
      cameraFocusNodeId: null,
    });
    get().focusNode(promotedNode.id);
  },

  deleteNode: (id) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, id);
    if (!path || path.length <= 1) return;

    const deletedNode = path[path.length - 1];
    const parentNode = path[path.length - 2];
    const deletedNodeIds = collectNodeIds(deletedNode);
    const deletedAttachmentIds = collectAttachmentIds(deletedNode);
    const stableRoot = stabilizePhyllotaxisPositions(state.atlasRoot);
    const nextRoot = clearResolvedPropagatedErrors(removeNodeById(stableRoot, id));
    const parentLocation = findNodeWithWorldPosition(nextRoot, parentNode.id, state.layoutMode, parentNode.id);
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
    for (const nodeId of deletedNodeIds) {
      delete birthMarks[nodeId];
      delete unreadNotifications[nodeId];
    }

    persistNotebook(nextRoot);
    persistUnreadNotifications(unreadNotifications);
    set((current) => ({
      ...pushHistory(current),
      atlasRoot: nextRoot,
      selected: selectionFromNode(nextSelectedNode),
      selectedNodeId: nextSelectedNode.id,
      cameraFocusNodeId: null,
      multiSelectedNodeIds: current.multiSelectedNodeIds.filter((nodeId) => !deletedNodeIds.includes(nodeId) && findNode(nextRoot, nodeId)),
      attachmentPreviewUrls,
      birthMarks,
      unreadNotifications,
      notificationPulses: current.notificationPulses.filter((pulse) => !deletedNodeIds.includes(pulse.nodeId)),
      notificationSnoozePrompt: current.notificationSnoozePrompt && deletedNodeIds.includes(current.notificationSnoozePrompt.nodeId) ? null : current.notificationSnoozePrompt,
      titleEditRequestId: current.titleEditRequestId && deletedNodeIds.includes(current.titleEditRequestId) ? null : current.titleEditRequestId,
      bodyEditRequestId: current.bodyEditRequestId && deletedNodeIds.includes(current.bodyEditRequestId) ? null : current.bodyEditRequestId,
      focusRequest: {
        x: nextPosition[0],
        y: nextPosition[1],
        z: nextPosition[2],
        diameter: Math.max(nextDiameter, 120),
        nonce: (current.focusRequest?.nonce ?? 0) + 1,
        nodeId: nextSelectedNode.id,
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
      return { ...pushHistory(current), atlasRoot };
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
        ...pushHistory(state),
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
      persistNotebook(atlasRoot);
      return { ...pushHistory(state), atlasRoot, attachmentPreviewUrls };
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
      return { ...pushHistory(state), atlasRoot };
    });
  },

  requestTitleEdit: (id) => {
    const state = get();
    const nodeId = id ?? state.selectedNodeId;
    if (nodeId === state.atlasRoot.id || !findNode(state.atlasRoot, nodeId)) return;
    set({ titleEditRequestId: nodeId });
  },

  consumeTitleEditRequest: () => set({ titleEditRequestId: null }),

  requestBodyEdit: (id) => {
    const state = get();
    const nodeId = id ?? state.selectedNodeId;
    if (nodeId === state.atlasRoot.id || !findNode(state.atlasRoot, nodeId)) return;
    set({ bodyEditRequestId: nodeId, titleEditRequestId: null });
  },

  consumeBodyEditRequest: () => set({ bodyEditRequestId: null }),

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

  exportNotebook: () => JSON.stringify(sanitizeNotebookForExport(get().atlasRoot, { includeAttachmentAssetPaths: false }), null, 2),

  importNotebook: (root, datasetName, nextAttachmentPreviewUrls = {}) => {
    const current = get();
    Object.values(current.attachmentPreviewUrls).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    const normalizedRoot = {
      ...ensureNotebookNode(root),
      ...(datasetName ? { title: datasetName, subtitle: datasetName, updatedAt: new Date().toISOString() } : {}),
    };
    const repair = repairDuplicateNodeIds(normalizedRoot);
    const atlasRoot = repair.root;
    if (repair.repairedIds.length) {
      console.warn(`Mind Atlas repaired ${repair.repairedIds.length} duplicate node id(s) during import.`);
    }
    persistNotebook(atlasRoot);
    clearStoredNotificationState();
    const unreadNotifications: Record<string, UnreadNotification> = {};
    persistUnreadNotifications(unreadNotifications);
    set({
      ...pushHistory(current),
      atlasRoot,
      selected: selectionFromNode(atlasRoot.children[0] ?? atlasRoot),
      selectedNodeId: atlasRoot.children[0]?.id ?? atlasRoot.id,
      multiSelectedNodeIds: [],
      cameraFocusNodeId: null,
      attachmentPreviewUrls: nextAttachmentPreviewUrls,
      birthMarks: {},
      unreadNotifications,
      notificationPulses: [],
      notificationSnoozePrompt: null,
      titleEditRequestId: atlasRoot.children[0]?.id ?? null,
      bodyEditRequestId: null,
    });
  },

  applyOutlineSubtree: (rootId, outline, options = {}) => {
    const state = get();
    const path = findNodePath(state.atlasRoot, rootId);
    const target = path?.at(-1);
    if (!path || !target) return;
    const now = new Date().toISOString();
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const nodeIdByClientKey = new Map<string, string>();
    const parentId = path.length > 1 ? path[path.length - 2].id : undefined;
    const inheritedAiDialogSettings = createInheritedAiDialogSettings(path, state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const nextSubtree = buildAtlasNodeFromOutline(
      outline,
      target,
      parentId,
      Math.max(0, path.length - 1),
      0,
      1,
      usedNodeIds,
      now,
      inheritedAiDialogSettings,
      inferCodexThreadIdFromNodePath(path),
      inferCodexLogPathFromNodePath(path),
      undefined,
      undefined,
      nodeIdByClientKey,
    );
    const atlasRoot = rootId === state.atlasRoot.id ? nextSubtree : replaceNodeById(state.atlasRoot, rootId, nextSubtree);
    const repair = repairDuplicateNodeIds(atlasRoot);
    if (repair.repairedIds.length) {
      console.warn(`Mind Atlas repaired ${repair.repairedIds.length} duplicate node id(s) after outline edit.`);
    }
    const stableRoot = stabilizePhyllotaxisPositions(repair.root);
    persistNotebook(stableRoot);
    const requestedFocusId = options.focusKey ? nodeIdByClientKey.get(options.focusKey) : undefined;
    const selectedNode = (requestedFocusId ? findNode(stableRoot, requestedFocusId) : null) ?? findNode(stableRoot, state.selectedNodeId) ?? findNode(stableRoot, nextSubtree.id) ?? stableRoot;
    set((current) => ({
      ...pushHistory(current),
      atlasRoot: stableRoot,
      selected: selectionFromNode(selectedNode),
      selectedNodeId: selectedNode.id,
      multiSelectedNodeIds: current.multiSelectedNodeIds.filter((nodeId) => Boolean(findNode(stableRoot, nodeId))),
      cameraFocusNodeId: null,
      historyFuture: [],
      attachmentPreviewUrls: filterAttachmentPreviewUrls(current.attachmentPreviewUrls, stableRoot),
      unreadNotifications: restoreUnreadNotifications(stableRoot, current.unreadNotifications),
    }));
  },

  resetNotebook: () => {
    const atlasRoot = createInitialNotebook();
    const previewUrls = get().attachmentPreviewUrls;
    Object.values(previewUrls).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    clearStoredNotebook();
    persistUnreadNotifications({});
    set((state) => ({
      ...pushHistory(state),
      atlasRoot,
      selected: { kind: "node", id: atlasRoot.id },
      selectedNodeId: atlasRoot.id,
      multiSelectedNodeIds: [],
      cameraFocusNodeId: null,
      focusRequest: {
        x: 0,
        y: 0,
        z: 0,
        diameter: 420,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
        nodeId: atlasRoot.id,
      },
      attachmentPreviewUrls: {},
      birthMarks: {},
      unreadNotifications: {},
      notificationPulses: [],
      notificationSnoozePrompt: null,
      titleEditRequestId: null,
      bodyEditRequestId: null,
    }));
  },

  saveNotebook: () => {
    void persistNotebook(get().atlasRoot);
  },
  saveNotebookNow: () => persistNotebook(get().atlasRoot),

  undo: () => {
    const state = get();
    const previous = state.historyPast.at(-1);
    if (!previous) return;
    const selectedNode = findNode(previous.atlasRoot, previous.selectedNodeId) ?? previous.atlasRoot;
    persistNotebook(previous.atlasRoot);
    const unreadNotifications = restoreUnreadNotifications(previous.atlasRoot, state.unreadNotifications);
    persistUnreadNotifications(unreadNotifications);
    set({
      atlasRoot: previous.atlasRoot,
      selected: selectionFromNode(selectedNode),
      selectedNodeId: selectedNode.id,
      multiSelectedNodeIds: state.multiSelectedNodeIds.filter((nodeId) => nodeId !== selectedNode.id && findNode(previous.atlasRoot, nodeId)),
      cameraFocusNodeId: null,
      attachmentPreviewUrls: filterAttachmentPreviewUrls(state.attachmentPreviewUrls, previous.atlasRoot),
      titleEditRequestId: null,
      bodyEditRequestId: null,
      unreadNotifications,
      notificationPulses: [],
      notificationSnoozePrompt: null,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [createHistoryEntry(state.atlasRoot, state.selectedNodeId), ...state.historyFuture].slice(0, HISTORY_LIMIT),
    });
    void get().restoreAttachmentPreviews();
    get().focusNode(selectedNode.id);
  },

  redo: () => {
    const state = get();
    const next = state.historyFuture[0];
    if (!next) return;
    const selectedNode = findNode(next.atlasRoot, next.selectedNodeId) ?? next.atlasRoot;
    persistNotebook(next.atlasRoot);
    const unreadNotifications = restoreUnreadNotifications(next.atlasRoot, state.unreadNotifications);
    persistUnreadNotifications(unreadNotifications);
    set({
      atlasRoot: next.atlasRoot,
      selected: selectionFromNode(selectedNode),
      selectedNodeId: selectedNode.id,
      multiSelectedNodeIds: state.multiSelectedNodeIds.filter((nodeId) => nodeId !== selectedNode.id && findNode(next.atlasRoot, nodeId)),
      cameraFocusNodeId: null,
      attachmentPreviewUrls: filterAttachmentPreviewUrls(state.attachmentPreviewUrls, next.atlasRoot),
      titleEditRequestId: null,
      bodyEditRequestId: null,
      unreadNotifications,
      notificationPulses: [],
      notificationSnoozePrompt: null,
      historyPast: [...state.historyPast, createHistoryEntry(state.atlasRoot, state.selectedNodeId)].slice(-HISTORY_LIMIT),
      historyFuture: state.historyFuture.slice(1),
    });
    void get().restoreAttachmentPreviews();
    get().focusNode(selectedNode.id);
  },

  selectWorkArea: (id) => {
    get().focusNode(id);
  },
  selectEvent: (parentId, id) => get().focusNode(id),
  selectArtifact: (parentId, id) => get().focusNode(id),
  setViewport: (viewport) => set({ viewport }),

  setLayoutMode: (layoutMode) => set((state) => ({
    layoutMode,
    cameraFocusNodeId: null,
    focusRequest: {
      x: 0,
      y: 0,
      z: 0,
      diameter: getNodeVisualRadius(findNode(state.atlasRoot, state.selectedNodeId) ?? state.atlasRoot, 1) * 2,
      nonce: (state.focusRequest?.nonce ?? 0) + 1,
      nodeId: state.selectedNodeId,
    },
  })),

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

  focusNodeCameraOnly: (id) => {
    focusNodeCameraOnly(set, get, id);
  },

  focusParentLayerCameraOnly: () => {
    const state = get();
    const originId = state.cameraFocusNodeId && findNode(state.atlasRoot, state.cameraFocusNodeId) ? state.cameraFocusNodeId : state.selectedNodeId;
    const path = findNodePath(state.atlasRoot, originId);
    if (!path || path.length <= 2) {
      focusRootCameraOnly(set, state.atlasRoot.id);
      return;
    }
    focusNodeCameraOnly(set, get, path[path.length - 2].id);
  },

  focusSingleChildCameraOnly: () => {
    const state = get();
    const originId = state.cameraFocusNodeId && findNode(state.atlasRoot, state.cameraFocusNodeId) ? state.cameraFocusNodeId : state.selectedNodeId;
    const path = findNodePath(state.atlasRoot, originId);
    const selectedNode = path?.at(-1);
    if (selectedNode?.children.length !== 1) return;
    focusNodeCameraOnly(set, get, selectedNode.children[0].id);
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
        nodeId: state.atlasRoot.id,
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

  runAiOnSelectedNode: async (prompt, mode, optionsInput) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Node anchored AI runs intentionally receive only the user-selected node context.
    // AI Partner log and global voice summaries are excluded to avoid prompt pollution.
    const startedAt = new Date().toISOString();
    const runId = `ai-run-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const state = get();
    const sourceNodeId = state.selectedNodeId;
    const contextOptions = normalizeAiContextOptions({
      ...state.aiContextOptions,
      ...(typeof optionsInput === "string" ? { scope: optionsInput } : optionsInput),
      selectedNodeIds: state.multiSelectedNodeIds,
    });
    const sourcePath = findNodePath(state.atlasRoot, sourceNodeId);
    if (!sourcePath) return;
    const sourceParent = sourcePath?.at(-1);
    if (!sourceParent) return;
    const usedNodeIds = collectNodeIdSet(state.atlasRoot);
    const inheritedAiDialogSettings = createInheritedAiDialogSettings(sourcePath, state.aiContextOptions, state.chatSettings, state.codexSettings, state.openClawSettings, state.claudeSettings);
    const requestAiDialogSettings = createCurrentAiDialogSettings(contextOptions, inheritedAiDialogSettings.chatSettings, inheritedAiDialogSettings.codexSettings, inheritedAiDialogSettings.openClawSettings, inheritedAiDialogSettings.claudeSettings);
    const chatSettingsForRun = isChatLikeMode(mode) ? buildChatSettingsForRun(requestAiDialogSettings.chatSettings, mode) : undefined;
    if (mode === "codex" && !requestAiDialogSettings.codexSettings.workspace.trim()) {
      return;
    }
    // Session continuation is decided automatically before the request node is
    // inserted, so the divergence check sees the tree as the user left it.
    const forceNewSession = state.forceNewAgentSession;
    const session = resolveAgentSessionForRun(state.atlasRoot, sourceNodeId, mode, requestAiDialogSettings, forceNewSession);
    if (forceNewSession) set({ forceNewAgentSession: false });
    const requestNode = createAiRequestNode(sourceNodeId, sourceParent.children.length, runId, mode, trimmed, {
      aiDialogSettings: requestAiDialogSettings,
      codexThreadId:
        mode === "codex"
          ? (session?.action === "continue" ? session.resumeId : undefined)
          : getCodexThreadIdForNewChild(sourcePath, requestAiDialogSettings),
      codexLogPath: inferCodexLogPathFromNodePath(sourcePath),
      openClawSessionKey:
        mode === "openclaw"
          ? (session?.action === "continue" ? session.resumeId : undefined)
          : getOpenClawSessionKeyForNewChild(sourcePath, requestAiDialogSettings),
      openClawLogPath: inferOpenClawLogPathFromNodePath(sourcePath),
      claudeLogPath: inferClaudeLogPathFromNodePath(sourcePath),
      claudeSessionId: mode === "claude" ? (session?.action === "continue" ? session.resumeId : undefined) : inferClaudeSessionIdFromNodePath(sourcePath),
      usedNodeIds,
    });

    const initialRun: AiRun = {
      id: runId,
      nodeId: sourceNodeId,
      requestNodeId: requestNode.id,
      provider: providerForMode(mode),
      mode,
      modelId: chatSettingsForRun
        ? chatSettingsForRun.model || chatSettingsForRun.service
        : mode === "codex"
        ? requestAiDialogSettings.codexSettings.model
        : mode === "openclaw"
          ? requestAiDialogSettings.openClawSettings.model || "openclaw-default"
          : mode === "claude"
            ? requestAiDialogSettings.claudeSettings.model || "claude-code-default"
            : "",
      status: "running",
      prompt: trimmed,
      startedAt,
    };
    let activeRun = initialRun;

    set((current) => {
      const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
        ...node,
        status: "running",
        nextDecision: `${modeLabel(mode)} is reading this node and preparing a child result.`,
        updatedAt: new Date().toISOString(),
        children: [...node.children, requestNode],
      })));
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
        birthMarks: { ...current.birthMarks, [requestNode.id]: performance.now() },
        aiRuns: { ...current.aiRuns, [runId]: initialRun },
      };
    });

    try {
      const budget = session
        ? CONTEXT_BUDGET_PRESETS.agent
        : chatSettingsForRun?.service === "local"
          ? CONTEXT_BUDGET_PRESETS.local
          : CONTEXT_BUDGET_PRESETS.chat;
      const plan = buildContextPlan(state.atlasRoot, sourceNodeId, { ...budget, pinnedNodeIds: state.multiSelectedNodeIds });
      const context = buildSlimLegacyContext(state.atlasRoot, sourceNodeId);
      if (!plan || !context) throw new Error("AI context could not be built.");
      const codexSettingsForRun = mode === "codex" && session ? buildCodexSettingsForRun(requestAiDialogSettings.codexSettings, sourcePath, session) : undefined;
      const openClawSettingsForRun = mode === "openclaw" && session ? buildOpenClawSettingsForRun(requestAiDialogSettings.openClawSettings, session) : undefined;
      const claudeSettingsForRun = mode === "claude" && session ? buildClaudeSettingsForRun(requestAiDialogSettings.claudeSettings, sourcePath, session) : undefined;
      if (mode === "codex" && codexSettingsForRun) {
        const conflict = findActiveCodexRunForWorkspace(get().aiRuns, codexSettingsForRun.workspace, runId);
        if (conflict) {
          throw new Error(`Codex is already running for this work root: ${codexSettingsForRun.workspace || "(default workspace)"}\nActive run: ${conflict.id}`);
        }
      }
      if (mode === "claude" && claudeSettingsForRun) {
        const conflict = findActiveClaudeRunForWorkspace(get().aiRuns, claudeSettingsForRun.workspace, runId);
        if (conflict) {
          throw new Error(`Claude Code is already running for this work root: ${claudeSettingsForRun.workspace || "(default Claude workspace)"}\nActive run: ${conflict.id}`);
        }
      }
      activeRun = {
        ...activeRun,
        provider: chatSettingsForRun ? chatProvider(chatSettingsForRun) : activeRun.provider,
        modelId: chatSettingsForRun?.model ?? codexSettingsForRun?.model ?? openClawSettingsForRun?.model ?? claudeSettingsForRun?.model ?? activeRun.modelId,
        contextStats: {
          ...context.stats,
          estimatedInputTokens: plan.stats.estimatedTokens,
          includedNodeCount: plan.stats.includedNodeCount,
          truncated: plan.stats.truncated,
        },
        workspace: codexSettingsForRun?.workspace ?? openClawSettingsForRun?.workspace ?? claudeSettingsForRun?.workspace,
        codexThreadId: codexSettingsForRun?.resumeThreadId,
        openClawSessionKey: openClawSettingsForRun?.resumeSessionKey || openClawSettingsForRun?.sessionKey,
        claudeSessionId: claudeSettingsForRun?.resumeSessionId,
        sessionInfo: session,
      };
      set((current) => ({
        aiRuns: { ...current.aiRuns, [runId]: activeRun },
      }));

      const result = await requestAiResponse({
        prompt: trimmed,
        context,
        contextText: plan.contextText,
        chatMessages: chatSettingsForRun ? [...plan.conversation, { role: "user", content: trimmed }] : undefined,
        agentPrompt: session ? renderAgentContextPrompt(plan, trimmed) : undefined,
        agentDeltaPrompt: session && session.action !== "new" ? renderAgentDeltaPrompt(state.atlasRoot, sourceNodeId, trimmed) : undefined,
        session,
        provider: mode,
        model: chatSettingsForRun?.model ?? codexSettingsForRun?.model ?? openClawSettingsForRun?.model ?? claudeSettingsForRun?.model,
        chat: chatSettingsForRun,
        codex: codexSettingsForRun
          ? {
              ...codexSettingsForRun,
              clientRunId: runId,
              requestNodeId: requestNode.id,
              sourceNodeId,
            }
          : undefined,
        openclaw: openClawSettingsForRun
          ? {
              ...openClawSettingsForRun,
              clientRunId: runId,
              requestNodeId: requestNode.id,
              sourceNodeId,
            }
          : undefined,
        claude: claudeSettingsForRun
          ? {
              ...claudeSettingsForRun,
              clientRunId: runId,
              requestNodeId: requestNode.id,
              sourceNodeId,
            }
          : undefined,
      });
      notifyLocalOutputTruncated(result.provider === "local" ? "local" : mode, result.usage);
      let responseNodeId = "";
      let generatedAttachmentBlobs: Array<{ attachment: NodeAttachment; blob: Blob }> = [];
      set((current) => {
        const parent = findNode(current.atlasRoot, requestNode.id);
        if (!parent) return current;
        const completedAt = new Date().toISOString();
        const generatedChildren = result.codexNodes?.length
          ? createCodexGeneratedNodeTrees(
              requestNode.id,
              parent.children.length,
              runId,
              mode,
              result.model,
              result.codexNodes,
              result.usage,
              result.codexThreadId,
              result.codexLogPath,
              sourcePath.length + 1,
              parent.id,
              parent.aiDialogSettings,
              collectNodeIdSet(current.atlasRoot),
            )
          : [
              createAiResponseNode(
                requestNode.id,
                parent.children.length,
                runId,
                result.provider,
                mode,
                result.model,
                result.output,
                result.usage,
                {
                  aiDialogSettings: parent.aiDialogSettings,
                  codexThreadId: result.codexThreadId ?? parent.codexThreadId,
                  codexLogPath: result.codexLogPath ?? parent.codexLogPath,
                  openClawSessionKey: result.openClawSessionKey ?? parent.openClawSessionKey,
                  openClawLogPath: result.openClawLogPath ?? parent.openClawLogPath,
                  claudeLogPath: result.claudeLogPath ?? parent.claudeLogPath,
                  claudeSessionId: result.claudeSessionId ?? parent.claudeSessionId,
                  usedNodeIds: collectNodeIdSet(current.atlasRoot),
                },
              ),
            ];
        const generatedAttachments = createGeneratedAttachmentRecords(generatedChildren[0]?.id ?? requestNode.id, result.generatedAttachments ?? [], completedAt);
        generatedAttachmentBlobs = generatedAttachments.blobs;
        const children = generatedChildren.map((child, index) =>
          index === 0
            ? {
                ...child,
                attachments: [...child.attachments, ...generatedAttachments.attachments],
              }
            : child,
        );
        responseNodeId = children.at(-1)?.id ?? children[0]?.id ?? "";
        const attachmentPreviewUrls = {
          ...current.attachmentPreviewUrls,
          ...generatedAttachments.previewUrls,
        };
        const pulseTargets = getCodexPulseTargetIds(children);
        const resultNotificationKind = aiResultNotificationKind(mode);
        const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(
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
          codexThreadId: result.codexThreadId ?? node.codexThreadId,
          codexLogPath: result.codexLogPath ?? node.codexLogPath,
          openClawSessionKey: result.openClawSessionKey ?? node.openClawSessionKey,
          openClawLogPath: result.openClawLogPath ?? node.openClawLogPath,
          claudeLogPath: result.claudeLogPath ?? node.claudeLogPath,
          claudeSessionId: result.claudeSessionId ?? node.claudeSessionId,
          children: [...node.children, ...children],
          }),
        ));
        persistNotebook(atlasRoot);
        return {
          ...pushHistory(current),
          atlasRoot,
          attachmentPreviewUrls,
          birthMarks: {
            ...current.birthMarks,
            ...Object.fromEntries(collectNodeIdsFromMany(children).map((id) => [id, performance.now()])),
          },
          notificationPulses: [
            ...current.notificationPulses,
            ...pulseTargets.map((id) => createNotificationPulse(id, resultNotificationKind, `${modeLabel(mode)} result ready`)),
          ],
          unreadNotifications: markUnreadNotifications(
            current.unreadNotifications,
            pulseTargets,
            resultNotificationKind,
            `${modeLabel(mode)} result ready`,
          ),
          aiRuns: {
            ...current.aiRuns,
            [runId]: {
              ...activeRun,
              provider: result.provider,
              modelId: result.model,
              status: "needs_review",
              completedAt,
              responseNodeId,
              usage: result.usage,
              workspace: codexSettingsForRun?.workspace ?? openClawSettingsForRun?.workspace ?? claudeSettingsForRun?.workspace,
              codexThreadId: result.codexThreadId,
              codexLogPath: result.codexLogPath,
              openClawSessionKey: result.openClawSessionKey,
              openClawLogPath: result.openClawLogPath,
              claudeLogPath: result.claudeLogPath,
              claudeSessionId: result.claudeSessionId,
              sessionInfo: result.sessionInfo ?? session,
            },
          },
        };
      });
      void Promise.all(generatedAttachmentBlobs.map(({ attachment, blob }) => saveStoredAttachmentBlob(attachment, blob))).catch((error) => {
        console.error("Failed to store generated attachment blob", error);
      });
      if (mode === "codex" || mode === "claude" || mode === "openclaw") {
        void acknowledgeAgentRuns({ clientRunIds: [runId] }).catch((error) => {
          console.warn("Agent run acknowledgement failed", error);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed.";
      set((current) => {
        const completedAt = new Date().toISOString();
        const parent = findNode(current.atlasRoot, requestNode.id);
        const usedNodeIds = collectNodeIdSet(current.atlasRoot);
        const errorNode = createAiErrorNode(requestNode.id, runId, mode, message, {
          aiDialogSettings: requestNode.aiDialogSettings,
          codexThreadId: requestNode.codexThreadId,
          codexLogPath: requestNode.codexLogPath,
          openClawSessionKey: requestNode.openClawSessionKey,
          openClawLogPath: requestNode.openClawLogPath,
          claudeLogPath: requestNode.claudeLogPath,
          usedNodeIds,
        });
        const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(
          updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
            ...node,
            status: "error",
            nextDecision: message,
            propagatedErrorSourceId: errorNode.id,
            updatedAt: completedAt,
          })),
          requestNode.id,
          (node) => ({
          ...node,
          status: "error",
          nextDecision: message,
          propagatedErrorSourceId: errorNode.id,
          updatedAt: completedAt,
          children: [...node.children, errorNode],
          }),
        ));
        persistNotebook(atlasRoot);
        return {
          ...pushHistory(current),
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
              ...activeRun,
              status: "error",
              completedAt,
              error: message,
              responseNodeId: errorNode.id,
            },
          },
        };
      });
      if (mode === "codex" || mode === "claude" || mode === "openclaw") {
        void acknowledgeAgentRuns({ clientRunIds: [runId] }).catch((acknowledgementError) => {
          console.warn("Agent run acknowledgement failed", acknowledgementError);
        });
      }
    }
  },

  runNodeAction: async (nodeId) => {
    const state = get();
    const actionNode = findNode(state.atlasRoot, nodeId);
    const action = actionNode?.action;
    if (!action) return;

    if (action.kind === "git_push") {
      const startedAt = new Date().toISOString();
      set((current) => {
        const atlasRoot = updateNodeById(current.atlasRoot, nodeId, (node) => ({
          ...node,
          status: "running",
          nextDecision: "Pushing changes to the remote repository.",
          updatedAt: startedAt,
        }));
        persistNotebook(atlasRoot);
        return { ...pushHistory(current), atlasRoot };
      });
      try {
        const result = await requestGitPush(action.workspace);
        const completedAt = new Date().toISOString();
        set((current) => {
          const atlasRoot = updateNodeById(current.atlasRoot, nodeId, (node) => {
            const { action: _action, ...rest } = node;
            return {
              ...rest,
              status: result.ok ? "done" : "error",
              body: [
                node.body,
                "",
                "# Git push",
                `Exit code: ${result.exitCode}`,
                result.stdout ? `\nstdout:\n${result.stdout}` : "",
                result.stderr ? `\nstderr:\n${result.stderr}` : "",
              ].filter(Boolean).join("\n"),
              summary: result.ok ? "Git push completed." : "Git push failed.",
              nextDecision: result.ok ? "Remote repository has the latest pushed changes." : "Review the git push output.",
              updatedAt: completedAt,
            };
          });
          persistNotebook(atlasRoot);
          return {
            ...pushHistory(current),
            atlasRoot,
            notificationPulses: [...current.notificationPulses, createNotificationPulse(nodeId, result.ok ? "done" : "error", result.ok ? "Git push completed" : "Git push failed")],
            unreadNotifications: markUnreadNotification(current.unreadNotifications, nodeId, result.ok ? "done" : "error", result.ok ? "Git push completed" : "Git push failed"),
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git push failed.";
        const completedAt = new Date().toISOString();
        set((current) => {
          const atlasRoot = updateNodeById(current.atlasRoot, nodeId, (node) => ({
            ...node,
            status: "error",
            body: `${node.body}\n\n# Git push\n${message}`,
            summary: "Git push failed.",
            nextDecision: message,
            updatedAt: completedAt,
          }));
          persistNotebook(atlasRoot);
          return {
            ...pushHistory(current),
            atlasRoot,
            notificationPulses: [...current.notificationPulses, createNotificationPulse(nodeId, "error", "Git push failed")],
            unreadNotifications: markUnreadNotification(current.unreadNotifications, nodeId, "error", "Git push failed"),
          };
        });
      }
      return;
    }

    if (action.kind !== "codex_full_access") return;

    if (action.decision === "deny") {
      const completedAt = new Date().toISOString();
      set((current) => {
        const atlasRoot = updateNodeById(current.atlasRoot, nodeId, (node) => {
          const { action: _action, ...rest } = node;
          return {
            ...rest,
            status: "done",
            body: `${node.body}\n\nFull access was denied.`,
            summary: "Full access denied.",
            nextDecision: "Retry Codex with workspace-write or adjust the request.",
            updatedAt: completedAt,
          };
        });
        persistNotebook(atlasRoot);
        return {
          ...pushHistory(current),
          atlasRoot,
          notificationPulses: [...current.notificationPulses, createNotificationPulse(nodeId, "done", "Full access denied")],
          unreadNotifications: markUnreadNotification(current.unreadNotifications, nodeId, "done", "Full access denied"),
        };
      });
      return;
    }

    const actionPath = findNodePath(state.atlasRoot, nodeId);
    const retryParentId = actionPath && actionPath.length >= 2 ? actionPath[actionPath.length - 2].id : nodeId;
    const retryParentPath = retryParentId === nodeId ? actionPath : findNodePath(state.atlasRoot, retryParentId);
    const retryParent = retryParentPath?.at(-1);
    if (!actionPath || !retryParentPath || !retryParent) return;

    const startedAt = new Date().toISOString();
    const runId = `${action.runId}-retry-${Date.now()}`;
    const codexSettings = normalizeCodexSettings({
      ...action.settings,
      sandbox: "danger-full-access",
      fullAccessApproved: true,
    });
    const conflict = findActiveCodexRunForWorkspace(get().aiRuns, codexSettings.workspace, runId);
    if (conflict) {
      const completedAt = new Date().toISOString();
      set((current) => {
        const atlasRoot = updateNodeById(current.atlasRoot, nodeId, (node) => ({
          ...node,
          status: "blocked",
          nextDecision: `Codex is already running for this work root: ${codexSettings.workspace || "(default workspace)"}`,
          updatedAt: completedAt,
        }));
        persistNotebook(atlasRoot);
        return { ...pushHistory(current), atlasRoot };
      });
      return;
    }

    set((current) => {
      const atlasRoot = updateNodeById(
        updateNodeById(current.atlasRoot, nodeId, (node) => {
          const { action: _action, ...rest } = node;
          return {
            ...rest,
            status: "done",
            nextDecision: "Full access was approved.",
            updatedAt: startedAt,
          };
        }),
        retryParentId,
        (node) => ({
          ...node,
          status: "running",
          nextDecision: "Codex is retrying this request with approved Full access.",
          updatedAt: startedAt,
          children: removeCodexRetryResultChildren(node.children),
        }),
      );
      persistNotebook(atlasRoot);
      return {
        ...pushHistory(current),
        atlasRoot,
      };
    });

    const retryPlan = buildContextPlan(state.atlasRoot, action.sourceNodeId, CONTEXT_BUDGET_PRESETS.agent);
    const context = buildSlimLegacyContext(state.atlasRoot, action.sourceNodeId);
    if (!retryPlan || !context) return;
    // The retry continues the failed run's own thread when one was recorded,
    // so Codex keeps what it already attempted before the permission block.
    const retrySession: AgentSessionResolution = codexSettings.resumeThreadId
      ? { action: "continue", resumeId: codexSettings.resumeThreadId, reason: "full-access-retry" }
      : { action: "new", reason: "full-access-retry" };
    const initialRun: AiRun = {
      id: runId,
      nodeId: action.sourceNodeId,
      requestNodeId: retryParentId,
      provider: "codex",
      mode: "codex",
      modelId: codexSettings.model,
      status: "running",
      prompt: action.prompt,
      startedAt,
      contextStats: context.stats,
      workspace: codexSettings.workspace,
      codexThreadId: codexSettings.resumeThreadId,
    };
    set((current) => ({
      aiRuns: { ...current.aiRuns, [runId]: initialRun },
    }));

    try {
      const result = await requestAiResponse({
        prompt: action.prompt,
        context,
        contextText: retryPlan.contextText,
        agentPrompt: renderAgentContextPrompt(retryPlan, action.prompt),
        agentDeltaPrompt: retrySession.action === "continue" ? renderAgentDeltaPrompt(state.atlasRoot, action.sourceNodeId, action.prompt) : undefined,
        session: retrySession,
        provider: "codex",
        model: codexSettings.model,
        codex: {
          ...codexSettings,
          clientRunId: runId,
          requestNodeId: retryParentId,
          sourceNodeId: action.sourceNodeId,
        },
      });
      set((current) => {
        const parent = findNode(current.atlasRoot, retryParentId);
        if (!parent) return current;
        const completedAt = new Date().toISOString();
        const children = result.codexNodes?.length
          ? createCodexGeneratedNodeTrees(
              retryParentId,
              parent.children.length,
              runId,
              "codex",
              result.model,
              result.codexNodes,
              result.usage,
              result.codexThreadId,
              result.codexLogPath,
              retryParentPath.length,
              retryParentId,
              parent.aiDialogSettings,
              collectNodeIdSet(current.atlasRoot),
            )
          : [
              createAiResponseNode(retryParentId, parent.children.length, runId, "codex", "codex", result.model, result.output, result.usage, {
                aiDialogSettings: parent.aiDialogSettings,
                codexThreadId: result.codexThreadId ?? parent.codexThreadId,
                codexLogPath: result.codexLogPath ?? parent.codexLogPath,
                usedNodeIds: collectNodeIdSet(current.atlasRoot),
              }),
            ];
        const pulseTargets = getCodexPulseTargetIds(children);
        const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, retryParentId, (node) => ({
            ...node,
            status: "needs_review",
            nextDecision: "Review the Full access Codex retry output.",
            updatedAt: completedAt,
            codexThreadId: result.codexThreadId ?? node.codexThreadId,
            codexLogPath: result.codexLogPath ?? node.codexLogPath,
            children: [...removeCodexRetryResultChildren(node.children), ...children],
        })));
        persistNotebook(atlasRoot);
        return {
          ...pushHistory(current),
          atlasRoot,
          birthMarks: {
            ...current.birthMarks,
            ...Object.fromEntries(collectNodeIdsFromMany(children).map((id) => [id, performance.now()])),
          },
          notificationPulses: [
            ...current.notificationPulses,
            ...pulseTargets.map((id) => createNotificationPulse(id, "codex", "Codex Full access result ready")),
          ],
          unreadNotifications: markUnreadNotifications(current.unreadNotifications, pulseTargets, "codex", "Codex Full access result ready"),
          aiRuns: {
            ...current.aiRuns,
            [runId]: {
              ...initialRun,
              provider: result.provider,
              modelId: result.model,
              status: "needs_review",
              completedAt,
              responseNodeId: children.at(-1)?.id ?? children[0]?.id,
              usage: result.usage,
              workspace: codexSettings.workspace,
              codexThreadId: result.codexThreadId,
              codexLogPath: result.codexLogPath,
            },
          },
        };
      });
      void acknowledgeAgentRuns({ clientRunIds: [runId] }).catch((error) => {
        console.warn("Codex retry acknowledgement failed", error);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Codex Full access retry failed.";
      set((current) => {
        const completedAt = new Date().toISOString();
        const parent = findNode(current.atlasRoot, retryParentId);
        const usedNodeIds = collectNodeIdSet(current.atlasRoot);
        const errorNode = createAiErrorNode(retryParentId, runId, "codex", message, {
          aiDialogSettings: parent?.aiDialogSettings,
          codexThreadId: parent?.codexThreadId,
          codexLogPath: parent?.codexLogPath,
          usedNodeIds,
        });
        const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(current.atlasRoot, retryParentId, (node) => ({
          ...node,
          status: "error",
          nextDecision: message,
          updatedAt: completedAt,
          children: [...removeCodexRetryResultChildren(node.children), errorNode],
        })));
        persistNotebook(atlasRoot);
        return {
          ...pushHistory(current),
          atlasRoot,
          birthMarks: { ...current.birthMarks, [errorNode.id]: performance.now() },
          notificationPulses: [...current.notificationPulses, createNotificationPulse(errorNode.id, "error", "Codex Full access retry failed")],
          unreadNotifications: markUnreadNotification(current.unreadNotifications, errorNode.id, "error", "Codex Full access retry failed"),
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
      void acknowledgeAgentRuns({ clientRunIds: [runId] }).catch((acknowledgementError) => {
        console.warn("Codex retry acknowledgement failed", acknowledgementError);
      });
    }
  },

  recoverCompletedCodexRuns: async () => {
    const candidates = collectRecoverableCodexRequests(get().atlasRoot);
    for (const candidate of candidates) {
      try {
        const recovery = await recoverCodexRun(candidate);
        if (!recovery.found || !recovery.result) continue;
        const recoveredResult = recovery.result;
        set((current) => {
          const requestPath = findNodePath(current.atlasRoot, candidate.requestNodeId ?? "");
          const requestNode = requestPath?.at(-1);
          if (!requestPath || !requestNode || requestNode.status !== "running" || requestNode.children.length) return current;

          const runId = requestNode.aiRunId ?? requestNode.sourceId ?? candidate.runId ?? `codex-recovered-${Date.now()}`;
          const completedAt = typeof recovery.metadata?.completedAt === "string" ? recovery.metadata.completedAt : new Date().toISOString();
          const usedNodeIds = collectNodeIdSet(current.atlasRoot);
          const children = recoveredResult.codexNodes?.length
            ? createCodexGeneratedNodeTrees(
                requestNode.id,
                requestNode.children.length,
                runId,
                "codex",
                recoveredResult.model,
                recoveredResult.codexNodes,
                recoveredResult.usage,
                recoveredResult.codexThreadId,
                recoveredResult.codexLogPath ?? recovery.logPath,
                requestPath.length,
                requestNode.id,
                requestNode.aiDialogSettings,
                usedNodeIds,
              )
            : [
                createAiResponseNode(
                  requestNode.id,
                  requestNode.children.length,
                  runId,
                  recoveredResult.provider,
                  "codex",
                  recoveredResult.model,
                  recoveredResult.output,
                  recoveredResult.usage,
                  {
                    aiDialogSettings: requestNode.aiDialogSettings,
                    codexThreadId: recoveredResult.codexThreadId ?? requestNode.codexThreadId,
                    codexLogPath: recoveredResult.codexLogPath ?? recovery.logPath ?? requestNode.codexLogPath,
                    usedNodeIds,
                  },
                ),
              ];
          const pulseTargets = getCodexPulseTargetIds(children);
          const sourceNodeId = requestNode.sourceParentId || candidate.sourceNodeId || requestPath.at(-2)?.id || requestNode.id;
          const withSourceUpdated = sourceNodeId
            ? updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
                ...node,
                status: recoveredResult.output.suggestedStatus === "done" ? "needs_review" : recoveredResult.output.suggestedStatus,
                nextDecision: "Recovered completed Codex result from the local run log.",
                updatedAt: completedAt,
              }))
            : current.atlasRoot;
          const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(withSourceUpdated, requestNode.id, (node) => ({
            ...node,
            status: recoveredResult.output.suggestedStatus === "done" ? "needs_review" : recoveredResult.output.suggestedStatus,
            nextDecision: "Recovered completed Codex result from the local run log.",
            updatedAt: completedAt,
            codexThreadId: recoveredResult.codexThreadId ?? node.codexThreadId,
            codexLogPath: recoveredResult.codexLogPath ?? recovery.logPath ?? node.codexLogPath,
            children: [...node.children, ...children],
          })));
          persistNotebook(atlasRoot);
          return {
            ...pushHistory(current),
            atlasRoot,
            birthMarks: {
              ...current.birthMarks,
              ...Object.fromEntries(collectNodeIdsFromMany(children).map((id) => [id, performance.now()])),
            },
            notificationPulses: [
              ...current.notificationPulses,
              ...pulseTargets.map((id) => createNotificationPulse(id, "codex", "Recovered Codex result ready")),
            ],
            unreadNotifications: markUnreadNotifications(current.unreadNotifications, pulseTargets, "codex", "Recovered Codex result ready"),
            aiRuns: {
              ...current.aiRuns,
              [runId]: {
                id: runId,
                nodeId: sourceNodeId,
                requestNodeId: requestNode.id,
                provider: recoveredResult.provider,
                mode: "codex",
                modelId: recoveredResult.model,
                status: "needs_review",
                prompt: requestNode.body,
                startedAt: requestNode.createdAt,
                completedAt,
                responseNodeId: children.at(-1)?.id ?? children[0]?.id,
                usage: recoveredResult.usage,
                workspace: candidate.workspace,
                codexThreadId: recoveredResult.codexThreadId,
                codexLogPath: recoveredResult.codexLogPath ?? recovery.logPath,
              },
            },
          };
        });
      } catch (error) {
        console.warn("Codex run recovery failed", error);
      }
    }
  },

  recoverMissedAgentRuns: async () => {
    const inbox = await getAgentRunInbox();
    for (const item of inbox.items) {
      const alreadyLogged = get().voiceLogEntries.some((entry) => entry.metadata?.agentRecoveryId === item.id);
      let nodeDisposition: "missing" | "already-resolved" | "recovered" = "missing";
      let fallbackLogged = false;
      if (!alreadyLogged && item.requestNodeId) {
        set((current) => {
          const requestPath = findNodePath(current.atlasRoot, item.requestNodeId ?? "");
          const requestNode = requestPath?.at(-1);
          if (!requestPath || !requestNode) return current;
          if (requestNode.status !== "running" || requestNode.children.length > 0) {
            nodeDisposition = "already-resolved";
            return current;
          }

          const runId = item.clientRunId || requestNode.aiRunId || requestNode.sourceId || `agent-recovered-${item.id}`;
          const completedAt = item.completedAt || new Date().toISOString();
          const sourceNodeId = requestNode.sourceParentId || item.sourceNodeId || requestPath.at(-2)?.id || requestNode.id;
          const result = item.status === "completed" ? item.result : undefined;
          if (result?.output) {
            const usedNodeIds = collectNodeIdSet(current.atlasRoot);
            const children = result.codexNodes?.length
              ? createCodexGeneratedNodeTrees(
                  requestNode.id,
                  requestNode.children.length,
                  runId,
                  item.provider,
                  result.model,
                  result.codexNodes,
                  result.usage,
                  result.codexThreadId,
                  result.codexLogPath,
                  requestPath.length,
                  requestNode.id,
                  requestNode.aiDialogSettings,
                  usedNodeIds,
                )
              : [
                  createAiResponseNode(
                    requestNode.id,
                    requestNode.children.length,
                    runId,
                    result.provider,
                    item.provider,
                    result.model,
                    result.output,
                    result.usage,
                    {
                      aiDialogSettings: requestNode.aiDialogSettings,
                      codexThreadId: result.codexThreadId ?? requestNode.codexThreadId,
                      codexLogPath: result.codexLogPath ?? requestNode.codexLogPath,
                      openClawSessionKey: result.openClawSessionKey ?? requestNode.openClawSessionKey,
                      openClawLogPath: result.openClawLogPath ?? requestNode.openClawLogPath,
                      claudeLogPath: result.claudeLogPath ?? requestNode.claudeLogPath,
                      claudeSessionId: result.claudeSessionId ?? requestNode.claudeSessionId,
                      usedNodeIds,
                    },
                  ),
                ];
            const recoveredStatus = result.output.suggestedStatus === "done" ? "needs_review" : result.output.suggestedStatus;
            const withSourceUpdated = sourceNodeId
              ? updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
                  ...node,
                  status: recoveredStatus,
                  nextDecision: `Recovered ${modeLabel(item.provider)} result after reconnecting to the local bridge.`,
                  updatedAt: completedAt,
                }))
              : current.atlasRoot;
            const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(withSourceUpdated, requestNode.id, (node) => ({
              ...node,
              status: recoveredStatus,
              nextDecision: `Recovered ${modeLabel(item.provider)} result after reconnecting to the local bridge.`,
              updatedAt: completedAt,
              codexThreadId: result.codexThreadId ?? node.codexThreadId,
              codexLogPath: result.codexLogPath ?? node.codexLogPath,
              openClawSessionKey: result.openClawSessionKey ?? node.openClawSessionKey,
              openClawLogPath: result.openClawLogPath ?? node.openClawLogPath,
              claudeLogPath: result.claudeLogPath ?? node.claudeLogPath,
              claudeSessionId: result.claudeSessionId ?? node.claudeSessionId,
              children: [...node.children, ...children],
            })));
            const pulseTargets = getCodexPulseTargetIds(children);
            const notificationKind = aiResultNotificationKind(item.provider);
            const notificationTitle = `Recovered ${modeLabel(item.provider)} result ready`;
            persistNotebook(atlasRoot);
            nodeDisposition = "recovered";
            return {
              ...pushHistory(current),
              atlasRoot,
              birthMarks: {
                ...current.birthMarks,
                ...Object.fromEntries(collectNodeIdsFromMany(children).map((id) => [id, performance.now()])),
              },
              notificationPulses: [
                ...current.notificationPulses,
                ...pulseTargets.map((id) => createNotificationPulse(id, notificationKind, notificationTitle)),
              ],
              unreadNotifications: markUnreadNotifications(current.unreadNotifications, pulseTargets, notificationKind, notificationTitle),
              aiRuns: {
                ...current.aiRuns,
                [runId]: {
                  id: runId,
                  nodeId: sourceNodeId,
                  requestNodeId: requestNode.id,
                  provider: result.provider,
                  mode: item.provider,
                  modelId: result.model,
                  status: "needs_review",
                  prompt: requestNode.body,
                  startedAt: item.startedAt || requestNode.createdAt,
                  completedAt,
                  responseNodeId: children.at(-1)?.id ?? children[0]?.id,
                  usage: result.usage,
                  workspace: item.workspace,
                  codexThreadId: result.codexThreadId,
                  codexLogPath: result.codexLogPath,
                  openClawSessionKey: result.openClawSessionKey,
                  openClawLogPath: result.openClawLogPath,
                  claudeLogPath: result.claudeLogPath,
                  claudeSessionId: result.claudeSessionId,
                  sessionInfo: result.sessionInfo,
                },
              },
            };
          }

          const message = item.error || `${modeLabel(item.provider)} ended without a recoverable result.`;
          const errorNode = createAiErrorNode(requestNode.id, runId, item.provider, message, {
            aiDialogSettings: requestNode.aiDialogSettings,
            codexThreadId: requestNode.codexThreadId,
            codexLogPath: requestNode.codexLogPath,
            openClawSessionKey: requestNode.openClawSessionKey,
            openClawLogPath: requestNode.openClawLogPath,
            claudeLogPath: requestNode.claudeLogPath,
            usedNodeIds: collectNodeIdSet(current.atlasRoot),
          });
          const withSourceUpdated = sourceNodeId
            ? updateNodeById(current.atlasRoot, sourceNodeId, (node) => ({
                ...node,
                status: "error",
                nextDecision: message,
                propagatedErrorSourceId: errorNode.id,
                updatedAt: completedAt,
              }))
            : current.atlasRoot;
          const atlasRoot = stabilizePhyllotaxisPositions(updateNodeById(withSourceUpdated, requestNode.id, (node) => ({
            ...node,
            status: "error",
            nextDecision: message,
            propagatedErrorSourceId: errorNode.id,
            updatedAt: completedAt,
            children: [...node.children, errorNode],
          })));
          const notificationTitle = `Recovered ${modeLabel(item.provider)} error`;
          persistNotebook(atlasRoot);
          nodeDisposition = "recovered";
          return {
            ...pushHistory(current),
            atlasRoot,
            birthMarks: { ...current.birthMarks, [errorNode.id]: performance.now() },
            notificationPulses: [...current.notificationPulses, createNotificationPulse(errorNode.id, "error", notificationTitle)],
            unreadNotifications: markUnreadNotification(current.unreadNotifications, errorNode.id, "error", notificationTitle),
            aiRuns: {
              ...current.aiRuns,
              [runId]: {
                id: runId,
                nodeId: sourceNodeId,
                requestNodeId: requestNode.id,
                provider: item.provider,
                mode: item.provider,
                modelId: item.model || item.provider,
                status: "error",
                prompt: requestNode.body,
                startedAt: item.startedAt || requestNode.createdAt,
                completedAt,
                responseNodeId: errorNode.id,
                error: message,
                workspace: item.workspace,
              },
            },
          };
        });
      }

      if (!alreadyLogged && nodeDisposition === "missing") {
        const recoveredText = item.status === "completed" && item.result?.output
          ? item.result.output.body.trim() || item.result.output.summary || "(No text response.)"
          : item.error || `${modeLabel(item.provider)} ended without a recoverable result.`;
        get().appendVoiceLogEntry({
          id: `agent-recovery-${item.id}`,
          role: item.status === "completed" ? "assistant" : "error",
          title: item.status === "completed"
            ? `Recovered ${modeLabel(item.provider)} result`
            : `Recovered ${modeLabel(item.provider)} error`,
          text: [
            item.prompt ? `Request: ${item.prompt}` : "",
            recoveredText,
          ].filter(Boolean).join("\n\n"),
          sessionId: `agent-recovery-${item.id}`,
          status: item.status === "completed" ? "done" : "error",
          metadata: {
            agentRecoveryId: item.id,
            provider: item.provider,
            model: item.result?.model || item.model,
            workspace: item.workspace,
            originalCompletedAt: item.completedAt,
          },
        });
        fallbackLogged = true;
      }

      if (alreadyLogged || nodeDisposition !== "missing" || fallbackLogged) {
        try {
          await acknowledgeAgentRuns({ ids: [item.id] });
        } catch (error) {
          console.warn("Agent run acknowledgement failed", error);
        }
      }
    }
  },

  tickNotificationPulses: () => {
    const now = performance.now();
    const nowDate = Date.now();
    const firedAt = new Date(nowDate).toISOString();
    const cutoff = now - NOTIFICATION_PULSE_DURATION_MS - 420;
    set((state) => {
      let atlasRoot = state.atlasRoot;
      const dueReminders = collectDueReminderNodes(atlasRoot, nowDate);
      if (dueReminders.length) {
        atlasRoot = markReminderNodesFired(atlasRoot, new Set(dueReminders.map((node) => node.id)), firedAt);
        persistNotebook(atlasRoot);
      }
        const notificationPulses = state.notificationPulses.filter((pulse) => pulse.createdAt >= cutoff);
        let unreadNotifications = restoreUnreadNotifications(atlasRoot, state.unreadNotifications);
        for (const node of dueReminders) {
          const title = `Reminder: ${node.title || "Untitled node"}`;
          if (!canCreateNotificationPulse(atlasRoot, node.id)) continue;
          notificationPulses.push(createNotificationPulse(node.id, "needs_review", title));
          unreadNotifications = markUnreadNotification(
            unreadNotifications,
            node.id,
            "needs_review",
            title,
            reminderNotificationSignatureFromParts(node.id, node.reminderAt, firedAt),
          );
        }
        for (const unread of Object.values(unreadNotifications)) {
          if (!canCreateNotificationPulse(atlasRoot, unread.nodeId)) continue;
          if (now - unread.lastPulseAt < NOTIFICATION_REPEAT_INTERVAL_MS) continue;
          notificationPulses.push(createNotificationPulse(unread.nodeId, unread.kind, unread.title));
          unreadNotifications[unread.nodeId] = { ...unread, lastPulseAt: now };
        }
        persistUnreadNotifications(unreadNotifications);
        return { atlasRoot, notificationPulses, unreadNotifications };
      });
  },
}));

void initializeNotebookPersistence();

async function initializeNotebookPersistence() {
  if (typeof window === "undefined") return;
  if (isAboutDemoMode()) {
    useAtlasStore.setState({
      durableNotebookStorage: false,
      notebookPersistenceStatus: "ready",
      notebookPersistenceError: "",
      notebookSnapshots: [],
    });
    return;
  }
  try {
    const durableNotebookStorage = await requestDurableNotebookStorage();
    const migratedRoot = await migrateLegacyNotebookIfNeeded(initialAtlasRoot);
    const persistedRoot = migratedRoot ? ensureNotebookNode(migratedRoot) : await loadPersistedNotebook();
    const currentRoot = persistedRoot ? repairDuplicateNodeIds(ensureNotebookNode(persistedRoot)).root : null;
    if (currentRoot) writeLegacyNotebookRecovery(currentRoot);
    useAtlasStore.setState((state) => {
      if (!currentRoot) {
        return {
          durableNotebookStorage,
          notebookPersistenceStatus: "ready",
          notebookPersistenceError: "",
        };
      }
      const selectedNode = findNode(currentRoot, state.selectedNodeId) ?? currentRoot;
      const unreadNotifications = restoreUnreadNotifications(currentRoot, state.unreadNotifications);
      persistUnreadNotifications(unreadNotifications);
      return {
        atlasRoot: currentRoot,
        selected: selectionFromNode(selectedNode),
        selectedNodeId: selectedNode.id,
        multiSelectedNodeIds: state.multiSelectedNodeIds.filter((nodeId) => Boolean(findNode(currentRoot, nodeId))),
        attachmentPreviewUrls: filterAttachmentPreviewUrls(state.attachmentPreviewUrls, currentRoot),
        unreadNotifications,
        durableNotebookStorage,
        notebookPersistenceStatus: "ready",
        notebookPersistenceError: "",
      };
    });
    await useAtlasStore.getState().refreshNotebookSnapshots();
    await useAtlasStore.getState().restoreAttachmentPreviews();
    scheduleMissingTitleMaintenance(MISSING_TITLE_MAINTENANCE_STARTUP_DELAY_MS);
  } catch (error) {
    const message = notebookPersistenceErrorMessage("Notebook persistence could not start.", error);
    console.error(message, error);
    useAtlasStore.setState({ notebookPersistenceStatus: "error", notebookPersistenceError: message });
  }
}

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

export function findInheritedAiDialogSettings(root: AtlasNode, id: string): AiDialogSettings | undefined {
  const path = findNodePath(root, id);
  return path ? findAiDialogSettingsInPath(path) : undefined;
}

export function buildAiNodeContext(root: AtlasNode, selectedNodeId: string, optionsInput: AiContextScope | Partial<AiContextOptions> = "focused"): AiNodeContext | null {
  const options = normalizeAiContextOptions(optionsInput);
  const path = findNodePath(root, selectedNodeId);
  if (!path) return null;
  const truncationStats = createAiContextTruncationStats();
  const selectedNode = path[path.length - 1];
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const selectedDepth = getSelectedSnapshotDepth(options);
  const pathSnapshotDepth = options.scope === "path-children" ? 1 : 0;
  const selectedSnapshotOptions = {
    ...(options.scope === "subtree" ? { childLimit: Number.MAX_SAFE_INTEGER } : {}),
    truncationStats,
  };
  const siblingDepth = options.scope === "neighborhood" ? 1 : 0;
  const includeSiblings = options.scope === "neighborhood";
  const selectedSnapshot = nodeToAiSnapshot(selectedNode, selectedDepth, selectedSnapshotOptions);
  const pathSnapshots = getContextPathNodes(path, options).map((node) => nodeToAiSnapshot(node, pathSnapshotDepth, { truncationStats }));
  const siblingSnapshots =
    options.scope === "custom"
      ? getLateralContextNodes(root, selectedNodeId, options).map((node) => nodeToAiSnapshot(node, 0, { truncationStats }))
      : parent && includeSiblings
        ? parent.children.filter((node) => node.id !== selectedNode.id).map((node) => nodeToAiSnapshot(node, siblingDepth, { truncationStats }))
        : [];
  const selectedContextNodes = options.scope === "selected" ? getSelectedContextNodes(root, selectedNodeId, options.selectedNodeIds) : [];
  const selectedNodes =
    options.scope === "selected"
      ? selectedContextNodes.map((node) => nodeToAiSnapshot(node, selectedDepth, { truncationStats }))
      : undefined;
  const stats = buildAiContextStats(options.scope, selectedSnapshot, pathSnapshots, siblingSnapshots, selectedNodes, truncationStats);
  return {
    selectedNode: selectedSnapshot,
    selectedNodes,
    path: pathSnapshots,
    siblingNodes: siblingSnapshots,
    descendantCount: countDescendants(selectedNode),
    scope: options.scope,
    options,
    stats,
    exportedAt: new Date().toISOString(),
  };
}

export async function buildAiNodeContextWithAttachments(
  root: AtlasNode,
  selectedNodeId: string,
  optionsInput: AiContextScope | Partial<AiContextOptions> = "focused",
): Promise<AiNodeContext | null> {
  const context = buildAiNodeContext(root, selectedNodeId, optionsInput);
  if (!context || context.options?.attachmentMode !== "content") return context;
  const previousStats = context.stats;
  await attachAiContextAttachmentContent(context, context.options);
  const nextStats = buildAiContextStats(context.scope, context.selectedNode, context.path, context.siblingNodes, context.selectedNodes, undefined);
  context.stats = {
    ...nextStats,
    truncated:
      Boolean(previousStats.truncated) ||
      Boolean(nextStats.truncated),
    truncatedNodeCount: previousStats.truncatedNodeCount ?? nextStats.truncatedNodeCount,
    truncatedBodyCount: previousStats.truncatedBodyCount ?? nextStats.truncatedBodyCount,
    truncatedSummaryCount: previousStats.truncatedSummaryCount ?? nextStats.truncatedSummaryCount,
    omittedChildNodeCount: previousStats.omittedChildNodeCount ?? nextStats.omittedChildNodeCount,
    truncatedAttachmentCount: nextStats.truncatedAttachmentCount,
  };
  return context;
}

export function estimateAiNodeContext(root: AtlasNode, selectedNodeId: string, options: AiContextScope | Partial<AiContextOptions> = "focused"): AiContextStats | null {
  return buildAiNodeContext(root, selectedNodeId, options)?.stats ?? null;
}

export function getAiContextNodeIds(root: AtlasNode, selectedNodeId: string, options: AiContextScope | Partial<AiContextOptions> = "focused"): string[] {
  const context = buildAiNodeContext(root, selectedNodeId, options);
  if (!context) return [];
  const ids = new Set<string>();
  context.path.forEach((node) => collectSnapshotNodeIds(node, ids));
  collectSnapshotNodeIds(context.selectedNode, ids);
  context.selectedNodes?.forEach((node) => collectSnapshotNodeIds(node, ids));
  context.siblingNodes.forEach((node) => collectSnapshotNodeIds(node, ids));
  return [...ids];
}

export function getNodeWorldPosition(path: AtlasNode[], mode: AtlasLayoutMode = "phyllotaxis", focusNodeId?: string): [number, number, number] {
  if (mode === "phyllotaxis") return getNodeWorldPositionFromPath(path);
  const root = path[0];
  const node = path.at(-1);
  if (!root || !node) return [0, 0, 0];
  return deriveAtlasLayoutFrame(root, mode, undefined, { focusNodeId: focusNodeId ?? node.id }).positions.get(node.id) ?? [0, 0, 0];
}

export function getNodeVisualRadius(node: Pick<AtlasNode, "kind" | "radius">, depth = 1) {
  if (node.kind === "root") return node.radius;
  return NOTEBOOK_NODE_RADIUS;
}

export function getNodeHitRadius(node: Pick<AtlasNode, "kind" | "radius">, depth = 1) {
  if (node.kind === "root") return node.radius;
  return getNodeVisualRadius(node, depth);
}

export function findNodeWithWorldPosition(root: AtlasNode, id: string, mode: AtlasLayoutMode = "phyllotaxis", focusNodeId?: string) {
  const path = findNodePath(root, id);
  if (!path) return undefined;
  return { node: path[path.length - 1], path, position: getNodeWorldPosition(path, mode, focusNodeId ?? id) };
}

function selectionFromNode(node: AtlasNode): Selection {
  if (node.kind === "workArea") return { kind: "workArea", id: node.id };
  if (node.kind === "artifact" && node.sourceParentId) return { kind: "artifact", parentId: node.sourceParentId, id: node.id };
  if (node.kind === "event" && node.sourceParentId) return { kind: "event", parentId: node.sourceParentId, id: node.id };
  return { kind: "node", id: node.id };
}

function loadStoredUnreadNotifications(): Record<string, UnreadNotification> {
  if (isAboutDemoMode()) return {};
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(UNREAD_NOTIFICATIONS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<UnreadNotification>>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.values(parsed)
      .filter(isStoredUnreadNotification)
      .filter((notification) => notification.signature?.startsWith("reminder:"))
      .map((notification) => [
        notification.nodeId,
        {
          nodeId: notification.nodeId,
          kind: notification.kind,
          title: notification.title,
          signature: notification.signature,
          lastPulseAt: 0,
        },
      ]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function restoreUnreadNotifications(
  root: AtlasNode,
  current: Record<string, UnreadNotification> = loadStoredUnreadNotifications(),
) {
  const readState = loadNotificationReadState();
  const sources = collectNotificationSources(root);
  const sourceSignatures = new Set(sources.map((source) => source.signature));
  const next: Record<string, UnreadNotification> = {};
  for (const unread of Object.values(current)) {
    if (!findNode(root, unread.nodeId)) continue;
    if (unread.signature && !unread.signature.startsWith("transient:") && !sourceSignatures.has(unread.signature)) continue;
    if (unread.signature && isNotificationRead(readState, unread.nodeId, unread.signature)) continue;
    next[unread.nodeId] = unread;
  }
  for (const source of sources) {
    if (isNotificationRead(readState, source.nodeId, source.signature)) continue;
    next[source.nodeId] = {
      nodeId: source.nodeId,
      kind: source.kind,
      title: source.title,
      signature: source.signature,
      lastPulseAt: next[source.nodeId]?.lastPulseAt ?? 0,
    };
  }
  return next;
}

function loadStoredVoiceLog(): VoiceLogEntry[] {
  if (isAboutDemoMode()) return [];
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(VOICE_LOG_STORAGE_KEY);
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw) as VoiceLogEntry[];
    return Array.isArray(entries) ? entries.filter(isVoiceLogEntry) : [];
  } catch {
    return [];
  }
}

function loadStoredVoiceLogLastSeenAt(entries: VoiceLogEntry[]) {
  if (isAboutDemoMode()) return new Date().toISOString();
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(VOICE_LOG_LAST_SEEN_STORAGE_KEY);
    if (raw && !Number.isNaN(new Date(raw).getTime())) return raw;
  }
  const latestEntry = entries.at(-1);
  return latestEntry?.createdAt ?? new Date().toISOString();
}

function loadStoredVoiceSessionSummary(): VoiceSessionSummary | null {
  if (isAboutDemoMode()) return null;
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(VOICE_SUMMARY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const summary = JSON.parse(raw) as VoiceSessionSummary;
    return isVoiceSessionSummary(summary) ? summary : null;
  } catch {
    return null;
  }
}

function loadStoredVoicePartnerSettings(): VoicePartnerSettings {
  if (isAboutDemoMode()) return DEFAULT_VOICE_PARTNER_SETTINGS;
  if (typeof window === "undefined") return DEFAULT_VOICE_PARTNER_SETTINGS;
  const raw = window.localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
  if (!raw) return DEFAULT_VOICE_PARTNER_SETTINGS;
  try {
    return normalizeVoicePartnerSettings(JSON.parse(raw) as Partial<VoicePartnerSettings>);
  } catch {
    return DEFAULT_VOICE_PARTNER_SETTINGS;
  }
}

function createInitialNotebook() {
  return ensureNotebookNode(JSON.parse(JSON.stringify(atlasRoot)) as AtlasNode);
}

function persistNotebook(root: AtlasNode): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (isAboutDemoMode()) {
    scheduleMissingTitleMaintenance();
    useAtlasStore.setState({ notebookPersistenceStatus: "ready", notebookPersistenceError: "" });
    return Promise.resolve();
  }
  queuedNotebookSaveRoot = root;
  scheduleMissingTitleMaintenance();
  if (!notebookSaveRunning) {
    notebookSaveRunning = true;
    void flushQueuedNotebookSave();
  }
  return waitForNotebookSaveIdle();
}

const MISSING_TITLE_MAINTENANCE_IDLE_MS = 18_000;
const MISSING_TITLE_MAINTENANCE_STARTUP_DELAY_MS = 1_200;

let queuedNotebookSaveRoot: AtlasNode | null = null;
let notebookSaveRunning = false;
let missingTitleMaintenanceTimer: number | null = null;
let notebookSaveWaiters: Array<() => void> = [];

async function flushQueuedNotebookSave() {
  try {
    while (queuedNotebookSaveRoot) {
      const root = queuedNotebookSaveRoot;
      queuedNotebookSaveRoot = null;
      await savePersistedNotebook(root);
    }
    useAtlasStore.setState({ notebookPersistenceStatus: "ready", notebookPersistenceError: "" });
    await useAtlasStore.getState().refreshNotebookSnapshots();
  } catch (error) {
    const message = notebookPersistenceErrorMessage("Notebook could not be saved to IndexedDB.", error);
    console.error(message, error);
    useAtlasStore.setState({ notebookPersistenceStatus: "error", notebookPersistenceError: message });
  } finally {
    notebookSaveRunning = false;
    if (queuedNotebookSaveRoot) {
      notebookSaveRunning = true;
      void flushQueuedNotebookSave();
    } else {
      resolveNotebookSaveWaiters();
    }
  }
}

function waitForNotebookSaveIdle() {
  if (!notebookSaveRunning && !queuedNotebookSaveRoot) return Promise.resolve();
  return new Promise<void>((resolve) => {
    notebookSaveWaiters.push(resolve);
  });
}

function resolveNotebookSaveWaiters() {
  const waiters = notebookSaveWaiters;
  notebookSaveWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function scheduleMissingTitleMaintenance(delayMs = MISSING_TITLE_MAINTENANCE_IDLE_MS) {
  if (typeof window === "undefined") return;
  if (missingTitleMaintenanceTimer !== null) {
    window.clearTimeout(missingTitleMaintenanceTimer);
  }
  missingTitleMaintenanceTimer = window.setTimeout(() => {
    missingTitleMaintenanceTimer = null;
    runMissingTitleMaintenance();
  }, delayMs);
}

function runMissingTitleMaintenance() {
  if (isMissingTitleMaintenanceBlockedByActiveElement()) {
    scheduleMissingTitleMaintenance();
    return;
  }

  const state = useAtlasStore.getState();
  const result = hydrateMissingNodeTitlesFromBodies(state.atlasRoot);
  if (!result.changedNodeIds.length) return;

  let applied = false;
  useAtlasStore.setState((current) => {
    if (current.atlasRoot !== state.atlasRoot) return {};
    applied = true;
    return { atlasRoot: result.root };
  });
  if (applied) persistNotebook(result.root);
}

function isMissingTitleMaintenanceBlockedByActiveElement() {
  if (typeof document === "undefined") return false;
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".space-title-editor, input[aria-label='Node title']"));
}

function persistUnreadNotifications(unreadNotifications: Record<string, UnreadNotification>) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  const serializable = Object.fromEntries(
    Object.entries(unreadNotifications).map(([nodeId, notification]) => [
      nodeId,
      {
        nodeId: notification.nodeId,
        kind: notification.kind,
        title: notification.title,
        signature: notification.signature,
      },
    ]),
  );
  window.localStorage.setItem(UNREAD_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(serializable));
}

function loadNotificationReadState(): Record<string, string> {
  if (isAboutDemoMode()) return {};
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(NOTIFICATION_READ_STATE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function persistNotificationReadState(readState: Record<string, string>) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFICATION_READ_STATE_STORAGE_KEY, JSON.stringify(readState));
}

function persistVoiceLog(entries: VoiceLogEntry[]) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_LOG_STORAGE_KEY, JSON.stringify(entries));
}

function persistVoiceLogLastSeenAt(value: string) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_LOG_LAST_SEEN_STORAGE_KEY, value);
}

function persistVoiceSessionSummary(summary: VoiceSessionSummary | null) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  if (!summary) {
    window.localStorage.removeItem(VOICE_SUMMARY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(VOICE_SUMMARY_STORAGE_KEY, JSON.stringify(summary));
}

function persistVoicePartnerSettings(settings: VoicePartnerSettings) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function isVoiceLogEntry(value: unknown): value is VoiceLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<VoiceLogEntry>;
  return typeof entry.id === "string" && typeof entry.role === "string" && typeof entry.text === "string" && typeof entry.createdAt === "string";
}

function isVoiceSessionSummary(value: unknown): value is VoiceSessionSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<VoiceSessionSummary>;
  return typeof summary.text === "string" && typeof summary.createdAt === "string";
}

function normalizeVoicePartnerSettings(value: Partial<VoicePartnerSettings>): VoicePartnerSettings {
  return {
    realtimeModel: normalizeSettingText(value.realtimeModel, DEFAULT_VOICE_PARTNER_SETTINGS.realtimeModel),
    realtimeVoice: normalizeSettingText(value.realtimeVoice, DEFAULT_VOICE_PARTNER_SETTINGS.realtimeVoice),
  };
}

function normalizeSettingText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function isStoredUnreadNotification(value: unknown): value is UnreadNotification {
  if (!value || typeof value !== "object") return false;
  const notification = value as Partial<UnreadNotification>;
  return (
    typeof notification.nodeId === "string" &&
    isNotificationPulseKind(notification.kind) &&
    typeof notification.title === "string" &&
    (notification.signature === undefined || typeof notification.signature === "string")
  );
}

function isNotificationPulseKind(value: unknown): value is NotificationPulseKind {
  return value === "done" || value === "needs_review" || value === "error" || value === "codex" || value === "openclaw" || value === "claude" || value === "cost";
}

function focusRootCameraOnly(setState: typeof useAtlasStore.setState, nodeId: string) {
  const atlasDiameter = 420;
  setState((state) => ({
    cameraFocusNodeId: nodeId,
    focusRequest: {
      x: 0,
      y: 0,
      z: 0,
      diameter: atlasDiameter,
      nonce: (state.focusRequest?.nonce ?? 0) + 1,
      nodeId,
    },
  }));
}

function focusNodeCameraOnly(
  setState: typeof useAtlasStore.setState,
  getState: typeof useAtlasStore.getState,
  id: string,
) {
  const state = getState();
  const located = findNodeWithWorldPosition(state.atlasRoot, id, state.layoutMode, id);
  if (!located) return;
  const { node, path, position } = located;
  const visualRadius = getNodeVisualRadius(node, path.length - 1);
  setState((state) => ({
    cameraFocusNodeId: id,
    focusRequest: {
      x: position[0],
      y: position[1],
      z: position[2],
      diameter: visualRadius * 2,
      nonce: (state.focusRequest?.nonce ?? 0) + 1,
      nodeId: id,
    },
  }));
}

function pushHistory(state: Pick<AtlasStore, "atlasRoot" | "selectedNodeId" | "historyPast">) {
  return {
    historyPast: [...state.historyPast, createHistoryEntry(state.atlasRoot, state.selectedNodeId)].slice(-HISTORY_LIMIT),
    historyFuture: [],
  };
}

function createHistoryEntry(root: AtlasNode, selectedNodeId: string): HistoryEntry {
  return {
    atlasRoot: cloneAtlasRoot(root),
    selectedNodeId,
  };
}

function cloneAtlasRoot(root: AtlasNode): AtlasNode {
  if (typeof structuredClone === "function") return structuredClone(root);
  return JSON.parse(JSON.stringify(root)) as AtlasNode;
}

function filterAttachmentPreviewUrls(previewUrls: Record<string, string>, root: AtlasNode) {
  const attachmentIds = new Set(collectAttachmentIds(root));
  return Object.fromEntries(Object.entries(previewUrls).filter(([attachmentId]) => attachmentIds.has(attachmentId)));
}

function clearStoredNotebook() {
  if (typeof window === "undefined") return;
  void clearPersistedNotebook()
    .then(() => useAtlasStore.setState({ notebookSnapshots: [], notebookPersistenceStatus: "ready", notebookPersistenceError: "" }))
    .catch((error) => {
      const message = notebookPersistenceErrorMessage("Notebook history could not be cleared.", error);
      console.error(message, error);
      useAtlasStore.setState({ notebookPersistenceStatus: "error", notebookPersistenceError: message });
    });
  clearStoredNotificationState();
}

function notebookPersistenceErrorMessage(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail ? `${prefix} ${detail}` : prefix;
}

function clearStoredNotificationState() {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(UNREAD_NOTIFICATIONS_STORAGE_KEY);
  window.localStorage.removeItem(NOTIFICATION_READ_STATE_STORAGE_KEY);
}

function updateNodeById(root: AtlasNode, id: string, updater: (node: AtlasNode) => AtlasNode): AtlasNode {
  if (root.id === id) return updater(root);
  return {
    ...root,
    children: root.children.map((child) => updateNodeById(child, id, updater)),
  };
}

function replaceNodeById(root: AtlasNode, id: string, replacement: AtlasNode): AtlasNode {
  if (root.id === id) return replacement;
  return {
    ...root,
    children: root.children.map((child) => replaceNodeById(child, id, replacement)),
  };
}

function buildAtlasNodeFromOutline(
  outline: OutlineNodeInput,
  fallbackNode: AtlasNode,
  parentId: string | undefined,
  depth: number,
  childIndex: number,
  siblingCount: number,
  usedNodeIds: Set<string>,
  updatedAt: string,
  inheritedAiDialogSettings?: AiDialogSettings,
  inheritedCodexThreadId?: string,
  inheritedCodexLogPath?: string,
  inheritedOpenClawSessionKey?: string,
  inheritedOpenClawLogPath?: string,
  nodeIdByClientKey?: Map<string, string>,
): AtlasNode {
  const existingNode = outline.id ? findNode(useAtlasStore.getState().atlasRoot, outline.id) : undefined;
  const fallbackAiDialogSettings = fallbackNode.aiDialogSettings ?? inheritedAiDialogSettings;
  const fallbackCodexThreadId = fallbackNode.codexThreadId ?? inheritedCodexThreadId;
  const fallbackCodexLogPath = fallbackNode.codexLogPath ?? inheritedCodexLogPath;
  const fallbackOpenClawSessionKey = fallbackNode.openClawSessionKey ?? inheritedOpenClawSessionKey;
  const fallbackOpenClawLogPath = fallbackNode.openClawLogPath ?? inheritedOpenClawLogPath;
  const base = existingNode ?? createNotebookNode(parentId ?? fallbackNode.sourceParentId ?? "atlas-root", childIndex, outline.title, outline.body, {
    aiDialogSettings: fallbackAiDialogSettings,
    codexThreadId: fallbackCodexThreadId,
    codexLogPath: fallbackCodexLogPath,
    openClawSessionKey: fallbackOpenClawSessionKey,
    openClawLogPath: fallbackOpenClawLogPath,
    usedNodeIds,
  });
  if (outline.clientKey) nodeIdByClientKey?.set(outline.clientKey, base.id);
  const aiDialogSettings = base.aiDialogSettings ?? fallbackAiDialogSettings;
  const codexThreadId = base.codexThreadId ?? fallbackCodexThreadId;
  const codexLogPath = base.codexLogPath ?? fallbackCodexLogPath;
  const openClawSessionKey = base.openClawSessionKey ?? fallbackOpenClawSessionKey;
  const openClawLogPath = base.openClawLogPath ?? fallbackOpenClawLogPath;
  const children = outline.children.map((child, index) =>
    buildAtlasNodeFromOutline(
      child,
      base.children[index] ?? base,
      base.id,
      depth + 1,
      index,
      outline.children.length,
      usedNodeIds,
      updatedAt,
      aiDialogSettings,
      codexThreadId,
      codexLogPath,
      openClawSessionKey,
      openClawLogPath,
      nodeIdByClientKey,
    ),
  );
  return {
    ...base,
    title: outline.title,
    body: outline.body,
    summary: outline.body.split("\n").find(Boolean) ?? base.summary,
    updatedAt,
    ...(parentId ? { sourceParentId: parentId } : {}),
    aiDialogSettings,
    codexThreadId,
    codexLogPath,
    openClawSessionKey,
    openClawLogPath,
    children,
  };
}

function updateNodeTree(root: AtlasNode, updater: (node: AtlasNode) => AtlasNode): AtlasNode {
  const updated = updater(root);
  const children = updated.children.map((child) => updateNodeTree(child, updater));
  return children === updated.children ? updated : { ...updated, children };
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

function promoteNodeInTree(
  root: AtlasNode,
  grandparentId: string,
  parentId: string,
  promotedId: string,
  promotedNode: AtlasNode,
  insertIndex: number,
  updatedAt: string,
): AtlasNode {
  if (root.id === grandparentId) {
    const children = root.children.map((child) =>
      child.id === parentId
        ? {
            ...child,
            children: child.children.filter((grandchild) => grandchild.id !== promotedId),
            updatedAt,
          }
        : child,
    );
    return {
      ...root,
      children: insertAt(children, insertIndex, promotedNode),
      updatedAt,
    };
  }

  return {
    ...root,
    children: root.children.map((child) =>
      promoteNodeInTree(child, grandparentId, parentId, promotedId, promotedNode, insertIndex, updatedAt),
    ),
  };
}

function getPromotedSiblingPosition(
  grandparent: AtlasNode,
  parent: AtlasNode,
  promotedDepth: number,
  siblingCount: number,
  insertIndex: number,
): [number, number, number] | undefined {
  if (!parent.position) {
    return undefined;
  }

  if (promotedDepth <= 1) {
    return clampDirection([parent.position[0] + 0.08, parent.position[1] + 0.02, parent.position[2]], TOP_LEVEL_PLANAR_LIMIT);
  }

  return clampLocalOverride(
    [parent.position[0] + 0.08, parent.position[1] + 0.02, 0],
    getManualChildSpreadLimit(promotedDepth, siblingCount),
  );
}

function clearResolvedPropagatedErrors(node: AtlasNode): AtlasNode {
  const children = node.children.map((child) => clearResolvedPropagatedErrors(child));
  const nextNode = children === node.children ? node : { ...node, children };
  const propagatedErrorResolved =
    Boolean(nextNode.propagatedErrorSourceId) &&
    !hasDescendant(nextNode, nextNode.propagatedErrorSourceId);
  if (
    nextNode.status !== "error" ||
    (!propagatedErrorResolved && (isIntrinsicErrorNode(nextNode) || hasIntrinsicErrorDescendant(nextNode)))
  ) {
    if (nextNode.propagatedErrorSourceId && !hasDescendant(nextNode, nextNode.propagatedErrorSourceId)) {
      const { propagatedErrorSourceId: _propagatedErrorSourceId, ...rest } = nextNode;
      return rest;
    }
    return nextNode;
  }
  const { propagatedErrorSourceId: _propagatedErrorSourceId, ...rest } = nextNode;
  return {
    ...rest,
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
    !node.propagatedErrorSourceId &&
    (node.kind === "event" || node.author === "system" || node.tags.includes("error"))
  );
}

function hasDescendant(node: AtlasNode, id: string | undefined): boolean {
  if (!id) return false;
  return node.children.some((child) => child.id === id || hasDescendant(child, id));
}

function collectNodeIds(node: AtlasNode): string[] {
  return [node.id, ...node.children.flatMap((child) => collectNodeIds(child))];
}

function collectNodeIdSet(node: AtlasNode): Set<string> {
  return new Set(collectNodeIds(node));
}

type NodeIdOptions = {
  usedNodeIds?: Set<string>;
};

function createUniqueNodeId(kind: string, options: NodeIdOptions = {}) {
  const usedNodeIds = options.usedNodeIds;
  let id = `node-${kind}-${Date.now()}-${randomIdPart()}`;
  while (usedNodeIds?.has(id)) {
    id = `node-${kind}-${Date.now()}-${randomIdPart()}`;
  }
  usedNodeIds?.add(id);
  return id;
}

function randomIdPart() {
  try {
    return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function repairDuplicateNodeIds(root: AtlasNode): { root: AtlasNode; repairedIds: Array<{ oldId: string; newId: string }> } {
  const usedNodeIds = new Set<string>();
  const repairedIds: Array<{ oldId: string; newId: string }> = [];

  const visit = (node: AtlasNode, parentId?: string): AtlasNode => {
    const oldId = node.id;
    const needsRepair = !oldId || usedNodeIds.has(oldId);
    const id = needsRepair ? createUniqueNodeId("repair", { usedNodeIds }) : oldId;
    if (!needsRepair) {
      usedNodeIds.add(id);
    } else {
      repairedIds.push({ oldId: oldId || "(missing)", newId: id });
    }

    const children = node.children.map((child) => visit(child, id));
    return {
      ...node,
      id,
      ...(parentId ? { sourceParentId: parentId } : {}),
      children,
    };
  };

  return { root: visit(root), repairedIds };
}

function collectAttachmentIds(node: AtlasNode): string[] {
  return [...node.attachments.map((attachment) => attachment.id), ...node.children.flatMap((child) => collectAttachmentIds(child))];
}

function cloneNodeSubtreeForPaste(
  source: AtlasNode,
  parentId: string,
  now: string,
  position: [number, number, number] | undefined,
  isRoot = false,
  inheritedAiDialogSettings?: AiDialogSettings,
  inheritedCodexThreadId?: string,
  inheritedCodexLogPath?: string,
  inheritedOpenClawSessionKey?: string,
  inheritedOpenClawLogPath?: string,
  usedNodeIds?: Set<string>,
): AtlasNode {
  const id = createPastedNodeId(parentId, { usedNodeIds });
  const {
    id: _id,
    sourceId: _sourceId,
    aiRunId: _aiRunId,
    aiDialogSettings: _aiDialogSettings,
    codexThreadId: _codexThreadId,
    codexLogPath: _codexLogPath,
    openClawSessionKey: _openClawSessionKey,
    openClawLogPath: _openClawLogPath,
    attachments,
    children,
    position: _position,
    ...rest
  } = source;
  const aiDialogSettings = source.aiDialogSettings ?? inheritedAiDialogSettings;
  const codexThreadId = source.codexThreadId ?? inheritedCodexThreadId;
  const codexLogPath = source.codexLogPath ?? inheritedCodexLogPath;
  const openClawSessionKey = source.openClawSessionKey ?? inheritedOpenClawSessionKey;
  const openClawLogPath = source.openClawLogPath ?? inheritedOpenClawLogPath;
  return {
    ...rest,
    id,
    kind: source.kind === "root" ? "thread" : source.kind,
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    position: isRoot ? position : source.position,
    aiDialogSettings,
    codexThreadId,
    codexLogPath,
    openClawSessionKey,
    openClawLogPath,
    attachments: attachments.map((attachment, index) => cloneAttachmentMetadataForPaste(attachment, id, index, now)),
    children: children.map((child) =>
      cloneNodeSubtreeForPaste(child, id, now, child.position, false, aiDialogSettings, codexThreadId, codexLogPath, openClawSessionKey, openClawLogPath, usedNodeIds),
    ),
  };
}

function cloneAttachmentMetadataForPaste(attachment: NodeAttachment, nodeId: string, index: number, now: string): NodeAttachment {
  const { id: _id, assetPath: _assetPath, ...metadata } = attachment;
  return {
    ...metadata,
    id: createPastedAttachmentId(nodeId, index),
    createdAt: now,
  };
}

function createPastedNodeId(_parentId: string, options: NodeIdOptions = {}) {
  return createUniqueNodeId("copy", options);
}

function createPastedAttachmentId(nodeId: string, index: number) {
  return `${nodeId}-attachment-${Date.now()}-${crypto.randomUUID?.() ?? index}`;
}

function createGeneratedAttachmentRecords(nodeId: string, generatedAttachments: AiGeneratedAttachment[], now: string) {
  const attachments: NodeAttachment[] = [];
  const blobs: Array<{ attachment: NodeAttachment; blob: Blob }> = [];
  const previewUrls: Record<string, string> = {};

  generatedAttachments.forEach((generatedAttachment, index) => {
    const blob = base64ToBlob(generatedAttachment.base64, generatedAttachment.mimeType || "image/png");
    const attachment: NodeAttachment = {
      id: `${nodeId}-generated-attachment-${Date.now()}-${crypto.randomUUID?.() ?? index}`,
      name: generatedAttachment.name || `generated-image-${index + 1}.png`,
      kind: generatedAttachment.kind,
      mimeType: blob.type || generatedAttachment.mimeType || "image/png",
      size: blob.size || generatedAttachment.size,
      path: generatedAttachment.path || generatedAttachment.name || `generated-image-${index + 1}.png`,
      createdAt: now,
    };

    attachments.push(attachment);
    blobs.push({ attachment, blob });
    previewUrls[attachment.id] = URL.createObjectURL(blob);
  });

  return { attachments, blobs, previewUrls };
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function createNotebookNode(
  parentId: string,
  index: number,
  title: string,
  body = "",
  options: {
    position?: [number, number, number];
    aiDialogSettings?: AiDialogSettings;
    codexThreadId?: string;
    codexLogPath?: string;
    openClawSessionKey?: string;
    openClawLogPath?: string;
    claudeLogPath?: string;
    claudeSessionId?: string;
    usedNodeIds?: Set<string>;
  } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${index}-${now}`;
  return {
    id: createUniqueNodeId("note", options),
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
    aiDialogSettings: options.aiDialogSettings,
    codexThreadId: options.codexThreadId,
    codexLogPath: options.codexLogPath,
    openClawSessionKey: options.openClawSessionKey,
    openClawLogPath: options.openClawLogPath,
    claudeLogPath: options.claudeLogPath,
    claudeSessionId: options.claudeSessionId,
    children: [],
  };
}

function createAiRequestNode(
  parentId: string,
  index: number,
  runId: string,
  mode: AiExecutionMode,
  prompt: string,
  options: {
    position?: [number, number, number];
    aiDialogSettings?: AiDialogSettings;
    codexThreadId?: string;
    codexLogPath?: string;
    openClawSessionKey?: string;
    openClawLogPath?: string;
    claudeLogPath?: string;
    claudeSessionId?: string;
    usedNodeIds?: Set<string>;
  } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-${mode}-${index}`;
  return {
    id: createUniqueNodeId("request", options),
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
    aiDialogSettings: options.aiDialogSettings,
    codexThreadId: options.codexThreadId,
    codexLogPath: options.codexLogPath,
    openClawSessionKey: options.openClawSessionKey,
    openClawLogPath: options.openClawLogPath,
    claudeLogPath: options.claudeLogPath,
    claudeSessionId: options.claudeSessionId,
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
  options: {
    position?: [number, number, number];
    aiDialogSettings?: AiDialogSettings;
    codexThreadId?: string;
    codexLogPath?: string;
    openClawSessionKey?: string;
    openClawLogPath?: string;
    claudeLogPath?: string;
    claudeSessionId?: string;
    usedNodeIds?: Set<string>;
  } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-${index}`;
  const toolProvider = provider === "codex" || provider === "openclaw" || provider === "claude";

  return {
    id: createUniqueNodeId("ai", options),
    kind: "thread",
    nodeType: toolProvider ? "tool_result" : "ai_reply",
    title: output.title,
    subtitle: `${provider} / ${modelId}`,
    body: output.body,
    author: toolProvider ? "tool" : "ai",
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
    aiDialogSettings: options.aiDialogSettings,
    codexThreadId: options.codexThreadId,
    codexLogPath: options.codexLogPath,
    openClawSessionKey: options.openClawSessionKey,
    openClawLogPath: options.openClawLogPath,
    claudeLogPath: options.claudeLogPath,
    claudeSessionId: options.claudeSessionId,
    position: options.position,
    children: [],
  };
}

function createAiErrorNode(
  parentId: string,
  runId: string,
  mode: AiExecutionMode,
  message: string,
  options: {
    position?: [number, number, number];
    aiDialogSettings?: AiDialogSettings;
    codexThreadId?: string;
    codexLogPath?: string;
    openClawSessionKey?: string;
    openClawLogPath?: string;
    claudeLogPath?: string;
    claudeSessionId?: string;
    usedNodeIds?: Set<string>;
  } = {},
): AtlasNode {
  const now = new Date().toISOString();
  const seed = `${parentId}-${runId}-error`;
  const codexLimit = mode === "codex" ? describeCodexTokenLimit(message, now) : null;
  const bridgeFailure = codexLimit ? null : describeBridgeConnectionFailure(mode, message);
  const title = codexLimit ? "Codex token limit" : bridgeFailure ? "Mind Atlas server unreachable" : `${modeLabel(mode)} error`;
  const body = codexLimit?.body ?? bridgeFailure?.body ?? message;
  const summary = codexLimit?.summary ?? bridgeFailure?.summary ?? message;
  const nextDecision =
    codexLimit?.nextDecision ??
    bridgeFailure?.nextDecision ??
    "Inspect bridge configuration, provider status, or retry with a different mode.";
  return {
    id: createUniqueNodeId("error", options),
    kind: "event",
    nodeType: "tool_result",
    title,
    subtitle: "execution error",
    body,
    author: "system",
    status: "error",
    color: planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary,
    nextDecision,
    tags: normalizeTags(
      codexLimit ? [mode, "error", "token-limit"] : bridgeFailure ? [mode, "error", "bridge-unreachable"] : [mode, "error"],
      message,
    ),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    sourceId: runId,
    aiRunId: runId,
    provider: providerForMode(mode),
    runMode: mode,
    aiDialogSettings: options.aiDialogSettings,
    codexThreadId: options.codexThreadId,
    codexLogPath: options.codexLogPath,
    openClawSessionKey: options.openClawSessionKey,
    openClawLogPath: options.openClawLogPath,
    claudeLogPath: options.claudeLogPath,
    claudeSessionId: options.claudeSessionId,
    position: options.position,
    children: [],
  };
}

function describeBridgeConnectionFailure(mode: AiExecutionMode, message: string) {
  if (!isBridgeConnectionFailureMessage(message)) return null;
  const bridgeUrl = getBridgeUrl();
  const bridgeCandidates = getBridgeUrlCandidates();
  const label = modeLabel(mode);
  const body = [
    `${label} could not reach the Mind Atlas bridge server.`,
    "",
    `Bridge URL: ${bridgeUrl}`,
    bridgeCandidates.length > 1 ? `Fallback URLs tried: ${bridgeCandidates.slice(1).join(", ")}` : "",
    "",
    "Most likely cause:",
    "The Mind Atlas server or bridge process is not running, crashed, blocked by CORS/certificate trust, or unreachable from this browser.",
    "",
    "What to check:",
    "- Start or restart the Mind Atlas server/bridge, then retry.",
    "- Open the bridge health URL in this browser: " + `${bridgeUrl}/health`,
    "- If the app is opened over HTTPS, the bridge must also be HTTPS. Prefer `npm run dev:all` for LAN/mobile testing.",
    "- On Android or another LAN device, confirm the PC firewall allows the bridge port.",
    "- On mobile HTTPS, install and trust `.certs/mind-atlas-dev-ca.crt`, then restart the browser.",
    "- Confirm VITE_MIND_ATLAS_BRIDGE_URL points to this PC's reachable LAN address.",
    "- Confirm MIND_ATLAS_ALLOWED_ORIGIN allows the Mind Atlas page origin.",
    "",
    "Original error:",
    message,
  ].join("\n");
  return {
    body,
    summary: `Mind Atlas bridge is unreachable for ${label}.`,
    nextDecision: `Restart or reconnect the Mind Atlas bridge at ${bridgeUrl}, then retry ${label}.`,
  };
}

function isBridgeConnectionFailureMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "failed to fetch" ||
    normalized.includes("failed to fetch mind atlas bridge") ||
    normalized.includes("networkerror when attempting to fetch resource") ||
    normalized.includes("load failed") ||
    normalized.includes("network request failed")
  );
}

function notifyLocalOutputTruncated(mode: AiExecutionMode, usage: AiUsage | undefined) {
  if (mode !== "local" || !usage?.outputLimitHit || typeof window === "undefined" || typeof window.alert !== "function") return;
  const details = [
    typeof usage.maxOutputTokens === "number" ? `max output tokens: ${usage.maxOutputTokens}` : "",
    usage.finishReason ? `finish reason: ${usage.finishReason}` : "",
  ].filter(Boolean);
  window.alert(
    [
      "LM Studio appears to have cut off the Local response before Mind Atlas received the full answer.",
      details.length ? details.join("\n") : "",
      "Increase the Local output token limit or ask for a shorter answer if the result is incomplete.",
    ].filter(Boolean).join("\n"),
  );
}

function describeCodexTokenLimit(message: string, nowIso: string) {
  if (!isCodexTokenLimitMessage(message)) return null;
  const resetText = extractCodexLimitResetText(message, nowIso);
  const body = [
    "Codex token limit reached.",
    resetText ? `Limit reset: ${resetText}` : "Limit reset: not reported by Codex.",
    "",
    "Original error:",
    message,
  ].join("\n");
  return {
    body,
    summary: resetText ? `Codex token limit reached. Reset: ${resetText}.` : "Codex token limit reached. Reset time was not reported.",
    nextDecision: resetText ? `Wait until ${resetText}, then retry Codex.` : "Wait for the Codex limit to reset, then retry.",
  };
}

function isCodexTokenLimitMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("token limit") ||
    normalized.includes("usage limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("too many requests")
  );
}

function extractCodexLimitResetText(message: string, nowIso: string) {
  const explicit =
    matchFirst(message, [
      /\b(?:resets?|reset|retry|try again|available again|come back)\s+(?:at|after|on)\s+([^\r\n.]+)/i,
      /\b(?:resets?|retry|try again|available again|come back)\s+in\s+([^\r\n.]+)/i,
      /\buntil\s+([^\r\n.]+)/i,
    ]) ?? "";
  if (!explicit) return "";

  const cleaned = explicit.replace(/\s+/g, " ").trim();
  if (/^\d+\s*(?:s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)\b/i.test(cleaned)) {
    const relative = addRelativeDuration(nowIso, cleaned);
    return relative ? `${relative} (${cleaned} from now)` : cleaned;
  }

  const absolute = parseResetDate(cleaned, nowIso);
  return absolute ?? cleaned;
}

function matchFirst(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function addRelativeDuration(nowIso: string, value: string) {
  const now = new Date(nowIso);
  let ms = 0;
  const matches = value.matchAll(/(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)/gi);
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit.startsWith("h")) ms += amount * 60 * 60 * 1000;
    else if (unit.startsWith("m")) ms += amount * 60 * 1000;
    else ms += amount * 1000;
  }
  if (!ms) return "";
  return formatResetDate(new Date(now.getTime() + ms));
}

function parseResetDate(value: string, nowIso: string) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return formatResetDate(direct);

  const timeMatch = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!timeMatch) return "";
  const now = new Date(nowIso);
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] ?? 0);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return "";
  const resetAt = new Date(now);
  resetAt.setHours(hours, minutes, 0, 0);
  if (resetAt.getTime() <= now.getTime()) resetAt.setDate(resetAt.getDate() + 1);
  return formatResetDate(resetAt);
}

function formatResetDate(date: Date) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  if (mode === "chat") return "openai";
  if (mode === "local") return "local";
  if (mode === "codex") return "codex";
  if (mode === "openclaw") return "openclaw";
  if (mode === "claude") return "claude";
  return "openai";
}

function isChatLikeMode(mode: AiExecutionMode) {
  return mode === "chat" || mode === "openai" || mode === "local";
}

function buildChatSettingsForRun(settings: ChatSettings, mode: AiExecutionMode): ChatSettings {
  if (mode === "local") return normalizeChatSettings({ ...settings, service: "local", model: "" });
  if (mode === "openai") return normalizeChatSettings({ ...settings, service: "openai" });
  return normalizeChatSettings(settings);
}

function chatProvider(settings: ChatSettings): AiProvider {
  return settings.service;
}

function partnerProvider(mode: PartnerArchiveMode, provider?: AiProvider): AiProvider {
  if (provider) return provider;
  if (mode === "local") return "local";
  return "openai";
}

function partnerRunMode(mode: PartnerArchiveMode): AiExecutionMode {
  return mode === "realtime" ? "openai" : "chat";
}

function partnerModeLabel(mode: PartnerArchiveMode) {
  switch (mode) {
    case "chat":
      return formatAppMessage("label.mode.chat");
    case "local":
      return formatAppMessage("label.mode.local");
    case "realtime":
      return formatAppMessage("label.mode.realtime");
    case "openai":
      return formatAppMessage("label.mode.openAi");
  }
}

function modeLabel(mode: AiExecutionMode) {
  switch (mode) {
    case "chat":
      return formatAppMessage("label.mode.chat");
    case "openai":
      return formatAppMessage("label.mode.openAi");
    case "local":
      return formatAppMessage("label.mode.local");
    case "codex":
      return formatAppMessage("label.mode.codex");
    case "openclaw":
      return formatAppMessage("label.mode.openClaw");
    case "claude":
      return formatAppMessage("label.mode.claudeCode");
  }
}

function aiResultNotificationKind(mode: AiExecutionMode): NotificationPulseKind {
  if (mode === "codex") return "codex";
  if (mode === "openclaw") return "openclaw";
  if (mode === "claude") return "claude";
  return "needs_review";
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

function canCreateNotificationPulse(root: AtlasNode, nodeId: string) {
  return nodeId !== root.id && Boolean(findNode(root, nodeId));
}

function markUnreadNotification(
  current: Record<string, UnreadNotification>,
  nodeId: string,
  kind: NotificationPulseKind,
  title: string,
  signature = fallbackNotificationSignature(nodeId, kind, title),
) {
  const next = {
    ...current,
    [nodeId]: {
      nodeId,
      kind,
      title,
      signature,
      lastPulseAt: performance.now(),
    },
  };
  persistUnreadNotifications(next);
  return next;
}

function markUnreadNotifications(
  current: Record<string, UnreadNotification>,
  nodeIds: string[],
  kind: NotificationPulseKind,
  title: string,
) {
  return nodeIds.reduce((next, nodeId) => markUnreadNotification(next, nodeId, kind, title), current);
}

function markNodeNotificationsRead(
  root: AtlasNode,
  current: Record<string, UnreadNotification>,
  nodeId: string,
): Record<string, UnreadNotification> {
  const node = findNode(root, nodeId);
  const readState = loadNotificationReadState();
  for (const source of node ? collectNodeNotificationSources(node) : []) {
    readState[notificationReadKey(source.nodeId, source.signature)] = "read";
  }
  if (current[nodeId]?.signature) {
    readState[notificationReadKey(nodeId, current[nodeId].signature)] = "read";
  }
  persistNotificationReadState(readState);
  const next = { ...current };
  delete next[nodeId];
  persistUnreadNotifications(next);
  return next;
}

function collectNotificationSources(root: AtlasNode): NotificationSource[] {
  const sources: NotificationSource[] = [];
  const visit = (node: AtlasNode) => {
    sources.push(...collectNodeNotificationSources(node));
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return sources;
}

function collectNodeNotificationSources(node: AtlasNode): NotificationSource[] {
  const sources: NotificationSource[] = [];
  if (node.reminderAt && node.reminderFiredAt) {
    sources.push({
      nodeId: node.id,
      kind: "needs_review",
      title: `Reminder: ${node.title || "Untitled node"}`,
      signature: reminderNotificationSignature(node),
    });
  }
  return sources;
}

function reminderNotificationSignature(node: Pick<AtlasNode, "id" | "reminderAt" | "reminderFiredAt">) {
  return reminderNotificationSignatureFromParts(node.id, node.reminderAt, node.reminderFiredAt);
}

function reminderNotificationSignatureFromParts(nodeId: string, reminderAt?: string, reminderFiredAt?: string) {
  return `reminder:${nodeId}:${reminderAt ?? ""}:${reminderFiredAt ?? ""}`;
}

function fallbackNotificationSignature(nodeId: string, kind: NotificationPulseKind, title: string) {
  return `transient:${nodeId}:${kind}:${title}`;
}

function notificationReadKey(nodeId: string, signature: string) {
  return `${nodeId}:${signature}`;
}

function isNotificationRead(readState: Record<string, string>, nodeId: string, signature: string) {
  return readState[notificationReadKey(nodeId, signature)] === "read" || readState[nodeId] === signature;
}

function collectDueReminderNodes(root: AtlasNode, nowMs: number) {
  const due: AtlasNode[] = [];
  const visit = (node: AtlasNode) => {
    if (node.reminderAt && !node.reminderFiredAt) {
      const reminderMs = new Date(node.reminderAt).getTime();
      if (!Number.isNaN(reminderMs) && reminderMs <= nowMs) due.push(node);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return due;
}

function markReminderNodesFired(root: AtlasNode, ids: Set<string>, firedAt: string): AtlasNode {
  if (!ids.size) return root;
  let changed = false;
  const children = root.children.map((child) => {
    const nextChild = markReminderNodesFired(child, ids, firedAt);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  if (ids.has(root.id)) {
    changed = true;
    return {
      ...root,
      reminderFiredAt: firedAt,
      updatedAt: firedAt,
      children,
    };
  }
  return changed ? { ...root, children } : root;
}

function withAiDialogSettingsSaved(
  state: Pick<AtlasStore, "atlasRoot" | "selectedNodeId" | "aiContextOptions" | "chatSettings" | "codexSettings" | "openClawSettings" | "claudeSettings">,
  patch: Partial<AiDialogSettings>,
) {
  const nextContextOptions = normalizeAiContextOptions(patch.contextOptions ?? state.aiContextOptions);
  const nextChatSettings = normalizeChatSettings(patch.chatSettings ?? state.chatSettings);
  const nextCodexSettings = normalizeCodexSettings(patch.codexSettings ?? state.codexSettings);
  const nextOpenClawSettings = normalizeOpenClawSettings(patch.openClawSettings ?? state.openClawSettings);
  const nextClaudeSettings = normalizeClaudeSettings(patch.claudeSettings ?? state.claudeSettings);
  const aiDialogSettings: AiDialogSettings = {
    contextOptions: sanitizeStoredAiContextOptions(nextContextOptions),
    chatSettings: sanitizeStoredChatSettings(nextChatSettings),
    codexSettings: sanitizeStoredCodexSettings(nextCodexSettings),
    openClawSettings: sanitizeStoredOpenClawSettings(nextOpenClawSettings),
    claudeSettings: sanitizeStoredClaudeSettings(nextClaudeSettings),
  };
  const atlasRoot = updateNodeById(state.atlasRoot, state.selectedNodeId, (node) => ({
    ...node,
    aiDialogSettings,
    updatedAt: new Date().toISOString(),
  }));
  persistNotebook(atlasRoot);
  return {
    atlasRoot,
    aiContextOptions: nextContextOptions,
    chatSettings: nextChatSettings,
    codexSettings: nextCodexSettings,
    openClawSettings: nextOpenClawSettings,
    claudeSettings: nextClaudeSettings,
  };
}

function createInheritedAiDialogSettings(
  path: AtlasNode[],
  fallbackContextOptions: AiContextOptions,
  fallbackChatSettings: ChatSettings,
  fallbackCodexSettings: CodexSettings,
  fallbackOpenClawSettings: OpenClawSettings,
  fallbackClaudeSettings: ClaudeSettings,
): AiDialogSettings {
  const inherited = findAiDialogSettingsInPath(path);
  return createCurrentAiDialogSettings(
    inherited?.contextOptions ?? fallbackContextOptions,
    inherited?.chatSettings ?? fallbackChatSettings,
    inherited?.codexSettings ?? fallbackCodexSettings,
    inherited?.openClawSettings ?? fallbackOpenClawSettings,
    inherited?.claudeSettings ?? fallbackClaudeSettings,
  );
}

function findAiDialogSettingsInPath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.aiDialogSettings) return node.aiDialogSettings;
  }
  return undefined;
}

function inferCodexLogPathFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.codexLogPath) return node.codexLogPath;
  }
  return undefined;
}

function getCodexThreadIdForNewChild(path: AtlasNode[], aiDialogSettings?: AiDialogSettings) {
  if (aiDialogSettings?.codexSettings.continueMode === "new") return undefined;
  return aiDialogSettings?.codexSettings.resumeThreadId || inferCodexThreadIdFromNodePath(path) || undefined;
}

function inferOpenClawLogPathFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.openClawLogPath) return node.openClawLogPath;
  }
  return undefined;
}

function inferClaudeLogPathFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.claudeLogPath) return node.claudeLogPath;
  }
  return undefined;
}

function inferClaudeSessionIdFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.claudeSessionId) return node.claudeSessionId;
  }
  return undefined;
}

function getOpenClawSessionKeyForNewChild(path: AtlasNode[], aiDialogSettings?: AiDialogSettings) {
  if (aiDialogSettings?.openClawSettings.continueMode === "new") return undefined;
  return aiDialogSettings?.openClawSettings.resumeSessionKey || inferOpenClawSessionKeyFromNodePath(path) || undefined;
}

function sanitizeStoredAiContextOptions(options: AiContextOptions) {
  return normalizeAiContextOptions({
    ...options,
    selectedNodeIds: [],
  });
}

function sanitizeStoredChatSettings(settings: ChatSettings) {
  return normalizeChatSettings(settings);
}

function sanitizeStoredCodexSettings(settings: CodexSettings) {
  const {
    fullAccessApproved: _fullAccessApproved,
    clientRunId: _clientRunId,
    requestNodeId: _requestNodeId,
    sourceNodeId: _sourceNodeId,
    ...rest
  } = settings;
  const keepTrusted = settings.sandbox === "danger-full-access" && settings.fullAccessApproved === true;
  return normalizeCodexSettings({
    ...rest,
    fullAccessApproved: keepTrusted,
  });
}

function sanitizeStoredOpenClawSettings(settings: OpenClawSettings) {
  const {
    clientRunId: _clientRunId,
    requestNodeId: _requestNodeId,
    sourceNodeId: _sourceNodeId,
    sessionKey: _sessionKey,
    ...rest
  } = settings;
  return normalizeOpenClawSettings(rest);
}

function sanitizeStoredClaudeSettings(settings: ClaudeSettings) {
  const {
    clientRunId: _clientRunId,
    requestNodeId: _requestNodeId,
    sourceNodeId: _sourceNodeId,
    forkSession: _forkSession,
    ...rest
  } = settings;
  return normalizeClaudeSettings(rest);
}

function createCurrentAiDialogSettings(
  contextOptions: AiContextOptions,
  chatSettings: ChatSettings,
  codexSettings: CodexSettings,
  openClawSettings: OpenClawSettings,
  claudeSettings: ClaudeSettings,
): AiDialogSettings {
  return {
    contextOptions: sanitizeStoredAiContextOptions(contextOptions),
    chatSettings: sanitizeStoredChatSettings(chatSettings),
    codexSettings: sanitizeStoredCodexSettings(codexSettings),
    openClawSettings: sanitizeStoredOpenClawSettings(openClawSettings),
    claudeSettings: sanitizeStoredClaudeSettings(claudeSettings),
  };
}

function removeCodexRetryResultChildren(children: AtlasNode[]) {
  return children.filter((child) => !(child.provider === "codex" && child.aiRunId?.startsWith("codex-approval-")));
}

// Session continuation is resolved by the context engine's state machine, not
// by a user-facing selector. `settings.continueMode === "new"` survives only as
// a stored per-branch override that forces a fresh session.
function buildCodexSettingsForRun(settings: CodexSettings, sourcePath: AtlasNode[], session: AgentSessionResolution) {
  return normalizeCodexSettings({
    ...settings,
    workspace: settings.workspace.trim() || inferWorkspaceFromPath(sourcePath),
    continueMode: session.action === "continue" ? "auto" : "new",
    resumeThreadId: session.action === "continue" ? session.resumeId ?? "" : "",
  });
}

function buildOpenClawSettingsForRun(settings: OpenClawSettings, session: AgentSessionResolution) {
  return normalizeOpenClawSettings({
    ...settings,
    workspace: "",
    continueMode: session.action === "continue" ? "auto" : "new",
    resumeSessionKey: session.action === "continue" ? session.resumeId ?? "" : "",
  });
}

function buildClaudeSettingsForRun(settings: ClaudeSettings, sourcePath: AtlasNode[], session: AgentSessionResolution) {
  return normalizeClaudeSettings({
    ...settings,
    workspace: settings.workspace.trim() || inferWorkspaceFromPath(sourcePath),
    continueMode: session.action === "new" ? "new" : "auto",
    resumeSessionId: session.action === "new" ? "" : session.resumeId ?? "",
    forkSession: session.action === "fork",
  });
}

function inferWorkspaceFromPath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    const value = extractWorkspaceFromText([node.title, node.summary, node.body, ...node.tags].join("\n"));
    if (value) return value;
  }
  return "";
}

function resolveAgentSessionForRun(
  root: AtlasNode,
  sourceNodeId: string,
  mode: AiExecutionMode,
  settings: AiDialogSettings,
  forceNew: boolean,
): AgentSessionResolution | undefined {
  const agent: AgentKind | undefined = mode === "codex" || mode === "claude" || mode === "openclaw" ? mode : undefined;
  if (!agent) return undefined;
  const storedNewOverride =
    (mode === "codex" && settings.codexSettings.continueMode === "new") ||
    (mode === "openclaw" && settings.openClawSettings.continueMode === "new") ||
    (mode === "claude" && settings.claudeSettings.continueMode === "new");
  return resolveAgentSession(root, sourceNodeId, agent, { forceNew: forceNew || storedNewOverride });
}

function collectRecoverableCodexRequests(root: AtlasNode): CodexRunRecoveryRequest[] {
  const requests: CodexRunRecoveryRequest[] = [];
  const visit = (node: AtlasNode, path: AtlasNode[]) => {
    const nextPath = [...path, node];
    if (
      node.runMode === "codex" &&
      node.nodeType === "human_prompt" &&
      node.status === "running" &&
      node.children.length === 0
    ) {
      const settings = findCodexSettingsInPath(nextPath);
      requests.push({
        runId: node.aiRunId ?? node.sourceId,
        requestNodeId: node.id,
        sourceNodeId: node.sourceParentId,
        threadId: inferCodexThreadIdFromNodePath(nextPath),
        workspace: settings?.workspace || inferCodexWorkspaceFromNodePath(nextPath),
        startedAfter: node.createdAt,
      });
    }
    node.children.forEach((child) => visit(child, nextPath));
  };
  visit(root, []);
  return requests;
}

function inferCodexThreadIdFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.codexThreadId) return node.codexThreadId;
    const resumeThreadId = node.aiDialogSettings?.codexSettings.resumeThreadId;
    if (resumeThreadId) return resumeThreadId;
  }
  return "";
}

function inferOpenClawSessionKeyFromNodePath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.openClawSessionKey) return node.openClawSessionKey;
    const resumeSessionKey = node.aiDialogSettings?.openClawSettings.resumeSessionKey;
    if (resumeSessionKey) return resumeSessionKey;
  }
  return "";
}

function findCodexSettingsInPath(path: AtlasNode[]) {
  for (const node of path.slice().reverse()) {
    if (node.aiDialogSettings?.codexSettings) return node.aiDialogSettings.codexSettings;
  }
  return undefined;
}

function inferCodexWorkspaceFromNodePath(path: AtlasNode[]) {
  const settings = findCodexSettingsInPath(path);
  if (settings?.workspace) return settings.workspace;
  for (const node of path.slice().reverse()) {
    const value = extractWorkspaceFromText([node.title, node.summary, node.body, ...node.tags].join("\n"));
    if (value) return value;
  }
  return "";
}

function findActiveCodexRunForWorkspace(aiRuns: Record<string, AiRun>, workspace: string, excludeRunId?: string) {
  const normalizedWorkspace = normalizeWorkspaceKey(workspace);
  return Object.values(aiRuns).find((run) =>
    run.id !== excludeRunId &&
    run.mode === "codex" &&
    run.status === "running" &&
    normalizeWorkspaceKey(run.workspace ?? "") === normalizedWorkspace
  );
}

function findActiveClaudeRunForWorkspace(aiRuns: Record<string, AiRun>, workspace: string, excludeRunId?: string) {
  const normalizedWorkspace = normalizeWorkspaceKey(workspace);
  return Object.values(aiRuns).find((run) =>
    run.id !== excludeRunId &&
    run.mode === "claude" &&
    run.status === "running" &&
    normalizeWorkspaceKey(run.workspace ?? "") === normalizedWorkspace
  );
}

function normalizeWorkspaceKey(workspace: string) {
  return (workspace || "").trim().replace(/[\\\/]+$/, "").toLowerCase();
}

function normalizeCodexSettings(settings: Partial<CodexSettings>): CodexSettings {
  const sandbox = normalizeCodexSandbox(settings.sandbox, settings.fullAccessApproved);
  const continueMode = settings.continueMode === "new" ? "new" : "auto";
  return {
    ...DEFAULT_CODEX_SETTINGS,
    ...settings,
    model: (settings.model ?? DEFAULT_CODEX_SETTINGS.model).trim() || DEFAULT_CODEX_SETTINGS.model,
    reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort),
    sandbox,
    workspace: (settings.workspace ?? "").trim(),
    webSearch: true,
    skipGitRepoCheck: false,
    timeoutMs: clampInteger(settings.timeoutMs ?? DEFAULT_CODEX_SETTINGS.timeoutMs, 30_000, 120 * 60_000),
    fullAccessApproved: settings.fullAccessApproved === true,
    continueMode,
    resumeThreadId: continueMode === "new" ? "" : (settings.resumeThreadId ?? "").trim(),
    clientRunId: (settings.clientRunId ?? "").trim(),
    requestNodeId: (settings.requestNodeId ?? "").trim(),
    sourceNodeId: (settings.sourceNodeId ?? "").trim(),
  };
}

function normalizeOpenClawSettings(settings: Partial<OpenClawSettings>): OpenClawSettings {
  const continueMode = settings.continueMode === "new" ? "new" : "auto";
  return {
    ...DEFAULT_OPENCLAW_SETTINGS,
    ...settings,
    model: (settings.model ?? "").trim(),
    thinking: "off",
    workspace: "",
    timeoutMs: clampInteger(settings.timeoutMs ?? DEFAULT_OPENCLAW_SETTINGS.timeoutMs, 30_000, 120 * 60_000),
    continueMode,
    resumeSessionKey: continueMode === "new" ? "" : (settings.resumeSessionKey ?? "").trim(),
    sessionKey: (settings.sessionKey ?? "").trim(),
    clientRunId: (settings.clientRunId ?? "").trim(),
    requestNodeId: (settings.requestNodeId ?? "").trim(),
    sourceNodeId: (settings.sourceNodeId ?? "").trim(),
  };
}

function normalizeClaudeSettings(settings: Partial<ClaudeSettings>): ClaudeSettings {
  const continueMode = settings.continueMode === "new" ? "new" : "auto";
  return {
    ...DEFAULT_CLAUDE_SETTINGS,
    ...settings,
    authMode: settings.authMode === "subscription" ? "subscription" : "api",
    model: (settings.model ?? "").trim(),
    baseUrl: (settings.baseUrl ?? "").trim().replace(/\/+$/, ""),
    reasoningEffort: normalizeClaudeReasoningEffort(settings.reasoningEffort),
    permissionMode: normalizeClaudePermissionMode(settings.permissionMode),
    workspace: (settings.workspace ?? "").trim(),
    timeoutMs: clampInteger(settings.timeoutMs ?? DEFAULT_CLAUDE_SETTINGS.timeoutMs, 30_000, 120 * 60_000),
    continueMode,
    resumeSessionId: continueMode === "new" ? "" : (settings.resumeSessionId ?? "").trim(),
    forkSession: settings.forkSession === true,
    clientRunId: (settings.clientRunId ?? "").trim(),
    requestNodeId: (settings.requestNodeId ?? "").trim(),
    sourceNodeId: (settings.sourceNodeId ?? "").trim(),
  };
}

function normalizeClaudeReasoningEffort(value: ClaudeSettings["reasoningEffort"] | undefined): ClaudeSettings["reasoningEffort"] {
  return normalizeDynamicReasoningEffort(value, "default");
}

function normalizeClaudePermissionMode(value: ClaudeSettings["permissionMode"] | undefined): ClaudeSettings["permissionMode"] {
  if (value === "acceptEdits" || value === "plan" || value === "auto" || value === "dontAsk" || value === "bypassPermissions") return value;
  return "default";
}

function normalizeChatSettings(settings: Partial<ChatSettings>): ChatSettings {
  const service = normalizeChatService(settings.service);
  return {
    service,
    model: (settings.model ?? "").trim(),
    reasoningEffort: normalizeChatReasoningEffort(settings.reasoningEffort),
  };
}

function normalizeChatService(value: ChatSettings["service"] | undefined): ChatSettings["service"] {
  if (
    value === "anthropic" ||
    value === "glm" ||
    value === "deepseek" ||
    value === "gemini" ||
    value === "qwen" ||
    value === "composer" ||
    value === "kimi" ||
    value === "mimo" ||
    value === "minimax" ||
    value === "grok" ||
    value === "local"
  ) return value;
  return "openai";
}

function normalizeChatReasoningEffort(value: ChatSettings["reasoningEffort"] | undefined): ChatSettings["reasoningEffort"] {
  return normalizeDynamicReasoningEffort(value, "default");
}

function normalizeReasoningEffort(value: CodexSettings["reasoningEffort"] | undefined): CodexSettings["reasoningEffort"] {
  return normalizeDynamicReasoningEffort(value, "medium");
}

function normalizeDynamicReasoningEffort(value: string | undefined, fallback: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(normalized) ? normalized : fallback;
}

function normalizeCodexSandbox(value: CodexSettings["sandbox"] | undefined, fullAccessApproved?: boolean): CodexSettings["sandbox"] {
  if (value === "read-only") return "read-only";
  if (value === "danger-full-access") return fullAccessApproved ? "danger-full-access" : "workspace-write";
  return "workspace-write";
}

function extractWorkspaceFromText(text: string) {
  const match = text.match(/(?:workspace|workroot|work root|作業ルート|作業root)\s*[:=]\s*([^\r\n]+)/i);
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function createCodexGeneratedNodeTrees(
  parentId: string,
  startIndex: number,
  runId: string,
  mode: AiExecutionMode,
  modelId: string,
  nodes: CodexGeneratedNode[],
  usage: AiUsage | undefined,
  codexThreadId: string | undefined,
  codexLogPath: string | undefined,
  parentDepth: number,
  layoutSeed: string,
  aiDialogSettings?: AiDialogSettings,
  usedNodeIds?: Set<string>,
) {
  return nodes.map((node, index) =>
    createCodexGeneratedNodeTree(
      parentId,
      startIndex + index,
      runId,
      mode,
      modelId,
      node,
      index === 0 ? usage : undefined,
      codexThreadId,
      codexLogPath,
      parentDepth,
      startIndex + nodes.length,
      layoutSeed,
      aiDialogSettings,
      usedNodeIds,
    ),
  );
}

function createCodexGeneratedNodeTree(
  parentId: string,
  index: number,
  runId: string,
  mode: AiExecutionMode,
  modelId: string,
  spec: CodexGeneratedNode,
  usage: AiUsage | undefined,
  codexThreadId: string | undefined,
  codexLogPath: string | undefined,
  parentDepth: number,
  siblingCount: number,
  layoutSeed: string,
  aiDialogSettings?: AiDialogSettings,
  usedNodeIds?: Set<string>,
): AtlasNode {
  const now = new Date().toISOString();
  const id = createUniqueNodeId("codex", { usedNodeIds });
  const seed = `${parentId}-${runId}-${spec.kind}-${index}`;
  const nodeType = spec.nodeType ?? codexNodeTypeForKind(spec.kind);
  const childSpecs = spec.children ?? [];
  const childDepth = parentDepth + 1;
  const inheritedCodexThreadId = codexThreadId ?? aiDialogSettings?.codexSettings.resumeThreadId;
  const inheritedCodexLogPath = codexLogPath;
  return {
    id,
    kind: spec.kind === "command" || spec.kind === "approval_request" || spec.kind === "approval_option" ? "event" : "thread",
    nodeType,
    title: spec.title,
    subtitle: `codex / ${modelId}`,
    body: spec.body,
    author: spec.kind === "approval_request" || spec.kind === "approval_option" ? "system" : "tool",
    status: spec.suggestedStatus,
    color: spec.color ?? planetColorForSeed(seed),
    texture: randomTexture(seed),
    radius: NOTEBOOK_NODE_RADIUS,
    summary: spec.summary,
    nextDecision: spec.action ? "Use the centered approval button to respond." : "Review this Codex output.",
    tags: normalizeTags(spec.tags, spec.title, spec.body, spec.summary),
    attachments: [],
    createdAt: now,
    updatedAt: now,
    sourceParentId: parentId,
    sourceId: runId,
    aiRunId: runId,
    modelId,
    provider: "codex",
    runMode: mode,
    codexThreadId: inheritedCodexThreadId,
    codexLogPath: inheritedCodexLogPath,
    usage,
    action: spec.action,
    aiDialogSettings,
    children: childSpecs.map((child, childIndex) =>
      createCodexGeneratedNodeTree(
        id,
        childIndex,
        runId,
        mode,
        modelId,
        child,
        undefined,
        inheritedCodexThreadId,
        inheritedCodexLogPath,
        childDepth,
        childSpecs.length,
        id,
        aiDialogSettings,
        usedNodeIds,
      ),
    ),
  };
}

function codexNodeTypeForKind(kind: CodexGeneratedNode["kind"]) {
  if (kind === "command") return "tool_call";
  if (kind === "approval_request" || kind === "approval_option") return "approval_request";
  return "tool_result";
}

function collectNodeIdsFromMany(nodes: AtlasNode[]) {
  return nodes.flatMap((node) => collectNodeIds(node));
}

function getCodexPulseTargetIds(nodes: AtlasNode[]) {
  const flatNodes: AtlasNode[] = [];
  const visit = (node: AtlasNode) => {
    flatNodes.push(node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  const target =
    flatNodes.find((node) => node.tags.includes("final")) ??
    flatNodes.find((node) => node.title === "Codex issue" || node.tags.includes("error")) ??
    flatNodes.find((node) => node.tags.includes("approval") && !node.action) ??
    flatNodes.find((node) => node.action) ??
    flatNodes[0];
  return target ? [target.id] : [];
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function ensureNotebookNode(node: AtlasNode): AtlasNode {
  return stabilizePhyllotaxisPositions(ensureNotebookTree(node, [], 1));
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

interface AiContextTruncationStats {
  truncatedNodeIds: Set<string>;
  truncatedBodyCount: number;
  truncatedSummaryCount: number;
  omittedChildNodeCount: number;
}

function createAiContextTruncationStats(): AiContextTruncationStats {
  return {
    truncatedNodeIds: new Set<string>(),
    truncatedBodyCount: 0,
    truncatedSummaryCount: 0,
    omittedChildNodeCount: 0,
  };
}

function nodeToAiSnapshot(
  node: AtlasNode,
  depthRemaining: number,
  options: { childLimit?: number; truncationStats?: AiContextTruncationStats } = {},
): AiNodeSnapshot {
  const childLimit = options.childLimit ?? 8;
  const body = truncateText(node.body, 4000);
  const summary = truncateText(node.summary, 600);
  const includedChildren = depthRemaining > 0 ? node.children.slice(0, childLimit) : [];
  const omittedChildCount = depthRemaining > 0 ? Math.max(0, node.children.length - includedChildren.length) : 0;
  if (body !== node.body) {
    options.truncationStats?.truncatedNodeIds.add(node.id);
    if (options.truncationStats) options.truncationStats.truncatedBodyCount += 1;
  }
  if (summary !== node.summary) {
    options.truncationStats?.truncatedNodeIds.add(node.id);
    if (options.truncationStats) options.truncationStats.truncatedSummaryCount += 1;
  }
  if (omittedChildCount > 0) {
    options.truncationStats?.truncatedNodeIds.add(node.id);
    if (options.truncationStats) options.truncationStats.omittedChildNodeCount += omittedChildCount;
  }
  return {
    id: node.id,
    title: node.title,
    body,
    summary,
    status: node.status,
    author: node.author,
    nodeType: node.nodeType,
    tags: node.tags,
    provider: node.provider,
    runMode: node.runMode,
    aiRunId: node.aiRunId,
    codexThreadId: node.codexThreadId,
    codexLogPath: node.codexLogPath,
    openClawSessionKey: node.openClawSessionKey,
    openClawLogPath: node.openClawLogPath,
    claudeLogPath: node.claudeLogPath,
    claudeSessionId: node.claudeSessionId,
    attachments: node.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    children: includedChildren.map((child) => nodeToAiSnapshot(child, depthRemaining - 1, options)),
  };
}

export function normalizeAiContextOptions(optionsInput: AiContextScope | Partial<AiContextOptions> = "focused"): AiContextOptions {
  const options = typeof optionsInput === "string" ? { scope: optionsInput } : optionsInput;
  return {
    ...DEFAULT_AI_CONTEXT_OPTIONS,
    ...options,
    scope: options.scope ?? DEFAULT_AI_CONTEXT_OPTIONS.scope,
    ancestorDepth: clampInteger(options.ancestorDepth ?? DEFAULT_AI_CONTEXT_OPTIONS.ancestorDepth, 0, 12),
    descendantDepth: clampInteger(options.descendantDepth ?? DEFAULT_AI_CONTEXT_OPTIONS.descendantDepth, 0, 6),
    lateralRadius: clampInteger(options.lateralRadius ?? DEFAULT_AI_CONTEXT_OPTIONS.lateralRadius, 0, 4),
    attachmentMode: normalizeAttachmentMode(options.attachmentMode),
    maxAttachmentCount: clampInteger(options.maxAttachmentCount ?? DEFAULT_AI_CONTEXT_OPTIONS.maxAttachmentCount, 0, 20),
    maxAttachmentBytes: clampInteger(options.maxAttachmentBytes ?? DEFAULT_AI_CONTEXT_OPTIONS.maxAttachmentBytes, 64 * 1024, 12 * 1024 * 1024),
    selectedNodeIds: dedupeIds(options.selectedNodeIds ?? DEFAULT_AI_CONTEXT_OPTIONS.selectedNodeIds),
  };
}

function normalizeAttachmentMode(mode: AiAttachmentMode | undefined): AiAttachmentMode {
  return mode === "content" ? "content" : "metadata";
}

function getSelectedSnapshotDepth(options: AiContextOptions) {
  switch (options.scope) {
    case "minimal":
      return 0;
    case "path-children":
      return 1;
    case "focused":
      return 1;
    case "subtree":
      return Number.MAX_SAFE_INTEGER;
    case "neighborhood":
      return 2;
    case "selected":
      return 0;
    case "custom":
      return options.descendantDepth;
  }
}

function getContextPathNodes(path: AtlasNode[], options: AiContextOptions) {
  if (options.scope === "selected") return [];
  if (options.scope === "minimal") return path.slice(-1);
  if (options.scope === "path-children") return path.slice(0, -1);
  if (options.scope === "custom") {
    return path.slice(Math.max(0, path.length - options.ancestorDepth - 1));
  }
  return path;
}

function getSelectedContextNodes(root: AtlasNode, selectedNodeId: string, selectedNodeIds: string[]) {
  return dedupeIds(selectedNodeIds).filter((id) => id !== selectedNodeId)
    .map((id) => findNode(root, id))
    .filter((node): node is AtlasNode => Boolean(node));
}

function getLateralContextNodes(root: AtlasNode, selectedNodeId: string, options: AiContextOptions) {
  if (options.lateralRadius <= 0) return [];
  const selectedIds = new Set([selectedNodeId]);
  const excludedIds = new Set<string>();
  for (const id of selectedIds) {
    const path = findNodePath(root, id);
    if (!path) continue;
    for (const node of path) excludedIds.add(node.id);
    collectTreeIds(path[path.length - 1], excludedIds, Number.MAX_SAFE_INTEGER);
  }

  const { nodesById, neighborsById } = buildNodeGraph(root);
  const queue = [...selectedIds].map((id) => ({ id, distance: 0 }));
  const visited = new Set(selectedIds);
  const lateralNodes: AtlasNode[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const neighbors = neighborsById.get(current.id) ?? [];
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      const distance = current.distance + 1;
      if (distance > options.lateralRadius) continue;
      visited.add(neighborId);
      queue.push({ id: neighborId, distance });
      if (!excludedIds.has(neighborId)) {
        const node = nodesById.get(neighborId);
        if (node) lateralNodes.push(node);
      }
    }
  }

  return lateralNodes.slice(0, 32);
}

function buildNodeGraph(root: AtlasNode) {
  const nodesById = new Map<string, AtlasNode>();
  const neighborsById = new Map<string, string[]>();

  const visit = (node: AtlasNode, parentId: string | null) => {
    nodesById.set(node.id, node);
    const neighbors = neighborsById.get(node.id) ?? [];
    if (parentId) neighbors.push(parentId);
    for (const child of node.children) neighbors.push(child.id);
    neighborsById.set(node.id, neighbors);
    for (const child of node.children) visit(child, node.id);
  };

  visit(root, null);
  return { nodesById, neighborsById };
}

function buildAiContextStats(
  scope: AiContextScope,
  selectedNode: AiNodeSnapshot,
  path: AiNodeSnapshot[],
  siblingNodes: AiNodeSnapshot[],
  selectedNodes?: AiNodeSnapshot[],
  truncationStats?: AiContextTruncationStats,
): AiContextStats {
  const selectedCount = countSnapshotNodes(selectedNode);
  const pathCount = path.reduce((sum, node) => sum + countSnapshotNodes(node), 0);
  const siblingCount = siblingNodes.reduce((sum, node) => sum + countSnapshotNodes(node), 0);
  const selectedNodesCount = selectedNodes?.reduce((sum, node) => sum + countSnapshotNodes(node), 0) ?? 0;
  const text = JSON.stringify({ selectedNode, selectedNodes, path, siblingNodes });
  const attachmentStats = countSnapshotAttachments([selectedNode, ...(selectedNodes ?? []), ...path, ...siblingNodes]);
  const truncatedAttachmentCount = countTruncatedSnapshotAttachments([selectedNode, ...(selectedNodes ?? []), ...path, ...siblingNodes]);
  const truncatedNodeCount = truncationStats?.truncatedNodeIds.size ?? 0;
  const truncatedBodyCount = truncationStats?.truncatedBodyCount ?? 0;
  const truncatedSummaryCount = truncationStats?.truncatedSummaryCount ?? 0;
  const omittedChildNodeCount = truncationStats?.omittedChildNodeCount ?? 0;
  return {
    scope,
    includedNodeCount: selectedCount + pathCount + siblingCount + selectedNodesCount,
    estimatedInputTokens: Math.ceil(text.length / 3.8),
    includedAttachmentCount: attachmentStats.count,
    includedAttachmentBytes: attachmentStats.bytes,
    truncated: truncatedNodeCount > 0 || truncatedAttachmentCount > 0,
    truncatedNodeCount,
    truncatedBodyCount,
    truncatedSummaryCount,
    omittedChildNodeCount,
    truncatedAttachmentCount,
    sections: {
      selected: selectedCount,
      path: pathCount,
      siblings: siblingCount,
      selectedNodes: selectedNodes ? selectedNodesCount : undefined,
    },
  };
}

async function attachAiContextAttachmentContent(context: AiNodeContext, options: AiContextOptions) {
  const snapshots = [context.selectedNode, ...(context.selectedNodes ?? []), ...context.path, ...context.siblingNodes];
  const visitedAttachments = new Set<string>();
  const contentByAttachmentId = new Map<string, NonNullable<AiNodeSnapshot["attachments"][number]["content"]>>();
  let includedCount = 0;

  for (const snapshot of snapshots) {
    await visitSnapshotAttachments(snapshot);
  }

  async function visitSnapshotAttachments(snapshot: AiNodeSnapshot): Promise<void> {
    for (const attachment of snapshot.attachments) {
      const existingContent = contentByAttachmentId.get(attachment.id);
      if (existingContent) {
        attachment.content = existingContent;
        continue;
      }
      if (visitedAttachments.has(attachment.id)) continue;
      visitedAttachments.add(attachment.id);
      if (includedCount >= options.maxAttachmentCount) continue;
      if (attachment.size > options.maxAttachmentBytes) continue;
      const content = await readAttachmentContent(attachment.id, attachment.mimeType, options.maxAttachmentBytes);
      if (!content) continue;
      attachment.content = content;
      contentByAttachmentId.set(attachment.id, content);
      includedCount += 1;
    }
    for (const child of snapshot.children) {
      await visitSnapshotAttachments(child);
    }
  }
}

async function readAttachmentContent(attachmentId: string, mimeType: string, maxBytes: number) {
  try {
    const blob = await getStoredAttachmentBlob(attachmentId);
    if (!blob || blob.size > maxBytes) return undefined;
    if (isTextAttachment(mimeType)) {
      const text = await blob.text();
      const maxChars = 24000;
      return {
        encoding: "text" as const,
        value: text.length > maxChars ? text.slice(0, maxChars) : text,
        bytes: blob.size,
        truncated: text.length > maxChars,
      };
    }
    return {
      encoding: "data_url" as const,
      value: await blobToDataUrl(blob),
      bytes: blob.size,
    };
  } catch (error) {
    return {
      encoding: "text" as const,
      value: "",
      bytes: 0,
      unavailable: true,
      error: error instanceof Error ? error.message : "Attachment content could not be read.",
    };
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function isTextAttachment(mimeType: string) {
  return mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("csv");
}

function countSnapshotAttachments(nodes: AiNodeSnapshot[]) {
  const attachmentIds = new Set<string>();
  let bytes = 0;
  for (const node of nodes) {
    visit(node);
  }
  return { count: attachmentIds.size, bytes };

  function visit(node: AiNodeSnapshot) {
    for (const attachment of node.attachments) {
      if (attachmentIds.has(attachment.id)) continue;
      attachmentIds.add(attachment.id);
      if (attachment.content) bytes += attachment.content.bytes;
    }
    for (const child of node.children) visit(child);
  }
}

function countTruncatedSnapshotAttachments(nodes: AiNodeSnapshot[]) {
  const attachmentIds = new Set<string>();
  for (const node of nodes) {
    visit(node);
  }
  return attachmentIds.size;

  function visit(node: AiNodeSnapshot) {
    for (const attachment of node.attachments) {
      if (attachment.content?.truncated) attachmentIds.add(attachment.id);
    }
    for (const child of node.children) visit(child);
  }
}

function countSnapshotNodes(node: AiNodeSnapshot): number {
  return 1 + node.children.reduce((sum, child) => sum + countSnapshotNodes(child), 0);
}

function collectSnapshotNodeIds(node: AiNodeSnapshot, ids: Set<string>) {
  ids.add(node.id);
  node.children.forEach((child) => collectSnapshotNodeIds(child, ids));
}

function collectTreeIds(node: AtlasNode, ids: Set<string>, depthRemaining: number) {
  ids.add(node.id);
  if (depthRemaining <= 0) return;
  node.children.forEach((child) => collectTreeIds(child, ids, depthRemaining - 1));
}

function dedupeIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function clampInteger(value: number, min: number, max: number) {
  const number = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, number));
}

function countDescendants(node: AtlasNode): number {
  return node.children.length + node.children.reduce((count, child) => count + countDescendants(child), 0);
}

function titleFromBody(body: string) {
  const firstLine = body.split("\n").find((line) => line.trim())?.trim() ?? "";
  return firstLine ? truncateText(firstLine, 48).replace(/\n\[truncated\]$/, "...") : "";
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function clampLocalOverride(position: Vec3, limit: number): Vec3 {
  const amount = Math.hypot(position[0], position[1]);
  if (amount <= limit) return [position[0], position[1], 0];
  const scaleToLimit = amount > 0 ? limit / amount : 0;
  return [position[0] * scaleToLimit, position[1] * scaleToLimit, 0];
}

function randomTexture(seedText: string): AtlasNode["texture"] {
  return planetTextureForSeed(seedText);
}

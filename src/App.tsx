import { FocusPanel } from "./components/FocusPanel";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BellOff, CloudDownload, CloudUpload, Download, FileText, GitBranch, History, ListTree, Maximize2, MessageSquareText, Moon, MoreHorizontal, Network, Orbit, PenLine, Plus, Radio, Redo2, RefreshCw, RotateCcw, Settings2, Smartphone, Sun, Trash2, Undo2, Upload, Volume2, X } from "lucide-react";
import { ChangeEvent, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadCloudNotebookPackage, listCloudNotebookPackages, saveCloudNotebookPackage } from "./ai/bridgeClient";
import { replaceStoredAttachmentBlobs } from "./attachmentStorage";
import { CommandDock } from "./components/CommandDock";
import { copyContextMarkdown, formatContextCopyStats } from "./context/contextCopy";
import { Minimap } from "./components/Minimap";
import { OutlineEditor } from "./components/OutlineEditor";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT, UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { detectImportFormat, importExternalNotebookFile, importMarkdownText } from "./notebookImport";
import { createNotebookJsonPackage, createNotebookPackage, importNotebookPackage, type NotebookPackageResult } from "./notebookPackage";
import { emitOnboardingEvent, useOnboarding } from "./onboarding/useOnboarding";
import type { OutlineNodeInput } from "./outline/atlasOutline";
import { findNode, findNodePath, useAtlasStore } from "./store/atlasStore";
import { getAtlasLayoutModeLabel, type AtlasLayoutMode } from "./layout/atlasLayout";
import { loadStoredTheme, persistTheme, type AtlasTheme } from "./theme";
import { loadPersistedUiState, persistUiStatePatch, type PersistedUiState } from "./uiPersistence";
import type { AtlasNode, CloudNotebookEntry, NotificationPulse, ViewportState, VoiceLogEntry, VoicePartnerSettings } from "./types";
import type { NotebookPersistenceStatus, NotebookSnapshot } from "./notebookPersistence";

const VOICE_OPTION_IDS = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const WORKSPACE_PANEL_EXIT_MS = 960;
const RENDER_QUALITY_STORAGE_KEY = "mind-atlas-render-quality";
const ROOT_COMMAND_MAX_ZOOM = 1.08;
const DEFAULT_DATASET_TITLE = "Mind Atlas";
const IMPORT_ACCEPT_TYPES = ".mindatlas,.mindatlaspkg,.md,.markdown,.opml,.mm,application/mindatlas+json,application/x-mindatlas-package,text/markdown,text/plain,text/xml,application/xml";
const MODE_OPTIONS: Array<{ mode: AtlasLayoutMode; icon: "orbit" | "tree" | "mind" }> = [
  { mode: "phyllotaxis", icon: "orbit" },
  { mode: "tree", icon: "tree" },
  { mode: "mind-map", icon: "mind" },
];
const UNIVERSE_TITLE_PLACEHOLDER_ALIASES = [
  "Name this universe.",
  "この宇宙に名前をつけてみましょう",
  "この宇宙に名前を付けてみましょう",
];
const KEYBOARD_OVERLAY_INPUT_SELECTOR =
  ".command-dock input, .command-dock textarea, .command-dock select, .node-body-input, .space-title-editor, .space-body-editor";
const SPACE_LABEL_KEYBOARD_SELECTOR = ".space-title-editor, .space-body-editor";
type MobilePanelTab = "command" | "editor" | "operation" | "outline";
type MergeChoice = "current" | "incoming";

type OperationAction = {
  id: string;
  label: string;
  shortcut: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

interface MergePreviewBlock {
  key: string;
  path: string;
  currentTitle: string;
  incomingTitle: string;
  currentBody: string;
  incomingBody: string;
  choice: MergeChoice;
  children: MergePreviewBlock[];
}

interface MergePreviewState {
  root: MergePreviewBlock;
}

export default function App() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const viewport = useAtlasStore((state) => state.viewport);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectNodeInPlace = useAtlasStore((state) => state.selectNodeInPlace);
  const showNotificationSnoozePrompt = useAtlasStore((state) => state.showNotificationSnoozePrompt);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const updateNodeLive = useAtlasStore((state) => state.updateNodeLive);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const saveNotebookNow = useAtlasStore((state) => state.saveNotebookNow);
  const addSiblingNode = useAtlasStore((state) => state.addSiblingNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const applyOutlineSubtree = useAtlasStore((state) => state.applyOutlineSubtree);
  const resetNotebook = useAtlasStore((state) => state.resetNotebook);
  const undo = useAtlasStore((state) => state.undo);
  const redo = useAtlasStore((state) => state.redo);
  const canUndo = useAtlasStore((state) => state.historyPast.length > 0);
  const canRedo = useAtlasStore((state) => state.historyFuture.length > 0);
  const voiceLogEntries = useAtlasStore((state) => state.voiceLogEntries);
  const voiceLogLastSeenAt = useAtlasStore((state) => state.voiceLogLastSeenAt);
  const voiceSessionSummary = useAtlasStore((state) => state.voiceSessionSummary);
  const voicePartnerSettings = useAtlasStore((state) => state.voicePartnerSettings);
  const notebookPersistenceStatus = useAtlasStore((state) => state.notebookPersistenceStatus);
  const notebookPersistenceError = useAtlasStore((state) => state.notebookPersistenceError);
  const notebookSnapshots = useAtlasStore((state) => state.notebookSnapshots);
  const durableNotebookStorage = useAtlasStore((state) => state.durableNotebookStorage);
  const setVoicePartnerSettings = useAtlasStore((state) => state.setVoicePartnerSettings);
  const refreshNotebookSnapshots = useAtlasStore((state) => state.refreshNotebookSnapshots);
  const restoreNotebookFromSnapshot = useAtlasStore((state) => state.restoreNotebookFromSnapshot);
  const clearVoiceLog = useAtlasStore((state) => state.clearVoiceLog);
  const markVoiceLogSeen = useAtlasStore((state) => state.markVoiceLogSeen);
  const notificationPulses = useAtlasStore((state) => state.notificationPulses);
  const unreadNotifications = useAtlasStore((state) => state.unreadNotifications);
  const restoreAttachmentPreviews = useAtlasStore((state) => state.restoreAttachmentPreviews);
  const recoverCompletedCodexRuns = useAtlasStore((state) => state.recoverCompletedCodexRuns);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const layoutMode = useAtlasStore((state) => state.layoutMode);
  const setLayoutMode = useAtlasStore((state) => state.setLayoutMode);
  const [persistedUiState] = useState<PersistedUiState | null>(() => loadPersistedUiState());
  const [pageActive, setPageActive] = useState(() => isPageRuntimeActive());
  const [menuOpen, setMenuOpen] = useState(false);
  const globalMenuRef = useRef<HTMLDivElement | null>(null);
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [restoreHistoryOpen, setRestoreHistoryOpen] = useState(false);
  const [outlineEditorOpen, setOutlineEditorOpen] = useState(false);
  const [outlineEditorRootId, setOutlineEditorRootId] = useState<string | null>(null);
  const [cloudLoadOpen, setCloudLoadOpen] = useState(false);
  const [mobileNotificationsEnabled, setMobileNotificationsEnabled] = useState(() => loadMobileNotificationPreference());
  const [mobileNotificationPermission, setMobileNotificationPermission] = useState<MobileNotificationPermission>(() => getMobileNotificationPermission());
  const [mobileNotificationMessage, setMobileNotificationMessage] = useState("");
  const [vrModeEnabled, setVrModeEnabled] = useState(() => Boolean(persistedUiState?.vrModeEnabled && canRestoreVrModeWithoutGesture()));
  const [vrModeMessage, setVrModeMessage] = useState("");
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(() => loadRenderQualityPreference());
  const [cloudNotebooks, setCloudNotebooks] = useState<CloudNotebookEntry[]>([]);
  const [cloudDirectory, setCloudDirectory] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [theme, setTheme] = useState<AtlasTheme>(() => loadStoredTheme());
  const [mobilePanelTab, setMobilePanelTab] = useState<MobilePanelTab>(persistedUiState?.mobilePanelTab ?? "command");
  const [mobileWorkspacePanelRevealed, setMobileWorkspacePanelRevealed] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [contextCopyStatus, setContextCopyStatus] = useState("");
  const [textImportOpen, setTextImportOpen] = useState(false);
  const [textImportValue, setTextImportValue] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreviewState | null>(null);
  const [dragImportActive, setDragImportActive] = useState(false);
  const mobilePortraitBreadcrumb = useMobilePortraitBreadcrumbLayout();
  const mobileOperationSurface = useMobileOperationSurface();
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
  const selectedNode = selectedPath[selectedPath.length - 1] ?? atlasRoot;
  const outlineEditorRoot = outlineEditorRootId ? findNode(atlasRoot, outlineEditorRootId) ?? selectedNode : selectedNode;
  const onboarding = useOnboarding();
  const showCommandDock = onboarding.showAiFeatures && shouldShowCommandDock(atlasRoot.id, selectedNodeId, viewport);
  const effectiveMobilePanelTab: MobilePanelTab = getEffectiveMobilePanelTab(mobilePanelTab, showCommandDock, outlineEditorOpen);
  const showWorkspacePanel = outlineEditorOpen || showCommandDock || selectedNodeId !== atlasRoot.id || (onboarding.showMainChrome && mobileWorkspacePanelRevealed);
  const focusPanelOpen = outlineEditorOpen || selectedNodeId !== atlasRoot.id;
  const operationTargets = useMemo(() => getOperationTargets(selectedPath), [selectedPath]);
  const operationActions = useMemo<OperationAction[]>(
    () => [
      {
        id: "add-child",
        label: "Add child",
        shortcut: "Tab",
        icon: <GitBranch size={18} />,
        onClick: () => addChildNode(selectedNodeId),
      },
      {
        id: "add-sibling",
        label: "Add sibling",
        shortcut: "Enter",
        icon: <Plus size={18} />,
        disabled: selectedNodeId === atlasRoot.id,
        onClick: () => addSiblingNode(selectedNodeId),
      },
      {
        id: "parent-layer",
        label: "Go to parent layer",
        shortcut: "up",
        icon: <ArrowUp size={18} />,
        disabled: !operationTargets.parentId,
        onClick: () => {
          if (operationTargets.parentId) focusNode(operationTargets.parentId);
        },
      },
      {
        id: "child-layer",
        label: "Go to child layer",
        shortcut: "down",
        icon: <ArrowDown size={18} />,
        disabled: !operationTargets.childId,
        onClick: () => {
          if (operationTargets.childId) focusNode(operationTargets.childId);
        },
      },
      {
        id: "previous-sibling",
        label: "Go to previous sibling",
        shortcut: "left",
        icon: <ArrowLeft size={18} />,
        disabled: !operationTargets.previousSiblingId,
        onClick: () => {
          if (operationTargets.previousSiblingId) focusNode(operationTargets.previousSiblingId);
        },
      },
      {
        id: "next-sibling",
        label: "Go to next sibling",
        shortcut: "right",
        icon: <ArrowRight size={18} />,
        disabled: !operationTargets.nextSiblingId,
        onClick: () => {
          if (operationTargets.nextSiblingId) focusNode(operationTargets.nextSiblingId);
        },
      },
    ],
    [
      addChildNode,
      addSiblingNode,
      atlasRoot.id,
      focusNode,
      operationTargets.childId,
      operationTargets.nextSiblingId,
      operationTargets.parentId,
      operationTargets.previousSiblingId,
      selectedNodeId,
    ],
  );
  const [renderWorkspacePanel, setRenderWorkspacePanel] = useState(showWorkspacePanel);
  const appClassName = [
    "app-shell",
    onboarding.showLogoOnly ? "is-onboarding-logo-only" : "",
    !onboarding.showMainChrome ? "is-onboarding-main-hidden" : "",
    onboarding.showAiFeatures ? "is-ai-unlocked" : "is-ai-locked",
  ].filter(Boolean).join(" ");
  const unreadNotificationLinks = useMemo(
    () =>
      Object.values(unreadNotifications)
        .map((notification) => {
          const node = findNode(atlasRoot, notification.nodeId);
          return node ? { notification, node } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 8),
    [atlasRoot, unreadNotifications],
  );
  const unreadTextPartnerEntries = useMemo(
    () => voiceLogEntries.filter((entry) => isUnreadTextPartnerEntry(entry, voiceLogLastSeenAt)),
    [voiceLogEntries, voiceLogLastSeenAt],
  );
  const latestTextPartnerEntry = unreadTextPartnerEntries.at(-1);
  const uiPersistenceReadyRef = useRef(false);
  const uiRestoreAppliedRef = useRef(false);
  const latestUiStateRef = useRef<Omit<Partial<PersistedUiState>, "version" | "savedAt">>({});

  const closeMobileBackOverlays = useCallback(() => {
    setMenuOpen(false);
    setVoiceLogOpen(false);
    setVoiceSettingsOpen(false);
    setRestoreHistoryOpen(false);
    setCloudLoadOpen(false);
    setTextImportOpen(false);
    setMergePreview(null);
    setOutlineEditorOpen(false);
    setOutlineEditorRootId(null);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, []);

  useVisualViewportHeight(commandInputEditing);
  useMobileBackButtonGuard({ closeOverlays: closeMobileBackOverlays });

  useEffect(() => {
    if (uiRestoreAppliedRef.current) return;
    uiRestoreAppliedRef.current = true;
    if (!persistedUiState?.selectedNodeId) return;
    if (!findNode(atlasRoot, persistedUiState.selectedNodeId)) return;
    selectNodeInPlace(persistedUiState.selectedNodeId);
  }, [atlasRoot, persistedUiState, selectNodeInPlace]);

  useEffect(() => {
    latestUiStateRef.current = {
      selectedNodeId,
      renderQuality,
      layoutMode,
      vrModeEnabled,
      mobilePanelTab,
    };
  }, [layoutMode, mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

  useEffect(() => {
    if (!uiPersistenceReadyRef.current) {
      uiPersistenceReadyRef.current = true;
      return;
    }
    persistUiStatePatch(latestUiStateRef.current);
  }, [layoutMode, mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

  useEffect(() => {
    if (!persistedUiState?.layoutMode) return;
    setLayoutMode(persistedUiState.layoutMode);
  }, [persistedUiState, setLayoutMode]);

  useEffect(() => {
    const saveUiState = () => persistUiStatePatch(latestUiStateRef.current);
    const syncPageActive = () => {
      const active = isPageRuntimeActive();
      if (!active) saveUiState();
      setPageActive(active);
    };
    const handlePageShow = () => setPageActive(isPageRuntimeActive());
    const handleHiddenLifecycle = () => {
      saveUiState();
      setPageActive(false);
    };

    document.addEventListener("visibilitychange", syncPageActive);
    document.addEventListener("freeze", handleHiddenLifecycle);
    document.addEventListener("resume", syncPageActive);
    window.addEventListener("pagehide", handleHiddenLifecycle);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("beforeunload", saveUiState);
    return () => {
      document.removeEventListener("visibilitychange", syncPageActive);
      document.removeEventListener("freeze", handleHiddenLifecycle);
      document.removeEventListener("resume", syncPageActive);
      window.removeEventListener("pagehide", handleHiddenLifecycle);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("beforeunload", saveUiState);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && globalMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [menuOpen]);

  useEffect(() => {
    const revealMobileWorkspacePanel = () => {
      if (!isMobileWorkspacePanelRevealTarget()) return;
      if (!onboarding.showMainChrome) return;
      const state = useAtlasStore.getState();
      if (onboarding.showAiFeatures && !shouldShowCommandDock(state.atlasRoot.id, state.selectedNodeId, state.viewport)) {
        setMobileWorkspacePanelRevealed(false);
        return;
      }
      setMobileWorkspacePanelRevealed(true);
      setMobilePanelTab(onboarding.showAiFeatures ? "command" : "operation");
      setRenderWorkspacePanel(true);
    };
    window.addEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
  }, [onboarding.showAiFeatures, onboarding.showMainChrome]);

  useEffect(() => {
    if (selectedNodeId !== atlasRoot.id) {
      setMobileWorkspacePanelRevealed(false);
    }
  }, [atlasRoot.id, selectedNodeId]);

  useEffect(() => {
    if (onboarding.showAiFeatures && !showCommandDock) setMobileWorkspacePanelRevealed(false);
  }, [onboarding.showAiFeatures, showCommandDock]);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistRenderQualityPreference(renderQuality);
  }, [renderQuality]);

  usePreventBrowserViewportGestures();

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RENDER_QUALITY_STORAGE_KEY) return;
      if (!isRenderQuality(event.newValue)) return;
      setRenderQuality(event.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!voiceLogOpen) return;
    markVoiceLogSeen();
  }, [voiceLogOpen, voiceLogEntries.length, markVoiceLogSeen]);

  useEffect(() => {
    if (onboarding.showAiFeatures || mobilePanelTab !== "command") return;
    setMobilePanelTab("operation");
  }, [mobilePanelTab, onboarding.showAiFeatures]);

  useEffect(() => {
    if (showWorkspacePanel) {
      setRenderWorkspacePanel(true);
      return;
    }
    if (!pageActive) return;
    const timeout = window.setTimeout(() => setRenderWorkspacePanel(false), WORKSPACE_PANEL_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [pageActive, showWorkspacePanel]);

  useEffect(() => {
    if (onboarding.showMainChrome) return;
    setMenuOpen(false);
  }, [onboarding.showMainChrome]);

  useEffect(() => {
    if (onboarding.showAiFeatures) return;
    setVoiceLogOpen(false);
    setVoiceSettingsOpen(false);
    setCloudLoadOpen(false);
  }, [onboarding.showAiFeatures]);

  useEffect(() => {
    if (!onboarding.shouldApplyUniverseTitlePrompt) return;
    onboarding.markUniverseTitlePromptApplied();
  }, [
    onboarding.markUniverseTitlePromptApplied,
    onboarding.shouldApplyUniverseTitlePrompt,
  ]);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.documentElement.requestFullscreen));
  }, []);

  useMobileNotificationPulses(notificationPulses, atlasRoot, mobileNotificationsEnabled, mobileNotificationPermission);

  useEffect(() => {
    void restoreAttachmentPreviews().catch((error) => {
      console.error("Attachment preview restore failed", error);
    });
  }, [restoreAttachmentPreviews]);

  useEffect(() => {
    let recoveryRunning = false;
    const recover = () => {
      if (recoveryRunning) return;
      recoveryRunning = true;
      void recoverCompletedCodexRuns()
        .catch((error) => console.error("Codex run recovery failed", error))
        .finally(() => {
          recoveryRunning = false;
        });
    };
    const handleVisibility = () => {
      if (!document.hidden) recover();
    };
    recover();
    const interval = window.setInterval(recover, 60_000);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", recover);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", recover);
    };
  }, [recoverCompletedCodexRuns]);

  const handleExportLight = async () => {
    try {
      await saveNotebookNow();
      const blob = new Blob([exportNotebook()], { type: "application/mindatlas+json" });
      downloadBlob(blob, `${datasetFileName(atlasRoot.title)}.mindatlas`);
      setMenuOpen(false);
    } catch (error) {
      const message = exportErrorMessage("Light export failed.", error);
      console.error(message, error);
      window.alert(message);
    }
  };

  const handleExportPackage = async () => {
    let result: NotebookPackageResult;
    try {
      await saveNotebookNow();
      result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
    } catch (error) {
      const fallback = confirmJsonOnlyPackageFallback(atlasRoot, "Package export failed.", error);
      if (!fallback) return;
      result = fallback;
    }
    downloadBlob(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
    showPackageResultNotice(result);
    setMenuOpen(false);
  };

  const handleSaveToCloud = async () => {
    try {
      setCloudError("");
      setCloudStatus("Saving to cloud...");
      await saveNotebookNow();
      let result: NotebookPackageResult;
      try {
        result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
      } catch (packageError) {
        const fallback = confirmJsonOnlyPackageFallback(atlasRoot, "Cloud save package creation failed.", packageError);
        if (!fallback) {
          setCloudError(exportErrorMessage("Cloud save failed before upload completed.", packageError));
          setCloudStatus("");
          return;
        }
        result = fallback;
      }
      const saved = await saveCloudNotebookPackage(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
      setCloudStatus(`Saved: ${saved.name}${result.packageKind === "json" ? " (JSON-only)" : ""}`);
      window.alert(`クラウドへの保存が完了しました。\n\n保存ファイル: ${saved.name}`);
      showPackageResultNotice(result);
      setMenuOpen(false);
    } catch (error) {
      const message = exportErrorMessage("Cloud save failed.", error);
      setCloudError(message);
      setCloudStatus("");
      window.alert(message);
    }
  };

  const refreshCloudNotebooks = async () => {
    try {
      setCloudLoading(true);
      setCloudError("");
      const result = await listCloudNotebookPackages();
      setCloudNotebooks(result.notebooks);
      setCloudDirectory(result.directory);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud notebook list failed.";
      setCloudError(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleOpenCloudLoad = () => {
    setCloudLoadOpen(true);
    setMenuOpen(false);
    void refreshCloudNotebooks();
  };

  const handleOpenRestoreHistory = () => {
    setRestoreHistoryOpen(true);
    setMenuOpen(false);
    void refreshNotebookSnapshots();
  };

  const handleLoadCloudNotebook = async (entry: CloudNotebookEntry) => {
    try {
      setCloudLoading(true);
      setCloudError("");
      const blob = await downloadCloudNotebookPackage(entry.name);
      const file = new File([blob], entry.name, { type: "application/x-mindatlas-package" });
      const { root, attachmentPreviewUrls, attachmentBlobs } = await importNotebookPackage(file);
      await replaceStoredAttachmentBlobs(root, attachmentBlobs);
      importNotebook(root, undefined, attachmentPreviewUrls);
      setCloudLoadOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud notebook load failed.";
      setCloudError(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleImportFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".mindatlaspkg")) {
      try {
        const { root, attachmentPreviewUrls, attachmentBlobs } = await importNotebookPackage(file);
        await replaceStoredAttachmentBlobs(root, attachmentBlobs);
        importNotebook(root, datasetNameFromFile(file.name), attachmentPreviewUrls);
        setMenuOpen(false);
      } catch (error) {
        console.error("Notebook package import failed", error);
        window.alert(importErrorMessage("Package import failed.", error));
      }
      return;
    }

    const externalFormat = detectImportFormat(file.name);
    if (externalFormat) {
      try {
        const result = await importExternalNotebookFile(file);
        await replaceStoredAttachmentBlobs(result.root, {});
        importNotebook(result.root, result.datasetName);
        setMenuOpen(false);
      } catch (error) {
        console.error(`${externalFormat} import failed`, error);
        window.alert(importErrorMessage(`${externalFormatLabel(externalFormat)} import failed.`, error));
      }
      return;
    }

    try {
      const root = JSON.parse(await file.text()) as AtlasNode;
      await replaceStoredAttachmentBlobs(root, {});
      importNotebook(root, datasetNameFromFile(file.name));
      setMenuOpen(false);
    } catch (error) {
      console.error("Notebook import failed", error);
      window.alert(importErrorMessage("Notebook import failed.", error));
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleImportFile(file);
    event.target.value = "";
  };

  const parseTextImportMarkdown = () => importMarkdownText(textImportValue, selectedNode.title || "Imported text outline").root;

  const handleReplaceActiveNodeBody = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      const body = markdownBodyForActiveNodeReplacement(importedRoot);
      updateNode(selectedNodeId, { body, summary: firstMarkdownLine(body) || selectedNode.summary });
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Replace active node body failed", error);
      window.alert(importErrorMessage("Replace active node body failed.", error));
    }
  };

  const handleReplaceActiveSubtree = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      applyOutlineSubtree(selectedNodeId, atlasNodeToOutlineInput(importedRoot, selectedNodeId), { focusKey: selectedNodeId });
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Replace active subtree failed", error);
      window.alert(importErrorMessage("Replace active subtree failed.", error));
    }
  };

  const handleAppendAsChildren = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      const appended = importedRoot.children.length ? importedRoot.children : [importedRoot];
      applyOutlineSubtree(
        selectedNodeId,
        {
          id: selectedNode.id,
          clientKey: selectedNode.id,
          title: selectedNode.title,
          body: selectedNode.body,
          children: [
            ...selectedNode.children.map((child) => atlasNodeToOutlineInput(child)),
            ...appended.map((child) => atlasNodeToOutlineInput(child)),
          ],
        },
        { focusKey: appended[0]?.id },
      );
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Append as children failed", error);
      window.alert(importErrorMessage("Append as children failed.", error));
    }
  };

  const handleOpenPreviewMerge = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      setMergePreview(createMergePreviewState(selectedNode, importedRoot));
    } catch (error) {
      console.error("Preview merge failed", error);
      window.alert(importErrorMessage("Preview merge failed.", error));
    }
  };

  const handleApplyPreviewMerge = () => {
    if (!mergePreview) return;
    applyOutlineSubtree(selectedNodeId, mergePreviewToOutline(selectedNode, mergePreview), { focusKey: selectedNodeId });
    setTextImportValue("");
    setTextImportOpen(false);
    setMergePreview(null);
    setMenuOpen(false);
  };

  const handleImportDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragImportActive(true);
  };

  const handleImportDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragImportActive(true);
  };

  const handleImportDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragImportActive(false);
  };

  const handleImportDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragImportActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  };

  const handleInitialize = () => {
    const confirmed = window.confirm("Initialize this atlas and remove all local notebook changes?");
    if (!confirmed) return;
    resetNotebook();
    setMenuOpen(false);
  };

  const handleUndo = () => {
    undo();
    setMenuOpen(false);
  };

  const handleRedo = () => {
    redo();
    setMenuOpen(false);
  };

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || !event.ctrlKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "c") {
        event.preventDefault();
        void copyContextMarkdown(atlasRoot, selectedNodeId, "ancestors")
          .then((result) => {
            setContextCopyStatus(`Copied ${formatContextCopyStats(result)}`);
            window.setTimeout(() => setContextCopyStatus(""), 2400);
          })
          .catch((error) => {
            setContextCopyStatus(error instanceof Error ? error.message : "Copy failed.");
            window.setTimeout(() => setContextCopyStatus(""), 2400);
          });
        return;
      }

      if (event.shiftKey) return;
      if (key === "z") {
        if (!canUndo) return;
        event.preventDefault();
        undo();
        setMenuOpen(false);
        return;
      }

      if (key === "y") {
        if (!canRedo) return;
        event.preventDefault();
        redo();
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleHistoryShortcut, { capture: true });
  }, [atlasRoot, canRedo, canUndo, redo, selectedNodeId, undo]);

  const handleOpenVoiceLog = () => {
    setVoiceLogOpen(true);
    markVoiceLogSeen();
    setMenuOpen(false);
  };

  const handleOpenVoiceSettings = () => {
    setVoiceSettingsOpen(true);
    setMenuOpen(false);
  };

  const handleFocusNotification = (id: string) => {
    focusNode(id);
    showNotificationSnoozePrompt(id);
  };

  const handleRestartRealtime = () => {
    window.dispatchEvent(new Event(REALTIME_VOICE_RESTART_EVENT));
    setMenuOpen(false);
  };

  const handleToggleMobileNotifications = async () => {
    setMobileNotificationMessage("");
    if (!isMobileNotificationTarget()) {
      setMobileNotificationMessage("Mobile only on this device");
      setMobileNotificationPermission(getMobileNotificationPermission());
      return;
    }
    if (!isNotificationSupported()) {
      setMobileNotificationMessage("Notifications unsupported");
      setMobileNotificationPermission("unsupported");
      return;
    }
    if (mobileNotificationsEnabled) {
      persistMobileNotificationPreference(false);
      setMobileNotificationsEnabled(false);
      setMobileNotificationMessage("Off");
      return;
    }
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setMobileNotificationPermission(permission);
    const enabled = permission === "granted";
    persistMobileNotificationPreference(enabled);
    setMobileNotificationsEnabled(enabled);
    setMobileNotificationMessage(enabled ? "On" : permission === "denied" ? "Blocked in browser settings" : "Off");
  };

  const handleEnterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    } catch {
      // Android Chrome can refuse fullscreen outside direct user gestures or on unsupported surfaces.
    } finally {
      setMenuOpen(false);
    }
  };

  const handleToggleVrMode = async () => {
    setVrModeMessage("");
    if (vrModeEnabled) {
      setVrModeEnabled(false);
      setVrModeMessage("Off");
      return;
    }
    if (!isDeviceOrientationSupported()) {
      setVrModeMessage("Unsupported on this device");
      return;
    }
    const permission = await requestDeviceOrientationAccess();
    if (permission !== "granted") {
      setVrModeEnabled(false);
      setVrModeMessage(permission === "denied" ? "Blocked in browser settings" : "Permission required");
      return;
    }
    setVrModeEnabled(true);
    setVrModeMessage("On");
  };

  const handleRenderQualityChange = (quality: RenderQuality) => {
    setRenderQuality(quality);
    persistRenderQualityPreference(quality);
  };

  const handleLayoutModeChange = (mode: AtlasLayoutMode) => {
    setLayoutMode(mode);
    persistUiStatePatch({ ...latestUiStateRef.current, layoutMode: mode });
    setMenuOpen(false);
  };

  const handleOpenOutlineEditor = () => {
    setOutlineEditorRootId(selectedNodeId);
    setOutlineEditorOpen(true);
    setMobilePanelTab("outline");
    setRenderWorkspacePanel(true);
    setMenuOpen(false);
  };

  const handleCloseOutlineEditor = () => {
    setOutlineEditorOpen(false);
    setOutlineEditorRootId(null);
    setMobilePanelTab(onboarding.showAiFeatures ? "command" : "editor");
  };

  return (
    <main
      className={appClassName}
      data-theme={theme}
      data-focus-panel={focusPanelOpen ? "open" : "closed"}
      onDragEnter={handleImportDragEnter}
      onDragOver={handleImportDragOver}
      onDragLeave={handleImportDragLeave}
      onDrop={handleImportDrop}
    >
      <UniverseCanvas
        theme={theme}
        vrPanEnabled={vrModeEnabled}
        renderQuality={renderQuality}
        layoutMode={layoutMode}
        pageActive={pageActive}
        initialCameraPose={persistedUiState?.cameraPose ?? null}
      />
      {onboarding.showRootPulse ? <div className="onboarding-center-pulse" aria-hidden="true" /> : null}
      {onboarding.message ? (
        <div className="onboarding-message" role="status" aria-live="polite">
          {onboarding.message}
        </div>
      ) : null}
      {contextCopyStatus ? (
        <div className="onboarding-message context-copy-toast" role="status" aria-live="polite">
          {contextCopyStatus}
        </div>
      ) : null}
      {dragImportActive ? (
        <div className="import-drop-overlay" role="status" aria-live="polite">
          <Upload size={28} />
          <span>Drop Markdown, OPML, FreeMind, or Mind Atlas file</span>
        </div>
      ) : null}

      <header className="top-bar" aria-label="Mind Atlas status">
        <div className="top-title-stack">
          <AtlasBreadcrumb path={onboarding.showLogoOnly ? [atlasRoot] : selectedPath} mobilePortrait={mobilePortraitBreadcrumb} onFocus={focusNode} />
          {onboarding.showMainChrome ? (
            <>
              <DatasetTitleInput
                title={atlasRoot.title}
                placeholderTitle={onboarding.titlePrompt}
                onChange={(title) => updateNode(atlasRoot.id, { title })}
              />
              <UnreadNotificationLinks
                items={unreadNotificationLinks}
                voiceLogEntry={latestTextPartnerEntry}
                voiceLogUnreadCount={unreadTextPartnerEntries.length}
                onFocus={handleFocusNotification}
                onOpenVoiceLog={handleOpenVoiceLog}
              />
            </>
          ) : null}
        </div>
      </header>

      {onboarding.showMainChrome ? (
      <div ref={globalMenuRef} className="global-menu" aria-label="Atlas actions">
        <button className="icon-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Open atlas menu">
          <MoreHorizontal size={19} />
        </button>
        {menuOpen ? (
          <div className="context-menu global-context-menu">
            <div className="context-menu-section" aria-label="Background mode">
              <span className="context-menu-section-title">Background</span>
              <div className="theme-choice-row">
                <button
                  className={theme === "dark" ? "is-active" : ""}
                  type="button"
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                >
                  <Moon size={15} /> Black
                </button>
                <button
                  className={theme === "light" ? "is-active" : ""}
                  type="button"
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                >
                  <Sun size={15} /> White
                </button>
              </div>
            </div>
            <div className="context-menu-section" aria-label="Mode">
              <span className="context-menu-section-title">Mode</span>
              <div className="theme-choice-row mode-choice-row">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    className={layoutMode === option.mode ? "is-active" : ""}
                    type="button"
                    onClick={() => handleLayoutModeChange(option.mode)}
                    aria-pressed={layoutMode === option.mode}
                    title={getAtlasLayoutModeLabel(option.mode)}
                  >
                    <LayoutModeIcon icon={option.icon} />
                    {getAtlasLayoutModeLabel(option.mode)}
                  </button>
                ))}
                <button
                  className={outlineEditorOpen ? "is-active" : ""}
                  type="button"
                  onClick={handleOpenOutlineEditor}
                  aria-pressed={outlineEditorOpen}
                  title="Outline"
                >
                  <PenLine size={15} />
                  Outline
                </button>
              </div>
            </div>
            <div className="undo-redo-row" aria-label="History actions">
              <button type="button" onClick={handleUndo} disabled={!canUndo} aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)">
                <Undo2 size={15} /> Undo
              </button>
              <button type="button" onClick={handleRedo} disabled={!canRedo} aria-keyshortcuts="Control+Y" title="Redo (Ctrl+Y)">
                <Redo2 size={15} /> Redo
              </button>
            </div>
            {onboarding.showAiFeatures ? (
              <>
                <button type="button" onClick={handleOpenVoiceLog}>
                  <MessageSquareText size={15} />
                  <span>
                    AI Partner log
                    <small>{voiceLogUnreadLabel(unreadTextPartnerEntries.length, voiceLogEntries.length)}</small>
                  </span>
                </button>
                <button type="button" onClick={handleRestartRealtime}>
                  <Radio size={15} />
                  <span>
                    Restart Realtime
                    <small>reset voice context</small>
                  </span>
                </button>
                <button type="button" onClick={handleOpenVoiceSettings}>
                  <Settings2 size={15} />
                  <span>
                    Voice settings
                    <small>{voicePartnerSettings.realtimeVoice} / {voicePartnerSettings.realtimeModel}</small>
                  </span>
                </button>
              </>
            ) : null}
            <button type="button" onClick={handleToggleMobileNotifications}>
              {mobileNotificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />}
              <span>
                Mobile notifications
                <small>{mobileNotificationStatusLabel(mobileNotificationsEnabled, mobileNotificationPermission, mobileNotificationMessage)}</small>
              </span>
            </button>
            <button type="button" onClick={handleEnterFullscreen} disabled={!fullscreenSupported}>
              <Maximize2 size={15} />
              <span>
                Enter fullscreen
                <small>hide browser bars</small>
              </span>
            </button>
            <button
              className={vrModeEnabled ? "is-active" : ""}
              type="button"
              onClick={handleToggleVrMode}
              aria-pressed={vrModeEnabled}
              disabled={!vrModeEnabled && !isDeviceOrientationSupported()}
            >
              <Smartphone size={15} />
              <span>
                VR mode
                <small>{vrModeStatusLabel(vrModeEnabled, vrModeMessage)}</small>
              </span>
            </button>
            <div className="context-menu-section" aria-label="Render quality">
              <span className="context-menu-section-title">Render quality</span>
              <div className="theme-choice-row">
                <button
                  className={renderQuality === "high" ? "is-active" : ""}
                  type="button"
                  onClick={() => handleRenderQualityChange("high")}
                  aria-pressed={renderQuality === "high"}
                >
                  High
                </button>
                <button
                  className={renderQuality === "low" ? "is-active" : ""}
                  type="button"
                  onClick={() => handleRenderQualityChange("low")}
                  aria-pressed={renderQuality === "low"}
                >
                  Low
                </button>
              </div>
            </div>
            <button type="button" onClick={handleExportLight}>
              <Download size={15} />
              <span>
                Export light
                <small>.mindatlas / metadata only</small>
              </span>
            </button>
            <button type="button" onClick={handleExportPackage}>
              <Download size={15} />
              <span>
                Export with files
                <small>.mindatlaspkg / includes images and video</small>
              </span>
            </button>
            <button type="button" onClick={handleOpenRestoreHistory}>
              <History size={15} />
              <span>
                Restore from history
                <small>{notebookHistoryStatusLabel(notebookPersistenceStatus, notebookSnapshots.length, durableNotebookStorage, notebookPersistenceError)}</small>
              </span>
            </button>
            {onboarding.showAiFeatures ? (
              <>
                <button type="button" onClick={handleSaveToCloud}>
                  <CloudUpload size={15} />
                  <span>
                    クラウドへ保存
                    <small>{cloudStatus || ".mindatlaspkg / server folder"}</small>
                  </span>
                </button>
                <button type="button" onClick={handleOpenCloudLoad}>
                  <CloudDownload size={15} />
                  <span>
                    クラウドから読み込み
                    <small>{cloudError || "choose a server package"}</small>
                  </span>
                </button>
              </>
            ) : null}
            <label>
              <Upload size={15} /> Import
              <input type="file" accept={IMPORT_ACCEPT_TYPES} onChange={handleImport} />
            </label>
            <button type="button" onClick={() => { setTextImportOpen(true); setMenuOpen(false); }}>
              <FileText size={15} />
              <span>
                Import text outline
                <small>Markdown headings and lists</small>
              </span>
            </button>
            <button type="button" onClick={handleInitialize}>
              <RotateCcw size={15} /> Initialize
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {onboarding.showMainChrome ? <Minimap /> : null}
      {onboarding.showMainChrome && !mobileOperationSurface ? <OperationPanel actions={operationActions} variant="desktop" /> : null}
      {renderWorkspacePanel ? (
        <section
          className={`mobile-workspace-panel ${showWorkspacePanel ? "is-open" : "is-closing"}`}
          data-active-tab={effectiveMobilePanelTab}
          aria-label="Mobile workspace"
        >
          <div className="mobile-workspace-tabs" role="tablist" aria-label="Workspace panel">
            {showCommandDock ? (
              <button
                className={effectiveMobilePanelTab === "command" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "command"}
                onClick={() => setMobilePanelTab("command")}
              >
                <MessageSquareText size={15} />
                <span>AI</span>
              </button>
            ) : null}
            <button
              className={effectiveMobilePanelTab === "editor" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={effectiveMobilePanelTab === "editor"}
              onClick={() => setMobilePanelTab("editor")}
            >
              <PenLine size={15} />
              <span>Editor</span>
            </button>
            <button
              className={effectiveMobilePanelTab === "operation" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={effectiveMobilePanelTab === "operation"}
              onClick={() => setMobilePanelTab("operation")}
            >
              <Settings2 size={15} />
              <span>Operation</span>
            </button>
            {outlineEditorOpen ? (
              <button
                className={effectiveMobilePanelTab === "outline" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "outline"}
                onClick={() => setMobilePanelTab("outline")}
              >
                <ListTree size={15} />
                <span>Outline</span>
              </button>
            ) : null}
          </div>
          {showCommandDock ? (
            <div className="mobile-panel-slot mobile-command-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "command"}>
              <CommandDock />
            </div>
          ) : null}
          <div className="mobile-panel-slot mobile-editor-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "editor"}>
            <FocusPanel theme={theme} />
          </div>
          <div className="mobile-panel-slot mobile-operation-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "operation"}>
            <OperationPanel actions={operationActions} variant="mobile" />
          </div>
          <div className="mobile-panel-slot mobile-outline-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "outline"}>
            {outlineEditorOpen ? (
              <OutlineEditor
                root={outlineEditorRoot}
                selectedNodeId={findNode(outlineEditorRoot, selectedNodeId) ? selectedNodeId : outlineEditorRoot.id}
                onClose={handleCloseOutlineEditor}
                onFocusNode={selectNodeInPlace}
                onApplyOutline={applyOutlineSubtree}
                onUpdateNodeLive={updateNodeLive}
              />
            ) : null}
          </div>
        </section>
      ) : null}
      {textImportOpen ? (
        <TextImportModal
          value={textImportValue}
          onChange={setTextImportValue}
          onReplaceBody={handleReplaceActiveNodeBody}
          onReplaceSubtree={handleReplaceActiveSubtree}
          onAppendChildren={handleAppendAsChildren}
          onPreviewMerge={handleOpenPreviewMerge}
          onClose={() => setTextImportOpen(false)}
        />
      ) : null}
      {mergePreview ? (
        <MergePreviewDialog
          state={mergePreview}
          onChange={setMergePreview}
          onApply={handleApplyPreviewMerge}
          onClose={() => setMergePreview(null)}
        />
      ) : null}
      {onboarding.showAiFeatures && voiceLogOpen ? (
        <VoiceLogDialog
          entries={voiceLogEntries}
          summary={voiceSessionSummary}
          onClose={() => setVoiceLogOpen(false)}
          onClear={clearVoiceLog}
        />
      ) : null}
      {onboarding.showAiFeatures && voiceSettingsOpen ? (
        <VoiceSettingsDialog
          settings={voicePartnerSettings}
          onClose={() => setVoiceSettingsOpen(false)}
          onSave={setVoicePartnerSettings}
          onRestart={handleRestartRealtime}
        />
      ) : null}
      {restoreHistoryOpen ? (
        <NotebookHistoryDialog
          snapshots={notebookSnapshots}
          status={notebookPersistenceStatus}
          error={notebookPersistenceError}
          onClose={() => setRestoreHistoryOpen(false)}
          onRefresh={refreshNotebookSnapshots}
          onRestore={restoreNotebookFromSnapshot}
        />
      ) : null}
      {onboarding.showAiFeatures && cloudLoadOpen ? (
        <CloudLoadDialog
          notebooks={cloudNotebooks}
          directory={cloudDirectory}
          loading={cloudLoading}
          error={cloudError}
          onClose={() => setCloudLoadOpen(false)}
          onRefresh={refreshCloudNotebooks}
          onLoad={handleLoadCloudNotebook}
        />
      ) : null}
    </main>
  );
}

function TextImportModal({
  value,
  onChange,
  onReplaceBody,
  onReplaceSubtree,
  onAppendChildren,
  onPreviewMerge,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onReplaceBody: () => void;
  onReplaceSubtree: () => void;
  onAppendChildren: () => void;
  onPreviewMerge: () => void;
  onClose: () => void;
}) {
  const canImport = value.trim().length > 0;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog text-import-dialog" role="dialog" aria-modal="true" aria-label="Import text outline" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>Import text outline</strong>
            <span>Paste Markdown from ChatGPT, then choose how to apply it to the active node.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close text import">
            <X size={16} />
          </button>
        </header>
        <textarea
          aria-label="Markdown outline text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"# Book\n\n## Chapter 1\n\n- Scene 1\n- Scene 2"}
        />
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={onReplaceBody} disabled={!canImport}>Replace active node body</button>
          <button type="button" onClick={onReplaceSubtree} disabled={!canImport}>Replace active subtree</button>
          <button type="button" onClick={onAppendChildren} disabled={!canImport}>Append as children</button>
          <button type="button" onClick={onPreviewMerge} disabled={!canImport}>Preview merge</button>
        </footer>
      </section>
    </div>
  );
}

function MergePreviewDialog({
  state,
  onChange,
  onApply,
  onClose,
}: {
  state: MergePreviewState;
  onChange: (state: MergePreviewState) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const updateChoice = (key: string, choice: MergeChoice) => onChange({ root: updateMergeChoice(state.root, key, choice) });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog merge-preview-dialog" role="dialog" aria-modal="true" aria-label="Preview merge" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>Preview merge</strong>
            <span>Choose current or incoming text per node block before applying.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close merge preview">
            <X size={16} />
          </button>
        </header>
        <div className="merge-preview-list">
          <MergePreviewBlockView block={state.root} onChoice={updateChoice} />
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={onApply}>Apply merge</button>
        </footer>
      </section>
    </div>
  );
}

function MergePreviewBlockView({ block, onChoice }: { block: MergePreviewBlock; onChoice: (key: string, choice: MergeChoice) => void }) {
  const changed = block.currentTitle !== block.incomingTitle || block.currentBody !== block.incomingBody;
  return (
    <section className={`merge-preview-block ${changed ? "is-changed" : ""}`}>
      <header>
        <div>
          <strong>{block.path}</strong>
          <span>{changed ? "Changed" : "Unchanged"}</span>
        </div>
        <div className="merge-choice-buttons" role="group" aria-label={`Merge choice for ${block.path}`}>
          <button type="button" className={block.choice === "current" ? "is-active" : ""} onClick={() => onChoice(block.key, "current")}>Keep current</button>
          <button type="button" className={block.choice === "incoming" ? "is-active" : ""} onClick={() => onChoice(block.key, "incoming")}>Accept incoming</button>
        </div>
      </header>
      <div className="merge-columns">
        <article>
          <span>Current</span>
          <strong>{block.currentTitle || "Untitled"}</strong>
          <pre>{block.currentBody || "(empty)"}</pre>
        </article>
        <article>
          <span>Incoming</span>
          <strong>{block.incomingTitle || "Untitled"}</strong>
          <pre>{block.incomingBody || "(empty)"}</pre>
        </article>
      </div>
      {block.children.length ? (
        <div className="merge-preview-children">
          {block.children.map((child) => <MergePreviewBlockView key={child.key} block={child} onChoice={onChoice} />)}
        </div>
      ) : null}
    </section>
  );
}

function CloudLoadDialog({
  notebooks,
  directory,
  loading,
  error,
  onClose,
  onRefresh,
  onLoad,
}: {
  notebooks: CloudNotebookEntry[];
  directory: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onLoad: (entry: CloudNotebookEntry) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cloud-load-dialog" role="dialog" aria-modal="true" aria-label="クラウドから読み込み" onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>クラウドから読み込み</h2>
            <p>{directory || "Server notebook folder"}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh cloud notebooks" disabled={loading}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close cloud loader">
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="cloud-package-list">
          {error ? <p className="cloud-dialog-status is-error">{error}</p> : null}
          {loading ? <p className="cloud-dialog-status">Loading...</p> : null}
          {!loading && !notebooks.length ? <p className="cloud-dialog-status">No cloud packages found.</p> : null}
          {notebooks.map((entry) => (
            <button key={entry.name} className="cloud-package-button" type="button" onClick={() => onLoad(entry)} disabled={loading}>
              <span>
                <strong>{entry.name}</strong>
                <small>{formatBytes(entry.size)} / {formatVoiceLogTime(entry.updatedAt)}</small>
              </span>
              <CloudDownload size={16} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function VoiceSettingsDialog({
  settings,
  onClose,
  onSave,
  onRestart,
}: {
  settings: VoicePartnerSettings;
  onClose: () => void;
  onSave: (settings: Partial<VoicePartnerSettings>) => void;
  onRestart: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const handleRestart = () => {
    onSave(draft);
    onRestart();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="voice-settings-dialog" role="dialog" aria-modal="true" aria-label="Voice settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>Voice settings</h2>
            <p>{draft.realtimeVoice} / {draft.realtimeModel}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close Voice settings">
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="voice-settings-form">
          <label className="voice-settings-field">
            <span>Realtime model</span>
            <input
              value={draft.realtimeModel}
              onChange={(event) => setDraft((current) => ({ ...current, realtimeModel: event.target.value }))}
              placeholder="gpt-realtime-2"
            />
          </label>
          <label className="voice-settings-field">
            <span>Voice</span>
            <select
              value={VOICE_OPTION_IDS.includes(draft.realtimeVoice) ? draft.realtimeVoice : "custom"}
              onChange={(event) => {
                if (event.target.value !== "custom") {
                  setDraft((current) => ({ ...current, realtimeVoice: event.target.value }));
                }
              }}
            >
              {VOICE_OPTION_IDS.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="voice-settings-field">
            <span>Custom voice</span>
            <input
              value={draft.realtimeVoice}
              onChange={(event) => setDraft((current) => ({ ...current, realtimeVoice: event.target.value }))}
              placeholder="marin"
            />
          </label>
        </div>
        <footer className="voice-settings-actions">
          <button className="secondary-button" type="button" onClick={handleSave}>
            <Volume2 size={15} /> Save
          </button>
          <button className="secondary-button" type="button" onClick={handleRestart}>
            <RefreshCw size={15} /> Save and restart
          </button>
        </footer>
      </section>
    </div>
  );
}

function LayoutModeIcon({ icon }: { icon: "orbit" | "tree" | "mind" }) {
  switch (icon) {
    case "orbit":
      return <Orbit size={15} />;
    case "tree":
      return <GitBranch size={15} />;
    case "mind":
      return <Network size={15} />;
  }
}

function OperationPanel({ actions, variant }: { actions: OperationAction[]; variant: "desktop" | "mobile" }) {
  return (
    <nav className={`operation-panel operation-panel-${variant}`} aria-label="Node operations">
      {actions.map((action) => (
        <button
          key={action.id}
          className="operation-button"
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={`${action.label} (${action.shortcut})`}
          aria-label={action.label}
        >
          {action.icon}
          <small>{action.shortcut}</small>
        </button>
      ))}
    </nav>
  );
}

function getEffectiveMobilePanelTab(tab: MobilePanelTab, showCommandDock: boolean, outlineEditorOpen: boolean): MobilePanelTab {
  if (tab === "outline") return outlineEditorOpen ? "outline" : showCommandDock ? "command" : "operation";
  if (tab === "command") return showCommandDock ? "command" : "operation";
  return tab;
}

function getOperationTargets(path: AtlasNode[]) {
  const node = path.at(-1);
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const siblings = parent?.children ?? [];
  const siblingIndex = node ? siblings.findIndex((sibling) => sibling.id === node.id) : -1;
  return {
    parentId: parent?.id ?? null,
    childId: node?.children[0]?.id ?? null,
    previousSiblingId: siblingIndex > 0 ? siblings[siblingIndex - 1]?.id ?? null : null,
    nextSiblingId: siblingIndex >= 0 ? siblings[siblingIndex + 1]?.id ?? null : null,
  };
}

function VoiceLogDialog({
  entries,
  summary,
  onClose,
  onClear,
}: {
  entries: ReturnType<typeof useAtlasStore.getState>["voiceLogEntries"];
  summary: ReturnType<typeof useAtlasStore.getState>["voiceSessionSummary"];
  onClose: () => void;
  onClear: () => void;
}) {
  const displayedEntries = [...entries].reverse();
  const approvalCount = entries.filter((entry) => entry.status === "approval_required").length;

  const handleClear = () => {
    const confirmed = window.confirm("Clear the local AI Partner log?");
    if (!confirmed) return;
    onClear();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="voice-log-dialog" role="dialog" aria-modal="true" aria-label="AI Partner log" onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header voice-log-header-with-clear">
          <button className="icon-button" type="button" onClick={handleClear} aria-label="Clear AI Partner log" disabled={entries.length === 0}>
            <Trash2 size={16} />
          </button>
          <div>
            <h2>AI Partner log</h2>
            <p>{entries.length} entries{approvalCount ? ` / ${approvalCount} approval pending` : ""}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close AI Partner log">
              <X size={17} />
            </button>
          </div>
        </header>
        {summary ? (
          <article className="voice-log-summary">
            <strong>Latest summary</strong>
            <time>{formatVoiceLogTime(summary.createdAt)}</time>
            <p>{summary.text}</p>
          </article>
        ) : null}
        <div className="voice-log-list">
          {displayedEntries.length ? (
            displayedEntries.map((entry) => (
              <article key={entry.id} className={`voice-log-entry is-${entry.role}`}>
                <header>
                  <strong>{entry.title || voiceRoleLabel(entry.role)}</strong>
                  <span>{entry.status ? `${entry.status} / ` : ""}{formatVoiceLogTime(entry.createdAt)}</span>
                </header>
                <p>{entry.text}</p>
                {entry.status === "approval_required" ? (
                  <div className="voice-log-approval" role="status">
                    Human approval required. This tool request was logged but not executed.
                  </div>
                ) : null}
                {entry.toolName ? <small>tool: {entry.toolName}</small> : null}
                {entry.metadata ? <small>{formatVoiceLogMetadata(entry.metadata)}</small> : null}
              </article>
            ))
          ) : (
            <p className="voice-log-empty">No AI Partner log entries yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NotebookHistoryDialog({
  snapshots,
  status,
  error,
  onClose,
  onRefresh,
  onRestore,
}: {
  snapshots: NotebookSnapshot[];
  status: NotebookPersistenceStatus;
  error: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState("");

  const handleRestore = async (snapshot: NotebookSnapshot) => {
    const confirmed = window.confirm(`Restore "${snapshot.title}" from ${formatFullDateTime(snapshot.createdAt)}? The current notebook will be saved in history first.`);
    if (!confirmed) return;
    try {
      setRestoringId(snapshot.id);
      await onRestore(snapshot.id);
      onClose();
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : "Notebook restore failed.";
      window.alert(message);
    } finally {
      setRestoringId("");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog" role="dialog" aria-modal="true" aria-label="Restore from history" onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>Restore from history</h2>
            <p>{notebookHistoryDialogStatus(status, snapshots.length, error)}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={() => void onRefresh()} aria-label="Refresh notebook history">
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close notebook history">
              <X size={17} />
            </button>
          </div>
        </header>
        {error ? <p className="notebook-history-error">{error}</p> : null}
        <div className="notebook-history-list">
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <article key={snapshot.id} className="notebook-history-entry">
                <div>
                  <strong>{snapshot.title}</strong>
                  <span>
                    Generation {snapshot.generation} / {formatFullDateTime(snapshot.createdAt)}
                  </span>
                  <small>
                    {snapshot.nodeCount} nodes / {formatBytes(snapshot.sizeBytes)}
                  </small>
                </div>
                <button className="secondary-button" type="button" disabled={Boolean(restoringId)} onClick={() => void handleRestore(snapshot)}>
                  {restoringId === snapshot.id ? "Restoring..." : "Restore"}
                </button>
              </article>
            ))
          ) : (
            <p className="voice-log-empty">No notebook snapshots yet. Make an edit and Mind Atlas will save history automatically.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function notebookHistoryStatusLabel(
  status: NotebookPersistenceStatus,
  snapshotCount: number,
  durable: boolean,
  error: string,
) {
  if (error) return "save error";
  if (status === "loading") return "loading snapshots";
  return `${snapshotCount} snapshots${durable ? " / durable" : ""}`;
}

function notebookHistoryDialogStatus(status: NotebookPersistenceStatus, snapshotCount: number, error: string) {
  if (error) return "Notebook persistence needs attention";
  if (status === "loading") return "Loading local notebook history";
  return `${snapshotCount} retained snapshots`;
}

function voiceRoleLabel(role: string) {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Voice Partner";
    case "tool":
      return "Tool";
    case "summary":
      return "Summary";
    case "error":
      return "Error";
    default:
      return "System";
  }
}

function formatVoiceLogMetadata(metadata: Record<string, unknown>) {
  const sources = Array.isArray(metadata.sources) ? metadata.sources.length : undefined;
  const citations = Array.isArray(metadata.citations) ? metadata.citations.length : undefined;
  const usage = metadata.usage && typeof metadata.usage === "object" && !Array.isArray(metadata.usage)
    ? (metadata.usage as Record<string, unknown>)
    : undefined;
  const items = [
    ["approval", metadata.approvalId],
    ["tool", metadata.toolName],
    ["status", metadata.status],
    ["executed", typeof metadata.executed === "boolean" ? String(metadata.executed) : undefined],
    ["model", metadata.model],
    ["provider", metadata.provider],
    ["duration", typeof metadata.durationMs === "number" ? `${metadata.durationMs}ms` : usageNumber(usage?.durationMs, "ms")],
    ["tokens", usageNumber(usage?.totalTokens)],
    ["audio", typeof metadata.audioSizeBytes === "number" ? formatBytes(metadata.audioSizeBytes) : undefined],
    ["mime", metadata.audioMimeType ?? metadata.mimeType],
    ["chunks", metadata.chunks],
    ["sources", sources],
    ["citations", citations],
    ["node", metadata.nodeId],
    ["nodes", Array.isArray(metadata.nodeIds) ? metadata.nodeIds.length : undefined],
    ["args", summarizeMetadataArgs(metadata.args)],
  ]
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  return items.join(" / ");
}

function usageNumber(value: unknown, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : undefined;
}

function summarizeMetadataArgs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, 4)
    .map(([key, item]) => `${key}=${summarizeMetadataArgValue(item)}`);
  return entries.length ? entries.join(", ") : undefined;
}

function summarizeMetadataArgValue(value: unknown) {
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (value && typeof value === "object") return "object";
  return "";
}

function formatVoiceLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

type MobileNotificationPermission = NotificationPermission | "unsupported";
type RenderQuality = "high" | "low";
type DeviceOrientationPermissionState = "granted" | "denied" | "prompt";
type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>;
};

const MOBILE_NOTIFICATION_STORAGE_KEY = "mind-atlas-mobile-notifications-v1";

function useMobileNotificationPulses(
  pulses: NotificationPulse[],
  atlasRoot: AtlasNode,
  enabled: boolean,
  permission: MobileNotificationPermission,
) {
  const seenPulseIdsRef = useRef<Set<string>>(new Set());
  const lastNotificationByTagRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      pulses.forEach((pulse) => seenPulseIdsRef.current.add(pulse.id));
      return;
    }

    for (const pulse of pulses) {
      if (seenPulseIdsRef.current.has(pulse.id)) continue;
      seenPulseIdsRef.current.add(pulse.id);
      if (enabled && permission === "granted" && isMobileNotificationTarget()) {
        const tag = `${pulse.nodeId}:${pulse.kind}:${pulse.title}`;
        const now = Date.now();
        const lastSentAt = lastNotificationByTagRef.current.get(tag) ?? 0;
        if (now - lastSentAt > 5 * 60 * 1000) {
          lastNotificationByTagRef.current.set(tag, now);
          sendMobilePulseNotification(pulse, atlasRoot);
        }
      }
    }

    if (seenPulseIdsRef.current.size > 500) {
      seenPulseIdsRef.current = new Set(pulses.slice(-120).map((pulse) => pulse.id));
    }
  }, [atlasRoot, enabled, permission, pulses]);
}

function sendMobilePulseNotification(pulse: NotificationPulse, atlasRoot: AtlasNode) {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  const message = buildMobileNotificationMessage(pulse, atlasRoot);
  const options: NotificationOptions & { badge?: string; timestamp?: number; renotify?: boolean } = {
    body: message.body,
    tag: `mind-atlas-${pulse.nodeId}-${pulse.kind}`,
    renotify: false,
    badge: "/favicon.svg",
    icon: "/favicon.svg",
    timestamp: Date.now(),
    data: {
      nodeId: pulse.nodeId,
      kind: pulse.kind,
    },
  };
  showMobileNotification(message.title, options);
}

async function showMobileNotification(
  title: string,
  options: NotificationOptions & { badge?: string; timestamp?: number; renotify?: boolean },
) {
  if ("serviceWorker" in navigator) {
    try {
      const registration =
        (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
      await registration.showNotification(title, options);
      return;
    } catch {
      // Fall through to the page Notification API for desktop browsers.
    }
  }
  try {
    const notification = new Notification(title, options);
    window.setTimeout(() => notification.close(), 8000);
  } catch {
    // Some mobile browsers only expose notifications through Service Worker.
  }
}

function buildMobileNotificationMessage(pulse: NotificationPulse, atlasRoot: AtlasNode) {
  const node = findNode(atlasRoot, pulse.nodeId);
  const isReplyNode = node?.nodeType === "ai_reply" || node?.nodeType === "tool_result";
  const title = "Mind Atlas";
  const nodeTitle = node?.title?.trim() || pulse.title;
  const bodySource = isReplyNode
    ? `${nodeTitle}: ${node.summary || node.body || notificationKindLabel(pulse.kind)}`
    : `${nodeTitle}: ${notificationKindLabel(pulse.kind)}`;
  return {
    title: truncateNotificationText(title, 80),
    body: truncateNotificationText(bodySource, 180),
  };
}

function truncateNotificationText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function notificationKindLabel(kind: NotificationPulse["kind"]) {
  switch (kind) {
    case "error":
      return "Error notification";
    case "codex":
      return "Codex notification";
    case "openclaw":
      return "OpenClaw notification";
    case "claude":
      return "Claude Code notification";
    case "cost":
      return "Cost notification";
    case "done":
      return "Completed notification";
    case "needs_review":
      return "Review notification";
  }
}

function loadMobileNotificationPreference() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MOBILE_NOTIFICATION_STORAGE_KEY) === "true";
}

function persistMobileNotificationPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_NOTIFICATION_STORAGE_KEY, String(enabled));
}

function loadRenderQualityPreference(): RenderQuality {
  if (typeof window === "undefined") return "high";
  const stored = window.localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
  if (isRenderQuality(stored)) return stored;
  return "high";
}

function shouldShowCommandDock(rootId: string, selectedNodeId: string, viewport: ViewportState) {
  if (selectedNodeId !== rootId) return true;
  return Number.isFinite(viewport.zoom) && viewport.zoom <= ROOT_COMMAND_MAX_ZOOM;
}

function persistRenderQualityPreference(quality: RenderQuality) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RENDER_QUALITY_STORAGE_KEY, quality);
}

function isRenderQuality(value: string | null): value is RenderQuality {
  return value === "high" || value === "low";
}

function isPageRuntimeActive() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function getMobileNotificationPermission(): MobileNotificationPermission {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function isMobileNotificationTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const mobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  return mobileUa || (coarsePointer && narrowViewport);
}

function mobileNotificationStatusLabel(
  enabled: boolean,
  permission: MobileNotificationPermission,
  message: string,
) {
  if (message) return message;
  if (!isMobileNotificationTarget()) return "mobile only";
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "blocked";
  if (enabled && permission === "granted") return "on";
  if (permission === "granted") return "off";
  return "tap to enable";
}

function isDeviceOrientationSupported() {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

function canRestoreVrModeWithoutGesture() {
  if (!isDeviceOrientationSupported()) return false;
  const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  return typeof orientationEvent.requestPermission !== "function";
}

async function requestDeviceOrientationAccess(): Promise<DeviceOrientationPermissionState> {
  if (!isDeviceOrientationSupported()) return "denied";
  const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  if (typeof orientationEvent.requestPermission !== "function") return "granted";
  try {
    return await orientationEvent.requestPermission();
  } catch {
    return "denied";
  }
}

function vrModeStatusLabel(enabled: boolean, message: string) {
  if (message) return message;
  if (!isDeviceOrientationSupported()) return "unsupported";
  return enabled ? "on / tilt to pan" : "off";
}

function useMobileBackButtonGuard({ closeOverlays }: { closeOverlays: () => void }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMobileBackButtonGuardTarget()) return;

    const state = window.history.state;
    if (!state?.mindAtlasBackGuard) {
      window.history.pushState({ ...(state && typeof state === "object" ? state : {}), mindAtlasBackGuard: true }, "", window.location.href);
    }

    const handlePopState = () => {
      closeOverlays();
      window.history.pushState({ mindAtlasBackGuard: true }, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [closeOverlays]);
}

function isMobileBackButtonGuardTarget() {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarsePointer && window.innerWidth <= 980;
}

function useVisualViewportHeight(commandInputEditing: boolean) {
  const stableHeightRef = useRef<number | null>(null);
  const lastViewportWidthRef = useRef<number | null>(null);
  const keyboardOverlayPreparedUntilRef = useRef(0);

  useEffect(() => {
    const rememberStableHeight = () => {
      const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const height = Math.round(Math.max(window.visualViewport?.height ?? 0, window.innerHeight, document.documentElement.clientHeight));
      const lastWidth = lastViewportWidthRef.current;

      if (lastWidth !== null && Math.abs(width - lastWidth) > 80) {
        stableHeightRef.current = null;
      }

      lastViewportWidthRef.current = width;
      stableHeightRef.current = Math.max(stableHeightRef.current ?? 0, height);
    };

    const prepareKeyboardOverlay = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const spaceLabelTarget = target.closest(SPACE_LABEL_KEYBOARD_SELECTOR);
      if (!target.closest(KEYBOARD_OVERLAY_INPUT_SELECTOR)) return;
      if (spaceLabelTarget instanceof HTMLElement && spaceLabelTarget.dataset.selected !== "true") return;
      if (!isMobileKeyboardOverlayTarget(stableHeightRef.current)) return;
      keyboardOverlayPreparedUntilRef.current = Date.now() + 4000;
      rememberStableHeight();
      lockKeyboardPanelSizeForKeyboardOverlay();
      setVirtualKeyboardOverlay(false);
      document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
      document.documentElement.setAttribute("data-keyboard-overlay-portrait", "true");
      if (spaceLabelTarget) {
        document.documentElement.setAttribute("data-keyboard-overlay-space-label", "true");
      } else {
        document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
      }
      window.setTimeout(updateViewportHeight, 80);
      window.setTimeout(updateViewportHeight, 240);
      window.setTimeout(updateViewportHeight, 520);
      window.setTimeout(updateViewportHeight, 900);
    };

    const updateViewportHeight = () => {
      const visualViewport = window.visualViewport;
      const height = Math.round(visualViewport?.height ?? window.innerHeight);
      const keyboardOverlayPrepared = Date.now() < keyboardOverlayPreparedUntilRef.current;
      const keyboardOverlayPortrait = isMobileKeyboardOverlayTarget(stableHeightRef.current);
      const stableHeight = stableHeightRef.current ?? Math.max(height, window.innerHeight, document.documentElement.clientHeight);
      const visualKeyboardTop = Math.round((visualViewport?.offsetTop ?? 0) + height);
      const virtualKeyboardTop = getVirtualKeyboardTop(stableHeight);
      const measuredKeyboardTop = virtualKeyboardTop === null ? visualKeyboardTop : Math.min(visualKeyboardTop, virtualKeyboardTop);
      const keyboardLikelyOpen = Math.max(0, stableHeight - measuredKeyboardTop) >= 180;
      const keyboardOverlayMode =
        (commandInputEditing || isKeyboardOverlayTextTargetActive() || keyboardOverlayPrepared || (hasKeyboardPanelSizeLock() && keyboardLikelyOpen)) &&
        keyboardOverlayPortrait;
      const measuredKeyboardBottomOffset = keyboardOverlayMode ? Math.max(0, stableHeight - measuredKeyboardTop) : 0;
      const fallbackKeyboardBottomOffset =
        keyboardOverlayMode && measuredKeyboardBottomOffset < 180 ? getFallbackKeyboardBottomOffset(stableHeight) : 0;
      const keyboardBottomOffset = keyboardOverlayMode ? Math.max(measuredKeyboardBottomOffset, fallbackKeyboardBottomOffset) : 0;
      const keyboardTop = Math.max(0, stableHeight - keyboardBottomOffset);

      if (!keyboardOverlayMode) {
        rememberStableHeight();
        clearKeyboardPanelSizeLock();
        document.documentElement.removeAttribute("data-keyboard-overlay-input");
        document.documentElement.removeAttribute("data-keyboard-overlay-portrait");
        document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
      } else {
        setVirtualKeyboardOverlay(false);
        document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
        document.documentElement.setAttribute("data-keyboard-overlay-portrait", "true");
        if (isSpaceLabelKeyboardTargetActive()) {
          document.documentElement.setAttribute("data-keyboard-overlay-space-label", "true");
        } else {
          document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
        }
      }

      const appHeight = keyboardOverlayMode ? stableHeight : height;
      document.documentElement.style.setProperty("--app-height", `${appHeight}px`);
      document.documentElement.style.setProperty("--keyboard-top", `${keyboardTop}px`);
      document.documentElement.style.setProperty("--keyboard-bottom-offset", `${keyboardBottomOffset}px`);
    };

    const updateViewportHeightAfterOrientation = () => {
      if (document.documentElement.getAttribute("data-keyboard-overlay-input") === "true" && hasKeyboardPanelSizeLock()) {
        window.setTimeout(updateViewportHeight, 80);
        window.setTimeout(updateViewportHeight, 360);
        return;
      }
      stableHeightRef.current = null;
      lastViewportWidthRef.current = null;
      window.setTimeout(updateViewportHeight, 80);
      window.setTimeout(updateViewportHeight, 360);
    };

    const handlePointerDown = (event: PointerEvent) => prepareKeyboardOverlay(event.target);
    const handleTouchStart = (event: TouchEvent) => prepareKeyboardOverlay(event.target);
    const handleFocusIn = (event: FocusEvent) => prepareKeyboardOverlay(event.target);
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;

    updateViewportHeight();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("touchstart", handleTouchStart, true);
    document.addEventListener("focusin", handleFocusIn, true);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    virtualKeyboard?.addEventListener("geometrychange", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeightAfterOrientation);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      virtualKeyboard?.removeEventListener("geometrychange", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeightAfterOrientation);
      document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
    };
  }, [commandInputEditing]);

  useEffect(() => {
    if (commandInputEditing && isMobileKeyboardOverlayTarget(stableHeightRef.current)) {
      setVirtualKeyboardOverlay(false);
      document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
      document.documentElement.setAttribute("data-keyboard-overlay-portrait", "true");
      return;
    }

    window.setTimeout(() => {
      if (!useAtlasStore.getState().commandInputEditing && !isKeyboardOverlayTextTargetActive() && !isKeyboardViewportLikelyOpen(stableHeightRef.current)) {
        setVirtualKeyboardOverlay(false);
        clearKeyboardPanelSizeLock();
        document.documentElement.removeAttribute("data-keyboard-overlay-input");
        document.documentElement.removeAttribute("data-keyboard-overlay-portrait");
        document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
      }
    }, 300);
  }, [commandInputEditing]);
}

function isMobileKeyboardOverlayTarget(stableHeight: number | null) {
  if (typeof window === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const narrowViewport = width <= 980 || window.innerWidth <= 980;
  const keyboardPortraitLocked = document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true" && hasKeyboardPanelSizeLock();
  const portraitBeforeKeyboard = keyboardPortraitLocked || (stableHeight ? stableHeight > width : (window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight >= width));
  return coarsePointer && narrowViewport && portraitBeforeKeyboard;
}

function getVirtualKeyboardTop(stableHeight: number) {
  const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
  const rect = virtualKeyboard?.boundingRect;
  if (!rect || rect.height <= 0) return null;
  const fallbackTop = stableHeight - rect.height;
  const rawTop = rect.top > 0 ? rect.top : rect.y > 0 ? rect.y : fallbackTop;
  const top = Math.round(Math.min(stableHeight, Math.max(0, rawTop)));
  return top <= 0 || top >= stableHeight ? null : top;
}

function getFallbackKeyboardBottomOffset(stableHeight: number) {
  return Math.round(Math.min(380, Math.max(260, stableHeight * 0.42)));
}

function isKeyboardOverlayTextTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(KEYBOARD_OVERLAY_INPUT_SELECTOR));
}

function isCommandKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".command-dock input, .command-dock textarea, .command-dock select"));
}

function isSpaceLabelKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(SPACE_LABEL_KEYBOARD_SELECTOR));
}

function isKeyboardViewportLikelyOpen(stableHeight: number | null) {
  if (!stableHeight) return false;
  const visualViewport = window.visualViewport;
  const height = Math.round(visualViewport?.height ?? window.innerHeight);
  const visualKeyboardTop = Math.round((visualViewport?.offsetTop ?? 0) + height);
  const virtualKeyboardTop = getVirtualKeyboardTop(stableHeight);
  const keyboardTop = virtualKeyboardTop === null ? visualKeyboardTop : Math.min(visualKeyboardTop, virtualKeyboardTop);
  return Math.max(0, stableHeight - keyboardTop) >= 180;
}

function lockKeyboardPanelSizeForKeyboardOverlay() {
  const panel = document.querySelector<HTMLElement>(".mobile-workspace-panel:not(.is-closing)");
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 160 || rect.height < 48) return;
  document.documentElement.style.setProperty("--keyboard-panel-width", `${Math.round(rect.width)}px`);
  document.documentElement.style.setProperty("--keyboard-panel-height", `${Math.round(rect.height)}px`);
}

function clearKeyboardPanelSizeLock() {
  document.documentElement.style.removeProperty("--keyboard-panel-width");
  document.documentElement.style.removeProperty("--keyboard-panel-height");
}

function hasKeyboardPanelSizeLock() {
  return document.documentElement.style.getPropertyValue("--keyboard-panel-width") !== "";
}

function setVirtualKeyboardOverlay(enabled: boolean) {
  const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
  if (!virtualKeyboard) return;
  try {
    virtualKeyboard.overlaysContent = enabled;
  } catch {
    // Some Chromium builds expose the API but reject writes outside supported contexts.
  }
}

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: EventTarget & {
    overlaysContent: boolean;
    boundingRect?: DOMRectReadOnly;
  };
};

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function useMobilePortraitBreadcrumbLayout() {
  const [matches, setMatches] = useState(() => isMobilePortraitBreadcrumbTarget());

  useEffect(() => {
    const update = () => setMatches(isMobilePortraitBreadcrumbTarget());
    const query = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)");
    update();
    query?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      query?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return matches;
}

function useMobileOperationSurface() {
  const [matches, setMatches] = useState(() => isMobileOperationSurfaceTarget());

  useEffect(() => {
    const update = () => setMatches(isMobileOperationSurfaceTarget());
    const queries = [
      window.matchMedia?.("(pointer: coarse)"),
      window.matchMedia?.("(hover: none)"),
      window.matchMedia?.("(max-width: 980px)"),
      window.matchMedia?.("(max-height: 620px)"),
      window.matchMedia?.("(orientation: portrait)"),
    ].filter((query): query is MediaQueryList => Boolean(query));
    update();
    queries.forEach((query) => query.addEventListener?.("change", update));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      queries.forEach((query) => query.removeEventListener?.("change", update));
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return matches;
}

function isMobilePortraitBreadcrumbTarget() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowPortrait = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)").matches ?? false;
  return coarsePointer && narrowPortrait;
}

function isMobileOperationSurfaceTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hoverNone = window.matchMedia?.("(hover: none)").matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  const shortViewport = window.matchMedia?.("(max-height: 620px)").matches ?? false;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const touchDevice = navigator.maxTouchPoints > 0;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  const compactViewport = narrowViewport || shortViewport;
  const phoneOrSmallTabletViewport = compactViewport || (shortSide <= 820 && longSide <= 1366);
  if (mobileUa || coarsePointer) return phoneOrSmallTabletViewport;
  return hoverNone && (touchDevice || compactViewport) && phoneOrSmallTabletViewport;
}

function isMobileWorkspacePanelRevealTarget() {
  if (typeof window === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mobileViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  return coarsePointer && mobileViewport;
}

function DatasetTitleInput({
  title,
  placeholderTitle,
  onChange,
}: {
  title: string;
  placeholderTitle: string;
  onChange: (title: string) => void;
}) {
  const titleIsPlaceholder = isUniverseTitlePlaceholder(title, placeholderTitle);
  const storedTitle = title && !titleIsPlaceholder ? title : "";
  const [draftTitle, setDraftTitle] = useState(storedTitle);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) return;
    setDraftTitle(storedTitle);
  }, [editing, storedTitle]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType === "mouse" || editing) return;
    event.preventDefault();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <input
      ref={inputRef}
      className="dataset-title-input"
      value={draftTitle}
      placeholder={placeholderTitle}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        if (!editing) event.preventDefault();
      }}
      onFocus={() => {
        setEditing(true);
        if (titleIsPlaceholder && title !== "") {
          setDraftTitle("");
          onChange("");
        }
      }}
      onBlur={() => setEditing(false)}
      onChange={(event) => {
        const nextTitle = event.target.value;
        setDraftTitle(nextTitle);
        onChange(nextTitle);
      }}
      aria-label="Dataset name"
    />
  );
}

function usePreventBrowserViewportGestures() {
  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();
    const preventViewportTouchMove = (event: TouchEvent) => {
      if (shouldAllowNativeTouchScroll(event.target)) return;
      event.preventDefault();
    };
    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventDefault, { passive: false, capture: true });
    document.addEventListener("gesturechange", preventDefault, { passive: false, capture: true });
    document.addEventListener("gestureend", preventDefault, { passive: false, capture: true });
    document.addEventListener("touchmove", preventViewportTouchMove, { passive: false, capture: true });
    window.addEventListener("wheel", preventCtrlWheelZoom, { passive: false, capture: true });
    return () => {
      document.removeEventListener("gesturestart", preventDefault, { capture: true });
      document.removeEventListener("gesturechange", preventDefault, { capture: true });
      document.removeEventListener("gestureend", preventDefault, { capture: true });
      document.removeEventListener("touchmove", preventViewportTouchMove, { capture: true });
      window.removeEventListener("wheel", preventCtrlWheelZoom, { capture: true });
    };
  }, []);
}

function shouldAllowNativeTouchScroll(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("textarea, .context-menu, .surface-context-menu, .status-context-menu, .reminder-context-menu, .focus-panel, .event-strip, .voice-log-dialog, .notebook-history-dialog, .text-import-dialog, .merge-preview-dialog, .cloud-load-dialog, .voice-settings-dialog, .outline-editor-panel, .mobile-workspace-panel"));
}

function isUniverseTitlePlaceholder(title: string, placeholderTitle: string) {
  return title === DEFAULT_DATASET_TITLE || title === placeholderTitle || UNIVERSE_TITLE_PLACEHOLDER_ALIASES.includes(title);
}

function AtlasBreadcrumb({ path, mobilePortrait, onFocus }: { path: AtlasNode[]; mobilePortrait: boolean; onFocus: (id: string) => void }) {
  const crumbs = compactBreadcrumb(path, mobilePortrait);
  const handleLogoClick = () => {
    emitOnboardingEvent("home-logo-clicked");
    onFocus(path[0].id);
  };

  return (
    <nav className={`atlas-breadcrumb ${mobilePortrait ? "is-mobile-portrait" : ""}`} aria-label="Atlas path">
      <button className="atlas-logo-crumb" type="button" onClick={handleLogoClick}>
        MindAtlas
      </button>
      {crumbs.map((crumb, index) =>
        crumb === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="breadcrumb-ellipsis">
            ...
          </span>
        ) : (
          <button key={crumb.id} type="button" onClick={() => onFocus(crumb.id)}>
            {shortCrumb(crumb.title)}
          </button>
        ),
      )}
    </nav>
  );
}

function UnreadNotificationLinks({
  items,
  voiceLogEntry,
  voiceLogUnreadCount,
  onFocus,
  onOpenVoiceLog,
}: {
  items: Array<{
    notification: {
      nodeId: string;
      kind: NotificationPulse["kind"];
      title: string;
    };
    node: AtlasNode;
  }>;
  voiceLogEntry?: VoiceLogEntry;
  voiceLogUnreadCount: number;
  onFocus: (id: string) => void;
  onOpenVoiceLog: () => void;
}) {
  if (!items.length && !voiceLogEntry) return null;

  return (
    <nav className="unread-notification-links" aria-label="Unread notifications">
      {voiceLogEntry ? (
        <button
          className={`unread-notification-link is-voice-log ${voiceLogEntry.role === "error" ? "is-error" : ""}`}
          type="button"
          onClick={onOpenVoiceLog}
          title={voiceLogEntry.title || "AI Partner reply"}
        >
          <MessageSquareText size={12} />
          <span>{voiceLogUnreadCount > 1 ? `${voiceLogUnreadCount} AI Partner replies` : shortNotificationTitle(voiceLogEntry.title || "AI Partner reply")}</span>
        </button>
      ) : null}
      {items.map(({ notification, node }) => (
        <button
          key={notification.nodeId}
          className={`unread-notification-link is-${notification.kind}`}
          type="button"
          onClick={() => onFocus(notification.nodeId)}
          title={`${notification.title}: ${node.title || "Untitled"}`}
        >
          <Bell size={12} />
          <span>{shortNotificationTitle(node.title || notification.title)}</span>
        </button>
      ))}
    </nav>
  );
}

function isUnreadTextPartnerEntry(entry: VoiceLogEntry, lastSeenAt: string) {
  if (entry.role !== "assistant" && entry.role !== "error") return false;
  if (!entry.sessionId?.startsWith("text-partner-")) return false;
  if (typeof entry.metadata?.responseNodeId === "string" && entry.metadata.responseNodeId) return false;
  const entryTime = new Date(entry.createdAt).getTime();
  const seenTime = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(entryTime)) return false;
  return !Number.isFinite(seenTime) || entryTime > seenTime;
}

function voiceLogUnreadLabel(unreadCount: number, totalCount: number) {
  if (unreadCount > 0) return `${unreadCount} unread / ${totalCount} entries`;
  return `${totalCount} entries`;
}

function compactBreadcrumb(path: AtlasNode[], mobilePortrait = false) {
  const nodes = path.slice(1);
  if (mobilePortrait) {
    if (nodes.length <= 10) return nodes;
    return [...nodes.slice(0, 5), "ellipsis" as const, ...nodes.slice(-5)];
  }

  if (nodes.length <= 5) return nodes;

  const first = nodes.slice(0, 2);
  const last = nodes.slice(-3);
  return [...first, "ellipsis" as const, ...last];
}

function shortCrumb(title: string) {
  const clean = title.trim() || "Untitled";
  return clean.length > 10 ? `${clean.slice(0, 10)}...` : clean;
}

function shortNotificationTitle(title: string) {
  const clean = title.trim() || "Untitled";
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
}

function datasetFileName(name: string) {
  const baseName = name && name !== "Mind Atlas" ? name : "Spatial Notebook";
  return (
    baseName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Untitled Atlas"
  );
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.(mindatlaspkg|mindatlas|markdown|md|opml|mm)$/i, "").trim() || "Untitled Atlas";
}

function atlasNodeToOutlineInput(node: AtlasNode, forcedId?: string): OutlineNodeInput {
  return {
    id: forcedId ?? node.id,
    clientKey: forcedId ?? node.id,
    title: node.title,
    body: node.body,
    children: node.children.map((child) => atlasNodeToOutlineInput(child)),
  };
}

function markdownBodyForActiveNodeReplacement(root: AtlasNode) {
  if (root.body.trim()) return root.body.trim();
  if (root.children.length === 1 && root.children[0].body.trim()) return root.children[0].body.trim();
  if (root.children.length) return root.children.map(formatNodeAsMarkdown).join("\n\n").trim();
  return "";
}

function formatNodeAsMarkdown(node: AtlasNode, depth = 2): string {
  const heading = `${"#".repeat(Math.min(6, depth))} ${node.title}`;
  const parts = [heading, node.body.trim(), ...node.children.map((child) => formatNodeAsMarkdown(child, depth + 1))].filter(Boolean);
  return parts.join("\n\n");
}

function firstMarkdownLine(value: string) {
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function createMergePreviewState(current: AtlasNode, incoming: AtlasNode): MergePreviewState {
  return { root: createMergePreviewBlock(current, incoming, current.title || incoming.title || "Active node", "merge-root") };
}

function createMergePreviewBlock(current: AtlasNode | undefined, incoming: AtlasNode | undefined, path: string, key: string): MergePreviewBlock {
  const currentChildren = current?.children ?? [];
  const incomingChildren = incoming?.children ?? [];
  const maxChildren = Math.max(currentChildren.length, incomingChildren.length);
  const children = Array.from({ length: maxChildren }, (_, index) => {
    const currentChild = currentChildren[index];
    const incomingChild = incomingChildren[index];
    const title = incomingChild?.title || currentChild?.title || `Child ${index + 1}`;
    return createMergePreviewBlock(currentChild, incomingChild, `${path} / ${title}`, `${key}-${index}`);
  });
  return {
    key,
    path,
    currentTitle: current?.title ?? "",
    incomingTitle: incoming?.title ?? current?.title ?? "",
    currentBody: current?.body ?? "",
    incomingBody: incoming?.body ?? current?.body ?? "",
    choice: "incoming",
    children,
  };
}

function updateMergeChoice(block: MergePreviewBlock, key: string, choice: MergeChoice): MergePreviewBlock {
  if (block.key === key) return { ...block, choice };
  return { ...block, children: block.children.map((child) => updateMergeChoice(child, key, choice)) };
}

function mergePreviewToOutline(current: AtlasNode, preview: MergePreviewState): OutlineNodeInput {
  return mergeBlockToOutline(current, preview.root, current.id);
}

function mergeBlockToOutline(current: AtlasNode | undefined, block: MergePreviewBlock, forcedId?: string): OutlineNodeInput {
  const useIncoming = block.choice === "incoming";
  return {
    id: forcedId ?? current?.id,
    clientKey: forcedId ?? current?.id ?? block.key,
    title: useIncoming ? block.incomingTitle || block.currentTitle || "Untitled" : block.currentTitle || block.incomingTitle || "Untitled",
    body: useIncoming ? block.incomingBody : block.currentBody,
    children: block.children.map((child, index) => mergeBlockToOutline(current?.children[index], child)),
  };
}

function hasDraggedFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function externalFormatLabel(format: ReturnType<typeof detectImportFormat>) {
  if (format === "opml") return "OPML";
  if (format === "freemind") return "FreeMind";
  return "Markdown";
}

function importErrorMessage(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail ? `${prefix}\n\n${detail}` : prefix;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportErrorMessage(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `${prefix}\n\n${detail}`;
}

function confirmJsonOnlyPackageFallback(atlasRoot: AtlasNode, prefix: string, error: unknown) {
  const message = [
    exportErrorMessage(prefix, error),
    "",
    "A JSON-only Mind Atlas package can still preserve the notebook text and structure.",
    "Attachment files will not be embedded in that fallback package.",
    "",
    "Create the JSON-only package instead?",
  ].join("\n");
  if (!window.confirm(message)) return null;
  return createNotebookJsonPackage(atlasRoot);
}

function showPackageResultNotice(result: NotebookPackageResult) {
  const messages: string[] = [];
  if (result.packageKind === "json") {
    messages.push("Created a JSON-only Mind Atlas package. Notebook text is preserved, but attachment files are not embedded.");
  }
  if (result.missingCount > 0) {
    messages.push(`${result.missingCount} attachment(s) could not be included because this browser session only has metadata for them.`);
  }
  if (messages.length) window.alert(messages.join("\n\n"));
}

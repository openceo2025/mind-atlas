import { FocusPanel } from "./components/FocusPanel";
import { Bell, BellOff, CloudDownload, CloudUpload, Download, Maximize2, MessageSquareText, Moon, MoreHorizontal, PenLine, Radio, Redo2, RefreshCw, RotateCcw, Settings2, Smartphone, Sun, Trash2, Undo2, Upload, Volume2, X } from "lucide-react";
import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadCloudNotebookPackage, listCloudNotebookPackages, saveCloudNotebookPackage } from "./ai/bridgeClient";
import { replaceStoredAttachmentBlobs } from "./attachmentStorage";
import { CommandDock } from "./components/CommandDock";
import { Minimap } from "./components/Minimap";
import { OutlineEditor } from "./components/OutlineEditor";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT, UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { createNotebookJsonPackage, createNotebookPackage, importNotebookPackage, type NotebookPackageResult } from "./notebookPackage";
import { emitOnboardingEvent, useOnboarding } from "./onboarding/useOnboarding";
import { findNode, findNodePath, useAtlasStore } from "./store/atlasStore";
import { loadStoredTheme, persistTheme, type AtlasTheme } from "./theme";
import { loadPersistedUiState, persistUiStatePatch, type PersistedUiState } from "./uiPersistence";
import type { AtlasNode, CloudNotebookEntry, NotificationPulse, VoiceLogEntry, VoicePartnerSettings } from "./types";

const VOICE_OPTION_IDS = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const WORKSPACE_PANEL_EXIT_MS = 960;
const RENDER_QUALITY_STORAGE_KEY = "mind-atlas-render-quality";
const DEFAULT_DATASET_TITLE = "Mind Atlas";
const UNIVERSE_TITLE_PLACEHOLDER_ALIASES = [
  "Name this universe.",
  "この宇宙に名前をつけてみましょう",
  "この宇宙に名前を付けてみましょう",
];

export default function App() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectNodeInPlace = useAtlasStore((state) => state.selectNodeInPlace);
  const showNotificationSnoozePrompt = useAtlasStore((state) => state.showNotificationSnoozePrompt);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
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
  const setVoicePartnerSettings = useAtlasStore((state) => state.setVoicePartnerSettings);
  const clearVoiceLog = useAtlasStore((state) => state.clearVoiceLog);
  const markVoiceLogSeen = useAtlasStore((state) => state.markVoiceLogSeen);
  const notificationPulses = useAtlasStore((state) => state.notificationPulses);
  const unreadNotifications = useAtlasStore((state) => state.unreadNotifications);
  const restoreAttachmentPreviews = useAtlasStore((state) => state.restoreAttachmentPreviews);
  const recoverCompletedCodexRuns = useAtlasStore((state) => state.recoverCompletedCodexRuns);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const [persistedUiState] = useState<PersistedUiState | null>(() => loadPersistedUiState());
  const [pageActive, setPageActive] = useState(() => isPageRuntimeActive());
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [outlineEditorOpen, setOutlineEditorOpen] = useState(false);
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
  const [mobilePanelTab, setMobilePanelTab] = useState<"command" | "editor">(persistedUiState?.mobilePanelTab ?? "command");
  const [mobileWorkspacePanelRevealed, setMobileWorkspacePanelRevealed] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const mobilePortraitBreadcrumb = useMobilePortraitBreadcrumbLayout();
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
  const selectedNode = selectedPath[selectedPath.length - 1] ?? atlasRoot;
  const onboarding = useOnboarding();
  const effectiveMobilePanelTab = onboarding.showAiFeatures ? mobilePanelTab : "editor";
  const showWorkspacePanel = onboarding.showAiFeatures || selectedNodeId !== atlasRoot.id || (onboarding.showMainChrome && mobileWorkspacePanelRevealed);
  const focusPanelOpen = selectedNodeId !== atlasRoot.id;
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
    setCloudLoadOpen(false);
    setOutlineEditorOpen(false);
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
      vrModeEnabled,
      mobilePanelTab,
    };
  }, [mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

  useEffect(() => {
    if (!uiPersistenceReadyRef.current) {
      uiPersistenceReadyRef.current = true;
      return;
    }
    persistUiStatePatch(latestUiStateRef.current);
  }, [mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

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
    const revealMobileWorkspacePanel = () => {
      if (!isMobileWorkspacePanelRevealTarget()) return;
      setMobileWorkspacePanelRevealed(true);
      if (onboarding.showAiFeatures) setMobilePanelTab("command");
      setRenderWorkspacePanel(true);
    };
    window.addEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
  }, [onboarding.showAiFeatures]);

  useEffect(() => {
    if (selectedNodeId !== atlasRoot.id) {
      setMobileWorkspacePanelRevealed(false);
    }
  }, [atlasRoot.id, selectedNodeId]);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistRenderQualityPreference(renderQuality);
  }, [renderQuality]);

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
    setMobilePanelTab("editor");
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

  const handleExportLight = () => {
    try {
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

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".mindatlaspkg")) {
      try {
        const { root, attachmentPreviewUrls, attachmentBlobs } = await importNotebookPackage(file);
        await replaceStoredAttachmentBlobs(root, attachmentBlobs);
        importNotebook(root, datasetNameFromFile(file.name), attachmentPreviewUrls);
        setMenuOpen(false);
      } catch (error) {
        console.error("Notebook package import failed", error);
      }
      event.target.value = "";
      return;
    }

    try {
      const root = JSON.parse(await file.text()) as AtlasNode;
      await replaceStoredAttachmentBlobs(root, {});
      importNotebook(root, datasetNameFromFile(file.name));
      setMenuOpen(false);
    } catch (error) {
      console.error("Notebook import failed", error);
    }
    event.target.value = "";
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
      if (event.defaultPrevented || event.altKey || event.metaKey || event.shiftKey || !event.ctrlKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = event.key.toLowerCase();
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
  }, [canRedo, canUndo, redo, undo]);

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

  if (outlineEditorOpen) {
    return (
      <OutlineEditor
        root={selectedNode}
        onCancel={() => setOutlineEditorOpen(false)}
        onSave={(rootId, outline) => {
          applyOutlineSubtree(rootId, outline);
          setOutlineEditorOpen(false);
        }}
      />
    );
  }

  return (
    <main className={appClassName} data-theme={theme} data-focus-panel={focusPanelOpen ? "open" : "closed"}>
      <UniverseCanvas
        theme={theme}
        vrPanEnabled={vrModeEnabled}
        renderQuality={renderQuality}
        pageActive={pageActive}
        initialCameraPose={persistedUiState?.cameraPose ?? null}
      />
      {onboarding.showRootPulse ? <div className="onboarding-center-pulse" aria-hidden="true" /> : null}
      {onboarding.message ? (
        <div className="onboarding-message" role="status" aria-live="polite">
          {onboarding.message}
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
      <div className="global-menu" aria-label="Atlas actions">
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
            <button type="button" onClick={() => { setOutlineEditorOpen(true); setMenuOpen(false); }}>
              <PenLine size={15} />
              <span>
                Outline editor
                <small>{selectedNode.title || "active subtree"}</small>
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
              <input type="file" accept=".mindatlas,.mindatlaspkg,application/mindatlas+json,application/x-mindatlas-package" onChange={handleImport} />
            </label>
            <button type="button" onClick={handleInitialize}>
              <RotateCcw size={15} /> Initialize
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {onboarding.showMainChrome ? <Minimap /> : null}
      {renderWorkspacePanel ? (
        <section
          className={`mobile-workspace-panel ${showWorkspacePanel ? "is-open" : "is-closing"}`}
          data-active-tab={effectiveMobilePanelTab}
          aria-label="Mobile workspace"
        >
          <div className="mobile-workspace-tabs" role="tablist" aria-label="Workspace panel">
            {onboarding.showAiFeatures ? (
              <button
                className={effectiveMobilePanelTab === "command" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "command"}
                onClick={() => setMobilePanelTab("command")}
              >
                <MessageSquareText size={15} />
                <span>Command</span>
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
          </div>
          {onboarding.showAiFeatures ? (
            <div className="mobile-panel-slot mobile-command-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "command"}>
              <CommandDock />
            </div>
          ) : null}
          <div className="mobile-panel-slot mobile-editor-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "editor"}>
            <FocusPanel theme={theme} />
          </div>
        </section>
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
              placeholder="gpt-realtime"
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
            <p>{entries.length} entries</p>
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
  const items = [
    ["model", metadata.model],
    ["duration", typeof metadata.durationMs === "number" ? `${metadata.durationMs}ms` : undefined],
    ["audio", typeof metadata.audioSizeBytes === "number" ? formatBytes(metadata.audioSizeBytes) : undefined],
    ["mime", metadata.audioMimeType ?? metadata.mimeType],
    ["chunks", metadata.chunks],
  ]
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  return items.join(" / ");
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
  return isMobileRenderQualityTarget() ? "low" : "high";
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

function isMobileRenderQualityTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  return (mobileUa || coarsePointer) && shortSide <= 620 && longSide <= 980;
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
      const spaceLabelTarget = target.closest(".space-body-editor");
      if (!target.closest(".command-dock input, .command-dock textarea, .command-dock select, .space-body-editor")) return;
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
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".command-dock input, .command-dock textarea, .command-dock select, .space-body-editor"));
}

function isCommandKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".command-dock input, .command-dock textarea, .command-dock select"));
}

function isSpaceLabelKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".space-body-editor"));
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

function isMobilePortraitBreadcrumbTarget() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowPortrait = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)").matches ?? false;
  return coarsePointer && narrowPortrait;
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
  const touchEditTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (editing) return;
    setDraftTitle(storedTitle);
  }, [editing, storedTitle]);

  useEffect(
    () => () => {
      if (touchEditTimerRef.current !== null) {
        window.clearTimeout(touchEditTimerRef.current);
      }
    },
    [],
  );

  const clearTouchEditTimer = () => {
    if (touchEditTimerRef.current === null) return;
    window.clearTimeout(touchEditTimerRef.current);
    touchEditTimerRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType === "mouse" || editing) return;
    event.preventDefault();
    clearTouchEditTimer();
    touchEditTimerRef.current = window.setTimeout(() => {
      touchEditTimerRef.current = null;
      inputRef.current?.focus({ preventScroll: true });
    }, 520);
  };

  return (
    <input
      ref={inputRef}
      className="dataset-title-input"
      value={draftTitle}
      placeholder={placeholderTitle}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTouchEditTimer}
      onPointerCancel={clearTouchEditTimer}
      onPointerLeave={clearTouchEditTimer}
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
  return fileName.replace(/\.(mindatlaspkg|mindatlas)$/i, "").trim() || "Untitled Atlas";
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

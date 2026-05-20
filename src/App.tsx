import { FocusPanel } from "./components/FocusPanel";
import { Bell, BellOff, CloudDownload, CloudUpload, Download, Maximize2, MessageSquareText, Moon, MoreHorizontal, PenLine, Radio, Redo2, RefreshCw, RotateCcw, Settings2, Sun, Trash2, Undo2, Upload, Volume2, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { downloadCloudNotebookPackage, listCloudNotebookPackages, saveCloudNotebookPackage } from "./ai/bridgeClient";
import { replaceStoredAttachmentBlobs } from "./attachmentStorage";
import { CommandDock } from "./components/CommandDock";
import { Minimap } from "./components/Minimap";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { createNotebookJsonPackage, createNotebookPackage, importNotebookPackage, type NotebookPackageResult } from "./notebookPackage";
import { findNode, findNodePath, useAtlasStore } from "./store/atlasStore";
import { loadStoredTheme, persistTheme, type AtlasTheme } from "./theme";
import type { AtlasNode, CloudNotebookEntry, NotificationPulse, VoiceLogEntry, VoicePartnerSettings } from "./types";

const VOICE_OPTION_IDS = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

export default function App() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const showNotificationSnoozePrompt = useAtlasStore((state) => state.showNotificationSnoozePrompt);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
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
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [cloudLoadOpen, setCloudLoadOpen] = useState(false);
  const [mobileNotificationsEnabled, setMobileNotificationsEnabled] = useState(() => loadMobileNotificationPreference());
  const [mobileNotificationPermission, setMobileNotificationPermission] = useState<MobileNotificationPermission>(() => getMobileNotificationPermission());
  const [mobileNotificationMessage, setMobileNotificationMessage] = useState("");
  const [cloudNotebooks, setCloudNotebooks] = useState<CloudNotebookEntry[]>([]);
  const [cloudDirectory, setCloudDirectory] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [theme, setTheme] = useState<AtlasTheme>(() => loadStoredTheme());
  const [mobilePanelTab, setMobilePanelTab] = useState<"command" | "editor">("command");
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
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

  useVisualViewportHeight(commandInputEditing);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!voiceLogOpen) return;
    markVoiceLogSeen();
  }, [voiceLogOpen, voiceLogEntries.length, markVoiceLogSeen]);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.documentElement.requestFullscreen));
  }, []);

  useMobileNotificationPulses(notificationPulses, atlasRoot, mobileNotificationsEnabled, mobileNotificationPermission);

  useEffect(() => {
    void restoreAttachmentPreviews().catch((error) => {
      console.error("Attachment preview restore failed", error);
    });
  }, [restoreAttachmentPreviews]);

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
      importNotebook(root, datasetNameFromFile(entry.name), attachmentPreviewUrls);
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

  return (
    <main className="app-shell" data-theme={theme}>
      <UniverseCanvas theme={theme} />

      <header className="top-bar" aria-label="Mind Atlas status">
        <div className="top-title-stack">
          <AtlasBreadcrumb path={selectedPath} onFocus={focusNode} />
          <DatasetTitleInput title={atlasRoot.title} onChange={(title) => updateNode(atlasRoot.id, { title })} />
          <UnreadNotificationLinks
            items={unreadNotificationLinks}
            voiceLogEntry={latestTextPartnerEntry}
            voiceLogUnreadCount={unreadTextPartnerEntries.length}
            onFocus={handleFocusNotification}
            onOpenVoiceLog={handleOpenVoiceLog}
          />
        </div>
      </header>

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
              <button type="button" onClick={handleUndo} disabled={!canUndo}>
                <Undo2 size={15} /> Undo
              </button>
            <button type="button" onClick={handleRedo} disabled={!canRedo}>
                <Redo2 size={15} /> Redo
              </button>
            </div>
            <button type="button" onClick={handleOpenVoiceLog}>
              <MessageSquareText size={15} />
              <span>
                Voice log
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

      <Minimap />
      <section className="mobile-workspace-panel" data-active-tab={mobilePanelTab} aria-label="Mobile workspace">
        <div className="mobile-workspace-tabs" role="tablist" aria-label="Workspace panel">
          <button
            className={mobilePanelTab === "command" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={mobilePanelTab === "command"}
            onClick={() => setMobilePanelTab("command")}
          >
            <MessageSquareText size={15} />
            <span>Command</span>
          </button>
          <button
            className={mobilePanelTab === "editor" ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={mobilePanelTab === "editor"}
            onClick={() => setMobilePanelTab("editor")}
          >
            <PenLine size={15} />
            <span>Editor</span>
          </button>
        </div>
        <div className="mobile-panel-slot mobile-command-slot" role="tabpanel" aria-hidden={mobilePanelTab !== "command"}>
          <CommandDock />
        </div>
        <div className="mobile-panel-slot mobile-editor-slot" role="tabpanel" aria-hidden={mobilePanelTab !== "editor"}>
          <FocusPanel theme={theme} />
        </div>
      </section>
      {voiceLogOpen ? (
        <VoiceLogDialog
          entries={voiceLogEntries}
          summary={voiceSessionSummary}
          onClose={() => setVoiceLogOpen(false)}
          onClear={clearVoiceLog}
        />
      ) : null}
      {voiceSettingsOpen ? (
        <VoiceSettingsDialog
          settings={voicePartnerSettings}
          onClose={() => setVoiceSettingsOpen(false)}
          onSave={setVoicePartnerSettings}
          onRestart={handleRestartRealtime}
        />
      ) : null}
      {cloudLoadOpen ? (
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
    const confirmed = window.confirm("Clear the local Voice Partner log?");
    if (!confirmed) return;
    onClear();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="voice-log-dialog" role="dialog" aria-modal="true" aria-label="Voice log" onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>Voice log</h2>
            <p>{entries.length} entries</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={handleClear} aria-label="Clear Voice log" disabled={entries.length === 0}>
              <Trash2 size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close Voice log">
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
            <p className="voice-log-empty">No Voice Partner log entries yet.</p>
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
      if (!target.closest(".command-dock input, .command-dock textarea, .command-dock select")) return;
      if (!isMobileKeyboardOverlayTarget(stableHeightRef.current)) return;
      keyboardOverlayPreparedUntilRef.current = Date.now() + 1200;
      rememberStableHeight();
      setVirtualKeyboardOverlay(true);
      document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
    };

    const updateViewportHeight = () => {
      const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
      const keyboardOverlayPrepared = Date.now() < keyboardOverlayPreparedUntilRef.current;
      const keyboardOverlayMode = (commandInputEditing || keyboardOverlayPrepared) && isMobileKeyboardOverlayTarget(stableHeightRef.current);

      if (!keyboardOverlayMode) {
        rememberStableHeight();
        document.documentElement.removeAttribute("data-keyboard-overlay-input");
      } else {
        setVirtualKeyboardOverlay(true);
        document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
      }

      const stableHeight = stableHeightRef.current ?? Math.max(height, window.innerHeight, document.documentElement.clientHeight);
      const appHeight = keyboardOverlayMode ? stableHeight : height;
      document.documentElement.style.setProperty("--app-height", `${appHeight}px`);
    };

    const updateViewportHeightAfterOrientation = () => {
      stableHeightRef.current = null;
      lastViewportWidthRef.current = null;
      window.setTimeout(updateViewportHeight, 80);
      window.setTimeout(updateViewportHeight, 360);
    };

    const handlePointerDown = (event: PointerEvent) => prepareKeyboardOverlay(event.target);
    const handleTouchStart = (event: TouchEvent) => prepareKeyboardOverlay(event.target);
    const handleFocusIn = (event: FocusEvent) => prepareKeyboardOverlay(event.target);

    updateViewportHeight();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("touchstart", handleTouchStart, true);
    document.addEventListener("focusin", handleFocusIn, true);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeightAfterOrientation);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeightAfterOrientation);
    };
  }, [commandInputEditing]);

  useEffect(() => {
    if (commandInputEditing && isMobileKeyboardOverlayTarget(stableHeightRef.current)) {
      setVirtualKeyboardOverlay(true);
      return;
    }

    window.setTimeout(() => {
      if (!useAtlasStore.getState().commandInputEditing) {
        setVirtualKeyboardOverlay(false);
      }
    }, 300);
  }, [commandInputEditing]);
}

function isMobileKeyboardOverlayTarget(stableHeight: number | null) {
  if (typeof window === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const narrowViewport = width <= 980 || window.innerWidth <= 980;
  const portraitBeforeKeyboard = stableHeight ? stableHeight > width : (window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight >= width);
  return coarsePointer && narrowViewport && portraitBeforeKeyboard;
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
  virtualKeyboard?: {
    overlaysContent: boolean;
  };
};

function DatasetTitleInput({ title, onChange }: { title: string; onChange: (title: string) => void }) {
  const storedTitle = title && title !== "Mind Atlas" ? title : "";
  const [draftTitle, setDraftTitle] = useState(storedTitle);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraftTitle(storedTitle);
  }, [editing, storedTitle]);

  return (
    <input
      className="dataset-title-input"
      value={draftTitle}
      placeholder="Spatial Notebook"
      onFocus={() => setEditing(true)}
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

function AtlasBreadcrumb({ path, onFocus }: { path: AtlasNode[]; onFocus: (id: string) => void }) {
  const crumbs = compactBreadcrumb(path);

  return (
    <nav className="atlas-breadcrumb" aria-label="Atlas path">
      <button className="atlas-logo-crumb" type="button" onClick={() => onFocus(path[0].id)}>
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
          title={voiceLogEntry.title || "Text Partner reply"}
        >
          <MessageSquareText size={12} />
          <span>{voiceLogUnreadCount > 1 ? `${voiceLogUnreadCount} text replies` : shortNotificationTitle(voiceLogEntry.title || "Text reply")}</span>
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
  const entryTime = new Date(entry.createdAt).getTime();
  const seenTime = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(entryTime)) return false;
  return !Number.isFinite(seenTime) || entryTime > seenTime;
}

function voiceLogUnreadLabel(unreadCount: number, totalCount: number) {
  if (unreadCount > 0) return `${unreadCount} unread / ${totalCount} entries`;
  return `${totalCount} entries`;
}

function compactBreadcrumb(path: AtlasNode[]) {
  const nodes = path.slice(1);
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

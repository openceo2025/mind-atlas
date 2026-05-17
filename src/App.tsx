import { FocusPanel } from "./components/FocusPanel";
import { CloudDownload, CloudUpload, Download, MessageSquareText, Moon, MoreHorizontal, Redo2, RefreshCw, RotateCcw, Sun, Trash2, Undo2, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { downloadCloudNotebookPackage, listCloudNotebookPackages, saveCloudNotebookPackage } from "./ai/bridgeClient";
import { replaceStoredAttachmentBlobs } from "./attachmentStorage";
import { CommandDock } from "./components/CommandDock";
import { Minimap } from "./components/Minimap";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { createNotebookPackage, importNotebookPackage } from "./notebookPackage";
import { findNodePath, useAtlasStore } from "./store/atlasStore";
import { loadStoredTheme, persistTheme, type AtlasTheme } from "./theme";
import type { AtlasNode, CloudNotebookEntry } from "./types";

export default function App() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const resetNotebook = useAtlasStore((state) => state.resetNotebook);
  const undo = useAtlasStore((state) => state.undo);
  const redo = useAtlasStore((state) => state.redo);
  const canUndo = useAtlasStore((state) => state.historyPast.length > 0);
  const canRedo = useAtlasStore((state) => state.historyFuture.length > 0);
  const voiceLogEntries = useAtlasStore((state) => state.voiceLogEntries);
  const voiceSessionSummary = useAtlasStore((state) => state.voiceSessionSummary);
  const clearVoiceLog = useAtlasStore((state) => state.clearVoiceLog);
  const restoreAttachmentPreviews = useAtlasStore((state) => state.restoreAttachmentPreviews);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);
  const [cloudLoadOpen, setCloudLoadOpen] = useState(false);
  const [cloudNotebooks, setCloudNotebooks] = useState<CloudNotebookEntry[]>([]);
  const [cloudDirectory, setCloudDirectory] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [theme, setTheme] = useState<AtlasTheme>(() => loadStoredTheme());
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    void restoreAttachmentPreviews().catch((error) => {
      console.error("Attachment preview restore failed", error);
    });
  }, [restoreAttachmentPreviews]);

  const handleExportLight = () => {
    const blob = new Blob([exportNotebook()], { type: "application/mindatlas+json" });
    downloadBlob(blob, `${datasetFileName(atlasRoot.title)}.mindatlas`);
    setMenuOpen(false);
  };

  const handleExportPackage = async () => {
    const result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
    downloadBlob(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
    if (result.missingCount > 0) {
      window.alert(
        `${result.missingCount} attachment(s) could not be included because this browser session only has metadata for them.`,
      );
    }
    setMenuOpen(false);
  };

  const handleSaveToCloud = async () => {
    try {
      setCloudError("");
      setCloudStatus("Saving to cloud...");
      const result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
      const saved = await saveCloudNotebookPackage(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
      setCloudStatus(`Saved: ${saved.name}`);
      if (result.missingCount > 0) {
        window.alert(
          `${result.missingCount} attachment(s) could not be included because this browser session only has metadata for them.`,
        );
      }
      setMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud save failed.";
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
    setMenuOpen(false);
  };

  return (
    <main className="app-shell" data-theme={theme}>
      <UniverseCanvas theme={theme} />

      <header className="top-bar" aria-label="Mind Atlas status">
        <div>
          <AtlasBreadcrumb path={selectedPath} onFocus={focusNode} />
          <DatasetTitleInput title={atlasRoot.title} onChange={(title) => updateNode(atlasRoot.id, { title })} />
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
                <small>{voiceLogEntries.length} entries</small>
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
      <CommandDock />
      <FocusPanel />
      {voiceLogOpen ? (
        <VoiceLogDialog
          entries={voiceLogEntries}
          summary={voiceSessionSummary}
          onClose={() => setVoiceLogOpen(false)}
          onClear={clearVoiceLog}
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
          {entries.length ? (
            entries.map((entry) => (
              <article key={entry.id} className={`voice-log-entry is-${entry.role}`}>
                <header>
                  <strong>{entry.title || voiceRoleLabel(entry.role)}</strong>
                  <span>{entry.status ? `${entry.status} / ` : ""}{formatVoiceLogTime(entry.createdAt)}</span>
                </header>
                <p>{entry.text}</p>
                {entry.toolName ? <small>tool: {entry.toolName}</small> : null}
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

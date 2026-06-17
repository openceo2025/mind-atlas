import {
  Bot,
  CalendarClock,
  CornerDownLeft,
  Copy,
  FileArchive,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
  Mic,
  Paintbrush,
  Plus,
  Presentation,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { saveStoredAttachmentBlob } from "../attachmentStorage";
import { buildContextCopy, CONTEXT_COPY_PRESETS, copyContextMarkdown, formatContextCopyStats, type ContextCopyPreset } from "../context/contextCopy";
import { UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "../events";
import { findNode, useAtlasStore } from "../store/atlasStore";
import type { AtlasTheme } from "../theme";
import type { AtlasNode, AttachmentKind, NodeAttachment, WorkStatus } from "../types";

let sessionReminderDraftAt = addDays(new Date(), 1).toISOString();
const STATUS_OPTIONS: WorkStatus[] = ["running", "needs_review", "waiting", "blocked", "error", "done"];

export function FocusPanel({ theme = "dark" }: { theme?: AtlasTheme }) {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const addAttachment = useAtlasStore((state) => state.addAttachment);
  const removeAttachment = useAtlasStore((state) => state.removeAttachment);
  const updateNodeAppearance = useAtlasStore((state) => state.updateNodeAppearance);
  const setNodeReminder = useAtlasStore((state) => state.setNodeReminder);
  const clearNodeReminder = useAtlasStore((state) => state.clearNodeReminder);
  const setNodeStatus = useAtlasStore((state) => state.setNodeStatus);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const aiRuns = useAtlasStore((state) => state.aiRuns);
  const selectedNode = findNode(atlasRoot, selectedNodeId) ?? atlasRoot;
  const isRoot = selectedNode.id === atlasRoot.id;
  const [surfaceMenuOpen, setSurfaceMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [reminderDraftAt, setReminderDraftAt] = useState(sessionReminderDraftAt);
  const [reminderCalendarMonth, setReminderCalendarMonth] = useState(() => startOfMonth(dateFromInput(sessionReminderDraftAt) ?? addDays(new Date(), 1)));
  const aiRun = selectedNode.aiRunId ? aiRuns[selectedNode.aiRunId] : undefined;
  const reminderDraft = dateFromInput(reminderDraftAt) ?? addDays(new Date(), 1);
  const reminderMobileLayout = useReminderMobileLayout();

  useEffect(() => {
    const closeMenus = () => {
      setSurfaceMenuOpen(false);
      setCopyMenuOpen(false);
      setReminderMenuOpen(false);
      setStatusMenuOpen(false);
    };
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenus);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenus);
  }, []);

  const updateReminderDraft = (date: Date) => {
    const iso = date.toISOString();
    sessionReminderDraftAt = iso;
    setReminderDraftAt(iso);
    setReminderCalendarMonth(startOfMonth(date));
  };

  const handleSetReminder = () => {
    if (reminderDraft.getTime() < Date.now()) {
      const confirmed = window.confirm(
        `The selected reminder time is in the past:\n\n${formatReminderDate(reminderDraft.toISOString())}\n\nThis notification may fire immediately. Set it anyway?`,
      );
      if (!confirmed) return;
    }
    setNodeReminder(selectedNode.id, reminderDraft.toISOString());
    setReminderMenuOpen(false);
  };

  const reminderMenu = reminderMenuOpen ? (
    <div
      className={`context-menu reminder-context-menu ${reminderMobileLayout ? "is-mobile" : ""} theme-${theme}`}
      role="dialog"
      aria-label="Reminder settings"
      onPointerDown={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="reminder-current">
        <span>Current</span>
        <strong>{selectedNode.reminderAt ? formatReminderDate(selectedNode.reminderAt) : "No reminder"}</strong>
      </div>
      <label className="reminder-date-field">
        <span>Date</span>
        <input
          type="date"
          value={dateInputValue(reminderDraft)}
          onChange={(event) => {
            const [year, month, day] = event.target.value.split("-").map(Number);
            if (!year || !month || !day) return;
            const next = new Date(reminderDraft);
            next.setFullYear(year, month - 1, day);
            updateReminderDraft(next);
          }}
        />
      </label>
      <CalendarPicker
        month={reminderCalendarMonth}
        selectedDate={reminderDraft}
        onMonthChange={setReminderCalendarMonth}
        onSelectDate={(date) => {
          const next = new Date(reminderDraft);
          next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
          updateReminderDraft(next);
        }}
      />
      <div className="reminder-time-picker" aria-label="Reminder time">
        <TimeStepper
          label="Hour"
          value={reminderDraft.getHours()}
          max={23}
          onChange={(hour) => {
            const next = new Date(reminderDraft);
            next.setHours(hour);
            updateReminderDraft(next);
          }}
        />
        <span className="reminder-time-separator">:</span>
        <TimeStepper
          label="Minute"
          value={reminderDraft.getMinutes()}
          max={59}
          onChange={(minute) => {
            const next = new Date(reminderDraft);
            next.setMinutes(minute);
            updateReminderDraft(next);
          }}
        />
      </div>
      <div className="reminder-quick-row" aria-label="Quick reminder offsets">
        <button type="button" onClick={() => updateReminderDraft(new Date())}>
          Now
        </button>
        {[15, 30, 60, 180].map((minutes) => (
          <button key={minutes} type="button" onClick={() => updateReminderDraft(addMinutes(reminderDraft, minutes))}>
            +{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
          </button>
        ))}
        <button type="button" onClick={() => updateReminderDraft(addDays(reminderDraft, 1))}>
          +1d
        </button>
      </div>
      <div className="reminder-actions">
        <button
          type="button"
          onClick={handleSetReminder}
        >
          Set reminder
        </button>
        <button
          type="button"
          onClick={() => {
            clearNodeReminder(selectedNode.id);
            setReminderMenuOpen(false);
          }}
          disabled={!selectedNode.reminderAt}
        >
          Clear reminder
        </button>
        <button type="button" onClick={() => setReminderMenuOpen(false)}>
          Close
        </button>
      </div>
    </div>
  ) : null;

  const reminderPortalTarget = typeof document === "undefined" ? null : document.body;

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    for (const file of Array.from(event.target.files)) {
      const attachment: NodeAttachment = {
        id: `${selectedNode.id}-attachment-${Date.now()}-${crypto.randomUUID()}`,
        name: file.name,
        kind: getAttachmentKind(file.type),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        path: file.name,
        createdAt: new Date().toISOString(),
      };
      addAttachment(selectedNode.id, attachment, URL.createObjectURL(file));
      void saveStoredAttachmentBlob(attachment, file).catch((error) => {
        console.error("Failed to store attachment blob", error);
      });
    }
    event.target.value = "";
  };

  const handleCopyContext = (preset: ContextCopyPreset) => {
    void copyContextMarkdown(atlasRoot, selectedNode.id, preset)
      .then((result) => {
        setCopyStatus(`Copied ${formatContextCopyStats(result)}`);
        setCopyMenuOpen(false);
      })
      .catch((error) => setCopyStatus(error instanceof Error ? error.message : "Copy failed."));
  };

  return (
    <>
      <aside className={`focus-panel ${isRoot ? "is-hidden" : "is-active"}`} aria-label="Focused context" aria-hidden={isRoot}>
        <div className="panel-toolbar">
        <label className="icon-button file-button panel-tool-button" aria-label="Attach file">
          <Plus size={18} />
          <input type="file" multiple onChange={handleAttachmentChange} />
        </label>
        <div className="panel-menu-anchor">
          <button
            className="icon-button panel-tool-button"
            type="button"
            onClick={() => {
              setCopyMenuOpen((open) => !open);
              setSurfaceMenuOpen(false);
              setReminderMenuOpen(false);
              setStatusMenuOpen(false);
            }}
            aria-label="Copy with context"
          >
            <Copy size={17} />
          </button>
          {copyMenuOpen ? (
            <div className="context-menu surface-context-menu">
              {CONTEXT_COPY_PRESETS.map((preset) => {
                const preview = buildContextCopy(atlasRoot, selectedNode.id, preset.id);
                return (
                  <button key={preset.id} type="button" onClick={() => handleCopyContext(preset.id)} title={formatContextCopyStats(preview)}>
                    <span>{preset.label}</span>
                    <small>{formatContextCopyStats(preview)}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="panel-menu-anchor">
          <button
            className="ai-node-status"
            type="button"
            title={aiRun?.error ?? selectedNode.nextDecision}
            aria-label="Change node status"
            aria-haspopup="menu"
            aria-expanded={statusMenuOpen}
            onClick={() => {
              setStatusMenuOpen((open) => !open);
              setReminderMenuOpen(false);
              setSurfaceMenuOpen(false);
            }}
          >
            <Bot size={14} />
            <span>{formatStatusLabel(selectedNode.status)}</span>
            {selectedNode.modelId ? <b>{selectedNode.modelId}</b> : null}
          </button>
          {statusMenuOpen ? (
            <div className="context-menu status-context-menu" role="menu" aria-label="Node status">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  className={selectedNode.status === status ? "is-active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedNode.status === status}
                  onClick={() => {
                    setNodeStatus(selectedNode.id, status, `Status changed to ${formatStatusLabel(status)} by human.`);
                    setStatusMenuOpen(false);
                  }}
                >
                  <span>{formatStatusLabel(status)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="panel-menu-anchor">
          <button
            className={`icon-button panel-tool-button ${selectedNode.reminderAt && !selectedNode.reminderFiredAt ? "is-live" : ""}`}
            type="button"
            onClick={() => {
              setReminderMenuOpen((open) => !open);
              setSurfaceMenuOpen(false);
              setStatusMenuOpen(false);
            }}
            aria-label="Open reminder menu"
            title={selectedNode.reminderAt ? `Reminder: ${formatReminderDate(selectedNode.reminderAt)}` : "Set reminder"}
          >
            <CalendarClock size={17} />
          </button>
          {reminderMobileLayout ? null : reminderMenu}
        </div>
        <div className="panel-menu-anchor">
          <button
            className="icon-button panel-tool-button"
            type="button"
            onClick={() => {
              setSurfaceMenuOpen((open) => !open);
              setReminderMenuOpen(false);
              setStatusMenuOpen(false);
            }}
            aria-label="Open surface menu"
          >
            <Paintbrush size={17} />
          </button>
          {surfaceMenuOpen ? (
            <div className="context-menu surface-context-menu">
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={selectedNode.color}
                  onChange={(event) => updateNodeAppearance(selectedNode.id, { color: event.target.value })}
                  aria-label="Node color"
                />
              </label>
              <label>
                <span>Texture</span>
                <select
                  value={selectedNode.texture}
                  onChange={(event) =>
                    updateNodeAppearance(selectedNode.id, { texture: event.target.value as AtlasNode["texture"] })
                  }
                  aria-label="Node texture"
                >
                  <option value="speckled">Speckled</option>
                  <option value="bands">Bands</option>
                  <option value="freckles">Freckles</option>
                  <option value="craters">Craters</option>
                  <option value="mist">Mist</option>
                  <option value="cell">Cell</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>
      {copyStatus ? <div className="panel-copy-status" role="status">{copyStatus}</div> : null}

      <div className="panel-text-section">
        <textarea
          className="node-body-input"
          value={selectedNode.body}
          onChange={(event) =>
            updateNode(selectedNode.id, {
              body: event.target.value,
              summary: event.target.value.split("\n").find(Boolean) ?? "Empty notebook node.",
            })
          }
          placeholder={isRoot ? "Your atlas home note." : "Write the thought, prompt, or context here."}
          aria-label="Node body"
        />
        <button
          className="return-button"
          type="button"
          onClick={() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
          aria-label="Confirm editing"
        >
          <CornerDownLeft size={17} />
        </button>
      </div>

      <section className="panel-preview-area" aria-label="Attachment preview">
        <div className="panel-preview-frame">
          {selectedNode.attachments.length ? (
            <div className="attachment-list panel-preview-list">
              {selectedNode.attachments.map((attachment) => (
                <AttachmentPreviewCard
                  key={attachment.id}
                  attachment={attachment}
                  previewUrl={attachmentPreviewUrls[attachment.id]}
                  onRemove={() => removeAttachment(selectedNode.id, attachment.id)}
                />
              ))}
            </div>
          ) : (
            <p className="preview-empty">No preview</p>
          )}
        </div>
      </section>
      </aside>
      {reminderMobileLayout && reminderMenu && reminderPortalTarget ? createPortal(reminderMenu, reminderPortalTarget) : null}
    </>
  );
}

function useReminderMobileLayout() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      const portrait = window.matchMedia("(max-width: 620px) and (orientation: portrait)").matches;
      const landscape = window.matchMedia("(max-height: 620px) and (orientation: landscape)").matches;
      setIsMobile(portrait || landscape);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return isMobile;
}

function formatStatusLabel(status: WorkStatus) {
  return status.replace(/_/g, " ");
}

function TimeStepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const padded = String(value).padStart(2, "0");
  const wrap = (next: number) => {
    if (next < 0) return max;
    if (next > max) return 0;
    return next;
  };

  return (
    <div className="time-stepper">
      <span>{label}</span>
      <button type="button" onClick={() => onChange(wrap(value + 1))} aria-label={`Increase ${label}`}>
        +
      </button>
      <input
        inputMode="numeric"
        value={padded}
        onChange={(event) => {
          const next = Number(event.target.value.replace(/\D/g, "").slice(0, 2));
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(0, next)));
        }}
        aria-label={label}
      />
      <button type="button" onClick={() => onChange(wrap(value - 1))} aria-label={`Decrease ${label}`}>
        -
      </button>
    </div>
  );
}

function CalendarPicker({
  month,
  selectedDate,
  onMonthChange,
  onSelectDate,
}: {
  month: Date;
  selectedDate: Date;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: Date) => void;
}) {
  const cells = calendarCells(month);
  const monthLabel = month.toLocaleDateString(undefined, { year: "numeric", month: "short" });

  return (
    <div className="reminder-calendar" aria-label="Reminder calendar">
      <div className="reminder-calendar-header">
        <button type="button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="reminder-calendar-weekdays" aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="reminder-calendar-grid">
        {cells.map((date) => {
          const isCurrentMonth = date.getMonth() === month.getMonth();
          const isSelected = sameDate(date, selectedDate);
          return (
            <button
              key={date.toISOString()}
              className={`${isCurrentMonth ? "" : "is-outside"} ${isSelected ? "is-selected" : ""}`}
              type="button"
              onClick={() => onSelectDate(date)}
              aria-pressed={isSelected}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date: Date, days: number) {
  return addMinutes(date, days * 24 * 60);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months, 1);
  return startOfMonth(next);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarCells(month: Date) {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function sameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateFromInput(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReminderDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AttachmentPreviewCard({
  attachment,
  previewUrl,
  onRemove,
}: {
  attachment: NodeAttachment;
  previewUrl?: string;
  onRemove: () => void;
}) {
  const extension = getFileExtension(attachment.name);
  const FileIcon = getFileIcon(extension, attachment.mimeType);

  return (
    <div className="attachment-preview">
      <button className="attachment-remove" type="button" onClick={onRemove} aria-label={`Remove ${attachment.name}`}>
        <X size={14} />
      </button>
      <div className="attachment-meta">
        {attachment.kind === "file" ? (
          <span className={`file-type-icon file-type-${extension || "file"}`}>
            <FileIcon size={24} />
            <b>{extension || "FILE"}</b>
          </span>
        ) : (
          <span className="file-type-icon file-type-media">
            <FileIcon size={24} />
            <b>{attachment.kind.toUpperCase()}</b>
          </span>
        )}
        <div>
          <strong>{attachment.name}</strong>
          <span>
            {attachment.kind} / {formatBytes(attachment.size)}
          </span>
        </div>
      </div>
      {previewUrl && attachment.kind === "image" ? <img src={previewUrl} alt={attachment.name} /> : null}
      {previewUrl && attachment.kind === "audio" ? <audio src={previewUrl} controls /> : null}
      {previewUrl && attachment.kind === "video" ? <video src={previewUrl} controls /> : null}
      {!previewUrl ? <p>Stored as metadata: {attachment.path}</p> : null}
    </div>
  );
}

function getAttachmentKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(name: string) {
  const value = name.split(".").pop()?.trim().toUpperCase() ?? "";
  return value.length > 1 && value.length <= 6 ? value : "";
}

function getFileIcon(extension: string, mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("audio/")) return Mic;
  if (["XLS", "XLSX", "CSV", "TSV"].includes(extension)) return FileSpreadsheet;
  if (["PPT", "PPTX", "KEY"].includes(extension)) return Presentation;
  if (["ZIP", "RAR", "7Z", "TAR", "GZ"].includes(extension)) return FileArchive;
  if (["JSON", "YAML", "YML"].includes(extension)) return FileJson;
  if (["TXT", "MD", "PDF", "DOC", "DOCX", "RTF"].includes(extension) || mimeType.startsWith("text/")) return FileText;
  if (["JS", "TS", "TSX", "JSX", "HTML", "CSS", "PY", "RB", "GO", "RS"].includes(extension)) return FileCode;
  return FileType;
}

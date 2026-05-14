import {
  Bot,
  CornerDownLeft,
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
import { saveStoredAttachmentBlob } from "../attachmentStorage";
import { UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "../events";
import { findNode, useAtlasStore } from "../store/atlasStore";
import type { AtlasNode, AttachmentKind, NodeAttachment } from "../types";

export function FocusPanel() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const addAttachment = useAtlasStore((state) => state.addAttachment);
  const removeAttachment = useAtlasStore((state) => state.removeAttachment);
  const updateNodeAppearance = useAtlasStore((state) => state.updateNodeAppearance);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const aiRuns = useAtlasStore((state) => state.aiRuns);
  const selectedNode = findNode(atlasRoot, selectedNodeId) ?? atlasRoot;
  const isRoot = selectedNode.id === atlasRoot.id;
  const [surfaceMenuOpen, setSurfaceMenuOpen] = useState(false);
  const aiRun = selectedNode.aiRunId ? aiRuns[selectedNode.aiRunId] : undefined;

  useEffect(() => {
    const closeSurfaceMenu = () => setSurfaceMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeSurfaceMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeSurfaceMenu);
  }, []);

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

  return (
    <aside className="focus-panel" aria-label="Focused context">
      <div className="panel-toolbar">
        <label className="icon-button file-button panel-tool-button" aria-label="Attach file">
          <Plus size={18} />
          <input type="file" multiple onChange={handleAttachmentChange} />
        </label>
        <div className="ai-node-status" title={aiRun?.error ?? selectedNode.nextDecision}>
          <Bot size={14} />
          <span>{selectedNode.author === "ai" ? selectedNode.provider ?? "ai" : selectedNode.status}</span>
          {selectedNode.modelId ? <b>{selectedNode.modelId}</b> : null}
        </div>
        <div className="panel-menu-anchor">
          <button
            className="icon-button panel-tool-button"
            type="button"
            onClick={() => setSurfaceMenuOpen((open) => !open)}
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
                  aria-label="Planet color"
                />
              </label>
              <label>
                <span>Texture</span>
                <select
                  value={selectedNode.texture}
                  onChange={(event) =>
                    updateNodeAppearance(selectedNode.id, { texture: event.target.value as AtlasNode["texture"] })
                  }
                  aria-label="Planet texture"
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
  );
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

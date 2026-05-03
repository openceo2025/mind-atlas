import {
  CircleDot,
  Crosshair,
  Download,
  FileArchive,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Image as ImageIcon,
  Mic,
  Plus,
  Presentation,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef } from "react";
import { findNode, findNodePath, useAtlasStore } from "../store/atlasStore";
import type { AtlasNode, AttachmentKind, NodeAttachment } from "../types";

export function FocusPanel() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const addSiblingNode = useAtlasStore((state) => state.addSiblingNode);
  const addAttachment = useAtlasStore((state) => state.addAttachment);
  const removeAttachment = useAtlasStore((state) => state.removeAttachment);
  const updateNodeAppearance = useAtlasStore((state) => state.updateNodeAppearance);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const titleEditRequestId = useAtlasStore((state) => state.titleEditRequestId);
  const consumeTitleEditRequest = useAtlasStore((state) => state.consumeTitleEditRequest);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const selectedNode = findNode(atlasRoot, selectedNodeId) ?? atlasRoot;
  const nodePath = findNodePath(atlasRoot, selectedNode.id) ?? [atlasRoot];
  const isRoot = selectedNode.id === atlasRoot.id;
  const childrenLabel = isRoot ? "Planets" : "Moons";

  useEffect(() => {
    if (titleEditRequestId !== selectedNode.id) return;
    const input = titleInputRef.current;
    if (!input) return;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
      consumeTitleEditRequest();
    });
  }, [consumeTitleEditRequest, selectedNode.id, titleEditRequestId]);

  const tagValue = useMemo(() => selectedNode.tags.map((tag) => `#${tag}`).join(" "), [selectedNode.tags]);

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
    }
    event.target.value = "";
  };

  const handleExport = () => {
    const blob = new Blob([exportNotebook()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mind-atlas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importNotebook(JSON.parse(String(reader.result)));
      } catch (error) {
        console.error("Notebook import failed", error);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <aside className="focus-panel" aria-label="Focused context">
      <div className="panel-header">
        <div className="panel-title-stack">
          <p className="eyebrow">{isRoot ? "Atlas" : selectedNode.nodeType.replace("_", " ")}</p>
          <input
            ref={titleInputRef}
            className="node-title-input"
            value={selectedNode.title}
            onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })}
            aria-label="Node title"
          />
        </div>
        <button className="icon-button" type="button" onClick={() => focusNode(selectedNode.id)} aria-label="Center focus">
          <Crosshair size={18} />
        </button>
      </div>

      {nodePath.length > 1 ? (
        <div className="breadcrumb-row">
          {nodePath.slice(1).map((node) => (
            <button key={node.id} type="button" onClick={() => focusNode(node.id)}>
              {node.title}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        className="node-body-input"
        value={selectedNode.body}
        onChange={(event) =>
          updateNode(selectedNode.id, {
            body: event.target.value,
            summary: event.target.value.split("\n").find(Boolean) ?? "Empty notebook node.",
          })
        }
        placeholder={isRoot ? "Your atlas home note." : "Write the thought, prompt, or context here. #tags connect related planets."}
        aria-label="Node body"
      />

      <div className="node-tags-line">
        <input
          className="node-tags-input"
          value={tagValue}
          onChange={(event) => updateNode(selectedNode.id, { tags: event.target.value.split(/\s+/) })}
          placeholder="#project #idea"
          aria-label="Node tags"
        />
      </div>

      <div className="node-action-grid primary-actions">
        <button className="secondary-button" type="button" onClick={() => addChildNode(selectedNode.id)}>
          <Plus size={15} /> {isRoot ? "Planet" : "Moon"}
        </button>
        <button className="secondary-button" type="button" onClick={() => addSiblingNode(selectedNode.id)} disabled={isRoot}>
          <CircleDot size={15} /> Branch
        </button>
        <label className="secondary-button file-button">
          <Upload size={15} /> Attach
          <input type="file" multiple onChange={handleAttachmentChange} />
        </label>
        <button className="secondary-button voice-button" type="button" disabled aria-label="Voice input placeholder">
          <Mic size={15} /> Voice
        </button>
      </div>

      <div className="save-row">
        <button className="ghost-button" type="button" onClick={handleExport}>
          <Download size={14} /> Export
        </button>
        <label className="ghost-button file-button">
          <Upload size={14} /> Import
          <input type="file" accept="application/json,.json" onChange={handleImport} />
        </label>
      </div>

      {!isRoot ? (
        <details className="surface-details">
          <summary>Surface</summary>
          <div className="appearance-controls">
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
        </details>
      ) : null}

      {selectedNode.attachments.length ? (
        <section className="panel-section">
          <h3>Attachments</h3>
          <div className="attachment-list">
            {selectedNode.attachments.map((attachment) => (
              <AttachmentPreviewCard
                key={attachment.id}
                attachment={attachment}
                previewUrl={attachmentPreviewUrls[attachment.id]}
                onRemove={() => removeAttachment(selectedNode.id, attachment.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedNode.children.length ? (
        <section className="panel-section compact-children">
          <h3>{childrenLabel}</h3>
          <div className="artifact-list">
            {selectedNode.children.map((child) => (
              <button key={child.id} className="artifact-button" type="button" onClick={() => focusNode(child.id)}>
                <CircleDot size={16} />
                <span>{child.title}</span>
                <small>{child.children.length}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
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

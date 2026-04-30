import {
  AppWindow,
  CircleDot,
  Crosshair,
  Download,
  FileCode,
  FileText,
  Image,
  Plus,
  Presentation,
  Sheet,
  Upload,
} from "lucide-react";
import { ChangeEvent } from "react";
import { resonanceLinks } from "../data/atlas";
import { findNode, findNodePath, getSelectionWorkArea, useAtlasStore } from "../store/atlasStore";
import type { Artifact, ArtifactType, AtlasEvent, AttachmentKind, NodeAttachment } from "../types";
import { getStatusColor, getStatusLabel } from "../utils/status";

export function FocusPanel() {
  const workAreas = useAtlasStore((state) => state.workAreas);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selected = useAtlasStore((state) => state.selected);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusWorkArea = useAtlasStore((state) => state.focusWorkArea);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const addSiblingNode = useAtlasStore((state) => state.addSiblingNode);
  const addAttachment = useAtlasStore((state) => state.addAttachment);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const area = getSelectionWorkArea(workAreas, selected);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const nodePath = findNodePath(atlasRoot, selectedNodeId);
  const display = selectedNode ?? area;
  const statusColor = getStatusColor(display.status);
  const selectedArtifact =
    selected.kind === "artifact" ? area.artifacts.find((artifact) => artifact.id === selected.id) : undefined;
  const selectedEvent = selected.kind === "event" ? area.events.find((event) => event.id === selected.id) : undefined;
  const resonances = resonanceLinks.filter((link) => link.sourceId === area.id || link.targetId === area.id);
  const tagResonances = selectedNode?.tags ?? [];

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedNode || !event.target.files?.length) return;
    for (const file of Array.from(event.target.files)) {
      const attachment: NodeAttachment = {
        id: `${selectedNode.id}-attachment-${Date.now()}-${file.name}`,
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
    anchor.download = `mind-atlas-notebook-${new Date().toISOString().slice(0, 10)}.json`;
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
        <div>
          <p className="eyebrow">Focus</p>
          {selectedNode ? (
            <input
              className="node-title-input"
              value={selectedNode.title}
              onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })}
              aria-label="Node title"
            />
          ) : (
            <h2>{display.title}</h2>
          )}
        </div>
        <button className="icon-button" type="button" onClick={() => focusNode(display.id)} aria-label="Center focus">
          <Crosshair size={18} />
        </button>
      </div>

      <div className="status-row">
        <span className="status-dot" style={{ background: statusColor }} />
        <span>{getStatusLabel(display.status)}</span>
        <span className="muted">{display.subtitle}</span>
      </div>

      {nodePath && nodePath.length > 2 ? (
        <div className="breadcrumb-row">
          {nodePath.slice(1).map((node) => (
            <button key={node.id} type="button" onClick={() => focusNode(node.id)}>
              {node.title}
            </button>
          ))}
        </div>
      ) : null}

      <section className="panel-section">
        <h3>Body</h3>
        {selectedNode ? (
          <textarea
            className="node-body-input"
            value={selectedNode.body}
            onChange={(event) =>
              updateNode(selectedNode.id, {
                body: event.target.value,
                summary: event.target.value.split("\n").find(Boolean) ?? "Empty notebook node.",
              })
            }
            placeholder="Write a prompt-like note here. #tags are detected automatically."
            aria-label="Node body"
          />
        ) : (
          <p>{display.summary}</p>
        )}
      </section>

      <section className="panel-section decision-section">
        <h3>Tags</h3>
        {selectedNode ? (
          <input
            className="node-tags-input"
            value={selectedNode.tags.map((tag) => `#${tag}`).join(" ")}
            onChange={(event) => updateNode(selectedNode.id, { tags: event.target.value.split(/\s+/) })}
            placeholder="#project #idea"
            aria-label="Node tags"
          />
        ) : (
          <p>{display.nextDecision}</p>
        )}
      </section>

      {selectedNode ? (
        <section className="panel-section node-actions">
          <h3>Notebook actions</h3>
          <div className="node-action-grid">
            <button className="secondary-button" type="button" onClick={() => addChildNode(selectedNode.id)}>
              <Plus size={15} /> Child
            </button>
            <button className="secondary-button" type="button" onClick={() => addSiblingNode(selectedNode.id)}>
              <CircleDot size={15} /> Branch
            </button>
            <label className="secondary-button file-button">
              <Upload size={15} /> Attach
              <input type="file" accept="image/*,audio/*,video/*" multiple onChange={handleAttachmentChange} />
            </label>
            <button className="secondary-button" type="button" onClick={handleExport}>
              <Download size={15} /> JSON
            </button>
            <label className="secondary-button file-button">
              <Upload size={15} /> Import
              <input type="file" accept="application/json,.json" onChange={handleImport} />
            </label>
          </div>
        </section>
      ) : null}

      {selectedNode?.attachments.length ? (
        <section className="panel-section">
          <h3>Attachments</h3>
          <div className="attachment-list">
            {selectedNode.attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                previewUrl={attachmentPreviewUrls[attachment.id]}
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedArtifact ? (
        <section className="panel-section">
          <h3>Artifact preview</h3>
          <ArtifactPreview artifact={selectedArtifact} />
        </section>
      ) : null}

      {selectedEvent ? (
        <section className="panel-section">
          <h3>Selected event</h3>
          <EventPreview event={selectedEvent} />
        </section>
      ) : null}

      {selectedNode?.children.length || !selectedArtifact ? (
        <section className="panel-section">
          <h3>{selectedNode?.children.length ? "Children" : "Artifacts"}</h3>
          <div className="artifact-list">
            {selectedNode?.children.length
              ? selectedNode.children.map((child) => (
                  <button key={child.id} className="artifact-button" type="button" onClick={() => focusNode(child.id)}>
                    <CircleDot size={16} />
                    <span>{child.title}</span>
                    <small>{child.kind}</small>
                  </button>
                ))
              : area.artifacts.map((artifact) => (
                  <ArtifactButton key={artifact.id} parentId={area.id} artifact={artifact} />
                ))}
          </div>
        </section>
      ) : null}

      <section className="panel-section">
        <h3>Resonance</h3>
        {tagResonances.length ? (
          <div className="tag-row">
            {tagResonances.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
        <div className="resonance-list">
          {resonances.map((link) => {
            const otherId = link.sourceId === area.id ? link.targetId : link.sourceId;
            const other = workAreas.find((item) => item.id === otherId);
            return (
              <button
                key={link.id}
                className="resonance-button"
                type="button"
                onClick={() => other && focusWorkArea(other.id)}
              >
                <CircleDot size={14} />
                <span>{link.label}</span>
                <strong>{other?.title}</strong>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function AttachmentPreview({ attachment, previewUrl }: { attachment: NodeAttachment; previewUrl?: string }) {
  return (
    <div className="attachment-preview">
      <div>
        <strong>{attachment.name}</strong>
        <span>{attachment.kind} · {formatBytes(attachment.size)}</span>
      </div>
      {previewUrl && attachment.kind === "image" ? <img src={previewUrl} alt={attachment.name} /> : null}
      {previewUrl && attachment.kind === "audio" ? <audio src={previewUrl} controls /> : null}
      {previewUrl && attachment.kind === "video" ? <video src={previewUrl} controls /> : null}
      {!previewUrl ? <p>Stored as path metadata: {attachment.path}</p> : null}
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

function ArtifactButton({ parentId, artifact }: { parentId: string; artifact: Artifact }) {
  const selectArtifact = useAtlasStore((state) => state.selectArtifact);
  const Icon = getArtifactIcon(artifact.type);
  return (
    <button className="artifact-button" type="button" onClick={() => selectArtifact(parentId, artifact.id)}>
      <Icon size={16} />
      <span>{artifact.title}</span>
      <small>{artifact.type}</small>
    </button>
  );
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const Icon = getArtifactIcon(artifact.type);
  return (
    <div className={`artifact-preview artifact-preview-${artifact.type}`}>
      <div className="artifact-preview-title">
        <Icon size={17} />
        <span>{artifact.title}</span>
      </div>
      <p>{artifact.summary}</p>
      <div className="artifact-preview-body">
        {artifact.preview.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      <button className="secondary-button" type="button">
        Open mock artifact
      </button>
    </div>
  );
}

function EventPreview({ event }: { event: AtlasEvent }) {
  return (
    <div className="event-preview">
      <div className="event-preview-meta">
        <span>{event.actor}</span>
        <span>{event.type}</span>
        <span>{event.createdAt}</span>
      </div>
      <p>{event.content}</p>
    </div>
  );
}

function getArtifactIcon(type: ArtifactType) {
  switch (type) {
    case "pptx":
      return Presentation;
    case "xlsx":
      return Sheet;
    case "pdf":
    case "text":
      return FileText;
    case "app":
      return AppWindow;
    case "image":
      return Image;
    case "code":
      return FileCode;
  }
}

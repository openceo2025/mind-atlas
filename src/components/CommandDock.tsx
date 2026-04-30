import { Mic, SendHorizonal } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { findNode, findNodePath, getSelectionWorkArea, useAtlasStore } from "../store/atlasStore";

export function CommandDock() {
  const [value, setValue] = useState("");
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const workAreas = useAtlasStore((state) => state.workAreas);
  const selected = useAtlasStore((state) => state.selected);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const appendInstruction = useAtlasStore((state) => state.appendInstruction);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const pathArea = selectedPath?.find((node) => node.kind === "workArea");
  const area = pathArea
    ? workAreas.find((workArea) => workArea.id === pathArea.id) ?? getSelectionWorkArea(workAreas, selected)
    : getSelectionWorkArea(workAreas, selected);

  const targetLabel = useMemo(() => {
    if (selectedNode && selectedNode.kind !== "workArea") return `to ${area.title} / ${selectedNode.title}`;
    if (selected.kind === "artifact") return `to ${area.title} / artifact`;
    if (selected.kind === "event") return `to ${area.title} / event`;
    return `to ${area.title}`;
  }, [area.title, selected.kind, selectedNode]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    appendInstruction(area.id, trimmed);
    setValue("");
  };

  return (
    <form className="command-dock" onSubmit={handleSubmit} aria-label="Re-instruction input">
      <button className="icon-button ghost" type="button" aria-label="Voice input placeholder">
        <Mic size={18} />
      </button>
      <label className="command-field">
        <span>{targetLabel}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Send a follow-up instruction from this location"
        />
      </label>
      <button className="send-button" type="submit" aria-label="Send instruction">
        <SendHorizonal size={18} />
      </button>
    </form>
  );
}

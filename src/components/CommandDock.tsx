import { Bot, Code2, HardDrive, Mic, PenLine, SendHorizonal, Square } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { startRealtimeVoiceSession, type RealtimeVoiceSession, type RealtimeSessionState } from "../ai/realtimeClient";
import { buildAiNodeContext, findNode, findNodePath, useAtlasStore } from "../store/atlasStore";
import type { AiContextScope, AiExecutionMode } from "../types";

type CommandMode = AiExecutionMode | "note";

export function CommandDock() {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<CommandMode>("openai");
  const [scope, setScope] = useState<AiContextScope>("focused");
  const [voiceState, setVoiceState] = useState<RealtimeSessionState>("closed");
  const [voiceError, setVoiceError] = useState("");
  const voiceSessionRef = useRef<RealtimeVoiceSession | null>(null);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const runAiOnSelectedNode = useAtlasStore((state) => state.runAiOnSelectedNode);
  const addQuickChildFromInput = useAtlasStore((state) => state.addQuickChildFromInput);
  const setNodeStatus = useAtlasStore((state) => state.setNodeStatus);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId);
  const selectedNode = findNode(atlasRoot, selectedNodeId);

  const targetLabel = useMemo(() => {
    const crumbs = (selectedPath ?? []).slice(-3).map((node) => node.title.trim() || "Untitled");
    return `to ${crumbs.join(" / ") || "Mind Atlas"}`;
  }, [selectedPath]);

  useEffect(() => {
    return () => {
      voiceSessionRef.current?.stop();
      voiceSessionRef.current = null;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setVoiceError("");
    setValue("");
    if (mode === "note") {
      addQuickChildFromInput(trimmed);
      return;
    }
    void runAiOnSelectedNode(trimmed, mode, scope);
  };

  const handleVoiceClick = async () => {
    if (voiceSessionRef.current) {
      voiceSessionRef.current.stop();
      voiceSessionRef.current = null;
      setNodeStatus(selectedNodeId, "needs_review", "Realtime voice session ended.");
      return;
    }

    const context = buildAiNodeContext(atlasRoot, selectedNodeId, scope);
    if (!context) return;

    try {
      setVoiceError("");
      setNodeStatus(selectedNodeId, "running", "Realtime voice session is connecting.");
      const session = await startRealtimeVoiceSession({
        context,
        instructions: selectedNode?.body,
        onStateChange: (state) => {
          setVoiceState(state);
          if (state === "live") {
            setNodeStatus(selectedNodeId, "running", "Realtime voice is live. Speak from this node.");
          }
          if (state === "closed") {
            setNodeStatus(selectedNodeId, "needs_review", "Realtime voice session ended.");
          }
        },
        onEvent: (event) => {
          if (!event || typeof event !== "object" || !("type" in event)) return;
          const type = String((event as { type: unknown }).type);
          if (type === "response.done") {
            setNodeStatus(selectedNodeId, "needs_review", "Realtime voice response completed.");
          }
          if (type.includes("error")) {
            setNodeStatus(selectedNodeId, "error", "Realtime voice reported an error.");
          }
        },
      });
      voiceSessionRef.current = session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Realtime voice failed.";
      setVoiceState("error");
      setVoiceError(message);
      setNodeStatus(selectedNodeId, "error", message);
    }
  };

  const voiceIsLive = voiceState === "live" || voiceState === "connecting";
  const contextText = mode === "note" ? "Note mode / no API" : `${scopeLabel(scope)} scope`;
  const statusText = voiceError || (voiceIsLive ? `Realtime ${voiceState}` : `${modeLabel(mode)} / ${selectedNode?.status ?? "waiting"}`);

  return (
    <form className="command-dock" onSubmit={handleSubmit} aria-label="Re-instruction input">
      <button
        className={`icon-button ghost ${voiceIsLive ? "is-live" : ""}`}
        type="button"
        onClick={handleVoiceClick}
        aria-label={voiceIsLive ? "Stop realtime voice" : "Start realtime voice"}
      >
        {voiceIsLive ? <Square size={16} /> : <Mic size={18} />}
      </button>
      <div className="mode-switch" aria-label="AI execution mode">
        <ModeButton mode="openai" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="local" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="codex" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="note" activeMode={mode} onSelect={setMode} />
      </div>
      <select
        className="scope-select"
        value={scope}
        onChange={(event) => setScope(event.target.value as AiContextScope)}
        disabled={mode === "note"}
        aria-label="AI context scope"
        title="AI context scope"
      >
        <option value="minimal">Minimal</option>
        <option value="focused">Focused</option>
        <option value="subtree">Subtree</option>
        <option value="neighborhood">Neighborhood</option>
      </select>
      <label className="command-field">
        <span>
          {targetLabel} / {statusText} / {contextText}
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={mode === "note" ? "Create a child celestial node here" : mode === "codex" ? "Ask Codex from this location" : "Ask AI from this location"}
        />
      </label>
      <button className="send-button" type="submit" aria-label="Send instruction" disabled={!value.trim()}>
        <SendHorizonal size={18} />
      </button>
    </form>
  );
}

function ModeButton({
  mode,
  activeMode,
  onSelect,
}: {
  mode: CommandMode;
  activeMode: CommandMode;
  onSelect: (mode: CommandMode) => void;
}) {
  const Icon = mode === "openai" ? Bot : mode === "local" ? HardDrive : mode === "codex" ? Code2 : PenLine;
  return (
    <button
      className={activeMode === mode ? "is-active" : ""}
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={activeMode === mode}
      aria-label={modeLabel(mode)}
      title={modeLabel(mode)}
    >
      <Icon size={14} />
      <span>{modeLabel(mode)}</span>
    </button>
  );
}

function modeLabel(mode: CommandMode) {
  switch (mode) {
    case "openai":
      return "OpenAI";
    case "local":
      return "Local";
    case "codex":
      return "Codex";
    case "note":
      return "Note";
  }
}

function scopeLabel(scope: AiContextScope) {
  switch (scope) {
    case "minimal":
      return "Minimal";
    case "focused":
      return "Focused";
    case "subtree":
      return "Subtree";
    case "neighborhood":
      return "Neighborhood";
  }
}

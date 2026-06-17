import { AudioLines, Bot, Code2, HardDrive, Mic, PenLine, SendHorizonal, Square, Terminal } from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCodexOptions, transcribeAudio } from "../ai/bridgeClient";
import { startVoicePartnerSession, type RealtimeClientEvent, type RealtimeVoiceSession, type RealtimeSessionState } from "../ai/realtimeClient";
import { runTextPartnerTurn } from "../ai/textPartnerClient";
import { buildVoiceLogContext } from "../ai/voiceLogContext";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT } from "../events";
import { buildAiNodeContextWithAttachments, findInheritedAiDialogSettings, findNode, normalizeAiContextOptions, useAtlasStore } from "../store/atlasStore";
import { loadPersistedUiState, persistUiStatePatch } from "../uiPersistence";
import type { AiAttachmentMode, AiContextScope, AiExecutionMode, CodexContinueMode, CodexOptionsResult, CodexReasoningEffort, CodexSandboxMode } from "../types";

type CommandMode = AiExecutionMode | "note";
type VoiceButtonState = "idle" | "dictation_recording" | "dictation_transcribing" | "voice_connecting" | "voice_ptt" | "voice_responding";

const VOICE_LONG_PRESS_MS = 460;
const VOICE_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const CLAUDE_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const CLAUDE_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
const CLAUDE_MODEL_PRESETS = [
  { id: "bridge", label: "Bridge env", model: "", baseUrl: "" },
  { id: "opus-4-8", label: "Claude Opus 4.8", model: "claude-opus-4-8", baseUrl: CLAUDE_ANTHROPIC_BASE_URL },
  { id: "fable-5", label: "Claude Fable 5", model: "claude-fable-5", baseUrl: CLAUDE_ANTHROPIC_BASE_URL },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", model: "deepseek-v4-pro[1m]", baseUrl: CLAUDE_DEEPSEEK_BASE_URL },
] as const;

export function CommandDock() {
  const [persistedCommandDraft] = useState(() => loadPersistedUiState()?.commandDraft ?? null);
  const [value, setValue] = useState(() => persistedCommandDraft?.value ?? "");
  const [mode, setMode] = useState<CommandMode>(() => isCommandMode(persistedCommandDraft?.mode) ? persistedCommandDraft.mode : "openai");
  const [voiceButtonState, setVoiceButtonState] = useState<VoiceButtonState>("idle");
  const [voiceState, setVoiceState] = useState<RealtimeSessionState>("closed");
  const [voiceError, setVoiceError] = useState("");
  const voiceSessionRef = useRef<RealtimeVoiceSession | null>(null);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pendingVoiceReleaseRef = useRef(false);
  const stopResponsePressRef = useRef(false);
  const activeMicPointerIdRef = useRef<number | null>(null);
  const touchFallbackActiveRef = useRef(false);
  const voiceIdleTimerRef = useRef<number | null>(null);
  const voiceIdleDeadlineAtRef = useRef<number | null>(null);
  const commandDraftPersistTimerRef = useRef<number | null>(null);
  const latestCommandDraftRef = useRef({ value, mode });
  const voiceSessionIdRef = useRef<string | undefined>(undefined);
  const assistantBufferRef = useRef("");
  const voicePendingTurnRef = useRef<{ prompt: string } | null>(null);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const multiSelectedNodeIds = useAtlasStore((state) => state.multiSelectedNodeIds);
  const aiContextOptions = useAtlasStore((state) => state.aiContextOptions);
  const setAiContextOptions = useAtlasStore((state) => state.setAiContextOptions);
  const codexSettings = useAtlasStore((state) => state.codexSettings);
  const setCodexSettings = useAtlasStore((state) => state.setCodexSettings);
  const openClawSettings = useAtlasStore((state) => state.openClawSettings);
  const setOpenClawSettings = useAtlasStore((state) => state.setOpenClawSettings);
  const claudeSettings = useAtlasStore((state) => state.claudeSettings);
  const setClaudeSettings = useAtlasStore((state) => state.setClaudeSettings);
  const loadAiDialogSettingsForNode = useAtlasStore((state) => state.loadAiDialogSettingsForNode);
  const resetAiDialogSettingsToDefaults = useAtlasStore((state) => state.resetAiDialogSettingsToDefaults);
  const setCommandInputEditing = useAtlasStore((state) => state.setCommandInputEditing);
  const setActiveCommandMode = useAtlasStore((state) => state.setActiveCommandMode);
  const appendVoiceLogEntry = useAtlasStore((state) => state.appendVoiceLogEntry);
  const voiceLogEntries = useAtlasStore((state) => state.voiceLogEntries);
  const voiceSessionSummary = useAtlasStore((state) => state.voiceSessionSummary);
  const setVoiceSessionSummary = useAtlasStore((state) => state.setVoiceSessionSummary);
  const voicePartnerSettings = useAtlasStore((state) => state.voicePartnerSettings);
  const runAiOnSelectedNode = useAtlasStore((state) => state.runAiOnSelectedNode);
  const addQuickChildFromInput = useAtlasStore((state) => state.addQuickChildFromInput);
  const setNodeStatus = useAtlasStore((state) => state.setNodeStatus);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const scope = aiContextOptions.scope;
  const editableContextControls = mode !== "note" && scope === "custom";
  const [codexOptions, setCodexOptions] = useState<CodexOptionsResult | null>(null);
  const contextOptionsForRun = useMemo(
    () => normalizeAiContextOptions({ ...aiContextOptions, selectedNodeIds: multiSelectedNodeIds }),
    [aiContextOptions, multiSelectedNodeIds],
  );
  const codexModelOptions = codexOptions?.models.length
    ? codexOptions.models
    : [
        {
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          defaultReasoningEffort: "medium" as CodexReasoningEffort,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"] as CodexReasoningEffort[],
        },
      ];
  const selectedCodexModel = codexModelOptions.find((option) => option.model === codexSettings.model) ?? codexModelOptions[0];
  const codexEfforts = selectedCodexModel?.supportedReasoningEfforts.length
    ? selectedCodexModel.supportedReasoningEfforts
    : (["low", "medium", "high", "xhigh"] as CodexReasoningEffort[]);
  const selectedClaudePreset = getClaudePresetId(claudeSettings.model, claudeSettings.baseUrl);

  const selectedNodeTitle = selectedNode?.title.trim() || "Mind Atlas";

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearVoiceIdleSchedule();
      clearCommandDraftPersistTimer();
      voiceSessionRef.current?.stop();
      voiceSessionRef.current = null;
      voicePendingTurnRef.current = null;
      dictationRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      dictationStreamRef.current?.getTracks().forEach((track) => track.stop());
      setCommandInputEditing(false);
    };
  }, [setCommandInputEditing]);

  useEffect(() => {
    if (value.trim()) return;
    loadAiDialogSettingsForNode(selectedNodeId);
  }, [loadAiDialogSettingsForNode, selectedNodeId, value]);

  useEffect(() => {
    const resetIfPromptIsEmpty = () => {
      if (value.trim()) return;
      resetAiDialogSettingsToDefaults();
    };
    window.addEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, resetIfPromptIsEmpty);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, resetIfPromptIsEmpty);
  }, [resetAiDialogSettingsToDefaults, value]);

  useEffect(() => {
    setActiveCommandMode(mode);
  }, [mode, setActiveCommandMode]);

  useEffect(() => {
    latestCommandDraftRef.current = { value, mode };
    clearCommandDraftPersistTimer();
    commandDraftPersistTimerRef.current = window.setTimeout(() => {
      commandDraftPersistTimerRef.current = null;
      persistLatestCommandDraft();
    }, 260);
    return clearCommandDraftPersistTimer;
  }, [mode, value]);

  useEffect(() => {
    const persistLatestDraftBeforeSuspend = () => {
      clearCommandDraftPersistTimer();
      persistLatestCommandDraft();
    };

    const suspendTransientInputTimers = () => {
      persistLatestDraftBeforeSuspend();
      clearLongPressTimer();
      clearVoiceIdleTimer();
      pendingVoiceReleaseRef.current = false;
      activeMicPointerIdRef.current = null;
      touchFallbackActiveRef.current = false;
    };

    const resumeTransientInputTimers = () => {
      if (!voiceSessionRef.current || voiceIdleDeadlineAtRef.current === null) return;
      const remainingMs = voiceIdleDeadlineAtRef.current - Date.now();
      if (remainingMs <= 0) {
        void closeIdleVoiceSession();
        return;
      }
      armVoiceIdleTimer(remainingMs);
    };

    const syncTransientInputTimers = () => {
      if (document.visibilityState === "hidden") {
        suspendTransientInputTimers();
        return;
      }
      resumeTransientInputTimers();
    };

    document.addEventListener("visibilitychange", syncTransientInputTimers);
    document.addEventListener("freeze", suspendTransientInputTimers);
    document.addEventListener("resume", resumeTransientInputTimers);
    window.addEventListener("pagehide", suspendTransientInputTimers);
    window.addEventListener("pageshow", resumeTransientInputTimers);
    window.addEventListener("beforeunload", persistLatestDraftBeforeSuspend);
    return () => {
      document.removeEventListener("visibilitychange", syncTransientInputTimers);
      document.removeEventListener("freeze", suspendTransientInputTimers);
      document.removeEventListener("resume", resumeTransientInputTimers);
      window.removeEventListener("pagehide", suspendTransientInputTimers);
      window.removeEventListener("pageshow", resumeTransientInputTimers);
      window.removeEventListener("beforeunload", persistLatestDraftBeforeSuspend);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getCodexOptions()
      .then((options) => {
        if (!alive) return;
        setCodexOptions(options);
        const current = useAtlasStore.getState();
        if (findInheritedAiDialogSettings(current.atlasRoot, current.selectedNodeId)?.codexSettings) return;
        setCodexSettings({
          model: options.defaultModel,
          reasoningEffort: options.defaultReasoningEffort,
          sandbox: options.defaultSandbox,
          fullAccessApproved: options.defaultSandbox === "danger-full-access",
          workspace: options.defaultWorkspace,
          timeoutMs: options.defaultTimeoutMs,
        });
      })
      .catch(() => {
        if (alive) setCodexOptions(null);
      });
    return () => {
      alive = false;
    };
  }, [setCodexSettings]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (mode === "codex" && !codexSettings.workspace.trim()) {
      setVoiceError("Set Codex Work root before sending.");
      return;
    }
    setVoiceError("");
    setValue("");
    if (mode === "note") {
      addQuickChildFromInput(trimmed);
      return;
    }
    if ((mode === "openai" || mode === "local") && isGlobalAiPartnerSurface(atlasRoot, selectedNodeId)) {
      void runTextPartnerTurn(trimmed, mode, contextOptionsForRun);
      return;
    }
    // Node anchored AI requests must create normal request/result nodes with notification pulses.
    // The global AI Partner log path is limited to the root surface to avoid stealing node runs.
    void runAiOnSelectedNode(trimmed, mode, contextOptionsForRun);
  };

  const ensureVoicePartnerSession = async () => {
    if (voiceSessionRef.current) return voiceSessionRef.current;
    try {
      const context = await buildAiNodeContextWithAttachments(atlasRoot, selectedNodeId, contextOptionsForRun);
      if (!context) return null;
      setVoiceError("");
      setVoiceButtonState("voice_connecting");
      const session = await startVoicePartnerSession({
        context,
        instructions: selectedNode?.body,
        model: voicePartnerSettings.realtimeModel,
        voice: voicePartnerSettings.realtimeVoice,
        summary: voiceSessionSummary,
        voiceLogContext: buildVoiceLogContext(voiceLogEntries),
        onStateChange: (state) => {
          setVoiceState(state);
          setVoiceButtonState((current) => {
            if (current === "dictation_recording" || current === "dictation_transcribing") return current;
            if (state === "connecting") return "voice_connecting";
            if (state === "listening") return "voice_ptt";
            if (state === "responding") return "voice_responding";
            return "idle";
          });
          if (state === "closed") {
            voiceSessionRef.current = null;
            voiceSessionIdRef.current = undefined;
          }
        },
        onEvent: handleRealtimeEvent,
      });
      voiceSessionRef.current = session;
      voiceSessionIdRef.current = session.id;
      appendVoiceLogEntry({
        role: "system",
        title: "Voice Partner connected",
        text: "Realtime Voice Partner session started.",
        sessionId: session.id,
      });
      scheduleVoiceIdleTimeout();
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Realtime voice failed.";
      setVoiceState("error");
      setVoiceError(message);
      setVoiceButtonState("idle");
      appendVoiceLogEntry({ role: "error", title: "Voice Partner error", text: message });
      return null;
    }
  };

  const handleRealtimeEvent = (event: RealtimeClientEvent) => {
    if (event.kind === "user_transcript_done") {
      const latest = useAtlasStore.getState();
      voicePendingTurnRef.current = {
        prompt: event.text,
      };
      appendVoiceLogEntry({
        role: "user",
        title: "Spoken input",
        text: event.text,
        sessionId: voiceSessionIdRef.current,
        metadata: {
          activeNodeId: latest.selectedNodeId,
        },
      });
      scheduleVoiceIdleTimeout();
      return;
    }

    if (event.kind === "assistant_delta") {
      assistantBufferRef.current += event.text;
      return;
    }

    if (event.kind === "assistant_done") {
      const text = event.text || assistantBufferRef.current.trim();
      assistantBufferRef.current = "";
      const pendingTurn = voicePendingTurnRef.current;
      voicePendingTurnRef.current = null;
      if (text) {
        appendVoiceLogEntry({
          role: "assistant",
          title: "Voice Partner",
          text,
          sessionId: voiceSessionIdRef.current,
          metadata: {
            provider: "openai",
            model: voicePartnerSettings.realtimeModel,
            prompt: pendingTurn?.prompt,
          },
        });
      }
      scheduleVoiceIdleTimeout();
      return;
    }

    if (event.kind === "summary_done") {
      if (!event.text.trim()) return;
      const summary = {
        text: event.text.trim(),
        createdAt: new Date().toISOString(),
        sessionId: voiceSessionIdRef.current,
      };
      setVoiceSessionSummary(summary);
      appendVoiceLogEntry({
        role: "summary",
        title: "Voice session summary",
        text: summary.text,
        sessionId: summary.sessionId,
      });
      return;
    }

    if (event.kind === "tool_call" || event.kind === "tool_result") {
      scheduleVoiceIdleTimeout();
      return;
    }

    if (event.kind === "error") {
      setVoiceError(event.message);
      setVoiceButtonState("idle");
      appendVoiceLogEntry({
        role: "error",
        title: "Realtime error",
        text: event.message,
        sessionId: voiceSessionIdRef.current,
      });
    }
  };

  const handleMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (activeMicPointerIdRef.current !== null) return;
    activeMicPointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Some mobile browsers can reject capture if the pointer was already canceled.
    }
    beginMicPress();
  };

  const handleMicPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (activeMicPointerIdRef.current !== event.pointerId) return;
    activeMicPointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore capture races on touch browsers
    }
    completeMicPress();
  };

  const handleMicPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (activeMicPointerIdRef.current !== null && activeMicPointerIdRef.current !== event.pointerId) return;
    activeMicPointerIdRef.current = null;
    cancelMicPress();
  };

  const handleMicTouchStart = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (window.PointerEvent) return;
    event.preventDefault();
    if (touchFallbackActiveRef.current || event.touches.length !== 1) return;
    touchFallbackActiveRef.current = true;
    beginMicPress();
  };

  const handleMicTouchEnd = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (window.PointerEvent) return;
    event.preventDefault();
    if (!touchFallbackActiveRef.current) return;
    touchFallbackActiveRef.current = false;
    completeMicPress();
  };

  const handleMicTouchCancel = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (window.PointerEvent) return;
    event.preventDefault();
    if (!touchFallbackActiveRef.current) return;
    touchFallbackActiveRef.current = false;
    cancelMicPress();
  };

  const beginMicPress = () => {
    if (voiceButtonState === "voice_responding" || voiceState === "responding") {
      stopResponsePressRef.current = true;
      stopAssistantResponse();
      return;
    }
    if (voiceButtonState === "dictation_recording") return;
    if (voiceButtonState === "dictation_transcribing" || voiceButtonState === "voice_connecting") return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    pendingVoiceReleaseRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      void beginVoicePartnerTurn();
    }, VOICE_LONG_PRESS_MS);
  };

  const completeMicPress = () => {
    if (stopResponsePressRef.current) {
      stopResponsePressRef.current = false;
      return;
    }
    if (voiceButtonState === "dictation_recording") {
      void stopDictationAndTranscribe();
      return;
    }
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      pendingVoiceReleaseRef.current = true;
      endVoicePartnerTurn();
      return;
    }
    if (voiceButtonState === "idle") {
      void startDictation();
    }
  };

  const cancelMicPress = () => {
    if (stopResponsePressRef.current) {
      stopResponsePressRef.current = false;
      return;
    }
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      pendingVoiceReleaseRef.current = true;
      endVoicePartnerTurn();
    }
  };

  const startDictation = async () => {
    if (!window.isSecureContext) {
      const message = "Microphone access requires HTTPS or localhost. Use a secure origin for mobile LAN dictation.";
      setVoiceError(message);
      appendVoiceLogEntry({ role: "error", title: "Dictation error", text: message });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      const message = "This browser does not support microphone recording.";
      setVoiceError(message);
      appendVoiceLogEntry({ role: "error", title: "Dictation error", text: message });
      return;
    }
    try {
      setVoiceError("");
      dictationChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      dictationStreamRef.current = stream;
      const mimeType = getSupportedDictationMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) dictationChunksRef.current.push(event.data);
      });
      recorder.start(1000);
      dictationRecorderRef.current = recorder;
      setVoiceButtonState("dictation_recording");
      appendVoiceLogEntry({
        role: "system",
        title: "Dictation",
        text: "Dictation recording started.",
        metadata: { mimeType: recorder.mimeType || mimeType || "browser-default" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start dictation.";
      setVoiceError(message);
      setVoiceButtonState("idle");
      appendVoiceLogEntry({ role: "error", title: "Dictation error", text: message });
    }
  };

  const stopDictationAndTranscribe = async () => {
    const recorder = dictationRecorderRef.current;
    if (!recorder) return;
    try {
      setVoiceButtonState("dictation_transcribing");
      const blob = await stopRecorder(recorder, dictationChunksRef.current);
      dictationRecorderRef.current = null;
      dictationStreamRef.current?.getTracks().forEach((track) => track.stop());
      dictationStreamRef.current = null;
      if (!blob.size) throw new Error("No audio was captured.");
      const result = await transcribeAudio(blob, createDictationFileName(blob, Date.now()));
      const transcript = result.text.trim();
      if (!transcript) throw new Error("No transcript was returned.");
      setValue((current) => (current.trim() ? `${current.trimEnd()}\n${transcript}` : transcript));
      appendVoiceLogEntry({
        role: "user",
        title: "Dictation transcript",
        text: transcript,
        metadata: {
          model: result.model,
          durationMs: result.durationMs,
          audioSizeBytes: result.audioSizeBytes ?? blob.size,
          audioMimeType: result.audioMimeType ?? blob.type,
        },
      });
      setVoiceButtonState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dictation failed.";
      setVoiceError(message);
      setVoiceButtonState("idle");
      appendVoiceLogEntry({
        role: "error",
        title: "Dictation error",
        text: message,
        metadata: {
          chunks: dictationChunksRef.current.length,
          audioSizeBytes: dictationChunksRef.current.reduce((total, chunk) => total + chunk.size, 0),
          audioMimeTypes: Array.from(new Set(dictationChunksRef.current.map((chunk) => chunk.type).filter(Boolean))),
        },
      });
    }
  };

  const beginVoicePartnerTurn = async () => {
    const session = await ensureVoicePartnerSession();
    if (!session) return;
    const latest = useAtlasStore.getState();
    const context = await buildAiNodeContextWithAttachments(latest.atlasRoot, latest.selectedNodeId, normalizeAiContextOptions({
      ...latest.aiContextOptions,
      selectedNodeIds: latest.multiSelectedNodeIds,
    }));
    if (context) {
      session.updateContext(context, latest.voiceSessionSummary, buildVoiceLogContext(latest.voiceLogEntries));
    }
    session.beginPushToTalk();
    setVoiceButtonState("voice_ptt");
    if (pendingVoiceReleaseRef.current) {
      endVoicePartnerTurn();
    }
  };

  const endVoicePartnerTurn = () => {
    const session = voiceSessionRef.current;
    if (!session) return;
    session.endPushToTalk();
    setVoiceButtonState("idle");
    scheduleVoiceIdleTimeout();
  };

  const stopAssistantResponse = () => {
    const session = voiceSessionRef.current;
    if (!session) {
      setVoiceButtonState("idle");
      return;
    }
    session.cancelAssistantResponse();
    assistantBufferRef.current = "";
    voicePendingTurnRef.current = null;
    setVoiceState("live");
    setVoiceButtonState("idle");
    appendVoiceLogEntry({
      role: "system",
      title: "Voice Partner response stopped",
      text: "The current Realtime audio response was stopped by the user.",
      sessionId: session.id,
    });
    scheduleVoiceIdleTimeout();
  };

  const scheduleVoiceIdleTimeout = () => {
    if (!voiceSessionRef.current) return;
    voiceIdleDeadlineAtRef.current = Date.now() + VOICE_IDLE_TIMEOUT_MS;
    armVoiceIdleTimer(VOICE_IDLE_TIMEOUT_MS);
  };

  const armVoiceIdleTimer = (delayMs: number) => {
    clearVoiceIdleTimer();
    if (!voiceSessionRef.current) return;
    voiceIdleTimerRef.current = window.setTimeout(() => {
      void closeIdleVoiceSession();
    }, Math.max(0, delayMs));
  };

  const closeIdleVoiceSession = async () => {
    const session = voiceSessionRef.current;
    if (!session) return;
    appendVoiceLogEntry({
      role: "system",
      title: "Voice Partner idle",
      text: "Voice Partner was idle for one hour. Requesting summary before closing.",
      sessionId: session.id,
    });
    try {
      await session.requestSessionSummaryAndClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice summary failed.";
      appendVoiceLogEntry({ role: "error", title: "Voice summary error", text: message, sessionId: session.id });
      session.stop();
    } finally {
      clearVoiceIdleSchedule();
      voiceSessionRef.current = null;
      voiceSessionIdRef.current = undefined;
      setVoiceButtonState("idle");
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const clearCommandDraftPersistTimer = () => {
    if (commandDraftPersistTimerRef.current === null) return;
    window.clearTimeout(commandDraftPersistTimerRef.current);
    commandDraftPersistTimerRef.current = null;
  };

  const persistLatestCommandDraft = () => {
    persistUiStatePatch({ commandDraft: latestCommandDraftRef.current });
  };

  const clearVoiceIdleTimer = () => {
    if (voiceIdleTimerRef.current === null) return;
    window.clearTimeout(voiceIdleTimerRef.current);
    voiceIdleTimerRef.current = null;
  };

  const clearVoiceIdleSchedule = () => {
    clearVoiceIdleTimer();
    voiceIdleDeadlineAtRef.current = null;
  };

  useEffect(() => {
    const handleRestart = () => {
      clearLongPressTimer();
      clearVoiceIdleSchedule();
      pendingVoiceReleaseRef.current = false;
      longPressTriggeredRef.current = false;
      stopResponsePressRef.current = false;
      activeMicPointerIdRef.current = null;
      assistantBufferRef.current = "";
      const session = voiceSessionRef.current;
      session?.stop();
      voiceSessionRef.current = null;
      voiceSessionIdRef.current = undefined;
      setVoiceSessionSummary(null);
      setVoiceState("closed");
      setVoiceButtonState("idle");
      setVoiceError("");
      appendVoiceLogEntry({
        role: "system",
        title: "Voice Partner restarted",
        text: "Realtime Voice Partner context was reset. The next push-to-talk turn starts a fresh session.",
        sessionId: session?.id,
      });
    };
    window.addEventListener(REALTIME_VOICE_RESTART_EVENT, handleRestart);
    return () => window.removeEventListener(REALTIME_VOICE_RESTART_EVENT, handleRestart);
  }, [appendVoiceLogEntry, setVoiceSessionSummary]);

  const voiceIsLive = voiceState === "live" || voiceState === "connecting";
  const micLive = voiceIsLive || voiceState === "listening" || voiceState === "responding" || voiceSessionRef.current !== null;
  const selectedCount = new Set([selectedNodeId, ...multiSelectedNodeIds]).size;
  const contextText =
    mode === "note"
      ? "Note mode / no API"
      : `${scopeLabel(scope)} / ${selectedCount} selected / ${attachmentModeLabel(aiContextOptions.attachmentMode)}`;
  const codexWorkRootMissing = mode === "codex" && !codexSettings.workspace.trim();
  const statusText =
    codexWorkRootMissing
      ? "Codex Work root required"
      : voiceError || (voiceButtonState !== "idle" ? voiceStatusLabel(voiceButtonState) : micLive ? `Voice Partner ${voiceState}` : `${modeLabel(mode)} / ${selectedNode?.status ?? "waiting"}`);

  return (
    <form className="command-dock" onSubmit={handleSubmit} aria-label="Re-instruction input">
      <button
        className={`icon-button ghost ${micLive || voiceButtonState !== "idle" ? "is-live" : ""}`}
        type="button"
        onPointerDown={handleMicPointerDown}
        onPointerUp={handleMicPointerUp}
        onPointerCancel={handleMicPointerCancel}
        onTouchStart={handleMicTouchStart}
        onTouchEnd={handleMicTouchEnd}
        onTouchCancel={handleMicTouchCancel}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={voiceButtonState === "voice_responding" ? "Stop Voice Partner response" : micLive ? "Voice Partner push-to-talk or dictation" : "Start dictation or hold for Voice Partner"}
      >
        {voiceButtonState === "dictation_recording" || voiceButtonState === "voice_responding" ? (
          <Square size={16} />
        ) : voiceButtonState === "voice_ptt" || voiceButtonState === "voice_connecting" ? (
          <AudioLines size={18} />
        ) : (
          <Mic size={18} />
        )}
      </button>
      <div className="mode-switch" aria-label="AI execution mode">
        <ModeButton mode="openai" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="local" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="codex" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="openclaw" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="claude" activeMode={mode} onSelect={setMode} />
        <ModeButton mode="note" activeMode={mode} onSelect={setMode} />
      </div>
      <select
        className="scope-select"
        value={scope}
        onChange={(event) => setAiContextOptions({ scope: event.target.value as AiContextScope })}
        onFocus={() => setCommandInputEditing(true)}
        onBlur={() => setCommandInputEditing(false)}
        disabled={mode === "note"}
        aria-label="AI context scope"
        title="AI context scope"
      >
        <option value="minimal">Active</option>
        <option value="focused">Focused</option>
        <option value="subtree">Subtree</option>
        <option value="neighborhood">Neighborhood</option>
        <option value="selected">Selected</option>
        <option value="custom">Custom</option>
      </select>
      <label className="command-field">
        <span title={`${selectedNodeTitle} / ${contextText}`}>{statusText}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setCommandInputEditing(true)}
          onBlur={() => setCommandInputEditing(false)}
          placeholder={
            mode === "note"
              ? "Create a child node here"
              : mode === "codex"
                ? "Ask Codex from this location"
                : mode === "openclaw"
                  ? "Ask OpenClaw from this location"
                  : "Ask AI from this location"
          }
        />
      </label>
      <button className="send-button" type="submit" aria-label="Send instruction" disabled={!value.trim() || codexWorkRootMissing}>
        <SendHorizonal size={18} />
      </button>
      {editableContextControls ? (
        <div className="context-options-row" aria-label="AI context settings">
          <ContextNumberControl
            label="Parent"
            value={aiContextOptions.ancestorDepth}
            min={0}
            max={12}
            onChange={(ancestorDepth) => setAiContextOptions({ ancestorDepth })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <ContextNumberControl
            label="Child"
            value={aiContextOptions.descendantDepth}
            min={0}
            max={6}
            onChange={(descendantDepth) => setAiContextOptions({ descendantDepth })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <ContextNumberControl
            label="Degree"
            value={aiContextOptions.lateralRadius}
            min={0}
            max={4}
            onChange={(lateralRadius) => setAiContextOptions({ lateralRadius })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <label className="context-option-field">
            <span>Files</span>
            <select
              value={aiContextOptions.attachmentMode}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setAiContextOptions({ attachmentMode: event.target.value as AiAttachmentMode })}
            >
              <option value="metadata">Meta</option>
              <option value="content">Body</option>
            </select>
          </label>
          <ContextNumberControl
            label="Max file count"
            value={aiContextOptions.maxAttachmentCount}
            min={0}
            max={20}
            onChange={(maxAttachmentCount) => setAiContextOptions({ maxAttachmentCount })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <ContextNumberControl
            label="Max MB/file"
            value={Math.round(aiContextOptions.maxAttachmentBytes / 1024 / 1024)}
            min={1}
            max={12}
            onChange={(megabytes) => setAiContextOptions({ maxAttachmentBytes: megabytes * 1024 * 1024 })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
        </div>
      ) : null}
      {mode === "codex" ? (
        <div className="codex-options-row" aria-label="Codex settings">
          <label className="context-option-field">
            <span>Model</span>
            <select
              value={codexSettings.model}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const option = codexModelOptions.find((item) => item.model === event.target.value);
                setCodexSettings({
                  model: event.target.value,
                  reasoningEffort: option?.supportedReasoningEfforts.includes(codexSettings.reasoningEffort)
                    ? codexSettings.reasoningEffort
                    : option?.defaultReasoningEffort ?? "medium",
                });
              }}
            >
              {codexModelOptions.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>Effort</span>
            <select
              value={codexSettings.reasoningEffort}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setCodexSettings({ reasoningEffort: event.target.value as CodexReasoningEffort })}
            >
              {codexEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort === "xhigh" ? "extra high" : effort}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>Sandbox</span>
            <select
              value={codexSettings.sandbox}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const sandbox = event.target.value as CodexSandboxMode;
                setCodexSettings({ sandbox, fullAccessApproved: sandbox === "danger-full-access" });
              }}
            >
              <option value="workspace-write">workspace</option>
              <option value="read-only">read only</option>
              <option value="danger-full-access">trusted</option>
            </select>
          </label>
          <label className="context-option-field codex-workspace-field">
            <span>Work root</span>
            <input
              value={codexSettings.workspace}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                setVoiceError("");
                setCodexSettings({ workspace: event.target.value });
              }}
              placeholder="workspace: from selected node or bridge"
            />
          </label>
          <label className="context-option-field">
            <span>Web search</span>
            <select
              value={codexSettings.webSearch ? "on" : "off"}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setCodexSettings({ webSearch: event.target.value === "on" })}
            >
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </label>
          <label className="context-option-field">
            <span>Thread</span>
            <select
              value={codexSettings.continueMode ?? "auto"}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setCodexSettings({ continueMode: event.target.value as CodexContinueMode, resumeThreadId: "" })}
              title="Auto resumes a Codex thread found on the active node path. New always starts a fresh Codex session."
            >
              <option value="auto">auto</option>
              <option value="new">new</option>
            </select>
          </label>
          <label className="context-option-field codex-check-field" title="Pass --skip-git-repo-check for a non-Git or not-yet-trusted work root. Default is off.">
            <span>Skip Git</span>
            <span className="codex-check-control">
              <input
                type="checkbox"
                checked={codexSettings.skipGitRepoCheck}
                onFocus={() => setCommandInputEditing(true)}
                onBlur={() => setCommandInputEditing(false)}
                onChange={(event) => setCodexSettings({ skipGitRepoCheck: event.target.checked })}
              />
            </span>
          </label>
          <ContextNumberControl
            label="Timeout (min)"
            value={Math.round(codexSettings.timeoutMs / 60000)}
            min={1}
            max={120}
            onChange={(minutes) => setCodexSettings({ timeoutMs: minutes * 60000 })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
        </div>
      ) : null}
      {mode === "openclaw" ? (
        <div className="codex-options-row openclaw-options-row" aria-label="OpenClaw settings">
          <label className="context-option-field">
            <span>Model</span>
            <input
              value={openClawSettings.model}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setOpenClawSettings({ model: event.target.value })}
              placeholder="OpenClaw default"
            />
          </label>
          <label className="context-option-field">
            <span>Agent</span>
            <input
              value={openClawSettings.agent}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setOpenClawSettings({ agent: event.target.value })}
              placeholder="default"
            />
          </label>
          <label className="context-option-field codex-workspace-field">
            <span>Work root</span>
            <input
              value={openClawSettings.workspace}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setOpenClawSettings({ workspace: event.target.value })}
              placeholder="optional project path"
            />
          </label>
          <label className="context-option-field">
            <span>Session</span>
            <select
              value={openClawSettings.continueMode ?? "auto"}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setOpenClawSettings({ continueMode: event.target.value as CodexContinueMode, resumeSessionKey: "" })}
              title="Auto resumes an OpenClaw session key found on the active node path. New starts a fresh OpenClaw session."
            >
              <option value="auto">auto</option>
              <option value="new">new</option>
            </select>
          </label>
          <ContextNumberControl
            label="Timeout (min)"
            value={Math.round(openClawSettings.timeoutMs / 60000)}
            min={1}
            max={120}
            onChange={(minutes) => setOpenClawSettings({ timeoutMs: minutes * 60000 })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
        </div>
      ) : null}
      {mode === "claude" ? (
        <div className="codex-options-row claude-options-row" aria-label="Claude Code settings">
          <label className="context-option-field">
            <span>Preset</span>
            <select
              value={selectedClaudePreset}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const preset = CLAUDE_MODEL_PRESETS.find((item) => item.id === event.target.value);
                if (preset) setClaudeSettings({ model: preset.model, baseUrl: preset.baseUrl });
              }}
              title="Claude Code provider and model preset"
            >
              {CLAUDE_MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="context-option-field">
            <span>Model</span>
            <input
              value={claudeSettings.model}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ model: event.target.value })}
              placeholder="bridge env or deepseek-v4-pro[1m]"
            />
          </label>
          <label className="context-option-field">
            <span>Base URL</span>
            <input
              value={claudeSettings.baseUrl}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ baseUrl: event.target.value })}
              placeholder="bridge env or DeepSeek Anthropic URL"
            />
          </label>
          <label className="context-option-field codex-workspace-field">
            <span>Work root</span>
            <input
              value={claudeSettings.workspace}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ workspace: event.target.value })}
              placeholder="optional project path"
            />
          </label>
          <ContextNumberControl
            label="Timeout (min)"
            value={Math.round(claudeSettings.timeoutMs / 60000)}
            min={1}
            max={120}
            onChange={(minutes) => setClaudeSettings({ timeoutMs: minutes * 60000 })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
        </div>
      ) : null}
    </form>
  );
}

function ContextNumberControl({
  label,
  value,
  min,
  max,
  onChange,
  onFocus,
  onBlur,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <label className="context-option-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

function getSupportedDictationMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function createDictationFileName(blob: Blob, timestamp: number) {
  const mimeType = blob.type.split(";")[0].trim().toLowerCase();
  const extension = mimeType === "audio/mp4" ? "mp4" : mimeType === "audio/ogg" ? "ogg" : "webm";
  return `mind-atlas-dictation-${timestamp}.${extension}`;
}

function stopRecorder(recorder: MediaRecorder, chunks: Blob[]) {
  return new Promise<Blob>((resolve, reject) => {
    const finalChunks = [...chunks];
    const mimeType = recorder.mimeType || finalChunks.find((chunk) => chunk.type)?.type || "audio/webm";
    const handleData = (event: BlobEvent) => {
      if (event.data.size > 0) finalChunks.push(event.data);
    };
    const cleanup = () => {
      recorder.removeEventListener("dataavailable", handleData);
      recorder.removeEventListener("error", handleError);
    };
    const handleError = (event: Event) => {
      cleanup();
      reject(new Error(event instanceof ErrorEvent ? event.message : "Audio recording failed."));
    };
    recorder.addEventListener(
      "dataavailable",
      handleData,
    );
    recorder.addEventListener(
      "stop",
      () => {
        cleanup();
        resolve(new Blob(finalChunks, { type: mimeType }));
      },
      { once: true },
    );
    recorder.addEventListener("error", handleError, { once: true });
    if (recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    } else {
      cleanup();
      resolve(new Blob(finalChunks, { type: mimeType }));
    }
  });
}

function voiceStatusLabel(state: VoiceButtonState) {
  switch (state) {
    case "dictation_recording":
      return "Dictation recording";
    case "dictation_transcribing":
      return "Transcribing";
    case "voice_connecting":
      return "Voice Partner connecting";
    case "voice_ptt":
      return "Voice Partner listening";
    case "voice_responding":
      return "Voice Partner responding";
    case "idle":
      return "Voice ready";
  }
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
  const Icon = mode === "openai" ? Bot : mode === "local" ? HardDrive : mode === "codex" ? Code2 : mode === "openclaw" ? Terminal : mode === "claude" ? Bot : PenLine;
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
    case "openclaw":
      return "OpenClaw";
    case "claude":
      return "Claude Code";
    case "note":
      return "Note";
  }
}

function getClaudePresetId(model: string, baseUrl: string) {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return CLAUDE_MODEL_PRESETS.find((preset) => preset.model === normalizedModel && preset.baseUrl === normalizedBaseUrl)?.id ?? "custom";
}

function isCommandMode(value: unknown): value is CommandMode {
  return value === "openai" || value === "local" || value === "codex" || value === "openclaw" || value === "claude" || value === "note";
}

function isGlobalAiPartnerSurface(atlasRoot: ReturnType<typeof useAtlasStore.getState>["atlasRoot"], selectedNodeId: string) {
  return selectedNodeId === atlasRoot.id;
}

function scopeLabel(scope: AiContextScope) {
  switch (scope) {
    case "minimal":
      return "Active";
    case "focused":
      return "Focused";
    case "subtree":
      return "Subtree";
    case "neighborhood":
      return "Neighborhood";
    case "selected":
      return "Selected";
    case "custom":
      return "Custom";
  }
}

function attachmentModeLabel(mode: AiAttachmentMode) {
  return mode === "content" ? "file bodies" : "file metadata";
}

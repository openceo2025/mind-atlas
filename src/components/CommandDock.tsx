import { AudioLines, Bot, Code2, Mic, PenLine, SendHorizonal, Square, Terminal } from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribeAudio } from "../ai/audioTranscriptionClient";
import { getChatOptions, getCodexOptions, getOpenClawOptions } from "../ai/bridgeClient";
import { runOpenClawPartnerTurn } from "../ai/openClawPartnerClient";
import { startVoicePartnerSession, type RealtimeClientEvent, type RealtimeVoiceSession, type RealtimeSessionState } from "../ai/realtimeClient";
import { runTextPartnerTurn } from "../ai/textPartnerClient";
import { buildVoiceLogContext } from "../ai/voiceLogContext";
import { CONTEXT_BUDGET_PRESETS, buildContextPlan } from "../context/contextEngine";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT } from "../events";
import { isHostedServiceMode } from "../hosted/serviceClient";
import { buildAiNodeContextWithAttachments, findInheritedAiDialogSettings, findNode, normalizeAiContextOptions, useAtlasStore } from "../store/atlasStore";
import { clearPersistedCommandDraft, loadPersistedUiState, persistUiStatePatch } from "../uiPersistence";
import { ProviderUsagePanel } from "./ProviderUsagePanel";
import type {
  AiContextScope,
  AiExecutionMode,
  ChatOptionsResult,
  ChatReasoningEffort,
  ChatServiceId,
  ClaudePermissionMode,
  ClaudeReasoningEffort,
  CodexOptionsResult,
  CodexReasoningEffort,
  CodexSandboxMode,
  OpenClawOptionsResult,
} from "../types";

type CommandMode = AiExecutionMode | "note";
type AgentExecutionMode = Extract<AiExecutionMode, "codex" | "claude">;
type VoiceButtonState = "idle" | "dictation_recording" | "dictation_transcribing" | "voice_connecting" | "voice_ptt" | "voice_responding";

const VOICE_LONG_PRESS_MS = 460;
const DEFAULT_VOICE_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const VOICE_IDLE_TIMEOUT_MS = readVoiceIdleTimeoutMs();
const CHAT_OPTIONS_REFRESH_MS = 5 * 60 * 1000;
const CLAUDE_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const CLAUDE_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
const CLAUDE_MODEL_PRESETS = [
  { id: "bridge", label: "Bridge env", model: "", baseUrl: "" },
  { id: "opus-4-8", label: "Claude Opus 4.8", model: "claude-opus-4-8", baseUrl: CLAUDE_ANTHROPIC_BASE_URL },
  { id: "fable-5", label: "Claude Fable 5", model: "claude-fable-5", baseUrl: CLAUDE_ANTHROPIC_BASE_URL },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", model: "deepseek-v4-pro[1m]", baseUrl: CLAUDE_DEEPSEEK_BASE_URL },
] as const;
const CLAUDE_REASONING_EFFORTS: ClaudeReasoningEffort[] = ["default", "low", "medium", "high", "xhigh", "max"];
const CLAUDE_PERMISSION_MODES: ClaudePermissionMode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
const PUBLIC_SERVICE_MODE = isHostedServiceMode();

export function CommandDock() {
  const [persistedCommandDraft] = useState(() => loadPersistedUiState()?.commandDraft ?? null);
  const [value, setValue] = useState(() => persistedCommandDraft?.value ?? "");
  const [mode, setMode] = useState<CommandMode>(() => initialCommandMode(persistedCommandDraft?.mode));
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
  const chatSettings = useAtlasStore((state) => state.chatSettings);
  const setChatSettings = useAtlasStore((state) => state.setChatSettings);
  const codexSettings = useAtlasStore((state) => state.codexSettings);
  const setCodexSettings = useAtlasStore((state) => state.setCodexSettings);
  const openClawSettings = useAtlasStore((state) => state.openClawSettings);
  const setOpenClawSettings = useAtlasStore((state) => state.setOpenClawSettings);
  const claudeSettings = useAtlasStore((state) => state.claudeSettings);
  const setClaudeSettings = useAtlasStore((state) => state.setClaudeSettings);
  const unreadNotifications = useAtlasStore((state) => state.unreadNotifications);
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
  const forceNewAgentSession = useAtlasStore((state) => state.forceNewAgentSession);
  const requestNewAgentSession = useAtlasStore((state) => state.requestNewAgentSession);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const effectiveAiContextOptions = PUBLIC_SERVICE_MODE
    ? { ...aiContextOptions, scope: "path-children" as AiContextScope }
    : aiContextOptions;
  const [codexOptions, setCodexOptions] = useState<CodexOptionsResult | null>(null);
  const [chatOptions, setChatOptions] = useState<ChatOptionsResult | null>(null);
  const [openClawOptions, setOpenClawOptions] = useState<OpenClawOptionsResult | null>(null);
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const contextOptionsForRun = useMemo(
    () => normalizeAiContextOptions({ ...effectiveAiContextOptions, selectedNodeIds: multiSelectedNodeIds }),
    [effectiveAiContextOptions, multiSelectedNodeIds],
  );
  // Auto context: what will actually be sent for the current node + mode.
  // The user inspects it on demand instead of choosing a scope up front.
  const contextPlan = useMemo(() => {
    if (mode === "note") return null;
    const budget =
      mode === "codex" || mode === "claude" || mode === "openclaw"
        ? CONTEXT_BUDGET_PRESETS.agent
        : mode === "local" || (mode !== "openai" && chatSettings.service === "local")
          ? CONTEXT_BUDGET_PRESETS.local
          : CONTEXT_BUDGET_PRESETS.chat;
    return buildContextPlan(atlasRoot, selectedNodeId, { ...budget, pinnedNodeIds: multiSelectedNodeIds });
  }, [atlasRoot, selectedNodeId, multiSelectedNodeIds, mode, chatSettings.service]);
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
  const fallbackServices = fallbackChatServices();
  const rawChatServiceOptions = chatOptions?.services.length ? chatOptions.services : fallbackServices;
  const chatServiceOptions = visibleChatServices(rawChatServiceOptions);
  const selectedChatService = chatServiceOptions.find((service) => service.id === chatSettings.service) ?? chatServiceOptions[0] ?? fallbackServices[0];
  const chatModelOptions = selectedChatService?.models.length
    ? selectedChatService.models
    : fallbackChatModelOptions(selectedChatService?.defaultModel ?? chatSettings.model);
  const selectedChatModel = chatModelOptions.find((option) => option.model === chatSettings.model) ?? chatModelOptions[0];
  const chatEfforts = selectedChatModel?.supportedReasoningEfforts.length
    ? selectedChatModel.supportedReasoningEfforts
    : selectedChatService?.supportedReasoningEfforts.length
      ? selectedChatService.supportedReasoningEfforts
      : (["default"] as ChatReasoningEffort[]);
  const selectedClaudePreset = getClaudePresetId(claudeSettings.model, claudeSettings.baseUrl);
  const openClawModelOptions = openClawOptions?.models.length
    ? openClawOptions.models
    : [{ model: "", displayName: "OpenClaw default" }];

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
    if (PUBLIC_SERVICE_MODE && mode !== "chat") setMode("chat");
  }, [mode]);

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

  const refreshChatOptions = useCallback(async (shouldApply: () => boolean = () => true) => {
    const options = await getChatOptions();
    if (!shouldApply()) return;
    setChatOptions(options);
    const current = useAtlasStore.getState();
    if (findInheritedAiDialogSettings(current.atlasRoot, current.selectedNodeId)?.chatSettings) return;
    const services = visibleChatServices(options.services);
    const service = services.find((item) => item.id === current.chatSettings.service) ?? services.find((item) => item.id === options.defaultService) ?? services[0];
    if (!service) return;
    const currentModelStillAvailable = service.models.some((item) => item.model === current.chatSettings.model);
    const model = currentModelStillAvailable ? current.chatSettings.model : service.defaultModel || service.models[0]?.model || "";
    const effort = service.models.find((item) => item.model === model)?.defaultReasoningEffort ?? service.defaultReasoningEffort;
    setChatSettings({
      service: service.id,
      model,
      reasoningEffort: effort,
    });
  }, [setChatSettings]);

  useEffect(() => {
    let alive = true;
    const refreshIfAlive = () => {
      void refreshChatOptions(() => alive).catch(() => {
        if (alive) setChatOptions(null);
      });
    };
    refreshIfAlive();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") refreshIfAlive();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("pageshow", refreshIfAlive);
    const chatOptionsTimer = PUBLIC_SERVICE_MODE ? window.setInterval(refreshIfAlive, CHAT_OPTIONS_REFRESH_MS) : null;
    if (!PUBLIC_SERVICE_MODE) {
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
      void getOpenClawOptions()
        .then((options) => {
          if (!alive) return;
          setOpenClawOptions(options);
        })
        .catch(() => {
          if (alive) setOpenClawOptions(null);
        });
    }
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("pageshow", refreshIfAlive);
      if (chatOptionsTimer !== null) window.clearInterval(chatOptionsTimer);
    };
  }, [refreshChatOptions, setCodexSettings]);

  useEffect(() => {
    if (!openClawOptions?.models.length) return;
    if (openClawOptions.models.some((option) => option.model === openClawSettings.model)) return;
    setOpenClawSettings({ model: openClawOptions.defaultModel || openClawOptions.models[0].model });
  }, [openClawOptions, openClawSettings.model, setOpenClawSettings]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (mode === "codex" && !codexSettings.workspace.trim()) {
      setVoiceError("Set Codex Work root before sending.");
      return;
    }
    setVoiceError("");
    clearCommandDraftPersistTimer();
    latestCommandDraftRef.current = { value: "", mode };
    setValue("");
    clearPersistedCommandDraft();
    if (mode === "note") {
      addQuickChildFromInput(trimmed);
      return;
    }
    if (isChatCommandMode(mode)) {
      void runTextPartnerTurn(trimmed, chatSettingsForCommandMode(chatSettings, mode));
      return;
    }
    if (mode === "openclaw" && selectedNodeId === atlasRoot.id) {
      void runOpenClawPartnerTurn(trimmed, openClawSettings);
      return;
    }
    // Agent CLI requests stay on the node-anchored path and do not receive Mind Atlas tool access.
    void runAiOnSelectedNode(trimmed, isChatCommandMode(mode) ? (mode === "openai" || mode === "local" ? mode : "chat") : mode, contextOptionsForRun);
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
        notificationSummary: buildVoiceNotificationSummary(atlasRoot, unreadNotifications),
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
            usage: event.usage,
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
        metadata: {
          provider: "openai",
          model: voicePartnerSettings.realtimeModel,
          usage: event.usage,
        },
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
      session.updateContext(context, latest.voiceSessionSummary, buildVoiceLogContext(latest.voiceLogEntries), buildVoiceNotificationSummary(latest.atlasRoot, latest.unreadNotifications));
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
      : contextPlan
        ? `Auto context ~${formatTokenEstimate(contextPlan.stats.estimatedTokens)} tokens / ${contextPlan.stats.conversationTurnCount} turns / ${selectedCount} selected`
        : "Auto context";
  const codexWorkRootMissing = mode === "codex" && !codexSettings.workspace.trim();
  const statusText =
    codexWorkRootMissing
      ? "Codex Work root required"
      : voiceError || (voiceButtonState !== "idle" ? voiceStatusLabel(voiceButtonState) : micLive ? `Voice Partner ${voiceState}` : PUBLIC_SERVICE_MODE ? `AI / ${selectedNode?.status ?? "waiting"}` : `${modeLabel(mode)} / ${selectedNode?.status ?? "waiting"}`);

  return (
    <form className={`command-dock ${PUBLIC_SERVICE_MODE ? "is-public-service" : ""}`} onSubmit={handleSubmit} aria-label="Re-instruction input">
      {PUBLIC_SERVICE_MODE ? (
        <div className="panel-role-label ai-panel-role" aria-hidden="true">
          <Bot size={14} />
          <span>AI</span>
        </div>
      ) : null}
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
      {!PUBLIC_SERVICE_MODE ? (
        <>
          <div className="mode-switch" aria-label="AI execution mode">
            <ModeButton mode="chat" activeMode={mode} onSelect={setMode} />
            <CodeModeButton activeMode={mode} onSelect={setMode} />
            <ModeButton mode="openclaw" activeMode={mode} onSelect={setMode} />
            <ModeButton mode="note" activeMode={mode} onSelect={setMode} />
          </div>
          <button
            type="button"
            className="scope-select context-chip"
            onClick={() => setContextPreviewOpen(true)}
            disabled={mode === "note" || !contextPlan}
            aria-label="Preview the auto-assembled AI context"
            title={`${contextText}. Click to preview exactly what will be sent.`}
          >
            {contextPlan ? `~${formatTokenEstimate(contextPlan.stats.estimatedTokens)} tok` : "ctx"}
          </button>
        </>
      ) : null}
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
                  : mode === "claude"
                    ? "Ask Claude Code from this location"
                    : mode === "chat"
                      ? "Chat from this location"
                  : "Ask AI from this location"
          }
        />
      </label>
      <button className="send-button" type="submit" aria-label="Send instruction" disabled={!value.trim() || codexWorkRootMissing}>
        <SendHorizonal size={18} />
      </button>
      {contextPreviewOpen && contextPlan ? (
        <div className="context-preview-overlay" onClick={() => setContextPreviewOpen(false)}>
          <div className="context-preview-panel" role="dialog" aria-label="AI context preview" onClick={(event) => event.stopPropagation()}>
            <div className="context-preview-header">
              <strong>Auto context preview</strong>
              <span>
                {`~${contextPlan.stats.estimatedTokens.toLocaleString()} tokens / ${contextPlan.stats.includedNodeCount} nodes / ${contextPlan.stats.conversationTurnCount} conversation turns${contextPlan.stats.droppedTurnCount ? ` (${contextPlan.stats.droppedTurnCount} summarized)` : ""}${contextPlan.stats.truncated ? " / trimmed to budget" : ""}`}
              </span>
              <button type="button" className="icon-button ghost" onClick={() => setContextPreviewOpen(false)} aria-label="Close context preview">
                ×
              </button>
            </div>
            <div className="context-preview-body">
              {contextPlan.conversation.length ? (
                <>
                  <h4>Conversation replay (this branch)</h4>
                  {contextPlan.conversation.map((message, index) => (
                    <pre key={index} className={`context-preview-turn is-${message.role}`}>
                      {`${message.role === "user" ? "User" : "Assistant"}:\n${message.content}`}
                    </pre>
                  ))}
                </>
              ) : null}
              <h4>Notebook context</h4>
              <pre>{contextPlan.contextText}</pre>
            </div>
          </div>
        </div>
      ) : null}
      {mode === "chat" ? (
        <div className="codex-options-row chat-options-row" aria-label="Chat settings">
          <label className="context-option-field">
            <span>Service</span>
            <select
              value={chatSettings.service}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const service = chatServiceOptions.find((item) => item.id === event.target.value) ?? chatServiceOptions[0];
                if (!service) return;
                const model = service.defaultModel || service.models[0]?.model || "";
                const effort = service.models.find((item) => item.model === model)?.defaultReasoningEffort ?? service.defaultReasoningEffort;
                setChatSettings({ service: service.id, model, reasoningEffort: effort });
              }}
            >
              {chatServiceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.label}{service.configured ? "" : " (not configured)"}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>Model</span>
            <select
              value={selectedChatModel?.model ?? chatSettings.model}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const option = chatModelOptions.find((item) => item.model === event.target.value);
                setChatSettings({
                  model: event.target.value,
                  reasoningEffort: option?.supportedReasoningEfforts.includes(chatSettings.reasoningEffort)
                    ? chatSettings.reasoningEffort
                    : option?.defaultReasoningEffort ?? selectedChatService.defaultReasoningEffort,
                });
              }}
            >
              {chatModelOptions.map((option) => (
                <option key={`${selectedChatService.id}-${option.model || "default"}`} value={option.model}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
          {chatEfforts.length > 1 ? (
            <label className="context-option-field">
              <span>Effort</span>
              <select
                value={chatEfforts.includes(chatSettings.reasoningEffort) ? chatSettings.reasoningEffort : selectedChatModel?.defaultReasoningEffort ?? "default"}
                onFocus={() => setCommandInputEditing(true)}
                onBlur={() => setCommandInputEditing(false)}
                onChange={(event) => setChatSettings({ reasoningEffort: event.target.value as ChatReasoningEffort })}
              >
                {chatEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {chatEffortLabel(effort)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {isAgentCommandMode(mode) ? (
        <div className={`codex-options-row code-options-row ${mode === "claude" ? "claude-options-row" : ""}`} aria-label="Code settings">
          <label className="context-option-field">
            <span>Code</span>
            <select
              value={mode}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                setVoiceError("");
                setMode(event.target.value as AgentExecutionMode);
              }}
              title="Choose the code backend for this node-anchored run."
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          {mode === "codex" ? (
            <>
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
          <AgentSessionControl
            forceNew={forceNewAgentSession}
            onChange={requestNewAgentSession}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
            </>
          ) : (
            <>
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
            <span>Effort</span>
            <select
              value={claudeSettings.reasoningEffort}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ reasoningEffort: event.target.value as ClaudeReasoningEffort })}
              title="Claude Code --effort. Leave default to let the bridge and CLI decide."
            >
              {CLAUDE_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {claudeEffortLabel(effort)}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>Permission</span>
            <select
              value={claudeSettings.permissionMode}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ permissionMode: event.target.value as ClaudePermissionMode })}
              title="Claude Code --permission-mode. This is not the same as Codex OS sandboxing."
            >
              {CLAUDE_PERMISSION_MODES.map((permissionMode) => (
                <option key={permissionMode} value={permissionMode}>
                  {claudePermissionLabel(permissionMode)}
                </option>
              ))}
            </select>
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
          <AgentSessionControl
            forceNew={forceNewAgentSession}
            onChange={requestNewAgentSession}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <ContextNumberControl
            className="claude-timeout-field"
            label="Timeout (min)"
            value={Math.round(claudeSettings.timeoutMs / 60000)}
            min={1}
            max={120}
            onChange={(minutes) => setClaudeSettings({ timeoutMs: minutes * 60000 })}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
            </>
          )}
        </div>
      ) : null}
      {mode === "openclaw" ? (
        <div className="codex-options-row openclaw-options-row" aria-label="OpenClaw settings">
          <label className="context-option-field">
            <span>Model</span>
            <select
              aria-label="OpenClaw model"
              value={openClawSettings.model}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setOpenClawSettings({ model: event.target.value })}
            >
              {openClawModelOptions.map((option) => (
                <option key={option.model || "openclaw-default"} value={option.model}>
                  {openClawModelLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <AgentSessionControl
            forceNew={forceNewAgentSession}
            onChange={requestNewAgentSession}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
          <ContextNumberControl
            className="openclaw-timeout-field"
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
      {mode !== "note" && !PUBLIC_SERVICE_MODE ? <ProviderUsagePanel /> : null}
    </form>
  );
}

function ContextNumberControl({
  className,
  label,
  value,
  min,
  max,
  onChange,
  onFocus,
  onBlur,
}: {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <label className={["context-option-field", className].filter(Boolean).join(" ")}>
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

function AgentSessionControl({
  forceNew,
  onChange,
  onFocus,
  onBlur,
}: {
  forceNew: boolean;
  onChange: (forceNew: boolean) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <label className="context-option-field">
      <span>Session</span>
      <select
        value={forceNew ? "new" : "auto"}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value === "new")}
        title="Auto continues or forks the agent session recorded on this branch. New forces a fresh session for the next run only."
      >
        <option value="auto">auto</option>
        <option value="new">new</option>
      </select>
    </label>
  );
}

function formatTokenEstimate(tokens: number) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function openClawModelLabel(option: OpenClawOptionsResult["models"][number]) {
  if (!option.model) return option.displayName;
  return option.displayName === option.model ? option.model : `${option.displayName} (${option.model})`;
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
  const Icon = mode === "chat" || mode === "openai" ? Bot : mode === "codex" ? Code2 : mode === "openclaw" ? Terminal : mode === "claude" ? Bot : PenLine;
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

function CodeModeButton({
  activeMode,
  onSelect,
}: {
  activeMode: CommandMode;
  onSelect: (mode: CommandMode) => void;
}) {
  const active = isAgentCommandMode(activeMode);
  const label = active ? `Code: ${modeLabel(activeMode)}` : "Code";
  return (
    <button
      className={active ? "is-active" : ""}
      type="button"
      onClick={() => onSelect(active ? activeMode : "codex")}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      <Code2 size={14} />
      <span>Code</span>
    </button>
  );
}

function modeLabel(mode: CommandMode) {
  switch (mode) {
    case "chat":
      return "Chat";
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

function readVoiceIdleTimeoutMs() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const raw = env?.VITE_MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_VOICE_IDLE_TIMEOUT_MS;
  return Math.min(24 * 60 * 60 * 1000, Math.max(10_000, Math.trunc(value)));
}

function initialCommandMode(value: unknown): CommandMode {
  if (value === "openai" || value === "local") return "chat";
  return isCommandMode(value) ? value : "chat";
}

function isChatCommandMode(mode: CommandMode): mode is Extract<CommandMode, "chat" | "openai" | "local"> {
  return mode === "chat" || mode === "openai" || mode === "local";
}

function isAgentCommandMode(mode: CommandMode): mode is AgentExecutionMode {
  return mode === "codex" || mode === "claude";
}

function chatSettingsForCommandMode(settings: ReturnType<typeof useAtlasStore.getState>["chatSettings"], mode: CommandMode) {
  if (mode === "local") return { ...settings, service: "local" as ChatServiceId, model: "" };
  if (mode === "openai") return { ...settings, service: "openai" as ChatServiceId };
  return settings;
}

function buildVoiceNotificationSummary(
  atlasRoot: ReturnType<typeof useAtlasStore.getState>["atlasRoot"],
  unreadNotifications: ReturnType<typeof useAtlasStore.getState>["unreadNotifications"],
) {
  const notifications = Object.values(unreadNotifications);
  if (!notifications.length) return "No unread notifications.";
  return notifications
    .slice(0, 8)
    .map((notification) => {
      const node = findNode(atlasRoot, notification.nodeId);
      const title = node?.title || notification.title;
      const detail = node?.summary || node?.nextDecision || notification.title;
      return `${notification.kind}: ${title} - ${detail}`;
    })
    .join("\n");
}

function fallbackChatServices(): ChatOptionsResult["services"] {
  return [
    {
      id: "openai",
      label: "OpenAI",
      configured: true,
      defaultModel: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["default", "minimal", "low", "medium", "high", "xhigh"],
      models: fallbackChatModelOptions(""),
    },
    {
      id: "anthropic",
      label: "Opus",
      configured: false,
      defaultModel: "claude-opus-4-8",
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: ["default"],
      models: fallbackChatModelOptions("claude-opus-4-8"),
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      configured: false,
      defaultModel: "deepseek-v4-pro[1m]",
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: ["default"],
      models: fallbackChatModelOptions("deepseek-v4-pro[1m]"),
    },
    {
      id: "local",
      label: "Local",
      configured: true,
      defaultModel: "",
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: ["default"],
      models: [{ model: "", displayName: "Loaded local model", defaultReasoningEffort: "default", supportedReasoningEfforts: ["default"] }],
    },
  ];
}

function visibleChatServices(services: ChatOptionsResult["services"]) {
  if (!PUBLIC_SERVICE_MODE) return services;
  const configured = services.filter((service) => service.configured);
  return configured.length ? configured : services;
}

function fallbackChatModelOptions(model: string): ChatOptionsResult["services"][number]["models"] {
  return [
    {
      model,
      displayName: model || "Bridge default",
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: ["default"],
    },
  ];
}

function chatEffortLabel(effort: ChatReasoningEffort) {
  if (effort === "default") return "provider default";
  if (effort === "none") return "none";
  if (effort === "xhigh") return "extra high";
  return effort;
}

function claudeEffortLabel(effort: ClaudeReasoningEffort) {
  if (effort === "default") return "default";
  if (effort === "xhigh") return "extra high";
  return effort;
}

function claudePermissionLabel(permissionMode: ClaudePermissionMode) {
  switch (permissionMode) {
    case "default":
      return "default";
    case "acceptEdits":
      return "accept edits";
    case "plan":
      return "plan";
    case "auto":
      return "auto";
    case "dontAsk":
      return "don't ask";
    case "bypassPermissions":
      return "trusted";
  }
}

function getClaudePresetId(model: string, baseUrl: string) {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return CLAUDE_MODEL_PRESETS.find((preset) => preset.model === normalizedModel && preset.baseUrl === normalizedBaseUrl)?.id ?? "custom";
}

function isCommandMode(value: unknown): value is CommandMode {
  return value === "chat" || value === "openai" || value === "local" || value === "codex" || value === "openclaw" || value === "claude" || value === "note";
}

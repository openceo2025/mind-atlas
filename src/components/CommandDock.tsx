import { AudioLines, Bot, Code2, Mic, PenLine, RotateCcw, SendHorizonal, Square, Terminal } from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribeAudio } from "../ai/audioTranscriptionClient";
import { getChatOptions, getCodexOptions, getOpenClawOptions } from "../ai/bridgeClient";
import { runOpenClawPartnerTurn } from "../ai/openClawPartnerClient";
import { startVoicePartnerSession, type RealtimeClientEvent, type RealtimeVoiceSession, type RealtimeSessionState } from "../ai/realtimeClient";
import { runTextPartnerTurn } from "../ai/textPartnerClient";
import { buildVoiceLogContext } from "../ai/voiceLogContext";
import { getAboutDemoChatOptions, readAboutDemoConfig } from "../aboutDemo";
import { getAgentCapabilities, inspectAgentWorkspace, type AgentWorkspaceInfo } from "../agentRuntime/runtimeClient";
import type { AgentCapabilitiesResult } from "../agentRuntime/types";
import { CONTEXT_BUDGET_PRESETS, buildContextPlan } from "../context/contextEngine";
import { REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT } from "../events";
import { isHostedServiceMode } from "../hosted/serviceClient";
import {
  buildAiNodeContextWithAttachments,
  findInheritedAgentWorkspaceBinding,
  findInheritedAiDialogSettings,
  findNode,
  normalizeAiContextOptions,
  useAtlasStore,
} from "../store/atlasStore";
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
  CodeModelDiscoveryState,
  CodexOptionsResult,
  CodexReasoningEffort,
  CodexSandboxMode,
  OpenClawOptionsResult,
} from "../types";
import { I18nText, useMindAtlasLocale } from "../i18n/I18nProvider";
import { formatAppMessage } from "../i18n/format";
import { currentAppLocale } from "../i18n/locales";

type CommandMode = AiExecutionMode | "note";
type AgentExecutionMode = Extract<AiExecutionMode, "codex" | "claude">;
type CodeBackendSelection = "codex" | "claude-api" | "claude-subscription";
type VoiceButtonState = "idle" | "dictation_recording" | "dictation_transcribing" | "voice_connecting" | "voice_ptt" | "voice_responding";

const VOICE_LONG_PRESS_MS = 460;
const DEFAULT_VOICE_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const VOICE_IDLE_TIMEOUT_MS = readVoiceIdleTimeoutMs();
const CHAT_OPTIONS_REFRESH_MS = 5 * 60 * 1000;
const CODE_MODEL_REFRESH_MS: Record<CodeBackendSelection, number> = {
  codex: 10 * 60 * 1000,
  "claude-api": 30 * 60 * 1000,
  "claude-subscription": 5 * 60 * 1000,
};
type ClaudeModelPreset = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  supportedReasoningEfforts?: ClaudeReasoningEffort[];
  defaultReasoningEffort?: ClaudeReasoningEffort;
  vendor: "anthropic" | "deepseek" | "subscription";
};
const CLAUDE_REASONING_EFFORTS: ClaudeReasoningEffort[] = ["default", "low", "medium", "high", "xhigh", "max"];
const CLAUDE_PERMISSION_MODES: ClaudePermissionMode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
const PUBLIC_SERVICE_MODE = isHostedServiceMode();

export function CommandDock() {
  const { locale } = useMindAtlasLocale();
  const aboutDemoConfig = useMemo(() => readAboutDemoConfig(), []);
  const aboutDemoChatOptions = useMemo(() => (aboutDemoConfig?.kind === "app" ? getAboutDemoChatOptions(locale) : null), [aboutDemoConfig, locale]);
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
  const recordAiSubmissionError = useAtlasStore((state) => state.recordAiSubmissionError);
  const addQuickChildFromInput = useAtlasStore((state) => state.addQuickChildFromInput);
  const setNodeStatus = useAtlasStore((state) => state.setNodeStatus);
  const forceNewAgentSession = useAtlasStore((state) => state.forceNewAgentSession);
  const requestNewAgentSession = useAtlasStore((state) => state.requestNewAgentSession);
  const bindAgentWorkspaceToSelectedNode = useAtlasStore((state) => state.bindAgentWorkspaceToSelectedNode);
  const setAgentWorkspace = useAtlasStore((state) => state.setAgentWorkspace);
  const selectedNode = findNode(atlasRoot, selectedNodeId);
  const effectiveAiContextOptions = PUBLIC_SERVICE_MODE
    ? { ...aiContextOptions, scope: "path-children" as AiContextScope }
    : aiContextOptions;
  const [codexOptions, setCodexOptions] = useState<CodexOptionsResult | null>(null);
  const [codeModelRequestError, setCodeModelRequestError] = useState<{ backend: CodeBackendSelection; message: string } | null>(null);
  const [chatOptions, setChatOptions] = useState<ChatOptionsResult | null>(null);
  const [openClawOptions, setOpenClawOptions] = useState<OpenClawOptionsResult | null>(null);
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [agentWorkspaceInfo, setAgentWorkspaceInfo] = useState<AgentWorkspaceInfo | null>(null);
  const [agentWorkspaceLoading, setAgentWorkspaceLoading] = useState(false);
  const [agentWorkspaceError, setAgentWorkspaceError] = useState("");
  const [agentCapabilities, setAgentCapabilities] = useState<AgentCapabilitiesResult | null>(null);
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
  const codexModelOptions = codeModelRequestError?.backend === "codex" ? [] : codexOptions?.models ?? [];
  const selectedCodexModel = codexModelOptions.find((option) => option.model === codexSettings.model) ?? codexModelOptions[0];
  const codexEfforts = selectedCodexModel?.supportedReasoningEfforts.length
    ? selectedCodexModel.supportedReasoningEfforts
    : (["low", "medium", "high", "xhigh"] as CodexReasoningEffort[]);
  const fallbackServices = fallbackChatServices();
  const rawChatServiceOptions = aboutDemoChatOptions?.services.length ? aboutDemoChatOptions.services : chatOptions?.services.length ? chatOptions.services : fallbackServices;
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
  // A model saved before the provider retired it would otherwise leave the
  // picker showing one model while the request still sent the stale one.
  useEffect(() => {
    if (PUBLIC_SERVICE_MODE || aboutDemoConfig) return;
    if (!chatOptions?.services.length) return;
    if (!selectedChatModel) return;
    if (selectedChatModel.model === chatSettings.model) return;
    setChatSettings({
      model: selectedChatModel.model,
      reasoningEffort: selectedChatModel.supportedReasoningEfforts.includes(chatSettings.reasoningEffort)
        ? chatSettings.reasoningEffort
        : selectedChatModel.defaultReasoningEffort,
    });
  }, [aboutDemoConfig, chatOptions, chatSettings.model, chatSettings.reasoningEffort, selectedChatModel, setChatSettings]);

  const codeBackendSelection: CodeBackendSelection =
    mode === "codex" ? "codex" : claudeSettings.authMode === "subscription" ? "claude-subscription" : "claude-api";
  const selectedUsageVendor =
    mode === "codex"
      ? "openai"
      : mode === "claude"
        ? claudeSettings.authMode === "subscription"
          ? "claude"
          : claudeSettings.baseUrl.includes("deepseek")
            ? "deepseek"
            : "anthropic"
        : mode === "chat"
          ? chatSettings.service
          : "";
  // Live discovery first: a model released after this file was written must be
  // selectable, and every entry must show its version number.
  const claudeModelPresets = useMemo<ClaudeModelPreset[]>(() => {
    if (codeModelRequestError?.backend === codeBackendSelection) return [];
    if (claudeSettings.authMode === "subscription") {
      const discovered = codexOptions?.claudeSubscriptionModels?.options ?? [];
      return discovered.map((option) => ({
        id: option.id,
        label: option.displayName,
        model: option.model,
        baseUrl: "",
        vendor: "subscription",
        supportedReasoningEfforts: option.supportedReasoningEfforts,
        defaultReasoningEffort: option.defaultReasoningEffort,
      }));
    }
    const discovered = codexOptions?.claudeApiModels?.options ?? [];
    return discovered.map((option) => ({
      id: option.id,
      label: option.displayName,
      model: option.model,
      baseUrl: option.baseUrl,
      vendor: option.vendor === "deepseek" ? "deepseek" : "anthropic",
      supportedReasoningEfforts: option.supportedReasoningEfforts,
      defaultReasoningEffort: option.defaultReasoningEffort,
    }));
  }, [claudeSettings.authMode, codeBackendSelection, codeModelRequestError, codexOptions]);
  const selectedClaudePreset = getClaudePresetId(claudeSettings.model, claudeSettings.baseUrl, claudeModelPresets);
  const activeClaudePreset = claudeModelPresets.find((preset) => preset.id === selectedClaudePreset);
  // Only the efforts the selected model can actually take.
  const claudeEfforts = activeClaudePreset?.supportedReasoningEfforts?.length
    ? activeClaudePreset.supportedReasoningEfforts
    : codexOptions?.claudeReasoningEfforts?.length
      ? codexOptions.claudeReasoningEfforts
      : CLAUDE_REASONING_EFFORTS;
  const openClawModelOptions = openClawOptions?.models.length
    ? openClawOptions.models
    : [{ model: "", displayName: "OpenClaw default" }];

  const selectedNodeTitle = selectedNode?.title.trim() || "Mind Atlas";
  const agentWorkspacePath =
    mode === "codex" ? codexSettings.workspace.trim() : mode === "claude" ? claudeSettings.workspace.trim() : "";
  const inheritedAgentWorkspace = useMemo(
    () => findInheritedAgentWorkspaceBinding(atlasRoot, selectedNodeId),
    [atlasRoot, selectedNodeId],
  );
  const restorableAgentWorkspace = !agentWorkspacePath ? inheritedAgentWorkspace : undefined;
  const inspectedWorkspaceKind = agentWorkspaceInfo?.available
    ? "git"
    : agentWorkspaceInfo?.workspaceAvailable
      ? "directory"
      : null;
  const inspectedWorkspaceRoot = agentWorkspaceInfo?.available
    ? agentWorkspaceInfo.gitRoot
    : agentWorkspaceInfo?.resolvedWorkspace ?? "";
  const inheritedWorkspaceKind = inheritedAgentWorkspace?.workspaceKind ?? "git";
  const agentWorkspaceMatches = Boolean(
    inspectedWorkspaceKind
    && inheritedAgentWorkspace?.gitRoot
    && inheritedWorkspaceKind === inspectedWorkspaceKind
    && (
      inspectedWorkspaceKind === "git" && inheritedAgentWorkspace.repositoryId && agentWorkspaceInfo?.repositoryId
        ? inheritedAgentWorkspace.repositoryId === agentWorkspaceInfo.repositoryId
        : normalizeWorkspacePath(inheritedAgentWorkspace.gitRoot) === normalizeWorkspacePath(inspectedWorkspaceRoot)
    ),
  );
  const agentModeNeedsWorkspace = mode === "codex" || mode === "claude";
  const requestFailureDiscovery = codeModelRequestError?.backend === codeBackendSelection
    ? ({
        status: "error",
        source: "runtime",
        detail: codeModelRequestError.message,
        checkedAt: new Date().toISOString(),
      } satisfies CodeModelDiscoveryState)
    : null;
  const selectedModelDiscovery: CodeModelDiscoveryState | null = requestFailureDiscovery
    ?? (mode === "codex"
      ? codexOptions?.modelDiscovery.codex ?? null
      : mode === "claude" && claudeSettings.authMode === "subscription"
        ? codexOptions?.claudeSubscriptionModels?.discovery ?? null
        : mode === "claude" && activeClaudePreset?.vendor === "deepseek"
          ? codexOptions?.claudeApiModels?.deepseek ?? null
          : mode === "claude" && activeClaudePreset?.vendor === "anthropic"
            ? codexOptions?.claudeApiModels?.anthropic ?? null
            : null);
  const modelSelectionReady = mode === "codex"
    ? Boolean(selectedCodexModel)
    : mode === "claude"
      ? Boolean(activeClaudePreset)
      : true;
  const modelDiscoveryBlocked = agentModeNeedsWorkspace && (
    !selectedModelDiscovery
    || selectedModelDiscovery.status !== "ready"
    || !modelSelectionReady
  );
  const modelDiscoveryBlockReason = requestFailureDiscovery?.detail
    || selectedModelDiscovery?.detail
    || (agentModeNeedsWorkspace ? "Checking the available model list..." : "");
  const claudeApiDiscoveryErrors = claudeSettings.authMode === "api"
    ? [
        ["Anthropic", codexOptions?.claudeApiModels?.anthropic] as const,
        ["DeepSeek", codexOptions?.claudeApiModels?.deepseek] as const,
      ].flatMap(([label, discovery]) => discovery?.status === "error"
        ? [[label, discovery] as const]
        : [])
    : [];
  const selectedWorkspaceMode = mode === "codex" ? codexSettings.workspaceMode : mode === "claude" ? claudeSettings.workspaceMode : "shared";
  const dirtySourceBlocksWorktree = Boolean(
    selectedWorkspaceMode === "worktree"
    && agentWorkspaceInfo?.dirtyCount
    && !agentWorkspaceInfo.managedMissionWorktree,
  );
  const nonGitBlocksWorktree = selectedWorkspaceMode === "worktree" && inspectedWorkspaceKind === "directory";
  const agentRepositoryBlockReason = nonGitBlocksWorktree
    ? "Mission worktree mode requires Git. Select Current folder for this workspace."
    : dirtySourceBlocksWorktree
    ? "Commit or stash source-checkout changes before creating a mission worktree."
    : agentWorkspaceError
      || (inheritedAgentWorkspace
        ? `Workspace mismatch: this branch is bound to ${inheritedAgentWorkspace.repositoryName}.`
        : "Bind this Atlas branch to the inspected workspace before sending.");
  const agentRepositoryReady = !agentModeNeedsWorkspace || (agentWorkspaceMatches && !dirtySourceBlocksWorktree && !nonGitBlocksWorktree);
  const selectedClaudeCapability = agentCapabilities?.providers.find((provider) => provider.provider === "claude");
  const claudeBrowserSupported = Boolean(
    mode === "claude"
    && claudeSettings.authMode === "subscription"
    && selectedClaudeCapability?.supports.browser,
  );
  const claudeBrowserReason = claudeBrowserSupported
    ? "Use the installed Claude in Chrome integration for this run."
    : selectedClaudeCapability?.unavailableReasons.browser
      || "Checking whether this Claude Code route supports browser control.";

  useEffect(() => {
    if (!agentModeNeedsWorkspace || !agentWorkspacePath || PUBLIC_SERVICE_MODE) {
      setAgentWorkspaceInfo(null);
      setAgentWorkspaceLoading(false);
      setAgentWorkspaceError("");
      return undefined;
    }
    let cancelled = false;
    setAgentWorkspaceLoading(true);
    setAgentWorkspaceError("");
    const timer = window.setTimeout(() => {
      void inspectAgentWorkspace(agentWorkspacePath)
        .then((info) => {
          if (cancelled) return;
          setAgentWorkspaceInfo(info);
          setAgentWorkspaceError(info.workspaceAvailable ? "" : info.detail || "This path is not an available directory.");
        })
        .catch((error) => {
          if (cancelled) return;
          setAgentWorkspaceInfo(null);
          setAgentWorkspaceError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) setAgentWorkspaceLoading(false);
        });
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [agentModeNeedsWorkspace, agentWorkspacePath]);

  useEffect(() => {
    if (inspectedWorkspaceKind !== "directory") return;
    if (mode === "codex" && codexSettings.workspaceMode === "worktree") {
      setCodexSettings({ workspaceMode: "shared" });
    }
    if (mode === "claude" && claudeSettings.workspaceMode === "worktree") {
      setClaudeSettings({ workspaceMode: "shared" });
    }
  }, [
    inspectedWorkspaceKind,
    mode,
    codexSettings.workspaceMode,
    claudeSettings.workspaceMode,
    setCodexSettings,
    setClaudeSettings,
  ]);

  useEffect(() => {
    if (
      PUBLIC_SERVICE_MODE
      || mode !== "claude"
      || !agentWorkspaceInfo?.workspaceAvailable
    ) {
      setAgentCapabilities(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getAgentCapabilities({
        workspace: agentWorkspaceInfo.resolvedWorkspace || agentWorkspaceInfo.gitRoot,
        authMode: claudeSettings.authMode,
      })
        .then((result) => {
          if (!cancelled) setAgentCapabilities(result);
        })
        .catch(() => {
          if (!cancelled) setAgentCapabilities(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, agentWorkspaceInfo?.resolvedWorkspace, agentWorkspaceInfo?.gitRoot, claudeSettings.authMode]);

  useEffect(() => {
    if (PUBLIC_SERVICE_MODE || !agentModeNeedsWorkspace) return undefined;
    let alive = true;
    let inFlight = false;
    let lastRequestedAt = 0;
    const intervalMs = CODE_MODEL_REFRESH_MS[codeBackendSelection];
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      lastRequestedAt = Date.now();
      void getCodexOptions({ refresh: codeBackendSelection })
        .then((options) => {
          if (!alive) return;
          setCodeModelRequestError(null);
          setCodexOptions((current) => codeOptionsEqual(current, options) ? current : options);
        })
        .catch((error) => {
          if (!alive) return;
          const message = error instanceof Error ? error.message : String(error);
          setCodeModelRequestError({ backend: codeBackendSelection, message: `Model list request failed: ${message}` });
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (codeBackendSelection === "claude-subscription" || Date.now() - lastRequestedAt >= intervalMs) refresh();
    };
    setCodeModelRequestError(null);
    refresh();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const timer = window.setInterval(refresh, intervalMs);
    return () => {
      alive = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, [agentModeNeedsWorkspace, codeBackendSelection]);

  useEffect(() => {
    if (!codexOptions || !mode.startsWith("claude")) return;
    if (claudeModelPresets.some((preset) => preset.model === claudeSettings.model && preset.baseUrl === claudeSettings.baseUrl)) return;
    const fallback = claudeModelPresets[0];
    if (!fallback) return;
    setClaudeSettings({
      model: fallback.model,
      baseUrl: fallback.baseUrl,
      reasoningEffort: fallback.defaultReasoningEffort ?? "default",
    });
  }, [claudeModelPresets, claudeSettings.baseUrl, claudeSettings.model, codexOptions, mode, setClaudeSettings]);

  useEffect(() => {
    if (mode !== "codex" || !selectedCodexModel) return;
    if (selectedCodexModel.model === codexSettings.model) return;
    setCodexSettings({
      model: selectedCodexModel.model,
      reasoningEffort: selectedCodexModel.defaultReasoningEffort,
    });
  }, [codexSettings.model, mode, selectedCodexModel, setCodexSettings]);

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
    if (aboutDemoChatOptions) {
      const service = aboutDemoChatOptions.services.find((item) => item.id === aboutDemoChatOptions.defaultService) ?? aboutDemoChatOptions.services[0];
      const model = service?.defaultModel || service?.models[0]?.model || "";
      const effort = service?.models.find((item) => item.model === model)?.defaultReasoningEffort ?? service?.defaultReasoningEffort ?? "default";
      setChatOptions(aboutDemoChatOptions);
      setMode("chat");
      setChatSettings({
        service: service?.id ?? "openai",
        model,
        reasoningEffort: effort,
      });
      return;
    }

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
          const inherited = findInheritedAiDialogSettings(current.atlasRoot, current.selectedNodeId);
          if (!inherited?.codexSettings) {
            setCodexSettings({
              model: options.defaultModel,
              reasoningEffort: options.defaultReasoningEffort,
              sandbox: options.defaultSandbox,
              fullAccessApproved: options.defaultSandbox === "danger-full-access",
            });
            setAgentWorkspace(options.defaultWorkspace);
          } else if (!inherited.codexSettings.workspace.trim()) {
            setAgentWorkspace(options.defaultWorkspace);
          }
          if (!useAtlasStore.getState().claudeSettings.workspace.trim()) {
            setAgentWorkspace(options.defaultWorkspace);
          }
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
  }, [aboutDemoChatOptions, refreshChatOptions, setChatSettings, setCodexSettings]);

  useEffect(() => {
    if (!openClawOptions?.models.length) return;
    if (openClawOptions.models.some((option) => option.model === openClawSettings.model)) return;
    setOpenClawSettings({ model: openClawOptions.defaultModel || openClawOptions.models[0].model });
  }, [openClawOptions, openClawSettings.model, setOpenClawSettings]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (aboutDemoConfig) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const recordBlockedSubmission = (message: string) => {
      setVoiceError(message);
      clearCommandDraftPersistTimer();
      latestCommandDraftRef.current = { value: "", mode };
      setValue("");
      clearPersistedCommandDraft();
      if (mode !== "note") recordAiSubmissionError(trimmed, mode, message);
    };
    if (agentModeNeedsWorkspace && !agentWorkspacePath) {
      recordBlockedSubmission(formatAppMessage("status.realtime.workRootRequired"));
      return;
    }
    if (agentModeNeedsWorkspace && !agentRepositoryReady) {
      recordBlockedSubmission(agentRepositoryBlockReason);
      return;
    }
    if (modelDiscoveryBlocked) {
      recordBlockedSubmission(modelDiscoveryBlockReason);
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
    try {
      await runAiOnSelectedNode(
        trimmed,
        isChatCommandMode(mode) ? (mode === "openai" || mode === "local" ? mode : "chat") : mode,
        contextOptionsForRun,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceError(message);
      setValue(trimmed);
      latestCommandDraftRef.current = { value: trimmed, mode };
    }
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
  const codexWorkRootMissing = agentModeNeedsWorkspace && !agentWorkspacePath;
  const agentRepositoryBlocked = agentModeNeedsWorkspace && !codexWorkRootMissing && !agentRepositoryReady;
  const statusText =
    codexWorkRootMissing
      ? `${modeLabel(mode)} Work root required`
      : agentRepositoryBlocked
        ? (agentWorkspaceLoading ? "Inspecting workspace..." : agentRepositoryBlockReason)
      : modelDiscoveryBlocked
        ? `Model error / ${modelDiscoveryBlockReason}`
      : voiceError || (voiceButtonState !== "idle" ? voiceStatusLabel(voiceButtonState) : micLive ? `Voice Partner ${voiceState}` : PUBLIC_SERVICE_MODE ? `AI / ${selectedNode?.status ?? "waiting"}` : `${modeLabel(mode)} / ${selectedNode?.status ?? "waiting"}`);

  return (
    <form className={`command-dock ${PUBLIC_SERVICE_MODE ? "is-public-service" : ""}`} onSubmit={handleSubmit} aria-label={formatAppMessage("ui.commandDock.reInstructionInput.3c3e902")}>
      {PUBLIC_SERVICE_MODE ? (
        <div className="panel-role-label ai-panel-role" aria-hidden="true">
          <Bot size={14} />
          <span>{<I18nText id="ui.commandDock.ai.3b06fd0" />}</span>
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
        aria-label={voiceButtonState === "voice_responding" ? formatAppMessage("ui.commandDock.stopVoicePartnerResponse.f6b2a64") : micLive ? formatAppMessage("ui.commandDock.voicePartnerPushToTalk.4a830b4") : formatAppMessage("ui.commandDock.startDictationOrHoldFor.da4fda2")}
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
          <div className="mode-switch" aria-label={formatAppMessage("ui.commandDock.aiExecutionMode.ddada7f")}>
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
            aria-label={formatAppMessage("ui.commandDock.previewTheAutoAssembledAi.78a3c87")}
            title={formatAppMessage("dynamic.contextPreviewTitle", { context: contextText })}
          >
            {contextPlan
              ? formatAppMessage("dynamic.tokenEstimateShort", { count: formatTokenEstimate(contextPlan.stats.estimatedTokens) })
              : formatAppMessage("dynamic.contextShort")}
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
              ? formatAppMessage("ui.commandDock.createAChildNodeHere.89972dc")
              : mode === "codex"
                ? formatAppMessage("ui.commandDock.askCodexFromThisLocation.657b42d")
                : mode === "openclaw"
                  ? formatAppMessage("ui.commandDock.askOpenclawFromThisLocation.25b695e")
                  : mode === "claude"
                    ? formatAppMessage("ui.commandDock.askClaudeCodeFromThis.262b580")
                    : mode === "chat"
                      ? formatAppMessage("ui.commandDock.chatFromThisLocation.03514a3")
                  : formatAppMessage("ui.commandDock.askAiFromThisLocation.945e898")
          }
        />
      </label>
      <button className="send-button" type="submit" aria-label={formatAppMessage("ui.commandDock.sendInstruction.797c542")} disabled={!value.trim()}>
        <SendHorizonal size={18} />
      </button>
      {contextPreviewOpen && contextPlan ? (
        <div className="context-preview-overlay" onClick={() => setContextPreviewOpen(false)}>
          <div className="context-preview-panel" role="dialog" aria-label={formatAppMessage("ui.commandDock.aiContextPreview.f27df14")} onClick={(event) => event.stopPropagation()}>
            <div className="context-preview-header">
              <strong>{<I18nText id="ui.commandDock.autoContextPreview.e7193a6" />}</strong>
              <span>
                {formatAppMessage("dynamic.contextStats", {
                  tokens: contextPlan.stats.estimatedTokens.toLocaleString(currentAppLocale()),
                  nodes: contextPlan.stats.includedNodeCount,
                  turns: contextPlan.stats.conversationTurnCount,
                  summary: contextPlan.stats.droppedTurnCount ? formatAppMessage("dynamic.summarized", { count: contextPlan.stats.droppedTurnCount }) : "",
                  trimmed: contextPlan.stats.truncated ? formatAppMessage("ui.commandDock.trimmedToBudget.c9aeaa4") : "",
                  })}
              </span>
              <button type="button" className="icon-button ghost" onClick={() => setContextPreviewOpen(false)} aria-label={formatAppMessage("ui.commandDock.closeContextPreview.eb189c5")}>
                ×
              </button>
            </div>
            <div className="context-preview-body">
              {contextPlan.conversation.length ? (
                <>
                  <h4>{<I18nText id="ui.commandDock.conversationReplayThisBranch.984299d" />}</h4>
                  {contextPlan.conversation.map((message, index) => (
                    <pre key={index} className={`context-preview-turn is-${message.role}`}>
                      {`${message.role === "user" ? formatAppMessage("ui.commandDock.user.761c4c4") : formatAppMessage("ui.commandDock.assistant.4ee61c7")}:\n${message.content}`}
                    </pre>
                  ))}
                </>
              ) : null}
              <h4>{<I18nText id="ui.commandDock.notebookContext.4fd3df2" />}</h4>
              <pre>{contextPlan.contextText}</pre>
            </div>
          </div>
        </div>
      ) : null}
      {mode === "chat" ? (
        <div className="codex-options-row chat-options-row" aria-label={formatAppMessage("ui.commandDock.chatSettings.cebd934")}>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.service.dcdd047" />}</span>
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
                  {service.label}{service.configured ? "" : formatAppMessage("ui.commandDock.notConfigured.1aab8de")}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.model.11440c3" />}</span>
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
              <span>{<I18nText id="ui.commandDock.effort.5dc27d4" />}</span>
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
        <div className={`codex-options-row code-options-row ${mode === "claude" ? "claude-options-row" : ""}`} aria-label={formatAppMessage("ui.commandDock.codeSettings.f6c2cc0")}>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.code.da19690" />}</span>
            <select
              value={codeBackendSelection}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                setVoiceError("");
                const backend = event.target.value as CodeBackendSelection;
                if (backend === "codex") {
                  setMode("codex");
                  return;
                }
                requestNewAgentSession(true);
                setClaudeSettings({
                  authMode: backend === "claude-subscription" ? "subscription" : "api",
                  model: "",
                  baseUrl: "",
                  browser: false,
                  resumeSessionId: "",
                  forkSession: false,
                });
                setMode("claude");
              }}
              title={formatAppMessage("ui.commandDock.chooseTheCodeBackendFor.2b5180b")}
            >
              <option value="codex">{<I18nText id="ui.commandDock.codex.ec3dea3" />}</option>
              <option value="claude-api">{formatAppMessage("label.mode.claudeCodeApi")}</option>
              <option value="claude-subscription">{formatAppMessage("label.mode.claudeCodePro")}</option>
            </select>
          </label>
          {mode === "codex" ? (
            <>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.model.11440c3" />}</span>
            <select
              className={modelDiscoveryBlocked ? "model-discovery-error" : ""}
              value={selectedCodexModel?.model ?? "__model_error__"}
              disabled={!selectedCodexModel}
              title={modelDiscoveryBlocked ? modelDiscoveryBlockReason : "Models reported by the installed Codex CLI."}
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
              {!selectedCodexModel ? (
                <option value="__model_error__">{`ERROR: ${shortModelError(modelDiscoveryBlockReason)}`}</option>
              ) : null}
              {codexModelOptions.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.effort.5dc27d4" />}</span>
            <select
              value={codexSettings.reasoningEffort}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setCodexSettings({ reasoningEffort: event.target.value as CodexReasoningEffort })}
            >
              {dedupeReasoningEfforts(codexEfforts).map((effort) => (
                <option key={effort} value={effort}>
                  {reasoningEffortLabel(effort)}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.sandbox.a511d77" />}</span>
            <select
              value={codexSettings.sandbox}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const sandbox = event.target.value as CodexSandboxMode;
                setCodexSettings({ sandbox, fullAccessApproved: sandbox === "danger-full-access" });
              }}
            >
              <option value="workspace-write">{<I18nText id="ui.commandDock.workspace.27b549c" />}</option>
              <option value="read-only">{<I18nText id="ui.commandDock.readOnly.58c35aa" />}</option>
              <option value="danger-full-access">{<I18nText id="ui.commandDock.trusted.e48f61e" />}</option>
            </select>
          </label>
          <label className="context-option-field codex-workspace-field">
            <span>{<I18nText id="ui.commandDock.workRoot.4eeba87" />}</span>
            <input
              value={codexSettings.workspace}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                setVoiceError("");
                // Shared across providers so switching Codex/Claude keeps it.
                setAgentWorkspace(event.target.value);
              }}
              placeholder={formatAppMessage("ui.commandDock.workspaceFromSelectedNodeOr.f430333")}
            />
          </label>
          <label className="context-option-field">
            <span>Workspace</span>
            <select
              value={codexSettings.workspaceMode ?? "shared"}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setCodexSettings({ workspaceMode: event.target.value === "worktree" ? "worktree" : "shared" })}
              title="Run in the current checkout or create an isolated Git worktree for this mission."
            >
              <option value="shared">Current folder</option>
              <option value="worktree" disabled={inspectedWorkspaceKind === "directory"}>Mission worktree</option>
            </select>
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
            <span>{<I18nText id="ui.commandDock.preset.a4b55c6" />}</span>
            <select
              className={modelDiscoveryBlocked ? "model-discovery-error" : ""}
              value={activeClaudePreset ? selectedClaudePreset : "__model_error__"}
              disabled={!claudeModelPresets.length}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                const preset = claudeModelPresets.find((item) => item.id === event.target.value);
                if (!preset) return;
                const allowed = preset.supportedReasoningEfforts ?? [];
                setClaudeSettings({
                  model: preset.model,
                  baseUrl: preset.baseUrl,
                  ...(allowed.length && !allowed.includes(claudeSettings.reasoningEffort)
                    ? { reasoningEffort: preset.defaultReasoningEffort ?? "default" }
                    : {}),
                });
              }}
              title={modelDiscoveryBlocked ? modelDiscoveryBlockReason : formatAppMessage("ui.commandDock.claudeCodeProviderAndModel.01362ae")}
            >
              {!activeClaudePreset ? (
                <option value="__model_error__">{`ERROR: ${shortModelError(modelDiscoveryBlockReason)}`}</option>
              ) : null}
              {claudeApiDiscoveryErrors.map(([label, discovery]) => (
                <option key={`error:${label}`} value={`error:${label}`} disabled>
                  {`ERROR: ${label} / ${shortModelError(discovery.detail)}`}
                </option>
              ))}
              {claudeModelPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.effort.5dc27d4" />}</span>
            <select
              value={claudeSettings.reasoningEffort}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ reasoningEffort: event.target.value as ClaudeReasoningEffort })}
              title={formatAppMessage("ui.commandDock.claudeCodeEffortLeaveDefault.8357b80")}
            >
              {dedupeReasoningEfforts(claudeEfforts).map((effort) => (
                <option key={effort} value={effort}>
                  {reasoningEffortLabel(effort, true)}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.permission.3f423c8" />}</span>
            <select
              value={claudeSettings.permissionMode}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ permissionMode: event.target.value as ClaudePermissionMode })}
              title={formatAppMessage("ui.commandDock.claudeCodePermissionModeThis.83aebfd")}
            >
              {CLAUDE_PERMISSION_MODES.map((permissionMode) => (
                <option key={permissionMode} value={permissionMode}>
                  {claudePermissionLabel(permissionMode)}
                </option>
              ))}
            </select>
          </label>
          <label className="context-option-field codex-workspace-field">
            <span>{<I18nText id="ui.commandDock.workRoot.4eeba87" />}</span>
            <input
              value={claudeSettings.workspace}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => {
                setVoiceError("");
                // Shared across providers so switching Codex/Claude keeps it.
                setAgentWorkspace(event.target.value);
              }}
              placeholder={formatAppMessage("ui.commandDock.optionalProjectPath.6fcecc8")}
            />
          </label>
          <label className="context-option-field">
            <span>Workspace</span>
            <select
              value={claudeSettings.workspaceMode ?? "shared"}
              onFocus={() => setCommandInputEditing(true)}
              onBlur={() => setCommandInputEditing(false)}
              onChange={(event) => setClaudeSettings({ workspaceMode: event.target.value === "worktree" ? "worktree" : "shared" })}
              title="Run in the current checkout or create an isolated Git worktree for this mission."
            >
              <option value="shared">Current folder</option>
              <option value="worktree" disabled={inspectedWorkspaceKind === "directory"}>Mission worktree</option>
            </select>
          </label>
          {claudeSettings.authMode === "subscription" ? (
            <label className="context-option-field" title={claudeBrowserReason}>
              <span>Browser</span>
              <span className="codex-check-control">
                <input
                  type="checkbox"
                  checked={claudeSettings.browser === true}
                  disabled={!claudeBrowserSupported}
                  onFocus={() => setCommandInputEditing(true)}
                  onBlur={() => setCommandInputEditing(false)}
                  onChange={(event) => setClaudeSettings({ browser: event.target.checked })}
                  aria-label="Use Claude in Chrome for this run"
                />
              </span>
            </label>
          ) : null}
          <AgentSessionControl
            forceNew={forceNewAgentSession}
            onChange={requestNewAgentSession}
            onFocus={() => setCommandInputEditing(true)}
            onBlur={() => setCommandInputEditing(false)}
          />
            </>
          )}
        </div>
      ) : null}
      {agentModeNeedsWorkspace ? (
        <div className={`agent-repository-guard ${agentWorkspaceMatches ? "is-ready" : "is-blocked"}`}>
          <div>
            <strong>{agentWorkspaceLoading ? "Inspecting workspace..." : agentWorkspaceInfo?.repositoryName || "Workspace not verified"}</strong>
            <span title={inspectedWorkspaceRoot || agentWorkspacePath}>
              {agentWorkspaceInfo?.available
                ? `${agentWorkspaceInfo.branch || "detached"} @ ${(agentWorkspaceInfo.head || "").slice(0, 10)} - ${agentWorkspaceInfo.dirtyCount} changed - ${agentWorkspaceInfo.gitRoot}`
                : agentWorkspaceInfo?.workspaceAvailable
                  ? `Local folder - Git features unavailable - ${agentWorkspaceInfo.resolvedWorkspace}`
                : agentWorkspaceError || agentWorkspacePath || "Choose a work root"}
            </span>
          </div>
          {restorableAgentWorkspace ? (
            <button
              type="button"
              className="agent-btn"
              title={`Restore ${restorableAgentWorkspace.gitRoot} and verify its saved workspace binding.`}
              onClick={() => {
                setAgentWorkspace(restorableAgentWorkspace.gitRoot);
                setVoiceError("");
              }}
            >
              <RotateCcw aria-hidden="true" size={13} />
              Restore bound work root
            </button>
          ) : null}
          {agentWorkspaceInfo?.workspaceAvailable && !agentWorkspaceMatches ? (
            <button
              type="button"
              className="agent-btn"
              onClick={() => {
                bindAgentWorkspaceToSelectedNode({
                  gitRoot: inspectedWorkspaceRoot,
                  workspaceKind: inspectedWorkspaceKind === "directory" ? "directory" : "git",
                  repositoryName: agentWorkspaceInfo.repositoryName,
                  repositoryId: agentWorkspaceInfo.available ? agentWorkspaceInfo.repositoryId : undefined,
                  boundAt: new Date().toISOString(),
                });
                setVoiceError("");
              }}
            >
              {inheritedAgentWorkspace
                ? "Rebind this branch"
                : inspectedWorkspaceKind === "directory"
                  ? "Bind this folder"
                  : "Bind this branch"}
            </button>
          ) : null}
          {agentWorkspaceMatches ? <span className="agent-repository-ready">Bound</span> : null}
        </div>
      ) : null}
      {mode === "openclaw" ? (
        <div className="codex-options-row openclaw-options-row" aria-label={formatAppMessage("ui.commandDock.openclawSettings.e0316e3")}>
          <label className="context-option-field">
            <span>{<I18nText id="ui.commandDock.model.11440c3" />}</span>
            <select
              aria-label={formatAppMessage("ui.commandDock.openclawModel.dabd08b")}
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
      {mode !== "note" && !PUBLIC_SERVICE_MODE ? <ProviderUsagePanel selectedVendor={selectedUsageVendor} /> : null}
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
      <span>{<I18nText id="ui.commandDock.session.a711189" />}</span>
      <select
        value={forceNew ? "new" : "auto"}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value === "new")}
        title={formatAppMessage("ui.commandDock.autoContinuesOrForksThe.be524d9")}
      >
        <option value="auto">{<I18nText id="ui.commandDock.auto.c9ba5c5" />}</option>
        <option value="new">{<I18nText id="ui.commandDock.new.46a6974" />}</option>
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
      return formatAppMessage("label.voice.recording");
    case "dictation_transcribing":
      return formatAppMessage("label.voice.transcribing");
    case "voice_connecting":
      return formatAppMessage("label.voice.connecting");
    case "voice_ptt":
      return formatAppMessage("label.voice.listening");
    case "voice_responding":
      return formatAppMessage("label.voice.responding");
    case "idle":
      return formatAppMessage("label.voice.ready");
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
      <span>{<I18nText id="ui.commandDock.code.da19690" />}</span>
    </button>
  );
}

function modeLabel(mode: CommandMode) {
  switch (mode) {
    case "chat":
      return formatAppMessage("label.mode.chat");
    case "openai":
      return formatAppMessage("label.mode.openAi");
    case "local":
      return formatAppMessage("label.mode.local");
    case "codex":
      return formatAppMessage("label.mode.codex");
    case "openclaw":
      return formatAppMessage("label.mode.openClaw");
    case "claude":
      return formatAppMessage("label.mode.claudeCode");
    case "note":
      return formatAppMessage("label.mode.note");
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
      // Routes every Anthropic Claude model, not only Opus.
      label: "Claude",
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
  if (effort === "default") return formatAppMessage("label.effort.providerDefault");
  if (effort === "none") return formatAppMessage("label.effort.none");
  if (effort === "xhigh") return formatAppMessage("label.effort.extraHigh");
  return effort;
}

function reasoningEffortLabel(effort: string, defaultLabel = false) {
  if (effort === "default") return defaultLabel ? formatAppMessage("label.effort.default") : formatAppMessage("label.effort.providerDefault");
  if (effort === "xhigh") return formatAppMessage("label.effort.extraHigh");
  return effort.replace(/[-_]+/g, " ");
}

function dedupeReasoningEfforts(efforts: readonly string[]) {
  return Array.from(new Set(efforts.map((effort) => effort.trim().toLowerCase()).filter(Boolean)));
}

function claudePermissionLabel(permissionMode: ClaudePermissionMode) {
  switch (permissionMode) {
    case "default":
      return formatAppMessage("label.effort.default");
    case "acceptEdits":
      return formatAppMessage("label.permission.acceptEdits");
    case "plan":
      return formatAppMessage("label.permission.plan");
    case "auto":
      return formatAppMessage("label.permission.auto");
    case "dontAsk":
      return formatAppMessage("label.permission.dontAsk");
    case "bypassPermissions":
      return formatAppMessage("label.permission.trusted");
  }
}

function getClaudePresetId(
  model: string,
  baseUrl: string,
  presets: readonly { id: string; model: string; baseUrl: string }[],
) {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return presets.find((preset) => preset.model === normalizedModel && preset.baseUrl === normalizedBaseUrl)?.id ?? "custom";
}

function shortModelError(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "model list unavailable";
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function codeOptionsEqual(left: CodexOptionsResult | null, right: CodexOptionsResult) {
  if (!left) return false;
  const withoutCheckTime = (_key: string, value: unknown) => _key === "checkedAt" ? "" : value;
  return JSON.stringify(left, withoutCheckTime) === JSON.stringify(right, withoutCheckTime);
}

function normalizeWorkspacePath(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function isCommandMode(value: unknown): value is CommandMode {
  return value === "chat" || value === "openai" || value === "local" || value === "codex" || value === "openclaw" || value === "claude" || value === "note";
}

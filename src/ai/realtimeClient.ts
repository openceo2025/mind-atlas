import { createRealtimeCall } from "./bridgeClient";
import type { AiNodeContext, RealtimeSessionConfig, VoiceSessionSummary } from "../types";
import { executeVoiceTool, getVoiceToolDefinitions } from "../voice/voiceTools";

export type RealtimeSessionState = "connecting" | "live" | "listening" | "responding" | "closed" | "error";

export type RealtimeClientEvent =
  | { kind: "state"; state: RealtimeSessionState }
  | { kind: "user_transcript_delta"; text: string }
  | { kind: "user_transcript_done"; text: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_done"; text: string }
  | { kind: "summary_done"; text: string }
  | { kind: "tool_call"; name: string; callId?: string; arguments: string }
  | { kind: "tool_result"; name: string; callId?: string; text: string; ok: boolean }
  | { kind: "raw"; event: unknown }
  | { kind: "error"; message: string; event?: unknown };

export interface RealtimeVoiceSession {
  id: string;
  beginPushToTalk: () => void;
  endPushToTalk: () => void;
  requestSessionSummaryAndClose: () => Promise<string>;
  cancelAssistantResponse: () => void;
  stop: () => void;
}

interface StartVoicePartnerSessionOptions {
  context: AiNodeContext;
  instructions?: string;
  model?: string;
  voice?: string;
  summary?: VoiceSessionSummary | null;
  voiceLogContext?: string;
  onStateChange?: (state: RealtimeSessionState) => void;
  onEvent?: (event: RealtimeClientEvent) => void;
}

export async function startRealtimeVoiceSession(options: StartVoicePartnerSessionOptions): Promise<RealtimeVoiceSession> {
  return await startVoicePartnerSession(options);
}

export async function startVoicePartnerSession({
  context,
  instructions,
  model,
  voice,
  summary,
  voiceLogContext,
  onStateChange,
  onEvent,
}: StartVoicePartnerSessionOptions): Promise<RealtimeVoiceSession> {
  if (!window.isSecureContext) {
    throw new Error("Microphone access requires HTTPS or localhost. Use a secure origin for mobile LAN Realtime voice.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const sessionId = `voice-session-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const emitState = (state: RealtimeSessionState) => {
    onStateChange?.(state);
    onEvent?.({ kind: "state", state });
  };
  const emitError = (message: string, event?: unknown) => {
    onEvent?.({ kind: "error", message, event });
    emitState("error");
  };

  emitState("connecting");
  const peerConnection = new RTCPeerConnection();
  const audioElement = new Audio();
  audioElement.autoplay = true;
  let remoteAudioStream: MediaStream | null = null;
  let mediaStream: MediaStream | null = null;
  let stopped = false;
  let listening = false;
  let assistantTextBuffer = "";
  let userTranscriptBuffer = "";
  let summaryResolver: ((value: string) => void) | null = null;
  let summaryRejecter: ((reason?: unknown) => void) | null = null;
  let summaryMode = false;
  let responseInProgress = false;
  let assistantAudioPlaybackActive = false;
  let assistantPlaybackDetached = false;
  let assistantPlaybackSettleTimer: number | null = null;
  let awaitingCommitForResponse = false;
  let pendingTurnCommitTimer: number | null = null;
  let commitFallbackTimer: number | null = null;
  const pendingToolCalls = new Map<string, { name: string; arguments: string }>();
  const completedToolCallKeys = new Set<string>();
  const queuedEvents: Record<string, unknown>[] = [];

  peerConnection.ontrack = (event) => {
    remoteAudioStream = event.streams[0] ?? null;
    attachAssistantAudioPlayback();
  };

  const dataChannel = peerConnection.createDataChannel("oai-events");

  const sendEvent = (event: Record<string, unknown>) => {
    if (stopped) return false;
    if (dataChannel.readyState === "connecting") {
      queuedEvents.push(event);
      return true;
    }
    if (dataChannel.readyState !== "open") return false;
    dataChannel.send(JSON.stringify(event));
    return true;
  };

  const flushQueuedEvents = () => {
    while (dataChannel.readyState === "open" && queuedEvents.length) {
      const event = queuedEvents.shift();
      if (event) dataChannel.send(JSON.stringify(event));
    }
  };

  dataChannel.addEventListener("open", () => {
    emitState("live");
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildInitialRealtimeMessage(context, summary, voiceLogContext),
          },
        ],
      },
    });
    flushQueuedEvents();
  });

  dataChannel.addEventListener("message", (event) => {
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      // keep raw string
    }
    onEvent?.({ kind: "raw", event: data });
    void handleRealtimeEvent(data);
  });

  dataChannel.addEventListener("error", () => {
    emitError("Realtime data channel error.");
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
      if (!stopped) emitError(`Realtime connection ${peerConnection.connectionState}.`);
    }
    if (peerConnection.connectionState === "closed") {
      emitState("closed");
    }
  });

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mediaStream.getAudioTracks()) {
    track.enabled = false;
    peerConnection.addTrack(track, mediaStream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  if (!offer.sdp) throw new Error("Unable to create a Realtime SDP offer.");

  const session: RealtimeSessionConfig = {
    context,
    instructions,
    model,
    voice,
    summary,
    voiceLogContext,
    tools: getVoiceToolDefinitions(),
  };
  const answerSdp = await createRealtimeCall({ ...session, sdp: offer.sdp });
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

  async function handleRealtimeEvent(event: unknown) {
    if (!event || typeof event !== "object" || !("type" in event)) return;
    const payload = event as Record<string, unknown>;
    const type = String(payload.type);

    if (type === "input_audio_buffer.committed") {
      if (awaitingCommitForResponse) {
        triggerResponseForCommittedTurn();
      }
      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = stringValue(payload.delta);
      if (delta) {
        userTranscriptBuffer += delta;
        onEvent?.({ kind: "user_transcript_delta", text: delta });
      }
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = stringValue(payload.transcript) || extractTranscriptFromPayload(payload) || userTranscriptBuffer;
      userTranscriptBuffer = "";
      if (text) onEvent?.({ kind: "user_transcript_done", text });
      return;
    }

    if (type === "conversation.item.input_audio_transcription.failed") {
      emitError("Input audio transcription failed.", event);
      return;
    }

    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta" ||
      type === "response.output_text.delta" ||
      type === "response.text.delta"
    ) {
      const delta = stringValue(payload.delta);
      if (delta) {
        assistantTextBuffer += delta;
        onEvent?.({ kind: "assistant_delta", text: delta });
      }
      return;
    }

    if (type === "response.function_call_arguments.delta") {
      const callId = stringValue(payload.call_id) || stringValue(payload.item_id) || "call";
      const current = pendingToolCalls.get(callId) ?? { name: stringValue(payload.name), arguments: "" };
      current.name ||= stringValue(payload.name);
      current.arguments += stringValue(payload.delta);
      pendingToolCalls.set(callId, current);
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const callId = stringValue(payload.call_id);
      const itemId = stringValue(payload.item_id);
      const key = callId || itemId || "call";
      const current = pendingToolCalls.get(key) ?? {
        name: stringValue(payload.name),
        arguments: stringValue(payload.arguments),
      };
      current.name ||= stringValue(payload.name);
      current.arguments ||= stringValue(payload.arguments);
      pendingToolCalls.delete(key);
      await runToolCall(current.name, current.arguments, { callId, itemId });
      return;
    }

    if (type === "response.output_item.done") {
      const item = payload.item && typeof payload.item === "object" ? (payload.item as Record<string, unknown>) : null;
      if (item?.type === "function_call") {
        await runToolCall(stringValue(item.name), stringValue(item.arguments), {
          callId: stringValue(item.call_id),
          itemId: stringValue(item.id),
        });
      }
      return;
    }

    if (type === "output_audio_buffer.started") {
      assistantAudioPlaybackActive = true;
      attachAssistantAudioPlayback();
      if (assistantPlaybackSettleTimer !== null) {
        window.clearTimeout(assistantPlaybackSettleTimer);
        assistantPlaybackSettleTimer = null;
      }
      if (!summaryMode && !stopped) emitState("responding");
      return;
    }

    if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") {
      assistantAudioPlaybackActive = false;
      assistantPlaybackDetached = false;
      if (assistantPlaybackSettleTimer !== null) {
        window.clearTimeout(assistantPlaybackSettleTimer);
        assistantPlaybackSettleTimer = null;
      }
      if (!summaryMode && !stopped && !listening && !responseInProgress) emitState("live");
      return;
    }

    if (type === "response.created") {
      responseInProgress = true;
      assistantPlaybackDetached = false;
      if (!summaryMode && !stopped) emitState("responding");
      return;
    }

    if (type === "response.done") {
      responseInProgress = false;
      if (summaryMode) {
        const text = assistantTextBuffer.trim();
        summaryMode = false;
        assistantTextBuffer = "";
        summaryResolver?.(text);
        summaryResolver = null;
        summaryRejecter = null;
        onEvent?.({ kind: "summary_done", text });
        return;
      }
      const text = assistantTextBuffer.trim();
      assistantTextBuffer = "";
      if (text) onEvent?.({ kind: "assistant_done", text });
      completedToolCallKeys.clear();
      settleAssistantResponseState();
      return;
    }

    if (type.includes("error")) {
      emitError(extractErrorMessage(payload), event);
    }
  }

  async function runToolCall(name: string, args: string, ids: { callId?: string; itemId?: string } = {}) {
    if (!name) return;
    const callId = ids.callId || ids.itemId;
    const keys = toolCallKeys(name, args, ids);
    if (keys.some((key) => completedToolCallKeys.has(key))) return;
    for (const key of keys) completedToolCallKeys.add(key);
    onEvent?.({ kind: "tool_call", name, callId, arguments: args });
    const result = await executeVoiceTool({ name, arguments: args, callId });
    onEvent?.({ kind: "tool_result", name, callId, text: result.text, ok: result.ok });
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
      },
    });
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    listening = false;
    clearTurnTimers();
    clearPlaybackSettleTimer();
    summaryRejecter?.(new Error("Realtime session stopped."));
    summaryRejecter = null;
    summaryResolver = null;
    try {
      dataChannel.close();
    } catch {
      // ignore close races
    }
    peerConnection.close();
    mediaStream?.getTracks().forEach((track) => track.stop());
    audioElement.srcObject = null;
    remoteAudioStream = null;
    emitState("closed");
  };

  return {
    id: sessionId,
    cancelAssistantResponse,
    beginPushToTalk: () => {
      if (stopped || listening || pendingTurnCommitTimer !== null || awaitingCommitForResponse) return;
      listening = true;
      userTranscriptBuffer = "";
      assistantTextBuffer = "";
      cancelAssistantResponse();
      sendEvent({ type: "input_audio_buffer.clear" });
      mediaStream?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      emitState("listening");
    },
    endPushToTalk: () => {
      if (stopped || !listening) return;
      listening = false;
      mediaStream?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      scheduleCommitAndResponse();
    },
    requestSessionSummaryAndClose: () => {
      if (stopped) return Promise.resolve("");
      summaryMode = true;
      assistantTextBuffer = "";
      return new Promise<string>((resolve, reject) => {
        summaryResolver = (text) => {
          resolve(text);
          stop();
        };
        summaryRejecter = reject;
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Summarize this Mind Atlas voice session for future continuation. Include decisions, open tasks, and important referenced notebook nodes. Keep it concise.",
              },
            ],
          },
        });
        sendEvent({
          type: "response.create",
          response: {
            output_modalities: ["text"],
          },
        });
        window.setTimeout(() => {
          if (!summaryMode) return;
          summaryMode = false;
          const fallback = assistantTextBuffer.trim();
          assistantTextBuffer = "";
          resolve(fallback);
          stop();
        }, 30_000);
      });
    },
    stop,
  };

  function scheduleCommitAndResponse() {
    clearTurnTimers();
    emitState("responding");
    pendingTurnCommitTimer = window.setTimeout(() => {
      pendingTurnCommitTimer = null;
      awaitingCommitForResponse = true;
      sendEvent({ type: "input_audio_buffer.commit" });
      commitFallbackTimer = window.setTimeout(() => {
        if (awaitingCommitForResponse) triggerResponseForCommittedTurn();
      }, 1200);
    }, 180);
  }

  function triggerResponseForCommittedTurn() {
    if (stopped) return;
    awaitingCommitForResponse = false;
    if (commitFallbackTimer !== null) {
      window.clearTimeout(commitFallbackTimer);
      commitFallbackTimer = null;
    }
    assistantTextBuffer = "";
    responseInProgress = true;
    assistantPlaybackDetached = false;
    emitState("responding");
    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
      },
    });
  }

  function clearTurnTimers() {
    if (pendingTurnCommitTimer !== null) {
      window.clearTimeout(pendingTurnCommitTimer);
      pendingTurnCommitTimer = null;
    }
    if (commitFallbackTimer !== null) {
      window.clearTimeout(commitFallbackTimer);
      commitFallbackTimer = null;
    }
    awaitingCommitForResponse = false;
  }

  function settleAssistantResponseState() {
    clearPlaybackSettleTimer();
    if (stopped || summaryMode || listening) return;
    if (!assistantAudioPlaybackActive) {
      assistantPlaybackSettleTimer = window.setTimeout(() => {
        assistantPlaybackSettleTimer = null;
        if (!stopped && !summaryMode && !listening && !responseInProgress && !assistantAudioPlaybackActive) {
          emitState("live");
        }
      }, 750);
    }
  }

  function clearPlaybackSettleTimer() {
    if (assistantPlaybackSettleTimer !== null) {
      window.clearTimeout(assistantPlaybackSettleTimer);
      assistantPlaybackSettleTimer = null;
    }
  }

  function cancelAssistantResponse() {
    if (stopped) return;
    clearTurnTimers();
    const shouldClearOutput = responseInProgress || summaryMode || assistantAudioPlaybackActive || Boolean(assistantTextBuffer.trim());
    if (responseInProgress || summaryMode) {
      sendEvent({ type: "response.cancel" });
    }
    if (shouldClearOutput) {
      sendEvent({ type: "output_audio_buffer.clear" });
      clearAssistantAudioPlayback();
    }
    assistantTextBuffer = "";
    assistantAudioPlaybackActive = false;
    clearPlaybackSettleTimer();
    responseInProgress = false;
    if (summaryMode) {
      summaryMode = false;
      summaryRejecter?.(new Error("Realtime response canceled."));
      summaryResolver = null;
      summaryRejecter = null;
    }
    if (!listening) emitState("live");
  }

  function clearAssistantAudioPlayback() {
    assistantPlaybackDetached = true;
    try {
      audioElement.pause();
      audioElement.srcObject = null;
      audioElement.currentTime = 0;
    } catch {
      // MediaStream-backed audio can throw while being detached.
    }
  }

  function attachAssistantAudioPlayback() {
    if (!remoteAudioStream || stopped || assistantPlaybackDetached) return;
    if (audioElement.srcObject !== remoteAudioStream) {
      audioElement.srcObject = remoteAudioStream;
    }
    void audioElement.play().catch(() => {
      // Mobile browsers can delay playback until the next user gesture.
    });
  }

  function toolCallKeys(name: string, args: string, ids: { callId?: string; itemId?: string }) {
    const keys = [
      ids.callId ? `call:${ids.callId}` : "",
      ids.itemId ? `item:${ids.itemId}` : "",
    ].filter(Boolean);
    return keys.length ? keys : [`signature:${name}:${normalizeArgumentsForKey(args)}`];
  }
}

function normalizeArgumentsForKey(args: string) {
  try {
    return JSON.stringify(JSON.parse(args));
  } catch {
    return args.trim();
  }
}

function buildInitialRealtimeMessage(context: AiNodeContext, summary?: VoiceSessionSummary | null, voiceLogContext?: string) {
  return [
    "Mind Atlas Voice Partner session started.",
    `Active node: ${context.selectedNode.title}`,
    summary?.text ? `Previous voice session summary:\n${summary.text}` : "",
    voiceLogContext ? `Voice log context for global continuity:\n${voiceLogContext}` : "",
    "Wait for push-to-talk speech before taking action. Use tools when the user asks to operate Mind Atlas.",
  ].filter(Boolean).join("\n\n");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractTranscriptFromPayload(payload: Record<string, unknown>) {
  const item = payload.item;
  if (!item || typeof item !== "object") return "";
  const content = (item as Record<string, unknown>).content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && typeof part === "object" ? stringValue((part as Record<string, unknown>).transcript) : "")).filter(Boolean).join("\n");
}

function extractErrorMessage(payload: Record<string, unknown>) {
  const error = payload.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "Realtime reported an error.";
}

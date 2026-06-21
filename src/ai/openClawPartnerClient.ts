import { requestAiResponse } from "./bridgeClient";
import { buildAiNodeContextWithAttachments, normalizeAiContextOptions, useAtlasStore } from "../store/atlasStore";
import type { OpenClawSettings } from "../types";

export async function runOpenClawPartnerTurn(prompt: string, settings: OpenClawSettings) {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  const state = useAtlasStore.getState();
  const context = await buildAiNodeContextWithAttachments(
    state.atlasRoot,
    state.atlasRoot.id,
    normalizeAiContextOptions({
      scope: "minimal",
      ancestorDepth: 0,
      descendantDepth: 0,
      lateralRadius: 0,
      attachmentMode: "metadata",
      maxAttachmentCount: 0,
      maxAttachmentBytes: 64 * 1024,
      selectedNodeIds: [],
    }),
  );
  if (!context) return;

  const sessionId = `openclaw-partner-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  state.appendVoiceLogEntry({
    role: "user",
    title: "AI Partner input (OpenClaw)",
    text: trimmed,
    sessionId,
    metadata: {
      activeNodeId: state.atlasRoot.id,
      contextStats: context.stats,
    },
  });

  try {
    const result = await requestAiResponse({
      prompt: trimmed,
      provider: "openclaw",
      context,
      openclaw: {
        agent: settings.agent,
        continueMode: settings.continueMode,
        resumeSessionKey: settings.resumeSessionKey,
        timeoutMs: settings.timeoutMs,
      },
    });
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "assistant",
      title: "AI Partner (OpenClaw)",
      text: result.output.body.trim() || "(No text response.)",
      sessionId,
      metadata: {
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        openClawSessionKey: result.openClawSessionKey,
        openClawLogPath: result.openClawLogPath,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenClaw request failed.";
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "error",
      title: "AI Partner error (OpenClaw)",
      text: message,
      sessionId,
      status: "error",
    });
  }
}

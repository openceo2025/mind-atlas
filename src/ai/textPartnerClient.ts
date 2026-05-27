import { requestTextPartnerTurn } from "./bridgeClient";
import { buildVoiceLogContext } from "./voiceLogContext";
import { buildAiNodeContextWithAttachments, useAtlasStore } from "../store/atlasStore";
import type { AiContextOptions, AiExecutionMode, TextPartnerMessage } from "../types";
import { executeVoiceTool, getVoiceToolDefinitions } from "../voice/voiceTools";

const MAX_TEXT_PARTNER_TOOL_TURNS = 6;

export async function runTextPartnerTurn(prompt: string, mode: Extract<AiExecutionMode, "openai" | "local">, options: AiContextOptions) {
  const state = useAtlasStore.getState();
  const context = await buildAiNodeContextWithAttachments(state.atlasRoot, state.selectedNodeId, options);
  if (!context) return;

  const sessionId = `text-partner-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const voiceLogContext = buildVoiceLogContext(state.voiceLogEntries);
  state.appendVoiceLogEntry({
    role: "user",
    title: `AI Partner input (${mode})`,
    text: prompt,
    sessionId,
    metadata: {
      activeNodeId: state.selectedNodeId,
      contextStats: context.stats,
    },
  });

  const messages: TextPartnerMessage[] = [{ role: "user", content: prompt }];
  const tools = getVoiceToolDefinitions();

  try {
    for (let turn = 0; turn < MAX_TEXT_PARTNER_TOOL_TURNS; turn += 1) {
      const latest = useAtlasStore.getState();
      const result = await requestTextPartnerTurn({
        provider: mode,
        context,
        messages,
        tools,
        summary: latest.voiceSessionSummary,
        voiceLogContext,
      });

      if (result.text.trim()) {
        messages.push({ role: "assistant", content: result.text.trim() });
      }

      if (!result.toolCalls.length) {
        useAtlasStore.getState().appendVoiceLogEntry({
          role: "assistant",
          title: `AI Partner (${mode})`,
          text: result.text.trim() || "(No text response.)",
          sessionId,
          metadata: {
            provider: result.provider,
            model: result.model,
            usage: result.usage,
          },
        });
        return;
      }

      for (const toolCall of result.toolCalls) {
        const toolResult = await executeVoiceTool(toolCall);
        messages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.callId,
          content: [
            `Tool result for ${toolCall.name}:`,
            toolResult.text,
            toolResult.data === undefined ? "" : JSON.stringify(toolResult.data, null, 2),
          ].filter(Boolean).join("\n"),
        });
      }
    }

    const message = "Stopped after too many tool turns. Ask again with a narrower request.";
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "error",
      title: `AI Partner error (${mode})`,
      text: message,
      sessionId,
      status: "error",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI Partner request failed.";
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "error",
      title: `AI Partner error (${mode})`,
      text: message,
      sessionId,
      status: "error",
    });
  }
}

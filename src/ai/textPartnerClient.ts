import { requestTextPartnerTurn } from "./bridgeClient";
import { buildVoiceLogContext } from "./voiceLogContext";
import { CONTEXT_BUDGET_PRESETS, buildContextPlan, buildSlimLegacyContext } from "../context/contextEngine";
import { useAtlasStore } from "../store/atlasStore";
import type { ChatSettings, TextPartnerMessage } from "../types";
import { executeVoiceTool, getVoiceToolDefinitions } from "../voice/voiceTools";

const MAX_TEXT_PARTNER_TOOL_TURNS = 6;

export async function runTextPartnerTurn(prompt: string, settings: ChatSettings) {
  const state = useAtlasStore.getState();
  // The ancestor path of the active node IS this branch's chat history, so it
  // is replayed as real user/assistant messages instead of a context JSON dump.
  const plan = buildContextPlan(state.atlasRoot, state.selectedNodeId, {
    pinnedNodeIds: state.multiSelectedNodeIds,
    ...(settings.service === "local" ? CONTEXT_BUDGET_PRESETS.local : CONTEXT_BUDGET_PRESETS.chat),
  });
  const context = buildSlimLegacyContext(state.atlasRoot, state.selectedNodeId);
  if (!plan || !context) return;

  const label = chatSettingsLabel(settings);
  const sessionId = `text-partner-${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const voiceLogContext = buildVoiceLogContext(state.voiceLogEntries);
  state.appendVoiceLogEntry({
    role: "user",
    title: `AI Partner input (${label})`,
    text: prompt,
    sessionId,
    metadata: {
      activeNodeId: state.selectedNodeId,
      contextStats: {
        ...context.stats,
        estimatedInputTokens: plan.stats.estimatedTokens,
        includedNodeCount: plan.stats.includedNodeCount,
        truncated: plan.stats.truncated,
      },
    },
  });

  const messages: TextPartnerMessage[] = [
    ...plan.conversation.map((turn) => ({ role: turn.role, content: turn.content }) satisfies TextPartnerMessage),
    { role: "user", content: prompt },
  ];
  const tools = getVoiceToolDefinitions();

  try {
    for (let turn = 0; turn < MAX_TEXT_PARTNER_TOOL_TURNS; turn += 1) {
      const latest = useAtlasStore.getState();
      const result = await requestTextPartnerTurn({
        provider: settings.service,
        context,
        contextText: plan.contextText,
        messages,
        tools,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        summary: latest.voiceSessionSummary,
        voiceLogContext,
      });

      if (result.text.trim() || result.toolCalls.length) {
        messages.push({ role: "assistant", content: result.text.trim(), toolCalls: result.toolCalls });
      }

      if (!result.toolCalls.length) {
        const responseText = result.text.trim() || "(No text response.)";
        const archived = useAtlasStore.getState().archivePartnerTurn({
          parentNodeId: state.selectedNodeId,
          prompt,
          response: responseText,
          mode: partnerArchiveMode(settings.service),
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          status: "done",
        });
        useAtlasStore.getState().appendVoiceLogEntry({
          role: "assistant",
          title: `AI Partner (${label})`,
          text: archived ? "Response archived as notebook nodes." : responseText,
          sessionId,
          metadata: {
            provider: result.provider,
            model: result.model,
            usage: result.usage,
            archived,
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
      title: `AI Partner error (${label})`,
      text: message,
      sessionId,
      status: "error",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI Partner request failed.";
    useAtlasStore.getState().appendVoiceLogEntry({
      role: "error",
      title: `AI Partner error (${label})`,
      text: message,
      sessionId,
      status: "error",
    });
  }
}

function chatSettingsLabel(settings: ChatSettings) {
  if (settings.service === "anthropic") return settings.model || "Claude";
  if (settings.service === "deepseek") return settings.model || "DeepSeek";
  if (settings.service === "glm") return settings.model || "GLM";
  if (settings.service === "gemini") return settings.model || "Gemini";
  if (settings.service === "qwen") return settings.model || "Qwen";
  if (settings.service === "composer") return settings.model || "Composer";
  if (settings.service === "kimi") return settings.model || "Kimi";
  if (settings.service === "mimo") return settings.model || "Mimo";
  if (settings.service === "minimax") return settings.model || "MiniMax";
  if (settings.service === "grok") return settings.model || "Grok";
  if (settings.service === "local") return "Local";
  return settings.model || "OpenAI";
}

function partnerArchiveMode(service: ChatSettings["service"]) {
  if (service === "openai") return "openai";
  if (service === "local") return "local";
  return "chat";
}

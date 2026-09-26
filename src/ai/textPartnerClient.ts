import { requestTextPartnerTurn } from "./bridgeClient";
import { buildVoiceLogContext } from "./voiceLogContext";
import { CONTEXT_BUDGET_PRESETS, buildContextPlan, buildSlimLegacyContext } from "../context/contextEngine";
import { useAtlasStore } from "../store/atlasStore";
import type { ChatSettings, TextPartnerMessage } from "../types";
import { executeVoiceTool, getVoiceToolDefinitions } from "../voice/voiceTools";

const MAX_TEXT_PARTNER_TOOL_TURNS = 10;
/** What the model looked up, handed back as plain text when the tool turns run out. */
const FINAL_FINDINGS_CHAR_BUDGET = 40_000;
const EMPTY_REPLY_NUDGE =
  "You stopped without replying. If the request asks you to change the notebook (move, sort, file, add, update), do it now with the tools — use move_nodes to move existing nodes — then say briefly what you changed. Otherwise answer the request.";

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

  const history: TextPartnerMessage[] = plan.conversation.map((turn) => ({ role: turn.role, content: turn.content }) satisfies TextPartnerMessage);
  const messages: TextPartnerMessage[] = [...history, { role: "user", content: prompt }];
  const tools = getVoiceToolDefinitions();
  const findings: string[] = [];

  const finish = (result: Awaited<ReturnType<typeof requestTextPartnerTurn>>) => {
    const responseText = result.text.trim();
    if (!responseText) {
      // An empty reply is not an answer: never archive "(No text response.)" as a node.
      useAtlasStore.getState().appendVoiceLogEntry({
        role: "error",
        title: `AI Partner error (${label})`,
        text: "The AI returned an empty reply. Any changes it made are listed above; try asking again or switch the model.",
        sessionId,
        status: "error",
      });
      return;
    }
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
  };

  try {
    let nudged = false;
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
        if (result.text.trim()) {
          finish(result);
          return;
        }
        // Stopped without a word, typically right after reading what it needed.
        // Push once to finish the job; the placeholder keeps roles alternating.
        if (nudged) break;
        nudged = true;
        messages.push({ role: "assistant", content: "(stopped without replying)" });
        messages.push({ role: "user", content: EMPTY_REPLY_NUDGE });
        continue;
      }

      for (const toolCall of result.toolCalls) {
        const toolResult = await executeVoiceTool(toolCall);
        const content = [
          `Tool result for ${toolCall.name}:`,
          toolResult.text,
          toolResult.data === undefined ? "" : JSON.stringify(toolResult.data, null, 2),
        ].filter(Boolean).join("\n");
        messages.push({ role: "tool", name: toolCall.name, toolCallId: toolCall.callId, content });
        const args = typeof toolCall.arguments === "string" ? toolCall.arguments : JSON.stringify(toolCall.arguments);
        findings.push(`${toolCall.name}(${args})\n${content}`);
      }
    }

    // Out of tool turns (or silent twice). A broad but ordinary request must
    // still get an answer, so ask once more without tools and hand over
    // everything already looked up or changed. The lookups travel as text, not
    // as tool messages: some providers reject tool results in a request that
    // declares no tools.
    const latest = useAtlasStore.getState();
    const final = await requestTextPartnerTurn({
      provider: settings.service,
      context,
      contextText: plan.contextText,
      messages: [...history, { role: "user", content: finalAnswerPrompt(prompt, findings) }],
      tools: [],
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      summary: latest.voiceSessionSummary,
      voiceLogContext,
    });
    finish(final);
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

/** The request again, with the lookups so far, and no more tools. */
function finalAnswerPrompt(prompt: string, findings: string[]) {
  // Keep the latest lookups when they do not all fit: they build on the earlier ones.
  const kept: string[] = [];
  let used = 0;
  for (const finding of [...findings].reverse()) {
    const piece = finding.length > FINAL_FINDINGS_CHAR_BUDGET / 2 ? `${finding.slice(0, FINAL_FINDINGS_CHAR_BUDGET / 2)}…` : finding;
    if (used + piece.length > FINAL_FINDINGS_CHAR_BUDGET) break;
    kept.unshift(piece);
    used += piece.length;
  }
  return [
    prompt,
    "",
    "---",
    "You already looked these up in the notebook with tools:",
    kept.join("\n\n"),
    "",
    "No more tool calls are available. Answer the request above now, from the notebook context and these results. If you already changed the notebook, say briefly what you changed; if something could not be done or checked, say so in one short line instead of stopping.",
  ].join("\n");
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

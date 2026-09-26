/**
 * Judges what cannot be counted: stage, quality, demand, biggest
 * uncertainty, constraint kind and a decision proposal. A judge never writes
 * prose. It picks an option or a level and reports its confidence (Jev), or
 * the probabilities of the option labels (a local llama.cpp model, the same
 * way r10 judges). Every result records the backend, the model and the
 * confidence, because the reader must know how far to trust it.
 *
 * Mode: shared-core caller. `jev-hosted` goes to the hosted service, which
 * meters the user's own credit. `jev-local` and `llama-local` go to the local
 * bridge and are never offered in Hosted Public Mode.
 */
import type { AtlasNode, DecisionQuestion, DecisionResult, HostedServiceSession } from "../types";
import { galaxyQuestions, normalizeAnswer } from "./galaxyQuestions";
import { getBridgeUrl } from "../ai/bridgeClient";
import { isHostedServiceMode, requestHostedDecision } from "../hosted/serviceClient";
import { formatMoney, spaceMoney, spaceOutlineText, spaceSignals, todayIso, contentHash } from "./galaxyRollup";
import type { GalaxySpace, GalaxyState, JudgeBackend, JudgedItemKey, SpaceJudgment } from "./galaxyTypes";

export { CONSTRAINT_OPTIONS, DEMAND_LEVELS, PROPOSAL_OPTIONS, QUALITY_LEVELS, STAGE_OPTIONS, UNCERTAINTY_OPTIONS, galaxyQuestions, normalizeAnswer } from "./galaxyQuestions";

/** The text a judge reads for one space. */
export function spaceJudgeState(galaxy: GalaxyState, space: GalaxySpace, root: AtlasNode | null) {
  const today = todayIso();
  const money = spaceMoney(galaxy, space.id, root, today);
  const signals = spaceSignals(root);
  const lines = [
    `Owner's philosophy: ${galaxy.philosophy.trim() || "(not written)"}`,
    `Project: ${space.title}`,
    `Role: ${space.role ?? "(not set)"}`,
    `Money to date: spent ${formatMoney(money.total.expense + money.aiCost, galaxy.displayCurrency, "en")}, earned ${formatMoney(money.total.income, galaxy.displayCurrency, "en")}`,
    `Nodes: ${signals.nodeCount}; blocked ${signals.statusCounts.blocked}; waiting ${signals.statusCounts.waiting}; needs review ${signals.statusCounts.needs_review}; running ${signals.statusCounts.running}; done ${signals.statusCounts.done}`,
    `Days since last change: ${signals.staleDays}`,
    "Project tree:",
    root ? spaceOutlineText(root) : "(empty)",
  ];
  return lines.join("\n");
}

export type JudgeAvailability = { available: true; backend: JudgeBackend; model: string } | { available: false; reason: JudgeUnavailableReason };

export type JudgeUnavailableReason =
  | "hosted_sign_in"
  | "hosted_subscription"
  | "hosted_not_configured"
  | "bridge_offline"
  | "jev_key_missing"
  | "llama_offline";

export interface LocalJudgeStatus {
  jev: { configured: boolean; model: string };
  llama: { available: boolean; model: string; detail: string };
}

export async function fetchLocalJudgeStatus(llamaUrl: string): Promise<LocalJudgeStatus | null> {
  try {
    const response = await fetch(`${getBridgeUrl()}/api/galaxy/judge/status?llamaUrl=${encodeURIComponent(llamaUrl)}`, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    return (await response.json()) as LocalJudgeStatus;
  } catch {
    return null;
  }
}

export function hostedJudgeAvailability(session: HostedServiceSession | null): JudgeAvailability {
  if (!session?.authenticated) return { available: false, reason: "hosted_sign_in" };
  if (!session.decide?.configured) return { available: false, reason: "hosted_not_configured" };
  if (!session.entitlement?.aiEnabled) return { available: false, reason: "hosted_subscription" };
  return { available: true, backend: "jev-hosted", model: session.decide.model };
}

export function localJudgeAvailability(status: LocalJudgeStatus | null, backend: JudgeBackend): JudgeAvailability {
  if (!status) return { available: false, reason: "bridge_offline" };
  if (backend === "llama-local") {
    return status.llama.available ? { available: true, backend, model: status.llama.model } : { available: false, reason: "llama_offline" };
  }
  return status.jev.configured ? { available: true, backend: "jev-local", model: status.jev.model } : { available: false, reason: "jev_key_missing" };
}

async function requestLocalDecision(backend: JudgeBackend, llamaUrl: string, payload: { purpose: string; state: string; questions: Record<string, DecisionQuestion> }) {
  const response = await fetch(`${getBridgeUrl()}/api/galaxy/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, backend: backend === "llama-local" ? "llama" : "jev", llamaUrl }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await response.json().catch(() => ({}))) as DecisionResult & { error?: string };
  if (!response.ok) throw new Error(data.error || `Judge failed with ${response.status}`);
  return data;
}

/** Judge one space. Throws on failure; the caller keeps the previous judgment. */
export async function judgeSpace(galaxy: GalaxyState, space: GalaxySpace, root: AtlasNode | null, backend: JudgeBackend): Promise<SpaceJudgment> {
  const questions = galaxyQuestions();
  const payload = { purpose: "galaxy-space", state: spaceJudgeState(galaxy, space, root), questions };
  if (backend === "jev-hosted" && !isHostedServiceMode()) throw new Error("Hosted judging is only available on the hosted service.");
  if (backend !== "jev-hosted" && isHostedServiceMode()) throw new Error("Local judging is not available on the hosted service.");
  const result = backend === "jev-hosted"
    ? await requestHostedDecision(payload)
    : await requestLocalDecision(backend, galaxy.judge.llamaUrl, payload);
  const answers: SpaceJudgment["answers"] = {};
  (Object.keys(questions) as JudgedItemKey[]).forEach((key) => {
    const normalized = normalizeAnswer(questions[key], result.answers?.[key]);
    if (normalized) answers[key] = normalized;
  });
  return {
    spaceId: space.id,
    contentHash: judgeHash(galaxy, space, root),
    judgedAt: new Date().toISOString(),
    backend,
    model: result.model || backend,
    answers,
  };
}

/** Re-judge only when what the judge reads has changed. */
export function judgeHash(galaxy: GalaxyState, space: GalaxySpace, root: AtlasNode | null) {
  return `${contentHash(root)}:${space.role ?? ""}:${galaxy.philosophy.length}`;
}

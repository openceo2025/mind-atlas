/**
 * One view model per space for the galaxy screen: the four row signals
 * (demand, money, constraint, decision) plus everything the detail panel
 * shows. Mechanical figures come from galaxyRollup; judged ones from the
 * stored judgment, always with their confidence and model.
 *
 * Mode: shared-core.
 */
import type { AtlasNode } from "../types";
import { DEMAND_LEVELS, QUALITY_LEVELS } from "./galaxyJudge";
import { spaceMoney, spaceSignals, type SpaceMoney, type SpaceSignals } from "./galaxyRollup";
import type { GalaxySpace, GalaxyState, JudgedAnswer, SpaceDecision, SpaceJudgment } from "./galaxyTypes";

export interface SpaceView {
  space: GalaxySpace;
  root: AtlasNode | null;
  active: boolean;
  signals: SpaceSignals;
  money: SpaceMoney;
  judgment: SpaceJudgment | null;
  /** 0..DEMAND_LEVELS-1, rounded; null when not judged. */
  demand: number | null;
  quality: number | null;
  constraint: string | null;
  stage: string | null;
  uncertainty: string | null;
  proposal: string | null;
  /** The user's decision, or the judge's proposal when the user has not decided. */
  shownDecision: { value: SpaceDecision; proposed: boolean };
  /** True when the tree changed after the last judgment. */
  judgmentStale: boolean;
  purpose: string;
}

const DEFAULT_ROOT_BODY = "The root of this local notebook.";

const DEFAULT_ROOT_SUMMARY = "A local spatial notebook for thoughts, files, and branches.";

function summaryText(root: AtlasNode | null) {
  const summary = (root?.summary ?? "").trim();
  return summary === DEFAULT_ROOT_SUMMARY ? "" : summary;
}

function level(answer: JudgedAnswer | undefined, levels: number) {
  if (!answer || typeof answer.level !== "number") return null;
  return Math.max(0, Math.min(levels - 1, Math.round(answer.level * (levels - 1))));
}

export function buildSpaceViews(
  galaxy: GalaxyState,
  rootOf: (spaceId: string) => AtlasNode | null,
  today: string,
  hashOf: (space: GalaxySpace, root: AtlasNode | null) => string,
): SpaceView[] {
  return galaxy.spaces.map((space) => {
    const root = rootOf(space.id);
    const judgment = galaxy.judgments[space.id] ?? null;
    const answers = judgment?.answers ?? {};
    const proposal = answers.proposal?.value ?? null;
    const decided = space.decision !== "undecided";
    const proposedDecision = (["continue", "hold", "recycle", "stop"] as const).find((value) => value === proposal);
    const body = (root?.body ?? "").trim();
    return {
      space,
      root,
      active: space.id === galaxy.activeSpaceId,
      signals: spaceSignals(root),
      money: spaceMoney(galaxy, space.id, root, today),
      judgment,
      demand: level(answers.demand, DEMAND_LEVELS),
      quality: level(answers.quality, QUALITY_LEVELS),
      constraint: answers.constraint?.value ?? null,
      stage: answers.stage?.value ?? null,
      uncertainty: answers.uncertainty?.value ?? null,
      proposal,
      shownDecision: decided || !proposedDecision
        ? { value: space.decision, proposed: false }
        : { value: proposedDecision, proposed: true },
      judgmentStale: Boolean(judgment && judgment.contentHash !== hashOf(space, root)),
      purpose: body && body !== DEFAULT_ROOT_BODY ? body : summaryText(root),
    };
  });
}

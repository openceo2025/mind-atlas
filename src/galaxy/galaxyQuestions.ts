/**
 * The judge's questions and how answers are normalised. Pure, so
 * scripts/verify-galaxy.ts can exercise it without a browser.
 *
 * Mode: shared-core.
 */
import type { DecisionAnswer, DecisionQuestion } from "../types.ts";
import type { JudgedAnswer, JudgedItemKey } from "./galaxyTypes.ts";

export const STAGE_OPTIONS = ["idea", "prototype", "limited", "launched", "earning"] as const;
export const UNCERTAINTY_OPTIONS = ["value", "usability", "feasibility", "viability", "external"] as const;
export const CONSTRAINT_OPTIONS = ["human", "physical", "external", "ai", "none"] as const;
export const PROPOSAL_OPTIONS = ["continue", "hold", "recycle", "stop"] as const;
export const QUALITY_LEVELS = 4;
export const DEMAND_LEVELS = 4;

export function galaxyQuestions(): Record<JudgedItemKey, DecisionQuestion> {
  return {
    stage: {
      type: "choice",
      instructions: "Which stage has this project reached? Judge only from the evidence in the state.",
      criteria: {
        idea: "Only an idea or a design; nothing runs yet",
        prototype: "Something runs, but only the owner has used it",
        limited: "Shown to or tested by a few outside people",
        launched: "Publicly available",
        earning: "Publicly available and has earned money",
      },
    },
    quality: {
      type: "score",
      instructions: "How complete and reliable is what this project has produced, for its own purpose?",
      criteria: ["Nothing works yet", "Works partly", "Main purpose works", "Polished enough to charge for"],
    },
    demand: {
      type: "score",
      instructions: "What evidence of outside demand exists? Count only actions by people other than the owner (used, came back, paid). Likes, views and the owner's hopes do not count.",
      criteria: ["No evidence of outside users", "A few outside people tried it", "Outside people use it repeatedly", "Outside people have paid"],
    },
    uncertainty: {
      type: "choice",
      instructions: "What is the biggest open risk that should be tested first?",
      criteria: {
        value: "Value: nobody may want or use it",
        usability: "Usability: people may not manage to use it",
        feasibility: "Feasibility: it may not be buildable with the time, skills and technology available",
        viability: "Viability: it may not make money or fit how it is sold",
        external: "External: law, reputation, platform rules or licences",
      },
    },
    constraint: {
      type: "choice",
      instructions: "What is stopping this project from moving right now?",
      criteria: {
        human: "Waiting on the owner: payment setup, identity checks, contacting people, a decision",
        physical: "Waiting on the real world: hardware, recording, physical testing",
        external: "Waiting on a third party: review, platform, licence, partner",
        ai: "AI agents are working on it; nothing blocks it",
        none: "Nothing is stopping it",
      },
    },
    proposal: {
      type: "choice",
      instructions: "Given the evidence, what should the owner do with this project next?",
      criteria: {
        continue: "Continue: invest the next step",
        hold: "Hold: pause until something specific changes",
        recycle: "Redo: narrow or change the approach, then re-check",
        stop: "Stop: free the time and money for other projects",
      },
    },
  };
}

export function normalizeAnswer(question: DecisionQuestion, answer: DecisionAnswer | undefined): JudgedAnswer | undefined {
  if (!answer) return undefined;
  if (question.type === "score") {
    const levels = Array.isArray(question.criteria) ? question.criteria.length : 0;
    if (typeof answer.score !== "number" || levels < 2) return undefined;
    const score = Math.max(0, Math.min(levels - 1, answer.score));
    return {
      value: String(Math.round(score)),
      level: score / (levels - 1),
      confidence: clamp01(answer.confidence ?? 0),
      probabilities: answer.probabilities,
    };
  }
  if (question.type === "choice") {
    if (!answer.choice) return undefined;
    const confidence = answer.confidence ?? answer.probabilities?.[answer.choice] ?? 0;
    return { value: answer.choice, confidence: clamp01(confidence), probabilities: answer.probabilities };
  }
  return undefined;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}


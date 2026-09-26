/**
 * The galaxy is the management layer above spaces. A space is one notebook
 * (one project tree). The galaxy owns what no single space owns: the
 * philosophy, the shared resources, the money ledger, and the decisions about
 * which spaces to continue.
 *
 * Mode: shared-core. Nothing here may assume local or hosted mode; judging
 * backends are chosen at call time (see galaxyJudge.ts).
 */
import type { AtlasNode } from "../types";

export const GALAXY_SCHEMA_VERSION = 1;
export const GALAXY_FILE_KIND = "mind-atlas-galaxy";

export type Currency = "JPY" | "USD";

export type ResourceKind = "account" | "time" | "ai-quota" | "brand";

export interface GalaxyResource {
  id: string;
  kind: ResourceKind;
  name: string;
  /** Account balance in `currency`, typed by the user. The only hand-typed number in the galaxy. */
  balance?: number;
  currency?: Currency;
  /** Hours per week the user can spend, for `time` resources. */
  hoursPerWeek?: number;
  note?: string;
}

/** ② Role in the portfolio. */
export type SpaceRole = "run" | "grow" | "transform" | "foundation";

/** ⑪ Decision. `undecided` means the user has not decided yet. */
export type SpaceDecision = "undecided" | "continue" | "hold" | "recycle" | "stop";

export interface KillCriterion {
  /** The state that must hold by the date, in the user's words. */
  state: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

export interface GalaxySpace {
  id: string;
  title: string;
  color: string;
  role?: SpaceRole;
  decision: SpaceDecision;
  decidedAt?: string;
  killCriterion?: KillCriterion;
  /** ⑩ Other spaces this one depends on. */
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

export type LedgerKind = "expense" | "income";

export interface LedgerAllocation {
  spaceId: string;
  /** Any node in that space. Absent means the space as a whole. */
  nodeId?: string;
  /** Relative weight; allocations of one entry are normalised by their sum. */
  weight: number;
}

export interface LedgerRecurrence {
  every: "month" | "year";
  /** ISO date after which no more occurrences are generated. */
  until?: string;
}

export interface LedgerEntry {
  id: string;
  /** ISO date (YYYY-MM-DD) of the first occurrence. */
  date: string;
  kind: LedgerKind;
  amount: number;
  currency: Currency;
  /** The resource (account) the money left or entered. */
  resourceId?: string;
  memo: string;
  allocations: LedgerAllocation[];
  recurrence?: LedgerRecurrence;
  /** Marks figures the user gave as rough estimates. */
  approximate?: boolean;
  source: "manual" | "voice" | "import";
  createdAt: string;
  updatedAt: string;
}

/** Questions the judge answers for every space. Keys are stable identifiers. */
export type JudgedItemKey = "stage" | "quality" | "demand" | "uncertainty" | "constraint" | "proposal";

export interface JudgedAnswer {
  /** The chosen option key, or the rounded level index for score questions. */
  value: string;
  /** 0..1 position for score questions. */
  level?: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export type JudgeBackend = "jev-hosted" | "jev-local" | "llama-local";

export interface SpaceJudgment {
  spaceId: string;
  contentHash: string;
  judgedAt: string;
  backend: JudgeBackend;
  model: string;
  answers: Partial<Record<JudgedItemKey, JudgedAnswer>>;
  /** Set when a judge run failed; the previous answers are kept. */
  error?: string;
}

export interface JudgeSettings {
  /** Judge automatically whenever a space's content changes. */
  auto: boolean;
  backend: JudgeBackend;
  /** llama.cpp server URL for `llama-local`. */
  llamaUrl: string;
}

export interface GalaxyState {
  schemaVersion: number;
  philosophy: string;
  philosophyHistory: { text: string; replacedAt: string }[];
  resources: GalaxyResource[];
  spaces: GalaxySpace[];
  activeSpaceId: string;
  ledger: LedgerEntry[];
  judgments: Record<string, SpaceJudgment>;
  judge: JudgeSettings;
  displayCurrency: Currency;
  /** Yen per US dollar, used to add AI costs (USD) to yen figures. */
  jpyPerUsd: number;
  updatedAt: string;
}

export interface GalaxyFile {
  kind: typeof GALAXY_FILE_KIND;
  version: number;
  exportedAt: string;
  galaxy: Omit<GalaxyState, "activeSpaceId">;
  roots: Record<string, AtlasNode>;
}

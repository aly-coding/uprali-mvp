import type { Funding, KillCriteria, ValueCase } from "./value";

export type Owner = "human" | "agent";
export type Confidence = "high" | "medium" | "low";
export type Unit = "text" | "usd" | "usd_per_year" | "usd_per_week" | "pct" | "weeks" | "hours_per_week" | "hours_per_month" | "count" | "years" | "hours_per_year" | "usd_per_hour" | "months";

/** One number in the decision, with where it came from. Every value in a memo is one of these. */
export interface Input {
  key: string;
  label: string;
  value: number | string | null;
  unit: Unit;
  /** Plain words: "Stated in the request: '...'", "Industry benchmark: ...". */
  source: string;
  /** Who stands behind the number: a person, or the analyst agent. */
  owner: Owner;
  /** True when the number is an estimate rather than a known fact. */
  isAssumption: boolean;
  confidence: Confidence;
  /** True when only a person can supply it and it is still missing or still an agent's guess. */
  needsHuman: boolean;
}

/** What a caller (an agent, the API or the UI) may pass for a field. */
export type GivenValue =
  | number
  | string
  | { value: number | string; source?: string; owner?: Owner; is_assumption?: boolean; confidence?: Confidence };

export interface CostLine {
  key: string;
  label: string;
  /** One entry per year of the horizon. */
  byYear: number[];
  total: number;
  /** How the line is worked out, in plain words with the numbers used. */
  how: string;
  inputs: string[];
}

export interface Side {
  total: number;
  byYear: number[];
  lines: CostLine[];
}

export interface FlipPoint {
  key: string;
  label: string;
  current: number;
  flipAt: number;
  text: string;
}

export interface ModelUse {
  provider: "nearai" | "anthropic" | "demo";
  model: string;
  task: "extract" | "narrate" | "advise";
  private: boolean;
  fallbackFrom?: string;
}

export interface PrivateAiSummary {
  provider: ModelUse["provider"];
  model: string;
  /** True only when NEAR AI Cloud served every model call in this decision. */
  privateInference: boolean;
  attestation: null | {
    verified: boolean;
    signingAddress: string;
    nonce: string;
    checkedAt: string;
    checks: Array<{ name: string; ok: boolean; detail: string }>;
    notCheckedHere: string[];
  };
  note: string;
}

export interface Memo {
  schema: "uprali.memo.v1";
  decisionId: string;
  title: string;
  /** complete: every number is in. draft: computed, but a person should confirm some estimates. needs_human: a number only a person can give is missing. */
  status: "complete" | "draft" | "needs_human";
  recommendation: { option: "buy" | "build" | "status_quo" | null; headline: string; confidence: Confidence; why: string };
  horizonYears: number;
  buy: Side | null;
  build: Side | null;
  difference: number | null;
  prototypeOnlyCost: number | null;
  prototypeTrap: string | null;
  breakEvenAnnualSubscription: number | null;
  whatWouldChangeMyMind: FlipPoint[];
  /** Return on investment against the status quo: cash kept apart from freed-up time. */
  value: ValueCase | null;
  /** The CFO funding check and the "not now" reasons. */
  funding: Funding | null;
  /** What must move, by when, and who can stop it. */
  killCriteria: KillCriteria | null;
  biggestRisk: string;
  cfoQuestions: string[];
  spoken30s: string;
  inputs: Input[];
  gaps: Array<{ key: string; label: string; why: string }>;
  assumptionShareOfBuildCost: number | null;
  modelsUsed: ModelUse[];
  privateAi: PrivateAiSummary;
  generatedAt: string;
}

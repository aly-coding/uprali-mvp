export type Confidence = "high" | "medium" | "low";

export type ProviderName = "anthropic" | "nearai" | "demo";

/** Who supplied a value, so an auditor can see where every number came from. */
export type FilledBy =
  | { kind: "user" }
  | { kind: "model"; provider: ProviderName; model: string };

export type FieldUnit = "usd" | "usd_per_year" | "weeks" | "months" | "years" | "pct" | "count" | "text";

export interface FieldDef {
  key: string;
  label: string;
  unit: FieldUnit;
  /** The question the analyst asks to fill this field. */
  question: string;
  /** Plain-words hint the analyst can offer when the user doesn't know. */
  hint: string;
  /** A rough benchmark the analyst may propose (always marked low confidence). */
  benchmark: number | string;
  required: boolean;
}

export interface Assumption {
  key: string;
  value: number | string;
  source: string;
  confidence: Confidence;
  owner?: string;
  filledBy: FilledBy;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CaseState {
  id: string;
  title: string;
  templateId: string;
  version: number;
  assumptions: Record<string, Assumption>;
}

export interface MemoLine {
  label: string;
  text: string;
}

export interface CheatSheetRow {
  figure: string;
  meaning: string;
  source: string;
  cfoAsks: string;
}

export interface DecisionMemo {
  title: string;
  complete: boolean;
  missing: string[];
  recommendation: string;
  recommendedOption: string;
  lines: MemoLine[]; // ask, why, cost & payback, biggest risk, what would change my mind
  cheatSheet: CheatSheetRow[];
  assumptions: Array<{ label: string; value: string; source: string; confidence: Confidence; owner?: string; filledBy: string }>;
  whatIf: string;
  preAnswered: Array<{ q: string; a: string }>;
  spoken: string;
}

export interface Metric {
  label: string;
  value: string;
}

export interface TemplateResult {
  recommendedOption: string;
  recommendation: string;
  metrics: Metric[];
  why: string[];
  costAndPayback: string;
  biggestRisk: string;
  changeMyMind: string;
  whatIf: string;
  preAnswered: Array<{ q: string; a: string }>;
  spoken: string;
  ask: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Opening line the analyst leads with, showing what Uprali already does. */
  opener: string;
  fields: FieldDef[];
  compute(values: Record<string, number | string>): TemplateResult;
}

export type AnchorKind = "decision" | "approval" | "outcome_review";

/** The exact object whose fingerprint goes on chain. Numbers stay off chain. */
export interface DecisionSnapshot {
  schema: "uprali.decision.v1";
  kind: AnchorKind;
  caseId: string;
  caseTitle: string;
  caseVersion: number;
  templateId: string;
  decidedAt: string;
  decision: string;
  approvers: string[];
  assumptions: Array<{
    key: string;
    value: number | string;
    source: string;
    confidence: Confidence;
    filledBy: string;
  }>;
  /** Every model that filled a value or made a suggestion in this case. */
  modelsUsed: string[];
}

export interface LedgerAnchor {
  hash: string;
  kind: AnchorKind;
  caseId: string;
  version: number;
  recordedBy: string;
  timestampMs: number;
  blockHeight?: number;
}

export interface RecordResult {
  network: "near-testnet" | "local-demo";
  anchor: LedgerAnchor;
  txHash?: string;
  explorerUrl?: string;
}

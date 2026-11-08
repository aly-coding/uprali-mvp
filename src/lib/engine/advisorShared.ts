/** What the advisor's browser screen and the server share. No model code here, so it's safe in the browser. */
import type { ModelUse } from "./types";

export const SUGGESTION_LABEL = "Suggestion, verify";
export const SUGGESTION_SOURCE = "Suggestion from Uprali's advisor. Verify the price on the vendor's site";

export interface AdvisorQuestion {
  key: AnswerKey;
  ask: string;
  placeholder: string;
}

export type AnswerKey = "must_haves" | "seats" | "budget_per_year" | "current_tool" | "integrations";

/** Fixed questions: the advisor asks these before it suggests anything. */
export const ADVISOR_QUESTIONS: AdvisorQuestion[] = [
  { key: "must_haves", ask: "What must the tool do? List the features you can't live without.", placeholder: "e.g. pipeline, email tracking, quotes" },
  { key: "seats", ask: "How many people will use it?", placeholder: "e.g. 5" },
  { key: "budget_per_year", ask: "What's the most you'd pay per year, for everyone?", placeholder: "e.g. 3000" },
  { key: "current_tool", ask: "What do you use or pay for today, if anything?", placeholder: "e.g. Salesforce Pro, spreadsheets" },
  { key: "integrations", ask: "What does it have to connect to?", placeholder: "e.g. Gmail, Stripe, Slack" },
];

export type Answers = Partial<Record<AnswerKey, string>>;

export interface ToolSuggestion {
  name: string;
  plan: string;
  /** Rough list price per user per month in USD, as the advisor believes it. Unverified. */
  pricePerSeatMonth: number | null;
  /** pricePerSeatMonth × seats × 12, when both are known. Unverified. */
  estimatedAnnual: number | null;
  covers: string[];
  gaps: string[];
  why: string;
  label: typeof SUGGESTION_LABEL;
}

export interface Advice {
  category: string;
  seats: number | null;
  /** Questions still worth answering, the advisor's own or the fixed ones left blank. */
  followUps: string[];
  suggestions: ToolSuggestion[];
  /** One or two sentences of advice, plainly a suggestion. */
  advice: string;
  label: typeof SUGGESTION_LABEL;
  note: string;
  use: ModelUse;
}

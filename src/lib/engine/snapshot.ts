import type { Memo } from "./types";

/**
 * The decision snapshot is what gets fingerprinted. It holds the outcome, every number with its
 * source and owner, which models helped and whether the private AI check passed. The question
 * text and the prose are left out on purpose: the proof is about the numbers and who stood behind them.
 */
export type AnchorKind = "decision" | "approval" | "outcome_review";

export interface DecisionSnapshot {
  schema: "uprali.decision.v2";
  kind: AnchorKind;
  decisionId: string;
  version: number;
  template: string;
  title: string;
  decidedAt: string;
  decidedBy: string;
  approvers: string[];
  recommendation: { option: "buy" | "build" | null; headline: string };
  status: Memo["status"];
  horizonYears: number;
  totals: { buy: number | null; build: number | null; difference: number | null };
  inputs: Array<{ key: string; value: number | string | null; source: string; owner: string; isAssumption: boolean }>;
  gaps: string[];
  modelsUsed: Array<{ provider: string; model: string; task: string; private: boolean }>;
  privateAi: { privateInference: boolean; attestation: null | { verified: boolean; signingAddress: string; nonce: string; checkedAt: string } };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite number in snapshot");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashSnapshot(s: DecisionSnapshot): Promise<string> {
  return sha256Hex(canonicalJson(s));
}

export function buildSnapshot(memo: Memo, opts: { decidedBy: string; approvers?: string[]; kind?: AnchorKind; decidedAt?: string; version?: number }): DecisionSnapshot {
  return {
    schema: "uprali.decision.v2",
    kind: opts.kind ?? "decision",
    decisionId: memo.decisionId,
    version: opts.version ?? 1,
    template: "build_vs_buy",
    title: memo.title,
    decidedAt: opts.decidedAt ?? new Date().toISOString(),
    decidedBy: opts.decidedBy.slice(0, 120),
    approvers: (opts.approvers ?? []).map((a) => a.trim().slice(0, 120)).filter(Boolean).slice(0, 10),
    recommendation: { option: memo.recommendation.option, headline: memo.recommendation.headline },
    status: memo.status,
    horizonYears: memo.horizonYears,
    totals: { buy: memo.buy?.total ?? null, build: memo.build?.total ?? null, difference: memo.difference },
    inputs: memo.inputs.map((i) => ({ key: i.key, value: i.value, source: i.source, owner: i.owner, isAssumption: i.isAssumption })),
    gaps: memo.gaps.map((g) => g.key),
    modelsUsed: memo.modelsUsed.map((m) => ({ provider: m.provider, model: m.model, task: m.task, private: m.private })),
    privateAi: {
      privateInference: memo.privateAi.privateInference,
      attestation: memo.privateAi.attestation
        ? { verified: memo.privateAi.attestation.verified, signingAddress: memo.privateAi.attestation.signingAddress, nonce: memo.privateAi.attestation.nonce, checkedAt: memo.privateAi.attestation.checkedAt }
        : null,
    },
  };
}

const KINDS: AnchorKind[] = ["decision", "approval", "outcome_review"];

export function validateSnapshot(x: unknown): x is DecisionSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    s.schema === "uprali.decision.v2" &&
    KINDS.includes(s.kind as AnchorKind) &&
    typeof s.decisionId === "string" &&
    s.decisionId.length > 0 &&
    s.decisionId.length <= 64 &&
    typeof s.version === "number" &&
    Number.isInteger(s.version) &&
    s.version >= 0 &&
    typeof s.decidedBy === "string" &&
    Array.isArray(s.approvers) &&
    Array.isArray(s.inputs) &&
    Array.isArray(s.modelsUsed) &&
    !!s.recommendation &&
    typeof s.recommendation === "object"
  );
}

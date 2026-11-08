import { breakEvenSubscription, buildSide, buySide, FIELDS, flipPoints, resolveInputs, TEMPLATE, toValues } from "./buildVsBuy";
import { extractFacts, factsFor, narrate } from "./analyst";
import { attestNearAi } from "./privacy";
import type { Env } from "./providers";
import type { Confidence, GivenValue, Memo, ModelUse, PrivateAiSummary } from "./types";

export interface DecideRequest {
  /** Free text from the person, e.g. "Should we build our own CRM or keep paying $720 a year for HubSpot?" */
  question?: string;
  title?: string;
  /** Known numbers, by field key. Each may carry its own source and owner. */
  inputs?: Record<string, GivenValue | undefined>;
  decisionId?: string;
  now?: Date;
}

export function newDecisionId(now = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  const r = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `UP-${d}-${r}`;
}

const REQUIRED = ["buy_annual_cost", "prototype_weeks"];

export async function decide(req: DecideRequest, env: Env = process.env): Promise<Memo> {
  const now = req.now ?? new Date();
  const question = (req.question ?? "").slice(0, 4000);
  const models: ModelUse[] = [];

  const { facts, use } = await extractFacts(question, env);
  if (use) models.push(use);

  const inputs = resolveInputs(req.inputs ?? {}, facts);
  const v = toValues(inputs);
  const canCompute = REQUIRED.every((k) => typeof v[k] === "number");
  const years = Math.round(v.horizon_years ?? 3);
  const tool = inputs.find((i) => i.key === "tool_name")?.value;
  const toolName = typeof tool === "string" && tool ? tool : "the vendor";
  const what = inputs.find((i) => i.key === "what_to_build")?.value;

  const gaps = inputs
    .filter((i) => i.needsHuman)
    .map((i) => ({
      key: i.key,
      label: i.label,
      why: i.value === null ? "Needs a human: only a person can give this number." : "Needs a human: a benchmark is filling in until a person confirms it.",
    }));

  let buy = null, build = null, difference = null, prototypeOnlyCost = null, breakEven = null, flips: Memo["whatWouldChangeMyMind"] = [];
  let recommendation: Memo["recommendation"] = {
    option: null,
    headline: "Not enough to decide yet",
    confidence: "low",
    why: `Still needed from a person: ${gaps.filter((g) => inputs.find((i) => i.key === g.key)?.value === null).map((g) => g.label.toLowerCase()).join(", ")}.`,
  };
  let assumptionShare: number | null = null;

  if (canCompute) {
    buy = buySide(v);
    build = buildSide(v);
    difference = build.total - buy.total;
    prototypeOnlyCost = Math.round(v.prototype_weeks * v.engineer_weekly_cost);
    breakEven = Math.round(breakEvenSubscription(v));
    flips = flipPoints(v, inputs);
    const assumed = new Set(inputs.filter((i) => i.isAssumption).map((i) => i.key));
    const assumedCost = build.lines.filter((l) => l.inputs.some((k) => assumed.has(k))).reduce((a, l) => a + l.total, 0);
    assumptionShare = build.total > 0 ? Math.round((assumedCost / build.total) * 100) / 100 : 0;
    const margin = Math.abs(difference) / Math.max(buy.total, build.total, 1);
    let confidence: Confidence = assumptionShare < 0.25 ? "high" : assumptionShare < 0.6 ? "medium" : "low";
    if (margin < 0.15) confidence = confidence === "high" ? "medium" : "low";
    const buyWins = difference > 0;
    const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
    recommendation = {
      option: buyWins ? "buy" : "build",
      headline: buyWins ? `Buy ${toolName}` : `Build ${typeof what === "string" ? what : "it"} in-house`,
      confidence,
      why: buyWins
        ? `Over ${years} years, building costs ${usd(build.total)} against ${usd(buy.total)} to buy, ${usd(difference)} more. The prototype alone is ${usd(prototypeOnlyCost)}, about ${v.prototype_share_pct}% of the real build.`
        : `Over ${years} years, building costs ${usd(build.total)} against ${usd(buy.total)} to buy, ${usd(-difference)} less, even after upkeep, security, on-call and the engineers' time off the core product.`,
    };
  }

  const draft = {
    schema: "uprali.memo.v1" as const,
    decisionId: req.decisionId ?? newDecisionId(now),
    title: (req.title ?? `${TEMPLATE.title}: ${toolName}`).slice(0, 120),
    status: (!canCompute ? "needs_human" : gaps.length ? "draft" : "complete") as Memo["status"],
    recommendation,
    horizonYears: years,
    buy,
    build,
    difference,
    prototypeOnlyCost,
    prototypeTrap:
      canCompute && build
        ? `A working prototype costs about $${prototypeOnlyCost!.toLocaleString("en-US")}, but it's only ${v.prototype_share_pct}% of the work. Built, hardened and run for ${years} years, it costs $${build.total.toLocaleString("en-US")}.`
        : null,
    breakEvenAnnualSubscription: breakEven,
    whatWouldChangeMyMind: flips,
    inputs,
    gaps,
    assumptionShareOfBuildCost: assumptionShare,
    generatedAt: now.toISOString(),
  };

  // Narrate and attest at the same time; neither changes a number.
  const [{ narrative, use: nUse }, attest] = await Promise.all([
    narrate(factsFor(draft), env),
    env.NEARAI_API_KEY ? attestNearAi(env) : Promise.resolve(null),
  ]);
  models.push(nUse);

  const privateInference = models.length > 0 && models.every((m) => m.provider === "nearai");
  const main = models[models.length - 1];
  const attestation = attest && "checks" in attest ? attest : null;
  const privateAi: PrivateAiSummary = {
    provider: main.provider,
    model: main.model,
    privateInference,
    attestation: attestation
      ? { verified: attestation.verified, signingAddress: attestation.node?.signingAddress ?? "", nonce: attestation.nonce, checkedAt: attestation.checkedAt, checks: attestation.checks, notCheckedHere: attestation.notCheckedHere }
      : null,
    note: privateInference
      ? attestation?.verified
        ? "Ran on NEAR AI Cloud inside a hardware enclave, and the enclave's attestation passed with a fresh nonce."
        : `Ran on NEAR AI Cloud, but the attestation check ${attestation ? "did not pass" : `couldn't run${attest && "error" in attest ? `: ${attest.error}` : ""}`}.`
      : main.provider === "anthropic"
        ? `Ran on Claude${main.fallbackFrom ? ` after NEAR AI failed (${main.fallbackFrom})` : ""}. Not private inference.`
        : "Ran on the built-in demo analyst. No AI model and no data left this server.",
  };

  return { ...draft, ...narrative, modelsUsed: models, privateAi };
}

export const FIELD_KEYS = FIELDS.map((f) => f.key);

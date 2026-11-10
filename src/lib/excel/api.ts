/**
 * What the Excel panel's routes answer, for every model: the questions to ask, the sheet layout,
 * and the explanation. Kept apart from the routes so build vs buy's older routes and the
 * newer per-model routes give the same answers.
 */
import { z } from "zod";
import { SUGGESTION_LABEL } from "../engine/advisorShared";
import { FIELD_GROUPS, FIELDS, TEMPLATE, toValues, resolveInputs, type FieldDef } from "../engine/buildVsBuy";
import { decide } from "../engine/decide";
import { decideCase } from "../engine/caseDecide";
import { CASE_TEMPLATES } from "../engine/cases";
import { givenValue } from "../schema";
import type { GivenValue } from "../engine/types";
import { buildVsBuySheet, SHEET_FIELDS, type SheetSpec } from "./buildVsBuySheet";
import { caseModelMeta, caseSheet, EXCEL_MODELS, isCaseSheetModel, requiredKeys, type CaseSheetModel } from "./caseSheets";

export type ExcelModel = "build_vs_buy" | CaseSheetModel;

export function isExcelModel(x: unknown): x is ExcelModel {
  return x === "build_vs_buy" || isCaseSheetModel(x);
}

const BVB_REQUIRED = ["buy_annual_cost", "prototype_weeks"];

function fieldsOf(model: ExcelModel): FieldDef[] {
  return model === "build_vs_buy" ? SHEET_FIELDS : caseModelMeta(model).drivers;
}

/** The form for one model: its groups, its questions with Uprali's benchmarks, and what's required. */
export function fieldsPayload(model: ExcelModel) {
  const fields = fieldsOf(model);
  const describe = (f: FieldDef, group: string) => ({
    key: f.key,
    label: f.label,
    unit: f.unit,
    group,
    ask: f.ask,
    help: f.help ?? null,
    benchmark: typeof f.benchmark === "function" ? "computed" : (f.benchmark ?? null),
    benchmarkSource: f.benchmarkSource ?? null,
    confirm: f.benchmark === undefined || !!f.humanShouldConfirm,
  });
  if (model === "build_vs_buy") {
    return {
      model,
      template: TEMPLATE,
      years: "choose",
      groups: FIELD_GROUPS.filter((g) => g.id === "buy" || g.id === "build"),
      required: BVB_REQUIRED,
      fields: fields.map((f) => describe(f, f.group ?? "general")),
    };
  }
  const meta = caseModelMeta(model);
  return {
    model,
    template: meta.template,
    years: 3,
    groups: meta.cards.filter((c) => meta.drivers.some((d) => d.card === c.id)).map((c) => ({ id: c.id, title: c.title, blurb: c.owner })),
    required: requiredKeys(meta.drivers),
    fields: meta.drivers.map((d) => describe(d, d.card)),
  };
}

/** Strict: only the model's own field keys, each a number, text or a sourced value. */
export function inputsBody(model: ExcelModel) {
  const keys = model === "build_vs_buy" ? FIELDS.map((f) => f.key) : fieldsOf(model).map((f) => f.key);
  const shape = Object.fromEntries(keys.map((k) => [k, givenValue.optional()]));
  return z.object({ inputs: z.object(shape).strict().optional() });
}

export function cleanFor(x: Record<string, unknown> | undefined): Record<string, GivenValue> {
  const out: Record<string, GivenValue> = {};
  for (const [k, v] of Object.entries(x ?? {})) if (v !== undefined && v !== null && v !== "") out[k] = v as GivenValue;
  return out;
}

/** Lays out the sheet, or says which number is still missing. */
export function layout(model: ExcelModel, inputs: Record<string, GivenValue>): { spec: SheetSpec } | { error: string } {
  const fields = fieldsOf(model);
  const required = model === "build_vs_buy" ? BVB_REQUIRED : requiredKeys(fields);
  const missing = required.filter((k) => inputs[k] === undefined);
  if (missing.length) {
    const labels = missing.map((k) => fields.find((f) => f.key === k)!.label.toLowerCase());
    return { error: `Add ${labels.join(", ")} first. Only you can give ${missing.length === 1 ? "that number" : "those numbers"}.` };
  }
  return { spec: model === "build_vs_buy" ? buildVsBuySheet(inputs) : caseSheet(model, inputs) };
}

const usd = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

/**
 * Uprali's view of the numbers in a sheet: the same rules as the sheet, so the panel can check
 * the two agree, plus the analyst's notes, marked as a suggestion. Nothing is saved or recorded.
 */
export async function explain(model: ExcelModel, inputs: Record<string, GivenValue>) {
  if (model === "build_vs_buy") {
    const m = await decide({ inputs });
    return {
      label: SUGGESTION_LABEL,
      model,
      generatedAt: m.generatedAt,
      status: m.status,
      totals: m.buy && m.build ? { buy: m.buy.total, build: m.build.total, difference: m.difference, breakEven: m.breakEvenAnnualSubscription } : null,
      checks: m.buy && m.build ? [{ name: "buy_total", label: "Cost to buy", value: m.buy.total }, { name: "build_total", label: "Cost to build", value: m.build.total }] : [],
      recommendation: m.recommendation,
      rules: {
        prototypeTrap: m.prototypeTrap,
        whatWouldChangeMyMind: m.whatWouldChangeMyMind.map((f) => f.text),
        lines: m.whatWouldChangeMyMind.map((f) => f.text),
        linesTitle: "What would change the answer (Uprali's rules, worked out from the numbers)",
        gaps: m.gaps.map((g) => `${g.label}: ${g.why}`),
      },
      ai: { usedAi: m.modelsUsed.some((x) => x.provider !== "demo"), biggestRisk: m.biggestRisk, cfoQuestions: m.cfoQuestions, summary: m.spoken30s, note: m.privateAi.note },
    };
  }
  if (model === "unit_economics") {
    // One customer in steady state: the new product engine's own unit economics, no AI.
    const t = CASE_TEMPLATES.new_product;
    const ins = resolveInputs({ ...inputs, new_customers_y1: 100, build_cost: 0 }, [], t.drivers);
    const out = t.compute(toValues(ins));
    const ue = (k: string) => out.unitEconomics.find((r) => r.key === k)?.values[1] ?? null;
    const ltv = ue("ltv"), payback = ue("cac_payback"), ratio = ue("ltv_cac");
    const headline = ratio === null ? "Not enough to judge yet" : ratio >= 3 ? "Healthy: lifetime value is 3 times CAC or more" : ratio >= 1 ? "Thin: a customer pays back CAC, but less than 3 times over" : "Losing money on each customer";
    const lines = [
      ltv !== null ? `Lifetime value of a customer: ${usd(ltv)}.` : "Lifetime value: not known without churn.",
      payback !== null ? `Months to earn back CAC: ${Math.round(payback * 10) / 10}.` : "Each customer doesn't earn back CAC: the price doesn't cover the cost to serve.",
      ratio !== null ? `Lifetime value to CAC: ${Math.round(ratio * 10) / 10}x. Healthy is 3 or more.` : "",
    ].filter(Boolean);
    const ins2 = resolveInputs(inputs, [], caseModelMeta("unit_economics").drivers);
    return {
      label: SUGGESTION_LABEL,
      model,
      generatedAt: new Date().toISOString(),
      status: "complete",
      totals: null,
      checks: [
        ...(ltv !== null ? [{ name: "ltv", label: "Lifetime value", value: ltv }] : []),
        ...(payback !== null ? [{ name: "months_to_recover_cac", label: "Months to earn back CAC", value: payback }] : []),
      ],
      recommendation: { option: null, headline, confidence: "medium", why: lines.join(" ") },
      rules: { lines, linesTitle: "Uprali's rules, worked out from the numbers", gaps: ins2.filter((i) => i.needsHuman).map((i) => `${i.label}: a benchmark is filling in until a person confirms it.`), whatWouldChangeMyMind: [] },
      ai: null,
    };
  }
  const m = await decideCase({ template: model, inputs });
  const lines = m.scenarios.map((s) => `${s.label} (${s.flex}): net present value ${usd(s.metrics.npv)}, net cash ${usd(s.metrics.cumulativeNet)}${s.capacity !== undefined ? `, freed-up time worth ${usd(s.capacity)}` : ""}.`);
  return {
    label: SUGGESTION_LABEL,
    model,
    generatedAt: m.generatedAt,
    status: m.status,
    totals: null,
    checks: m.metrics
      ? [
          { name: "net_total", label: "Net cash", value: m.metrics.cumulativeNet },
          { name: "net_present_value", label: "Net present value", value: m.metrics.npv },
        ]
      : [],
    recommendation: m.recommendation,
    rules: { lines: [...lines, ...m.guardrails.map((g) => `Guardrail: ${g}.`)], linesTitle: "Scenarios and guardrails (Uprali's rules, worked out from the numbers)", gaps: m.gaps.map((g) => `${g.label}: ${g.why}`), whatWouldChangeMyMind: [] },
    ai: { usedAi: m.modelsUsed.some((x) => x.provider !== "demo"), biggestRisk: m.biggestRisk, cfoQuestions: m.cfoQuestions, summary: m.spoken30s, note: m.privateAi.note },
  };
}

export { EXCEL_MODELS };

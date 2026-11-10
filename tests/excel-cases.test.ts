import { beforeAll, describe, expect, it } from "vitest";
import { FunctionArgumentType, FunctionPlugin, HyperFormula } from "hyperformula";
import { resolveInputs, toValues } from "@/lib/engine/buildVsBuy";
import { CASE_TEMPLATES, metricsFor } from "@/lib/engine/cases";
import { decideCase } from "@/lib/engine/caseDecide";
import { caseSheet, type CaseSheetModel } from "@/lib/excel/caseSheets";
import type { SheetSpec } from "@/lib/excel/buildVsBuySheet";
import type { GivenValue } from "@/lib/engine/types";

const DEMO = { LLM_PROVIDER: "demo" };
beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  delete process.env.NEARAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

/** Excel's FIXED, which the test formula engine doesn't ship. */
class FixedPlugin extends FunctionPlugin {
  fixed(ast: any, state: any) {
    return this.runFunction(ast.args, state, this.metadata("FIXED"), (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
}
(FixedPlugin as any).implementedFunctions = {
  FIXED: { method: "fixed", parameters: [{ argumentType: FunctionArgumentType.NUMBER }, { argumentType: FunctionArgumentType.NUMBER, defaultValue: 2 }] },
};
HyperFormula.registerFunctionPlugin(FixedPlugin as any, { enGB: { FIXED: "FIXED" } });

function parse(a: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function load(spec: SheetSpec) {
  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  const sheet = hf.getSheetId(hf.addSheet("Model"))!;
  for (const nm of spec.names) hf.addNamedExpression(nm.name, `=Model!$${nm.address.replace(/(\d+)$/, "$$$1")}`, sheet);
  for (const c of spec.cells) hf.setCellContents({ sheet, ...parse(c.address) }, [[c.formula ?? c.value ?? null]]);
  const addr = (n: string) => spec.names.find((x) => x.name === n)!.address;
  return {
    hf,
    sheet,
    named: (n: string) => hf.getCellValue({ sheet, ...parse(addr(n)) }),
    set: (n: string, v: number | string) => hf.setCellContents({ sheet, ...parse(addr(n)) }, [[v]]),
    errors: () =>
      spec.cells
        .filter((c) => c.formula)
        .map((c) => ({ c, v: hf.getCellValue({ sheet, ...parse(c.address) }) }))
        .filter(({ v }) => typeof v === "object" && v !== null)
        .map(({ c, v }) => `${c.address} ${c.formula} -> ${JSON.stringify(v)}`),
  };
}

async function engine(model: "new_product" | "ai_investment", given: Record<string, GivenValue>) {
  const memo = await decideCase({ template: model, inputs: given }, DEMO);
  return memo;
}

function expectMatches(l: ReturnType<typeof load>, memo: Awaited<ReturnType<typeof engine>>) {
  const m = memo.metrics!;
  expect(l.named("net_total")).toBe(m.cumulativeNet);
  expect(l.named("money_out_total")).toBe(m.totalCost);
  expect(l.named("money_in_total")).toBe(m.totalBenefit);
  expect(l.named("net_present_value")).toBe(m.npv);
  expect(l.named("return_on_investment")).toBe(m.roi === null ? "n/a" : m.roi);
  expect(l.named("payback_months")).toBe(m.paybackMonths === null ? "Not within 3 years" : m.paybackMonths);
  expect(l.named("recommendation")).toBe(memo.recommendation.headline);
  if (memo.capacityByYear) expect(l.named("capacity_total")).toBe(memo.capacityByYear.reduce((a, b) => a + b, 0));
}

const NP: Record<string, GivenValue> = { new_customers_y1: 60, price_per_month: 299, build_cost: 60000 };
const AIQ: Record<string, GivenValue> = { team_size: 12, hours_per_week: 10, seat_price_month: 30, time_saved_pct: 25 };

describe("Excel new product sheet", () => {
  it("matches the web app for the sample launch", async () => {
    const spec = caseSheet("new_product", NP);
    const l = load(spec);
    expect(l.errors()).toEqual([]);
    expectMatches(l, await engine("new_product", NP));
  });

  it("matches the engine's unit economics", async () => {
    const memo = await engine("new_product", NP);
    const l = load(caseSheet("new_product", NP));
    const ue = (k: string) => memo.unitEconomics.find((r) => r.key === k)!.values[1];
    expect(Math.round((l.named("ltv") as number) * 100) / 100).toBe(ue("ltv"));
    expect(Math.round((l.named("months_to_recover_cac") as number) * 100) / 100).toBe(ue("cac_payback"));
  });

  it("recalculates when an input changes", async () => {
    const l = load(caseSheet("new_product", NP));
    l.set("price_per_month", 49);
    l.set("cac", 1500);
    expectMatches(l, await engine("new_product", { ...NP, price_per_month: 49, cac: 1500 }));
  });

  it("agrees with the engine across random launches", async () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 25; i++) {
      const given: Record<string, GivenValue> = {
        new_customers_y1: Math.round(rnd() * 500),
        new_customer_growth_pct: Math.round(rnd() * 150) - 20,
        price_per_month: Math.round(rnd() * 900) + 5,
        annual_churn_pct: Math.round(rnd() * 50),
        cac: Math.round(rnd() * 3000),
        marketing_fixed_per_year: Math.round(rnd() * 80000),
        build_cost: Math.round(rnd() * 300000),
        team_cost_per_year: Math.round(rnd() * 200000),
        hosting_per_customer_month: Math.round(rnd() * 40),
        support_payments_pct: Math.round(rnd() * 15),
        discount_rate_pct: Math.round(rnd() * 25),
      };
      const l = load(caseSheet("new_product", given));
      expect(l.errors()).toEqual([]);
      expectMatches(l, await engine("new_product", given));
    }
  });
});

describe("Excel AI investment sheet", () => {
  it("matches the web app for the sample assistant, estimated and measured", async () => {
    for (const extra of [{}, { baseline_measured: "measured" }, { cash_share_pct: 50 }] as Array<Record<string, GivenValue>>) {
      const given = { ...AIQ, ...extra };
      const l = load(caseSheet("ai_investment", given));
      expect(l.errors()).toEqual([]);
      expectMatches(l, await engine("ai_investment", given));
    }
  });

  it("recalculates when the baseline is marked measured in the sheet", async () => {
    const l = load(caseSheet("ai_investment", AIQ));
    l.set("baseline_measured", "Measured ");
    expectMatches(l, await engine("ai_investment", { ...AIQ, baseline_measured: "measured" }));
  });

  it("agrees with the engine across random programs", async () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 25; i++) {
      const given: Record<string, GivenValue> = {
        team_size: Math.round(rnd() * 200) + 1,
        hours_per_week: Math.round(rnd() * 30),
        baseline_measured: rnd() > 0.5 ? "measured" : "estimated",
        estimate_haircut_pct: Math.round(rnd() * 50),
        loaded_hourly_cost: Math.round(rnd() * 150) + 10,
        time_saved_pct: Math.round(rnd() * 60),
        adoption_pct: Math.round(rnd() * 100),
        cash_share_pct: Math.round(rnd() * 100),
        seat_price_month: Math.round(rnd() * 100),
        rollout_cost: Math.round(rnd() * 50000),
        training_hours: Math.round(rnd() * 20),
        run_cost_per_year: Math.round(rnd() * 20000),
        discount_rate_pct: Math.round(rnd() * 20),
      };
      const l = load(caseSheet("ai_investment", given));
      expect(l.errors()).toEqual([]);
      expectMatches(l, await engine("ai_investment", given));
    }
  });
});

describe("Excel unit economics sheet", () => {
  it("matches the new product engine's numbers for one customer", () => {
    for (const given of [
      { price_per_month: 299 },
      { price_per_month: 49, hosting_per_customer_month: 12, support_payments_pct: 5, annual_churn_pct: 30, cac: 900 },
    ] as Array<Record<string, GivenValue>>) {
      const l = load(caseSheet("unit_economics", given));
      expect(l.errors()).toEqual([]);
      const t = CASE_TEMPLATES.new_product;
      const inputs = resolveInputs({ ...given, new_customers_y1: 100, build_cost: 0 }, [], t.drivers);
      const out = t.compute(toValues(inputs));
      const ue = (k: string) => out.unitEconomics.find((r) => r.key === k)!.values[1];
      expect(Math.round((l.named("ltv") as number) * 100) / 100).toBe(ue("ltv"));
      expect(Math.round((l.named("months_to_recover_cac") as number) * 100) / 100).toBe(ue("cac_payback"));
      expect(Math.round((l.named("ltv_to_cac") as number) * 100) / 100).toBe(ue("ltv_cac"));
      void metricsFor;
    }
  });

  it("says when each customer loses money", () => {
    const l = load(caseSheet("unit_economics", { price_per_month: 10, hosting_per_customer_month: 15 }));
    expect(l.named("months_to_recover_cac")).toBe("Never: each customer loses money");
    expect(String(l.hf.getCellValue({ sheet: l.sheet, row: 4, col: 1 }))).toMatch(/Losing money/);
  });
});

describe("every case sheet", () => {
  it("names its model and has no clashing names", () => {
    for (const model of ["new_product", "ai_investment", "unit_economics"] as CaseSheetModel[]) {
      const spec = caseSheet(model, model === "new_product" ? NP : model === "ai_investment" ? AIQ : { price_per_month: 99 });
      expect(spec.model).toBe(model);
      const names = spec.names.map((n) => n.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("uprali_model");
      for (const c of spec.checks) expect(names).toContain(c.name);
    }
  });
});

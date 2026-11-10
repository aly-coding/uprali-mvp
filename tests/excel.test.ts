import { beforeAll, describe, expect, it } from "vitest";
import { FunctionArgumentType, FunctionPlugin, HyperFormula } from "hyperformula";
import { breakEvenSubscription, buildSide, buySide, resolveInputs, toValues } from "@/lib/engine/buildVsBuy";
import { decide } from "@/lib/engine/decide";
import { buildVsBuySheet, colLetter, fromCell, toCell, type SheetSpec } from "@/lib/excel/buildVsBuySheet";
import { manifestXml } from "@/lib/excel/manifest";
import type { GivenValue } from "@/lib/engine/types";

beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  delete process.env.NEARAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

/** Excel's FIXED, which the test formula engine doesn't ship: a number as text with thousands separators. */
class FixedPlugin extends FunctionPlugin {
  fixed(ast: any, state: any) {
    return this.runFunction(ast.args, state, this.metadata("FIXED"), (n: number, d: number) =>
      n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
    );
  }
}
(FixedPlugin as any).implementedFunctions = {
  FIXED: { method: "fixed", parameters: [{ argumentType: FunctionArgumentType.NUMBER }, { argumentType: FunctionArgumentType.NUMBER, defaultValue: 2 }] },
};
HyperFormula.registerFunctionPlugin(FixedPlugin as any, { enGB: { FIXED: "FIXED" } });

function parseAddress(a: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** Loads the sheet into a formula engine, the way Excel would calculate it. */
function load(spec: SheetSpec) {
  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  const sheetName = hf.addSheet("Model");
  const sheet = hf.getSheetId(sheetName)!;
  for (const nm of spec.names) hf.addNamedExpression(nm.name, `=Model!$${nm.address.replace(/\d+$/, (d) => "$" + d)}`, sheet);
  for (const c of spec.cells) {
    const { row, col } = parseAddress(c.address);
    hf.setCellContents({ sheet, row, col }, [[c.formula ?? c.value ?? null]]);
  }
  const named = (n: string) => {
    const nm = spec.names.find((x) => x.name === n)!;
    const { row, col } = parseAddress(nm.address);
    return hf.getCellValue({ sheet, row, col });
  };
  const at = (a: string) => hf.getCellValue({ sheet, ...parseAddress(a) });
  const set = (n: string, v: number) => {
    const nm = spec.names.find((x) => x.name === n)!;
    hf.setCellContents({ sheet, ...parseAddress(nm.address) }, [[v]]);
  };
  return { hf, named, at, set };
}

const SAMPLE: Record<string, GivenValue> = {
  tool_name: "HubSpot Starter",
  what_to_build: "our own CRM",
  buy_annual_cost: 720,
  prototype_weeks: 3,
  integrations_count: 2,
  engineer_weekly_cost: 3800,
  opportunity_pct: 50,
};

describe("Excel build vs buy sheet", () => {
  it("matches the web app's numbers for the sample CRM case", async () => {
    const spec = buildVsBuySheet(SAMPLE);
    const { named, at } = load(spec);
    const memo = await decide({ inputs: SAMPLE }, { LLM_PROVIDER: "demo" });
    expect(named("buy_total")).toBe(memo.buy!.total);
    expect(named("build_total")).toBe(memo.build!.total);
    expect(named("difference")).toBe(memo.difference);
    expect(at(spec.check!.recommendation)).toBe(memo.recommendation.headline);
    const why = spec.cells.find((c) => c.formula?.startsWith('="Over '))!;
    expect(at(why.address)).toBe(`Over 3 years, building costs $${memo.build!.total.toLocaleString("en-US")} against $${memo.buy!.total.toLocaleString("en-US")} to buy, $${memo.difference!.toLocaleString("en-US")} more.`);
    // Break-even subscription row
    const be = spec.cells.find((c) => c.formula?.includes("price_growth_total"))!;
    expect(at(be.address)).toBe(memo.breakEvenAnnualSubscription);
    // Every year of every line matches the engine.
    for (const side of [memo.buy!, memo.build!]) {
      for (const line of side.lines) {
        const label = spec.cells.find((c) => c.value === line.label && c.address.startsWith("A"))!;
        const row = label.address.slice(1);
        line.byYear.forEach((v, y) => expect(at(`${colLetter(1 + y)}${row}`)).toBe(v));
      }
    }
  });

  it("recalculates when an input changes, and still matches the engine", () => {
    const spec = buildVsBuySheet(SAMPLE);
    const { named, set } = load(spec);
    set("buy_annual_cost", 90000);
    set("buy_price_increase_pct", 0.1);
    set("prototype_weeks", 2);
    const v = toValues(resolveInputs({ ...SAMPLE, buy_annual_cost: 90000, buy_price_increase_pct: 10, prototype_weeks: 2 }, []));
    expect(named("buy_total")).toBe(buySide(v).total);
    expect(named("build_total")).toBe(buildSide(v).total);
    expect(named("difference")).toBeLessThan(0); // building is now cheaper
  });

  it("agrees with the engine across many random cases and horizons", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const given: Record<string, GivenValue> = {
        buy_annual_cost: Math.round(rnd() * 200_000),
        buy_setup_cost: Math.round(rnd() * 20_000),
        buy_price_increase_pct: Math.round(rnd() * 20),
        buy_admin_hours_month: Math.round(rnd() * 20),
        prototype_weeks: 0.5 + Math.round(rnd() * 30),
        prototype_share_pct: 5 + Math.round(rnd() * 90),
        engineer_weekly_cost: 1000 + Math.round(rnd() * 6000),
        integrations_count: Math.round(rnd() * 6),
        integration_weeks_each: Math.round(rnd() * 40) / 10,
        maintenance_pct: Math.round(rnd() * 40),
        security_annual: Math.round(rnd() * 20_000),
        hosting_annual: Math.round(rnd() * 5_000),
        oncall_hours_week: Math.round(rnd() * 10),
        builder_leaves_pct: Math.round(rnd() * 30),
        handover_weeks: Math.round(rnd() * 10),
        opportunity_pct: Math.round(rnd() * 150),
        horizon_years: 1 + Math.floor(rnd() * 10),
      };
      const spec = buildVsBuySheet(given);
      const { named } = load(spec);
      const v = toValues(resolveInputs(given, []));
      expect(spec.horizonYears).toBe(given.horizon_years);
      expect(named("buy_total")).toBe(buySide(v).total);
      expect(named("build_total")).toBe(buildSide(v).total);
      const be = spec.cells.find((c) => c.formula?.includes("price_growth_total"))!;
      expect(load(spec).at(be.address)).toBe(Math.round(breakEvenSubscription(v)));
    }
  });

  it("fills blanks with benchmarks and says so", () => {
    const spec = buildVsBuySheet({ buy_annual_cost: 720, prototype_weeks: 3 });
    const share = spec.cells.find((c) => c.value === "Prototype's share of the real build")!;
    const row = share.address.slice(1);
    expect(spec.cells.find((c) => c.address === `B${row}`)!.value).toBe(0.2);
    expect(String(spec.cells.find((c) => c.address === `D${row}`)!.value)).toMatch(/Benchmark/);
    expect(spec.horizonYears).toBe(3);
  });

  it("has no formula with an unknown name", () => {
    const spec = buildVsBuySheet(SAMPLE);
    const { hf } = load(spec);
    const sheet = hf.getSheetId("Model")!;
    for (const c of spec.cells.filter((x) => x.formula)) {
      const v = hf.getCellValue({ sheet, ...parseAddress(c.address) });
      expect(typeof v === "object" && v !== null ? `${c.address} ${c.formula} -> ${JSON.stringify(v)}` : "ok").toBe("ok");
    }
  });

  it("converts percents between the sheet and the engine", () => {
    expect(toCell("pct", 7)).toBe(0.07);
    expect(fromCell("pct", 0.07)).toBe(7);
    expect(fromCell("usd", "$1,200")).toBe(1200);
    expect(fromCell("usd", "")).toBeNull();
  });
});

describe("Excel manifest", () => {
  it("points every URL at the site it's served from, over https", () => {
    const xml = manifestXml("https://www.example.com");
    expect(xml).toContain("<SourceLocation DefaultValue=\"https://www.example.com/excel/taskpane.html\"/>");
    expect(xml).toContain("<Host Name=\"Workbook\"/>");
    const urls = [...xml.matchAll(/DefaultValue="(https?:[^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls) expect(u.startsWith("https://")).toBe(true);
    expect(xml).not.toMatch(/localhost/);
  });
});

import { describe, expect, it } from "vitest";
import { activeShare, normalizeRoiType, optionValue, payback, statusQuo } from "@/lib/engine/value";
import { decide } from "@/lib/engine/decide";

const env = {};

// The worked example from the completed buy vs build business definition (a synthetic fixture):
// 25% time saved x 80% adoption, one confirmed avoided hire, prorated benefits, confirmed-savings policy.
describe("worked example from the finance playbook", () => {
  const buy = optionValue({ option: "buy", label: "Buy", investmentByYear: [54_000, 39_000, 39_000], confirmedAnnual: 60_000, capacityAnnual: 1_116_000, ttvMonths: 3 });
  const build = optionValue({ option: "build", label: "Build", investmentByYear: [1_030_000, 30_000, 30_000], confirmedAnnual: 60_000, capacityAnnual: 1_116_000, ttvMonths: 6 });

  it("prorates year 1 by time to value", () => {
    expect(buy.financialByYear![0]).toBe(45_000);
    expect(buy.capacityByYear![0]).toBe(837_000);
    expect(build.financialByYear![0]).toBe(30_000);
    expect(build.capacityByYear![0]).toBe(558_000);
  });

  it("matches the buy ROI and payback", () => {
    expect(buy.netRoi).toBe(0.25);
    expect(buy.grossRoi).toBe(23.5);
    expect(buy.payback).toMatchObject({ months: 17.1, years: 1.42 });
  });

  it("matches the build ROI and payback", () => {
    expect(build.netRoi).toBeCloseTo(-0.8624, 4);
    expect(build.grossRoi).toBeCloseTo(1.697248, 6);
    expect(build.payback).toEqual({ months: null, years: null, text: "Beyond 36 months" });
  });

  it("treats the status quo as the baseline", () => {
    expect(statusQuo(3)).toMatchObject({ investment: 0, netRoi: null, payback: { text: "Not applicable" } });
  });
});

describe("value rules", () => {
  it("never treats missing savings as zero", () => {
    const o = optionValue({ option: "buy", label: "Buy", investmentByYear: [10, 10, 10], confirmedAnnual: null, capacityAnnual: 100, ttvMonths: 0 });
    expect(o.netRoi).toBeNull();
    expect(o.grossRoi).toBeNull();
    expect(o.payback.text).toBe("Needs confirmed savings");
  });

  it("counts benefit only after launch", () => {
    expect(activeShare(3, 3)).toEqual([0.75, 1, 1]);
    expect(activeShare(18, 3)).toEqual([0, 0.5, 1]);
  });

  it("pays back in month 0 when there's no deficit", () => {
    expect(payback([0, 0, 0], [10, 10, 10]).months).toBe(0);
  });

  it("reads the kind of return", () => {
    expect(normalizeRoiType("Risk: SOC 2 compliance")).toBe("risk");
    expect(normalizeRoiType("strategic, improves retention")).toBe("strategic");
    expect(normalizeRoiType("hard cash savings")).toBe("hard");
    expect(normalizeRoiType("not sure")).toBeNull();
  });
});

describe("value case in the memo", () => {
  const base = { buy_annual_cost: 720, prototype_weeks: 3, tool_name: "HubSpot" };

  it("adds three options, funding and kill criteria", async () => {
    const m = await decide({ inputs: { ...base, confirmed_annual_savings: 0, work_hours_year: 5000, time_reduction_pct: 20, staff_hourly_cost: 60, decision_owner: "Aly" } }, env);
    expect(m.value!.options.map((o) => o.option)).toEqual(["status_quo", "buy", "build"]);
    expect(m.value!.scenarios!.map((s) => s.name)).toEqual(["conservative", "base", "optimistic"]);
    const [cons, , opt] = m.value!.scenarios!;
    expect(cons.buy.capacity!).toBeLessThan(opt.buy.capacity!);
    expect(m.funding!.criteria.length).toBeGreaterThan(0);
    expect(m.funding!.notNow.length).toBeGreaterThan(0);
    expect(m.killCriteria).toMatchObject({ owner: "Aly" });
    expect(m.value!.opportunity.note).toMatch(/kept out of ROI and payback/);
  });

  it("keeps the cost comparison when no value inputs are given", async () => {
    const m = await decide({ inputs: base }, env);
    expect(m.recommendation.option).toBe("buy");
    expect(m.gaps.map((g) => g.key)).not.toContain("confirmed_annual_savings");
    expect(m.value!.missing.map((x) => x.key)).toContain("confirmed_annual_savings");
    expect(m.killCriteria!.owner).toBeNull();
  });

  it("says not now when neither option pays back in cash", async () => {
    const m = await decide({ inputs: { ...base, buy_annual_cost: 90_000, confirmed_annual_savings: 1_000, roi_type: "hard" } }, env);
    expect(m.recommendation.option).toBe("status_quo");
    expect(m.recommendation.headline).toMatch(/Not now/);
  });

  it("doesn't say not now for a risk return", async () => {
    const m = await decide({ inputs: { ...base, buy_annual_cost: 90_000, confirmed_annual_savings: 1_000, roi_type: "risk: compliance" } }, env);
    expect(m.recommendation.option).not.toBe("status_quo");
  });
});

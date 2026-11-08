import { describe, expect, it } from "vitest";
import { buildVsBuy, newHire } from "@/lib/templates";

describe("build vs buy", () => {
  const base = { option_name: "HubSpot Starter", buy_annual_cost: 720, buy_setup_cost: 0, build_weeks: 2, engineer_weekly_cost: 4000, maintenance_pct: 20, horizon_years: 3 };

  it("recommends buying when the subscription is cheaper over the horizon", () => {
    const r = buildVsBuy.compute(base);
    // build: 8000 + 8000*0.2*3 = 12800 (shown as $13k); buy: 720*3 = 2160
    expect(r.recommendedOption).toBe("Buy HubSpot Starter");
    expect(r.metrics.find((m) => m.label === "Build over 3 years")?.value).toBe("$13k");
    expect(r.metrics.find((m) => m.label === "Buy over 3 years")?.value).toBe("$2,160");
    expect(r.whatIf).toContain("$4,267"); // break-even subscription: 12800 / 3
  });

  it("recommends building when buying is far more expensive", () => {
    const r = buildVsBuy.compute({ ...base, buy_annual_cost: 60000 });
    expect(r.recommendedOption).toBe("Build it ourselves");
    expect(r.costAndPayback).toContain("pays for itself");
  });
});

describe("new hire", () => {
  const base = { role: "account executive", annual_salary: 120000, benefits_pct: 25, recruiting_cost: 20000, ramp_months: 3, annual_value: 300000, payback_target_months: 12 };

  it("computes payback from ramp, loaded cost and value", () => {
    const r = newHire.compute(base);
    // monthly cost 12500, monthly value 25000: (20000 + 75000) / 12500 = 7.6 months
    expect(r.metrics.find((m) => m.label === "Payback")?.value).toBe("7.6 months");
    expect(r.recommendedOption).toBe("Hire the account executive");
  });

  it("says wait when payback misses the target", () => {
    const r = newHire.compute({ ...base, annual_value: 160000 });
    expect(r.recommendedOption).toBe("Wait on this hire");
  });

  it("handles a hire that never pays back", () => {
    const r = newHire.compute({ ...base, annual_value: 100000 });
    expect(r.metrics.find((m) => m.label === "Payback")?.value).toBe("never at these numbers");
  });
});

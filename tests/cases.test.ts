import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { decideCase, demoCaseExtract } from "@/lib/engine/caseDecide";
import { CASE_TEMPLATES, CASE_TEMPLATE_IDS, metricsFor, scenariosFor } from "@/lib/engine/cases";
import { buildSnapshot, hashSnapshot } from "@/lib/engine/snapshot";
import { caseToMarkdown } from "@/lib/engine/markdown";
import { decideBody } from "@/lib/schema";

const DEMO = { LLM_PROVIDER: "demo" };

beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  process.env.LOCAL_LEDGER_PATH = path.join(os.tmpdir(), `uprali-cases-${Date.now()}.json`);
  delete process.env.NEAR_CONTRACT_ID;
  delete process.env.NEARAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("business-case templates", () => {
  it("each template's own example reads its numbers and gives a full three-year model", async () => {
    for (const id of CASE_TEMPLATE_IDS) {
      const t = CASE_TEMPLATES[id];
      const m = await decideCase({ template: id, question: t.prompt }, DEMO);
      expect(m.status).not.toBe("needs_human");
      expect(m.metrics).not.toBeNull();
      for (const r of [...m.model, ...m.pnl]) expect(r.values).toHaveLength(4);
      expect(m.scenarios.map((s) => s.id)).toEqual(["downside", "base", "upside"]);
      // Every driver is in the memo with a source and an owner.
      expect(m.inputs.map((i) => i.key)).toEqual(t.drivers.map((d) => d.key));
      for (const i of m.inputs) expect(i.source.length).toBeGreaterThan(0);
      // Every card has its formula and an owner role.
      for (const c of m.cards) expect(c.formula && c.owner).toBeTruthy();
      expect(m.cfoQuestions).toHaveLength(3);
    }
  });

  it("downside is never better than base, and upside never worse", async () => {
    for (const id of CASE_TEMPLATE_IDS) {
      const m = await decideCase({ template: id, question: CASE_TEMPLATES[id].prompt }, DEMO);
      const [down, base, up] = m.scenarios.map((s) => s.metrics.npv);
      expect(down).toBeLessThanOrEqual(base);
      expect(up).toBeGreaterThanOrEqual(base);
    }
  });

  it("launch a product: revenue is average customers times price, and it says go on the example", async () => {
    const m = await decideCase({ template: "new_product", question: CASE_TEMPLATES.new_product.prompt }, DEMO);
    const end = m.model.find((r) => r.key === "customers_end")!.values;
    const rev = m.model.find((r) => r.key === "revenue")!.values;
    expect(end[1]).toBe(60);
    expect(rev[1]).toBeCloseTo((60 / 2) * 299 * 12, 0);
    expect(m.recommendation.option).toBe("go");
    expect(m.metrics!.paybackMonths).not.toBeNull();
  });

  it("AI investment keeps cash apart from freed-up time and cuts an estimated baseline", async () => {
    const q = CASE_TEMPLATES.ai_investment.prompt;
    const est = await decideCase({ template: "ai_investment", question: q }, DEMO);
    const measured = await decideCase({ template: "ai_investment", question: q, inputs: { baseline_measured: "measured" } }, DEMO);
    const saved = (m: typeof est) => m.model.find((r) => r.key === "hours_saved")!.values[3]!;
    // 12 people x 10 h x 46 weeks x 25% x 70% adoption, minus the 30% haircut while it's only an estimate.
    expect(saved(measured)).toBeCloseTo(12 * 10 * 46 * 0.25 * 0.7, 0);
    expect(saved(est)).toBeCloseTo(saved(measured) * 0.7, 0);
    // No confirmed cash: the case can only be a pilot, never counted as savings.
    expect(est.metrics!.totalBenefit).toBe(0);
    expect(est.recommendation.option).toBe("pilot");
    expect(est.capacityByYear!.every((x) => x > 0)).toBe(true);
    // Once Finance confirms half the time becomes cash, the cash case moves.
    const cash = await decideCase({ template: "ai_investment", question: q, inputs: { baseline_measured: "measured", cash_share_pct: 50 } }, DEMO);
    expect(cash.metrics!.totalBenefit).toBeGreaterThan(0);
  });

  it("a missing number only a person can give stops the case and says so", async () => {
    const m = await decideCase({ template: "gtm_expansion", question: "We want to expand into Germany." }, DEMO);
    expect(m.status).toBe("needs_human");
    expect(m.metrics).toBeNull();
    expect(m.recommendation.option).toBeNull();
    expect(m.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["target_customers_y3", "acv"]));
  });

  it("numbers a person typed win over the text and count as theirs", async () => {
    const m = await decideCase({ template: "new_product", question: CASE_TEMPLATES.new_product.prompt, inputs: { build_cost: { value: 90_000, source: "Agency quote", owner: "human" } } }, DEMO);
    expect(m.inputs.find((i) => i.key === "build_cost")).toMatchObject({ value: 90_000, owner: "human", source: "Agency quote", isAssumption: false });
    expect(m.model.find((r) => r.key === "build")!.values[1]).toBe(90_000);
  });

  it("reads numbers from text only when they're there", () => {
    expect(demoCaseExtract(CASE_TEMPLATES.new_product, "No numbers here.")).toEqual([]);
    const e = demoCaseExtract(CASE_TEMPLATES.ai_investment, CASE_TEMPLATES.ai_investment.prompt);
    expect(Object.fromEntries(e.map((x) => [x.key, x.value]))).toMatchObject({ team_size: 12, hours_per_week: 10, seat_price_month: 30, time_saved_pct: 25, baseline_measured: "estimated" });
  });

  it("payback and NPV follow the cash", () => {
    const m = metricsFor({ benefitByYear: [0, 100, 100], costByYear: [100, 0, 0], netByYear: [-100, 100, 100] }, 0);
    expect(m.npv).toBe(100);
    expect(m.paybackMonths).toBe(24);
    expect(m.roi).toBe(1);
    expect(metricsFor({ benefitByYear: [10, 10, 10], costByYear: [100, 0, 0], netByYear: [-90, 10, 10] }, 10).paybackMonths).toBeNull();
    expect(metricsFor({ benefitByYear: [200, 200, 200], costByYear: [50, 50, 50], netByYear: [150, 150, 150] }, 10).paybackMonths).toBe(3);
  });

  it("scenarios move only the key drivers", () => {
    const t = CASE_TEMPLATES.new_product;
    const base = { new_customers_y1: 100, new_customer_growth_pct: 50, price_per_month: 50, annual_churn_pct: 15, cac: 800, marketing_fixed_per_year: 20_000, build_cost: 60_000, team_cost_per_year: 80_000, hosting_per_customer_month: 5, support_payments_pct: 8, discount_rate_pct: 10 };
    const s = scenariosFor(t, base);
    expect(s[0].flex.toLowerCase()).toContain("price per customer per month");
    expect(s[0].flex).not.toContain("discount");
  });

  it("fingerprints a case snapshot with its template and metrics, and build vs buy snapshots keep no metrics key", async () => {
    const m = await decideCase({ template: "new_product", question: CASE_TEMPLATES.new_product.prompt }, DEMO);
    const s = buildSnapshot(m, { decidedBy: "test", decidedAt: "2026-11-08T00:00:00.000Z" });
    expect(s.template).toBe("new_product");
    expect(s.metrics?.npv).toBe(m.metrics!.npv);
    expect(s.totals).toEqual({ buy: null, build: null, difference: null });
    const changed = { ...s, metrics: { ...s.metrics!, npv: s.metrics!.npv + 1 } };
    expect(await hashSnapshot(changed)).not.toBe(await hashSnapshot(s));
    expect(caseToMarkdown(m)).toContain("## Summary P&L");
  });

  it("checks inputs against the chosen template", () => {
    expect(decideBody.safeParse({ template: "new_product", inputs: { price_per_month: 50 } }).success).toBe(true);
    expect(decideBody.safeParse({ template: "new_product", inputs: { buy_annual_cost: 50 } }).success).toBe(false);
    expect(decideBody.safeParse({ inputs: { buy_annual_cost: 50 } }).success).toBe(true);
    expect(decideBody.safeParse({ template: "nope" }).success).toBe(false);
  });
});

describe("business-case routes", () => {
  it("runs a case from the app route, keeps it in history, and verifies its snapshot", async () => {
    const { POST } = await import("@/app/api/app/decide/route");
    const { POST: recordRoute } = await import("@/app/api/app/record/route");
    const { POST: verifyRoute } = await import("@/app/api/v1/decisions/verify/route");
    const res = await POST(post("/api/app/decide", { template: "gtm_expansion", question: CASE_TEMPLATES.gtm_expansion.prompt, decided_by: "demo-user" }));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.memo.schema).toBe("uprali.case.v1");
    expect(r.snapshot.template).toBe("gtm_expansion");
    expect(await hashSnapshot(r.snapshot)).toBe(r.fingerprint);
    expect(r.runId).toBeTruthy();
    const rec = await recordRoute(post("/api/app/record", { snapshot: r.snapshot }));
    expect(rec.status).toBe(200);
    const v = await (await verifyRoute(post("/api/v1/decisions/verify", { snapshot: r.snapshot }))).json();
    expect(v.matches).toBe(true);
  });

  it("lists the templates and runs one over the API", async () => {
    const { GET } = await import("@/app/api/v1/templates/route");
    const d = await (await GET()).json();
    expect(d.templates.map((t: { id: string }) => t.id)).toEqual(["build_vs_buy", ...CASE_TEMPLATE_IDS]);
    const { POST } = await import("@/app/api/v1/business-case/route");
    const ok = await POST(post("/api/v1/business-case", { template: "ai_investment", question: CASE_TEMPLATES.ai_investment.prompt }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).memo.recommendation.option).toBe("pilot");
    const bad = await POST(post("/api/v1/business-case", { template: "build_vs_buy" }));
    expect(bad.status).toBe(400);
  });
});

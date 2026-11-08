import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSide, buySide, FIELDS, parseAmount, resolveInputs, toValues } from "@/lib/engine/buildVsBuy";
import { checkExtraction, demoExtract, proseUsesOnlyKnownNumbers } from "@/lib/engine/analyst";
import { decide } from "@/lib/engine/decide";
import { providerOrder } from "@/lib/engine/providers";
import { memoToMarkdown } from "@/lib/engine/markdown";

const DEMO = { LLM_PROVIDER: "demo" };
const Q = "Should we build our own CRM or keep paying $720 a year for HubSpot Starter? Our engineer built a working prototype in 3 weeks. It needs 2 integrations.";

afterEach(() => vi.unstubAllGlobals());

describe("cost model", () => {
  const base = resolveInputs({ buy_annual_cost: 720, prototype_weeks: 3, engineer_weekly_cost: 4000 }, []);
  const v = toValues(base);

  it("treats the prototype as 20% of the real build", () => {
    const build = buildSide(v);
    const proto = build.lines.find((l) => l.key === "build_prototype")!;
    const prod = build.lines.find((l) => l.key === "build_production")!;
    expect(proto.total).toBe(12_000);
    expect(prod.total).toBe(48_000); // 15 weeks in total, 12 more after the prototype
  });

  it("counts every hidden cost line over the horizon", () => {
    const build = buildSide(v);
    const keys = build.lines.map((l) => l.key);
    for (const k of ["build_maintenance", "build_security", "build_hosting", "build_oncall", "build_knowledge_loss", "build_opportunity", "build_integrations"]) {
      expect(keys).toContain(k);
    }
    expect(build.byYear).toHaveLength(3);
    expect(build.byYear.reduce((a, b) => a + b, 0)).toBe(build.total);
  });

  it("applies the yearly price increase to the subscription", () => {
    const buy = buySide(v);
    const sub = buy.lines.find((l) => l.key === "buy_subscription")!;
    expect(sub.byYear[0]).toBe(720);
    expect(sub.byYear[1]).toBe(770); // 720 × 1.07, rounded
  });

  it("reads amounts people write", () => {
    expect(parseAmount("$12k")).toBe(12_000);
    expect(parseAmount("1.5 million")).toBe(1_500_000);
    expect(parseAmount("$3,500")).toBe(3500);
  });
});

describe("where each number comes from", () => {
  it("ranks a caller's value over the question, and the question over a benchmark", () => {
    const inputs = resolveInputs(
      { buy_annual_cost: { value: 900, source: "Invoice", owner: "human" } },
      [{ key: "buy_annual_cost", value: "720", quote: "$720 a year" }, { key: "prototype_weeks", value: "3", quote: "3 weeks" }],
    );
    const byKey = Object.fromEntries(inputs.map((i) => [i.key, i]));
    expect(byKey.buy_annual_cost).toMatchObject({ value: 900, source: "Invoice", owner: "human", isAssumption: false });
    expect(byKey.prototype_weeks).toMatchObject({ value: 3, owner: "human", isAssumption: false });
    expect(byKey.maintenance_pct).toMatchObject({ owner: "agent", isAssumption: true });
  });

  it("marks numbers only a person can give as needing a human", () => {
    const inputs = resolveInputs({}, []);
    const missing = inputs.filter((i) => i.value === null).map((i) => i.key);
    expect(missing).toEqual(expect.arrayContaining(["buy_annual_cost", "prototype_weeks"]));
    expect(inputs.find((i) => i.key === "engineer_weekly_cost")).toMatchObject({ needsHuman: true, owner: "agent" });
  });

  it("covers every field in the template", () => {
    expect(resolveInputs({}, []).map((i) => i.key)).toEqual(FIELDS.map((f) => f.key));
  });
});

describe("guards on the models", () => {
  it("drops an extracted number that isn't in its quote", () => {
    const data = { values: [{ key: "buy_annual_cost", value: "72000", quote: "$720 a year" }, { key: "prototype_weeks", value: "3", quote: "prototype in 3 weeks" }] };
    expect(checkExtraction(Q, data).map((e) => e.key)).toEqual(["prototype_weeks"]);
  });

  it("drops a quote the person never wrote", () => {
    const data = { values: [{ key: "buy_annual_cost", value: "100", quote: "$100 a year" }] };
    expect(checkExtraction(Q, data)).toEqual([]);
  });

  it("rejects prose with dollar amounts the engine didn't compute", () => {
    const allowed = new Set(["720", "12000"]);
    expect(proseUsesOnlyKnownNumbers("Buying is $720 and the prototype $12,000.", allowed)).toBe(true);
    expect(proseUsesOnlyKnownNumbers("Building saves $50,000.", allowed)).toBe(false);
  });

  it("reads the demo question without a model", () => {
    const keys = demoExtract(Q).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["buy_annual_cost", "prototype_weeks", "integrations_count", "tool_name", "what_to_build"]));
  });
});

describe("decide", () => {
  it("recommends buying when the build costs far more, with no AI key", async () => {
    const memo = await decide({ question: Q }, DEMO);
    expect(memo.recommendation.option).toBe("buy");
    expect(memo.recommendation.headline).toBe("Buy HubSpot Starter");
    expect(memo.status).toBe("draft"); // some numbers are still benchmarks a person should confirm
    expect(memo.prototypeTrap).toMatch(/only 20% of the work/);
    expect(memo.cfoQuestions).toHaveLength(3);
    expect(memo.privateAi.provider).toBe("demo");
    expect(memo.modelsUsed.every((m) => m.provider === "demo")).toBe(true);
  });

  it("says it needs a human when the key numbers are missing", async () => {
    const memo = await decide({ question: "Should we build or buy a CRM?" }, DEMO);
    expect(memo.status).toBe("needs_human");
    expect(memo.recommendation.option).toBeNull();
    expect(memo.build).toBeNull();
    expect(memo.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["buy_annual_cost", "prototype_weeks"]));
  });

  it("is complete once a person has given every number that needs one", async () => {
    const memo = await decide(
      { question: Q, inputs: { engineer_weekly_cost: 4000, opportunity_pct: 50, tool_name: "HubSpot" } },
      DEMO,
    );
    expect(memo.status).toBe("complete");
    expect(memo.gaps).toEqual([]);
  });

  it("recommends building when the subscription is huge", async () => {
    const memo = await decide({ inputs: { buy_annual_cost: 400_000, prototype_weeks: 2 } }, DEMO);
    expect(memo.recommendation.option).toBe("build");
  });

  it("falls back from NEAR AI to the demo analyst and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const memo = await decide({ question: Q }, { NEARAI_API_KEY: "test" });
    expect(memo.modelsUsed[0].provider).toBe("demo");
    expect(memo.modelsUsed[0].fallbackFrom).toBeTruthy();
    expect(memo.privateAi.privateInference).toBe(false);
  });

  it("renders a markdown memo with sources", async () => {
    const memo = await decide({ question: Q }, DEMO);
    const md = memoToMarkdown(memo, { fingerprint: "ab".repeat(32) });
    expect(md).toContain("Every number, with its source and owner");
    expect(md).toContain('Stated in the request: "$720 a year"');
  });
});

describe("provider order", () => {
  it("prefers private NEAR AI, then Claude, then the demo", () => {
    expect(providerOrder({ NEARAI_API_KEY: "a", ANTHROPIC_API_KEY: "b" })).toEqual(["nearai", "anthropic", "demo"]);
    expect(providerOrder({ ANTHROPIC_API_KEY: "b" })).toEqual(["anthropic", "demo"]);
    expect(providerOrder({ LLM_PROVIDER: "demo", NEARAI_API_KEY: "a" })).toEqual(["demo"]);
  });
});

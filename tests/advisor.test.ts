import { describe, expect, it } from "vitest";
import { ADVISOR_QUESTIONS, SUGGESTION_LABEL, advise, cleanAdvice, demoAdvice, seatsFrom } from "@/lib/engine/advisor";
import { resolveInputs } from "@/lib/engine/buildVsBuy";

const DEMO = { LLM_PROVIDER: "demo" };

describe("advisor", () => {
  it("asks the five questions before suggesting", () => {
    expect(ADVISOR_QUESTIONS.map((q) => q.key)).toEqual(["must_haves", "seats", "budget_per_year", "current_tool", "integrations"]);
  });

  it("suggests cheaper CRMs than Salesforce, cheapest first, each labelled a suggestion", async () => {
    const a = await advise("We pay for Salesforce. Should we build our own CRM?", { must_haves: "pipeline, email", seats: "5 people", current_tool: "Salesforce Pro" }, DEMO);
    expect(a.category).toBe("CRM");
    expect(a.label).toBe(SUGGESTION_LABEL);
    expect(a.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(a.suggestions.every((s) => s.label === SUGGESTION_LABEL)).toBe(true);
    expect(a.suggestions.some((s) => /salesforce/i.test(s.name))).toBe(false);
    const prices = a.suggestions.map((s) => s.pricePerSeatMonth ?? 0);
    expect([...prices].sort((x, y) => x - y)).toEqual(prices);
    const first = a.suggestions[0];
    expect(first.estimatedAnnual).toBe(Math.round((first.pricePerSeatMonth ?? 0) * 5 * 12));
    expect(a.note).toMatch(/verify/i);
    // Unanswered questions come back as follow-ups.
    expect(a.followUps).toContain(ADVISOR_QUESTIONS.find((q) => q.key === "budget_per_year")!.ask);
    expect(a.use.provider).toBe("demo");
  });

  it("picks the support catalogue for a help desk question", () => {
    expect(demoAdvice("Build our own help desk or keep Zendesk?", {}).category).toBe("Customer support");
  });

  it("keeps a model's answer small and drops bad prices", () => {
    const a = cleanAdvice(
      {
        category: "CRM",
        advice: "x".repeat(1000),
        follow_ups: ["Do you need quotes?"],
        suggestions: [
          { name: "Good", plan: "Pro", price_per_seat_month: 12.345, covers: ["a"], gaps: [], why: "fits" },
          { name: "Bad price", plan: "", price_per_seat_month: -3, covers: [], gaps: [], why: "" },
          { name: "", plan: "No name", price_per_seat_month: 1, covers: [], gaps: [], why: "" },
          { name: "Huge", plan: "", price_per_seat_month: 1e9, covers: [], gaps: [], why: "" },
        ],
      },
      { seats: "3", must_haves: "a", budget_per_year: "1000", current_tool: "none", integrations: "none" },
    );
    expect(a.suggestions.map((s) => s.name)).toEqual(["Good", "Bad price", "Huge"]);
    expect(a.suggestions[0].pricePerSeatMonth).toBe(12.35);
    expect(a.suggestions[0].estimatedAnnual).toBe(Math.round(12.35 * 3 * 12));
    expect(a.suggestions[1].pricePerSeatMonth).toBeNull();
    expect(a.suggestions[2].pricePerSeatMonth).toBeNull();
    expect(a.advice.length).toBeLessThanOrEqual(400);
    expect(a.followUps).toEqual(["Do you need quotes?"]);
  });

  it("reads seats from plain words", () => {
    expect(seatsFrom({ seats: "about 12 people" })).toBe(12);
    expect(seatsFrom({ seats: "a few" })).toBeNull();
    expect(seatsFrom({})).toBeNull();
  });

  it("marks a picked suggestion as the agent's, not a fact", () => {
    const inputs = resolveInputs(
      {
        tool_name: { value: "Freshsales Growth", owner: "agent", is_assumption: true, source: "Suggestion from Uprali's advisor. Verify the price on the vendor's site" },
        buy_annual_cost: { value: 660, owner: "agent", is_assumption: true, source: "Suggestion from Uprali's advisor. Verify the price on the vendor's site" },
      },
      [],
    );
    const cost = inputs.find((i) => i.key === "buy_annual_cost")!;
    expect(cost.owner).toBe("agent");
    expect(cost.isAssumption).toBe(true);
    expect(cost.source).toMatch(/^Suggestion/);
  });
});

describe("advise route", () => {
  it("answers with suggestions and rejects unknown answer fields", async () => {
    process.env.LLM_PROVIDER = "demo";
    const { POST, GET } = await import("@/app/api/app/advise/route");
    expect((await (await GET()).json()).questions).toHaveLength(5);
    const req = (body: unknown) => new Request("http://localhost/api/app/advise", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify(body) });
    const ok = await POST(req({ question: "CRM: build or buy?", answers: { seats: "4" } }));
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.suggestions[0].label).toBe(SUGGESTION_LABEL);
    const bad = await POST(req({ answers: { ignore_rules: "yes" } }));
    expect(bad.status).toBe(400);
  });
});

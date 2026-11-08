import { describe, expect, it } from "vitest";
import { DemoAnalyst } from "@/lib/llm/demo";
import { sanitizeUpdates } from "@/lib/llm/prompt";
import { toApiMessages } from "@/lib/llm/anthropic";
import { availableProviders, defaultProvider, getProvider } from "@/lib/llm";
import { getTemplate } from "@/lib/templates";
import { buildMemo } from "@/lib/memo";
import type { Assumption, ChatMessage } from "@/lib/types";

describe("demo analyst", () => {
  it("walks a whole build-vs-buy case to a complete memo", async () => {
    const template = getTemplate("build_vs_buy");
    const a = new DemoAnalyst();
    const assumptions: Record<string, Assumption> = {};
    const messages: ChatMessage[] = [{ role: "assistant", content: template.opener }];
    let pendingKey: string | null = "option_name";
    const answers = ["HubSpot Starter", "about $720", "0", "2 weeks", "not sure", "20%", "3"];
    for (const ans of answers) {
      messages.push({ role: "user", content: ans });
      const out = await a.turn({ template, assumptions, messages, pendingKey });
      for (const u of out.updates) {
        assumptions[u.key] = { ...u, filledBy: u.origin === "user_stated" ? { kind: "user" } : { kind: "model", provider: "demo", model: a.model }, updatedAt: "" };
      }
      messages.push({ role: "assistant", content: out.reply });
      pendingKey = out.askingKey;
    }
    expect(pendingKey).toBeNull();
    expect(assumptions.buy_annual_cost.confidence).toBe("medium");
    expect(assumptions.engineer_weekly_cost.value).toBe(4000);
    expect(assumptions.engineer_weekly_cost.confidence).toBe("low");
    const memo = buildMemo({ id: "X", title: "t", templateId: template.id, version: 1, assumptions });
    expect(memo.complete).toBe(true);
    expect(memo.recommendedOption).toBe("Buy HubSpot Starter");
  });

  it("re-asks when no number is given", async () => {
    const template = getTemplate("new_hire");
    const out = await new DemoAnalyst().turn({ template, assumptions: {}, messages: [{ role: "user", content: "hmm" }], pendingKey: "annual_salary" });
    expect(out.updates).toHaveLength(0);
    expect(out.askingKey).toBe("annual_salary");
  });
});

describe("model output sanitizing", () => {
  const template = getTemplate("build_vs_buy");
  it("drops unknown fields, parses money and forces estimates to low confidence", () => {
    const { updates, askingKey } = sanitizeUpdates(
      { template, assumptions: {}, messages: [], pendingKey: null },
      {
        reply: "ok",
        updates: [
          { key: "buy_annual_cost", value: "$12k", source: "Stated by PM", confidence: "high", origin: "user_stated" },
          { key: "maintenance_pct", value: "20", source: "Analyst benchmark", confidence: "high", origin: "model_estimate" },
          { key: "salary_of_ceo", value: "1", source: "x", confidence: "high", origin: "user_stated" },
          { key: "build_weeks", value: "lots", source: "x", confidence: "high", origin: "user_stated" },
        ],
        asking_key: "nope",
      },
    );
    expect(updates.map((u) => [u.key, u.value, u.confidence])).toEqual([
      ["buy_annual_cost", 12000, "high"],
      ["maintenance_pct", 20, "low"],
    ]);
    expect(askingKey).toBeNull();
  });
});

describe("provider selection", () => {
  it("falls back to the demo analyst with no keys", () => {
    expect(availableProviders({})).toEqual(["demo"]);
    expect(getProvider("anthropic", {}).name).toBe("demo");
  });
  it("prefers private NEAR AI when its key is set and honours LLM_PROVIDER", () => {
    expect(defaultProvider({ ANTHROPIC_API_KEY: "k", NEARAI_API_KEY: "n" })).toBe("nearai");
    expect(defaultProvider({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
    expect(defaultProvider({ ANTHROPIC_API_KEY: "k", NEARAI_API_KEY: "n", LLM_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(getProvider("nearai", { NEARAI_API_KEY: "n" }).name).toBe("nearai");
  });
  it("shapes messages for the Messages API", () => {
    const m = toApiMessages([
      { role: "assistant", content: "Hi" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[2].content).toBe("a\n\nb");
  });
});

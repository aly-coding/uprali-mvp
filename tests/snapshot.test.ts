import { describe, expect, it } from "vitest";
import { buildSnapshot, canonicalJson, hashSnapshot, sha256Hex, validateSnapshot } from "@/lib/snapshot";
import type { CaseState } from "@/lib/types";

const c: CaseState = {
  id: "UP-TEST-1",
  title: "CRM decision",
  templateId: "build_vs_buy",
  version: 4,
  assumptions: {
    buy_annual_cost: { key: "buy_annual_cost", value: 720, source: "Pricing page", confidence: "high", filledBy: { kind: "user" }, updatedAt: "2026-11-08T00:00:00Z" },
    maintenance_pct: { key: "maintenance_pct", value: 20, source: "Analyst benchmark", confidence: "low", filledBy: { kind: "model", provider: "anthropic", model: "claude-opus-5-5" }, updatedAt: "2026-11-08T00:00:00Z" },
  },
};

describe("snapshot fingerprint", () => {
  it("matches a known SHA-256", async () => {
    expect(await sha256Hex("test")).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });

  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it("changes when any number changes", async () => {
    const s = buildSnapshot(c, { approvers: ["Aly (CFO)"], decidedAt: "2026-11-08T10:00:00Z" });
    const tampered = { ...s, assumptions: s.assumptions.map((a) => (a.key === "buy_annual_cost" ? { ...a, value: 700 } : a)) };
    expect(await hashSnapshot(s)).not.toBe(await hashSnapshot(tampered));
    expect(await hashSnapshot(s)).toBe(await hashSnapshot(JSON.parse(JSON.stringify(s))));
  });

  it("logs which models helped", () => {
    const s = buildSnapshot(c, { approvers: ["Aly"], modelsUsed: ["NEAR AI (zai-org/GLM-5.1-FP8)"] });
    expect(s.modelsUsed).toEqual(["Claude (claude-opus-5-5)", "NEAR AI (zai-org/GLM-5.1-FP8)"]);
    expect(s.assumptions.find((a) => a.key === "maintenance_pct")?.filledBy).toBe("Claude (claude-opus-5-5)");
    expect(validateSnapshot(s)).toBe(true);
    expect(validateSnapshot({ ...s, schema: "other" })).toBe(false);
  });
});

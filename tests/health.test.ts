import { describe, expect, it } from "vitest";
import { health } from "@/lib/health";

describe("health page", () => {
  it("names what's missing without showing any value", async () => {
    const env = { LLM_PROVIDER: "demo", LOCAL_LEDGER_PATH: "", SLACK_SIGNING_SECRET: "a-very-secret-value", ANTHROPIC_API_KEY: "sk-ant-not-real-123" };
    const h = (await health(env)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const text = JSON.stringify(h);
    expect(text).not.toContain("a-very-secret-value");
    expect(text).not.toContain("sk-ant-not-real");
    expect(h.ok).toBe(false);
    expect(h.near.settings.NEAR_CONTRACT_ID).toBe(false);
    expect(h.other.settings.SLACK_SIGNING_SECRET).toBe(true);
    expect(h.problems.join(" ")).toMatch(/NEAR_CONTRACT_ID isn't set/);
    expect(h.problems.join(" ")).toMatch(/No database/);
    expect(h.database.kind).toBe("memory");
  });
});

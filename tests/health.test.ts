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
    expect(h.problems.join(" ")).toMatch(/aren't on this deploy: .*NEAR_CONTRACT_ID/);
    expect(h.problems.join(" ")).toMatch(/No database/);
    expect(h.near.missing).toContain("NEAR_PRIVATE_KEY");
    expect(h.database.kind).toBe("memory");
  });

  it("spots the /setup lines pasted into NEARAI_API_KEY and never shows them", async () => {
    const pasted = "NEAR_NETWORK=testnet\nNEAR_CONTRACT_ID=uprali-ledger-x.testnet\nNEAR_PRIVATE_KEY=ed25519:5ecretValueThatMustNotShow";
    const h = (await health({ NEARAI_API_KEY: pasted } as Record<string, string>)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const out = JSON.stringify(h);
    expect(out).not.toContain("5ecretValueThatMustNotShow");
    expect(out).not.toContain("uprali-ledger-x");
    expect(h.problems.join(" ")).toMatch(/holds the six lines from the \/setup page/);
    expect(h.nearAi.configured).toBe(false);
  });
});

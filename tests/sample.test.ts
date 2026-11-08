import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { hashSnapshot } from "@/lib/engine/snapshot";
import { getSample } from "@/lib/sample";
import { verifyDecision } from "@/lib/service";

beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  process.env.LOCAL_LEDGER_PATH = path.join(os.tmpdir(), `uprali-sample-${Date.now()}.json`);
  delete process.env.NEAR_CONTRACT_ID;
});

describe("sample decision for judges", () => {
  it("is made once, recorded, and verifies as a match", async () => {
    const a = await getSample("http://localhost:3000");
    expect(a.memo.status).not.toBe("needs_human");
    expect(a.recorded).not.toBeNull();
    const b = await getSample("http://localhost:3000");
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(await hashSnapshot(a.snapshot)).toBe(a.fingerprint);
    const v = await verifyDecision({ snapshot: a.snapshot, fingerprint: a.fingerprint });
    expect(v.matches).toBe(true);
  });

  it("fails the check once a number is changed", async () => {
    const a = await getSample("http://localhost:3000");
    const cheat = structuredClone(a.snapshot);
    cheat.totals.build = (cheat.totals.build ?? 0) - 50_000;
    const v = await verifyDecision({ snapshot: cheat, fingerprint: a.fingerprint });
    expect(v.matches).toBe(false);
    expect(v.message).toMatch(/No match/);
  });
});

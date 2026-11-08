import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NEARAI_API_KEY;
  delete process.env.NEAR_CONTRACT_ID;
  process.env.LOCAL_LEDGER_PATH = path.join(os.tmpdir(), `uprali-api-${Date.now()}.json`);
});

const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API routes in demo mode", () => {
  it("answers an analyst turn", async () => {
    const { POST } = await import("@/app/api/analyst/route");
    const res = await POST(post({ templateId: "new_hire", pendingKey: "role", messages: [{ role: "user", content: "Data engineer" }], assumptions: {} }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.provider).toBe("demo");
    expect(data.updates[0]).toMatchObject({ key: "role", value: "Data engineer" });
  });

  it("rejects a malformed analyst request", async () => {
    const { POST } = await import("@/app/api/analyst/route");
    const res = await POST(post({ templateId: "nope", messages: [] }));
    expect(res.status).toBe(400);
  });

  it("records a snapshot, then verifies it and spots a tampered copy", async () => {
    const { POST: record } = await import("@/app/api/ledger/record/route");
    const { POST: verify } = await import("@/app/api/ledger/verify/route");
    const snapshot = {
      schema: "uprali.decision.v1", kind: "decision", caseId: "UP-API-1", caseTitle: "t", caseVersion: 5, templateId: "new_hire",
      decidedAt: "2026-11-08T10:00:00Z", decision: "Hire", approvers: ["Aly"], assumptions: [{ key: "annual_salary", value: 120000, source: "s", confidence: "high", filledBy: "You" }], modelsUsed: [],
    };
    const r = await record(post({ snapshot }));
    const rec = await r.json();
    expect(r.status).toBe(200);
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.network).toBe("local-demo");

    const dup = await record(post({ snapshot }));
    expect(dup.status).toBe(409);

    const ok = await (await verify(post({ snapshot }))).json();
    expect(ok.found).toBe(true);
    expect(ok.anchor.version).toBe(5);

    const tampered = { ...snapshot, assumptions: [{ ...snapshot.assumptions[0], value: 90000 }] };
    const bad = await (await verify(post({ snapshot: tampered }))).json();
    expect(bad.found).toBe(false);
  });
});

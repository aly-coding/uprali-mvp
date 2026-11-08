import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { isAuthorized } from "@/lib/auth";
import { canonicalJson, hashSnapshot, sha256Hex } from "@/lib/engine/snapshot";

const KEY = "test-key-0123456789abcdef";

beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  process.env.LOCAL_LEDGER_PATH = path.join(os.tmpdir(), `uprali-test-${Date.now()}.json`);
  delete process.env.NEAR_CONTRACT_ID;
  delete process.env.NEARAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("API keys", () => {
  it("is open with no keys configured, and checks keys once set", () => {
    const req = new Request("http://x", { headers: { authorization: `Bearer ${KEY}` } });
    expect(isAuthorized(new Request("http://x"), {})).toBe(true);
    expect(isAuthorized(new Request("http://x"), { UPRALI_API_KEYS: KEY })).toBe(false);
    expect(isAuthorized(req, { UPRALI_API_KEYS: `other-key-0123456789,${KEY}` })).toBe(true);
    expect(isAuthorized(new Request("http://x", { headers: { "x-api-key": KEY } }), { UPRALI_API_KEYS: KEY })).toBe(true);
    expect(isAuthorized(new Request("http://x", { headers: { "x-api-key": KEY + "x" } }), { UPRALI_API_KEYS: KEY })).toBe(false);
  });
});

describe("snapshot fingerprint", () => {
  it("doesn't depend on key order", async () => {
    expect(await sha256Hex(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }))).toBe(await sha256Hex(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 })));
  });
});

describe("HTTP API", () => {
  it("decides, records, verifies, and catches a changed snapshot", async () => {
    const { POST: decideRoute } = await import("@/app/api/v1/build-vs-buy/route");
    const { POST: verifyRoute } = await import("@/app/api/v1/decisions/verify/route");
    const res = await decideRoute(
      post("/api/v1/build-vs-buy", {
        question: "Build our own CRM or keep paying $720 a year for HubSpot? Prototype took 3 weeks.",
        inputs: { engineer_weekly_cost: { value: 3500, source: "Payroll", owner: "human" } },
        record: true,
        approved_by: ["Aly"],
      }),
    );
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.memo.recommendation.option).toBe("buy");
    expect(r.recorded.anchor.hash).toBe(r.fingerprint);
    expect(await hashSnapshot(r.snapshot)).toBe(r.fingerprint);
    expect(r.snapshot.approvers).toEqual(["Aly"]);
    expect(r.snapshot.inputs.find((i: { key: string }) => i.key === "engineer_weekly_cost")).toMatchObject({ value: 3500, owner: "human", source: "Payroll" });

    const ok = await (await verifyRoute(post("/api/v1/decisions/verify", { snapshot: r.snapshot }))).json();
    expect(ok.matches).toBe(true);

    const changed = { ...r.snapshot, totals: { ...r.snapshot.totals, build: 1 } };
    const bad = await (await verifyRoute(post("/api/v1/decisions/verify", { snapshot: changed }))).json();
    expect(bad.matches).toBe(false);
  });

  it("rejects unknown fields and bad bodies", async () => {
    const { POST } = await import("@/app/api/v1/build-vs-buy/route");
    expect((await POST(post("/api/v1/build-vs-buy", { inputs: { salary_of_ceo: 1 } }))).status).toBe(400);
    expect((await POST(post("/api/v1/build-vs-buy", "nope"))).status).toBe(400);
  });

  it("asks agents for the API key once keys are set", async () => {
    const { POST } = await import("@/app/api/v1/build-vs-buy/route");
    process.env.UPRALI_API_KEYS = KEY;
    try {
      expect((await POST(post("/api/v1/build-vs-buy", { question: "x" }))).status).toBe(401);
      expect((await POST(post("/api/v1/build-vs-buy", { question: "Keep paying $1,000 a year for Notion? Prototype took 1 week." }, { authorization: `Bearer ${KEY}` }))).status).toBe(200);
    } finally {
      delete process.env.UPRALI_API_KEYS;
    }
  });

  it("won't record a decision that still needs a human", async () => {
    const { POST } = await import("@/app/api/v1/build-vs-buy/route");
    const r = await (await POST(post("/api/v1/build-vs-buy", { question: "Should we build a CRM?", record: true }))).json();
    expect(r.recorded).toBeNull();
    expect(r.recordError).toMatch(/needs a human/);
  });
});

describe("MCP server", () => {
  const H = { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  const call = async (body: unknown) => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(post("/mcp", body, H));
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : text);
  };

  it("lists both tools", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["build_vs_buy", "verify_decision"]);
  });

  it("runs build_vs_buy and returns a memo with its fingerprint", async () => {
    const r = await call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "build_vs_buy", arguments: { question: "Keep paying $720 a year for HubSpot, or build? Prototype took 3 weeks.", engineer_weekly_cost: 4000 } },
    });
    expect(r.result.content[0].text).toContain("Every number, with its source and owner");
    expect(r.result.structuredContent.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Stands in for NEAR testnet, which this test can't reach. It records as the relayer would.
vi.mock("@/lib/ledger/near", () => ({
  NearLedger: class {
    network = "near-testnet" as const;
    recorder = "relayer.uprali.testnet";
    contractId = "ledger.uprali.testnet";
    async record(args: { hash: string; kind: string; caseId: string; version: number }) {
      return {
        network: "near-testnet",
        anchor: { ...args, recordedBy: this.recorder, timestampMs: 1, blockHeight: 1 },
        txHash: "fake-tx",
      };
    }
    async get() {
      return null;
    }
  },
}));

const CODE = "demo-code-123";
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../samples/acme-crm-snapshot.json"), "utf8"));

const post = (headers: Record<string, string>) =>
  new Request("http://localhost/api/app/record", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9", ...headers },
    body: JSON.stringify({ snapshot }),
  });

beforeAll(() => {
  process.env.NEAR_CONTRACT_ID = "ledger.uprali.testnet";
  process.env.NEAR_ACCOUNT_ID = "relayer.uprali.testnet";
  process.env.RECORD_ACCESS_CODE = CODE;
});
afterAll(() => {
  delete process.env.NEAR_CONTRACT_ID;
  delete process.env.NEAR_ACCOUNT_ID;
  delete process.env.RECORD_ACCESS_CODE;
});

describe("recording without a wallet", () => {
  it("needs the access code, then the relayer records on testnet", async () => {
    const { POST } = await import("@/app/api/app/record/route");
    expect((await POST(post({}))).status).toBe(403);
    expect((await POST(post({ "x-access-code": "wrong" }))).status).toBe(403);
    const ok = await POST(post({ "x-access-code": CODE }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.network).toBe("near-testnet");
    expect(body.anchor.recordedBy).toBe("relayer.uprali.testnet");
    expect(body.verifyUrl).toContain("/verify?hash=");
  });

  it("tells the screen that the code path is on", async () => {
    const { GET } = await import("@/app/api/config/route");
    const cfg = await (await GET()).json();
    expect(cfg.relayerCodeEnabled).toBe(true);
    expect(cfg.wallet).toEqual({ networkId: "testnet", contractId: "ledger.uprali.testnet" });
  });
});

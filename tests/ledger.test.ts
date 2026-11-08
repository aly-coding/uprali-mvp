import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { LocalLedger } from "@/lib/ledger";
import { NearLedger } from "@/lib/ledger/near";

const H = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("local demo ledger", () => {
  it("records once, refuses overwrites and persists to its file", async () => {
    const file = path.join(os.tmpdir(), `uprali-ledger-${Date.now()}.json`);
    const l = new LocalLedger(file);
    const r = await l.record({ hash: H, kind: "decision", caseId: "UP-1", version: 2 });
    expect(r.network).toBe("local-demo");
    await expect(l.record({ hash: H, kind: "approval", caseId: "UP-1", version: 2 })).rejects.toThrow("duplicate");
    const again = new LocalLedger(file);
    expect((await again.get(H))?.caseId).toBe("UP-1");
    expect(await again.get("0".repeat(64))).toBeNull();
  });
});

describe("NEAR ledger reads (RPC mocked)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the contract's get() result", async () => {
    const anchor = { hash: H, kind: "decision", case_id: "UP-1", version: 3, recorded_by: "uprali.testnet", timestamp_ms: 1762590000000, block_height: 123 };
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const req = JSON.parse(init.body);
      expect(req.method).toBe("query");
      expect(req.params.method_name).toBe("get");
      expect(JSON.parse(Buffer.from(req.params.args_base64, "base64").toString())).toEqual({ hash: H });
      const result = Array.from(Buffer.from(JSON.stringify(anchor)));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { result, logs: [], block_height: 1, block_hash: "x" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const l = new NearLedger({ contractId: "ledger.uprali.testnet", rpcUrl: "https://rpc.example", network: "testnet" });
    const a = await l.get(H);
    expect(a).toEqual({ hash: H, kind: "decision", caseId: "UP-1", version: 3, recordedBy: "uprali.testnet", timestampMs: 1762590000000, blockHeight: 123 });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("refuses mainnet", () => {
    expect(() => new NearLedger({ contractId: "x.near", rpcUrl: "https://rpc.example", network: "mainnet" })).toThrow();
  });
});

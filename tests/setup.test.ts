import { describe, expect, it } from "vitest";
import { envBlock, randomCode, setupNames, yoctoToNear } from "@/lib/setup";

describe("setup page helpers", () => {
  it("names the two sub-accounts and rejects bad input", () => {
    expect(setupNames("Uprali.testnet")).toEqual({ owner: "uprali.testnet", ledgerId: "ledger.uprali.testnet", relayerId: "relayer.uprali.testnet" });
    expect(setupNames("uprali.near")).toHaveProperty("error");
    expect(setupNames("uprali.testnet", "same", "same")).toHaveProperty("error");
    expect(setupNames("uprali.testnet", "Bad Name")).toHaveProperty("error");
  });

  it("makes codes from an unambiguous alphabet", () => {
    const c = randomCode(10);
    expect(c).toMatch(/^[a-z2-9]{10}$/);
    expect(c).not.toMatch(/[01ilo]/);
  });

  it("writes the Vercel block and reads balances", () => {
    const block = envBlock({ contractId: "ledger.a.testnet", relayerId: "relayer.a.testnet", relayerKey: "ed25519:xyz", accessCode: "abc", apiKey: "upk_k" });
    expect(block.split("\n")).toHaveLength(6);
    expect(block).toContain("NEAR_CONTRACT_ID=ledger.a.testnet");
    expect(yoctoToNear("3500000000000000000000000")).toBe(3.5);
    expect(yoctoToNear(0n)).toBe(0);
  });
});

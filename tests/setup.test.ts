import { describe, expect, it } from "vitest";
import { envBlock, FAUCET_URL, randomCode, setupNames, sponsoredNames, validOwner, validSponsorRequest, yoctoToNear } from "@/lib/setup";
import { sponsor } from "@/lib/sponsor";

const PUB = "ed25519:" + "A".repeat(44);
const req = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://x/api/setup/sponsor", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

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

describe("faucet-funded setup", () => {
  it("names the accounts and only passes on what the page makes", () => {
    const n = sponsoredNames("abc23456");
    expect(n).toEqual({ ledgerId: "uprali-ledger-abc23456.testnet", relayerId: "uprali-relayer-abc23456.testnet" });
    expect(validSponsorRequest({ accountId: n.ledgerId, publicKey: PUB })).toEqual({ accountId: n.ledgerId, publicKey: PUB });
    expect(validSponsorRequest({ accountId: "someone.testnet", publicKey: PUB })).toBeNull();
    expect(validSponsorRequest({ accountId: n.ledgerId, publicKey: "ed25519:short" })).toBeNull();
    expect(validSponsorRequest({ accountId: n.ledgerId, publicKey: PUB, secretKey: "x" })).not.toHaveProperty("secretKey");
    expect(validOwner("Uprali.testnet")).toBe("uprali.testnet");
    expect(validOwner("uprali.near")).toBeNull();
  });

  it("asks NEAR's faucet with only the account name and public key", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const accountId = "uprali-ledger-abc23456.testnet";
    const res = await sponsor(req({ accountId, publicKey: PUB }, "9.9.9.1"), {}, f);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ url: FAUCET_URL, body: { newAccountId: accountId, newAccountPublicKey: PUB } }]);
  });

  it("refuses once the ledger is set up, for other names, and when the faucet says no", async () => {
    const ok = (async () => new Response("{}")) as unknown as typeof fetch;
    const no = (async () => new Response("account exists", { status: 400 })) as unknown as typeof fetch;
    const good = { accountId: "uprali-relayer-abc23456.testnet", publicKey: PUB };
    expect((await sponsor(req(good, "9.9.9.2"), { NEAR_CONTRACT_ID: "x.testnet" }, ok)).status).toBe(409);
    expect((await sponsor(req(good, "9.9.9.3"), { NEAR_NETWORK: "mainnet" }, ok)).status).toBe(400);
    expect((await sponsor(req({ ...good, accountId: "victim.testnet" }, "9.9.9.4"), {}, ok)).status).toBe(400);
    const refused = await sponsor(req(good, "9.9.9.5"), {}, no);
    expect(refused.status).toBe(502);
    expect((await refused.json()).error).toContain("account exists");
  });

  it("rate limits each visitor", async () => {
    const ok = (async () => new Response("{}")) as unknown as typeof fetch;
    const good = { accountId: "uprali-relayer-abc23456.testnet", publicKey: PUB };
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await sponsor(req(good, "9.9.9.6"), {}, ok)).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });
});

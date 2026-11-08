import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { accountNetwork, DEFAULT_RPC, explorerAccountUrl, rpcUrlFor, signInNetwork } from "@/lib/nearNetwork";
import { makeNonce, SIGN_IN_MESSAGE, verifySignIn, type VerifyNep413 } from "@/lib/identity";

const env = { SESSION_SECRET: "test-secret-0123456789abcdef" };

describe("NEAR networks", () => {
  it("tells mainnet and testnet accounts apart by name", () => {
    expect(accountNetwork("alyona.near")).toBe("mainnet");
    expect(accountNetwork("ledger.alyona.near")).toBe("mainnet");
    expect(accountNetwork("alyona.testnet")).toBe("testnet");
    expect(accountNetwork("a".repeat(64))).toBeNull();
  });

  it("checks a sign-in on the account's own network, and refuses a mismatch", () => {
    expect(signInNetwork("alyona.near", "mainnet")).toBe("mainnet");
    expect(signInNetwork("alyona.near", undefined)).toBe("mainnet");
    expect(signInNetwork("alyona.testnet", "testnet")).toBe("testnet");
    expect(signInNetwork("a".repeat(64), "mainnet")).toBe("mainnet");
    expect(signInNetwork("a".repeat(64), "bogus")).toBe("testnet");
    expect(signInNetwork("alyona.near", "testnet")).toHaveProperty("error");
    expect(signInNetwork("alyona.testnet", "mainnet")).toHaveProperty("error");
  });

  it("uses the right RPC and explorer for each network", () => {
    expect(rpcUrlFor("mainnet", {})).toBe(DEFAULT_RPC.mainnet);
    expect(rpcUrlFor("testnet", {})).toBe(DEFAULT_RPC.testnet);
    expect(rpcUrlFor("mainnet", { NEAR_MAINNET_RPC_URL: "https://m.example" })).toBe("https://m.example");
    expect(rpcUrlFor("testnet", { NEAR_RPC_URL: "https://t.example" })).toBe("https://t.example");
    expect(explorerAccountUrl("alyona.near")).toBe("https://nearblocks.io/address/alyona.near");
    expect(explorerAccountUrl("alyona.testnet")).toBe("https://testnet.nearblocks.io/address/alyona.testnet");
  });

  it("signs in a .near account with a full-access key", async () => {
    const recipient = "financeanalyst.app";
    const kp = KeyPair.fromRandom("ed25519");
    const nonce = makeNonce(env);
    const s = await new KeyPairSigner(kp).signNep413Message("alyona.near", { message: SIGN_IN_MESSAGE, recipient, nonce });
    const body = { accountId: "alyona.near", publicKey: kp.getPublicKey().toString(), signature: Buffer.from(s.signature).toString("base64"), nonce: nonce.toString("base64"), network: "mainnet" };
    const verify: VerifyNep413 = async ({ accountId, publicKey, signature, payload }) => {
      const provider = {
        viewAccessKey: async ({ accountId: a, publicKey: p }: { accountId: string; publicKey: string }) => {
          if (a !== "alyona.near" || String(p) !== kp.getPublicKey().toString()) throw new Error("no such key");
          return { permission: "FullAccess" };
        },
      };
      await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, signature, payload, provider: provider as never });
    };
    expect(await verifySignIn(body, recipient, verify, env)).toBe("alyona.near");
  });
});

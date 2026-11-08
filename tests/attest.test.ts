import { describe, expect, it } from "vitest";
import { attestationUrl, checkNearAiReport, freshNonce, syntheticReport } from "@/lib/attest";

const model = "zai-org/GLM-5.1-FP8";
const signingAddress = "ab".repeat(20);

describe("NEAR AI attestation checks", () => {
  it("builds the report URL with a fresh nonce", () => {
    const n = freshNonce();
    expect(n).toMatch(/^[0-9a-f]{64}$/);
    expect(freshNonce()).not.toBe(n);
    const u = new URL(attestationUrl("https://cloud-api.near.ai/v1/", model, n));
    expect(u.pathname).toBe("/v1/attestation/report");
    expect(u.searchParams.get("nonce")).toBe(n);
    expect(u.searchParams.get("signing_algo")).toBe("ecdsa");
  });

  it("passes a report that binds our nonce and the signing key", () => {
    const nonce = freshNonce();
    const r = checkNearAiReport(syntheticReport({ model, nonce, signingAddress }), { model, nonce });
    expect(r.verified).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.node?.signingAddress).toBe("0x" + signingAddress);
    expect(r.notCheckedHere.length).toBeGreaterThan(0);
  });

  it("fails a replayed report made for another nonce", () => {
    const old = freshNonce();
    const r = checkNearAiReport(syntheticReport({ model, nonce: old, signingAddress }), { model, nonce: freshNonce() });
    expect(r.verified).toBe(false);
    expect(r.checks.find((c) => c.name === "Fresh nonce echoed")?.ok).toBe(false);
  });

  it("fails when the quote doesn't bind the nonce or the key", () => {
    const nonce = freshNonce();
    for (const tamper of ["nonce", "address"] as const) {
      const r = checkNearAiReport(syntheticReport({ model, nonce, signingAddress, tamper }), { model, nonce });
      expect(r.verified).toBe(false);
      expect(r.checks.find((c) => c.name === "Quote binds nonce and signing key")?.ok).toBe(false);
    }
  });

  it("fails an empty report", () => {
    expect(checkNearAiReport({}, { model, nonce: freshNonce() }).verified).toBe(false);
  });
});

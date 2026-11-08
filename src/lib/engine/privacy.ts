import { attestationUrl, checkNearAiReport, freshNonce, type AttestationResult } from "../attest";
import { nearAiConfig, type Env } from "./providers";

/** Asks NEAR AI Cloud for an attestation report bound to a fresh nonce, and checks it. Never throws. */
export async function attestNearAi(env: Env = process.env): Promise<AttestationResult | { error: string }> {
  const c = nearAiConfig(env);
  if (!c.apiKey) return { error: "NEAR AI isn't configured on this server." };
  const nonce = freshNonce();
  try {
    const res = await fetch(attestationUrl(c.baseUrl, c.model, nonce), {
      headers: { authorization: `Bearer ${c.apiKey}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `NEAR AI returned ${res.status} for the attestation report.` };
    return checkNearAiReport(await res.json(), { model: c.model, nonce });
  } catch {
    return { error: "Couldn't reach NEAR AI for the attestation report." };
  }
}

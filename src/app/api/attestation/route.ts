import { NextResponse } from "next/server";
import { attestationUrl, checkNearAiReport, freshNonce } from "@/lib/attest";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Asks NEAR AI Cloud to prove that the model runs in a TEE, with a fresh nonce so the answer
 * can't be replayed. Nothing is stored: the report is checked and the result returned.
 */
export async function GET(req: Request) {
  if (!allow(`attest:${clientKey(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many checks. Try again in a minute." }, { status: 429 });
  }
  if (!process.env.NEARAI_API_KEY) {
    return NextResponse.json({ error: "NEAR AI isn't configured on this server, so there's nothing to attest." }, { status: 400 });
  }
  const model = process.env.NEARAI_MODEL || "zai-org/GLM-5.1-FP8";
  const base = process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1";
  const nonce = freshNonce();
  try {
    const res = await fetch(attestationUrl(base, model, nonce), {
      headers: { authorization: `Bearer ${process.env.NEARAI_API_KEY}`, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `NEAR AI returned ${res.status} for the attestation report.` }, { status: 502 });
    }
    return NextResponse.json(checkNearAiReport(await res.json(), { model, nonce }));
  } catch {
    return NextResponse.json({ error: "Couldn't reach NEAR AI for the attestation report." }, { status: 502 });
  }
}

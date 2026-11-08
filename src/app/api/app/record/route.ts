import { validateSnapshot } from "@/lib/engine/snapshot";
import { getLedger } from "@/lib/ledger";
import { allow, clientKey } from "@/lib/ratelimit";
import { errorResponse, publicBaseUrl, recordSnapshot, verifyUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Demo screen only. With no NEAR contract configured it writes to the local demo ledger. With a
 * contract, people sign with their own wallet instead, unless they give the RECORD_ACCESS_CODE,
 * which lets the server's relayer record for them (a fallback for a live demo).
 */
export async function POST(req: Request) {
  if (!allow(`apprecord:${clientKey(req)}`, 5, 60_000)) return Response.json({ error: "Too many records. Wait a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown } | null;
  if (!body || !validateSnapshot(body.snapshot)) return Response.json({ error: "That isn't a valid Uprali decision snapshot." }, { status: 400 });
  const ledger = await getLedger();
  const code = process.env.RECORD_ACCESS_CODE;
  if (ledger.network === "near-testnet" && !(code && req.headers.get("x-access-code") === code)) {
    return Response.json({ error: "Sign in with your NEAR wallet to record this decision." }, { status: 403 });
  }
  try {
    const recorded = await recordSnapshot(body.snapshot);
    return Response.json({ ...recorded, verifyUrl: verifyUrl(publicBaseUrl(req), recorded.anchor.hash) });
  } catch (err) {
    return errorResponse(err);
  }
}

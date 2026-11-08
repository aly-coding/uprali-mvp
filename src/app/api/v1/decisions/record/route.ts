import { isAuthorized, unauthorized } from "@/lib/auth";
import { validateSnapshot } from "@/lib/engine/snapshot";
import { allow, clientKey } from "@/lib/ratelimit";
import { errorResponse, publicBaseUrl, recordSnapshot, verifyUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Records a snapshot's fingerprint with the server's relayer account. The snapshot itself is not stored. */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  if (!allow(`record:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many records. Wait a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown } | null;
  if (!body || !validateSnapshot(body.snapshot)) return Response.json({ error: "That isn't a valid Uprali decision snapshot." }, { status: 400 });
  try {
    const recorded = await recordSnapshot(body.snapshot);
    return Response.json({ ...recorded, verifyUrl: verifyUrl(publicBaseUrl(req), recorded.anchor.hash) });
  } catch (err) {
    return errorResponse(err);
  }
}

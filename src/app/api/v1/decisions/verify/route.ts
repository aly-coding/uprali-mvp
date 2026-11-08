import { allow, clientKey } from "@/lib/ratelimit";
import { errorResponse, verifyDecision } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Open to anyone: checks a snapshot or fingerprint against the ledger. */
export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 60, 60_000)) return Response.json({ error: "Too many checks. Wait a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown; fingerprint?: string } | null;
  try {
    return Response.json(await verifyDecision({ snapshot: body?.snapshot, fingerprint: typeof body?.fingerprint === "string" ? body.fingerprint : undefined }));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: Request) {
  const fingerprint = new URL(req.url).searchParams.get("fingerprint") || "";
  try {
    return Response.json(await verifyDecision({ fingerprint }));
  } catch (err) {
    return errorResponse(err);
  }
}

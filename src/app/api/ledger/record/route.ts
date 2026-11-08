import { NextResponse } from "next/server";
import { getLedger, LedgerError } from "@/lib/ledger";
import { hashSnapshot, validateSnapshot } from "@/lib/snapshot";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Records a decision. The browser sends the snapshot; the server recomputes the fingerprint
 * itself and writes only that fingerprint (plus case id, version and kind) to the ledger.
 * The snapshot is not stored anywhere on the server.
 */
export async function POST(req: Request) {
  if (!allow(`record:${clientKey(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many records. Wait a minute and try again." }, { status: 429 });
  }
  const code = process.env.RECORD_ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code) {
    return NextResponse.json({ error: "This demo needs an access code to record." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown } | null;
  if (!body || !validateSnapshot(body.snapshot)) {
    return NextResponse.json({ error: "That isn't a valid decision snapshot." }, { status: 400 });
  }
  const s = body.snapshot;
  const hash = await hashSnapshot(s);
  try {
    const ledger = await getLedger();
    const result = await ledger.record({ hash, kind: s.kind, caseId: s.caseId, version: s.caseVersion });
    return NextResponse.json({ hash, ...result, contractId: ledger.contractId ?? null });
  } catch (err) {
    console.error("record error:", err instanceof Error ? err.name : "unknown");
    if (err instanceof LedgerError) return NextResponse.json({ error: err.userMessage, hash }, { status: err.status });
    return NextResponse.json({ error: "Couldn't record the decision. Try again." }, { status: 500 });
  }
}

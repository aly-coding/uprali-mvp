import { NextResponse } from "next/server";
import { getLedger, LedgerError } from "@/lib/ledger";
import { hashSnapshot, validateSnapshot } from "@/lib/snapshot";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Checks a snapshot (or a bare hash) against the ledger. Anyone can call this. */
export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many checks. Wait a minute and try again." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown; hash?: unknown } | null;
  let hash: string | null = null;
  if (body && typeof body.hash === "string" && /^[0-9a-f]{64}$/.test(body.hash)) hash = body.hash;
  else if (body && validateSnapshot(body.snapshot)) hash = await hashSnapshot(body.snapshot);
  if (!hash) return NextResponse.json({ error: "Send a decision snapshot or a 64-character fingerprint." }, { status: 400 });
  try {
    const ledger = await getLedger();
    const anchor = await ledger.get(hash);
    return NextResponse.json({ hash, found: Boolean(anchor), anchor, network: ledger.network, contractId: ledger.contractId ?? null });
  } catch (err) {
    const msg = err instanceof LedgerError ? err.userMessage : "Couldn't check the ledger right now.";
    return NextResponse.json({ error: msg, hash }, { status: 502 });
  }
}

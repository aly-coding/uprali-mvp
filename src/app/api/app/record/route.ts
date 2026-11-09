import { validateSnapshot } from "@/lib/engine/snapshot";
import { markRecordedQuietly, recordedFrom } from "@/lib/history";
import { webOwner } from "@/lib/identity";
import { getLedger } from "@/lib/ledger";
import { allow, clientKey } from "@/lib/ratelimit";
import { errorResponse, publicBaseUrl, recordSnapshot, verifyUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Records a decision through the server's relayer. With no NEAR contract configured it writes to
 * the local demo ledger. With a contract, testnet wallets sign the record themselves, so the
 * relayer only records when:
 * - the person signed in with a NEAR account (a NEP-413 signed message, so the server knows it's
 *   them) and the decision was made in that account's name. This is how name.near (mainnet)
 *   accounts record, since they can't sign on the testnet ledger; or
 * - they give the RECORD_ACCESS_CODE (a fallback for a live demo).
 */
export async function POST(req: Request) {
  if (!allow(`apprecord:${clientKey(req)}`, 5, 60_000)) return Response.json({ error: "Too many records. Wait a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { snapshot?: unknown } | null;
  if (!body || !validateSnapshot(body.snapshot)) return Response.json({ error: "That isn't a valid Uprali decision snapshot." }, { status: 400 });
  const ledger = await getLedger();
  if (ledger.network === "local-demo" && process.env.VERCEL) {
    return Response.json({ error: "Saving on NEAR isn't switched on for this site yet. The owner sets it up once on the /setup page." }, { status: 409 });
  }
  const code = process.env.RECORD_ACCESS_CODE;
  const byCode = Boolean(code && req.headers.get("x-access-code") === code);
  const account = webOwner(req).account;
  const forAccount = Boolean(account && body.snapshot.decidedBy === account);
  if (ledger.network === "near-testnet" && !byCode && !forAccount) {
    return Response.json(
      {
        error: account
          ? `This decision was made as ${body.snapshot.decidedBy}, not ${account}. Run it again signed in as ${account} to record it.`
          : "Sign in with your NEAR wallet to record this decision.",
      },
      { status: 403 },
    );
  }
  try {
    const recorded = await recordSnapshot(body.snapshot);
    const info = recordedFrom(recorded);
    // Show who stands behind it, not only the relayer account that paid the gas.
    const shown = info && forAccount && !byCode ? { ...info, by: `${account} (recorded by ${info.by})` } : info;
    await markRecordedQuietly(recorded.anchor.hash, shown);
    return Response.json({ ...recorded, decidedBy: body.snapshot.decidedBy, verifyUrl: verifyUrl(publicBaseUrl(req), recorded.anchor.hash) });
  } catch (err) {
    return errorResponse(err);
  }
}

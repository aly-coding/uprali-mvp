import { NextResponse } from "next/server";
import { availableProviders, defaultProvider, getProvider } from "@/lib/llm";
import { getLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** What's configured, without exposing any secret. */
export async function GET() {
  const ledger = await getLedger();
  const providers = availableProviders().map((name) => ({ name, model: getProvider(name).model }));
  return NextResponse.json({
    providers,
    defaultProvider: defaultProvider(),
    ledger: { network: ledger.network, contractId: ledger.contractId ?? null, recorder: ledger.recorder },
    recordNeedsCode: Boolean(process.env.RECORD_ACCESS_CODE),
  });
}

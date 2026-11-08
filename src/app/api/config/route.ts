import { authRequired } from "@/lib/auth";
import { nearAiConfig, providerOrder } from "@/lib/engine/providers";
import { getLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** What's configured, without exposing any secret. The demo screen reads the wallet network and contract from here. */
export async function GET() {
  const ledger = await getLedger();
  const order = providerOrder();
  return Response.json({
    providers: order,
    privateModel: order[0] === "nearai" ? nearAiConfig().model : null,
    claudeModel: order.includes("anthropic") ? process.env.ANTHROPIC_MODEL || "claude-opus-5-5" : null,
    ledger: { network: ledger.network, contractId: ledger.contractId ?? null, relayer: ledger.network === "near-testnet" ? ledger.recorder : null },
    wallet: ledger.network === "near-testnet" && ledger.contractId ? { networkId: "testnet", contractId: ledger.contractId } : null,
    apiKeyRequired: authRequired(),
    relayerCodeEnabled: Boolean(process.env.RECORD_ACCESS_CODE),
    // Setting names only (never values), so /setup can say what this deploy is missing.
    ledgerMissing: ["NEAR_NETWORK", "NEAR_CONTRACT_ID", "NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY", "RECORD_ACCESS_CODE", "UPRALI_API_KEYS"].filter((n) => !process.env[n]?.trim()),
    deploy: process.env.VERCEL_ENV ?? null,
    // The throwaway local ledger is for running the app on your own computer (the README demo), never the live site.
    localDemo: ledger.network === "local-demo" && !process.env.VERCEL,
  });
}

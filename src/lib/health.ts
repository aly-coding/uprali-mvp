/**
 * What's set up on this server, for the owner to open and paste when something doesn't work.
 * It names settings but never shows a secret's value. The contract and relayer account names are
 * public on chain anyway, so they're shown.
 */
import { nearAiConfig, providerOrder } from "./engine/providers";
import { getHistory } from "./history";
import { getLedger } from "./ledger";

type Env = Record<string, string | undefined>;

const set = (env: Env, names: string[]) => Object.fromEntries(names.map((n) => [n, Boolean(env[n] && env[n]!.trim())]));

async function timed<T>(f: () => Promise<T>): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number; error: string }> {
  const t = Date.now();
  try {
    return { ok: true, ms: Date.now() - t, value: await f() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Never echo anything that could hold a key or URL with credentials.
    return { ok: false, ms: Date.now() - t, error: msg.replace(/(key|token|secret|password)[^\s]*/gi, "[hidden]").replace(/\w+:\/\/[^\s]+/g, "[url]").slice(0, 160) };
  }
}

export async function health(env: Env = process.env) {
  const problems: string[] = [];

  // NEAR ledger
  const nearNames = set(env, ["NEAR_CONTRACT_ID", "NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY", "NEAR_NETWORK", "NEAR_RPC_URL"]);
  const got = await timed(() => getLedger(env));
  if (!got.ok) {
    problems.push("The NEAR settings couldn't be loaded. NEAR_PRIVATE_KEY may be in the wrong format: paste it exactly as the /setup page gave it (starts with ed25519:).");
    return { ok: false, checkedAt: new Date().toISOString(), problems, near: { settings: nearNames, loaded: false } };
  }
  const ledger = got.value;
  const onNear = ledger.network === "near-testnet";
  const probe = await timed(() => ledger.get("0".repeat(64)));
  if (!onNear) problems.push("NEAR_CONTRACT_ID isn't set, so decisions go to the throwaway demo ledger and wallet sign-in is off. Add the lines from the /setup page in Vercel and redeploy.");
  else if (!probe.ok) problems.push("The NEAR ledger contract didn't answer. Check NEAR_CONTRACT_ID is the account the /setup page made, and NEAR_RPC_URL if you set one.");
  if (onNear && !(nearNames.NEAR_ACCOUNT_ID && nearNames.NEAR_PRIVATE_KEY)) problems.push("No relayer account (NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY): wallet users can still record, but Slack, the API and agents can't.");

  // NEAR AI
  const ai = nearAiConfig(env);
  const order = providerOrder(env);
  let nearAi: { configured: boolean; model: string; reachable: boolean | null; status: number | null } = { configured: Boolean(ai.apiKey), model: ai.model, reachable: null, status: null };
  if (ai.apiKey) {
    const r = await timed(async () => (await fetch(`${ai.baseUrl}/models`, { headers: { authorization: `Bearer ${ai.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(8000) })).status);
    nearAi = { ...nearAi, reachable: r.ok && r.value < 500, status: r.ok ? r.value : null };
    if (!r.ok || r.value >= 400) problems.push(r.ok && (r.value === 401 || r.value === 403) ? "NEAR AI turned the key down (NEARAI_API_KEY). Make a new key in NEAR AI Cloud." : "NEAR AI Cloud didn't answer. Decisions fall back to Claude or the built-in analyst.");
  } else problems.push("NEARAI_API_KEY isn't set, so the analysis doesn't run on NEAR AI's private inference.");

  // Database for history
  const store = await getHistory(env);
  const db = await timed(() => store.list("health:probe", { limit: 1 }));
  if (store.kind !== "postgres") problems.push("No database (DATABASE_URL or POSTGRES_URL): History is kept in memory and is lost or split between server instances. Add a free Neon database in Vercel's Storage tab and redeploy.");
  else if (!db.ok) problems.push("The database didn't answer. Check DATABASE_URL in Vercel.");

  return {
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    problems,
    near: {
      settings: nearNames,
      network: ledger.network,
      contractId: ledger.contractId ?? null,
      relayerAccount: onNear && ledger.recorder !== "(read-only)" ? ledger.recorder : null,
      contractAnswers: onNear ? probe.ok : null,
      contractMs: probe.ms,
      walletSignIn: onNear,
    },
    nearAi: { ...nearAi, providerOrder: order },
    database: { kind: store.kind, answers: db.ok, ms: db.ms },
    other: {
      settings: set(env, ["ANTHROPIC_API_KEY", "PUBLIC_BASE_URL", "UPRALI_API_KEYS", "RECORD_ACCESS_CODE", "SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "NEXT_PUBLIC_UPRALI_VOICE"]),
      commit: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    },
  };
}

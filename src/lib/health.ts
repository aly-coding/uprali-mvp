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
  const ledgerNeeded = ["NEAR_NETWORK", "NEAR_CONTRACT_ID", "NEAR_ACCOUNT_ID", "NEAR_PRIVATE_KEY", "RECORD_ACCESS_CODE", "UPRALI_API_KEYS"];
  const ledgerMissing = ledgerNeeded.filter((n) => !(env[n] && env[n]!.trim()));
  const onVercel = env.VERCEL_ENV ? ` This deploy is ${env.VERCEL_ENV}, so the lines must be saved with ${env.VERCEL_ENV === "production" ? "Production" : env.VERCEL_ENV === "preview" ? "Preview" : "Development"} ticked.` : "";
  if (!onNear) problems.push(`Wallet sign-in is off and decisions go to a throwaway demo ledger, because these settings aren't on this deploy: ${ledgerMissing.join(", ")}. Paste the six lines from the /setup page into Vercel with Production and Preview ticked, then redeploy.${onVercel}`);
  else if (ledgerMissing.length) problems.push(`Some ledger settings are missing on this deploy: ${ledgerMissing.join(", ")}. Add them from the /setup page in Vercel and redeploy.`);
  else if (!probe.ok) problems.push("The NEAR ledger contract didn't answer. Check NEAR_CONTRACT_ID is the account the /setup page made, and NEAR_RPC_URL if you set one.");
  if (onNear && !(nearNames.NEAR_ACCOUNT_ID && nearNames.NEAR_PRIVATE_KEY)) problems.push("No relayer account (NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY): wallet users can still record, but Slack, the API and agents can't.");

  // NEAR AI
  const ai = nearAiConfig(env);
  const order = providerOrder(env);
  let baseHost: string | null = null;
  try {
    baseHost = new URL(ai.baseUrl).host;
  } catch {
    baseHost = null;
  }
  let nearAi: {
    configured: boolean;
    model: string;
    baseHost: string | null;
    customBaseUrl: boolean;
    customModel: boolean;
    reachable: boolean | null;
    status: number | null;
    error: string | null;
    ms: number | null;
    keyHasSpaces: boolean;
  } = { keyHasSpaces: Boolean(env.NEARAI_API_KEY && env.NEARAI_API_KEY !== env.NEARAI_API_KEY.trim()), configured: Boolean(ai.apiKey), model: ai.model, baseHost, customBaseUrl: Boolean(env.NEARAI_BASE_URL?.trim()), customModel: Boolean(env.NEARAI_MODEL?.trim()), reachable: null, status: null, error: null, ms: null };
  if (!ai.apiKey) problems.push("NEARAI_API_KEY isn't set, so the analysis doesn't run on NEAR AI's private inference.");
  else if (!baseHost) problems.push("NEARAI_BASE_URL isn't a full web address. Delete it in Vercel (the default https://cloud-api.near.ai/v1 is right) and redeploy.");
  else {
    const t = Date.now();
    try {
      const res = await fetch(`${ai.baseUrl}/models`, { headers: { authorization: `Bearer ${ai.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      nearAi = { ...nearAi, status: res.status, reachable: res.status < 500, ms: Date.now() - t };
      if (res.status === 401 || res.status === 403) problems.push(`NEAR AI turned the key down (HTTP ${res.status}). Make a new key in NEAR AI Cloud, paste it into NEARAI_API_KEY with no spaces, and redeploy.`);
      else if (res.status === 404) problems.push(`NEAR AI answered 404 at ${baseHost}. NEARAI_BASE_URL is probably wrong: delete it in Vercel so the default is used, and redeploy.`);
      else if (res.status === 402 || res.status === 429) problems.push(`NEAR AI answered HTTP ${res.status}: the account is out of credit or over its limit. Top up in NEAR AI Cloud.`);
      else if (res.status >= 400) problems.push(`NEAR AI answered HTTP ${res.status}. Decisions fall back to Claude or the built-in analyst.`);
      else if (res.ok) {
        const ids = await res
          .json()
          .then((d: { data?: Array<{ id?: string }> }) => (d.data ?? []).map((m) => m.id).filter(Boolean) as string[])
          .catch(() => [] as string[]);
        if (ids.length && !ids.includes(ai.model) && nearAi.customModel) problems.push(`NEAR AI doesn't list the model ${ai.model} by that name. Delete NEARAI_MODEL in Vercel to use the default, z-ai/glm-5.3-flash, and redeploy.`);
      }
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
      const code = e.cause?.code || e.name || "Error";
      const detail = (e.cause?.message || e.message || "").replace(/(key|token|secret|password)[^\s]*/gi, "[hidden]").slice(0, 120);
      nearAi = { ...nearAi, reachable: false, error: `${code}: ${detail}`.trim(), ms: Date.now() - t };
      problems.push(
        e.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT"
          ? `NEAR AI Cloud didn't answer within 15 seconds (${baseHost}). It may be down; decisions fall back to Claude or the built-in analyst.`
          : code === "ENOTFOUND"
            ? `The NEAR AI address ${baseHost} doesn't exist. Delete NEARAI_BASE_URL in Vercel so the default is used, and redeploy.`
            : `NEAR AI Cloud couldn't be reached (${code}). Decisions fall back to Claude or the built-in analyst.`,
      );
    }
  }

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
      missing: ledgerMissing,
      deploy: env.VERCEL_ENV ?? null,
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

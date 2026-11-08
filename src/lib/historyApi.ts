/**
 * The history endpoints' logic, kept out of the route files so it can be tested with fake
 * requests. Every call is scoped to the caller's owner.
 */
import { getHistory, type HistoryEntry, type HistoryStore, type HistorySummary } from "./history";
import { OAUTH_COOKIE, finishGoogle, googleEnabled } from "./google";
import { accountOwner, cookieHeader, googleOwner, makeNonce, makeSession, nearVerifier, SESSION_COOKIE, SESSION_DAYS, SIGN_IN_MESSAGE, SignInError, signInRecipient, verifySignIn, webOwner, withCookie, type VerifyNep413 } from "./identity";
import { getLedger } from "./ledger";
import { allow, clientKey } from "./ratelimit";
import { publicBaseUrl } from "./service";

type Env = Record<string, string | undefined>;

export const PRIVACY_NOTE =
  "Uprali keeps each decision's memo, the numbers it was given, its snapshot and fingerprint, so you can open and re-run it. It doesn't keep chat transcripts. Only the fingerprint goes on NEAR.";

export function storageNote(store: HistoryStore): string {
  return store.kind === "postgres" ? "Saved in this app's database." : "Demo storage: history is kept in the server's memory and resets when it restarts. Add a database to keep it.";
}

/** The history list for agents and screens: what each run decided, without the full memo. */
export function publicSummary(s: HistorySummary) {
  const { owner: _o, ...rest } = s;
  return rest;
}

export function publicEntry(e: HistoryEntry) {
  const { owner: _o, ...rest } = e;
  return rest;
}

export async function sessionInfo(req: Request, env: Env = process.env): Promise<Response> {
  const who = webOwner(req, env);
  const store = await getHistory(env);
  const nonce = makeNonce(env).toString("base64");
  return withCookie(
    Response.json({
      account: who.account,
      google: who.google ? { email: who.google.email } : null,
      googleSignIn: googleEnabled(env),
      storage: store.kind,
      storageNote: storageNote(store),
      privacyNote: PRIVACY_NOTE,
      signIn: { message: SIGN_IN_MESSAGE, recipient: signInRecipient(publicBaseUrl(req, env)), nonce },
    }),
    who.setCookie,
  );
}

export async function signIn(req: Request, env: Env = process.env, verifier?: VerifyNep413): Promise<Response> {
  if (!allow(`signin:${clientKey(req)}`, 10, 10 * 60_000)) return Response.json({ error: "Too many sign-in tries. Wait a few minutes." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const who = webOwner(req, env);
  let account: string;
  try {
    const ledger = await getLedger(env);
    if (ledger.network !== "near-testnet") return Response.json({ error: "NEAR sign-in for history turns on once the ledger is on testnet." }, { status: 400 });
    const verify = verifier ?? (await nearVerifier(env.NEAR_RPC_URL || "https://test.rpc.fastnear.com"));
    account = await verifySignIn(body, signInRecipient(publicBaseUrl(req, env)), verify, env);
  } catch (err) {
    if (err instanceof SignInError) return Response.json({ error: err.message }, { status: 401 });
    console.error("sign-in check failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Couldn't check the signature with NEAR right now. Try again." }, { status: 502 });
  }
  let moved = 0;
  try {
    const store = await getHistory(env);
    if (who.google) {
      // Already signed in with Google: the wallet's earlier runs join the Google history.
      moved = await store.moveOwner(accountOwner(account), googleOwner(who.google.sub));
    } else {
      moved = await store.moveOwner(who.owner, accountOwner(account));
    }
  } catch {
    /* the runs stay where they were */
  }
  const res = Response.json({ account, moved, google: who.google ? { email: who.google.email } : null });
  res.headers.append("set-cookie", cookieHeader(SESSION_COOKIE, makeSession(account, env, Date.now(), who.google), SESSION_DAYS * 86_400));
  return withCookie(res, who.setCookie);
}

/** Finishes a Google sign-in: this browser's runs, and a signed-in wallet's, join the Google history. */
export async function googleSignedIn(req: Request, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Response> {
  const who = webOwner(req, env);
  const back = (path: string) => {
    const res = new Response(null, { status: 302, headers: { location: new URL(path, new URL(req.url).origin).toString() } });
    res.headers.append("set-cookie", cookieHeader(OAUTH_COOKIE, "", 0));
    return res;
  };
  let user: { sub: string; email: string };
  let returnTo: string;
  try {
    ({ user, returnTo } = await finishGoogle(req, env, fetcher));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Google sign-in didn't work.";
    return withCookie(back(`/history?signin_error=${encodeURIComponent(msg.slice(0, 200))}`), who.setCookie);
  }
  const to = googleOwner(user.sub);
  try {
    const store = await getHistory(env);
    await store.moveOwner(`browser:${who.browserId}`, to);
    if (who.account) await store.moveOwner(accountOwner(who.account), to);
  } catch {
    /* the runs stay where they were */
  }
  const res = back(returnTo);
  res.headers.append("set-cookie", cookieHeader(SESSION_COOKIE, makeSession(who.account, env, Date.now(), user), SESSION_DAYS * 86_400));
  return withCookie(res, who.setCookie);
}

export function signOutResponse(): Response {
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", cookieHeader(SESSION_COOKIE, "", 0));
  return res;
}

export async function listFor(owner: string, url: URL, env: Env = process.env) {
  const store = await getHistory(env);
  const limit = Number(url.searchParams.get("limit") || 50);
  const decisionId = url.searchParams.get("decision_id")?.slice(0, 64) || undefined;
  const items = await store.list(owner, { limit, decisionId });
  return { storage: store.kind, storageNote: storageNote(store), privacyNote: PRIVACY_NOTE, decisions: items.map(publicSummary) };
}

export async function webList(req: Request, env: Env = process.env): Promise<Response> {
  const who = webOwner(req, env);
  try {
    const out = await listFor(who.owner, new URL(req.url), env);
    return withCookie(Response.json({ account: who.account, google: who.google ? { email: who.google.email } : null, googleSignIn: googleEnabled(env), ...out }), who.setCookie);
  } catch {
    return Response.json({ error: "Couldn't read the history. Check the database connection." }, { status: 503 });
  }
}

export async function webGet(req: Request, id: string, env: Env = process.env): Promise<Response> {
  const who = webOwner(req, env);
  try {
    const store = await getHistory(env);
    const e = await store.get(who.owner, id);
    if (!e) return Response.json({ error: "No decision with that id in your history." }, { status: 404 });
    const versions = await store.list(who.owner, { decisionId: e.decisionId, limit: 20 });
    return Response.json({ decision: publicEntry(e), versions: versions.map(publicSummary) });
  } catch {
    return Response.json({ error: "Couldn't read the history. Check the database connection." }, { status: 503 });
  }
}

export async function webDelete(req: Request, id: string, env: Env = process.env): Promise<Response> {
  const who = webOwner(req, env);
  try {
    const ok = await (await getHistory(env)).remove(who.owner, id);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "No decision with that id in your history." }, { status: 404 });
  } catch {
    return Response.json({ error: "Couldn't delete it. Check the database connection." }, { status: 503 });
  }
}

/** Looks the run's fingerprint up on the ledger and, if it's there, marks the run recorded. */
export async function webCheck(req: Request, id: string, env: Env = process.env): Promise<Response> {
  if (!allow(`check:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many checks. Wait a minute." }, { status: 429 });
  const who = webOwner(req, env);
  try {
    const store = await getHistory(env);
    const e = await store.get(who.owner, id);
    if (!e) return Response.json({ error: "No decision with that id in your history." }, { status: 404 });
    const ledger = await getLedger(env);
    const anchor = await ledger.get(e.fingerprint);
    if (anchor && !e.recorded) {
      const body = (await req.json().catch(() => null)) as { txHash?: unknown } | null;
      const tx = typeof body?.txHash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(body.txHash) ? body.txHash : null;
      const recorded = { network: ledger.network, by: anchor.recordedBy, atMs: anchor.timestampMs, txUrl: tx ? `https://testnet.nearblocks.io/txns/${tx}` : null };
      await store.markRecorded(e.fingerprint, recorded);
      return Response.json({ recorded });
    }
    return Response.json({ recorded: anchor ? e.recorded : null });
  } catch {
    return Response.json({ error: "Couldn't check the ledger right now." }, { status: 502 });
  }
}

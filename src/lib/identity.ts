/**
 * Who owns a run. A NEAR account counts only after it signs a sign-in message (NEP-413) with a
 * full-access key, because a wallet's account name on its own is just a claim from the browser.
 * Until then, runs belong to the browser (a random id in an HttpOnly cookie) and move to the
 * account once it signs in. Slack runs belong to the Slack user, API runs to the API key.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { databaseUrl } from "./history";
import { presentedKey, authRequired } from "./auth";

type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "uprali_session";
export const BROWSER_COOKIE = "uprali_browser";
export const SESSION_DAYS = 30;
export const NONCE_TTL_MS = 10 * 60_000;
export const SIGN_IN_MESSAGE = "Sign in to Uprali to open your decision history. This costs nothing and moves no money.";

const g = globalThis as unknown as { __upraliSecret?: Buffer };

/** SESSION_SECRET if set, else derived from the database URL (already a server secret), else one per process. */
export function sessionSecret(env: Env = process.env): Buffer {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 16) return createHash("sha256").update(`uprali-session|${env.SESSION_SECRET}`).digest();
  const db = databaseUrl(env);
  if (db) return createHash("sha256").update(`uprali-session|db|${db}`).digest();
  if (!g.__upraliSecret) g.__upraliSecret = randomBytes(32);
  return g.__upraliSecret;
}

const b64u = (b: Buffer) => b.toString("base64url");

function mac(secret: Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function same(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookieHeader(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

// ---------- session ----------

/** A signed-in browser: a NEAR account (checked by its signature), a Google account (checked by Google), or both. */
export interface SessionInfo {
  account: string | null;
  google: { sub: string; email: string } | null;
}

export function makeSession(account: string | null, env: Env = process.env, now = Date.now(), google: SessionInfo["google"] = null): string {
  const body: Record<string, unknown> = { e: now + SESSION_DAYS * 86_400_000 };
  if (account) body.a = account;
  if (google) {
    body.g = google.sub;
    body.m = google.email;
  }
  const payload = b64u(Buffer.from(JSON.stringify(body)));
  return `v1.${payload}.${b64u(mac(sessionSecret(env), `v1.${payload}`))}`;
}

export function readSessionInfo(token: string | null, env: Env = process.env, now = Date.now()): SessionInfo | null {
  if (!token) return null;
  const [v, payload, sig] = token.split(".");
  if (v !== "v1" || !payload || !sig) return null;
  if (!same(Buffer.from(sig, "base64url"), mac(sessionSecret(env), `v1.${payload}`))) return null;
  try {
    const { a, e, g, m } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: unknown; e?: unknown; g?: unknown; m?: unknown };
    if (typeof e !== "number" || e < now) return null;
    const account = typeof a === "string" && validAccountId(a) ? a : null;
    const google = typeof g === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(g) ? { sub: g, email: typeof m === "string" ? m.slice(0, 254) : "" } : null;
    if (!account && !google) return null;
    return { account, google };
  } catch {
    return null;
  }
}

/** The NEAR account a session holds, if any. */
export function readSession(token: string | null, env: Env = process.env, now = Date.now()): string | null {
  return readSessionInfo(token, env, now)?.account ?? null;
}

export function validAccountId(a: string): boolean {
  return a.length >= 2 && a.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);
}

// ---------- sign-in nonce (stateless: random, time, and a MAC) ----------

export function makeNonce(env: Env = process.env, now = Date.now()): Buffer {
  const head = Buffer.alloc(24);
  randomBytes(16).copy(head, 0);
  head.writeBigUInt64BE(BigInt(now), 16);
  return Buffer.concat([head, mac(sessionSecret(env), head).subarray(0, 8)]);
}

export function checkNonce(nonce: Buffer, env: Env = process.env, now = Date.now()): boolean {
  if (nonce.length !== 32) return false;
  const head = nonce.subarray(0, 24);
  if (!same(nonce.subarray(24), mac(sessionSecret(env), head).subarray(0, 8))) return false;
  const t = Number(head.readBigUInt64BE(16));
  return t <= now + 60_000 && now - t <= NONCE_TTL_MS;
}

export interface SignedSignIn {
  accountId: string;
  publicKey: string;
  /** base64, as wallets return it */
  signature: string;
  /** base64 of the 32-byte nonce the server handed out */
  nonce: string;
}

/** Checks the signature and that the key is a full-access key of the account. Throws with a reason. */
export type VerifyNep413 = (args: { accountId: string; publicKey: string; signature: Uint8Array; payload: { message: string; recipient: string; nonce: Uint8Array } }) => Promise<void>;

export async function nearVerifier(rpcUrl: string): Promise<VerifyNep413> {
  const [{ verifyMessage }, { JsonRpcProvider }] = await Promise.all([import("near-api-js/nep413"), import("near-api-js")]);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  return async ({ accountId, publicKey, signature, payload }) => {
    await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey, signature, payload, provider: provider as never });
  };
}

export function signInRecipient(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return "uprali";
  }
}

export class SignInError extends Error {}

/** Returns the account id once the signed message checks out. */
export async function verifySignIn(body: unknown, recipient: string, verify: VerifyNep413, env: Env = process.env, now = Date.now()): Promise<string> {
  const b = (body ?? {}) as Partial<SignedSignIn>;
  if (typeof b.accountId !== "string" || !validAccountId(b.accountId)) throw new SignInError("That isn't a NEAR account id.");
  if (typeof b.publicKey !== "string" || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(b.publicKey)) throw new SignInError("The wallet didn't send an ed25519 key.");
  if (typeof b.signature !== "string" || typeof b.nonce !== "string") throw new SignInError("The wallet didn't send a signature.");
  const nonce = Buffer.from(b.nonce, "base64");
  if (!checkNonce(nonce, env, now)) throw new SignInError("The sign-in request expired. Try again.");
  const signature = Buffer.from(b.signature, "base64");
  if (signature.length !== 64) throw new SignInError("The wallet's signature isn't the right length.");
  try {
    await verify({ accountId: b.accountId, publicKey: b.publicKey, signature, payload: { message: SIGN_IN_MESSAGE, recipient, nonce } });
  } catch {
    throw new SignInError("The signature didn't check out against that account's full-access keys.");
  }
  return b.accountId;
}

// ---------- owners ----------

export interface WebOwner {
  owner: string;
  account: string | null;
  google: SessionInfo["google"];
  browserId: string;
  /** Set-Cookie to send when the browser had no id yet. */
  setCookie: string | null;
}

export function webOwner(req: Request, env: Env = process.env): WebOwner {
  const session = readSessionInfo(readCookie(req, SESSION_COOKIE), env);
  const account = session?.account ?? null;
  const google = session?.google ?? null;
  let browserId = readCookie(req, BROWSER_COOKIE);
  let setCookie: string | null = null;
  if (!browserId || !/^[a-f0-9]{32}$/.test(browserId)) {
    browserId = randomBytes(16).toString("hex");
    setCookie = cookieHeader(BROWSER_COOKIE, browserId, 400 * 86_400);
  }
  // A Google account, once used, holds the history: runs from a wallet signed in alongside it move there.
  return { owner: google ? googleOwner(google.sub) : account ? accountOwner(account) : browserOwner(browserId), account, google, browserId, setCookie };
}

export const accountOwner = (account: string) => `near:${account}`;
export const browserOwner = (id: string) => `browser:${id}`;
export const googleOwner = (sub: string) => `google:${sub}`;
export const slackOwner = (team: string, user: string) => `slack:${team}:${user}`;

/** API and MCP runs are kept per API key, so only with keys set. With an open API there's no owner to keep them for. */
export function apiOwner(req: Request, env: Env = process.env): string | null {
  if (!authRequired(env)) return null;
  const k = presentedKey(req);
  return k ? `apikey:${createHash("sha256").update(k).digest("hex").slice(0, 24)}` : null;
}

export function withCookie(res: Response, cookie: string | null): Response {
  if (cookie) res.headers.append("set-cookie", cookie);
  return res;
}

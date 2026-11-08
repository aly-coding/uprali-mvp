/**
 * Optional "Sign in with Google", only to keep a person's History across visits. It never records
 * on NEAR: the wallet does that. It switches on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are
 * set, and stays hidden otherwise.
 *
 * Plain OAuth 2.0 authorization-code flow. The id_token comes straight from Google's token
 * endpoint over TLS, in exchange for our client secret, so its claims are trusted without a
 * separate signature check (Google's own guidance for server-side flows); audience, issuer, expiry
 * and email verification are still checked.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookieHeader, readCookie, sessionSecret } from "./identity";

type Env = Record<string, string | undefined>;

export const OAUTH_COOKIE = "uprali_google_state";
const STATE_TTL_MS = 10 * 60_000;

export function googleEnabled(env: Env = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function googleRedirectUri(req: Request): string {
  return `${new URL(req.url).origin}/api/auth/google/callback`;
}

/** Only same-site paths, so the sign-in can't be turned into a redirect to another site. */
export function safeReturnPath(p: string | null | undefined): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > 300) return "/history";
  return p;
}

function sign(data: string, env: Env): string {
  return createHmac("sha256", sessionSecret(env)).update(`google-state|${data}`).digest("base64url");
}

export function makeState(returnTo: string, env: Env = process.env, now = Date.now()): string {
  const data = Buffer.from(JSON.stringify({ n: randomBytes(16).toString("base64url"), t: now, r: safeReturnPath(returnTo) })).toString("base64url");
  return `${data}.${sign(data, env)}`;
}

/** The return path, when the state is ours, fresh, and matches the cookie this browser was given. */
export function checkState(state: string | null, cookie: string | null, env: Env = process.env, now = Date.now()): string | null {
  if (!state || !cookie || state.length > 1000) return null;
  const a = Buffer.from(state);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const want = Buffer.from(sign(data, env));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { t, r } = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { t?: unknown; r?: unknown };
    if (typeof t !== "number" || now - t > STATE_TTL_MS || t > now + 60_000) return null;
    return safeReturnPath(typeof r === "string" ? r : null);
  } catch {
    return null;
  }
}

export function startGoogle(req: Request, env: Env = process.env): Response {
  if (!googleEnabled(env)) return new Response("Google sign-in isn't set up on this site.", { status: 404 });
  const state = makeState(new URL(req.url).searchParams.get("return") ?? "/history", env);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!.trim());
  u.searchParams.set("redirect_uri", googleRedirectUri(req));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  const res = new Response(null, { status: 302, headers: { location: u.toString() } });
  res.headers.append("set-cookie", cookieHeader(OAUTH_COOKIE, state, 600));
  return res;
}

export interface GoogleUser {
  sub: string;
  email: string;
}

/** Checks the id_token's claims. Throws with a plain reason. */
export function claimsFromIdToken(idToken: string, clientId: string, now = Date.now()): GoogleUser {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("Google didn't send an id token.");
  const c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  if (c.aud !== clientId) throw new Error("The Google token is for another app.");
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("The token isn't from Google.");
  if (typeof c.exp !== "number" || c.exp * 1000 < now) throw new Error("The Google sign-in expired. Try again.");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("Google didn't say who signed in.");
  if (c.email_verified !== true && c.email_verified !== "true") throw new Error("That Google account's email isn't verified.");
  return { sub: c.sub, email: typeof c.email === "string" ? c.email : "" };
}

export async function finishGoogle(req: Request, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<{ user: GoogleUser; returnTo: string }> {
  if (!googleEnabled(env)) throw new Error("Google sign-in isn't set up on this site.");
  const url = new URL(req.url);
  if (url.searchParams.get("error")) throw new Error("Google sign-in was cancelled.");
  const returnTo = checkState(url.searchParams.get("state"), readCookie(req, OAUTH_COOKIE), env);
  if (!returnTo) throw new Error("The sign-in request expired or came from another browser. Try again.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Google didn't send a sign-in code.");
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google didn't accept the sign-in (HTTP ${res.status}). Check that this site's address is an authorized redirect URI.`);
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("Google didn't send an id token.");
  return { user: claimsFromIdToken(data.id_token, env.GOOGLE_CLIENT_ID!.trim()), returnTo };
}

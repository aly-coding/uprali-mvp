import { describe, expect, it } from "vitest";
import { checkState, claimsFromIdToken, googleEnabled, makeState, safeReturnPath, startGoogle } from "@/lib/google";
import { googleSignedIn } from "@/lib/historyApi";
import { makeSession, readSessionInfo, webOwner } from "@/lib/identity";

const env = { SESSION_SECRET: "test-secret-0123456789abcdef", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "shh" };
const idToken = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const good = { aud: env.GOOGLE_CLIENT_ID, iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 600, sub: "1234567890", email: "aly@example.com", email_verified: true };

describe("Google sign-in for History", () => {
  it("stays off without keys", () => {
    expect(googleEnabled({})).toBe(false);
    expect(startGoogle(new Request("https://site.example/api/auth/google"), {}).status).toBe(404);
  });

  it("sends the browser to Google with this site's callback and a state cookie", () => {
    const r = startGoogle(new Request("https://site.example/api/auth/google?return=/history?id=abc"), env);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.host).toBe("accounts.google.com");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://site.example/api/auth/google/callback");
    expect(r.headers.get("set-cookie")).toContain("uprali_google_state=");
  });

  it("only returns to paths on this site", () => {
    expect(safeReturnPath("https://evil.example")).toBe("/history");
    expect(safeReturnPath("//evil.example")).toBe("/history");
    expect(safeReturnPath("/history?id=1")).toBe("/history?id=1");
    const s = makeState("/history?id=1", env);
    expect(checkState(s, s, env)).toBe("/history?id=1");
    expect(checkState(s, "other", env)).toBeNull();
    expect(checkState(s, s, env, Date.now() + 11 * 60_000)).toBeNull();
  });

  it("checks the token's audience, issuer and verified email", () => {
    expect(claimsFromIdToken(idToken(good), env.GOOGLE_CLIENT_ID)).toEqual({ sub: "1234567890", email: "aly@example.com" });
    expect(() => claimsFromIdToken(idToken({ ...good, aud: "other" }), env.GOOGLE_CLIENT_ID)).toThrow();
    expect(() => claimsFromIdToken(idToken({ ...good, email_verified: false }), env.GOOGLE_CLIENT_ID)).toThrow();
  });

  it("finishes sign-in, keeps the wallet, and makes Google the history owner", async () => {
    const state = makeState("/history?id=r1", env);
    const cookie = `uprali_google_state=${encodeURIComponent(state)}; uprali_browser=${"a".repeat(32)}; uprali_session=${makeSession("alice.testnet", env)}`;
    const req = new Request(`https://site.example/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie } });
    const fakeFetch = (async () => Response.json({ id_token: idToken(good) })) as unknown as typeof fetch;
    const res = await googleSignedIn(req, env, fakeFetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://site.example/history?id=r1");
    const set = res.headers.getSetCookie().find((c) => c.startsWith("uprali_session="))!;
    const token = decodeURIComponent(set.split(";")[0].split("=")[1]);
    expect(readSessionInfo(token, env)).toEqual({ account: "alice.testnet", google: { sub: "1234567890", email: "aly@example.com" } });
    const who = webOwner(new Request("https://site.example/", { headers: { cookie: `uprali_session=${encodeURIComponent(token)}` } }), env);
    expect(who.owner).toBe("google:1234567890");
  });

  it("sends a refused sign-in back to History with the reason", async () => {
    const res = await googleSignedIn(new Request("https://site.example/api/auth/google/callback?error=access_denied"), env);
    expect(res.headers.get("location")).toContain("/history?signin_error=");
  });
});

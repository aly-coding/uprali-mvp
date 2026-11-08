/**
 * Asks NEAR's testnet faucet service to create and fund one setup account. The browser makes the
 * key pair and sends only the public key; the private key never leaves the owner's browser.
 * The route goes through our server because the faucet service isn't meant to be called from
 * web pages. It only takes the names /setup makes, is rate limited, and switches itself off
 * once a ledger is configured or on any network other than testnet.
 */
import { allow, clientKey } from "@/lib/ratelimit";
import { FAUCET_URL, validSponsorRequest } from "@/lib/setup";


type Env = Record<string, string | undefined>;

export async function sponsor(req: Request, env: Env = process.env, f: typeof fetch = fetch): Promise<Response> {
  if (env.NEAR_CONTRACT_ID) return Response.json({ ok: false, error: "The ledger is already set up on this site." }, { status: 409 });
  if (env.NEAR_NETWORK && env.NEAR_NETWORK !== "testnet") return Response.json({ ok: false, error: "Setup only runs on NEAR testnet." }, { status: 400 });
  if (!allow(`sponsor:${clientKey(req)}`, 6, 10 * 60_000)) return Response.json({ ok: false, error: "Too many tries. Wait ten minutes and press the button again." }, { status: 429 });
  const body = validSponsorRequest(await req.json().catch(() => null));
  if (!body) return Response.json({ ok: false, error: "That isn't an account this page makes." }, { status: 400 });

  try {
    const res = await f(env.NEAR_FAUCET_URL || FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: body.accountId, newAccountPublicKey: body.publicKey }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return Response.json({ ok: true, accountId: body.accountId });
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    console.error("faucet refused:", res.status);
    return Response.json({ ok: false, error: `NEAR's faucet said no (${res.status})${text ? `: ${text}` : ""}.` }, { status: 502 });
  } catch {
    console.error("faucet unreachable");
    return Response.json({ ok: false, error: "Couldn't reach NEAR's faucet. Try again in a minute." }, { status: 502 });
  }
}

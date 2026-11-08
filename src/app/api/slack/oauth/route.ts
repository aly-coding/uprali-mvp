import { exchangeCode, installReady, STATE_COOKIE } from "@/lib/slack/install";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Slack sends the person back here after they approve the install. */
export async function GET(req: Request) {
  const base = publicBaseUrl(req);
  const url = new URL(req.url);
  const done = (query: string) =>
    new Response(null, {
      status: 302,
      headers: { location: `${base}/slack?${query}`, "set-cookie": `${STATE_COOKIE}=; Path=/api/slack; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
    });
  if (!installReady()) return done("error=not-set-up");
  if (url.searchParams.get("error")) return done("error=cancelled");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || state !== cookie(req, STATE_COOKIE)) return done("error=expired");
  const team = await exchangeCode(code, base, process.env).catch(() => null);
  return team ? done(`installed=${encodeURIComponent(team)}`) : done("error=refused");
}

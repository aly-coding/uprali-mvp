import { health } from "@/lib/health";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Open it in a browser and paste what it says. Setting names only, never their values. */
export async function GET(req: Request) {
  if (!allow(`health:${clientKey(req)}`, 20, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const h = await health();
  return new Response(JSON.stringify(h, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

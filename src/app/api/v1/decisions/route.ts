import { isAuthorized, unauthorized } from "@/lib/auth";
import { apiOwner } from "@/lib/identity";
import { listFor } from "@/lib/historyApi";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Past decisions made with this API key, newest first. ?limit=, ?decision_id= for one decision's versions. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  if (!allow(`v1list:${clientKey(req)}`, 60, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const owner = apiOwner(req);
  if (!owner) return Response.json({ error: "History for agents is kept per API key. Set UPRALI_API_KEYS on the server to turn it on." }, { status: 403 });
  try {
    return Response.json(await listFor(owner, new URL(req.url)));
  } catch {
    return Response.json({ error: "Couldn't read the history." }, { status: 503 });
  }
}

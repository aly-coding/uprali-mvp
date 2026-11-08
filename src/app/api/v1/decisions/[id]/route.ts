import { isAuthorized, unauthorized } from "@/lib/auth";
import { getHistory } from "@/lib/history";
import { publicEntry } from "@/lib/historyApi";
import { apiOwner } from "@/lib/identity";

export const dynamic = "force-dynamic";

/** One past decision made with this API key: the full memo, the numbers it was given and its snapshot. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const owner = apiOwner(req);
  if (!owner) return Response.json({ error: "History for agents is kept per API key. Set UPRALI_API_KEYS on the server to turn it on." }, { status: 403 });
  try {
    const e = await (await getHistory()).get(owner, (await ctx.params).id);
    return e ? Response.json({ decision: publicEntry(e) }) : Response.json({ error: "No decision with that id for this API key." }, { status: 404 });
  } catch {
    return Response.json({ error: "Couldn't read the history." }, { status: 503 });
  }
}

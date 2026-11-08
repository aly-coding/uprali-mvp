import { publicEntry } from "@/lib/historyApi";
import { allow, clientKey } from "@/lib/ratelimit";
import { getSample } from "@/lib/sample";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The sample decision for judges: memo, snapshot, fingerprint and where it's recorded. */
export async function GET(req: Request) {
  if (!allow(`sample:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  try {
    const e = await getSample(publicBaseUrl(req));
    return Response.json({ decision: publicEntry(e) });
  } catch (err) {
    console.error("sample failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Couldn't load the sample decision. Try again in a moment." }, { status: 503 });
  }
}

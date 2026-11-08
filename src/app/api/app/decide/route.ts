import { allow, clientKey } from "@/lib/ratelimit";
import { buildVsBuyBody, cleanInputs, zodMessage } from "@/lib/schema";
import { errorResponse, publicBaseUrl, runDecision } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Used by the demo screen. No API key, but rate-limited. Never records: the person records
 * with their own wallet, or through /api/app/record in demo mode.
 */
export async function POST(req: Request) {
  if (!allow(`app:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many decisions in a minute. Wait a moment." }, { status: 429 });
  const parsed = buildVsBuyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const b = parsed.data;
  try {
    const r = await runDecision(
      { question: b.question, title: b.title, inputs: cleanInputs(b.inputs), approvedBy: b.approved_by, decidedBy: b.decided_by || "demo-user" },
      publicBaseUrl(req),
    );
    return Response.json({ ...r, recorded: null, recordError: null });
  } catch (err) {
    return errorResponse(err);
  }
}

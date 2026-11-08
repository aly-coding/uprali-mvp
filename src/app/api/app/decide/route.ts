import { webOwner, withCookie } from "@/lib/identity";
import { allow, clientKey } from "@/lib/ratelimit";
import { isCaseTemplate } from "@/lib/engine/cases";
import { cleanInputs, decideBody, fieldsFor, zodMessage } from "@/lib/schema";
import { errorResponse, publicBaseUrl, runAndSave, runCaseAndSave } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Used by the demo screen. No API key, but rate-limited. Never records: the person records
 * with their own wallet, or through /api/app/record in demo mode. Each run is kept in the
 * history of the signed-in NEAR account, or of this browser until it signs in.
 */
export async function POST(req: Request) {
  if (!allow(`app:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many decisions in a minute. Wait a moment." }, { status: 429 });
  const parsed = decideBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const b = parsed.data;
  const who = webOwner(req);
  try {
    const common = { question: b.question, title: b.title, inputs: cleanInputs(b.inputs, fieldsFor(b.template)), approvedBy: b.approved_by, decidedBy: who.account || b.decided_by || "demo-user" };
    const target = { owner: who.owner, source: "web" as const, parentId: b.parent_id };
    const r = isCaseTemplate(b.template)
      ? await runCaseAndSave({ ...common, template: b.template }, publicBaseUrl(req), target)
      : await runAndSave(common, publicBaseUrl(req), target);
    return withCookie(Response.json({ ...r, recorded: null, recordError: null }), who.setCookie);
  } catch (err) {
    return errorResponse(err);
  }
}

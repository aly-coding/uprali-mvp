import { isAuthorized, unauthorized } from "@/lib/auth";
import { describeTemplates } from "@/lib/engine/templateInfo";
import type { CaseTemplateId } from "@/lib/engine/cases";
import { apiOwner } from "@/lib/identity";
import { allow, clientKey } from "@/lib/ratelimit";
import { caseBody, cleanInputs, fieldsFor, zodMessage } from "@/lib/schema";
import { errorResponse, publicBaseUrl, runCaseAndSave } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The business-case templates and their fields. */
export async function GET() {
  return Response.json({ templates: describeTemplates().templates.filter((t) => t.id !== "build_vs_buy") });
}

/** Runs a three-year business case. Every number in the memo carries its source and owner, and the snapshot is fingerprinted. */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  if (!allow(`v1case:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const parsed = caseBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const b = parsed.data;
  const template = b.template as CaseTemplateId;
  try {
    const result = await runCaseAndSave(
      { template, question: b.question, title: b.title, inputs: cleanInputs(b.inputs, fieldsFor(template)), record: b.record, approvedBy: b.approved_by, decidedBy: b.decided_by || "api-agent" },
      publicBaseUrl(req),
      { owner: apiOwner(req), source: "api", parentId: b.parent_id },
    );
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

import { isAuthorized, unauthorized } from "@/lib/auth";
import { FIELDS, TEMPLATE } from "@/lib/engine/buildVsBuy";
import { allow, clientKey } from "@/lib/ratelimit";
import { buildVsBuyBody, cleanInputs, zodMessage } from "@/lib/schema";
import { apiOwner } from "@/lib/identity";
import { errorResponse, publicBaseUrl, runAndSave } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Describes the tool: every field it takes, with its question and benchmark. */
export async function GET() {
  return Response.json({
    template: TEMPLATE,
    fields: FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      unit: f.unit,
      ask: f.ask,
      benchmark: typeof f.benchmark === "function" ? "computed" : (f.benchmark ?? null),
      benchmarkSource: f.benchmarkSource ?? null,
      onlyAHumanCanAnswer: f.benchmark === undefined || !!f.humanShouldConfirm,
    })),
  });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  if (!allow(`v1:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const parsed = buildVsBuyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const b = parsed.data;
  try {
    const result = await runAndSave(
      { question: b.question, title: b.title, inputs: cleanInputs(b.inputs), record: b.record, approvedBy: b.approved_by, decidedBy: b.decided_by || "api-agent" },
      publicBaseUrl(req),
      { owner: apiOwner(req), source: "api", parentId: b.parent_id },
    );
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

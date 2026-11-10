import { cleanFor, explain, inputsBody, isExcelModel } from "@/lib/excel/api";
import { allow, clientKey } from "@/lib/ratelimit";
import { zodMessage } from "@/lib/schema";
import { errorResponse } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Runs Uprali on the numbers in a sheet: the rules' totals, to check against the sheet, and the
 * analyst's notes, marked as a suggestion. Nothing is saved to history or recorded on NEAR.
 */
export async function POST(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!isExcelModel(id)) return Response.json({ error: "Unknown model." }, { status: 404 });
  if (!allow(`excel-explain:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many requests in a minute. Wait a moment." }, { status: 429 });
  const parsed = inputsBody(id).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  try {
    return Response.json(await explain(id, cleanFor(parsed.data.inputs)));
  } catch (err) {
    return errorResponse(err);
  }
}

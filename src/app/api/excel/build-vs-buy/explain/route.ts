import { z } from "zod";
import { explain } from "@/lib/excel/api";
import { allow, clientKey } from "@/lib/ratelimit";
import { cleanInputs, inputsSchema, zodMessage } from "@/lib/schema";
import { errorResponse } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ inputs: inputsSchema.optional() });

/**
 * Runs Uprali's analyst on the numbers in the sheet. The totals come from the same rules as
 * the sheet, so the panel can check the two agree. The AI's words are marked as a suggestion.
 * Nothing is saved to history or recorded on NEAR from here.
 */
export async function POST(req: Request) {
  if (!allow(`excel-explain:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many requests in a minute. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  try {
    return Response.json(await explain("build_vs_buy", cleanInputs(parsed.data.inputs)));
  } catch (err) {
    return errorResponse(err);
  }
}

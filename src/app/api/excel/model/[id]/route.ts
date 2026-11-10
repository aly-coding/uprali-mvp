import { cleanFor, fieldsPayload, inputsBody, isExcelModel, layout } from "@/lib/excel/api";
import { allow, clientKey } from "@/lib/ratelimit";
import { zodMessage } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const unknown = () => Response.json({ error: "Unknown model. Use build_vs_buy, new_product, ai_investment or unit_economics." }, { status: 404 });

/** The questions for one model, with Uprali's benchmarks. */
export async function GET(_req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!isExcelModel(id)) return unknown();
  return Response.json(fieldsPayload(id));
}

/** Lays out the model's sheet for the numbers given. Nothing is saved or recorded here. */
export async function POST(req: Request, ctx: Ctx) {
  const id = (await ctx.params).id;
  if (!isExcelModel(id)) return unknown();
  if (!allow(`excel:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many requests in a minute. Wait a moment." }, { status: 429 });
  const parsed = inputsBody(id).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const r = layout(id, cleanFor(parsed.data.inputs));
  return "error" in r ? Response.json({ error: r.error }, { status: 400 }) : Response.json(r.spec);
}

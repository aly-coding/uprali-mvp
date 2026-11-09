import { z } from "zod";
import { FIELD_GROUPS, TEMPLATE } from "@/lib/engine/buildVsBuy";
import { buildVsBuySheet, SHEET_FIELDS } from "@/lib/excel/buildVsBuySheet";
import { allow, clientKey } from "@/lib/ratelimit";
import { cleanInputs, inputsSchema, zodMessage } from "@/lib/schema";

export const dynamic = "force-dynamic";

/** What the Excel panel's form asks for: the cost fields, grouped, with Uprali's benchmarks. */
export async function GET() {
  return Response.json({
    template: TEMPLATE,
    groups: FIELD_GROUPS.filter((g) => g.id === "buy" || g.id === "build"),
    required: ["buy_annual_cost", "prototype_weeks"],
    fields: SHEET_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      unit: f.unit,
      group: f.group ?? "general",
      ask: f.ask,
      help: f.help ?? null,
      benchmark: typeof f.benchmark === "function" ? "computed" : (f.benchmark ?? null),
      benchmarkSource: f.benchmarkSource ?? null,
      confirm: f.benchmark === undefined || !!f.humanShouldConfirm,
    })),
  });
}

const body = z.object({ inputs: inputsSchema.optional() });

/**
 * Lays out the sheet for the inputs given: every cell, formula, format and named range. The
 * panel writes it into a new worksheet. Nothing is saved or recorded here.
 */
export async function POST(req: Request) {
  if (!allow(`excel:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: "Too many requests in a minute. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  const inputs = cleanInputs(parsed.data.inputs);
  for (const k of ["buy_annual_cost", "prototype_weeks"]) {
    if (inputs[k] === undefined) return Response.json({ error: k === "buy_annual_cost" ? "Add the yearly subscription for the tool you'd buy." : "Add the engineer-weeks for a working prototype." }, { status: 400 });
  }
  return Response.json(buildVsBuySheet(inputs));
}

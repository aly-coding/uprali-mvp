import { z } from "zod";
import { FIELDS } from "./engine/buildVsBuy";
import type { GivenValue } from "./engine/types";

export const givenValue = z.union([
  z.number(),
  z.string().max(200),
  z.object({
    value: z.union([z.number(), z.string().max(200)]),
    source: z.string().max(300).optional().describe("Where the number comes from, e.g. 'HubSpot invoice, Oct 2026'"),
    owner: z.enum(["human", "agent"]).optional().describe("Who stands behind it: a person, or an agent"),
    is_assumption: z.boolean().optional().describe("True if it's an estimate, not a known fact"),
    confidence: z.enum(["high", "medium", "low"]).optional(),
  }),
]);

/** One optional entry per field of the template, each described with the question it answers. */
export const fieldShape = Object.fromEntries(
  FIELDS.map((f) => [f.key, givenValue.optional().describe(`${f.label}. ${f.ask}`)]),
) as Record<string, z.ZodOptional<typeof givenValue>>;

export const inputsSchema = z.object(fieldShape).strict();

export const buildVsBuyBody = z.object({
  question: z.string().max(4000).optional(),
  title: z.string().max(120).optional(),
  inputs: inputsSchema.optional(),
  record: z.boolean().optional(),
  approved_by: z.array(z.string().max(120)).max(10).optional(),
  decided_by: z.string().max(120).optional(),
});

export type BuildVsBuyBody = z.infer<typeof buildVsBuyBody>;

export function cleanInputs(x: Record<string, unknown> | undefined): Record<string, GivenValue> {
  const out: Record<string, GivenValue> = {};
  for (const f of FIELDS) {
    const v = x?.[f.key];
    if (v !== undefined && v !== null && v !== "") out[f.key] = v as GivenValue;
  }
  return out;
}

export function zodMessage(err: z.ZodError): string {
  return err.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

import { describeTemplates } from "@/lib/engine/templateInfo";

export const dynamic = "force-static";

/** Every decision template, its owner cards and the fields it takes. No key needed: it holds no data. */
export async function GET() {
  return Response.json(describeTemplates());
}

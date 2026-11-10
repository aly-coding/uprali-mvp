import { EXCEL_MODELS } from "@/lib/excel/api";

export const dynamic = "force-dynamic";

/** The models the Excel panel offers. */
export async function GET() {
  return Response.json({ models: EXCEL_MODELS });
}

import { webCheck } from "@/lib/historyApi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return webCheck(req, (await ctx.params).id);
}

import { webDelete, webGet } from "@/lib/historyApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return webGet(req, (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: Ctx) {
  return webDelete(req, (await ctx.params).id);
}

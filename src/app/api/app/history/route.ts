import { webList } from "@/lib/historyApi";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => webList(req);

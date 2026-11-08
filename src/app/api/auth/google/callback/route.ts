import { googleSignedIn } from "@/lib/historyApi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Google sends the browser back here after sign-in. */
export const GET = (req: Request) => googleSignedIn(req);

import { startGoogle } from "@/lib/google";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Sends the browser to Google to sign in, only to keep History across visits. */
export function GET(req: Request) {
  if (!allow(`google:${clientKey(req)}`, 20, 10 * 60_000)) return new Response("Too many sign-in tries. Wait a few minutes.", { status: 429 });
  return startGoogle(req);
}

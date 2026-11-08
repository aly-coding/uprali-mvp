import { randomBytes } from "node:crypto";
import { authorizeUrl, installReady, STATE_COOKIE } from "@/lib/slack/install";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";

/** "Add to Slack": sends the person to Slack's install screen, with a one-time state to check on the way back. */
export async function GET(req: Request) {
  const base = publicBaseUrl(req);
  if (!installReady()) return Response.redirect(`${base}/slack?error=not-set-up`, 302);
  const state = randomBytes(16).toString("hex");
  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(process.env.SLACK_CLIENT_ID!, base, state),
      "set-cookie": `${STATE_COOKIE}=${state}; Path=/api/slack; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

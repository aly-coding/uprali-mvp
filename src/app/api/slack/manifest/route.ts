import { slackManifest } from "@/lib/slack/install";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";

/** The Slack app manifest for this deploy, ready to paste into api.slack.com/apps. */
export async function GET(req: Request) {
  return Response.json(slackManifest(publicBaseUrl(req)));
}

import { after } from "next/server";
import { handleInteraction } from "@/lib/slack/app";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Buttons and "needs a human" boxes on Uprali's Slack messages. */
export async function POST(req: Request) {
  return handleInteraction(req, { defer: (task) => after(task), base: publicBaseUrl(req) });
}

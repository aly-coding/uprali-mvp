import { after } from "next/server";
import { handleCommand } from "@/lib/slack/app";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Slack's /uprali slash command. */
export async function POST(req: Request) {
  return handleCommand(req, { defer: (task) => after(task), base: publicBaseUrl(req) });
}

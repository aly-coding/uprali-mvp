import { after } from "next/server";
import { handleEvent } from "@/lib/slack/app";
import { publicBaseUrl } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Slack's Events API: @uprali-mvp mentions and direct messages. */
export async function POST(req: Request) {
  return handleEvent(req, { defer: (task) => after(task), base: publicBaseUrl(req) });
}

import { ADVISOR_QUESTIONS, advise } from "@/lib/engine/advisor";
import { allow, clientKey } from "@/lib/ratelimit";
import { adviseBody, zodMessage } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The questions the advisor asks before it suggests anything. */
export async function GET() {
  return Response.json({ questions: ADVISOR_QUESTIONS });
}

/** Suggests existing tools to compare. Every part of the answer is a suggestion to verify, never a fact. */
export async function POST(req: Request) {
  if (!allow(`advise:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: "Too many requests in a minute. Wait a moment." }, { status: 429 });
  const parsed = adviseBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: zodMessage(parsed.error) }, { status: 400 });
  try {
    return Response.json(await advise(parsed.data.question ?? "", parsed.data.answers ?? {}));
  } catch {
    return Response.json({ error: "The advisor couldn't run. Try again." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getProvider } from "@/lib/llm";
import { ProviderError } from "@/lib/llm/types";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import { allow, clientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One analyst turn. Stateless: the browser sends the conversation, the model answers, and the
 * server keeps nothing afterwards (no database, no cache, no request logging).
 */

const Body = z.object({
  templateId: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]),
  provider: z.enum(["anthropic", "nearai", "demo"]).optional(),
  pendingKey: z.string().max(64).nullable().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .min(1)
    .max(60),
  assumptions: z.record(
    z.string().max(64),
    z.object({
      key: z.string().max(64),
      value: z.union([z.number(), z.string().max(200)]),
      source: z.string().max(300),
      confidence: z.enum(["high", "medium", "low"]),
      owner: z.string().max(100).optional(),
      filledBy: z.union([
        z.object({ kind: z.literal("user") }),
        z.object({ kind: z.literal("model"), provider: z.enum(["anthropic", "nearai", "demo"]), model: z.string().max(100) }),
      ]),
      updatedAt: z.string().max(40),
    }),
  ),
});

/**
 * One analyst turn. The server keeps nothing: the conversation lives in the user's browser
 * and is only passed through to the model they picked.
 */
export async function POST(req: Request) {
  if (!allow(`analyst:${clientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many messages. Wait a minute and try again." }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const provider = getProvider(b.provider);
  try {
    const out = await provider.turn({
      template: getTemplate(b.templateId),
      assumptions: b.assumptions,
      messages: b.messages,
      pendingKey: b.pendingKey ?? null,
    });
    return NextResponse.json(out);
  } catch (err) {
    // Log only the error type, never the request, so no conversation text lands in server logs.
    console.error("analyst error:", err instanceof Error ? err.name : "unknown");
    const msg = err instanceof ProviderError ? err.userMessage : "Something went wrong. Try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

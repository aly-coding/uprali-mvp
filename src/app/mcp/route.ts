import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { TEMPLATE } from "@/lib/engine/buildVsBuy";
import { allow, clientKey } from "@/lib/ratelimit";
import { cleanInputs, fieldShape } from "@/lib/schema";
import { publicBaseUrl, runDecision, verifyDecision } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function makeHandler(base: string) {
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "build_vs_buy",
        {
          title: TEMPLATE.title,
          description:
            "Decide whether to build a software tool in-house or keep paying for one. Works out the full multi-year cost of building " +
            "(a prototype is only about 20% of the work, then upkeep, security, integrations, on-call, knowledge lost when the builder " +
            "leaves, and the engineers' time taken off the core product) against the cost of buying. Pass what you know as fields, each " +
            "optionally with its source and owner; anything missing is filled from a labelled benchmark or marked 'needs a human'. " +
            "Returns a decision memo where every number carries its source, its owner and whether it's an assumption, plus a SHA-256 " +
            "fingerprint. Set record=true to write the fingerprint to NEAR testnet.",
          inputSchema: z.object({
            question: z.string().max(4000).optional().describe("The decision in plain words, e.g. 'Should we build our own CRM or keep paying $720 a year for HubSpot?'"),
            title: z.string().max(120).optional(),
            record: z.boolean().optional().describe("Record the decision's fingerprint on NEAR testnet"),
            approved_by: z.array(z.string().max(120)).max(10).optional().describe("People who approved the decision"),
            ...fieldShape,
          }),
        },
        async (args) => {
          const { question, title, record, approved_by, ...fields } = args as Record<string, unknown> & {
            question?: string;
            title?: string;
            record?: boolean;
            approved_by?: string[];
          };
          const r = await runDecision(
            { question, title, record, approvedBy: approved_by, inputs: cleanInputs(fields), decidedBy: "mcp-agent" },
            base,
          );
          const tail = r.recordError ? `\n\n${r.recordError}` : "";
          return {
            ...text(r.markdown + tail),
            structuredContent: { decisionId: r.memo.decisionId, status: r.memo.status, recommendation: r.memo.recommendation, fingerprint: r.fingerprint, verifyUrl: r.verifyUrl, recorded: r.recorded, gaps: r.memo.gaps, snapshot: r.snapshot },
          };
        },
      );
      server.registerTool(
        "verify_decision",
        {
          title: "Verify a recorded decision",
          description: "Check a decision snapshot, or just its fingerprint, against the ledger: was it recorded, by whom and when, and has it changed since.",
          inputSchema: z.object({
            fingerprint: z.string().max(64).optional().describe("64-character SHA-256 fingerprint"),
            snapshot: z.record(z.string(), z.unknown()).optional().describe("The decision snapshot returned by build_vs_buy"),
          }),
        },
        async ({ fingerprint, snapshot }) => {
          try {
            const v = await verifyDecision({ fingerprint, snapshot });
            return { ...text(v.message), structuredContent: { ...v } };
          } catch (err) {
            return { ...text(err instanceof Error && "userMessage" in err ? String((err as { userMessage: string }).userMessage) : "Couldn't check that."), isError: true };
          }
        },
      );
    },
    { serverInfo: { name: "uprali", version: TEMPLATE.version } },
  );
}

let cached: { base: string; handler: (req: Request) => Promise<Response> } | null = null;

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return unauthorized();
  if (!allow(`mcp:${clientKey(req)}`, 60, 60_000)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  const base = publicBaseUrl(req);
  if (!cached || cached.base !== base) cached = { base, handler: makeHandler(base) };
  return cached.handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };

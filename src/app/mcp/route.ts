import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { TEMPLATE } from "@/lib/engine/buildVsBuy";
import { allow, clientKey } from "@/lib/ratelimit";
import { cleanInputs, fieldShape } from "@/lib/schema";
import { getHistory } from "@/lib/history";
import { listFor, publicEntry } from "@/lib/historyApi";
import { apiOwner } from "@/lib/identity";
import { publicBaseUrl, runAndSave, verifyDecision } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The API key's history owner for the request being handled, so tools stay scoped to the caller. */
const caller = new AsyncLocalStorage<{ owner: string | null }>();
const NO_HISTORY = "History for agents is kept per API key. Set UPRALI_API_KEYS on the server, and send the key, to turn it on.";

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
            parent_id: z.string().max(64).optional().describe("Re-run an earlier decision from list_decisions with changed numbers; it becomes that decision's next version"),
            ...fieldShape,
          }),
        },
        async (args) => {
          const { question, title, record, approved_by, parent_id, ...fields } = args as Record<string, unknown> & {
            question?: string;
            title?: string;
            record?: boolean;
            approved_by?: string[];
            parent_id?: string;
          };
          const r = await runAndSave(
            { question, title, record, approvedBy: approved_by, inputs: cleanInputs(fields), decidedBy: "mcp-agent" },
            base,
            { owner: caller.getStore()?.owner ?? null, source: "mcp", parentId: parent_id },
          );
          const tail = r.recordError ? `\n\n${r.recordError}` : "";
          return {
            ...text(r.markdown + tail),
            structuredContent: { runId: r.runId, decisionId: r.memo.decisionId, version: r.snapshot.version, status: r.memo.status, recommendation: r.memo.recommendation, fingerprint: r.fingerprint, verifyUrl: r.verifyUrl, recorded: r.recorded, gaps: r.memo.gaps, snapshot: r.snapshot },
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
      server.registerTool(
        "list_decisions",
        {
          title: "List past decisions",
          description:
            "List the build vs buy decisions made earlier with this API key, newest first: date, question, recommendation, version and whether " +
            "its fingerprint is recorded. Pass id to get one decision's full memo and the numbers it was given; pass decision_id to list its versions.",
          inputSchema: z.object({
            id: z.string().max(64).optional().describe("A run id from an earlier list, to get that decision in full"),
            decision_id: z.string().max(64).optional().describe("List every version of one decision"),
            limit: z.number().int().min(1).max(100).optional(),
          }),
        },
        async ({ id, decision_id, limit }) => {
          const owner = caller.getStore()?.owner ?? null;
          if (!owner) return { ...text(NO_HISTORY), isError: true };
          try {
            if (id) {
              const e = await (await getHistory()).get(owner, id);
              if (!e) return { ...text("No decision with that id for this API key."), isError: true };
              return { ...text(`${e.title} (v${e.version}, ${e.createdAt.slice(0, 10)}): ${e.headline}\nVerify: ${e.verifyUrl}`), structuredContent: { decision: publicEntry(e) } };
            }
            const u = new URL("http://x/");
            if (limit) u.searchParams.set("limit", String(limit));
            if (decision_id) u.searchParams.set("decision_id", decision_id);
            const out = await listFor(owner, u);
            const lines = out.decisions.map(
              (d) => `- ${d.createdAt.slice(0, 10)} ${d.id} v${d.version}: ${d.question.slice(0, 80) || d.title}. ${d.headline}${d.recorded ? " (recorded)" : ""}`,
            );
            return { ...text(lines.length ? lines.join("\n") : "No decisions yet for this API key."), structuredContent: { ...out } };
          } catch {
            return { ...text("Couldn't read the history."), isError: true };
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
  return caller.run({ owner: apiOwner(req) }, () => cached!.handler(req));
}

export { handle as GET, handle as POST, handle as DELETE };

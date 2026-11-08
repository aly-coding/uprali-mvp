/**
 * The Uprali Slack app: the /uprali command and its buttons. Every request is checked against
 * Slack's signing secret. Slack wants an answer within 3 seconds, so each handler answers at once
 * and does the decision afterwards, posting the result to the request's response_url. That URL
 * needs no token, so nothing about an installed workspace is stored.
 */
import { newDecisionId } from "@/lib/engine/decide";
import { FIELDS, parseAmount } from "@/lib/engine/buildVsBuy";
import type { GivenValue } from "@/lib/engine/types";
import { getHistory } from "@/lib/history";
import { slackOwner } from "@/lib/identity";
import { getLedger } from "@/lib/ledger";
import { allow } from "@/lib/ratelimit";
import { runAndSave } from "@/lib/service";
import { helpMessage, MAX_QUESTION, memoToSlack, stateFromMessage, type SlackState } from "./blocks";
import { isSlackResponseUrl, verifySlackSignature } from "./verify";

type Env = Record<string, string | undefined>;
export type Defer = (task: () => Promise<void>) => void;

export interface SlackDeps {
  env?: Env;
  /** Runs work after the response is sent (Next's after() in production). */
  defer: Defer;
  fetch?: typeof fetch;
  base: string;
}

export function slackEnabled(env: Env = process.env): boolean {
  return Boolean(env.SLACK_SIGNING_SECRET);
}

async function readSigned(req: Request, env: Env): Promise<URLSearchParams | Response> {
  if (!slackEnabled(env)) return new Response("The Uprali Slack app isn't set up on this deploy.", { status: 404 });
  const body = await req.text();
  const ok = verifySlackSignature({
    secret: env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    body,
  });
  if (!ok) return new Response("Invalid Slack signature.", { status: 401 });
  return new URLSearchParams(body);
}

const ephemeral = (text: string) => Response.json({ response_type: "ephemeral", text });

async function post(deps: SlackDeps, url: string, payload: unknown) {
  const f = deps.fetch ?? fetch;
  try {
    const res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) console.error("slack response_url post failed:", res.status);
  } catch {
    console.error("slack response_url post failed");
  }
}

/** Turns what people typed in Slack into engine inputs, each owned by the person who typed it. */
function inputsFrom(state: SlackState): Record<string, GivenValue> {
  const out: Record<string, GivenValue> = {};
  for (const [k, { v, by }] of Object.entries(state.i)) {
    out[k] = { value: v, owner: "human", is_assumption: false, source: `Entered by ${by} in Slack` };
  }
  return out;
}

/** One history run per Slack decision, updated as people fill it in, approve it and record it. */
export function slackRunId(team: string, decisionId: string): string {
  return `slack_${team.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}_${decisionId}`.slice(0, 64);
}

async function render(state: SlackState, deps: SlackDeps, record: boolean, team: string) {
  const env = deps.env ?? process.env;
  const result = await runAndSave(
    {
      question: state.q,
      inputs: inputsFrom(state),
      decisionId: state.d,
      decidedBy: `${state.by.name} (Slack)`,
      approvedBy: state.ap.map((p) => `${p.name} (Slack)`),
      record,
    },
    deps.base,
    { owner: slackOwner(team, state.by.id || "unknown"), source: "slack", runId: slackRunId(team, state.d) },
    env,
  );
  const ledger = await getLedger(env);
  // Recording on the server's demo ledger from Slack is fine; on NEAR it needs the relayer key.
  const canRecord = ledger.network === "local-demo" || Boolean(env.NEAR_PRIVATE_KEY);
  return memoToSlack(result.memo, state, {
    verifyUrl: result.verifyUrl,
    fingerprint: result.fingerprint,
    recorded: result.recorded,
    recordError: result.recordError,
    canRecord,
  });
}

/** POST /api/slack/commands */
export async function handleCommand(req: Request, deps: SlackDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const form = await readSigned(req, env);
  if (form instanceof Response) return form;
  const text = (form.get("text") || "").trim();
  const responseUrl = form.get("response_url");
  const team = form.get("team_id") || "unknown";
  if (!text || /^help$/i.test(text)) return Response.json(helpMessage());
  if (/^history$/i.test(text)) return ephemeral(await historyText(team, form.get("user_id") || "unknown", env));
  if (text.length > MAX_QUESTION) return ephemeral(`Keep the question under ${MAX_QUESTION.toLocaleString("en-US")} characters.`);
  if (!isSlackResponseUrl(responseUrl)) return ephemeral("Slack didn't send a reply address, so Uprali can't answer here.");
  if (!allow(`slack:${team}`, 20, 60_000)) return ephemeral("Uprali is answering a lot of questions in this workspace. Try again in a minute.");

  const state: SlackState = {
    v: 1,
    d: newDecisionId(),
    q: text,
    by: { id: form.get("user_id") || "", name: form.get("user_name") || "someone" },
    i: {},
    ap: [],
  };
  deps.defer(async () => {
    try {
      await post(deps, responseUrl, await render(state, deps, false, team));
    } catch {
      await post(deps, responseUrl, { response_type: "ephemeral", text: "Uprali couldn't work that out. Try again in a moment." });
    }
  });
  return ephemeral("Working out the numbers…");
}

/** /uprali history: the person's last decisions, only to them. */
export async function historyText(team: string, user: string, env: Env = process.env): Promise<string> {
  try {
    const items = await (await getHistory(env)).list(slackOwner(team, user), { limit: 10 });
    if (!items.length) return "You haven't run any decisions with /uprali yet.";
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = items.map((d) => `• ${d.createdAt.slice(0, 10)}: ${esc(d.question.slice(0, 90) || d.title)}. *${esc(d.headline)}*${d.recorded ? " Recorded on NEAR." : ""} <${d.verifyUrl}|Verify>`);
    return `Your last ${items.length} decisions:\n${lines.join("\n")}`;
  } catch {
    return "Uprali couldn't read your history just now. Try again in a moment.";
  }
}

interface BlockActionsPayload {
  type: string;
  user?: { id?: string; username?: string; name?: string };
  team?: { id?: string };
  response_url?: string;
  message?: unknown;
  actions?: Array<{ action_id?: string; block_id?: string; value?: string }>;
}

/** POST /api/slack/interactions: Enter in a "needs a human" box, Approve, or Record on NEAR. */
export async function handleInteraction(req: Request, deps: SlackDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const form = await readSigned(req, env);
  if (form instanceof Response) return form;
  let payload: BlockActionsPayload;
  try {
    payload = JSON.parse(form.get("payload") || "");
  } catch {
    return new Response("Bad payload.", { status: 400 });
  }
  if (payload.type !== "block_actions" || !payload.actions?.length) return new Response(null, { status: 200 });
  const responseUrl = payload.response_url;
  if (!isSlackResponseUrl(responseUrl)) return new Response(null, { status: 200 });
  if (!allow(`slack:${payload.team?.id ?? "unknown"}`, 20, 60_000)) return new Response(null, { status: 200 });

  const state = stateFromMessage(payload.message);
  if (!state) return new Response(null, { status: 200 });
  const action = payload.actions[0];
  const who = { id: payload.user?.id || "", name: payload.user?.username || payload.user?.name || "someone" };
  let record = false;

  if (action.action_id === "fill" && action.block_id?.startsWith("fill:")) {
    const key = action.block_id.slice(5);
    const field = FIELDS.find((f) => f.key === key);
    const raw = (action.value || "").trim().slice(0, 200);
    if (!field || !raw) return new Response(null, { status: 200 });
    const value = field.unit === "text" ? raw : parseAmount(raw);
    if (value === null) {
      deps.defer(() => post(deps, responseUrl, { response_type: "ephemeral", replace_original: false, text: `"${raw}" isn't a number Uprali can read for ${field.label}.` }));
      return new Response(null, { status: 200 });
    }
    state.i[key] = { v: value, by: who.name };
  } else if (action.action_id === "approve") {
    if (!state.ap.some((p) => p.id === who.id)) state.ap.push(who);
  } else if (action.action_id === "record") {
    record = true;
  } else {
    return new Response(null, { status: 200 });
  }

  deps.defer(async () => {
    try {
      const msg = await render(state, deps, record, payload.team?.id ?? "unknown");
      await post(deps, responseUrl, { ...msg, replace_original: true });
    } catch {
      await post(deps, responseUrl, { response_type: "ephemeral", replace_original: false, text: "Uprali couldn't update the decision. Try again in a moment." });
    }
  });
  return new Response(null, { status: 200 });
}

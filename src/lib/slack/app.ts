/**
 * The Uprali Slack app: the /uprali command, @uprali-mvp mentions and direct messages, and the
 * buttons on its messages. Every request is checked against Slack's signing secret. Slack wants an
 * answer within 3 seconds, so each handler answers at once and does the decision afterwards. The
 * command and buttons reply through the request's response_url; mentions and direct messages reply
 * in a thread with the workspace's bot token.
 */
import { newDecisionId } from "@/lib/engine/decide";
import { parseAmount } from "@/lib/engine/buildVsBuy";
import { isCaseTemplate, type TemplateId } from "@/lib/engine/cases";
import type { GivenValue } from "@/lib/engine/types";
import { getHistory } from "@/lib/history";
import { slackOwner } from "@/lib/identity";
import { getLedger } from "@/lib/ledger";
import { allow } from "@/lib/ratelimit";
import { runAndSave, runCaseAndSave } from "@/lib/service";
import { caseToSlack, decodeState, fieldsOf, helpMessage, MAX_QUESTION, memoToSlack, stateFromMessage, templateQuestion, type SlackMessage, type SlackState } from "./blocks";
import { detectTemplate } from "./templates";
import { botToken } from "./tokens";
import { isSlackResponseUrl, verifySlackSignature } from "./verify";
import { slackApi } from "./web";

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

export async function render(state: SlackState, deps: SlackDeps, record: boolean, team: string): Promise<SlackMessage> {
  const env = deps.env ?? process.env;
  const common = {
    question: state.q,
    inputs: inputsFrom(state),
    decisionId: state.d,
    decidedBy: `${state.by.name} (Slack)`,
    approvedBy: state.ap.map((p) => `${p.name} (Slack)`),
    record,
  };
  const target = { owner: slackOwner(team, state.by.id || "unknown"), source: "slack" as const, runId: slackRunId(team, state.d) };
  const ledger = await getLedger(env);
  // Recording on the server's demo ledger from Slack is fine; on NEAR it needs the relayer key.
  const canRecord = ledger.network === "local-demo" || Boolean(env.NEAR_PRIVATE_KEY);
  if (isCaseTemplate(state.t)) {
    const result = await runCaseAndSave({ ...common, template: state.t }, deps.base, target, env);
    return caseToSlack(result.memo, state, { verifyUrl: result.verifyUrl, fingerprint: result.fingerprint, recorded: result.recorded, recordError: result.recordError, canRecord });
  }
  const result = await runAndSave(common, deps.base, target, env);
  return memoToSlack(result.memo, state, { verifyUrl: result.verifyUrl, fingerprint: result.fingerprint, recorded: result.recorded, recordError: result.recordError, canRecord });
}

/** A new decision from what someone wrote: the template if it's clear, else Uprali asks which. */
export function newState(text: string, by: { id: string; name: string }): SlackState {
  const { template, question } = detectTemplate(text);
  return { v: 1, d: newDecisionId(), ...(template ? { t: template } : {}), q: question, by, i: {}, ap: [] };
}

/** The first reply to a new decision: the template question, or the worked-out decision. */
async function firstReply(state: SlackState, deps: SlackDeps, team: string): Promise<SlackMessage> {
  return state.t ? render(state, deps, false, team) : templateQuestion(state);
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

  const state = newState(text, { id: form.get("user_id") || "", name: form.get("user_name") || "someone" });
  deps.defer(async () => {
    try {
      await post(deps, responseUrl, await firstReply(state, deps, team));
    } catch {
      await post(deps, responseUrl, { response_type: "ephemeral", text: "Uprali couldn't work that out. Try again in a moment." });
    }
  });
  return ephemeral(state.t ? "Working out the numbers…" : "Which kind of decision is it? Pick one in the channel.");
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
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string; thread_ts?: string };
  response_url?: string;
  message?: { ts?: string; thread_ts?: string; blocks?: unknown };
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

  const action = payload.actions[0];
  // A template button carries its own state; every other action reads it off the message.
  const picked = action.action_id?.startsWith("pick:") ? decodeState(action.value) : null;
  const state = picked ?? stateFromMessage(payload.message);
  if (!state) return new Response(null, { status: 200 });
  if (picked && picked.t !== (action.action_id!.slice(5) as TemplateId)) return new Response(null, { status: 200 });
  const who = { id: payload.user?.id || "", name: payload.user?.username || payload.user?.name || "someone" };
  let record = false;

  if (picked) {
    // Nothing more to change: the button chose the template.
  } else if (action.action_id === "fill" && action.block_id?.startsWith("fill:")) {
    const key = action.block_id.slice(5);
    const field = fieldsOf(state.t).find((f) => f.key === key);
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

  const team = payload.team?.id ?? "unknown";
  deps.defer(async () => {
    try {
      const msg = await render(state, deps, record, team);
      // A message the bot posted is updated with chat.update, which has no 5-use limit; otherwise through response_url.
      const channel = payload.container?.channel_id || payload.channel?.id;
      const ts = payload.container?.message_ts || payload.message?.ts;
      const token = channel && ts ? await botToken(team, env) : null;
      if (token && channel && ts) {
        const r = await slackApi("chat.update", token, { channel, ts, text: msg.text, blocks: msg.blocks }, deps.fetch);
        if (r.ok) return;
      }
      await post(deps, responseUrl, { ...msg, replace_original: true });
    } catch {
      await post(deps, responseUrl, { response_type: "ephemeral", replace_original: false, text: "Uprali couldn't update the decision. Try again in a moment." });
    }
  });
  return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------- @uprali-mvp mentions and direct messages

interface SlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

const seen = new Map<string, number>();
function firstTime(id: string | undefined): boolean {
  if (!id) return true;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

/** Takes the @mention off, and Slack's link and mailto wrapping off plain text. */
export function cleanMentionText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, " ")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** POST /api/slack/events: Slack's Events API, for app_mention and message.im. */
export async function handleEvent(req: Request, deps: SlackDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!slackEnabled(env)) return new Response("The Uprali Slack app isn't set up on this deploy.", { status: 404 });
  const body = await req.text();
  const ok = verifySlackSignature({
    secret: env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    body,
  });
  if (!ok) return new Response("Invalid Slack signature.", { status: 401 });
  let payload: { type?: string; challenge?: string; team_id?: string; event_id?: string; event?: SlackEvent };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad payload.", { status: 400 });
  }
  if (payload.type === "url_verification") return Response.json({ challenge: String(payload.challenge ?? "") });
  // Slack retries when an answer is slow; the first delivery is already being handled.
  if (req.headers.get("x-slack-retry-num")) return new Response(null, { status: 200 });
  if (payload.type !== "event_callback" || !payload.event) return new Response(null, { status: 200 });

  const ev = payload.event;
  const isMention = ev.type === "app_mention";
  const isDm = ev.type === "message" && ev.channel_type === "im";
  if ((!isMention && !isDm) || ev.bot_id || ev.subtype || !ev.user || !ev.channel || !ev.ts) return new Response(null, { status: 200 });
  if (!firstTime(payload.event_id)) return new Response(null, { status: 200 });
  const team = payload.team_id || "unknown";
  const channel = ev.channel;
  const user = ev.user;
  // In a channel, Uprali answers in a thread under the message; in a direct message, in the conversation.
  const thread = isMention ? ev.thread_ts || ev.ts : ev.thread_ts;
  const text = cleanMentionText(ev.text || "");

  deps.defer(async () => {
    const token = await botToken(team, env);
    if (!token) {
      console.error("slack event: no bot token for this workspace; set SLACK_BOT_TOKEN or reinstall with Add to Slack");
      return;
    }
    const say = (msg: { text: string; blocks?: unknown[] }) => slackApi("chat.postMessage", token, { channel, ...(thread ? { thread_ts: thread } : {}), text: msg.text, ...(msg.blocks ? { blocks: msg.blocks } : {}), unfurl_links: false }, deps.fetch);
    if (!text || /^help\??$/i.test(text)) return void (await say({ text: helpMessage().text }));
    if (/^history$/i.test(text)) {
      const hist = await historyText(team, user, env);
      if (isDm) await say({ text: hist });
      else await slackApi("chat.postEphemeral", token, { channel, user, text: hist, ...(thread ? { thread_ts: thread } : {}) }, deps.fetch);
      return;
    }
    if (text.length > MAX_QUESTION) return void (await say({ text: `Keep the question under ${MAX_QUESTION.toLocaleString("en-US")} characters.` }));
    if (!allow(`slack:${team}`, 20, 60_000)) return void (await say({ text: "Uprali is answering a lot of questions in this workspace. Try again in a minute." }));

    const state = newState(text, { id: user, name: user });
    if (!state.t) return void (await say(templateQuestion(state)));
    const working = await say({ text: "Working out the numbers…" });
    try {
      const msg = await render(state, deps, false, team);
      if (working.ok && working.ts) {
        const r = await slackApi("chat.update", token, { channel: working.channel || channel, ts: working.ts, text: msg.text, blocks: msg.blocks }, deps.fetch);
        if (r.ok) return;
      }
      await say(msg);
    } catch {
      await say({ text: "Uprali couldn't work that out. Try again in a moment." });
    }
  });
  return new Response(null, { status: 200 });
}

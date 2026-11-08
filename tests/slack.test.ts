import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { cleanMentionText, handleCommand, handleEvent, handleInteraction, type SlackDeps } from "@/lib/slack/app";
import { decodeState, esc } from "@/lib/slack/blocks";
import { authorizeUrl, exchangeCode, slackManifest } from "@/lib/slack/install";
import { CASE_TEMPLATES, CASE_TEMPLATE_IDS } from "@/lib/engine/cases";
import { detectTemplate } from "@/lib/slack/templates";
import { botToken, openToken, sealToken } from "@/lib/slack/tokens";
import { isSlackResponseUrl, signForTest, verifySlackSignature } from "@/lib/slack/verify";

const SECRET = "test-signing-secret";
const RESPONSE_URL = "https://hooks.slack.com/commands/T1/1/abc";

beforeAll(() => {
  process.env.LLM_PROVIDER = "demo";
  process.env.LOCAL_LEDGER_PATH = path.join(os.tmpdir(), `uprali-slack-${Date.now()}.json`);
  delete process.env.NEAR_CONTRACT_ID;
  delete process.env.NEARAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

function signed(url: string, body: string, secret = SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": signForTest(secret, ts, body) },
    body,
  });
}

/** Collects deferred work and what it posts to Slack. */
function harness() {
  const tasks: Promise<void>[] = [];
  const posts: Array<{ url: string; body: any }> = [];
  const deps: SlackDeps = {
    env: { ...process.env, SLACK_SIGNING_SECRET: SECRET },
    base: "https://uprali.example",
    defer: (t) => void tasks.push(t()),
    fetch: (async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("ok");
    }) as unknown as typeof fetch,
  };
  return { deps, posts, settle: () => Promise.all(tasks) };
}

const QUESTION = "Should we build our own CRM or keep paying $720 a year for HubSpot Starter? Our engineer built a working prototype in 3 weeks.";

describe("Slack signatures", () => {
  it("accepts Slack's signature and refuses forged or old requests", () => {
    const ts = "1700000000";
    const sig = signForTest(SECRET, ts, "a=1");
    expect(verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, body: "a=1", nowSeconds: 1700000010 })).toBe(true);
    expect(verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, body: "a=2", nowSeconds: 1700000010 })).toBe(false);
    expect(verifySlackSignature({ secret: "other", timestamp: ts, signature: sig, body: "a=1", nowSeconds: 1700000010 })).toBe(false);
    expect(verifySlackSignature({ secret: SECRET, timestamp: ts, signature: sig, body: "a=1", nowSeconds: 1700000000 + 301 })).toBe(false);
    expect(isSlackResponseUrl(RESPONSE_URL)).toBe(true);
    expect(isSlackResponseUrl("https://evil.example/hooks.slack.com")).toBe(false);
  });

  it("is off with no signing secret, and refuses unsigned requests when on", async () => {
    const off = harness();
    off.deps.env = { ...off.deps.env, SLACK_SIGNING_SECRET: undefined };
    expect((await handleCommand(signed("/api/slack/commands", "text=hi"), off.deps)).status).toBe(404);
    const on = harness();
    expect((await handleCommand(signed("/api/slack/commands", "text=hi", "wrong"), on.deps)).status).toBe(401);
  });
});

describe("/uprali", () => {
  it("answers at once, then posts the memo with gaps and buttons, and the buttons work", async () => {
    const h = harness();
    const body = new URLSearchParams({ text: QUESTION, response_url: RESPONSE_URL, user_id: "U1", user_name: "aly", team_id: "T1" }).toString();
    const ack = await handleCommand(signed("/api/slack/commands", body), h.deps);
    expect(ack.status).toBe(200);
    expect((await ack.json()).response_type).toBe("ephemeral");
    await h.settle();

    const first = h.posts[0];
    expect(first.url).toBe(RESPONSE_URL);
    expect(first.body.response_type).toBe("in_channel");
    const blocks = first.body.blocks as any[];
    expect(blocks[0].type).toBe("header");
    expect(blocks[0].text.text).toContain("HubSpot");
    const inputs = blocks.filter((b) => b.type === "input");
    expect(inputs.length).toBeGreaterThan(0);
    // Return on investment waits on confirmed savings, and Slack offers a box for it.
    expect(JSON.stringify(blocks)).toContain("ROI needs confirmed savings");
    expect(inputs.map((b) => b.block_id)).toContain("fill:confirmed_annual_savings");
    const actions = blocks.find((b) => b.type === "actions");
    const state = decodeState(actions.elements[0].value)!;
    expect(state.q).toBe(QUESTION);

    // Someone fills in a number a human should give.
    const key = inputs[0].block_id.slice(5);
    const fill = {
      type: "block_actions",
      user: { id: "U2", username: "ruslana" },
      team: { id: "T1" },
      response_url: RESPONSE_URL,
      message: { blocks },
      actions: [{ action_id: "fill", block_id: `fill:${key}`, value: "3800" }],
    };
    expect((await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(fill) }).toString()), h.deps)).status).toBe(200);
    await h.settle();
    const second = h.posts[1].body;
    expect(second.replace_original).toBe(true);
    const state2 = decodeState(second.blocks.find((b: any) => b.type === "actions").elements[0].value)!;
    expect(state2.i[key]).toEqual({ v: 3800, by: "ruslana" });
    expect(state2.d).toBe(state.d);

    // Approve, then record.
    const approve = { ...fill, message: { blocks: second.blocks }, actions: [{ action_id: "approve" }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(approve) }).toString()), h.deps);
    await h.settle();
    const third = h.posts[2].body;
    expect(JSON.stringify(third.blocks)).toContain("Approved by <@U2>");
    const recordBtn = third.blocks.find((b: any) => b.type === "actions").elements.find((e: any) => e.action_id === "record");
    expect(recordBtn).toBeTruthy();

    const rec = { ...fill, message: { blocks: third.blocks }, actions: [{ action_id: "record" }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(rec) }).toString()), h.deps);
    await h.settle();
    const fourth = JSON.stringify(h.posts[3].body.blocks);
    expect(fourth).toContain("Recorded on the demo ledger");
    expect(fourth).toContain("When to stop");
    expect(fourth).toContain("https://uprali.example/verify?hash=");
  });

  it("explains itself on help and ignores a tampered message", async () => {
    const h = harness();
    const help = await handleCommand(signed("/api/slack/commands", "text=help"), h.deps);
    expect((await help.json()).text).toContain("/uprali");
    const bad = { type: "block_actions", response_url: RESPONSE_URL, message: { blocks: [{ type: "actions", elements: [{ action_id: "approve", value: '{"v":1,"d":"x","q":"q","by":{},"i":{"not_a_field":1},"ap":[]}' }] }] }, actions: [{ action_id: "approve" }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(bad) }).toString()), h.deps);
    await h.settle();
    expect(h.posts).toHaveLength(0);
    expect(esc("<script>&")).toBe("&lt;script&gt;&amp;");
  });
});

describe("Add to Slack", () => {
  it("builds the install link and manifest for this deploy", () => {
    const u = new URL(authorizeUrl("123.456", "https://uprali.example", "st"));
    expect(u.hostname).toBe("slack.com");
    expect(u.searchParams.get("scope")).toBe("commands,app_mentions:read,chat:write,im:history");
    expect(u.searchParams.get("redirect_uri")).toBe("https://uprali.example/api/slack/oauth");
    const m = slackManifest("https://uprali.example");
    expect(m.features.slash_commands[0].url).toBe("https://uprali.example/api/slack/commands");
    expect(m.settings.interactivity.request_url).toBe("https://uprali.example/api/slack/interactions");
    expect(m.settings.event_subscriptions).toEqual({ request_url: "https://uprali.example/api/slack/events", bot_events: ["app_mention", "message.im"] });
    expect(m.oauth_config.scopes.bot).toEqual(["commands", "app_mentions:read", "chat:write", "im:history"]);
    expect(m.features.bot_user.display_name).toBe("uprali-mvp");
    expect(m.features.app_home.messages_tab_enabled).toBe(true);
  });

  it("finishes the install and keeps the bot token encrypted for that workspace", async () => {
    let sent = "";
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return Response.json({ ok: true, team: { id: "TINSTALL", name: "Uprali Test" }, access_token: "xoxb-fake-install-token" });
    }) as unknown as typeof fetch;
    const env = { SLACK_CLIENT_ID: "id", SLACK_CLIENT_SECRET: "sec" };
    expect(await exchangeCode("c1", "https://uprali.example", env, f)).toBe("Uprali Test");
    expect(sent).toContain("code=c1");
    expect(await botToken("TINSTALL", env)).toBe("xoxb-fake-install-token");
    expect(await botToken("TOTHER", env)).toBeNull();
    expect(await botToken("TOTHER", { ...env, SLACK_BOT_TOKEN: "xoxb-env" })).toBe("xoxb-env");
    const sealed = sealToken("xoxb-secret", env)!;
    expect(sealed).not.toContain("xoxb");
    expect(openToken(sealed, env)).toBe("xoxb-secret");
    expect(openToken(sealed, { SLACK_CLIENT_SECRET: "another" })).toBeNull();
    const refused = (async () => Response.json({ ok: false })) as unknown as typeof fetch;
    expect(await exchangeCode("c1", "https://uprali.example", {}, refused)).toBeNull();
  });
});

describe("slack/manifest.json", () => {
  it("matches what the site serves", async () => {
    const fs = await import("node:fs");
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, "../slack/manifest.json"), "utf8"));
    expect(file).toEqual(slackManifest("https://YOUR-APP.vercel.app"));
  });
});

describe("templates in Slack", () => {
  it("picks the template from the question, or from a prefix", () => {
    expect(detectTemplate(QUESTION).template).toBe("build_vs_buy");
    for (const id of CASE_TEMPLATE_IDS) expect(detectTemplate(CASE_TEMPLATES[id].prompt).template).toBe(id);
    expect(detectTemplate("Should we build our own AI assistant or buy one?").template).toBe("build_vs_buy");
    expect(detectTemplate("product: a booking app for 1,000 salons")).toEqual({ template: "new_product", question: "a booking app for 1,000 salons" });
    expect(detectTemplate("gtm: Germany next year").template).toBe("gtm_expansion");
    expect(detectTemplate("What should we do next quarter?").template).toBeNull();
    expect(cleanMentionText("<@U0BOT> should we <https://x.example|check> this &amp; that?")).toBe("should we check this & that?");
  });

  it("runs a business case from /uprali with the 3-year result, suggestion tags and buttons", async () => {
    const h = harness();
    const body = new URLSearchParams({ text: CASE_TEMPLATES.new_product.prompt, response_url: RESPONSE_URL, user_id: "U1", user_name: "aly", team_id: "T1" }).toString();
    await handleCommand(signed("/api/slack/commands", body), h.deps);
    await h.settle();
    const msg = h.posts[0].body;
    const text = JSON.stringify(msg.blocks);
    expect(msg.blocks[0].text.text).toBe(CASE_TEMPLATES.new_product.goLabel);
    expect(text).toContain("3-year net cash");
    expect(text).toContain("Year 3: benefit");
    expect(text).toContain("Suggestion, verify");
    expect(text).toContain("Scenarios, NPV");
    const actions = msg.blocks.find((b: any) => b.type === "actions");
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["approve", "record"]);
    const state = decodeState(actions.elements[0].value)!;
    expect(state.t).toBe("new_product");

    // A person fills a key driver of this template, and the case updates with it as theirs.
    const input = msg.blocks.find((b: any) => b.type === "input");
    expect(input).toBeTruthy();
    const key = input.block_id.slice(5);
    const fill = { type: "block_actions", user: { id: "U2", username: "ruslana" }, team: { id: "T1" }, response_url: RESPONSE_URL, message: { blocks: msg.blocks }, actions: [{ action_id: "fill", block_id: `fill:${key}`, value: "30" }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(fill) }).toString()), h.deps);
    await h.settle();
    const state2 = decodeState(h.posts[1].body.blocks.find((b: any) => b.type === "actions").elements[0].value)!;
    expect(state2.i[key]).toEqual({ v: 30, by: "ruslana" });
    expect(state2.t).toBe("new_product");
  });

  it("asks which kind of decision when it isn't clear, then runs the one picked", async () => {
    const h = harness();
    const q = "Is this worth doing? It costs $30,000 up front and could bring in $40,000 a year.";
    const body = new URLSearchParams({ text: q, response_url: RESPONSE_URL, user_id: "U1", user_name: "aly", team_id: "T1" }).toString();
    const ack = await (await handleCommand(signed("/api/slack/commands", body), h.deps)).json();
    expect(ack.text).toContain("Which kind of decision");
    await h.settle();
    const ask = h.posts[0].body;
    const buttons = ask.blocks.find((b: any) => b.type === "actions").elements;
    expect(buttons.map((b: any) => b.action_id)).toEqual(["pick:build_vs_buy", "pick:new_product", "pick:gtm_expansion", "pick:ai_investment"]);
    const product = buttons.find((b: any) => b.action_id === "pick:new_product");
    const press = { type: "block_actions", user: { id: "U1", username: "aly" }, team: { id: "T1" }, response_url: RESPONSE_URL, message: { blocks: ask.blocks }, actions: [{ action_id: "pick:new_product", value: product.value }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(press) }).toString()), h.deps);
    await h.settle();
    expect(h.posts[1].body.replace_original).toBe(true);
    expect(JSON.stringify(h.posts[1].body.blocks)).toContain("Launch a New Product");
    // A button whose value names another template is ignored.
    const forged = { ...press, actions: [{ action_id: "pick:ai_investment", value: product.value }] };
    await handleInteraction(signed("/api/slack/interactions", new URLSearchParams({ payload: JSON.stringify(forged) }).toString()), h.deps);
    await h.settle();
    expect(h.posts).toHaveLength(2);
  });
});

describe("@uprali-mvp mentions and direct messages", () => {
  function eventHarness() {
    const tasks: Promise<void>[] = [];
    const calls: Array<{ url: string; auth: string | null; body: any }> = [];
    let n = 0;
    const deps: SlackDeps = {
      env: { ...process.env, SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_TOKEN: "xoxb-test-token" },
      base: "https://uprali.example",
      defer: (t) => void tasks.push(t()),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
        return Response.json({ ok: true, ts: `1700000000.00${++n}`, channel: "C1" });
      }) as unknown as typeof fetch,
    };
    return { deps, calls, settle: () => Promise.all(tasks) };
  }
  const event = (payload: unknown, headers: Record<string, string> = {}) => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request("http://localhost/api/slack/events", { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": signForTest(SECRET, ts, body), ...headers }, body });
  };

  it("answers Slack's URL check and refuses unsigned events", async () => {
    const h = eventHarness();
    const r = await handleEvent(event({ type: "url_verification", challenge: "abc123" }), h.deps);
    expect(await r.json()).toEqual({ challenge: "abc123" });
    const forged = new Request("http://localhost/api/slack/events", { method: "POST", headers: { "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=bad" }, body: "{}" });
    expect((await handleEvent(forged, h.deps)).status).toBe(401);
  });

  it("answers a mention in a thread: working first, then the decision with buttons, saved to history", async () => {
    const h = eventHarness();
    const r = await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev1", event: { type: "app_mention", user: "U1", text: `<@U0BOT> ${QUESTION}`, channel: "C1", ts: "1699999999.000100" } }), h.deps);
    expect(r.status).toBe(200);
    await h.settle();
    expect(h.calls.map((c) => c.url)).toEqual(["https://slack.com/api/chat.postMessage", "https://slack.com/api/chat.update"]);
    expect(h.calls[0].auth).toBe("Bearer xoxb-test-token");
    expect(h.calls[0].body).toMatchObject({ channel: "C1", thread_ts: "1699999999.000100", text: "Working out the numbers…" });
    const update = h.calls[1].body;
    expect(update.ts).toBe("1700000000.001");
    expect(update.blocks[0].text.text).toContain("HubSpot");
    expect(JSON.stringify(update.blocks)).toContain("Suggestion, verify");
    const { getHistory } = await import("@/lib/history");
    const runs = await (await getHistory(h.deps.env)).list("slack:T9:U1", { limit: 5 });
    expect(runs.length).toBe(1);

    // The same event again (a retry, or a duplicate delivery) does nothing more.
    await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev1", event: { type: "app_mention", user: "U1", text: "again", channel: "C1", ts: "1699999999.000100" } }), h.deps);
    await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev2", event: { type: "app_mention", user: "U1", text: "x", channel: "C1", ts: "1" } }, { "x-slack-retry-num": "1" }), h.deps);
    await h.settle();
    expect(h.calls).toHaveLength(2);

    // Pressing a button on the bot's message updates it in place with chat.update.
    const actions = update.blocks.find((b: any) => b.type === "actions");
    const approve = { type: "block_actions", user: { id: "U2", username: "ruslana" }, team: { id: "T9" }, container: { channel_id: "C1", message_ts: "1700000000.001" }, response_url: RESPONSE_URL, message: { ts: "1700000000.001", blocks: update.blocks }, actions: [{ action_id: "approve", value: actions.elements[0].value }] };
    const sig = new URLSearchParams({ payload: JSON.stringify(approve) }).toString();
    await handleInteraction(signed("/api/slack/interactions", sig), h.deps);
    await h.settle();
    expect(h.calls[2].url).toBe("https://slack.com/api/chat.update");
    expect(JSON.stringify(h.calls[2].body.blocks)).toContain("Approved by <@U2>");
  });

  it("answers a direct message, asks which kind of decision when unclear, and ignores bots", async () => {
    const h = eventHarness();
    await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev3", event: { type: "message", channel_type: "im", user: "U1", text: "What should we do next quarter?", channel: "D1", ts: "5.1" } }), h.deps);
    await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev4", event: { type: "message", channel_type: "im", bot_id: "B1", text: "I am a bot", channel: "D1", ts: "5.2" } }), h.deps);
    await handleEvent(event({ type: "event_callback", team_id: "T9", event_id: "Ev5", event: { type: "message", channel_type: "channel", user: "U1", text: "not for us", channel: "C2", ts: "5.3" } }), h.deps);
    await h.settle();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].body.channel).toBe("D1");
    expect(h.calls[0].body.thread_ts).toBeUndefined();
    expect(JSON.stringify(h.calls[0].body.blocks)).toContain("pick:ai_investment");
  });

  it("does nothing without a bot token", async () => {
    const h = eventHarness();
    h.deps.env = { ...h.deps.env, SLACK_BOT_TOKEN: undefined };
    await handleEvent(event({ type: "event_callback", team_id: "TNONE", event_id: "Ev6", event: { type: "app_mention", user: "U1", text: "<@U0BOT> help", channel: "C1", ts: "6.1" } }), h.deps);
    await h.settle();
    expect(h.calls).toHaveLength(0);
  });
});

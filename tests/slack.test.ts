import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { handleCommand, handleInteraction, type SlackDeps } from "@/lib/slack/app";
import { decodeState, esc } from "@/lib/slack/blocks";
import { authorizeUrl, exchangeCode, slackManifest } from "@/lib/slack/install";
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
    expect(u.searchParams.get("scope")).toBe("commands");
    expect(u.searchParams.get("redirect_uri")).toBe("https://uprali.example/api/slack/oauth");
    const m = slackManifest("https://uprali.example");
    expect(m.features.slash_commands[0].url).toBe("https://uprali.example/api/slack/commands");
    expect(m.settings.interactivity.request_url).toBe("https://uprali.example/api/slack/interactions");
  });

  it("finishes the install without keeping the token", async () => {
    let sent = "";
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return Response.json({ ok: true, team: { name: "Uprali Test" }, access_token: "fake-token-not-kept" });
    }) as unknown as typeof fetch;
    expect(await exchangeCode("c1", "https://uprali.example", { SLACK_CLIENT_ID: "id", SLACK_CLIENT_SECRET: "sec" }, f)).toBe("Uprali Test");
    expect(sent).toContain("code=c1");
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

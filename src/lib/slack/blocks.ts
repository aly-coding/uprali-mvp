/**
 * Turns an Uprali memo into a Slack Block Kit message. The message carries its own state (the
 * question, the numbers people typed and who approved) in the buttons' values, so the Slack app
 * needs no database and keeps no workspace tokens.
 */
import { FIELDS } from "@/lib/engine/buildVsBuy";
import type { Memo } from "@/lib/engine/types";
import type { RecordResult } from "@/lib/ledger";

export const MAX_QUESTION = 1200;
const MAX_VALUE = 2000; // Slack's limit on a button value

export interface Person {
  id: string;
  name: string;
}

/** Everything needed to rebuild the decision when someone presses a button. */
export interface SlackState {
  v: 1;
  /** Decision id, kept so every update is the same decision. */
  d: string;
  q: string;
  /** Who ran /uprali. */
  by: Person;
  /** Numbers typed in Slack, by field key, with who typed them. */
  i: Record<string, { v: string | number; by: string }>;
  ap: Person[];
}

export function encodeState(s: SlackState): string {
  const out = JSON.stringify(s);
  if (out.length > MAX_VALUE) throw new Error("state too large");
  return out;
}

export function decodeState(raw: unknown): SlackState | null {
  if (typeof raw !== "string" || raw.length > MAX_VALUE) return null;
  try {
    const s = JSON.parse(raw) as SlackState;
    if (s.v !== 1 || typeof s.d !== "string" || typeof s.q !== "string" || !s.by || typeof s.i !== "object" || !Array.isArray(s.ap)) return null;
    const keys = new Set(FIELDS.map((f) => f.key));
    for (const k of Object.keys(s.i)) if (!keys.has(k)) return null;
    return s;
  } catch {
    return null;
  }
}

/** Slack mrkdwn treats &, < and > specially; escape anything a person or a model wrote. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plain = (text: string, max = 150) => ({ type: "plain_text" as const, text: text.slice(0, max), emoji: false });
const md = (text: string) => ({ type: "mrkdwn" as const, text: text.slice(0, 3000) });

type Block = Record<string, unknown>;

export interface SlackMessage {
  response_type: "in_channel";
  replace_original?: boolean;
  text: string;
  blocks: Block[];
}

export function memoToSlack(
  memo: Memo,
  state: SlackState,
  opts: { verifyUrl: string; fingerprint: string; recorded?: RecordResult | null; recordError?: string | null; canRecord: boolean },
): SlackMessage {
  const blocks: Block[] = [];
  const status = memo.status === "complete" ? "Complete" : memo.status === "draft" ? "Draft, some numbers are estimates" : "Needs a human";
  blocks.push({ type: "header", text: plain(memo.recommendation.headline || "Build or buy") });
  blocks.push({ type: "context", elements: [md(`Asked by <@${state.by.id}>: _${esc(state.q.slice(0, 280))}${state.q.length > 280 ? "…" : ""}_`)] });

  const totals: string[] = [];
  if (memo.buy) totals.push(`*Buy:* ${usd(memo.buy.total)} over ${memo.horizonYears} years`);
  if (memo.build) totals.push(`*Build:* ${usd(memo.build.total)} over ${memo.horizonYears} years`);
  blocks.push({
    type: "section",
    text: md([totals.join("\n"), `*Confidence:* ${memo.recommendation.confidence}  ·  *Status:* ${status}`].filter(Boolean).join("\n")),
  });
  if (memo.recommendation.why) blocks.push({ type: "section", text: md(esc(memo.recommendation.why)) });
  if (memo.prototypeTrap) blocks.push({ type: "section", text: md(`*The prototype trap:* ${esc(memo.prototypeTrap)}`) });

  const estimated = memo.inputs.filter((i) => i.isAssumption).length;
  blocks.push({
    type: "context",
    elements: [md(`Every number has a source and an owner. ${memo.inputs.length - estimated} came from people, ${estimated} are the analyst's benchmarks. ${esc(memo.privateAi.note)}`)],
  });

  // Numbers only a person can give, then estimates a person should confirm.
  const missing = memo.gaps.map((g) => ({ key: g.key, label: g.label, why: g.why, current: null as string | null }));
  const confirm = memo.inputs
    .filter((i) => i.needsHuman && !missing.some((m) => m.key === i.key))
    .map((i) => ({ key: i.key, label: i.label, why: i.source, current: i.value === null ? null : String(i.value) }));
  const toAsk = [...missing, ...confirm].slice(0, 4);
  if (toAsk.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: md(`*Needs a human* (${toAsk.length}). Type a number and press Enter, and the decision updates.`) });
    for (const g of toAsk) {
      const f = FIELDS.find((x) => x.key === g.key);
      blocks.push({
        type: "input",
        block_id: `fill:${g.key}`,
        dispatch_action: true,
        optional: true,
        label: plain(g.label),
        hint: plain(g.current !== null ? `Now an estimate: ${g.current}. ${f?.ask ?? ""}` : f?.ask ?? g.why, 2000),
        element: {
          type: "plain_text_input",
          action_id: "fill",
          placeholder: plain(f?.unit === "text" ? "Type it" : "Type a number", 150),
          dispatch_action_config: { trigger_actions_on: ["on_enter_pressed"] },
        },
      });
    }
  }

  if (state.ap.length) blocks.push({ type: "context", elements: [md(`Approved by ${state.ap.map((p) => `<@${p.id}>`).join(", ")}`)] });

  if (opts.recorded) {
    const where = opts.recorded.network === "near-testnet" ? "NEAR testnet" : "the demo ledger";
    const links = [`<${opts.verifyUrl}|Verify this decision>`];
    if (opts.recorded.explorerUrl) links.push(`<${opts.recorded.explorerUrl}|See the transaction>`);
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: md(`*Recorded on ${where}* by ${esc(opts.recorded.anchor.recordedBy)}. Fingerprint \`${opts.fingerprint.slice(0, 16)}…\`\n${links.join("  ·  ")}`),
    });
  } else {
    if (opts.recordError) blocks.push({ type: "context", elements: [md(`:warning: ${esc(opts.recordError)}`)] });
    const value = encodeState(state);
    const elements: Block[] = [{ type: "button", action_id: "approve", text: plain("Approve"), value }];
    if (opts.canRecord && memo.status !== "needs_human") {
      elements.push({ type: "button", action_id: "record", text: plain("Record on NEAR"), style: "primary", value });
    }
    blocks.push({ type: "actions", block_id: "uprali", elements });
  }

  return { response_type: "in_channel", text: `${memo.recommendation.headline} (Uprali)`, blocks };
}

/** The state is kept on the Approve button, which every unrecorded message has. */
export function stateFromMessage(message: unknown): SlackState | null {
  const blocks = (message as { blocks?: Array<{ type?: string; elements?: Array<{ action_id?: string; value?: string }> }> } | undefined)?.blocks;
  if (!Array.isArray(blocks)) return null;
  for (const b of blocks) {
    if (b.type !== "actions" || !Array.isArray(b.elements)) continue;
    const el = b.elements.find((e) => e.action_id === "approve");
    if (el) return decodeState(el.value);
  }
  return null;
}

export function helpMessage() {
  return {
    response_type: "ephemeral" as const,
    text:
      "Ask Uprali a build or buy question, with any numbers you know. For example:\n" +
      "`/uprali Should we build our own CRM or keep paying $720 a year for HubSpot? Our engineer built a prototype in 3 weeks.`\n" +
      "Uprali replies in the channel with the 3-year cost of each side, where every number came from, and the numbers only a person can give. " +
      "Anyone can fill those in, approve, and record the decision's fingerprint on NEAR testnet.",
  };
}

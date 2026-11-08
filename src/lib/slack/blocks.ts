/**
 * Turns an Uprali memo into a Slack Block Kit message. The message carries its own state (the
 * template, the question, the numbers people typed and who approved) in the buttons' values, so a
 * decision needs nothing stored to carry on.
 */
import { FIELDS, type FieldDef } from "@/lib/engine/buildVsBuy";
import type { CaseMemo } from "@/lib/engine/caseDecide";
import { ALL_TEMPLATE_IDS, CASE_TEMPLATES, isCaseTemplate, rowValue, type TemplateId } from "@/lib/engine/cases";
import { SUGGESTION_LABEL } from "@/lib/engine/advisorShared";
import type { Input, Memo } from "@/lib/engine/types";
import type { RecordResult } from "@/lib/ledger";
import { TEMPLATE_TITLES } from "./templates";

export const MAX_QUESTION = 1200;
const MAX_VALUE = 2000; // Slack's limit on a button value

export interface Person {
  id: string;
  name: string;
}

/** Everything needed to rebuild the decision when someone presses a button. */
export interface SlackState {
  v: 1;
  /** Template id. Absent means build vs buy (messages from before templates). */
  t?: TemplateId;
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
    if (s.t !== undefined && !(ALL_TEMPLATE_IDS as readonly string[]).includes(s.t)) return null;
    const keys = new Set(fieldsOf(s.t).map((f) => f.key));
    for (const k of Object.keys(s.i)) if (!keys.has(k)) return null;
    return s;
  } catch {
    return null;
  }
}

/** The fields a template takes. */
export function fieldsOf(t: TemplateId | undefined): FieldDef[] {
  return isCaseTemplate(t) ? CASE_TEMPLATES[t].drivers : FIELDS;
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

export function memoToSlack(memo: Memo, state: SlackState, opts: FooterOpts): SlackMessage {
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
  if (memo.value) {
    const pct = (n: number | null) => (n === null ? "not known" : `${Math.round(n * 1000) / 10}%`);
    const rows = memo.value.options
      .filter((o) => o.option !== "status_quo")
      .map((o) => `*${o.label}:* ${o.financial === null ? "ROI needs confirmed savings" : `net ROI ${pct(o.netRoi)}, payback ${o.payback.text}`}${o.capacity !== null ? `, time freed worth ${usd(o.capacity)} (not cash)` : ""}`);
    const k = memo.killCriteria;
    if (k) rows.push(`*When to stop:* ${esc(k.metric)}, at least ${esc(k.minimumEffect.replace(/^At least /, ""))}, checked by ${esc(k.window.split(" (")[0])}. Owner: ${k.owner ? esc(k.owner) : "needs a human"}.`);
    blocks.push({ type: "section", text: md(rows.join("\n")) });
  }

  const estimated = memo.inputs.filter((i) => i.isAssumption).length;
  blocks.push({
    type: "context",
    elements: [md(`Every number has a source and an owner. ${memo.inputs.length - estimated} came from people, ${estimated} are the analyst's benchmarks. ${esc(memo.privateAi.note)}`)],
  });

  blocks.push(...suggestionBlocks(memo.inputs));

  // Numbers only a person can give, then estimates a person should confirm.
  const missing = memo.gaps.map((g) => ({ key: g.key, label: g.label, why: g.why, current: null as string | null }));
  const confirm = memo.inputs
    .filter((i) => i.needsHuman && !missing.some((m) => m.key === i.key))
    .map((i) => ({ key: i.key, label: i.label, why: i.source, current: i.value === null ? null : String(i.value) }));
  const roi = (memo.value?.missing ?? [])
    .filter((m) => m.key === "confirmed_annual_savings" || m.key === "current_annual_cost")
    .map((m) => ({ key: m.key, label: m.label, why: m.why, current: null as string | null }));
  blocks.push(...askBlocks([...missing, ...confirm, ...roi], FIELDS));
  blocks.push(...footerBlocks(state, opts, memo.status));
  return { response_type: "in_channel", text: `${memo.recommendation.headline} (Uprali)`, blocks };
}


type Ask = { key: string; label: string; why: string; current: string | null };
type FooterOpts = { verifyUrl: string; fingerprint: string; recorded?: RecordResult | null; recordError?: string | null; canRecord: boolean };

/** The numbers only a person can give, as boxes: type and press Enter, and the decision updates. */
function askBlocks(asks: Ask[], fields: FieldDef[]): Block[] {
  const toAsk = asks.slice(0, 5);
  if (!toAsk.length) return [];
  const blocks: Block[] = [{ type: "divider" }, { type: "section", text: md(`*Needs a human* (${toAsk.length}). Type a number and press Enter, and the decision updates.`) }];
  for (const g of toAsk) {
    const f = fields.find((x) => x.key === g.key);
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
  return blocks;
}

/** The analyst's own estimates, each tagged as a suggestion to check rather than a fact. */
function suggestionBlocks(inputs: Input[]): Block[] {
  const est = inputs.filter((i) => i.isAssumption && i.owner === "agent" && i.value !== null);
  if (!est.length) return [];
  const shown = est.slice(0, 6).map((i) => `• ${esc(i.label)}: ${esc(String(i.value))}${unitText(i.unit)}  _${SUGGESTION_LABEL}_`);
  if (est.length > shown.length) shown.push(`…and ${est.length - shown.length} more on the verify page.`);
  return [{ type: "section", text: md(`*The analyst's estimates* (${est.length}):\n${shown.join("\n")}`) }];
}

function unitText(u: Input["unit"]): string {
  if (u === "pct") return "%";
  if (u === "usd_per_year") return " a year";
  if (u === "usd_per_week") return " a week";
  if (u === "weeks") return " weeks";
  if (u === "hours_per_week") return " hours a week";
  if (u === "hours_per_month") return " hours a month";
  if (u === "months") return " months";
  if (u === "years") return " years";
  return "";
}

/** Who approved, then either the proof on NEAR or the Approve and Record on NEAR buttons. */
function footerBlocks(state: SlackState, opts: FooterOpts, status: string): Block[] {
  const blocks: Block[] = [];
  if (state.ap.length) blocks.push({ type: "context", elements: [md(`Approved by ${state.ap.map((p) => `<@${p.id}>`).join(", ")}`)] });
  if (opts.recorded) {
    const where = opts.recorded.network === "near-testnet" ? "NEAR testnet" : "the demo ledger";
    const links = [`<${opts.verifyUrl}|Verify this decision>`];
    if (opts.recorded.explorerUrl) links.push(`<${opts.recorded.explorerUrl}|See the transaction>`);
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: md(`*Recorded on ${where}* by ${esc(opts.recorded.anchor.recordedBy)}. Fingerprint \`${opts.fingerprint.slice(0, 16)}…\`\n${links.join("  ·  ")}`) });
    return blocks;
  }
  if (opts.recordError) blocks.push({ type: "context", elements: [md(`:warning: ${esc(opts.recordError)}`)] });
  const value = encodeState(state);
  const elements: Block[] = [{ type: "button", action_id: "approve", text: plain("Approve"), value }];
  if (opts.canRecord && status !== "needs_human") elements.push({ type: "button", action_id: "record", text: plain("Record on NEAR"), style: "primary", value });
  blocks.push({ type: "actions", block_id: "uprali", elements });
  return blocks;
}

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const pctOf = (n: number | null) => (n === null ? "not known" : `${Math.round(n * 1000) / 10}%`);

/** A business case (new product, go-to-market or AI investment) as a Slack message. */
export function caseToSlack(memo: CaseMemo, state: SlackState, opts: FooterOpts): SlackMessage {
  const blocks: Block[] = [];
  const status = memo.status === "complete" ? "Complete" : memo.status === "draft" ? "Draft, some numbers are estimates" : "Needs a human";
  blocks.push({ type: "header", text: plain(memo.recommendation.headline || memo.template.title) });
  blocks.push({ type: "context", elements: [md(`*${esc(memo.template.title)}*  ·  Asked by <@${state.by.id}>: _${esc(state.q.slice(0, 260))}${state.q.length > 260 ? "…" : ""}_`)] });
  const m = memo.metrics;
  if (m) {
    const lines = [
      `*3-year net cash:* ${money(m.cumulativeNet)}  ·  *NPV* at ${m.discountRatePct}%: ${money(m.npv)}`,
      `*ROI:* ${pctOf(m.roi)}  ·  *Payback:* ${m.paybackMonths === null ? "not within 3 years" : `${m.paybackMonths} months`}`,
    ];
    if (memo.capacityByYear) lines.push(`*Freed-up time:* ${money(memo.capacityByYear.reduce((a, b) => a + b, 0))} over 3 years (capacity, not cash)`);
    lines.push(`*Confidence:* ${memo.recommendation.confidence}  ·  *Status:* ${status}`);
    blocks.push({ type: "section", text: md(lines.join("\n")) });
    if (memo.benefitByYear && memo.costByYear && memo.netByYear) {
      const years = memo.netByYear.map((n, y) => `Year ${y + 1}: benefit ${money(memo.benefitByYear![y])}, cost ${money(memo.costByYear![y])}, net *${money(n)}*`);
      blocks.push({ type: "section", text: md(years.join("\n")) });
    }
    if (memo.scenarios.length) {
      blocks.push({ type: "context", elements: [md(`Scenarios, NPV: ${memo.scenarios.map((s) => `${s.label} ${money(s.metrics.npv)}`).join("  ·  ")}. ${esc(memo.scenarios[0].flex)}.`)] });
    }
  } else {
    blocks.push({ type: "section", text: md(`*Status:* ${status}. The 3-year model fills in once the numbers below are in.`) });
  }
  if (memo.recommendation.why) blocks.push({ type: "section", text: md(esc(memo.recommendation.why)) });
  const cards = memo.cards
    .filter((c) => c.headline && c.headline.value !== null)
    .map((c) => `*${esc(c.title)}* (${esc(c.owner)}): ${esc(c.headline!.label)} ${rowValue(c.headline!.value!, c.headline!.unit)}`);
  if (cards.length) blocks.push({ type: "section", text: md(cards.join("\n")) });
  if (memo.biggestRisk) blocks.push({ type: "section", text: md(`*Biggest risk:* ${esc(memo.biggestRisk)}`) });

  const estimated = memo.inputs.filter((i) => i.isAssumption).length;
  blocks.push({ type: "context", elements: [md(`Every number has a source and an owner. ${memo.inputs.length - estimated} came from people, ${estimated} are the analyst's estimates. ${esc(memo.privateAi.note)}`)] });
  blocks.push(...suggestionBlocks(memo.inputs));

  const fields = CASE_TEMPLATES[memo.template.id].drivers;
  const missing: Ask[] = memo.gaps.map((g) => ({ key: g.key, label: g.label, why: g.why, current: null }));
  const keyGuesses: Ask[] = memo.inputs
    .filter((i) => !missing.some((g) => g.key === i.key) && (i.needsHuman || (i.isAssumption && fields.find((f) => f.key === i.key && "kind" in f && (f as { kind?: string }).kind === "keyDriver"))))
    .map((i) => ({ key: i.key, label: i.label, why: i.source, current: i.value === null ? null : String(i.value) }));
  blocks.push(...askBlocks([...missing, ...keyGuesses], fields));
  blocks.push(...footerBlocks(state, opts, memo.status));
  return { response_type: "in_channel", text: `${memo.recommendation.headline} (Uprali)`, blocks };
}

/** When it isn't clear which kind of decision this is: one button per template, each carrying the question. */
export function templateQuestion(state: SlackState): SlackMessage {
  const ids = ALL_TEMPLATE_IDS as readonly TemplateId[];
  return {
    response_type: "in_channel",
    text: "Which kind of decision is this? (Uprali)",
    blocks: [
      { type: "section", text: md(`Which kind of decision is this, <@${state.by.id}>?\n_${esc(state.q.slice(0, 280))}${state.q.length > 280 ? "…" : ""}_`) },
      { type: "actions", block_id: "uprali_pick", elements: ids.map((id) => ({ type: "button", action_id: `pick:${id}`, text: plain(TEMPLATE_TITLES[id]), value: encodeState({ ...state, t: id }) })) },
      { type: "context", elements: [md("Next time, start with `product:`, `gtm:`, `ai:` or `bvb:` to skip this.")] },
    ],
  };
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
      "Ask Uprali a business decision, with any numbers you know: `/uprali`, `@uprali-mvp` in a channel, or a direct message. For example:\n" +
      "• Build vs buy: `Should we build our own CRM or keep paying $720 a year for HubSpot? Our engineer built a prototype in 3 weeks.`\n" +
      "• New product, go-to-market or AI investment: start with `product:`, `gtm:` or `ai:`.\n" +
      "Uprali replies with the 3-year result, where every number came from, its own estimates marked Suggestion, verify, and boxes for the numbers only a person can give. " +
      "Anyone can fill those in, approve, and record the decision's fingerprint on NEAR testnet. Every run is kept in history.\n" +
      "`/uprali history` shows your last 10 decisions, only to you.",
  };
}

import { fmt } from "./buildVsBuy";
import type { Memo } from "./types";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The memo as Markdown, for an agent to show or a person to paste. */
export function memoToMarkdown(m: Memo, extra?: { fingerprint?: string; verifyUrl?: string; txUrl?: string }): string {
  const L: string[] = [];
  L.push(`# ${m.title}`);
  L.push("");
  L.push(`**${m.recommendation.headline}** (confidence: ${m.recommendation.confidence}, status: ${m.status === "needs_human" ? "needs a human" : m.status})`);
  L.push("");
  L.push(m.recommendation.why);
  if (m.prototypeTrap) L.push("", `> ${m.prototypeTrap}`);
  if (m.buy && m.build) {
    L.push("", `## ${m.horizonYears}-year total cost`, "", `| | Buy | Build |`, `|---|---|---|`);
    m.buy.byYear.forEach((b, i) => L.push(`| Year ${i + 1} | ${usd(b)} | ${usd(m.build!.byYear[i])} |`));
    L.push(`| **Total** | **${usd(m.buy.total)}** | **${usd(m.build.total)}** |`);
    L.push("", "### Where the build money goes", "");
    for (const l of [...m.build.lines].filter((x) => x.total > 0).sort((a, b) => b.total - a.total)) L.push(`- ${l.label}: ${usd(l.total)} (${l.how})`);
    if (m.breakEvenAnnualSubscription !== null) L.push("", `Break-even: buying stops being cheaper at about ${usd(m.breakEvenAnnualSubscription)} a year.`);
  }
  if (m.value) {
    const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
    const money = (n: number | null) => (n === null ? "—" : usd(n));
    L.push("", "## Return on investment, against keeping things as they are", "", "| | New spend | Confirmed cash | Time freed (not cash) | Net ROI | Gross ROI | Payback |", "|---|---|---|---|---|---|---|");
    for (const o of m.value.options) {
      const sq = o.option === "status_quo";
      L.push(`| ${o.label} | ${money(o.investment)} | ${money(o.financial)} | ${money(o.capacity)} | ${sq ? "—" : pct(o.netRoi)} | ${sq ? "—" : pct(o.grossRoi)} | ${o.payback.text} |`);
    }
    if (m.value.scenarios) for (const sc of m.value.scenarios) L.push(`- ${sc.label} (${sc.timeReductionPct}% time saved, ${sc.adoptionPct}% adoption): gross ROI ${pct(sc.buy.grossRoi)} to buy, ${pct(sc.build.grossRoi)} to build`);
    L.push("", `Opportunity cost: ${m.value.opportunity.text}${m.value.opportunity.estimatedCost ? ` Estimated at ${usd(m.value.opportunity.estimatedCost)}.` : ""} ${m.value.opportunity.note}`);
    L.push(`Kind of return: ${m.value.roiType ?? "not set yet"}`);
    for (const n of m.value.notes) L.push("", n);
    if (m.value.missing.length) L.push("", `To finish the ROI case: ${m.value.missing.map((x) => x.label.toLowerCase()).join(", ")}.`);
  }
  if (m.funding) {
    L.push("", "## Would a CFO fund it?", "");
    for (const c of m.funding.criteria) L.push(`- ${c.met === null ? "?" : c.met ? "✓" : "✗"} ${c.label}: ${c.why}`);
    L.push("", "### Reasons for \"not now\"", "");
    for (const c of m.funding.notNow) L.push(`- ${c.flagged === null ? "?" : c.flagged ? "⚠" : "✓"} ${c.reason}: ${c.why}`);
  }
  if (m.killCriteria) {
    const k = m.killCriteria;
    L.push("", "## When to stop", "", `- Metric: ${k.metric}`, `- Minimum effect: ${k.minimumEffect}`, `- Check by: ${k.window}`, `- Owner: ${k.owner ?? "needs a human"}`, `- Fallback: ${k.fallback}`);
  }
  L.push("", "## Every number, with its source and owner", "", "| Number | Value | Owner | Kind | Source |", "|---|---|---|---|---|");
  for (const i of m.inputs) {
    L.push(`| ${i.label} | ${i.value === null ? (i.needsHuman ? "**needs a human**" : "not given") : fmt(i.value, i.unit)} | ${i.owner} | ${i.isAssumption ? "assumption" : "fact"} | ${i.source.replace(/\|/g, "/")} |`);
  }
  if (m.gaps.length) {
    L.push("", "## Needs a human", "");
    for (const g of m.gaps) L.push(`- ${g.label}: ${g.why.replace(/^Needs a human: /, "")}`);
  }
  if (m.whatWouldChangeMyMind.length) {
    L.push("", "## What would change my mind", "");
    for (const f of m.whatWouldChangeMyMind) L.push(`- ${f.text}`);
  }
  L.push("", "## Biggest risk", "", m.biggestRisk, "", "## Questions the CFO will ask", "");
  m.cfoQuestions.forEach((q) => L.push(`- ${q}`));
  L.push("", "## 30-second version", "", m.spoken30s);
  L.push("", "## Private AI", "", m.privateAi.note);
  if (m.privateAi.attestation) {
    for (const c of m.privateAi.attestation.checks) L.push(`- ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  if (extra?.fingerprint) {
    L.push("", "## Proof", "", `Fingerprint (SHA-256): \`${extra.fingerprint}\``);
    if (extra.txUrl) L.push(`Recorded on NEAR testnet: ${extra.txUrl}`);
    if (extra.verifyUrl) L.push(`Verify: ${extra.verifyUrl}`);
  }
  return L.join("\n");
}

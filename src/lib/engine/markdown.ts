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
  L.push("", "## Every number, with its source and owner", "", "| Number | Value | Owner | Kind | Source |", "|---|---|---|---|---|");
  for (const i of m.inputs) {
    L.push(`| ${i.label} | ${i.value === null ? "**needs a human**" : fmt(i.value, i.unit)} | ${i.owner} | ${i.isAssumption ? "assumption" : "fact"} | ${i.source.replace(/\|/g, "/")} |`);
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

import type { CaseState, DecisionMemo } from "./types";
import { getTemplate } from "./templates";
import { filledByLabel, formatValue } from "./format";

export function missingFields(c: CaseState): string[] {
  const t = getTemplate(c.templateId);
  return t.fields.filter((f) => f.required && c.assumptions[f.key] === undefined).map((f) => f.key);
}

/** Builds the decision memo deterministically from the case. Numbers come from code, never from a model. */
export function buildMemo(c: CaseState): DecisionMemo {
  const t = getTemplate(c.templateId);
  const missing = missingFields(c);
  const values: Record<string, number | string> = {};
  for (const [k, a] of Object.entries(c.assumptions)) values[k] = a.value;
  const r = t.compute(values);

  const assumptions = t.fields
    .filter((f) => c.assumptions[f.key])
    .map((f) => {
      const a = c.assumptions[f.key];
      return {
        label: f.label,
        value: formatValue(a.value, f.unit),
        source: a.source,
        confidence: a.confidence,
        owner: a.owner,
        filledBy: filledByLabel(a.filledBy),
      };
    });

  const cheatSheet = t.fields
    .filter((f) => c.assumptions[f.key] && f.unit !== "text")
    .map((f) => {
      const a = c.assumptions[f.key];
      return {
        figure: formatValue(a.value, f.unit),
        meaning: f.label,
        source: a.source,
        cfoAsks:
          a.confidence === "low"
            ? `How do we know? This is a ${a.confidence}-confidence estimate, so firm it up before the meeting.`
            : `Where does it come from? ${a.source}.`,
      };
    });

  return {
    title: c.title,
    complete: missing.length === 0,
    missing: missing.map((k) => t.fields.find((f) => f.key === k)!.label),
    recommendation: r.recommendation,
    recommendedOption: r.recommendedOption,
    lines: [
      { label: "The ask", text: r.ask },
      { label: "Why", text: r.why.join(" ") },
      { label: "Cost and payback", text: r.costAndPayback },
      { label: "Biggest risk", text: r.biggestRisk },
      { label: "What would change my mind", text: r.changeMyMind },
    ],
    cheatSheet,
    assumptions,
    whatIf: r.whatIf,
    preAnswered: r.preAnswered,
    spoken: r.spoken,
  };
}

export function memoToMarkdown(m: DecisionMemo): string {
  const lines: string[] = [];
  lines.push(`# ${m.title}`, "");
  lines.push(`**Recommendation:** ${m.recommendation}`, "");
  for (const l of m.lines) lines.push(`**${l.label}:** ${l.text}`, "");
  lines.push("## Know your numbers", "", "| Figure | Plain meaning | Source | CFO will ask |", "|---|---|---|---|");
  for (const r of m.cheatSheet) lines.push(`| ${r.figure} | ${r.meaning} | ${r.source} | ${r.cfoAsks} |`);
  lines.push("", "## Assumptions with confidence", "", "| Assumption | Value | Source | Confidence | Filled by |", "|---|---|---|---|---|");
  for (const a of m.assumptions) lines.push(`| ${a.label} | ${a.value} | ${a.source} | ${a.confidence} | ${a.filledBy} |`);
  lines.push("", "## What-if", "", m.whatIf, "", "## Pre-answered questions", "");
  for (const q of m.preAnswered) lines.push(`- **${q.q}** ${q.a}`);
  lines.push("", "## 30-second version", "", `"${m.spoken}"`, "");
  return lines.join("\n");
}

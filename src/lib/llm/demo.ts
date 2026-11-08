import type { AnalystProvider, AnalystTurnInput, AnalystTurnOutput, AnalystUpdate } from "./types";
import { formatValue, parseAmount } from "../format";
import type { FieldDef } from "../types";

const UNSURE = /\b(don'?t know|do not know|not sure|no idea|unsure|you (pick|choose|fill|decide|estimate)|use (a|the) benchmark|benchmark|typical|whatever is normal|skip)\b/i;
const HEDGE = /\b(about|around|roughly|maybe|approx\w*|estimate|guess|ish)\b|~/i;

/**
 * A scripted analyst that needs no API key. It walks the template's fields in order,
 * reads numbers out of the user's replies and offers benchmarks when they don't know.
 * It exists so the app runs end to end for judges and demos with zero setup.
 */
export class DemoAnalyst implements AnalystProvider {
  name = "demo" as const;
  model = "scripted-v1";

  async turn(input: AnalystTurnInput): Promise<AnalystTurnOutput> {
    const { template, assumptions } = input;
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
    const missing = (filled: Set<string>) => template.fields.filter((f) => f.required && !filled.has(f.key));
    const filled = new Set(Object.keys(assumptions));
    const target: FieldDef | undefined =
      template.fields.find((f) => f.key === input.pendingKey) ?? missing(filled)[0];

    const updates: AnalystUpdate[] = [];
    let lead = "";

    if (target && lastUser) {
      if (UNSURE.test(lastUser)) {
        updates.push({
          key: target.key,
          value: target.benchmark,
          source: `Analyst benchmark: ${target.hint}`,
          confidence: "low",
          origin: "model_estimate",
        });
        lead = `No problem. I've used a benchmark of ${formatValue(target.benchmark, target.unit)}, marked low confidence so you can firm it up later.`;
      } else if (target.unit === "text") {
        const value = lastUser.replace(/^(it'?s|we'?d (buy|use)|probably|the)\s+/i, "").replace(/[.!]+$/, "").slice(0, 60);
        if (value) {
          updates.push({ key: target.key, value, source: "Stated by the user", confidence: "high", origin: "user_stated" });
          lead = `Got it, ${value}.`;
        }
      } else {
        const n = parseAmount(lastUser);
        if (n !== null && n >= 0) {
          const confidence = HEDGE.test(lastUser) ? "medium" : "high";
          updates.push({ key: target.key, value: n, source: "Stated by the user", confidence, origin: "user_stated" });
          lead = `Got it, ${formatValue(n, target.unit)}${confidence === "medium" ? ", marked as an estimate" : ""}.`;
        } else {
          return {
            reply: `I need a number for ${target.label.toLowerCase()}. ${target.hint} If you're not sure, say "not sure" and I'll use a benchmark.`,
            updates: [],
            askingKey: target.key,
            provider: this.name,
            model: this.model,
          };
        }
      }
    }

    for (const u of updates) filled.add(u.key);
    const next = missing(filled)[0];
    const reply = next
      ? `${lead ? lead + " " : ""}${next.question}`
      : `${lead ? lead + " " : ""}That's everything I need. Your decision memo is ready. Review it, add who approves, then record the decision on NEAR.`;
    return { reply, updates, askingKey: next?.key ?? null, provider: this.name, model: this.model };
  }
}

/**
 * Measures the README's numbers on the example question of each template, with the built-in
 * analyst (no model calls, no network). Run: npm run measure
 * Prints, per template: median time from question to finished memo over 20 runs, how many
 * numbers the memo uses, how many it flags as "needs a human", and how many are labelled benchmarks.
 */
import { test } from "vitest";
import { runDecision, runCase } from "../src/lib/service";
import { templateList } from "../src/lib/engine/cases";

// With NEARAI_API_KEY set this measures the live NEAR AI path instead (3 runs, it costs model calls).
const live = !!process.env.NEARAI_API_KEY;
const RUNS = live ? 3 : 20;
const env = (live ? process.env : { LLM_PROVIDER: "demo" }) as Record<string, string | undefined>;

test("measure the example cases", async () => {
  const rows: string[] = [];
  for (const t of templateList()) {
    const times: number[] = [];
    let memo: any = null;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const r =
        t.id === "build_vs_buy"
          ? await runDecision({ question: t.prompt, decidedBy: "measure" }, "http://localhost", env)
          : await runCase({ template: t.id as any, question: t.prompt, decidedBy: "measure" }, "http://localhost", env);
      times.push(performance.now() - t0);
      memo = r.memo;
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(RUNS / 2)];
    const inputs = memo.inputs as Array<{ needsHuman: boolean; owner: string; isAssumption: boolean; source: string }>;
    const sourced = inputs.filter((x) => x.source && x.owner).length;
    const flagged = inputs.filter((x) => x.needsHuman).length;
    const benchmarks = inputs.filter((x) => x.owner === "agent" && x.isAssumption).length;
    rows.push(`| ${t.title} | ${median.toFixed(1)} ms | ${inputs.length} | ${sourced} | ${flagged} | ${benchmarks} | ${memo.status} |`);
  }
  process.stdout.write(`\nAnalyst: ${live ? "NEAR AI Cloud" : "built-in (no model calls)"}, ${RUNS} runs each\n` + ["| Template | Median time, question to memo | Numbers in the memo | With a source and owner | Flagged needs a human | Labelled benchmarks | Status |", "|---|---|---|---|---|---|---|", ...rows].join("\n") + "\n");
});

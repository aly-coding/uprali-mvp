/**
 * The judge path: one sample decision anyone can open and verify in half a minute, without a
 * wallet. The server makes it once, records its fingerprint with the relayer account, and keeps
 * it, so every visitor checks the same recorded fingerprint. It's remade only when the ledger
 * changes (for example from the demo ledger to NEAR testnet).
 */
import type { GivenValue } from "./engine/types";
import { getHistory, recordedFrom, type HistoryEntry, type RecordedInfo } from "./history";
import { getLedger, LedgerError } from "./ledger";
import { recordSnapshot, runAndSave } from "./service";

type Env = Record<string, string | undefined>;

export const SAMPLE_OWNER = "sample:crm-v1";
export const SAMPLE_RUN_ID = "sample_crm_v1";
export const SAMPLE_DECISION_ID = "UP-SAMPLE-CRM";
export const SAMPLE_QUESTION =
  "Our engineer built a CRM prototype in 3 weeks. Should we build our own CRM, or keep paying about $9,000 a year for HubSpot? It would need to connect to email and billing.";

const SRC = "Sample figure for the Uprali demo";

export function sampleInputs(): Record<string, GivenValue> {
  const h = (value: number | string, owner: "human" | "agent" = "human"): GivenValue => ({ value, owner, is_assumption: false, source: SRC });
  return {
    tool_name: h("HubSpot"),
    buy_annual_cost: h(9000),
    prototype_weeks: h(3),
    engineer_weekly_cost: h(4000),
    integrations_count: h(2),
    opportunity_pct: h(15),
    confirmed_annual_savings: h(6000),
    work_hours_year: h(4000),
    time_reduction_pct: h(10),
    staff_hourly_cost: h(60),
    roi_type: h("soft: sales team time"),
    decision_owner: h("CFO"),
  };
}

let pending: Promise<HistoryEntry> | null = null;

async function make(base: string, env: Env): Promise<HistoryEntry> {
  const store = await getHistory(env);
  const ledger = await getLedger(env);
  const existing = await store.get(SAMPLE_OWNER, SAMPLE_RUN_ID);
  if (existing?.recorded && existing.recorded.network === ledger.network) return existing;
  if (existing && !existing.recorded) {
    // Made earlier but the record didn't go through: try that fingerprint again before making a new one.
    const onChain = await ledger.get(existing.fingerprint).catch(() => null);
    let recorded: RecordedInfo | null = onChain ? { network: ledger.network, by: onChain.recordedBy, atMs: onChain.timestampMs, txUrl: null } : null;
    if (!recorded) {
      try {
        recorded = recordedFrom(await recordSnapshot(existing.snapshot, env));
      } catch (err) {
        if (!(err instanceof LedgerError)) throw err;
      }
    }
    if (recorded) {
      await store.markRecorded(existing.fingerprint, recorded);
      return { ...existing, recorded };
    }
    return existing;
  }
  const r = await runAndSave(
    {
      question: SAMPLE_QUESTION,
      title: "Build our own CRM or keep HubSpot?",
      inputs: sampleInputs(),
      decisionId: SAMPLE_DECISION_ID,
      decidedBy: "Uprali sample",
      approvedBy: ["Sample CFO"],
      record: true,
    },
    base,
    { owner: SAMPLE_OWNER, source: "web", runId: SAMPLE_RUN_ID },
    env,
  );
  const saved = await store.get(SAMPLE_OWNER, SAMPLE_RUN_ID);
  if (!saved) throw new Error("sample not saved");
  if (r.recordError) console.error("sample record failed");
  return saved;
}

export function getSample(base: string, env: Env = process.env): Promise<HistoryEntry> {
  if (!pending) {
    pending = make(base, env).finally(() => {
      pending = null;
    });
  }
  return pending;
}

import { decide, type DecideRequest } from "./engine/decide";
import { caseToMarkdown, memoToMarkdown } from "./engine/markdown";
import { decideCase, type CaseMemo, type CaseRequest } from "./engine/caseDecide";
import { buildSnapshot, hashSnapshot, validateSnapshot, type AnyMemo, type DecisionSnapshot } from "./engine/snapshot";
import type { GivenValue, Memo } from "./engine/types";
import { getHistory, makeEntry, recordedFrom, saveQuietly, type HistorySource } from "./history";
import { getLedger, LedgerError, type LedgerAnchor, type RecordResult } from "./ledger";

type Env = Record<string, string | undefined>;

export function publicBaseUrl(req?: Request, env: Env = process.env): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (req) return new URL(req.url).origin;
  return "http://localhost:3000";
}

export function verifyUrl(base: string, hash: string): string {
  return `${base}/verify?hash=${hash}`;
}

export interface DecisionResult<M extends AnyMemo = Memo> {
  memo: M;
  snapshot: DecisionSnapshot;
  fingerprint: string;
  markdown: string;
  verifyUrl: string;
  recorded: RecordResult | null;
  recordError: string | null;
}

type RunOpts = { decidedBy: string; approvedBy?: string[]; record?: boolean; version?: number };

/** Snapshot, fingerprint, optional ledger record and Markdown, the same for every template. */
async function finish<M extends AnyMemo>(memo: M, req: RunOpts, base: string, env: Env): Promise<DecisionResult<M>> {
  const snapshot = buildSnapshot(memo, { decidedBy: req.decidedBy, approvers: req.approvedBy, version: req.version });
  const fingerprint = await hashSnapshot(snapshot);
  let recorded: RecordResult | null = null;
  let recordError: string | null = null;
  if (req.record) {
    if (memo.status === "needs_human") recordError = "Not recorded: the decision still needs a human to fill in the missing numbers.";
    else {
      try {
        recorded = await recordSnapshot(snapshot, env);
      } catch (err) {
        recordError = err instanceof LedgerError ? err.userMessage : "Couldn't record the decision.";
      }
    }
  }
  const url = verifyUrl(base, fingerprint);
  const extra = { fingerprint, verifyUrl: url, txUrl: recorded?.explorerUrl };
  return {
    memo,
    snapshot,
    fingerprint,
    verifyUrl: url,
    recorded,
    recordError,
    markdown: memo.schema === "uprali.case.v1" ? caseToMarkdown(memo, extra) : memoToMarkdown(memo, extra),
  };
}

export async function runDecision(req: DecideRequest & RunOpts, base: string, env: Env = process.env): Promise<DecisionResult> {
  return finish(await decide(req, env), req, base, env);
}

export async function runCase(req: CaseRequest & RunOpts, base: string, env: Env = process.env): Promise<DecisionResult<CaseMemo>> {
  return finish(await decideCase(req, env), req, base, env);
}

export interface HistoryTarget {
  owner: string | null;
  source: HistorySource;
  /** Re-run of this earlier run: the new run keeps its decision id and takes the next version. */
  parentId?: string | null;
  /** Fixed run id, so later updates replace the same run (used by Slack). */
  runId?: string;
}

/**
 * Runs a decision and keeps it in the owner's history. A parent run that isn't the owner's is
 * ignored, so nobody can attach a run to someone else's decision.
 */
export async function runAndSave(
  req: DecideRequest & { decidedBy: string; approvedBy?: string[]; record?: boolean },
  base: string,
  target: HistoryTarget,
  env: Env = process.env,
): Promise<DecisionResult & { runId: string | null; parentId: string | null }> {
  return saveRun(req, target, env, (decisionId, version) => runDecision({ ...req, decisionId, version }, base, env));
}

/** The same for a business-case template: new product, new feature, market expansion, AI investment. */
export async function runCaseAndSave(
  req: CaseRequest & { decidedBy: string; approvedBy?: string[]; record?: boolean },
  base: string,
  target: HistoryTarget,
  env: Env = process.env,
): Promise<DecisionResult<CaseMemo> & { runId: string | null; parentId: string | null }> {
  return saveRun(req, target, env, (decisionId, version) => runCase({ ...req, decisionId, version }, base, env));
}

async function saveRun<M extends AnyMemo>(
  req: { decisionId?: string; inputs?: Record<string, GivenValue | undefined>; question?: string },
  target: HistoryTarget,
  env: Env,
  run: (decisionId: string | undefined, version: number | undefined) => Promise<DecisionResult<M>>,
): Promise<DecisionResult<M> & { runId: string | null; parentId: string | null }> {
  let parentId: string | null = null;
  let version: number | undefined;
  let decisionId = req.decisionId;
  if (target.owner && target.parentId) {
    try {
      const store = await getHistory(env);
      const parent = await store.get(target.owner, target.parentId);
      if (parent) {
        parentId = parent.id;
        decisionId = parent.decisionId;
        version = await store.nextVersion(target.owner, parent.decisionId);
      }
    } catch {
      /* history down: run it as a new decision */
    }
  }
  const r = await run(decisionId, version);
  if (!target.owner) return { ...r, runId: null, parentId };
  const entry = makeEntry({
    id: target.runId,
    owner: target.owner,
    source: target.source,
    parentId,
    inputs: req.inputs ?? {},
    memo: r.memo,
    snapshot: r.snapshot,
    fingerprint: r.fingerprint,
    verifyUrl: r.verifyUrl,
    recorded: recordedFrom(r.recorded),
    question: req.question,
  });
  const saved = await saveQuietly(entry, env);
  return { ...r, runId: saved ? entry.id : null, parentId };
}

/** Writes the snapshot's fingerprint to the ledger. Only the hash, kind, decision id and version leave the server. */
export async function recordSnapshot(snapshot: DecisionSnapshot, env: Env = process.env): Promise<RecordResult> {
  const hash = await hashSnapshot(snapshot);
  const ledger = await getLedger(env);
  return ledger.record({ hash, kind: snapshot.kind, caseId: snapshot.decisionId, version: snapshot.version });
}

export interface VerifyResult {
  fingerprint: string;
  recorded: boolean;
  anchor: LedgerAnchor | null;
  network: string;
  contractId: string | null;
  /** True only when a snapshot was given, it hashes to the recorded fingerprint and the ids match. */
  matches: boolean | null;
  message: string;
}

export async function verifyDecision(input: { snapshot?: unknown; fingerprint?: string }, env: Env = process.env): Promise<VerifyResult> {
  let fingerprint = (input.fingerprint || "").trim().toLowerCase();
  let snapshot: DecisionSnapshot | null = null;
  if (input.snapshot !== undefined) {
    if (!validateSnapshot(input.snapshot)) throw new LedgerError("bad snapshot", "That isn't a valid Uprali decision snapshot.", 400);
    snapshot = input.snapshot;
    const computed = await hashSnapshot(snapshot);
    if (fingerprint && fingerprint !== computed) {
      return { fingerprint: computed, recorded: false, anchor: null, network: "", contractId: null, matches: false, message: "No match: this snapshot doesn't produce the fingerprint you gave. It was changed." };
    }
    fingerprint = computed;
  }
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new LedgerError("bad hash", "Give a decision snapshot or a 64-character fingerprint.", 400);
  const ledger = await getLedger(env);
  const anchor = await ledger.get(fingerprint);
  const where = ledger.network === "near-testnet" ? `NEAR testnet (${ledger.contractId})` : "the local demo ledger";
  let matches: boolean | null = null;
  let message: string;
  if (!anchor) {
    message = snapshot ? `No match: this decision was never recorded on ${where}, or it was changed after it was recorded.` : `This fingerprint isn't recorded on ${where}.`;
    if (snapshot) matches = false;
  } else {
    const when = new Date(anchor.timestampMs).toISOString();
    if (snapshot) {
      matches = anchor.caseId === snapshot.decisionId && anchor.version === snapshot.version && anchor.kind === snapshot.kind;
      message = matches
        ? `Match: this exact decision was recorded on ${where} by ${anchor.recordedBy} at ${when}. Nothing in it has changed since.`
        : "The fingerprint is recorded, but under a different decision id, version or kind.";
    } else {
      message = `Recorded on ${where} by ${anchor.recordedBy} at ${when}. Paste the snapshot to check it matches.`;
    }
  }
  return { fingerprint, recorded: !!anchor, anchor, network: ledger.network, contractId: ledger.contractId ?? null, matches, message };
}

export function errorResponse(err: unknown): Response {
  console.error("request error:", err instanceof Error ? err.name : "unknown");
  if (err instanceof LedgerError) return Response.json({ error: err.userMessage }, { status: err.status });
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

/**
 * Decision history: every run's memo, the numbers it was given, its snapshot, fingerprint and
 * whether it was recorded on the ledger. Kept in Postgres when POSTGRES_URL or DATABASE_URL is set
 * (Vercel's Neon or Supabase integration sets one), and in memory otherwise, which resets when the
 * server restarts. Only decision memos are kept, never chat transcripts.
 *
 * Every read and write is scoped to an owner: a NEAR account that proved itself with a signed
 * message, a browser, a Slack user or an API key. Nobody can list or open someone else's runs.
 */
import type { AnyMemo, DecisionSnapshot } from "./engine/snapshot";
import type { GivenValue, Memo } from "./engine/types";
import type { RecordResult } from "./ledger";

type Env = Record<string, string | undefined>;

export type HistorySource = "web" | "slack" | "api" | "mcp";

export interface RecordedInfo {
  network: string;
  by: string;
  atMs: number;
  txUrl: string | null;
}

export interface HistoryEntry {
  id: string;
  owner: string;
  decisionId: string;
  version: number;
  /** The run this one was re-run from, with changed numbers. */
  parentId: string | null;
  source: HistorySource;
  createdAt: string;
  updatedAt: string;
  title: string;
  question: string;
  option: string | null;
  headline: string;
  status: Memo["status"];
  fingerprint: string;
  verifyUrl: string;
  recorded: RecordedInfo | null;
  inputs: Record<string, GivenValue>;
  memo: AnyMemo;
  snapshot: DecisionSnapshot;
}

export type HistorySummary = Omit<HistoryEntry, "memo" | "snapshot" | "inputs">;

export interface ListOptions {
  limit?: number;
  decisionId?: string;
}

export interface HistoryStore {
  kind: "postgres" | "memory";
  /** Inserts, or replaces the run with the same id and owner. */
  save(entry: HistoryEntry): Promise<void>;
  list(owner: string, opts?: ListOptions): Promise<HistorySummary[]>;
  get(owner: string, id: string): Promise<HistoryEntry | null>;
  remove(owner: string, id: string): Promise<boolean>;
  /** Marks every run with this fingerprint as recorded. */
  markRecorded(fingerprint: string, recorded: RecordedInfo): Promise<number>;
  /** The next free version number for a decision id, for this owner. */
  nextVersion(owner: string, decisionId: string): Promise<number>;
  /** Moves runs from one owner to another, e.g. a browser's runs to the NEAR account that signed in on it. */
  moveOwner(from: string, to: string): Promise<number>;
}

export const MAX_LIST = 100;

export function toSummary(e: HistoryEntry): HistorySummary {
  const { memo: _m, snapshot: _s, inputs: _i, ...rest } = e;
  return rest;
}

export function recordedFrom(r: RecordResult | null | undefined): RecordedInfo | null {
  if (!r) return null;
  return { network: r.network, by: r.anchor.recordedBy, atMs: r.anchor.timestampMs, txUrl: r.explorerUrl ?? null };
}

export function newRunId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return "run_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function makeEntry(args: {
  id?: string;
  owner: string;
  source: HistorySource;
  parentId?: string | null;
  inputs: Record<string, GivenValue | undefined>;
  memo: AnyMemo;
  snapshot: DecisionSnapshot;
  fingerprint: string;
  verifyUrl: string;
  recorded?: RecordedInfo | null;
  question?: string;
  now?: Date;
}): HistoryEntry {
  const now = (args.now ?? new Date()).toISOString();
  const inputs: Record<string, GivenValue> = {};
  for (const [k, v] of Object.entries(args.inputs)) if (v !== undefined) inputs[k] = v;
  return {
    id: args.id ?? newRunId(),
    owner: args.owner,
    decisionId: args.snapshot.decisionId,
    version: args.snapshot.version,
    parentId: args.parentId ?? null,
    source: args.source,
    createdAt: now,
    updatedAt: now,
    title: args.memo.title,
    question: (args.question ?? "").slice(0, 4000),
    option: args.memo.recommendation.option,
    headline: args.memo.recommendation.headline,
    status: args.memo.status,
    fingerprint: args.fingerprint,
    verifyUrl: args.verifyUrl,
    recorded: args.recorded ?? null,
    inputs,
    memo: args.memo,
    snapshot: args.snapshot,
  };
}

function clampLimit(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(MAX_LIST, Math.floor(n)));
}

export class MemoryHistory implements HistoryStore {
  kind = "memory" as const;
  private rows = new Map<string, HistoryEntry>();
  private static CAP = 2000;

  async save(entry: HistoryEntry) {
    const prev = this.rows.get(entry.id);
    if (prev && prev.owner !== entry.owner) throw new Error("run id taken");
    const keep = prev && prev.fingerprint === entry.fingerprint && !entry.recorded ? prev.recorded : entry.recorded;
    this.rows.set(entry.id, structuredClone(prev ? { ...entry, createdAt: prev.createdAt, recorded: keep } : entry));
    if (this.rows.size > MemoryHistory.CAP) {
      const oldest = [...this.rows.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
      this.rows.delete(oldest.id);
    }
  }

  async list(owner: string, opts: ListOptions = {}) {
    return [...this.rows.values()]
      .filter((r) => r.owner === owner && (!opts.decisionId || r.decisionId === opts.decisionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version)
      .slice(0, clampLimit(opts.limit))
      .map((r) => structuredClone(toSummary(r)));
  }

  async get(owner: string, id: string) {
    const r = this.rows.get(id);
    return r && r.owner === owner ? structuredClone(r) : null;
  }

  async remove(owner: string, id: string) {
    const r = this.rows.get(id);
    if (!r || r.owner !== owner) return false;
    return this.rows.delete(id);
  }

  async markRecorded(fingerprint: string, recorded: RecordedInfo) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.fingerprint === fingerprint && !r.recorded) {
        r.recorded = { ...recorded };
        r.updatedAt = new Date().toISOString();
        n++;
      }
    }
    return n;
  }

  async nextVersion(owner: string, decisionId: string) {
    let max = 0;
    for (const r of this.rows.values()) if (r.owner === owner && r.decisionId === decisionId) max = Math.max(max, r.version);
    return max + 1;
  }

  async moveOwner(from: string, to: string) {
    let n = 0;
    for (const r of this.rows.values()) if (r.owner === from) (r.owner = to), n++;
    return n;
  }
}

// ---------- Postgres ----------

type Sql = import("postgres").Sql;

const TABLE = "uprali_decisions";

const SCHEMA = `
create table if not exists ${TABLE} (
  id text primary key,
  owner text not null,
  decision_id text not null,
  version integer not null,
  parent_id text,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  question text not null default '',
  option text,
  headline text not null,
  status text not null,
  fingerprint text not null,
  verify_url text not null,
  recorded jsonb,
  inputs jsonb not null,
  memo jsonb not null,
  snapshot jsonb not null
);
create index if not exists ${TABLE}_owner_created on ${TABLE} (owner, created_at desc);
create index if not exists ${TABLE}_fingerprint on ${TABLE} (fingerprint);
create index if not exists ${TABLE}_owner_decision on ${TABLE} (owner, decision_id);
`;

const SUMMARY_COLS = "id, owner, decision_id, version, parent_id, source, created_at, updated_at, title, question, option, headline, status, fingerprint, verify_url, recorded";

interface Row {
  id: string;
  owner: string;
  decision_id: string;
  version: number;
  parent_id: string | null;
  source: HistorySource;
  created_at: Date | string;
  updated_at: Date | string;
  title: string;
  question: string;
  option: string | null;
  headline: string;
  status: Memo["status"];
  fingerprint: string;
  verify_url: string;
  recorded: RecordedInfo | null;
  inputs?: Record<string, GivenValue>;
  memo?: Memo;
  snapshot?: DecisionSnapshot;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

function fromRow(r: Row): HistorySummary {
  return {
    id: r.id,
    owner: r.owner,
    decisionId: r.decision_id,
    version: r.version,
    parentId: r.parent_id,
    source: r.source,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    title: r.title,
    question: r.question,
    option: r.option,
    headline: r.headline,
    status: r.status,
    fingerprint: r.fingerprint,
    verifyUrl: r.verify_url,
    recorded: r.recorded,
  };
}

export class PostgresHistory implements HistoryStore {
  kind = "postgres" as const;
  private ready: Promise<void> | null = null;

  constructor(private sql: Sql) {}

  private init() {
    if (!this.ready) {
      this.ready = this.sql.unsafe(SCHEMA).then(() => undefined);
      this.ready.catch(() => (this.ready = null)); // try again next time
    }
    return this.ready;
  }

  async save(e: HistoryEntry) {
    await this.init();
    const sql = this.sql;
    const res = await sql`
      insert into ${sql(TABLE)} (id, owner, decision_id, version, parent_id, source, created_at, updated_at, title, question, option, headline, status, fingerprint, verify_url, recorded, inputs, memo, snapshot)
      values (${e.id}, ${e.owner}, ${e.decisionId}, ${e.version}, ${e.parentId}, ${e.source}, ${e.createdAt}, ${e.updatedAt}, ${e.title}, ${e.question}, ${e.option}, ${e.headline}, ${e.status}, ${e.fingerprint}, ${e.verifyUrl},
        ${e.recorded ? sql.json(e.recorded as never) : null}, ${sql.json(e.inputs as never)}, ${sql.json(e.memo as never)}, ${sql.json(e.snapshot as never)})
      on conflict (id) do update set
        version = excluded.version, parent_id = excluded.parent_id, updated_at = excluded.updated_at, title = excluded.title, question = excluded.question,
        option = excluded.option, headline = excluded.headline, status = excluded.status, fingerprint = excluded.fingerprint, verify_url = excluded.verify_url,
        recorded = case when excluded.fingerprint = ${sql(TABLE)}.fingerprint then coalesce(excluded.recorded, ${sql(TABLE)}.recorded) else excluded.recorded end, inputs = excluded.inputs, memo = excluded.memo, snapshot = excluded.snapshot
      where ${sql(TABLE)}.owner = excluded.owner
      returning id`;
    if (res.length === 0) throw new Error("run id taken");
  }

  async list(owner: string, opts: ListOptions = {}) {
    await this.init();
    const sql = this.sql;
    const rows = await sql<Row[]>`
      select ${sql.unsafe(SUMMARY_COLS)} from ${sql(TABLE)}
      where owner = ${owner} ${opts.decisionId ? sql`and decision_id = ${opts.decisionId}` : sql``}
      order by created_at desc, version desc
      limit ${clampLimit(opts.limit)}`;
    return rows.map(fromRow);
  }

  async get(owner: string, id: string) {
    await this.init();
    const sql = this.sql;
    const [r] = await sql<Row[]>`select * from ${sql(TABLE)} where id = ${id} and owner = ${owner}`;
    if (!r) return null;
    return { ...fromRow(r), inputs: r.inputs ?? {}, memo: r.memo as AnyMemo, snapshot: r.snapshot as DecisionSnapshot };
  }

  async remove(owner: string, id: string) {
    await this.init();
    const sql = this.sql;
    const res = await sql`delete from ${sql(TABLE)} where id = ${id} and owner = ${owner} returning id`;
    return res.length > 0;
  }

  async markRecorded(fingerprint: string, recorded: RecordedInfo) {
    await this.init();
    const sql = this.sql;
    const res = await sql`
      update ${sql(TABLE)} set recorded = ${sql.json(recorded as never)}, updated_at = now()
      where fingerprint = ${fingerprint} and recorded is null returning id`;
    return res.length;
  }

  async nextVersion(owner: string, decisionId: string) {
    await this.init();
    const sql = this.sql;
    const [r] = await sql<{ v: number | null }[]>`select max(version) as v from ${sql(TABLE)} where owner = ${owner} and decision_id = ${decisionId}`;
    return (r?.v ?? 0) + 1;
  }

  async moveOwner(from: string, to: string) {
    await this.init();
    const sql = this.sql;
    const res = await sql`update ${sql(TABLE)} set owner = ${to} where owner = ${from} returning id`;
    return res.length;
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

export function databaseUrl(env: Env = process.env): string | null {
  return env.POSTGRES_URL || env.DATABASE_URL || env.POSTGRES_PRISMA_URL || null;
}

function needsSsl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode")) return u.searchParams.get("sslmode") !== "disable";
    return !["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  } catch {
    return true;
  }
}

export async function connectPostgres(url: string): Promise<PostgresHistory> {
  const { default: postgres } = await import("postgres");
  // prepare: false so it works through poolers (Supabase's and Neon's) as well as direct.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, ssl: needsSsl(url) ? "require" : false, onnotice: () => {} });
  return new PostgresHistory(sql);
}

const g = globalThis as unknown as { __upraliHistory?: { key: string; store: Promise<HistoryStore> } };

export function getHistory(env: Env = process.env): Promise<HistoryStore> {
  const url = databaseUrl(env);
  const key = url ?? "memory";
  if (!g.__upraliHistory || g.__upraliHistory.key !== key) {
    g.__upraliHistory = { key, store: url ? connectPostgres(url) : Promise.resolve(new MemoryHistory()) };
  }
  return g.__upraliHistory.store;
}

/** Saving history never breaks a decision: a failed save is logged and the run still returns. */
export async function saveQuietly(entry: HistoryEntry, env: Env = process.env): Promise<boolean> {
  try {
    await (await getHistory(env)).save(entry);
    return true;
  } catch (err) {
    console.error("history save failed:", err instanceof Error ? err.message.slice(0, 120) : "unknown");
    return false;
  }
}

export async function markRecordedQuietly(fingerprint: string, recorded: RecordedInfo | null, env: Env = process.env) {
  if (!recorded) return;
  try {
    await (await getHistory(env)).markRecorded(fingerprint, recorded);
  } catch (err) {
    console.error("history update failed:", err instanceof Error ? err.message.slice(0, 120) : "unknown");
  }
}

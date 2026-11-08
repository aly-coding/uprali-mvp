import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnchorKind, LedgerAnchor, RecordResult } from "./types";

export interface RecordArgs {
  hash: string;
  kind: AnchorKind;
  caseId: string;
  version: number;
}

export interface Ledger {
  network: RecordResult["network"];
  /** Account id that signs records, or a label for the demo ledger. */
  recorder: string;
  contractId?: string;
  record(args: RecordArgs): Promise<RecordResult>;
  get(hash: string): Promise<LedgerAnchor | null>;
}

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

/**
 * Off-chain stand-in used when no NEAR contract is configured, so the app runs with zero
 * setup. It behaves like the contract (no overwrites) but proves nothing to a third party.
 */
export class LocalLedger implements Ledger {
  network = "local-demo" as const;
  recorder = "local-demo-ledger";
  private mem = new Map<string, LedgerAnchor>();
  private loaded = false;

  constructor(private file: string | null) {}

  private async load() {
    if (this.loaded || !this.file) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as LedgerAnchor[];
      for (const a of raw) this.mem.set(a.hash, a);
    } catch {
      /* no file yet */
    }
  }

  private async save() {
    if (!this.file) return;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify([...this.mem.values()], null, 2));
    } catch {
      this.file = null; // read-only filesystem (for example on Vercel): keep it in memory
    }
  }

  async record(args: RecordArgs): Promise<RecordResult> {
    await this.load();
    if (this.mem.has(args.hash)) {
      throw new LedgerError("duplicate", "This exact decision is already recorded.", 409);
    }
    const anchor: LedgerAnchor = {
      hash: args.hash,
      kind: args.kind,
      caseId: args.caseId,
      version: args.version,
      recordedBy: this.recorder,
      timestampMs: Date.now(),
    };
    this.mem.set(args.hash, anchor);
    await this.save();
    return { network: this.network, anchor };
  }

  async get(hash: string): Promise<LedgerAnchor | null> {
    await this.load();
    return this.mem.get(hash) ?? null;
  }
}

type Env = Record<string, string | undefined>;

let cached: { key: string; ledger: Ledger } | null = null;

export async function getLedger(rawEnv: Env = process.env): Promise<Ledger> {
  // Settings pasted into Vercel can carry a stray space or line break; NEAR rejects those.
  const t = (v?: string) => v?.trim() || undefined;
  const env: Env = { ...rawEnv, NEAR_CONTRACT_ID: t(rawEnv.NEAR_CONTRACT_ID), NEAR_ACCOUNT_ID: t(rawEnv.NEAR_ACCOUNT_ID), NEAR_PRIVATE_KEY: t(rawEnv.NEAR_PRIVATE_KEY), NEAR_RPC_URL: t(rawEnv.NEAR_RPC_URL), NEAR_NETWORK: t(rawEnv.NEAR_NETWORK) };
  const key = [env.NEAR_CONTRACT_ID, env.NEAR_ACCOUNT_ID, env.NEAR_RPC_URL, env.LOCAL_LEDGER_PATH].join("|");
  if (cached && cached.key === key) return cached.ledger;
  let ledger: Ledger;
  if (env.NEAR_CONTRACT_ID) {
    const { NearLedger } = await import("./near");
    ledger = new NearLedger({
      contractId: env.NEAR_CONTRACT_ID,
      accountId: env.NEAR_ACCOUNT_ID,
      privateKey: env.NEAR_PRIVATE_KEY,
      rpcUrl: env.NEAR_RPC_URL || "https://test.rpc.fastnear.com",
      network: env.NEAR_NETWORK || "testnet",
    });
  } else {
    ledger = new LocalLedger(env.LOCAL_LEDGER_PATH || path.join(process.cwd(), ".data", "ledger.json"));
  }
  cached = { key, ledger };
  return ledger;
}

export type { AnchorKind, LedgerAnchor, RecordResult } from "./types";

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import type { Ledger, RecordArgs } from "./index";
import { LedgerError } from "./index";
import type { LedgerAnchor, RecordResult } from "../types";

interface ContractAnchor {
  hash: string;
  kind: LedgerAnchor["kind"];
  case_id: string;
  version: number;
  recorded_by: string;
  timestamp_ms: number;
  block_height: number;
}

export function fromContract(a: ContractAnchor): LedgerAnchor {
  return {
    hash: a.hash,
    kind: a.kind,
    caseId: a.case_id,
    version: a.version,
    recordedBy: a.recorded_by,
    timestampMs: a.timestamp_ms,
    blockHeight: a.block_height,
  };
}

export function explorerTxUrl(network: string, txHash: string): string {
  return network === "mainnet" ? `https://nearblocks.io/txns/${txHash}` : `https://testnet.nearblocks.io/txns/${txHash}`;
}

/**
 * Records fingerprints on the uprali-ledger contract (contract/). The server signs with a
 * relayer account, so finance users never need a wallet: the plan's "Google first, wallet optional".
 */
export class NearLedger implements Ledger {
  network = "near-testnet" as const;
  recorder: string;
  contractId: string;
  private provider: JsonRpcProvider;
  private account: Account | null;
  private net: string;

  constructor(opts: { contractId: string; accountId?: string; privateKey?: string; rpcUrl: string; network: string }) {
    if (opts.network === "mainnet") {
      throw new LedgerError("mainnet refused", "This MVP only writes to NEAR testnet.", 500);
    }
    this.net = opts.network;
    this.contractId = opts.contractId;
    this.recorder = opts.accountId ?? "(read-only)";
    this.provider = new JsonRpcProvider({ url: opts.rpcUrl });
    this.account =
      opts.accountId && opts.privateKey
        ? new Account(opts.accountId, this.provider, opts.privateKey as KeyPairString)
        : null;
  }

  async record(args: RecordArgs): Promise<RecordResult> {
    if (!this.account) {
      throw new LedgerError("no signer", "Recording needs NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY on the server.", 500);
    }
    const existing = await this.get(args.hash);
    if (existing) throw new LedgerError("duplicate", "This exact decision is already recorded.", 409);

    let res;
    try {
      res = await this.account.callFunctionRaw({
        contractId: this.contractId,
        methodName: "record",
        args: { hash: args.hash, kind: args.kind, case_id: args.caseId, version: args.version },
        gas: teraToGas("30"),
      });
    } catch (err) {
      throw new LedgerError(String(err), "NEAR testnet didn't accept the record. Check the relayer account and try again.", 502);
    }
    const txHash = res.transaction_outcome?.id ?? res.transaction?.hash;
    const status = res.status as unknown;
    if (status && typeof status === "object" && "Failure" in status) {
      throw new LedgerError(JSON.stringify(status), "The ledger contract rejected the record.", 502);
    }
    let anchor: LedgerAnchor | null = null;
    if (status && typeof status === "object" && "SuccessValue" in status) {
      const b64 = (status as { SuccessValue: string }).SuccessValue;
      try {
        anchor = fromContract(JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ContractAnchor);
      } catch {
        anchor = null;
      }
    }
    anchor ??= await this.get(args.hash);
    if (!anchor) throw new LedgerError("missing after write", "The record was sent but couldn't be read back yet.", 502);
    return { network: this.network, anchor, txHash, explorerUrl: txHash ? explorerTxUrl(this.net, txHash) : undefined };
  }

  async get(hash: string): Promise<LedgerAnchor | null> {
    try {
      const a = (await this.provider.callFunction({
        contractId: this.contractId,
        method: "get",
        args: { hash },
      })) as unknown as ContractAnchor | null | undefined;
      return a ? fromContract(a) : null;
    } catch (err) {
      throw new LedgerError(String(err), "Couldn't read the NEAR ledger right now.", 502);
    }
  }
}

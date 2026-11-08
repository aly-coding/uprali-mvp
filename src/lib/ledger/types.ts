export type AnchorKind = "decision" | "approval" | "outcome_review";

export interface LedgerAnchor {
  hash: string;
  kind: AnchorKind;
  caseId: string;
  version: number;
  recordedBy: string;
  timestampMs: number;
  blockHeight?: number;
}

export interface RecordResult {
  network: "near-testnet" | "local-demo";
  anchor: LedgerAnchor;
  txHash?: string;
  explorerUrl?: string;
}

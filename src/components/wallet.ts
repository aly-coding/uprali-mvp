"use client";

/**
 * NEAR wallet sign-in for the demo screen, on testnet only. Signing in creates a key that may
 * only call the ledger's `record` method with no deposit, so recording a decision costs the
 * person nothing and asks for no extra approval.
 */
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";

export interface WalletConfig {
  networkId: "testnet";
  contractId: string;
}

export interface WalletHandle {
  selector: WalletSelector;
  modal: WalletSelectorModal;
  contractId: string;
}

export async function initWallet(cfg: WalletConfig): Promise<WalletHandle> {
  const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/my-near-wallet"),
  ]);
  const selector = await setupWalletSelector({
    network: cfg.networkId,
    modules: [setupMyNearWallet()],
    createAccessKeyFor: { contractId: cfg.contractId, methodNames: ["record"] },
  });
  const modal = setupModal(selector, {
    contractId: cfg.contractId,
    methodNames: ["record"],
    description: "Sign in with a NEAR testnet account. Uprali only asks to record decision fingerprints, never to move money.",
  });
  return { selector, modal, contractId: cfg.contractId };
}

export function signedInAccount(w: WalletHandle): string | null {
  const accounts = w.selector.store.getState().accounts;
  return accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null;
}

export async function signOut(w: WalletHandle): Promise<void> {
  const wallet = await w.selector.wallet();
  await wallet.signOut();
}

/** Records the fingerprint from the person's own account, so the ledger shows them as recorded_by. */
export async function recordWithWallet(
  w: WalletHandle,
  args: { hash: string; kind: string; caseId: string; version: number },
): Promise<{ txHash: string | null }> {
  const { actionCreators } = await import("@near-js/transactions");
  const wallet = await w.selector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: w.contractId,
    actions: [
      actionCreators.functionCall(
        "record",
        { hash: args.hash, kind: args.kind, case_id: args.caseId, version: args.version },
        BigInt("30000000000000"),
        BigInt(0),
      ),
    ],
  });
  const o = outcome as { transaction_outcome?: { id?: string }; transaction?: { hash?: string }; status?: unknown } | void;
  if (o && o.status && typeof o.status === "object" && "Failure" in o.status) {
    throw new Error("The ledger contract rejected the record. It may already be recorded.");
  }
  return { txHash: (o && (o.transaction_outcome?.id ?? o.transaction?.hash)) || null };
}

export function explorerTx(txHash: string): string {
  return `https://testnet.nearblocks.io/txns/${txHash}`;
}

export function explorerAccount(accountId: string): string {
  return `https://testnet.nearblocks.io/address/${accountId}`;
}

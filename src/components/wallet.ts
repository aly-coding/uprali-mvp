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
  /** The ledger contract. Leave it out on the setup page, before the contract exists. */
  contractId?: string;
}

export interface WalletHandle {
  selector: WalletSelector;
  modal: WalletSelectorModal;
  contractId: string | null;
}

/** Intear and Meteor both still work on testnet (MyNearWallet's testnet is retired). */
export async function initWallet(cfg: WalletConfig): Promise<WalletHandle> {
  const [{ setupWalletSelector }, { setupModal }, { setupIntearWallet }, { setupMeteorWallet }] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/meteor-wallet"),
  ]);
  const selector = await setupWalletSelector({
    network: cfg.networkId,
    modules: [setupIntearWallet(), setupMeteorWallet()],
    ...(cfg.contractId ? { createAccessKeyFor: { contractId: cfg.contractId, methodNames: ["record"] } } : {}),
  });
  const modal = setupModal(selector, {
    ...(cfg.contractId ? { contractId: cfg.contractId, methodNames: ["record"] } : {}),
    description: cfg.contractId
      ? "Sign in with a NEAR testnet account. Uprali only asks to record decision fingerprints, never to move money."
      : "Sign in with the NEAR testnet account that will own the Uprali ledger.",
  });
  return { selector, modal, contractId: cfg.contractId ?? null };
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
  if (!w.contractId) throw new Error("No ledger contract is set up yet.");
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

"use client";

/**
 * NEAR wallet sign-in, with a mainnet (name.near) or a testnet (name.testnet) account. The
 * decision ledger is on testnet. On testnet, signing in creates a key that may only call the
 * ledger's `record` method with no deposit, so recording costs the person nothing. A mainnet
 * account can't sign on testnet, so it signs a free sign-in message instead and the server's
 * relayer records the fingerprint of the decision made in its name.
 */
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { explorerAccountUrl, isWalletNetwork, type WalletNetwork } from "@/lib/nearNetwork";

export interface WalletConfig {
  networkId: WalletNetwork;
  /** The testnet ledger contract. Leave it out on the setup page, before the contract exists, and on mainnet. */
  contractId?: string;
}

export interface WalletHandle {
  selector: WalletSelector;
  modal: WalletSelectorModal;
  networkId: WalletNetwork;
  /** The ledger contract this wallet can record on itself: only on testnet. */
  contractId: string | null;
}

const NETWORK_KEY = "uprali:wallet-network";

/** The network the person picked last time. Mainnet by default, since most people have a .near account. */
export function chosenNetwork(): WalletNetwork {
  try {
    const v = localStorage.getItem(NETWORK_KEY);
    if (isWalletNetwork(v)) return v;
  } catch {
    /* storage off */
  }
  return "mainnet";
}

/** Switches the network. The wallet selector holds one network per page, so the page reloads. */
export async function switchNetwork(w: WalletHandle | null, next: WalletNetwork): Promise<void> {
  if (w && w.networkId === next) return;
  if (w && signedInAccount(w)) await signOut(w).catch(() => undefined);
  await endHistorySession();
  try {
    localStorage.setItem(NETWORK_KEY, next);
  } catch {
    /* storage off: stays on the default */
  }
  window.location.reload();
}

/** The wallet setup for a page, from /api/config's `wallet` (the testnet ledger) and the person's chosen network. */
export function walletConfigFor(ledger: { contractId: string } | null, network: WalletNetwork = chosenNetwork()): WalletConfig {
  return network === "testnet" && ledger ? { networkId: "testnet", contractId: ledger.contractId } : { networkId: network };
}

/** Intear and Meteor work on both networks; MyNearWallet on mainnet only (its testnet is retired). */
export async function initWallet(cfg: WalletConfig): Promise<WalletHandle> {
  const [{ setupWalletSelector }, { setupModal }, { setupIntearWallet }, { setupMeteorWallet }, { setupMyNearWallet }] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/my-near-wallet"),
  ]);
  const contractId = cfg.networkId === "testnet" ? cfg.contractId : undefined;
  const selector = await setupWalletSelector({
    network: cfg.networkId,
    modules: [setupIntearWallet(), setupMeteorWallet(), ...(cfg.networkId === "mainnet" ? [setupMyNearWallet()] : [])],
    ...(contractId ? { createAccessKeyFor: { contractId, methodNames: ["record"] } } : {}),
  });
  const modal = setupModal(selector, {
    ...(contractId ? { contractId, methodNames: ["record"] } : {}),
    description:
      cfg.networkId === "mainnet"
        ? "Sign in with your NEAR account (name.near). Uprali asks for one free signed message to confirm it's you, never to move money."
        : contractId
          ? "Sign in with a NEAR testnet account (name.testnet). Uprali only asks to record decision fingerprints, never to move money."
          : "Sign in with the NEAR testnet account that will own the Uprali ledger.",
  });
  return { selector, modal, networkId: cfg.networkId, contractId: contractId ?? null };
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
  if (w.networkId !== "testnet") throw new Error("Only a testnet wallet can sign on the testnet ledger. Mainnet accounts record through Uprali's relayer.");
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

export function explorerAccount(accountId: string, network?: WalletNetwork): string {
  return explorerAccountUrl(accountId, network);
}

/**
 * Proves to the server that this browser holds the account's full-access key, by signing a
 * sign-in message (NEP-413). Nothing is sent to the chain and nothing is spent. The server
 * then keeps this account's decision history and moves this browser's runs into it.
 */
export async function confirmHistorySignIn(w: WalletHandle): Promise<{ account: string; moved: number }> {
  const info = await fetch("/api/app/session").then((r) => r.json());
  const { message, recipient, nonce } = info.signIn as { message: string; recipient: string; nonce: string };
  const wallet = await w.selector.wallet();
  if (!("signMessage" in wallet) || typeof wallet.signMessage !== "function") throw new Error("This wallet can't sign a sign-in message. Try Meteor or Intear.");
  // Wallets read the nonce as bytes; a Uint8Array works where the types ask for a Buffer.
  const bytes = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
  const signed = await wallet.signMessage({ message, recipient, nonce: bytes as unknown as Buffer });
  if (!signed) throw new Error("The wallet didn't return a signature.");
  const res = await fetch("/api/app/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce, network: w.networkId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't confirm the sign-in.");
  return data;
}

export async function endHistorySession(): Promise<void> {
  await fetch("/api/app/session", { method: "DELETE" }).catch(() => undefined);
}

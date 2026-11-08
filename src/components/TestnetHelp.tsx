"use client";

/**
 * Picking the network to sign in on. Both work: a mainnet account (name.near) or a testnet one
 * (name.testnet). The ledger is on testnet; testnet accounts sign the record themselves, and
 * mainnet accounts have Uprali's relayer record a decision made in their name.
 */
import { accountNetwork, type WalletNetwork } from "@/lib/nearNetwork";
import { chosenNetwork, switchNetwork, type WalletHandle } from "./wallet";

/** A name ending in .near is a mainnet account. */
export function isMainnetAccount(accountId: string | null | undefined): boolean {
  return accountNetwork(accountId) === "mainnet";
}

export function NetworkPicker({ wallet }: { wallet: WalletHandle | null }) {
  const current = wallet?.networkId ?? chosenNetwork();
  const options: Array<{ id: WalletNetwork; label: string }> = [
    { id: "mainnet", label: "My account ends in .near" },
    { id: "testnet", label: "My account ends in .testnet" },
  ];
  return (
    <div className="row small network-picker" role="radiogroup" aria-label="NEAR network">
      {options.map((o) => (
        <label key={o.id} className="chip">
          <input
            type="radio"
            name="near-network"
            checked={current === o.id}
            onChange={() => void switchNetwork(wallet, o.id)}
          />{" "}
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function NetworkNote({ network }: { network: WalletNetwork }) {
  return network === "mainnet" ? (
    <p className="muted small">
      With a .near account you sign one free message to confirm it&apos;s you. Your decisions are signed in your name, and Uprali&apos;s relayer records
      their fingerprints on the NEAR testnet ledger for you. Nothing moves money.
    </p>
  ) : (
    <details className="testnet-help">
      <summary>No .testnet account yet? Make a free one in a minute</summary>
      <ol className="plain small">
        <li>Open <a href="https://wallet.near.org" target="_blank" rel="noreferrer">wallet.near.org</a> and pick <strong>Intear Wallet</strong> (Meteor works too).</li>
        <li>Switch the wallet to <strong>testnet</strong> and create a name that ends in <strong>.testnet</strong>. It&apos;s free.</li>
        <li>Save the recovery phrase it shows you.</li>
        <li>Come back here and press <strong>Connect NEAR wallet</strong>.</li>
      </ol>
      <p className="muted small">Or pick <strong>My account ends in .near</strong> above to use the account you already have.</p>
    </details>
  );
}

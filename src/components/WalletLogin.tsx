"use client";

/**
 * The NEAR wallet log-in that stands in front of the app on the live site: the network choice,
 * then one button per wallet, and the wallet selector's own pop-up for anything else.
 */
import { useState } from "react";
import { NetworkNote, NetworkPicker } from "./TestnetHelp";
import { chosenNetwork, connectWith, walletOptions, type WalletHandle } from "./wallet";

export function WalletLogin({ wallet, failed = false }: { wallet: WalletHandle | null; failed?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const options = wallet ? walletOptions(wallet) : [];

  async function go(id: string, name: string) {
    if (!wallet) return;
    setBusy(id);
    setError("");
    try {
      await connectWith(wallet, id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Closing the wallet's window counts as a no, not an error.
      if (!/reject|cancel|closed|denied/i.test(msg)) setError(`Couldn't open ${name}. Try another wallet, or More wallets below.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wallet-login">
      <p className="wallet-login-title"><strong>Log in with your NEAR wallet</strong></p>
      <NetworkPicker wallet={wallet} />
      {failed ? (
        <p className="error">Couldn&apos;t load NEAR wallet log-in. Reload the page to try again.</p>
      ) : !wallet ? (
        <p className="muted">Loading NEAR wallets…</p>
      ) : (
        <div className="wallet-options" role="list">
          {options.map((o) => (
            <button key={o.id} type="button" role="listitem" className="wallet-option" onClick={() => void go(o.id, o.name)} disabled={busy !== null}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.iconUrl} alt="" width={28} height={28} />
              <span>{busy === o.id ? `Opening ${o.name}…` : o.name}</span>
              {!o.available && <span className="muted small">Not installed</span>}
            </button>
          ))}
          <button type="button" className="link small" onClick={() => wallet.modal.show()} disabled={busy !== null}>More wallets</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <NetworkNote network={wallet?.networkId ?? chosenNetwork()} />
    </div>
  );
}

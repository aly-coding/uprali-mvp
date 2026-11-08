"use client";

/**
 * One-time owner setup, with no terminal: the owner signs in with their NEAR testnet wallet and
 * approves one request that creates two sub-accounts of theirs:
 *   ledger.<owner>   holds the ledger contract. This page deploys it with a one-use key, then deletes
 *                    that key, so nobody (the owner included) can change the contract afterwards.
 *   relayer.<owner>  records for agents and for the access-code fallback. Its only key can call the
 *                    ledger's `record` method and nothing else, with a small gas allowance.
 * The keys are made in this browser and never sent anywhere; the relayer key is shown once to paste
 * into Vercel. Testnet only.
 */
import { useEffect, useRef, useState } from "react";
import {
  LEDGER_FUND_NEAR,
  NEEDED_NEAR,
  RELAYER_ALLOWANCE_NEAR,
  RELAYER_FUND_NEAR,
  envBlock,
  randomCode,
  setupNames,
  yoctoToNear,
} from "@/lib/setup";
import { explorerAccount, initWallet, signedInAccount, signOut, type WalletHandle } from "./wallet";

const RPC = "https://test.rpc.fastnear.com";
const STORE = "uprali:setup:v1";
const EMPTY_CODE = "11111111111111111111111111111111";

interface Saved {
  owner: string;
  ledgerId: string;
  relayerId: string;
  deployKey: string | null; // deleted from the ledger account (and from here) once the contract is in
  relayerKey: string;
  accessCode: string;
  apiKey: string;
  created: boolean;
  deployed: boolean;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage off: the page still works in one go */
  }
}

async function nearApi() {
  const n = await import("near-api-js");
  return { ...n, provider: new n.JsonRpcProvider({ url: RPC }) };
}

/** null when the account doesn't exist yet. */
async function viewAccount(accountId: string) {
  const { provider } = await nearApi();
  try {
    return await provider.viewAccount({ accountId });
  } catch {
    return null;
  }
}

async function waitForAccount(accountId: string, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const a = await viewAccount(accountId);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export default function Setup() {
  const [configured, setConfigured] = useState<string | null | undefined>(undefined);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [ledgerPrefix, setLedgerPrefix] = useState("ledger");
  const [relayerPrefix, setRelayerPrefix] = useState("relayer");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSaved(load());
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (c: { wallet: { contractId: string } | null }) => {
        setConfigured(c.wallet?.contractId ?? null);
        if (c.wallet) return;
        try {
          const w = await initWallet({ networkId: "testnet" });
          setWallet(w);
          setAccount(signedInAccount(w));
          const sub = w.selector.store.observable.subscribe(() => setAccount(signedInAccount(w)));
          unsub.current = () => sub.unsubscribe();
        } catch {
          setError("Couldn't load NEAR wallet sign-in. Reload the page and try again.");
        }
      })
      .catch(() => setError("Couldn't reach the Uprali server."));
    return () => unsub.current?.();
  }, []);

  useEffect(() => {
    setBalance(null);
    if (account) refreshBalance(account);
  }, [account]);

  async function refreshBalance(acct: string) {
    const a = await viewAccount(acct);
    setBalance(a ? yoctoToNear(a.amount) : 0);
  }

  const names = account ? setupNames(account, ledgerPrefix, relayerPrefix) : null;

  async function create() {
    if (!wallet || !names || "error" in names) return;
    setError("");
    try {
      const { KeyPair } = await nearApi();
      const { actionCreators } = await import("@near-js/transactions");
      const { PublicKey } = await import("@near-js/crypto");
      const { nearToYocto } = await import("near-api-js");

      let s = saved && saved.owner === names.owner && saved.ledgerId === names.ledgerId ? saved : null;
      if (!s) {
        const [l, r] = await Promise.all([viewAccount(names.ledgerId), viewAccount(names.relayerId)]);
        if (l || r) {
          throw new Error(`${l ? names.ledgerId : names.relayerId} already exists. Change the name above and try again.`);
        }
        s = {
          ...names,
          deployKey: KeyPair.fromRandom("ed25519").toString(),
          relayerKey: KeyPair.fromRandom("ed25519").toString(),
          accessCode: randomCode(10),
          apiKey: `upk_${randomCode(32)}`,
          created: false,
          deployed: false,
        };
        save(s);
        setSaved(s);
      }

      if (!s.created) {
        setBusy("Approve the request in your wallet…");
        const deployPub = PublicKey.fromString(KeyPair.fromString(s.deployKey as `ed25519:${string}`).getPublicKey().toString());
        const relayerPub = PublicKey.fromString(KeyPair.fromString(s.relayerKey as `ed25519:${string}`).getPublicKey().toString());
        const w = await wallet.selector.wallet();
        await w.signAndSendTransactions({
          transactions: [
            {
              receiverId: s.ledgerId,
              actions: [
                actionCreators.createAccount(),
                actionCreators.transfer(nearToYocto(LEDGER_FUND_NEAR)),
                actionCreators.addKey(deployPub, actionCreators.fullAccessKey()),
              ],
            },
            {
              receiverId: s.relayerId,
              actions: [
                actionCreators.createAccount(),
                actionCreators.transfer(nearToYocto(RELAYER_FUND_NEAR)),
                actionCreators.addKey(
                  relayerPub,
                  actionCreators.functionCallAccessKey(s.ledgerId, ["record"], nearToYocto(RELAYER_ALLOWANCE_NEAR)),
                ),
              ],
            },
          ],
        });
        setBusy("Waiting for NEAR testnet…");
        const [l, r] = await Promise.all([waitForAccount(s.ledgerId), waitForAccount(s.relayerId)]);
        if (!l || !r) throw new Error("The wallet sent the request, but the new accounts haven't shown up yet. Wait a minute and press the button again.");
        s = { ...s, created: true };
        save(s);
        setSaved(s);
      }

      if (!s.deployed) {
        await deploy(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Press the button again; it picks up where it stopped.");
    } finally {
      setBusy("");
      if (account) refreshBalance(account);
    }
  }

  async function deploy(s: Saved) {
    const { Account, KeyPair, actions, teraToGas, provider } = await nearApi();
    const ledger = await viewAccount(s.ledgerId);
    if (ledger && ledger.code_hash !== EMPTY_CODE) {
      const owner = await provider.callFunction({ contractId: s.ledgerId, method: "owner", args: {} }).catch(() => null);
      if (owner !== s.owner) throw new Error(`${s.ledgerId} already has a contract that isn't yours. Change the name above.`);
    } else {
      if (!s.deployKey) throw new Error("The setup key is gone from this browser. Change the ledger name above and start again.");
      setBusy("Putting the ledger contract on testnet…");
      const res = await fetch("/uprali_ledger.wasm");
      if (!res.ok) throw new Error("Couldn't load the ledger contract file from this site.");
      const code = new Uint8Array(await res.arrayBuffer());
      const acct = new Account(s.ledgerId, provider, s.deployKey as `ed25519:${string}`);
      const deployPub = KeyPair.fromString(s.deployKey as `ed25519:${string}`).getPublicKey();
      await acct.signAndSendTransaction({
        receiverId: s.ledgerId,
        actions: [
          actions.deployContract(code),
          actions.functionCall("new", { owner: s.owner }, teraToGas("100"), 0n),
          actions.deleteKey(deployPub), // locks the contract: no key can change it now
        ],
      });
      const owner = await provider.callFunction({ contractId: s.ledgerId, method: "owner", args: {} });
      if (owner !== s.owner) throw new Error("The contract went in, but its owner doesn't read back right. Tell your engineer.");
    }
    const done = { ...s, deployKey: null, deployed: true };
    save(done);
    setSaved(done);
  }

  async function copyAll() {
    if (!saved) return;
    await navigator.clipboard.writeText(envBlock({ contractId: saved.ledgerId, relayerId: saved.relayerId, relayerKey: saved.relayerKey, accessCode: saved.accessCode, apiKey: saved.apiKey }));
    setCopied(true);
  }

  async function finish() {
    save(null);
    setSaved(null);
    if (wallet) await signOut(wallet).catch(() => undefined);
  }

  if (configured === undefined) return <main className="page"><p className="muted">Loading…</p></main>;

  if (configured) {
    return (
      <main className="page">
        <section className="card">
          <h1>Ledger already set up</h1>
          <p>This site records decisions on <a href={explorerAccount(configured)} target="_blank" rel="noreferrer">{configured}</a> on NEAR testnet. There's nothing to do here.</p>
          <p><a className="btn" href="/">Go to Uprali</a></p>
        </section>
      </main>
    );
  }

  const ready = saved?.deployed;
  const enough = balance !== null && balance >= NEEDED_NEAR;

  return (
    <main className="page setup">
      <section className="card">
        <h1>Set up the NEAR testnet ledger</h1>
        <p className="muted">One time, about two minutes. Testnet tokens are free and have no value. Nothing here touches mainnet or real money.</p>

        <h2>1. Sign in with your wallet</h2>
        {account ? (
          <p>
            Signed in as <strong>{account}</strong>.{" "}
            {balance === null ? "Checking balance…" : <>It has <strong>{balance.toFixed(2)} testnet NEAR</strong>.</>}{" "}
            {!ready && <button className="btn small" onClick={() => wallet && signOut(wallet)}>Use another account</button>}
          </p>
        ) : (
          <p><button className="btn primary" disabled={!wallet} onClick={() => wallet?.modal.show()}>Sign in with NEAR wallet</button> <span className="muted">Pick Intear Wallet (or Meteor).</span></p>
        )}
        {account && balance !== null && !enough && !ready && (
          <p className="warn">
            Setup needs about {NEEDED_NEAR} testnet NEAR. Get free testnet NEAR from the faucet in your wallet, or at{" "}
            <a href="https://near-faucet.io" target="_blank" rel="noreferrer">near-faucet.io</a>, then{" "}
            <button className="btn small" onClick={() => refreshBalance(account)}>check again</button>.
          </p>
        )}

        {account && !ready && (
          <>
            <h2>2. Create the ledger</h2>
            {names && "error" in names ? (
              <p className="warn">{names.error}</p>
            ) : names ? (
              <ul className="plain">
                <li><strong>{names.ledgerId}</strong> holds the decision ledger. It gets {LEDGER_FUND_NEAR} NEAR and is locked after setup, so nobody can change it.</li>
                <li><strong>{names.relayerId}</strong> records for agents and for the no-wallet fallback. Its key can only record, with up to {RELAYER_ALLOWANCE_NEAR} NEAR of fees.</li>
              </ul>
            ) : null}
            <details>
              <summary>Change the names</summary>
              <div className="fields">
                <label>Ledger <input value={ledgerPrefix} onChange={(e) => setLedgerPrefix(e.target.value.trim().toLowerCase())} disabled={!!saved?.created} /></label>
                <label>Relayer <input value={relayerPrefix} onChange={(e) => setRelayerPrefix(e.target.value.trim().toLowerCase())} disabled={!!saved?.created} /></label>
              </div>
            </details>
            <p>
              <button className="btn primary" disabled={!!busy || !enough || !names || "error" in names} onClick={create}>
                {saved?.created ? "Finish setup" : "Create the ledger"}
              </button>{" "}
              {busy && <span className="muted">{busy}</span>}
            </p>
            <p className="muted">Your wallet asks you to approve one request that creates both accounts.</p>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {ready && saved && (
          <>
            <h2>3. Paste these into Vercel</h2>
            <p>
              The ledger is live: <a href={explorerAccount(saved.ledgerId)} target="_blank" rel="noreferrer">{saved.ledgerId}</a>.
              Copy these six lines now. The relayer key is only shown here, in this browser.
            </p>
            <pre className="envblock">{envBlock({ contractId: saved.ledgerId, relayerId: saved.relayerId, relayerKey: saved.relayerKey, accessCode: saved.accessCode, apiKey: saved.apiKey })}</pre>
            <p><button className="btn primary" onClick={copyAll}>{copied ? "Copied" : "Copy all six"}</button></p>
            <ol>
              <li>In Vercel, open the project, then <strong>Settings</strong>, then <strong>Environment Variables</strong>.</li>
              <li>Click into the first <strong>Key</strong> box and paste. Vercel splits the six lines into six rows. Keep <strong>Production</strong> ticked and press <strong>Save</strong>.</li>
              <li>Open <strong>Deployments</strong>, open the menu on the top one and press <strong>Redeploy</strong>.</li>
              <li>Write down the access code <strong>{saved.accessCode}</strong>. It lets you record a decision in the demo without a wallet.</li>
            </ol>
            <p><button className="btn" onClick={finish}>I&apos;ve saved them in Vercel</button> <span className="muted">This clears the key from this browser and signs you out.</span></p>
          </>
        )}
      </section>
    </main>
  );
}

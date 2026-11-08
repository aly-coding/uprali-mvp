"use client";

/**
 * One-time owner setup, with no terminal and no testnet NEAR of the owner's own. NEAR's testnet
 * faucet service creates and funds two accounts (through /api/setup/sponsor, which passes on
 * only public keys):
 *   uprali-ledger-<code>.testnet   holds the ledger contract. This page deploys it with the
 *                                  account's only key, then deletes that key, so nobody (the
 *                                  owner included) can change the contract afterwards.
 *   uprali-relayer-<code>.testnet  records for agents and for the access-code fallback. This page
 *                                  swaps its first key for one that can only call the ledger's
 *                                  `record` method, with a gas allowance.
 * The owner's wallet account (for example uprali.testnet) becomes the ledger's owner and is only
 * used to sign in. The keys are made in this browser and never sent anywhere; the relayer key is
 * shown once to paste into Vercel. Testnet only.
 */
import { useEffect, useRef, useState } from "react";
import {
  LEDGER_MIN_NEAR,
  RELAYER_ALLOWANCE_NEAR,
  envBlock,
  randomCode,
  sponsoredNames,
  validOwner,
  yoctoToNear,
} from "@/lib/setup";
import { explorerAccount, initWallet, signedInAccount, signOut, type WalletHandle } from "./wallet";

const RPC = "https://test.rpc.fastnear.com";
const STORE = "uprali:setup:v2";
const EMPTY_CODE = "11111111111111111111111111111111";

interface Saved {
  owner: string;
  ledgerId: string;
  relayerId: string;
  ledgerKey: string | null; // the ledger's only key; deleted from the account (and from here) once the contract is in
  relayerSetupKey: string | null; // the relayer's first key; swapped for relayerKey, then forgotten
  relayerKey: string;
  accessCode: string;
  apiKey: string;
  ledgerCreated: boolean;
  relayerCreated: boolean;
  relayerLocked: boolean;
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

async function waitForAccount(accountId: string, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const a = await viewAccount(accountId);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Has NEAR's faucet create and fund the account with this public key, unless it already exists. */
async function sponsorAccount(accountId: string, secretKey: string) {
  if (await viewAccount(accountId)) return;
  const { KeyPair } = await nearApi();
  const publicKey = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
  const res = await fetch("/api/setup/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, publicKey }) });
  const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!out?.ok) throw new Error(out?.error || "NEAR's faucet didn't create the account. Press the button again.");
  if (!(await waitForAccount(accountId))) throw new Error("NEAR's faucet accepted the request, but the account hasn't shown up yet. Wait a minute and press the button again.");
}

export default function Setup() {
  const [configured, setConfigured] = useState<string | null | undefined>(undefined);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [ownerInput, setOwnerInput] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState<{ names: string[]; deploy: string | null } | null>(null);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    const s = load();
    setSaved(s);
    if (s) setOwnerInput(s.owner);
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (c: { wallet: { contractId: string } | null; ledgerMissing?: string[]; deploy?: string | null }) => {
        setConfigured(c.wallet?.contractId ?? null);
        setMissing({ names: c.ledgerMissing ?? [], deploy: c.deploy ?? null });
        if (c.wallet) return;
        try {
          const w = await initWallet({ networkId: "testnet" });
          setWallet(w);
          setAccount(signedInAccount(w));
          const sub = w.selector.store.observable.subscribe(() => setAccount(signedInAccount(w)));
          unsub.current = () => sub.unsubscribe();
        } catch {
          /* sign-in is optional here: the owner can type their account name */
        }
      })
      .catch(() => setError("Couldn't reach the Uprali server."));
    return () => unsub.current?.();
  }, []);

  useEffect(() => {
    if (account && !saved) setOwnerInput(account);
  }, [account, saved]);

  const owner = validOwner(ownerInput);

  async function create() {
    if (!owner) return;
    setError("");
    try {
      const { KeyPair } = await nearApi();
      let s = saved && saved.owner === owner ? saved : null;
      if (!s) {
        const names = sponsoredNames(randomCode(8));
        s = {
          owner,
          ...names,
          ledgerKey: KeyPair.fromRandom("ed25519").toString(),
          relayerSetupKey: KeyPair.fromRandom("ed25519").toString(),
          relayerKey: KeyPair.fromRandom("ed25519").toString(),
          accessCode: randomCode(10),
          apiKey: `upk_${randomCode(32)}`,
          ledgerCreated: false,
          relayerCreated: false,
          relayerLocked: false,
          deployed: false,
        };
        save(s);
        setSaved(s);
      }
      const step = (next: Saved) => {
        save(next);
        setSaved(next);
        return next;
      };

      if (!s.ledgerCreated) {
        if (!s.ledgerKey) throw new Error("The setup key is gone from this browser. Press Start over and try again.");
        setBusy("Asking NEAR's faucet to create the ledger account…");
        await sponsorAccount(s.ledgerId, s.ledgerKey);
        s = step({ ...s, ledgerCreated: true });
      }
      if (!s.relayerCreated) {
        if (!s.relayerSetupKey) throw new Error("The setup key is gone from this browser. Press Start over and try again.");
        setBusy("Asking NEAR's faucet to create the relayer account…");
        await sponsorAccount(s.relayerId, s.relayerSetupKey);
        s = step({ ...s, relayerCreated: true });
      }
      if (!s.relayerLocked) {
        await lockRelayer(s);
        s = step({ ...s, relayerSetupKey: null, relayerLocked: true });
      }
      if (!s.deployed) {
        await deploy(s);
        step({ ...s, ledgerKey: null, deployed: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Press the button again; it picks up where it stopped.");
    } finally {
      setBusy("");
    }
  }

  /** Swaps the relayer's first (full) key for one that can only call the ledger's `record`. */
  async function lockRelayer(s: Saved) {
    const { Account, KeyPair, actions, nearToYocto, provider } = await nearApi();
    if (!s.relayerSetupKey) throw new Error("The setup key is gone from this browser. Press Start over and try again.");
    setBusy("Limiting the relayer's key to recording only…");
    const setupKey = KeyPair.fromString(s.relayerSetupKey as `ed25519:${string}`);
    const relayerPub = KeyPair.fromString(s.relayerKey as `ed25519:${string}`).getPublicKey();
    // Already swapped (for example, the page closed right after): nothing to do.
    const has = await provider.viewAccessKey({ accountId: s.relayerId, publicKey: relayerPub.toString() }).then(() => true).catch(() => false);
    if (has) return;
    const acct = new Account(s.relayerId, provider, s.relayerSetupKey as `ed25519:${string}`);
    await acct.signAndSendTransaction({
      receiverId: s.relayerId,
      actions: [
        actions.addFunctionCallAccessKey(relayerPub, s.ledgerId, ["record"], nearToYocto(RELAYER_ALLOWANCE_NEAR)),
        actions.deleteKey(setupKey.getPublicKey()),
      ],
    });
  }

  async function deploy(s: Saved) {
    const { Account, KeyPair, actions, teraToGas, provider } = await nearApi();
    const ledger = await viewAccount(s.ledgerId);
    if (!ledger) throw new Error(`${s.ledgerId} isn't on testnet. Press Start over and try again.`);
    if (ledger.code_hash !== EMPTY_CODE) {
      const o = await provider.callFunction({ contractId: s.ledgerId, method: "owner", args: {} }).catch(() => null);
      if (o !== s.owner) throw new Error(`${s.ledgerId} already has a contract that isn't yours. Press Start over.`);
      return;
    }
    if (yoctoToNear(ledger.amount) < LEDGER_MIN_NEAR) {
      throw new Error(`NEAR's faucet gave the ledger only ${yoctoToNear(ledger.amount)} NEAR, and the contract needs about ${LEDGER_MIN_NEAR}. Tell your engineer.`);
    }
    if (!s.ledgerKey) throw new Error("The setup key is gone from this browser. Press Start over and try again.");
    setBusy("Putting the ledger contract on testnet…");
    const res = await fetch("/uprali_ledger.wasm");
    if (!res.ok) throw new Error("Couldn't load the ledger contract file from this site.");
    const code = new Uint8Array(await res.arrayBuffer());
    const acct = new Account(s.ledgerId, provider, s.ledgerKey as `ed25519:${string}`);
    const ledgerPub = KeyPair.fromString(s.ledgerKey as `ed25519:${string}`).getPublicKey();
    await acct.signAndSendTransaction({
      receiverId: s.ledgerId,
      actions: [
        actions.deployContract(code),
        actions.functionCall("new", { owner: s.owner }, teraToGas("100"), 0n),
        actions.deleteKey(ledgerPub), // locks the contract: no key can change it now
      ],
    });
    const o = await provider.callFunction({ contractId: s.ledgerId, method: "owner", args: {} });
    if (o !== s.owner) throw new Error("The contract went in, but its owner doesn't read back right. Tell your engineer.");
  }

  function startOver() {
    save(null);
    setSaved(null);
    setError("");
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

  return (
    <main className="page setup">
      <section className="card">
        <h1>Set up the NEAR testnet ledger</h1>
        <p className="muted">One time, about two minutes. You don&apos;t need any testnet NEAR: NEAR&apos;s faucet creates and funds the two accounts. Nothing here touches mainnet or real money.</p>

        {missing && missing.names.length > 0 && (
          <div className="warn">
            <p>
              <strong>This {missing.deploy ? `${missing.deploy} ` : ""}deploy doesn&apos;t have these settings yet:</strong> {missing.names.join(", ")}.
            </p>
            <p>
              If you already pasted them in Vercel, open each one there and check that <strong>Production</strong> (and <strong>Preview</strong>) is ticked, that it&apos;s the project this site runs on, and then press <strong>Redeploy</strong>. A setting only reaches the site after a redeploy. If you no longer have the six lines, press <strong>Start over with new accounts</strong> below, or run the steps again.
            </p>
          </div>
        )}

        <h2>1. Who owns the ledger</h2>
        {account ? (
          <p>Signed in as <strong>{account}</strong>. {!ready && wallet && <button className="btn small" onClick={() => signOut(wallet)}>Use another account</button>}</p>
        ) : (
          <p>{wallet && <><button className="btn" onClick={() => wallet.modal.show()}>Sign in with NEAR wallet</button> <span className="muted">or type your testnet account:</span></>}</p>
        )}
        <div className="fields">
          <label>Owner account <input value={ownerInput} placeholder="yourname.testnet" onChange={(e) => setOwnerInput(e.target.value.trim().toLowerCase())} disabled={!!saved?.ledgerCreated || !!busy} /></label>
        </div>
        {ownerInput && !owner && <p className="warn">Use a NEAR testnet account name, one that ends in .testnet.</p>}

        {!ready && (
          <>
            <h2>2. Create the ledger</h2>
            {saved && (
              <ul className="plain">
                <li><strong>{saved.ledgerId}</strong> holds the decision ledger. It&apos;s locked after setup, so nobody can change it.</li>
                <li><strong>{saved.relayerId}</strong> records for agents and for the no-wallet fallback. Its key can only record, with up to {RELAYER_ALLOWANCE_NEAR} NEAR of fees.</li>
              </ul>
            )}
            <p>
              <button className="btn primary" disabled={!!busy || !owner} onClick={create}>
                {saved?.ledgerCreated ? "Finish setup" : "Create the ledger"}
              </button>{" "}
              {busy && <span className="muted">{busy}</span>}
            </p>
            <p className="muted">No wallet request to approve. If it stops partway, press the button again and it picks up where it stopped.</p>
            {saved && !busy && <p><button className="btn small" onClick={startOver}>Start over with new accounts</button></p>}
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
              <li>Click into the first <strong>Key</strong> box and paste. Vercel splits the six lines into six rows. Under <strong>Environments</strong>, tick <strong>Production</strong> and <strong>Preview</strong> (Development is optional), then press <strong>Save</strong>.</li>
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

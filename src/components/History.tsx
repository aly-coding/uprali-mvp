"use client";

import { useCallback, useEffect, useState } from "react";
import type { Memo } from "@/lib/engine/types";
import type { DecisionSnapshot } from "@/lib/engine/snapshot";
import type { RecordedInfo } from "@/lib/history";
import { MemoView, PrivateAiBadge } from "./MemoView";
import { CaseMemoView } from "./CaseView";
import type { CaseMemo } from "@/lib/engine/caseDecide";
import { confirmHistorySignIn, endHistorySession, initWallet, signedInAccount, signOut, walletConfigFor, type WalletHandle } from "./wallet";
import { NetworkPicker } from "./TestnetHelp";

interface Summary {
  id: string;
  decisionId: string;
  version: number;
  parentId: string | null;
  source: string;
  createdAt: string;
  title: string;
  question: string;
  option: string | null;
  headline: string;
  status: Memo["status"];
  fingerprint: string;
  verifyUrl: string;
  recorded: RecordedInfo | null;
}

interface Entry extends Summary {
  memo: Memo | CaseMemo;
  snapshot: DecisionSnapshot;
}

interface ListResponse {
  account: string | null;
  storage: "postgres" | "memory";
  storageNote: string;
  privacyNote: string;
  decisions: Summary[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const SOURCE: Record<string, string> = { web: "App", slack: "Slack", api: "API", mcp: "Agent" };

function Status({ s }: { s: Summary }) {
  if (s.recorded) return <span className="badge human">Recorded on {s.recorded.network === "near-testnet" ? "NEAR" : "demo ledger"}</span>;
  if (s.status === "needs_human") return <span className="badge gap">Needs numbers</span>;
  return <span className="badge assume">Not recorded</span>;
}

function idFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id");
}

export function History() {
  const [list, setList] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [walletCfg, setWalletCfg] = useState<{ networkId: "testnet"; contractId: string } | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [versions, setVersions] = useState<Summary[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/app/history?limit=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load your history.");
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your history.");
    }
  }, []);

  useEffect(() => {
    load();
    setOpenId(idFromUrl());
    const onPop = () => setOpenId(idFromUrl());
    window.addEventListener("popstate", onPop);
    let unsub: (() => void) | null = null;
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (c: { wallet: { networkId: "testnet"; contractId: string } | null }) => {
        if (!c.wallet) return;
        setWalletCfg(c.wallet);
        const w = await initWallet(walletConfigFor(c.wallet));
        setWallet(w);
        setWalletAccount(signedInAccount(w));
        const sub = w.selector.store.observable.subscribe(() => setWalletAccount(signedInAccount(w)));
        unsub = () => sub.unsubscribe();
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener("popstate", onPop);
      unsub?.();
    };
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setEntry(null);
      return;
    }
    setEntry(null);
    fetch(`/api/app/history/${encodeURIComponent(openId)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Couldn't open that decision.");
        setEntry(data.decision);
        setVersions(data.versions || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't open that decision."));
  }, [openId]);

  function open(id: string | null) {
    setError("");
    window.history.pushState(null, "", id ? `/history?id=${encodeURIComponent(id)}` : "/history");
    setOpenId(id);
    window.scrollTo(0, 0);
  }

  async function confirm() {
    if (!wallet) return;
    setBusy("signin");
    setError("");
    try {
      await confirmHistorySignIn(wallet);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't confirm the sign-in.");
    } finally {
      setBusy("");
    }
  }

  async function leave() {
    await endHistorySession();
    if (wallet && walletAccount) await signOut(wallet).catch(() => undefined);
    await load();
  }

  async function check(id: string) {
    setBusy("check");
    setError("");
    try {
      const res = await fetch(`/api/app/history/${encodeURIComponent(id)}/check`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't check the ledger.");
      if (!data.recorded) setError("Not on the ledger yet. Record it from the decision screen, or re-run it.");
      if (entry) setEntry({ ...entry, recorded: data.recorded });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the ledger.");
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this decision from your history? Its fingerprint stays on the ledger.")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/app/history/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Couldn't delete it.");
      open(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete it.");
    } finally {
      setBusy("");
    }
  }

  const account = list?.account ?? null;
  const unconfirmed = walletAccount && walletAccount !== account;

  const whoBar = (
    <div className="who">
      {account ? (
        <>
          History for <strong>{account}</strong>
          <button className="btn small" onClick={leave}>Sign out</button>
        </>
      ) : unconfirmed ? (
        <>
          Signed in as <strong>{walletAccount}</strong>. <span className="muted">Confirm it's you so your history follows your account to any device. It's a free signature, nothing goes on chain.</span>
          <button className="btn small primary" onClick={confirm} disabled={busy !== ""}>{busy === "signin" ? "Waiting for the wallet…" : "Confirm it's you"}</button>
        </>
      ) : (
        <>
          History for <strong>this browser</strong>
          {walletCfg && (
            <>
              <NetworkPicker wallet={wallet} />
              <button className="btn small" onClick={() => wallet?.modal.show()} disabled={!wallet}>Sign in with NEAR wallet</button>
            </>
          )}
        </>
      )}
    </div>
  );

  if (openId) {
    return (
      <main className="page">
        {whoBar}
        <p><button className="link" onClick={() => open(null)}>← All decisions</button></p>
        {error && <p className="error">{error}</p>}
        {!entry ? (
          !error && <p className="muted">Loading…</p>
        ) : (
          <div className="layout">
            <section className="card result">
              <p className="muted small">
                {entry.decisionId} · version {entry.version} · {when(entry.createdAt)} · from {SOURCE[entry.source] ?? entry.source}
              </p>
              {entry.question && <p className="spoken">“{entry.question}”</p>}
              <PrivateAiBadge memo={entry.memo} />
              {entry.memo.schema === "uprali.case.v1" ? <CaseMemoView memo={entry.memo} /> : <MemoView memo={entry.memo} />}
            </section>
            <section className="card ask">
              <h2>Proof</h2>
              <p className="small">Fingerprint <code className="mono">{entry.fingerprint}</code></p>
              {entry.recorded ? (
                <p>
                  ✓ Recorded on {entry.recorded.network === "near-testnet" ? "NEAR testnet" : "the local demo ledger"} by <strong>{entry.recorded.by}</strong>,{" "}
                  {when(new Date(entry.recorded.atMs).toISOString())}.
                  {entry.recorded.txUrl && <> <a href={entry.recorded.txUrl} target="_blank" rel="noreferrer">See the transaction on the NEAR explorer</a>.</>}
                </p>
              ) : (
                <p className="muted">Not recorded yet.</p>
              )}
              <div className="row">
                <a
                  className="btn primary"
                  href={`/verify?hash=${entry.fingerprint}`}
                  onClick={() => {
                    // Hand the verify page this decision's snapshot, so it can show Match and the try-to-cheat check.
                    try {
                      localStorage.setItem(`uprali:snapshot:${entry.fingerprint}`, JSON.stringify(entry.snapshot));
                    } catch {
                      /* storage off: the page still checks the fingerprint */
                    }
                  }}
                >
                  Verify
                </a>
                {!entry.recorded && <button className="btn" onClick={() => check(entry.id)} disabled={busy !== ""}>{busy === "check" ? "Checking…" : "Check the ledger"}</button>}
              </div>
              <h2>Change the numbers</h2>
              <p className="muted small">Re-running keeps this decision's id and saves the result as version {Math.max(...versions.map((v) => v.version), entry.version) + 1}. This version stays as it is.</p>
              <a className="btn primary" href={`/?from=${encodeURIComponent(entry.id)}`}>Re-run with new numbers</a>
              {versions.length > 1 && (
                <>
                  <h2>Versions</h2>
                  <ul className="plain">
                    {versions.map((v) => (
                      <li key={v.id}>
                        {v.id === entry.id ? <strong>v{v.version}</strong> : <button className="link" onClick={() => open(v.id)}>v{v.version}</button>} · {when(v.createdAt)} · {v.headline}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p><button className="link" onClick={() => remove(entry.id)} disabled={busy !== ""}>Delete from history</button></p>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="page">
      {whoBar}
      <section className="card">
        <h1>Your <span className="scribble">decisions</span></h1>
        {list && (
          <p className="muted small">
            {list.privacyNote} {list.storageNote}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {!list ? (
          !error && <p className="muted">Loading…</p>
        ) : list.decisions.length === 0 ? (
          <p>
            No decisions yet. <a href="/">Run one</a> and it shows up here.
          </p>
        ) : (
          <table className="inputs history">
            <thead>
              <tr>
                <th>When</th>
                <th>Question</th>
                <th>Recommendation</th>
                <th>Proof</th>
              </tr>
            </thead>
            <tbody>
              {list.decisions.map((d) => (
                <tr key={d.id} onClick={() => open(d.id)} style={{ cursor: "pointer" }}>
                  <td className="small">{when(d.createdAt)}<br /><span className="muted">{SOURCE[d.source] ?? d.source}{d.version > 1 ? ` · v${d.version}` : ""}</span></td>
                  <td>
                    <button className="link" onClick={(e) => (e.stopPropagation(), open(d.id))}>{(d.question || d.title).slice(0, 140)}</button>
                  </td>
                  <td><span className={`verdict ${d.option ?? ""}`}>{d.headline}</span></td>
                  <td><Status s={d} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

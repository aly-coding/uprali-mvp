"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FIELDS } from "@/lib/engine/buildVsBuy";
import { canonicalJson, sha256Hex, type DecisionSnapshot } from "@/lib/engine/snapshot";
import type { Memo } from "@/lib/engine/types";
import { MemoView, PrivateAiBadge } from "./MemoView";
import { confirmHistorySignIn, endHistorySession, explorerAccount, explorerTx, initWallet, recordWithWallet, signedInAccount, signOut, type WalletHandle } from "./wallet";

interface Config {
  providers: string[];
  privateModel: string | null;
  ledger: { network: string; contractId: string | null };
  wallet: { networkId: "testnet"; contractId: string } | null;
  relayerCodeEnabled: boolean;
}

interface Result {
  runId: string | null;
  parentId: string | null;
  memo: Memo;
  snapshot: DecisionSnapshot;
  fingerprint: string;
  verifyUrl: string;
}

interface Recorded {
  by: string;
  txUrl: string | null;
  verifyUrl: string;
  network: string;
}

const EXAMPLE =
  "Should we build our own CRM or keep paying for HubSpot? We pay $720 a year for HubSpot Starter. Our engineer built a working prototype in 3 weeks. It would need 2 integrations, email and billing.";

const MAIN_FIELDS = ["tool_name", "buy_annual_cost", "prototype_weeks", "engineer_weekly_cost"];

export function saveSnapshotLocally(fingerprint: string, snapshot: DecisionSnapshot) {
  try {
    localStorage.setItem(`uprali:snapshot:${fingerprint}`, JSON.stringify(snapshot));
  } catch {
    /* storage off: the download button still works */
  }
}

export function DecideApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [question, setQuestion] = useState(EXAMPLE);
  const [values, setValues] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<"" | "deciding" | "recording">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [code, setCode] = useState("");
  const [historyAccount, setHistoryAccount] = useState<string | null>(null);
  const [parent, setParent] = useState<{ id: string; version: number; title: string } | null>(null);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch("/api/app/session")
      .then((r) => r.json())
      .then((s: { account: string | null }) => setHistoryAccount(s.account))
      .catch(() => undefined);
    // "Re-run with new numbers" from the History page: load that run's question and numbers.
    const from = new URLSearchParams(window.location.search).get("from");
    if (from) {
      fetch(`/api/app/history/${encodeURIComponent(from)}`)
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Couldn't load that decision.");
          const d = data.decision as { id: string; version: number; title: string; question: string; inputs: Record<string, { value?: unknown }> };
          const top = Math.max(d.version, ...((data.versions as { version: number }[]) || []).map((v) => v.version));
          setParent({ id: d.id, version: top, title: d.title });
          setQuestion(d.question || "");
          const vals: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.inputs || {})) {
            const raw = v && typeof v === "object" && "value" in v ? v.value : v;
            if (raw !== null && raw !== undefined && (typeof raw === "number" || typeof raw === "string")) vals[k] = String(raw);
          }
          setValues(vals);
          if (Object.keys(vals).some((k) => !MAIN_FIELDS.includes(k))) setMore(true);
          setDemo(true);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load that decision."));
    }
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (c: Config) => {
        setConfig(c);
        if (!c.wallet) return;
        try {
          const w = await initWallet(c.wallet);
          setWallet(w);
          setAccount(signedInAccount(w));
          const sub = w.selector.store.observable.subscribe(() => setAccount(signedInAccount(w)));
          unsub.current = () => sub.unsubscribe();
        } catch {
          setError("Couldn't load NEAR wallet sign-in. You can still continue in demo mode.");
        }
      })
      .catch(() => setError("Couldn't reach the Uprali server."));
    return () => unsub.current?.();
  }, []);

  const who = account ?? (demo ? "demo-user" : null);
  const fields = useMemo(() => FIELDS.filter((f) => (more ? true : MAIN_FIELDS.includes(f.key))), [more]);

  async function run() {
    setBusy("deciding");
    setError("");
    setResult(null);
    setRecorded(null);
    const inputs: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(values)) {
      const v = raw.trim();
      if (!v) continue;
      const f = FIELDS.find((x) => x.key === k);
      const n = Number(v.replace(/[$,\s]/g, ""));
      const value = f?.unit === "text" || !Number.isFinite(n) ? v : n;
      inputs[k] = { value, owner: "human", is_assumption: false, source: `Entered by ${who} in Uprali` };
    }
    try {
      const res = await fetch("/api/app/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, inputs, decided_by: who, ...(parent ? { parent_id: parent.id } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The analyst couldn't run.");
      // Re-hash in the browser so the fingerprint doesn't rest on the server's word.
      const local = await sha256Hex(canonicalJson(data.snapshot));
      if (local !== data.fingerprint) throw new Error("The fingerprint didn't match the snapshot. Not recording this.");
      saveSnapshotLocally(data.fingerprint, data.snapshot);
      setResult(data);
      if (parent && data.parentId) setParent({ ...parent, version: data.snapshot.version });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  async function record() {
    if (!result) return;
    setBusy("recording");
    setError("");
    const s = result.snapshot;
    try {
      if (wallet && account) {
        const { txHash } = await recordWithWallet(wallet, { hash: result.fingerprint, kind: s.kind, caseId: s.decisionId, version: s.version });
        setRecorded({ by: account, txUrl: txHash ? explorerTx(txHash) : null, verifyUrl: result.verifyUrl, network: "NEAR testnet" });
        // Let the history see it on the ledger. The server looks the fingerprint up itself.
        if (result.runId) {
          fetch(`/api/app/history/${encodeURIComponent(result.runId)}/check`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ txHash }),
          }).catch(() => undefined);
        }
      } else {
        const res = await fetch("/api/app/record", {
          method: "POST",
          headers: { "content-type": "application/json", ...(code ? { "x-access-code": code } : {}) },
          body: JSON.stringify({ snapshot: s }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't record the decision.");
        setRecorded({
          by: data.anchor.recordedBy,
          txUrl: data.explorerUrl ?? null,
          verifyUrl: data.verifyUrl,
          network: data.network === "near-testnet" ? "NEAR testnet" : "the local demo ledger",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record the decision.");
    } finally {
      setBusy("");
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.snapshot, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${result.memo.decisionId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!config) return <main className="page"><p className="muted">Loading…</p>{error && <p className="error">{error}</p>}</main>;

  if (!who) {
    return (
      <main className="page narrow">
        <section className="card signin">
          <h1>Build or buy, decided in a minute</h1>
          <p>
            Uprali works out what it really costs to build a tool in-house versus keep paying for one. Every number shows where it came from and
            whether a person or an agent stands behind it. The model runs privately on NEAR AI Cloud, and the decision's fingerprint goes on NEAR.
          </p>
          {config.wallet ? (
            <button className="btn primary big" onClick={() => wallet?.modal.show()} disabled={!wallet}>
              Sign in with NEAR wallet
            </button>
          ) : (
            <p className="muted small">NEAR wallet sign-in turns on once the ledger is on testnet. Owner? <a href="/setup">Set it up</a>.</p>
          )}
          <button className="btn" onClick={() => setDemo(true)}>Continue in demo mode</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="who">
        {account ? (
          <>
            Signed in as <a href={explorerAccount(account)} target="_blank" rel="noreferrer"><strong>{account}</strong></a>
            <button className="btn small" onClick={async () => { if (wallet) await signOut(wallet); await endHistorySession(); setHistoryAccount(null); }}>Sign out</button>
            {historyAccount !== account && (
              <button
                className="btn small"
                title="A free signature, nothing goes on chain. Your runs then follow your account to any device."
                onClick={async () => {
                  if (!wallet) return;
                  setError("");
                  try {
                    const r = await confirmHistorySignIn(wallet);
                    setHistoryAccount(r.account);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't confirm the sign-in.");
                  }
                }}
              >
                Keep history under {account}
              </button>
            )}
          </>
        ) : (
          <>Demo mode <span className="muted">
            {config.wallet
              ? config.relayerCodeEnabled
                ? "(recording on NEAR testnet needs a wallet sign-in or the access code)"
                : "(sign in with a NEAR wallet to record on testnet)"
              : "(decisions are recorded on the local demo ledger)"}
          </span>
            {config.wallet && <button className="btn small" onClick={() => wallet?.modal.show()}>Sign in with NEAR wallet</button>}
          </>
        )}
      </div>

      <div className="layout">
        <section className="card ask">
          <h2>The decision</h2>
          {parent && (
            <p className="small">
              Re-running <strong>{parent.title}</strong>. The result is saved as a new version; <a href={`/history?id=${encodeURIComponent(parent.id)}`}>the earlier one</a> stays as it was.
            </p>
          )}
          <textarea className="input" rows={5} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <p className="muted small">Say what you know in plain words. Numbers you type below win over the text, and count as yours.</p>
          <div className="fields">
            {fields.map((f) => (
              <label key={f.key}>
                <span>{f.label}</span>
                <input
                  className="input"
                  placeholder={typeof f.benchmark === "number" ? `benchmark ${f.benchmark}` : f.unit === "text" ? "" : "unknown"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  title={f.ask}
                />
              </label>
            ))}
          </div>
          <button className="link" onClick={() => setMore(!more)}>{more ? "Fewer numbers" : "More numbers (upkeep, security, on-call, turnover…)"}</button>
          <button className="btn primary big" onClick={run} disabled={busy !== "" || question.trim().length < 5}>
            {busy === "deciding" ? "Working it out…" : "Run the decision"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card result">
          {!result ? (
            <p className="muted">The memo appears here: the recommendation, the full {3}-year cost, and every number with its source and owner.</p>
          ) : (
            <>
              <p className="muted small">
                {result.runId ? (
                  <>Saved to <a href={`/history?id=${encodeURIComponent(result.runId)}`}>your history</a>{result.snapshot.version > 1 ? ` as version ${result.snapshot.version}` : ""}.</>
                ) : (
                  "Couldn't save this run to your history."
                )}
              </p>
              <PrivateAiBadge memo={result.memo} />
              <MemoView memo={result.memo} />
              <div className="proof">
                <h3>Proof on NEAR</h3>
                <p className="small">
                  Fingerprint <code>{result.fingerprint}</code>
                </p>
                <p className="muted small">
                  Only this fingerprint, the decision id and version go on chain. The numbers and the question never leave this page and the server's memory.
                </p>
                {recorded ? (
                  <div className="recorded">
                    <p>
                      ✓ Recorded on {recorded.network} by <strong>{recorded.by}</strong>.
                    </p>
                    <p className="row">
                      {recorded.txUrl && <a href={recorded.txUrl} target="_blank" rel="noreferrer">See the transaction</a>}
                      <a href={recorded.verifyUrl}>Verify this decision</a>
                      <button className="btn small" onClick={download}>Download snapshot</button>
                    </p>
                  </div>
                ) : result.memo.status === "needs_human" ? (
                  <p className="muted">Fill in the numbers marked "Needs a human" before recording.</p>
                ) : (
                  <div className="row">
                    {!account && config.wallet && config.relayerCodeEnabled && (
                      <input className="input code" placeholder="Demo access code" value={code} onChange={(e) => setCode(e.target.value)} />
                    )}
                    <button className="btn primary" onClick={record} disabled={busy !== ""}>
                      {busy === "recording" ? "Recording…" : account ? `Sign and record as ${account}` : "Record decision"}
                    </button>
                    <button className="btn" onClick={download}>Download snapshot</button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

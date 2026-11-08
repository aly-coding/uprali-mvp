"use client";

import { useEffect, useState } from "react";
import { canonicalJson, sha256Hex, validateSnapshot } from "@/lib/engine/snapshot";
import type { LedgerAnchor } from "@/lib/ledger/types";

interface Result {
  fingerprint: string;
  recorded: boolean;
  anchor: LedgerAnchor | null;
  network: string;
  contractId: string | null;
  matches: boolean | null;
  message: string;
}

/**
 * Anyone, such as an auditor, can check a decision against the ledger. Paste or load the snapshot
 * and its fingerprint is worked out in this browser, so the check doesn't rest on Uprali's word.
 */
export default function Verify() {
  const [text, setText] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);

  async function check(snapshotText: string, fp: string) {
    setBusy(true);
    setError("");
    setResult(null);
    setLocalHash(null);
    try {
      let snapshot: unknown;
      if (snapshotText.trim()) {
        try {
          snapshot = JSON.parse(snapshotText);
        } catch {
          throw new Error("That isn't valid JSON. Paste the snapshot file exactly as it was downloaded.");
        }
        if (!validateSnapshot(snapshot)) throw new Error("That isn't an Uprali decision snapshot.");
        setLocalHash(await sha256Hex(canonicalJson(snapshot)));
      }
      const res = await fetch("/api/v1/decisions/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot, fingerprint: fp.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't check that.");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check that.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = params.get("hash") || "";
    if (params.get("sample") === "1") {
      // The judge path: load the sample's snapshot from the server, then check it here.
      fetch("/api/sample")
        .then((r) => r.json())
        .then((data) => {
          const snap = JSON.stringify(data.decision.snapshot, null, 2);
          setFingerprint(data.decision.fingerprint);
          setText(snap);
          void check(snap, data.decision.fingerprint);
        })
        .catch(() => setError("Couldn't load the sample decision."));
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(hash)) return;
    setFingerprint(hash);
    let saved = "";
    try {
      saved = localStorage.getItem(`uprali:snapshot:${hash}`) || "";
    } catch {
      /* storage off */
    }
    if (saved) setText(JSON.stringify(JSON.parse(saved), null, 2));
    void check(saved, hash);
  }, []);

  /** Makes building look $50,000 cheaper in the snapshot, then checks again: the fingerprint no longer matches. */
  function tamper() {
    try {
      const snap = JSON.parse(text);
      if (snap.totals && typeof snap.totals.build === "number") snap.totals.build -= 50_000;
      else snap.title = `${snap.title} (edited)`;
      const changed = JSON.stringify(snap, null, 2);
      setOriginal(text);
      setText(changed);
      void check(changed, fingerprint);
    } catch {
      setError("The snapshot isn't valid JSON.");
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
  }

  const a = result?.anchor;
  const explorer = result?.network === "near-testnet" && result.contractId ? `https://testnet.nearblocks.io/address/${result.contractId}` : null;
  const tone = !result ? "" : result.matches === true ? "ok" : result.matches === false ? "bad" : result.recorded ? "ok" : "bad";

  return (
    <main className="page narrow">
      <section className="card">
        <h1>Verify a decision</h1>
        <p className="muted">
          Paste a decision snapshot, load its file, or give just its fingerprint. With the snapshot, this page proves nothing in it changed after it
          was recorded.
        </p>
        <label className="stack">
          <span>Fingerprint (SHA-256)</span>
          <input className="input mono" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="64 characters" />
        </label>
        <label className="stack">
          <span>Decision snapshot (JSON)</span>
          <textarea className="input mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"schema":"uprali.decision.v2", …}' />
        </label>
        <div className="row">
          <input type="file" accept="application/json,.json" onChange={(e) => loadFile(e.target.files?.[0])} />
          <button className="btn primary" disabled={busy || (!text.trim() && !fingerprint.trim())} onClick={() => check(text, fingerprint)}>
            {busy ? "Checking…" : "Check"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {(result?.recorded || original !== null) && text.trim() && (
          <p className="row">
            {original === null ? (
              <button className="btn" onClick={tamper} disabled={busy}>Try to cheat: make building $50,000 cheaper</button>
            ) : (
              <button className="btn" disabled={busy} onClick={() => { const t = original; setOriginal(null); setText(t); void check(t, fingerprint); }}>Put the real snapshot back</button>
            )}
          </p>
        )}
        {result && (
          <div className={`verdict-box ${tone}`}>
            <p><strong>{result.matches === true ? "Match." : result.matches === false ? "No match." : result.recorded ? "Recorded." : "Not recorded."}</strong> {result.message}</p>
            {localHash && <p className="small muted">Fingerprint worked out in your browser: <code>{localHash}</code></p>}
            {a && (
              <ul className="small">
                <li>Recorded by: <strong>{a.recordedBy}</strong></li>
                <li>When: {new Date(a.timestampMs).toLocaleString()}</li>
                <li>Decision: {a.caseId}, version {a.version}, {a.kind}</li>
                {a.blockHeight !== undefined && <li>Block: {a.blockHeight}</li>}
                {explorer && <li><a href={explorer} target="_blank" rel="noreferrer">Ledger contract on NEAR testnet</a></li>}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { LedgerAnchor } from "@/lib/types";
import { hashSnapshot, validateSnapshot } from "@/lib/snapshot";

interface Result {
  hash: string;
  found: boolean;
  anchor: LedgerAnchor | null;
  network: string;
  contractId: string | null;
}

/** Anyone, such as an auditor, can check a decision snapshot against the ledger. The hash is computed in their browser. */
export default function Verify() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(hash: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ledger/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      const data = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't check the ledger.");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the ledger.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("hash");
    if (h && /^[0-9a-f]{64}$/.test(h)) void check(h);
  }, []);

  async function verifyText(raw: string) {
    const t = raw.trim();
    if (/^[0-9a-f]{64}$/.test(t)) return check(t);
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return setError("Paste a decision snapshot (JSON) or a 64-character fingerprint.");
    }
    if (!validateSnapshot(parsed)) return setError("That JSON isn't an Uprali decision snapshot.");
    await check(await hashSnapshot(parsed));
  }

  return (
    <div className="page">
      <section className="panel">
        <h2>Verify a decision</h2>
        <p>
          Drop in the snapshot file you downloaded when the decision was recorded, or paste its fingerprint. The fingerprint is computed here in your browser and looked up on the ledger. If even one number in the snapshot changed, it won't match.
        </p>
        <div className="stack">
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const t = await f.text();
              setText(t);
              await verifyText(t);
            }}
          />
          <textarea className="input" rows={8} placeholder="Snapshot JSON or fingerprint" value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => verifyText(text)}>
              {busy ? "Checking…" : "Verify"}
            </button>
          </div>
        </div>
        {error && <div className="notice bad">{error}</div>}
        {result && (
          <div className={`notice ${result.found ? "good" : "bad"}`} style={{ marginTop: 12 }}>
            {result.found && result.anchor ? (
              <>
                <b>Match.</b> This {result.anchor.kind.replace("_", " ")} for case {result.anchor.caseId}, version {result.anchor.version}, was recorded{" "}
                {new Date(result.anchor.timestampMs).toLocaleString()} by {result.anchor.recordedBy}
                {result.network === "near-testnet" ? ` on NEAR testnet (contract ${result.contractId}, block ${result.anchor.blockHeight}).` : " on the local demo ledger, which is not on chain."}
              </>
            ) : (
              <>
                <b>No match.</b> Either this decision was never recorded, or the snapshot was changed after it was recorded.
              </>
            )}
            <div className="hash" style={{ marginTop: 6 }}>
              {result.hash}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

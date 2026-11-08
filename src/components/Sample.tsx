"use client";

import { useEffect, useState } from "react";
import type { Memo } from "@/lib/engine/types";
import type { DecisionSnapshot } from "@/lib/engine/snapshot";
import type { RecordedInfo } from "@/lib/history";
import { MemoView, PrivateAiBadge } from "./MemoView";

interface SampleDecision {
  question: string;
  memo: Memo;
  snapshot: DecisionSnapshot;
  fingerprint: string;
  verifyUrl: string;
  recorded: RecordedInfo | null;
}

/** The 30-second judge path: read the memo, see the proof, check it yourself. No wallet needed. */
export function Sample() {
  const [d, setD] = useState<SampleDecision | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/sample")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Couldn't load the sample.");
        setD(data.decision);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the sample."));
  }, []);

  const onNear = d?.recorded?.network === "near-testnet";

  return (
    <main className="page">
      <section className="card">
        <h1>A sample decision you can check in 30 seconds</h1>
        <ol className="plain">
          <li><strong>Read the memo.</strong> Every number shows its source and whether a person or an agent stands behind it.</li>
          <li><strong>See the proof.</strong> The decision's fingerprint was recorded on {onNear ? "NEAR testnet" : "the ledger"} when it was made.</li>
          <li><strong>Check it yourself.</strong> The verify page works the fingerprint out in your browser and asks the ledger. Then change one number and watch it fail.</li>
        </ol>
        {d && (
          <p className="row">
            <a className="btn primary big" href={`/verify?hash=${d.fingerprint}&sample=1`}>Verify it yourself</a>
            <a className="btn" href="/">Run your own decision</a>
          </p>
        )}
      </section>
      {error && <p className="error">{error}</p>}
      {!d ? (
        !error && <p className="muted">Loading the sample. The first time, Uprali works it out and records it, which takes a few seconds…</p>
      ) : (
        <div className="layout">
          <section className="card result">
            <p className="spoken">“{d.question}”</p>
            <PrivateAiBadge memo={d.memo} />
            <MemoView memo={d.memo} />
          </section>
          <section className="card ask">
            <h2>Proof on NEAR</h2>
            <p className="small">Fingerprint <code className="mono">{d.fingerprint}</code></p>
            {d.recorded ? (
              <p>
                ✓ Recorded on {onNear ? "NEAR testnet" : "the local demo ledger"} by <strong>{d.recorded.by}</strong>, {new Date(d.recorded.atMs).toLocaleString()}.
                {d.recorded.txUrl && <> <a href={d.recorded.txUrl} target="_blank" rel="noreferrer">See the transaction</a>.</>}
              </p>
            ) : (
              <p className="muted">Not recorded yet. The ledger may be busy; reload in a minute.</p>
            )}
            <p className="muted small">
              Only the fingerprint, the decision id and its version go on chain. The numbers stay with Uprali, and anyone holding the snapshot can prove they weren't changed.
            </p>
            <a className="btn primary" href={`/verify?hash=${d.fingerprint}&sample=1`}>Verify it yourself</a>
          </section>
        </div>
      )}
    </main>
  );
}

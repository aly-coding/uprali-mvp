"use client";

import type { Input, Memo } from "@/lib/engine/types";
import { fmt } from "@/lib/engine/buildVsBuy";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function Badges({ i }: { i: Input }) {
  return (
    <span className="badges">
      <span className={`badge ${i.owner === "human" ? "human" : "agent"}`}>{i.owner === "human" ? "Human" : "Agent"}</span>
      <span className={`badge ${i.isAssumption ? "assume" : "fact"}`}>{i.isAssumption ? "Assumption" : "Fact"}</span>
      {i.needsHuman && <span className="badge gap">Needs a human</span>}
    </span>
  );
}

export function PrivateAiBadge({ memo }: { memo: Memo }) {
  const p = memo.privateAi;
  const a = p.attestation;
  const verified = p.privateInference && a?.verified;
  return (
    <details className={`attest ${verified ? "ok" : p.privateInference ? "warn" : "plain"}`}>
      <summary>
        <span className="attest-mark">{verified ? "✓" : p.privateInference ? "!" : "i"}</span>
        <span>
          <strong>{verified ? "NEAR AI Cloud: Verified" : p.privateInference ? "NEAR AI Cloud: not verified" : p.provider === "anthropic" ? "Claude (not private inference)" : "Demo analyst (no AI model)"}</strong>
          <span className="muted"> {p.model}</span>
        </span>
      </summary>
      <p>{p.note}</p>
      {a && (
        <>
          <ul className="checks">
            {a.checks.map((c) => (
              <li key={c.name} className={c.ok ? "ok" : "bad"}>
                {c.ok ? "✓" : "✗"} <strong>{c.name}</strong>: {c.detail}
              </li>
            ))}
          </ul>
          <p className="muted small">Enclave signing key {a.signingAddress || "unknown"}. Checked {new Date(a.checkedAt).toLocaleString()} with a fresh nonce.</p>
          <p className="muted small">Not checked here: {a.notCheckedHere.join("; ")}.</p>
        </>
      )}
      <ul className="models small muted">
        {memo.modelsUsed.map((m, k) => (
          <li key={k}>
            {m.task === "extract" ? "Read the question" : "Wrote the memo text"}: {m.provider} ({m.model}){m.fallbackFrom ? `, after ${m.fallbackFrom}` : ""}
          </li>
        ))}
        <li>Every dollar figure was computed in code, not by a model.</li>
      </ul>
    </details>
  );
}

export function MemoView({ memo }: { memo: Memo }) {
  const r = memo.recommendation;
  const maxLine = memo.build ? Math.max(...memo.build.lines.map((l) => l.total), 1) : 1;
  return (
    <div className="memo">
      <div className={`verdict ${r.option ?? "none"}`}>
        <div className="verdict-head">
          <h2>{r.headline}</h2>
          <span className={`pill ${r.confidence}`}>{r.confidence} confidence</span>
          {memo.status !== "complete" && <span className="pill draft">{memo.status === "needs_human" ? "Needs a human" : "Draft: some numbers are benchmarks"}</span>}
        </div>
        <p>{r.why}</p>
        {memo.prototypeTrap && <p className="trap">{memo.prototypeTrap}</p>}
      </div>

      {memo.buy && memo.build && (
        <section>
          <h3>{memo.horizonYears}-year cost</h3>
          <div className="totals">
            <div><span className="muted">Buy</span><strong>{usd(memo.buy.total)}</strong></div>
            <div><span className="muted">Build</span><strong>{usd(memo.build.total)}</strong></div>
            <div><span className="muted">Prototype only</span><strong>{usd(memo.prototypeOnlyCost ?? 0)}</strong></div>
            {memo.breakEvenAnnualSubscription !== null && <div><span className="muted">Break-even subscription</span><strong>{usd(memo.breakEvenAnnualSubscription)}/yr</strong></div>}
          </div>
          <h4>Where the build money goes</h4>
          <ul className="bars">
            {[...memo.build.lines].filter((l) => l.total > 0).sort((a, b) => b.total - a.total).map((l) => (
              <li key={l.key} title={l.how}>
                <span className="bar-label">{l.label}</span>
                <span className="bar"><span style={{ width: `${(l.total / maxLine) * 100}%` }} /></span>
                <span className="bar-val">{usd(l.total)}</span>
                <span className="bar-how muted">{l.how}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Every number, with its source and owner</h3>
        <table className="inputs">
          <tbody>
            {memo.inputs.map((i) => (
              <tr key={i.key} className={i.needsHuman ? "needs" : ""}>
                <td>{i.label}</td>
                <td className="val">{i.value === null ? "—" : fmt(i.value, i.unit)}</td>
                <td><Badges i={i} /></td>
                <td className="muted small">{i.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {memo.whatWouldChangeMyMind.length > 0 && (
        <section>
          <h3>What would change the answer</h3>
          <ul>{memo.whatWouldChangeMyMind.map((f) => <li key={f.key}>{f.text}</li>)}</ul>
        </section>
      )}

      <section className="two">
        <div>
          <h3>Biggest risk</h3>
          <p>{memo.biggestRisk}</p>
        </div>
        <div>
          <h3>What the CFO will ask</h3>
          <ul>{memo.cfoQuestions.map((q, k) => <li key={k}>{q}</li>)}</ul>
        </div>
      </section>
      <section>
        <h3>30-second version</h3>
        <p className="spoken">{memo.spoken30s}</p>
      </section>
    </div>
  );
}

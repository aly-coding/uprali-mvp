"use client";

import type { Input, Memo } from "@/lib/engine/types";
import { fmt } from "@/lib/engine/buildVsBuy";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
const money = (n: number | null) => (n === null ? "—" : usd(n));
const yesNo = (b: boolean | null) => (b === null ? "?" : b ? "✓" : "✗");

function Badges({ i }: { i: Input }) {
  if (i.value === null && !i.needsHuman) return <span className="badges"><span className="badge optional">Optional</span></span>;
  return (
    <span className="badges">
      <span className={`badge ${i.owner === "human" ? "human" : "agent"}`}>{i.owner === "human" ? "Human" : "Agent"}</span>
      {i.source.startsWith("Suggestion") ? (
        <span className="badge suggest">Suggestion, verify</span>
      ) : (
        <span className={`badge ${i.isAssumption ? "assume" : "fact"}`}>{i.isAssumption ? "Assumption" : "Fact"}</span>
      )}
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

      {memo.value && (
        <section>
          <h3>Return on investment, against keeping things as they are</h3>
          <table className="inputs roi">
            <thead>
              <tr><th></th><th>New spend</th><th>Confirmed cash</th><th>Time freed (not cash)</th><th>Net ROI</th><th>Gross ROI</th><th>Payback</th></tr>
            </thead>
            <tbody>
              {memo.value.options.map((o) => (
                <tr key={o.option} className={o.option === r.option ? "chosen" : ""}>
                  <td>{o.label}</td>
                  <td className="val">{money(o.investment)}</td>
                  <td className="val">{money(o.financial)}</td>
                  <td className="val">{money(o.capacity)}</td>
                  <td className="val">{o.option === "status_quo" ? "—" : pct(o.netRoi)}</td>
                  <td className="val">{o.option === "status_quo" ? "—" : pct(o.grossRoi)}</td>
                  <td>{o.payback.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {memo.value.scenarios && (
            <>
              <h4>Scenarios (time saved and adoption)</h4>
              <ul>
                {memo.value.scenarios.map((sc) => (
                  <li key={sc.name}>
                    <strong>{sc.label}</strong> ({sc.timeReductionPct}% time saved, {sc.adoptionPct}% adoption): gross ROI {pct(sc.buy.grossRoi)} to buy, {pct(sc.build.grossRoi)} to build.
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="small">
            <strong>Opportunity cost:</strong> {memo.value.opportunity.text}
            {memo.value.opportunity.estimatedCost ? ` Estimated at ${usd(memo.value.opportunity.estimatedCost)}.` : ""} {memo.value.opportunity.note}
          </p>
          <p className="small"><strong>Kind of return:</strong> {memo.value.roiType ?? "not set yet"}</p>
          {memo.value.notes.map((n, k) => <p key={k} className="muted small">{n}</p>)}
          {memo.value.missing.length > 0 && (
            <p className="muted small">To finish the ROI case: {memo.value.missing.map((m) => m.label.toLowerCase()).join(", ")}.</p>
          )}
        </section>
      )}

      {memo.funding && (
        <section className="two">
          <div>
            <h3>Would a CFO fund it?</h3>
            <ul className="checks">
              {memo.funding.criteria.map((c) => <li key={c.label} title={c.why}>{yesNo(c.met)} {c.label}. <span className="muted small">{c.why}</span></li>)}
            </ul>
          </div>
          <div>
            <h3>Reasons for &quot;not now&quot;</h3>
            <ul className="checks">
              {memo.funding.notNow.map((c) => <li key={c.reason}>{c.flagged === null ? "?" : c.flagged ? "⚠" : "✓"} {c.reason}. <span className="muted small">{c.why}</span></li>)}
            </ul>
          </div>
        </section>
      )}

      {memo.killCriteria && (
        <section>
          <h3>When to stop</h3>
          <ul>
            <li><strong>Metric:</strong> {memo.killCriteria.metric}</li>
            <li><strong>Minimum effect:</strong> {memo.killCriteria.minimumEffect}</li>
            <li><strong>Check by:</strong> {memo.killCriteria.window}</li>
            <li><strong>Owner:</strong> {memo.killCriteria.owner ?? <span className="badge gap">Needs a human</span>}</li>
            <li><strong>Fallback:</strong> {memo.killCriteria.fallback}</li>
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

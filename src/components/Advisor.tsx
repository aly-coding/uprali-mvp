"use client";

import { useState } from "react";
import { ADVISOR_QUESTIONS, SUGGESTION_LABEL, type Advice, type Answers, type ToolSuggestion } from "@/lib/engine/advisorShared";
import { MicButton, appendSpoken } from "./Voice";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/**
 * Asks what the tool must do before the memo, then suggests cheaper existing tools to compare.
 * Every suggestion carries the "Suggestion, verify" tag and stays apart from the numbers the person typed.
 */
export function Advisor({ question, onCompare }: { question: string; onCompare: (s: ToolSuggestion, seats: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/app/advise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The advisor couldn't run.");
      setAdvice(data);
      setPicked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The advisor couldn't run.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="advisor closed">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Not sure what to buy? Get advice first
        </button>
        <span className="muted small"> Answer five questions and Uprali suggests existing tools that may cost less.</span>
      </div>
    );
  }

  return (
    <div className="advisor">
      <div className="group-head">
        <h3>Advice before you decide</h3>
        <button type="button" className="link" onClick={() => setOpen(false)}>Hide</button>
      </div>
      <p className="muted small">
        A few questions first. Your answers shape the suggestions only. Nothing here goes into the memo unless you pick a tool to compare.
      </p>
      {ADVISOR_QUESTIONS.map((q) => (
        <label key={q.key} className="answer">
          <span>{q.ask}</span>
          <span className="with-mic">
            <input
              className="input"
              placeholder={q.placeholder}
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
            />
            <MicButton label="Say it" onText={(t) => setAnswers((a) => ({ ...a, [q.key]: appendSpoken(a[q.key] ?? "", t) }))} />
          </span>
        </label>
      ))}
      <button type="button" className="btn primary" onClick={ask} disabled={busy}>
        {busy ? "Thinking…" : advice ? "Suggest again" : "Suggest tools to compare"}
      </button>
      {error && <p className="error">{error}</p>}

      {advice && (
        <div className="advice">
          <p className="small">
            <span className="badge suggest">{SUGGESTION_LABEL}</span> {advice.note}
          </p>
          {advice.advice && <p><strong>Suggestion:</strong> {advice.advice}</p>}
          {advice.suggestions.length === 0 ? (
            <p className="muted">No tools to suggest from what you said. Add the features it must have and try again.</p>
          ) : (
            <ul className="suggestions">
              {advice.suggestions.map((s) => {
                const id = `${s.name}|${s.plan}`;
                return (
                  <li key={id} className={picked === id ? "picked" : ""}>
                    <div className="row between">
                      <strong>{s.name}{s.plan ? ` ${s.plan}` : ""}</strong>
                      <span className="badge suggest">{SUGGESTION_LABEL}</span>
                    </div>
                    <p className="small">
                      {s.pricePerSeatMonth !== null ? <>About {usd(s.pricePerSeatMonth)} per user a month</> : "Price unknown"}
                      {s.estimatedAnnual !== null && <>, about {usd(s.estimatedAnnual)} a year for {advice.seats} {advice.seats === 1 ? "person" : "people"}</>}
                      . Verify the price on {s.name}'s site.
                    </p>
                    {s.why && <p className="small">{s.why}</p>}
                    {s.covers.length > 0 && <p className="small">Covers: {s.covers.join(", ")}</p>}
                    {s.gaps.length > 0 && <p className="small warn-text">May not cover: {s.gaps.join(", ")}</p>}
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setPicked(id);
                        onCompare(s, advice.seats);
                      }}
                    >
                      {picked === id ? "✓ Comparing this one" : "Compare this one"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {advice.followUps.length > 0 && (
            <>
              <p className="small"><strong>Worth answering to sharpen this:</strong></p>
              <ul className="small">{advice.followUps.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

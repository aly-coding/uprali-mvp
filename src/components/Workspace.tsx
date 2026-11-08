"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttestationResult } from "@/lib/attest";
import type { AnchorKind, Assumption, CaseState, ChatMessage, Confidence, ProviderName, RecordResult } from "@/lib/types";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import { buildMemo, memoToMarkdown } from "@/lib/memo";
import { buildSnapshot, canonicalJson } from "@/lib/snapshot";
import { filledByLabel, formatValue, parseAmount } from "@/lib/format";
import type { AnalystTurnOutput } from "@/lib/llm/types";

interface Config {
  providers: Array<{ name: ProviderName; model: string }>;
  defaultProvider: ProviderName;
  ledger: { network: string; contractId: string | null; recorder: string };
  recordNeedsCode: boolean;
}

interface LogEntry {
  at: string;
  who: string;
  what: string;
}

interface Saved {
  c: CaseState;
  messages: ChatMessage[];
  pendingKey: string | null;
  log: LogEntry[];
  modelsUsed: string[];
  records: Array<RecordResult & { hash: string; snapshot: string }>;
}

const STORE = "uprali.workspace.v1";
const PROVIDER_LABEL: Record<ProviderName, string> = { anthropic: "Claude", nearai: "NEAR AI", demo: "Demo analyst (no key)" };

function newCase(templateId: string): Saved {
  const t = getTemplate(templateId);
  const d = new Date();
  const id = `UP-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  return {
    c: { id, title: `${t.name} decision`, templateId, version: 1, assumptions: {} },
    messages: [{ role: "assistant", content: `${t.opener}\n\n${t.fields[0].question}` }],
    pendingKey: t.fields[0].key,
    log: [],
    modelsUsed: [],
    records: [],
  };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchAttestation(): Promise<AttestationResult | { error: string }> {
  try {
    const res = await fetch("/api/attestation", { cache: "no-store" });
    const data = await res.json();
    return res.ok ? (data as AttestationResult) : { error: data.error || "The check failed." };
  } catch {
    return { error: "Couldn't run the check." };
  }
}

export default function Workspace() {
  const [state, setState] = useState<Saved>(() => newCase(TEMPLATES[0].id));
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvers, setApprovers] = useState("");
  const [kind, setKind] = useState<AnchorKind>("decision");
  const [accessCode, setAccessCode] = useState("");
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [attest, setAttest] = useState<AttestationResult | { error: string } | null>(null);
  const [attesting, setAttesting] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<{ stop(): void } | null>(null);

  // Restore the private working session from this browser only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setState(JSON.parse(raw) as Saved);
    } catch {
      /* storage unavailable */
    }
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setProvider((p) => p ?? c.defaultProvider);
      })
      .catch(() => setError("Couldn't load settings from the server."));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [state]);

  const template = getTemplate(state.c.templateId);
  const memo = useMemo(() => buildMemo(state.c), [state.c]);
  const values = useMemo(() => {
    const v: Record<string, number | string> = {};
    for (const [k, a] of Object.entries(state.c.assumptions)) v[k] = a.value;
    return v;
  }, [state.c.assumptions]);
  const metrics = memo.complete ? template.compute(values).metrics : [];
  const lastRecord = state.records[state.records.length - 1];
  const recordedThisVersion = state.records.some((r) => r.anchor.version === state.c.version && r.anchor.kind === kind);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy || !provider) return;
      setError(null);
      setBusy(true);
      const messages: ChatMessage[] = [...state.messages, { role: "user", content }];
      setState((s) => ({ ...s, messages }));
      setInput("");
      try {
        const res = await fetch("/api/analyst", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            templateId: state.c.templateId,
            provider,
            pendingKey: state.pendingKey,
            messages: messages.slice(-40),
            assumptions: state.c.assumptions,
          }),
        });
        const data = (await res.json()) as AnalystTurnOutput & { error?: string };
        if (!res.ok) throw new Error(data.error || "The analyst didn't answer.");
        const who = filledByLabel({ kind: "model", provider: data.provider, model: data.model });
        const now = new Date().toISOString();
        setState((s) => {
          const assumptions = { ...s.c.assumptions };
          const log = [...s.log];
          for (const u of data.updates) {
            const f = template.fields.find((x) => x.key === u.key);
            assumptions[u.key] = {
              key: u.key,
              value: u.value,
              source: u.source,
              confidence: u.confidence,
              filledBy: u.origin === "user_stated" ? { kind: "user" } : { kind: "model", provider: data.provider, model: data.model },
              updatedAt: now,
            };
            log.push({
              at: now,
              who,
              what:
                u.origin === "user_stated"
                  ? `Read ${f?.label ?? u.key} = ${formatValue(u.value, f?.unit ?? "text")} from your reply`
                  : `Proposed ${f?.label ?? u.key} = ${formatValue(u.value, f?.unit ?? "text")} (benchmark, low confidence)`,
            });
          }
          return {
            ...s,
            c: { ...s.c, assumptions, version: data.updates.length ? s.c.version + 1 : s.c.version },
            messages: [...messages, { role: "assistant", content: data.reply }],
            pendingKey: data.askingKey,
            log,
            modelsUsed: s.modelsUsed.includes(who) ? s.modelsUsed : [...s.modelsUsed, who],
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The analyst didn't answer.");
      } finally {
        setBusy(false);
      }
    },
    [busy, provider, state, template],
  );

  function editAssumption(key: string, raw: string, confidence: Confidence) {
    const f = template.fields.find((x) => x.key === key)!;
    let value: number | string = raw.trim();
    if (f.unit !== "text") {
      const n = parseAmount(raw);
      if (n === null) return setError(`${f.label} needs a number.`);
      value = n;
    }
    if (value === "") return;
    const a: Assumption = {
      key,
      value,
      source: "Edited by the user",
      confidence,
      filledBy: { kind: "user" },
      updatedAt: new Date().toISOString(),
    };
    setState((s) => ({
      ...s,
      c: { ...s.c, version: s.c.version + 1, assumptions: { ...s.c.assumptions, [key]: a } },
      log: [...s.log, { at: a.updatedAt, who: "You", what: `Set ${f.label} = ${formatValue(value, f.unit)}` }],
    }));
    setEditing(null);
  }

  async function record() {
    setError(null);
    const list = approvers
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (list.length === 0) return setError("Add at least one approver, for example: Aly (CFO).");
    const snapshot = buildSnapshot(state.c, { kind, approvers: list, modelsUsed: state.modelsUsed });
    setRecording(true);
    try {
      const res = await fetch("/api/ledger/record", {
        method: "POST",
        headers: { "content-type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
        body: JSON.stringify({ snapshot }),
      });
      const data = (await res.json()) as RecordResult & { hash: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't record the decision.");
      const text = canonicalJson(snapshot);
      setState((s) => ({
        ...s,
        records: [...s.records, { ...data, snapshot: text }],
        log: [
          ...s.log,
          { at: new Date().toISOString(), who: "Ledger", what: `Recorded ${kind} fingerprint for version ${snapshot.caseVersion} on ${data.network}` },
        ],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record the decision.");
    } finally {
      setRecording(false);
    }
  }

  function toggleMic() {
    type Recog = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void };
    const W = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return setError("Voice input needs a browser with speech recognition, like Chrome.");
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(" ");
      void send(said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    r.start();
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return setError("This browser can't read aloud.");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function switchTemplate(id: string) {
    if (id === state.c.templateId) return;
    if (Object.keys(state.c.assumptions).length && !window.confirm("Start a new case? The current one will be cleared from this browser.")) return;
    setState(newCase(id));
    setKind("decision");
  }

  return (
    <main className="grid">
      {/* Left: case and assumptions */}
      <section className="panel">
        <h2>Case</h2>
        <div className="tabs">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`tab ${t.id === state.c.templateId ? "active" : ""}`} onClick={() => switchTemplate(t.id)}>
              {t.name}
              <small>{t.description}</small>
            </button>
          ))}
        </div>
        <input
          className="input"
          aria-label="Case title"
          value={state.c.title}
          onChange={(e) => setState((s) => ({ ...s, c: { ...s.c, title: e.target.value.slice(0, 120) } }))}
        />
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          {state.c.id} · version {state.c.version}
        </p>
        <h2>Assumptions</h2>
        {template.fields.map((f) => {
          const a = state.c.assumptions[f.key];
          if (editing === f.key) {
            return <EditBox key={f.key} label={f.label} initial={a ? String(a.value) : ""} initialConf={a?.confidence ?? "medium"} onSave={(v, c) => editAssumption(f.key, v, c)} onCancel={() => setEditing(null)} />;
          }
          return (
            <div key={f.key} className={`assump ${a ? "" : "missing"}`} onDoubleClick={() => setEditing(f.key)} title="Double-click to edit">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label">{f.label}</span>
                <button className="btn" style={{ padding: "1px 8px", fontSize: 12 }} onClick={() => setEditing(f.key)}>
                  Edit
                </button>
              </div>
              {a ? (
                <>
                  <div className="value">{formatValue(a.value, f.unit)}</div>
                  <div className="badges">
                    <span className={`badge ${a.confidence}`}>{a.confidence} confidence</span>
                    <span className="badge model">{filledByLabel(a.filledBy)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {a.source}
                  </div>
                </>
              ) : (
                <div>Not answered yet</div>
              )}
            </div>
          );
        })}
        <h2 style={{ marginTop: 16 }}>Model log</h2>
        {state.log.length === 0 ? (
          <p className="log">Every value the analyst reads or proposes is logged here with the model that did it.</p>
        ) : (
          <ul className="log">
            {state.log.slice(-30).map((l, i) => (
              <li key={i}>
                <b>{l.who}</b>: {l.what}
              </li>
            ))}
          </ul>
        )}
        <button className="btn" style={{ marginTop: 10 }} onClick={() => window.confirm("Clear this case from your browser?") && setState(newCase(state.c.templateId))}>
          New case
        </button>
      </section>

      {/* Middle: private conversation */}
      <section className="panel chat">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Analyst</h2>
          <select className="input" style={{ width: "auto" }} aria-label="AI model" value={provider ?? ""} onChange={(e) => setProvider(e.target.value as ProviderName)}>
            {config?.providers.map((p) => (
              <option key={p.name} value={p.name}>
                {PROVIDER_LABEL[p.name]} · {p.model}
              </option>
            ))}
          </select>
        </div>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
          Private: this conversation is kept only in your browser and is never written to the ledger.
          {provider === "nearai" ? " NEAR AI runs the model inside a hardware-isolated enclave (TEE)." : ""}
        </p>
        {provider === "nearai" && (
          <div className="ledger-box" style={{ marginTop: 0, marginBottom: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>Private AI check</b>
              <button
                type="button"
                className="btn"
                disabled={attesting}
                onClick={async () => {
                  setAttesting(true);
                  setAttest(await fetchAttestation());
                  setAttesting(false);
                }}
              >
                {attesting ? "Checking…" : "Verify the enclave"}
              </button>
            </div>
            {attest && "error" in attest && <div className="notice bad">{attest.error}</div>}
            {attest && "checks" in attest && (
              <>
                <div className={`notice ${attest.verified ? "good" : "bad"}`}>
                  {attest.verified ? "Verified" : "Not verified"}: {attest.model}, checked with a fresh random nonce
                </div>
                <ul className="log">
                  {attest.checks.map((c) => (
                    <li key={c.name}>
                      {c.ok ? "✓" : "✗"} <b>{c.name}</b>: {c.detail}
                    </li>
                  ))}
                  {attest.notCheckedHere.map((n) => (
                    <li key={n}>○ Not checked here: {n}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="msgs" ref={msgsRef}>
          {state.messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {busy && <div className="msg assistant muted">Thinking…</div>}
        </div>
        {error && <div className="notice bad">{error}</div>}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            className="input"
            placeholder='Answer, or say "not sure" for a benchmark'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button type="button" className={`btn mic ${listening ? "on" : ""}`} onClick={toggleMic} aria-label="Speak your answer" title="Speak your answer">
            {listening ? "Stop" : "Speak"}
          </button>
          <button className="btn primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </section>

      {/* Right: decision memo and ledger */}
      <section className="panel">
        <h2>Decision memo</h2>
        {!memo.complete ? (
          <div className="notice">
            Still needed: {memo.missing.join(", ")}. The memo fills in as you answer.
          </div>
        ) : null}
        {memo.complete && (
          <>
            <div className="memo-rec">{memo.recommendation}</div>
            <div className="metrics">
              {metrics.map((m) => (
                <div key={m.label} className="metric">
                  <div className="v">{m.value}</div>
                  <div className="l">{m.label}</div>
                </div>
              ))}
            </div>
            {memo.lines.map((l) => (
              <p key={l.label} className="memo-line">
                <b>{l.label}:</b> {l.text}
              </p>
            ))}
            <h3>Know your numbers</h3>
            <table>
              <thead>
                <tr>
                  <th>Figure</th>
                  <th>Meaning</th>
                  <th>CFO will ask</th>
                </tr>
              </thead>
              <tbody>
                {memo.cheatSheet.map((r) => (
                  <tr key={r.meaning}>
                    <td>{r.figure}</td>
                    <td>{r.meaning}</td>
                    <td>{r.cfoAsks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>What-if</h3>
            <p>{memo.whatIf}</p>
            <h3>Pre-answered questions</h3>
            {memo.preAnswered.map((q) => (
              <p key={q.q} className="memo-line">
                <b>{q.q}</b> {q.a}
              </p>
            ))}
            <h3>30-second version</h3>
            <p className="spoken">“{memo.spoken}”</p>
            <div className="row">
              <button className="btn" onClick={() => speak(memo.spoken)}>
                Read aloud
              </button>
              <button className="btn" onClick={() => download(`${state.c.id}-memo.md`, memoToMarkdown(memo), "text/markdown")}>
                Download memo
              </button>
            </div>

            <div className="ledger-box">
              <h2>Record on NEAR</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Only a fingerprint (SHA-256) of this decision goes on the ledger, with the case id, version and time. Your numbers stay private, and anyone with the snapshot can prove it wasn't changed.
              </p>
              <div className="stack">
                <input className="input" placeholder="Approvers, comma separated (e.g. Aly (CFO), Vadim (CTO))" value={approvers} onChange={(e) => setApprovers(e.target.value)} />
                <div className="row">
                  <select className="input" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as AnchorKind)} aria-label="What to record">
                    <option value="decision">Decision</option>
                    <option value="approval">Approval</option>
                    <option value="outcome_review">Outcome review</option>
                  </select>
                  {config?.recordNeedsCode && (
                    <input className="input" placeholder="Access code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
                  )}
                  <button className="btn primary" disabled={recording || recordedThisVersion} onClick={record}>
                    {recording ? "Recording…" : recordedThisVersion ? "Recorded" : `Record ${kind.replace("_", " ")}`}
                  </button>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Ledger: {config ? (config.ledger.network === "near-testnet" ? `NEAR testnet · ${config.ledger.contractId}` : "local demo ledger (not on chain)") : "…"}
                </span>
              </div>
              {lastRecord && (
                <div className={`notice ${lastRecord.network === "near-testnet" ? "good" : ""}`} style={{ marginTop: 10 }}>
                  <div>
                    {lastRecord.anchor.kind.replace("_", " ")} recorded for version {lastRecord.anchor.version} at {new Date(lastRecord.anchor.timestampMs).toLocaleString()}
                    {lastRecord.network === "local-demo" ? " on the local demo ledger." : ` by ${lastRecord.anchor.recordedBy}.`}
                  </div>
                  <div className="hash">{lastRecord.hash}</div>
                  <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {lastRecord.explorerUrl && (
                      <a href={lastRecord.explorerUrl} target="_blank" rel="noreferrer">
                        View transaction
                      </a>
                    )}
                    <button className="btn" onClick={() => download(`${state.c.id}-v${lastRecord.anchor.version}-${lastRecord.anchor.kind}.json`, lastRecord.snapshot, "application/json")}>
                      Download snapshot
                    </button>
                    <a href={`/verify?hash=${lastRecord.hash}`}>Verify</a>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function EditBox(props: { label: string; initial: string; initialConf: Confidence; onSave: (v: string, c: Confidence) => void; onCancel: () => void }) {
  const [v, setV] = useState(props.initial);
  const [c, setC] = useState<Confidence>(props.initialConf);
  return (
    <div className="assump">
      <div className="label">{props.label}</div>
      <div className="edit-row">
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && props.onSave(v, c)} />
        <select className="input" style={{ width: 100 }} value={c} onChange={(e) => setC(e.target.value as Confidence)} aria-label="Confidence">
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>
      <div className="edit-row">
        <button className="btn primary" onClick={() => props.onSave(v, c)}>
          Save
        </button>
        <button className="btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

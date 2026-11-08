"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FIELDS, FIELD_GROUPS, type FieldGroup } from "@/lib/engine/buildVsBuy";
import { SUGGESTION_SOURCE, type ToolSuggestion } from "@/lib/engine/advisorShared";
import { canonicalJson, sha256Hex, type DecisionSnapshot } from "@/lib/engine/snapshot";
import type { Memo } from "@/lib/engine/types";
import type { CaseMemo } from "@/lib/engine/caseDecide";
import { CASE_TEMPLATES, isCaseTemplate, type TemplateId } from "@/lib/engine/cases";
import { CASE_TABS, CaseForm, CaseMemoView, CaseTable, TemplatePicker, templateTitle, type CaseTab } from "./CaseView";
import { MemoView, PrivateAiBadge } from "./MemoView";
import { Advisor } from "./Advisor";
import { MicButton, ReadAloud, VOICE_ON, appendSpoken } from "./Voice";
import { TestnetHelp, TestnetSteps, isMainnetAccount } from "./TestnetHelp";
import { confirmHistorySignIn, endHistorySession, explorerAccount, explorerTx, initWallet, recordWithWallet, signedInAccount, signOut, type WalletHandle } from "./wallet";

interface Config {
  providers: string[];
  privateModel: string | null;
  ledger: { network: string; contractId: string | null };
  wallet: { networkId: "testnet"; contractId: string } | null;
  relayerCodeEnabled: boolean;
  localDemo?: boolean;
  googleSignIn?: boolean;
}

/** A result waiting to be recorded while the person connects a wallet (some wallets reload the page). */
const PENDING = "uprali:pending-record";
interface Pending {
  at: number;
  template: TemplateId;
  question: string;
  asked: string;
  result: Result;
}
function savePending(p: Omit<Pending, "at">) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ ...p, at: Date.now() }));
  } catch {
    /* storage off: the result stays on screen when the wallet opens in a popup */
  }
}
function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && Date.now() - p.at < 60 * 60_000 ? p : null;
  } catch {
    return null;
  }
}

interface Result {
  runId: string | null;
  parentId: string | null;
  memo: Memo | CaseMemo;
  snapshot: DecisionSnapshot;
  fingerprint: string;
  verifyUrl: string;
}

const fieldsOf = (t: TemplateId) => (isCaseTemplate(t) ? CASE_TEMPLATES[t].drivers : FIELDS);

interface Recorded {
  by: string;
  txUrl: string | null;
  verifyUrl: string;
  network: string;
}

const EXAMPLE =
  "Should we build our own CRM or keep paying for HubSpot? We pay $720 a year for HubSpot Starter. Our engineer built a working prototype in 3 weeks. It would need 2 integrations, email and billing.";

const groupInfo = (g: FieldGroup) => FIELD_GROUPS.find((x) => x.id === g) ?? { id: g, title: "", blurb: "" };

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
  const [template, setTemplate] = useState<TemplateId>("build_vs_buy");
  /** What was asked for the result on screen, shown as the person's message. */
  const [asked, setAsked] = useState("");
  const [panelTab, setPanelTab] = useState<"inputs" | CaseTab>("inputs");
  const [question, setQuestion] = useState(EXAMPLE);
  const [values, setValues] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<"" | "deciding" | "recording">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [code, setCode] = useState("");
  const [historyAccount, setHistoryAccount] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [parent, setParent] = useState<{ id: string; version: number; title: string } | null>(null);
  /** Fields filled from an advisor suggestion, not typed by the person. Typing over one makes it theirs. */
  const [suggested, setSuggested] = useState<Record<string, true>>({});
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch("/api/app/session")
      .then((r) => r.json())
      .then((s: { account: string | null; google?: { email: string } | null }) => {
        setHistoryAccount(s.account);
        setGoogleEmail(s.google?.email ?? null);
      })
      .catch(() => undefined);
    // "Re-run with new numbers" from the History page: load that run's question and numbers.
    const from = new URLSearchParams(window.location.search).get("from");
    if (from) {
      fetch(`/api/app/history/${encodeURIComponent(from)}`)
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Couldn't load that decision.");
          const d = data.decision as { id: string; version: number; title: string; question: string; inputs: Record<string, { value?: unknown }>; snapshot?: { template?: string } };
          const t = d.snapshot?.template;
          if (isCaseTemplate(t)) setTemplate(t);
          const top = Math.max(d.version, ...((data.versions as { version: number }[]) || []).map((v) => v.version));
          setParent({ id: d.id, version: top, title: d.title });
          setQuestion(d.question || "");
          const vals: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.inputs || {})) {
            const raw = v && typeof v === "object" && "value" in v ? v.value : v;
            if (raw !== null && raw !== undefined && (typeof raw === "number" || typeof raw === "string")) vals[k] = String(raw);
          }
          setValues(vals);
          if (isCaseTemplate(t) || Object.keys(vals).some((k) => !MAIN_FIELDS.includes(k))) setMore(true);
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

  // Back from connecting a wallet: put the result that was waiting to be recorded back on screen.
  useEffect(() => {
    if (!account || result) return;
    const p = takePending();
    if (!p) return;
    setTemplate(p.template);
    setQuestion(p.question);
    setAsked(p.asked);
    setResult(p.result);
  }, [account, result]);

  function connectToSave() {
    if (!result || !wallet) return;
    savePending({ template, question, asked, result });
    wallet.modal.show();
  }

  const who = account ?? (demo ? "demo-user" : null);
  const groups = useMemo(() => {
    const order: FieldGroup[] = ["buy", "build", "value", "general"];
    return order
      .map((g) => ({ g, fields: FIELDS.filter((f) => (f.group ?? "general") === g && (more || MAIN_FIELDS.includes(f.key))) }))
      .filter((x) => x.fields.length > 0);
  }, [more]);

  function compare(s: ToolSuggestion, seats: number | null) {
    const next: Record<string, string> = { ...values, tool_name: `${s.name}${s.plan ? ` ${s.plan}` : ""}` };
    const marks: Record<string, true> = { ...suggested, tool_name: true };
    if (s.estimatedAnnual !== null) {
      next.buy_annual_cost = String(s.estimatedAnnual);
      marks.buy_annual_cost = true;
    } else if (s.pricePerSeatMonth !== null && seats === null) {
      setError(`Say how many people will use ${s.name} so Uprali can work out the yearly cost.`);
    }
    setValues(next);
    setSuggested(marks);
  }

  function pick(t: TemplateId) {
    if (t === template) return;
    setTemplate(t);
    setQuestion(t === "build_vs_buy" ? EXAMPLE : CASE_TEMPLATES[t].prompt);
    setValues({});
    setSuggested({});
    setResult(null);
    setRecorded(null);
    setParent(null);
    setMore(false);
    setError("");
    setPanelTab("inputs");
  }

  function newCase() {
    setResult(null);
    setRecorded(null);
    setParent(null);
    setValues({});
    setSuggested({});
    setAsked("");
    setPanelTab("inputs");
    setError("");
    setQuestion("");
  }

  async function run() {
    setBusy("deciding");
    setError("");
    setResult(null);
    setRecorded(null);
    setAsked(question.trim() || `${templateTitle(template)} with the numbers on the right`);
    const inputs: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(values)) {
      const v = raw.trim();
      if (!v) continue;
      const f = fieldsOf(template).find((x) => x.key === k);
      const n = Number(v.replace(/[$,\s]/g, ""));
      const value = f?.unit === "text" || !Number.isFinite(n) ? v : n;
      inputs[k] = suggested[k]
        ? { value, owner: "agent", is_assumption: true, confidence: "low", source: SUGGESTION_SOURCE }
        : { value, owner: "human", is_assumption: false, source: `Entered by ${who} in Uprali` };
    }
    try {
      const res = await fetch("/api/app/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, question, inputs, decided_by: who, ...(parent ? { parent_id: parent.id } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The analyst couldn't run.");
      // Re-hash in the browser so the fingerprint doesn't rest on the server's word.
      const local = await sha256Hex(canonicalJson(data.snapshot));
      if (local !== data.fingerprint) throw new Error("The fingerprint didn't match the snapshot. Not recording this.");
      saveSnapshotLocally(data.fingerprint, data.snapshot);
      setResult(data);
      if (data.memo.schema === "uprali.case.v1" && data.memo.metrics) setPanelTab("model");
      if (parent && data.parentId) setParent({ ...parent, version: data.snapshot.version });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  /** Lets the history see the record. The server looks the fingerprint up on NEAR itself; the RPC can lag a few seconds. */
  async function markInHistory(runId: string, txHash: string | null) {
    for (let i = 0; i < 4; i++) {
      try {
        const res = await fetch(`/api/app/history/${encodeURIComponent(runId)}/check`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.recorded) return;
        if (res.status === 404) return;
      } catch {
        /* try again */
      }
      await new Promise((r) => setTimeout(r, 1500));
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
        takePending();
        // Let the history see it on the ledger. The server looks the fingerprint up itself.
        if (result.runId) await markInHistory(result.runId, txHash);
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
        <section className="card signin hero">
          <span className="ai-mark big" aria-hidden>U</span>
          <p className="eyebrow">The verifiable approval layer for agent spending</p>
          <h1>Before an agent buys or builds anything, Uprali checks the numbers.</h1>
          <p>
            Every spend decision gets a memo where each number shows its source and owner, a human sign-off, and a proof on NEAR. The analysis runs
            privately on NEAR AI Cloud. Pick a decision to try it: build or buy, launch a product, expand into a new market, or invest in AI.
          </p>
          <TemplatePicker value={null} onPick={(t) => { pick(t); setDemo(true); }} />
          {config.wallet ? (
            <button className="btn primary big" onClick={() => wallet?.modal.show()} disabled={!wallet}>
              Sign in with NEAR wallet
            </button>
          ) : (
            <p className="muted small">NEAR wallet sign-in turns on once the ledger is on testnet. Owner? <a href="/setup">Set it up</a>.</p>
          )}
          {config.wallet && (
            <div className="judges small">
              <strong>Judging?</strong> Sign in with a NEAR testnet wallet, run any decision, press <strong>Sign and record</strong>, then open
              History and press <strong>Verify</strong>: it should say Match, with a link to the transaction on the NEAR explorer.
              <TestnetHelp />
            </div>
          )}
          <button className="btn" onClick={() => setDemo(true)}>Continue in demo mode</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const isCase = isCaseTemplate(template);
  const caseMemo = result && result.memo.schema === "uprali.case.v1" ? result.memo : null;
  const canRun = busy === "" && (question.trim().length >= 5 || Object.values(values).some((v) => v.trim()));

  const whoBox = (
    <div className="side-who small">
      {account ? (
        <>
          <span>Signed in as <a href={explorerAccount(account)} target="_blank" rel="noreferrer"><strong>{account}</strong></a></span>
          {isMainnetAccount(account) && (
            <div className="warn">
              <p><strong>{account} is a mainnet account.</strong> Uprali records on NEAR testnet, where this account doesn&apos;t exist, so recording would fail. Sign out and use a free .testnet account:</p>
              <TestnetSteps />
            </div>
          )}
          <div className="row">
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
          </div>
        </>
      ) : (
        <>
          <span><strong>Demo mode</strong></span>
          <span className="muted">
            {config.wallet
              ? config.relayerCodeEnabled
                ? "Recording on NEAR testnet needs a wallet sign-in or the access code."
                : "Sign in with a NEAR wallet to record on testnet."
              : config.localDemo
                ? "Running on this computer: decisions are recorded on a local demo ledger."
                : "Saving on NEAR isn't switched on for this site yet."}
          </span>
          {config.wallet && <button className="btn small" onClick={() => wallet?.modal.show()}>Sign in with NEAR wallet</button>}
        </>
      )}
    </div>
  );

  const composer = (
    <div className={`composer ${result || busy ? "docked" : ""}`}>
      {parent && (
        <p className="small">
          Re-running <strong>{parent.title}</strong>. The result is saved as a new version; <a href={`/history?id=${encodeURIComponent(parent.id)}`}>the earlier one</a> stays as it was.
        </p>
      )}
      <textarea
        className="input"
        rows={result ? 2 : 4}
        value={question}
        placeholder="Describe the decision in plain words, with any numbers you know…"
        onChange={(e) => setQuestion(e.target.value)}
        aria-label="The decision"
      />
      <div className="composer-bar">
        <MicButton label="Speak" onText={(t) => setQuestion((q) => appendSpoken(q, t))} />
        <span className="chip" title="Change it in Templates">{templateTitle(template)}</span>
        <span className="grow" />
        <button className="btn primary" onClick={run} disabled={!canRun}>
          {busy === "deciding" ? "Working it out…" : result ? "Run again" : isCase ? "Build the case" : "Run the decision"}
        </button>
      </div>
    </div>
  );

  const inputsPanel = (
    <div className="panel-inputs">
      <p className="muted small">
        {isCase
          ? "Each card belongs to the person who should stand behind its numbers. Numbers you type win over the text and count as yours; blanks use the labelled benchmark."
          : "Numbers you type win over the text and count as yours. Blanks use a labelled benchmark or are marked for a person to fill in."}
      </p>
      {isCase ? (
        <CaseForm template={template} values={values} more={more} onChange={(k, v) => setValues({ ...values, [k]: v })} />
      ) : (
        <>
          <Advisor question={question} onCompare={compare} />
          {groups.map(({ g, fields }) => (
            <fieldset key={g} className={`group ${g}`}>
              <legend>{groupInfo(g).title}</legend>
              <p className="muted small">{groupInfo(g).blurb}</p>
              <div className="fields">
                {fields.map((f) => (
                  <label key={f.key}>
                    <span>
                      {f.label}
                      {suggested[f.key] && <span className="badge suggest">Suggestion, verify</span>}
                    </span>
                    <input
                      className="input"
                      placeholder={typeof f.benchmark === "number" ? `benchmark ${f.benchmark}` : f.unit === "text" ? "" : "unknown"}
                      value={values[f.key] ?? ""}
                      onChange={(e) => {
                        setValues({ ...values, [f.key]: e.target.value });
                        if (suggested[f.key]) {
                          const rest = { ...suggested };
                          delete rest[f.key];
                          setSuggested(rest);
                        }
                      }}
                      title={f.ask}
                    />
                    {f.help && <small className="help">{f.help}</small>}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </>
      )}
      <button className="link" onClick={() => setMore(!more)}>
        {more ? "Fewer numbers" : isCase ? "All assumptions (churn, costs, discount rate…)" : "More numbers (upkeep, security, on-call, turnover…)"}
      </button>
      <button className="btn primary" onClick={run} disabled={!canRun}>
        {busy === "deciding" ? "Working it out…" : result ? "Run again with these numbers" : "Run with these numbers"}
      </button>
    </div>
  );

  return (
    <main className="workspace">
      <aside className="sidebar">
        <button className="btn primary block" onClick={newCase}>+ New case</button>
        <p className="side-label">Templates</p>
        <TemplatePicker value={template} onPick={pick} compact />
        <p className="side-label">Your work</p>
        <nav className="side-links">
          <a href="/history">History</a>
          <a href="/verify">Verify a decision</a>
        </nav>
        {whoBox}
      </aside>

      <section className="conversation">
        {!result && busy !== "deciding" ? (
          <div className="empty">
            <h1>What business decision are you trying to make?</h1>
            <p className="muted">Write a prompt or choose a starting template. Uprali turns it into a three-year, driver-based business case with an owner for every number.</p>
            {composer}
            <TemplatePicker value={template} onPick={pick} />
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <>
            <div className="thread">
              <div className="msg user"><p>{asked}</p></div>
              <div className="msg ai">
                <span className="ai-mark" aria-hidden>U</span>
                <div className="msg-body">
                  {busy === "deciding" && !result ? (
                    <p className="shimmer">Reading the request and working out the numbers…</p>
                  ) : result ? (
                    <>
                      <p className="muted small">
                        {result.runId ? (
                          <>Saved to <a href={`/history?id=${encodeURIComponent(result.runId)}`}>your history</a>{result.snapshot.version > 1 ? ` as version ${result.snapshot.version}` : ""}.</>
                        ) : (
                          "Couldn't save this run to your history."
                        )}
                      </p>
                      <PrivateAiBadge memo={result.memo} />
                      {caseMemo ? <CaseMemoView memo={caseMemo} tabs={false} /> : <MemoView memo={result.memo as Memo} />}
                      {VOICE_ON && <p className="row"><ReadAloud text={result.memo.spoken30s} /></p>}
                      <div className="proof">
                        <h3>Proof on NEAR</h3>
                        <p className="small">
                          Fingerprint <code>{result.fingerprint}</code>
                        </p>
                        <p className="muted small">
                          Only this fingerprint, the decision id and version go on chain. The numbers and the question never leave this page and the server&apos;s memory.
                        </p>
                        {recorded ? (
                          <div className="recorded">
                            <p>
                              ✓ Recorded on {recorded.network} by <strong>{recorded.by}</strong>.
                            </p>
                            <p className="row">
                              {recorded.txUrl && <a href={recorded.txUrl} target="_blank" rel="noreferrer">See the transaction on the NEAR explorer</a>}
                              {result.runId && <a href={`/history?id=${encodeURIComponent(result.runId)}`}>See it in History</a>}
                              <a href={`/verify?hash=${result.fingerprint}`}>Verify this decision</a>
                              <button className="btn small" onClick={download}>Download snapshot</button>
                            </p>
                          </div>
                        ) : result.memo.status === "needs_human" ? (
                          <p className="muted">Fill in the numbers marked &quot;Needs a human&quot; before recording.</p>
                        ) : account ? (
                          <div className="row">
                            <button className="btn primary" onClick={record} disabled={busy !== ""}>
                              {busy === "recording" ? "Recording…" : `Sign and record as ${account}`}
                            </button>
                            <button className="btn" onClick={download}>Download snapshot</button>
                          </div>
                        ) : config.wallet ? (
                          <div className="save-near">
                            <p>
                              <strong>Want to save this decision?</strong> Connect your NEAR testnet wallet first. You&apos;ll come straight back to this result and record it with one click.
                            </p>
                            <div className="row">
                              <button className="btn primary" onClick={connectToSave} disabled={!wallet || busy !== ""}>Connect NEAR wallet to save</button>
                              <button className="btn" onClick={download}>Download snapshot</button>
                            </div>
                            <TestnetHelp />
                            {config.relayerCodeEnabled && (
                              <details className="small">
                                <summary>Have the demo access code instead?</summary>
                                <div className="row">
                                  <input className="input code" placeholder="Demo access code" value={code} onChange={(e) => setCode(e.target.value)} />
                                  <button className="btn" onClick={record} disabled={busy !== "" || !code.trim()}>{busy === "recording" ? "Recording…" : "Record with the code"}</button>
                                </div>
                              </details>
                            )}
                          </div>
                        ) : config.localDemo ? (
                          <div className="row">
                            <button className="btn primary" onClick={record} disabled={busy !== ""}>
                              {busy === "recording" ? "Recording…" : "Record on the local demo ledger"}
                            </button>
                            <button className="btn" onClick={download}>Download snapshot</button>
                          </div>
                        ) : (
                          <div className="save-near">
                            <p className="muted">
                              Saving on NEAR isn&apos;t switched on for this site yet, so this decision can&apos;t be recorded here. The site owner sets it up once on the <a href="/setup">Setup</a> page. You can still download the snapshot.
                            </p>
                            <div className="row"><button className="btn" onClick={download}>Download snapshot</button></div>
                          </div>
                        )}
                        {config.googleSignIn && (
                          googleEmail ? (
                            <p className="muted small">Kept in your <a href="/history">History</a> as {googleEmail}.</p>
                          ) : (
                            <div className="keep-history small">
                              <p>
                                <strong>Want to come back to your scenarios later?</strong> Sign in with Google to keep them in your History on any device. Recording on NEAR still uses your wallet.
                              </p>
                              <a className="btn" href={`/api/auth/google?return=${encodeURIComponent(result.runId ? `/history?id=${result.runId}` : "/history")}`}>Sign in with Google</a>
                            </div>
                          )
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {error && <p className="error">{error}</p>}
            {composer}
          </>
        )}
      </section>

      <aside className="panel">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panelTab === "inputs"} className={panelTab === "inputs" ? "on" : ""} onClick={() => setPanelTab("inputs")}>
            {isCase ? "Assumptions" : "Numbers"}
          </button>
          {isCase &&
            CASE_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={panelTab === t.id} className={panelTab === t.id ? "on" : ""} onClick={() => setPanelTab(t.id)} disabled={!caseMemo}>
                {t.label}
              </button>
            ))}
        </div>
        <div role="tabpanel" className="panel-body">
          {panelTab === "inputs" || !caseMemo ? inputsPanel : <CaseTable memo={caseMemo} tab={panelTab} />}
        </div>
      </aside>
    </main>
  );
}

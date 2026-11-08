"use client";

import { useState } from "react";
import { fmt } from "@/lib/engine/buildVsBuy";
import type { CaseMemo } from "@/lib/engine/caseDecide";
import { CASE_TEMPLATES, rowValue, templateList, type CaseTemplateId, type ModelRow, type RowUnit, type TemplateId } from "@/lib/engine/cases";
import { Badges } from "./MemoView";

const TEMPLATES = templateList();
const usd = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const ICON: Record<TemplateId, string> = { build_vs_buy: "⇄", new_product: "◆", new_feature: "✚", gtm_expansion: "↗", ai_investment: "✦" };

/** The starting templates, as cards. */
export function TemplatePicker({ value, onPick, compact = false }: { value: TemplateId | null; onPick: (id: TemplateId) => void; compact?: boolean }) {
  return (
    <div className={`templates ${compact ? "compact" : ""}`} role="list">
      {TEMPLATES.map((t) => (
        <button key={t.id} type="button" role="listitem" className={`template ${value === t.id ? "on" : ""}`} onClick={() => onPick(t.id)} aria-pressed={value === t.id}>
          <span className="template-icon" aria-hidden>{ICON[t.id]}</span>
          <span className="template-text">
            <strong>{t.title}</strong>
            {!compact && <span className="muted small">{t.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function templateTitle(id: TemplateId): string {
  return TEMPLATES.find((t) => t.id === id)?.title ?? id;
}

/** The drivers of a business case, grouped into the cards of the people who own them. */
export function CaseForm({ template, values, onChange, more }: { template: CaseTemplateId; values: Record<string, string>; onChange: (k: string, v: string) => void; more: boolean }) {
  const t = CASE_TEMPLATES[template];
  return (
    <div className="owner-cards">
      {t.cards.map((c) => {
        const drivers = t.drivers.filter((d) => d.card === c.id && (more || d.kind === "keyDriver" || d.benchmark === undefined));
        if (drivers.length === 0) return null;
        return (
          <fieldset key={c.id} className="owner-card">
            <legend>
              <span>{c.title}</span>
              <span className="owner-role">{c.owner}</span>
            </legend>
            <p className="muted small">{c.description}</p>
            <div className="fields">
              {drivers.map((d) => (
                <label key={d.key}>
                  <span>
                    {d.label}
                    {d.kind === "keyDriver" && <span className="badge key">Key driver</span>}
                  </span>
                  <input
                    className="input"
                    value={values[d.key] ?? ""}
                    placeholder={d.benchmark !== undefined && typeof d.benchmark !== "function" ? `benchmark ${d.benchmark}` : d.unit === "text" ? "" : "needs a number"}
                    title={d.ask}
                    onChange={(e) => onChange(d.key, e.target.value)}
                  />
                  <small className="help">{d.ask}</small>
                </label>
              ))}
            </div>
            <p className="formula"><span>ƒ</span> {c.formula}</p>
          </fieldset>
        );
      })}
    </div>
  );
}

const YEARS = ["Current", "Year 1", "Year 2", "Year 3"];

function cell(v: number | null, unit: RowUnit) {
  if (v === null) return "";
  return rowValue(v, unit);
}

function RowsTable({ rows, label }: { rows: ModelRow[]; label: string }) {
  return (
    <div className="table-wrap">
      <table className="model" aria-label={label}>
        <thead>
          <tr>
            <th />
            {YEARS.map((y) => <th key={y}>{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === "header" ? (
              <tr key={r.key} className="section"><th colSpan={5}>{r.label}</th></tr>
            ) : (
              <tr key={r.key} className={r.kind}>
                <th title={r.formula}>
                  {r.label}
                  {r.keyDriver && <span className="dot" title="Key driver" />}
                  {r.formula && <small className="row-formula">{r.formula}</small>}
                </th>
                {r.values.map((v, i) => <td key={i} className={v !== null && v < 0 ? "neg" : ""}>{cell(v, r.unit)}</td>)}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export type CaseTab = "model" | "unit" | "pnl" | "scenarios";
type Tab = CaseTab;
export const CASE_TABS: Array<{ id: Tab; label: string }> = [
  { id: "model", label: "Model" },
  { id: "unit", label: "Unit Economics" },
  { id: "pnl", label: "Summary P&L" },
  { id: "scenarios", label: "Scenarios" },
];

const VERDICT: Record<string, string> = { go: "go", pilot: "pilot", no_go: "no_go" };

/** The business-case memo: the call, the owner cards, the model in four tabs and every number's source. */
export function CaseMemoView({ memo, tabs = true }: { memo: CaseMemo; tabs?: boolean }) {
  const [tab, setTab] = useState<Tab>("model");
  const m = memo.metrics;
  const capacity = memo.capacityByYear ? memo.capacityByYear.reduce((a, b) => a + b, 0) : null;
  return (
    <div className="memo case">
      <p className="eyebrow">{memo.template.title}</p>
      <h2 className={`verdict ${VERDICT[memo.recommendation.option ?? ""] ?? ""}`}>{memo.recommendation.headline}</h2>
      <p className="small muted">
        Confidence {memo.recommendation.confidence} · {memo.status === "needs_human" ? "needs a human" : memo.status === "draft" ? "draft: a person should confirm some estimates" : "complete"}
      </p>
      <p>{memo.recommendation.why}</p>

      {m && (
        <div className="metrics">
          <div><span className="muted small">Net present value</span><strong className={m.npv < 0 ? "neg" : ""}>{usd(m.npv)}</strong><span className="muted small">at {m.discountRatePct}%</span></div>
          <div><span className="muted small">Return on investment</span><strong className={(m.roi ?? 0) < 0 ? "neg" : ""}>{m.roi === null ? "—" : `${Math.round(m.roi * 1000) / 10}%`}</strong><span className="muted small">3-year net ÷ cost</span></div>
          <div><span className="muted small">Payback</span><strong>{m.paybackMonths === null ? "Not in 3 yrs" : `${m.paybackMonths} mo`}</strong><span className="muted small">cumulative cash</span></div>
          {capacity !== null && <div><span className="muted small">Freed-up time</span><strong>{usd(capacity)}</strong><span className="muted small">capacity, not cash</span></div>}
        </div>
      )}

      <div className="owner-cards result-cards">
        {memo.cards.map((c) => (
          <div key={c.id} className="owner-card">
            <div className="owner-head">
              <strong>{c.title}</strong>
              <span className="owner-role">{c.owner}</span>
            </div>
            {c.headline && c.headline.value !== null ? (
              <p className="headline-metric"><span className="muted small">{c.headline.label}</span><strong className={c.headline.value < 0 ? "neg" : ""}>{rowValue(c.headline.value, c.headline.unit)}</strong></p>
            ) : (
              <p className="muted small">Not worked out yet.</p>
            )}
            <p className="formula"><span>ƒ</span> {c.formula}</p>
          </div>
        ))}
      </div>

      {m && tabs && (
        <>
          <div className="tabs" role="tablist">
            {CASE_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div role="tabpanel">
            <CaseTable memo={memo} tab={tab} />
          </div>
        </>
      )}

      <h3>Biggest risk</h3>
      <p>{memo.biggestRisk}</p>
      <h3>Questions a CFO will ask</h3>
      <ul>{memo.cfoQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
      {memo.guardrails.length > 0 && (
        <>
          <h3>Guardrails to track</h3>
          <ul>{memo.guardrails.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </>
      )}
      {memo.gaps.length > 0 && (
        <>
          <h3>Needs a human</h3>
          <ul>{memo.gaps.map((g) => <li key={g.key}><strong>{g.label}</strong>: {g.why}</li>)}</ul>
        </>
      )}

      <details className="every-number">
        <summary>Every number, with its source and owner ({memo.inputs.length})</summary>
        <div className="table-wrap">
          <table className="inputs">
            <tbody>
              {memo.inputs.map((i) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td className="num">{fmt(i.value, i.unit)}</td>
                  <td className="small">{i.source}</td>
                  <td><Badges i={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** One of the model tabs: Model, Unit Economics, Summary P&L or Scenarios. */
export function CaseTable({ memo, tab }: { memo: CaseMemo; tab: CaseTab }) {
  const capacity = memo.capacityByYear ? memo.capacityByYear.reduce((a, b) => a + b, 0) : null;
  if (!memo.metrics) return <p className="muted">The model fills in once the numbers only a person can give are in.</p>;
  return (
    <>
  {tab === "model" && <RowsTable rows={memo.model} label="Model" />}
  {tab === "unit" && <RowsTable rows={memo.unitEconomics} label="Unit economics" />}
  {tab === "pnl" && <RowsTable rows={memo.pnl} label="Summary P&L" />}
  {tab === "scenarios" && (
    <>
      <div className="table-wrap">
        <table className="model">
          <thead><tr><th /><th>Net cash, 3 years</th><th>Net present value</th><th>ROI</th><th>Payback</th>{capacity !== null && <th>Freed-up time</th>}</tr></thead>
          <tbody>
            {memo.scenarios.map((s) => (
              <tr key={s.id} className={s.id === "base" ? "total" : ""}>
                <th>{s.label}</th>
                <td className={s.metrics.cumulativeNet < 0 ? "neg" : ""}>{usd(s.metrics.cumulativeNet)}</td>
                <td className={s.metrics.npv < 0 ? "neg" : ""}>{usd(s.metrics.npv)}</td>
                <td>{s.metrics.roi === null ? "—" : `${Math.round(s.metrics.roi * 1000) / 10}%`}</td>
                <td>{s.metrics.paybackMonths === null ? "Not in 3 yrs" : `${s.metrics.paybackMonths} mo`}</td>
                {capacity !== null && <td>{usd(s.capacity ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{memo.scenarios[0]?.flex}. Assumptions stay as they are.</p>
    </>
  )}
    </>
  );
}

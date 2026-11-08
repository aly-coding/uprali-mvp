import type { Confidence, CostLine, FlipPoint, GivenValue, Input, Owner, Side, Unit } from "./types";

/**
 * Build vs buy for a software tool. All the arithmetic lives here, in code, so a model can
 * never change a number. The point it makes: a working prototype is only about a fifth of
 * the real work, and the rest (hardening, upkeep, security, integrations, on-call, the
 * builder leaving, and what the engineers didn't build instead) is where the money goes.
 */

export const TEMPLATE = {
  id: "build_vs_buy",
  title: "Build or buy a software tool",
  version: "2.0.0",
};

export interface FieldDef {
  key: string;
  label: string;
  unit: Unit;
  /** Shown to agents and people so they know what to give. */
  ask: string;
  /** Benchmark the analyst may use when nobody knows. Absent means only a person can answer. */
  benchmark?: number | string | ((v: Record<string, number | string | null>) => number);
  benchmarkSource?: string;
  /** Even with a benchmark, a person should confirm this before the decision is final. */
  humanShouldConfirm?: boolean;
  min?: number;
  max?: number;
}

export const FIELDS: FieldDef[] = [
  { key: "tool_name", label: "Tool you'd buy", unit: "text", ask: "Which product would you buy instead of building, for example HubSpot Starter?" },
  { key: "what_to_build", label: "What you'd build", unit: "text", ask: "In a few words, what would the team build?", benchmark: "an in-house replacement", benchmarkSource: "Default wording" },
  { key: "buy_annual_cost", label: "Subscription per year", unit: "usd_per_year", ask: "What does the tool cost per year, for every seat you need?", min: 0 },
  { key: "buy_setup_cost", label: "One-time setup to buy", unit: "usd", ask: "One-time cost to set the tool up: onboarding, migration, consultants.", benchmark: (v) => 0.1 * num(v.buy_annual_cost), benchmarkSource: "Benchmark: about 10% of the first year's subscription", min: 0 },
  { key: "buy_price_increase_pct", label: "Yearly price increase", unit: "pct", ask: "How much does the vendor raise prices each year?", benchmark: 7, benchmarkSource: "Benchmark: SaaS renewals commonly rise 5 to 10% a year", min: 0, max: 100 },
  { key: "buy_admin_hours_month", label: "Admin time for the tool", unit: "hours_per_month", ask: "Hours a month someone spends running the bought tool.", benchmark: 4, benchmarkSource: "Benchmark: a few hours a month of admin for a small team", min: 0 },
  { key: "prototype_weeks", label: "Engineer-weeks for a working prototype", unit: "weeks", ask: "How many engineer-weeks did (or would) a working prototype take?", humanShouldConfirm: true, min: 0.1 },
  { key: "prototype_share_pct", label: "Prototype's share of the real build", unit: "pct", ask: "What share of the production-ready build is the prototype?", benchmark: 20, benchmarkSource: "Benchmark: a demo is about 20% of production work; hardening, edge cases, tests and docs are the rest", min: 1, max: 100 },
  { key: "engineer_weekly_cost", label: "Cost of an engineer-week", unit: "usd_per_week", ask: "Fully loaded cost of one engineer for one week (salary, benefits, taxes).", benchmark: 4000, benchmarkSource: "Benchmark: about $200k a year fully loaded, divided by 50 weeks", humanShouldConfirm: true, min: 0 },
  { key: "integrations_count", label: "Integrations to build", unit: "count", ask: "How many other systems must the build connect to (email, billing, SSO and so on)?", benchmark: 2, benchmarkSource: "Benchmark: two integrations for a typical internal tool", min: 0 },
  { key: "integration_weeks_each", label: "Engineer-weeks per integration", unit: "weeks", ask: "Engineer-weeks to build each integration.", benchmark: 1, benchmarkSource: "Benchmark: about one engineer-week each", min: 0 },
  { key: "maintenance_pct", label: "Yearly upkeep", unit: "pct", ask: "Yearly upkeep as a share of the build cost: bug fixes, upgrades, API changes.", benchmark: 20, benchmarkSource: "Benchmark: 15 to 25% of build cost a year", min: 0, max: 200 },
  { key: "security_annual", label: "Security and compliance per year", unit: "usd_per_year", ask: "Yearly cost of security reviews, patching, access controls and audits for the build.", benchmark: 5000, benchmarkSource: "Benchmark: a small security review and patching budget", min: 0 },
  { key: "hosting_annual", label: "Hosting per year", unit: "usd_per_year", ask: "Yearly hosting, database and monitoring for the build.", benchmark: 1200, benchmarkSource: "Benchmark: about $100 a month for a small internal tool", min: 0 },
  { key: "oncall_hours_week", label: "On-call time", unit: "hours_per_week", ask: "Hours a week someone is on the hook when the build breaks.", benchmark: 2, benchmarkSource: "Benchmark: about two hours a week of support and incidents", min: 0 },
  { key: "builder_leaves_pct", label: "Chance the builder leaves each year", unit: "pct", ask: "Chance per year that the person who knows the build leaves.", benchmark: 15, benchmarkSource: "Benchmark: tech staff turnover of about 13 to 18% a year", min: 0, max: 100 },
  { key: "handover_weeks", label: "Engineer-weeks to take over the build", unit: "weeks", ask: "Engineer-weeks for someone new to learn the build if the builder leaves.", benchmark: 4, benchmarkSource: "Benchmark: about a month to take over an undocumented internal tool", min: 0 },
  { key: "opportunity_pct", label: "Value lost on the core product", unit: "pct", ask: "How much more an engineer-week earns on your core product than it costs, as a share of its cost.", benchmark: 50, benchmarkSource: "Benchmark: assume core product work returns 1.5x its cost", humanShouldConfirm: true, min: 0, max: 1000 },
  { key: "horizon_years", label: "Years to compare", unit: "years", ask: "Over how many years should we compare?", benchmark: 3, benchmarkSource: "Default: 3 years, the usual horizon for a software decision", min: 1, max: 10 },
];

const HOURS_PER_WEEK = 40;

export function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** Reads "$12k", "720", "20%", "about 3 weeks" into a number. Returns null if there's no number. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = raw.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(k|m|thousand|million)?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const mult = (m[2] || "").toLowerCase();
  if (mult === "k" || mult === "thousand") n *= 1_000;
  if (mult === "m" || mult === "million") n *= 1_000_000;
  return n;
}

export interface Extracted {
  key: string;
  value: number | string;
  quote: string;
}

/**
 * Merges what the caller passed, what was found in the question text, and benchmarks,
 * in that order of authority. Every result says who owns it and whether it is an assumption.
 */
export function resolveInputs(given: Record<string, GivenValue | undefined>, extracted: Extracted[]): Input[] {
  const raw: Record<string, number | string | null> = {};
  const out: Record<string, Input> = {};

  const fromGiven = (f: FieldDef, g: GivenValue): Input | null => {
    const obj = typeof g === "object" && g !== null ? g : { value: g };
    const value = f.unit === "text" ? String(obj.value).trim().slice(0, 120) : parseAmount(obj.value);
    if (value === null || value === "") return null;
    if (typeof value === "number" && !inRange(f, value)) return null;
    const owner: Owner = obj.owner ?? "human";
    const isAssumption = obj.is_assumption ?? owner === "agent";
    const confidence: Confidence = obj.confidence ?? (owner === "agent" ? "low" : isAssumption ? "medium" : "high");
    return {
      key: f.key,
      label: f.label,
      value,
      unit: f.unit,
      source: (obj.source ?? (owner === "agent" ? "Estimated by the calling agent" : "Provided by the person asking")).slice(0, 200),
      owner,
      isAssumption,
      confidence,
      needsHuman: owner === "agent" && !!f.humanShouldConfirm,
    };
  };

  for (const f of FIELDS) {
    const g = given[f.key];
    if (g !== undefined && g !== null && g !== "") {
      const inp = fromGiven(f, g);
      if (inp) out[f.key] = inp;
    }
    if (!out[f.key]) {
      const e = extracted.find((x) => x.key === f.key);
      if (e) {
        const value = f.unit === "text" ? String(e.value).trim().slice(0, 120) : parseAmount(e.value);
        if (value !== null && value !== "" && (typeof value !== "number" || inRange(f, value))) {
          const hedged = /\b(about|around|roughly|maybe|approx\w*|estimate|guess|ish)\b|~/i.test(e.quote);
          out[f.key] = {
            key: f.key,
            label: f.label,
            value,
            unit: f.unit,
            source: `Stated in the request: "${e.quote.slice(0, 140)}"`,
            owner: "human",
            isAssumption: hedged,
            confidence: hedged ? "medium" : "high",
            needsHuman: false,
          };
        }
      }
    }
    if (out[f.key]) raw[f.key] = out[f.key].value;
  }

  // Benchmarks last, once the stated values are known (some benchmarks depend on them).
  for (const f of FIELDS) {
    if (out[f.key]) continue;
    if (f.benchmark === undefined) {
      out[f.key] = { key: f.key, label: f.label, value: null, unit: f.unit, source: "Missing", owner: "human", isAssumption: false, confidence: "low", needsHuman: true };
      continue;
    }
    if (typeof f.benchmark === "function" && raw.buy_annual_cost == null) {
      // This benchmark depends on the subscription cost, which is still missing.
      out[f.key] = { key: f.key, label: f.label, value: null, unit: f.unit, source: "Waiting on the subscription cost", owner: "agent", isAssumption: true, confidence: "low", needsHuman: false };
      continue;
    }
    const value = typeof f.benchmark === "function" ? round(f.benchmark(raw)) : f.benchmark;
    raw[f.key] = value;
    out[f.key] = {
      key: f.key,
      label: f.label,
      value,
      unit: f.unit,
      source: f.benchmarkSource ?? "Benchmark",
      owner: "agent",
      isAssumption: true,
      confidence: "low",
      needsHuman: !!f.humanShouldConfirm,
    };
  }
  return FIELDS.map((f) => out[f.key]);
}

function inRange(f: FieldDef, v: number): boolean {
  return Number.isFinite(v) && (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max);
}

function round(n: number): number {
  return Math.round(n);
}

export type Values = Record<string, number>;

export function toValues(inputs: Input[]): Values {
  const v: Values = {};
  for (const i of inputs) if (typeof i.value === "number") v[i.key] = i.value;
  return v;
}

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function line(key: string, label: string, byYear: number[], how: string, inputs: string[]): CostLine {
  const r = byYear.map(round);
  return { key, label, byYear: r, total: r.reduce((a, b) => a + b, 0), how, inputs };
}

function years(v: Values): number {
  return Math.max(1, Math.min(10, Math.round(v.horizon_years || 3)));
}

export function buySide(v: Values): Side {
  const n = years(v);
  const inc = (v.buy_price_increase_pct ?? 0) / 100;
  const hourly = (v.engineer_weekly_cost ?? 0) / HOURS_PER_WEEK;
  const subs = Array.from({ length: n }, (_, y) => v.buy_annual_cost * Math.pow(1 + inc, y));
  const lines = [
    line("buy_subscription", "Subscription", subs, `${usd0(v.buy_annual_cost)} a year, rising ${v.buy_price_increase_pct}% a year`, ["buy_annual_cost", "buy_price_increase_pct"]),
    line("buy_setup", "Setup and migration", Array.from({ length: n }, (_, y) => (y === 0 ? v.buy_setup_cost : 0)), `${usd0(v.buy_setup_cost)} once, in year 1`, ["buy_setup_cost"]),
    line("buy_admin", "Admin time", Array.from({ length: n }, () => v.buy_admin_hours_month * 12 * hourly), `${v.buy_admin_hours_month} hours a month at ${usd0(hourly)} an hour`, ["buy_admin_hours_month", "engineer_weekly_cost"]),
  ];
  return sum(lines, n);
}

export function buildWeeks(v: Values): { full: number; integrations: number } {
  const share = Math.max(0.01, (v.prototype_share_pct ?? 20) / 100);
  return { full: v.prototype_weeks / share, integrations: v.integrations_count * v.integration_weeks_each };
}

export function buildSide(v: Values): Side {
  const n = years(v);
  const w = v.engineer_weekly_cost;
  const hourly = w / HOURS_PER_WEEK;
  const { full, integrations } = buildWeeks(v);
  const buildCost = full * w;
  const integrationCost = integrations * w;
  const capex = buildCost + integrationCost;
  const once = (x: number) => Array.from({ length: n }, (_, y) => (y === 0 ? x : 0));
  const yearly = (x: number) => Array.from({ length: n }, () => x);
  const lines = [
    line("build_prototype", "Working prototype", once(v.prototype_weeks * w), `${round1(v.prototype_weeks)} engineer-weeks at ${usd0(w)}`, ["prototype_weeks", "engineer_weekly_cost"]),
    line("build_production", "Making it production-ready", once(buildCost - v.prototype_weeks * w), `The prototype is ${v.prototype_share_pct}% of the work, so the full build is ${round1(full)} engineer-weeks`, ["prototype_weeks", "prototype_share_pct", "engineer_weekly_cost"]),
    line("build_integrations", "Integrations", once(integrationCost), `${v.integrations_count} integrations at ${round1(v.integration_weeks_each)} engineer-week${v.integration_weeks_each === 1 ? "" : "s"} each`, ["integrations_count", "integration_weeks_each", "engineer_weekly_cost"]),
    line("build_maintenance", "Upkeep", yearly((v.maintenance_pct / 100) * capex), `${v.maintenance_pct}% of the ${usd0(capex)} build cost each year`, ["maintenance_pct"]),
    line("build_security", "Security and compliance", yearly(v.security_annual), `${usd0(v.security_annual)} a year`, ["security_annual"]),
    line("build_hosting", "Hosting", yearly(v.hosting_annual), `${usd0(v.hosting_annual)} a year`, ["hosting_annual"]),
    line("build_oncall", "Someone on call", yearly(v.oncall_hours_week * 52 * hourly), `${v.oncall_hours_week} hours a week at ${usd0(hourly)} an hour`, ["oncall_hours_week", "engineer_weekly_cost"]),
    line("build_knowledge_loss", "Knowledge lost if the builder leaves", yearly((v.builder_leaves_pct / 100) * v.handover_weeks * w), `${v.builder_leaves_pct}% chance a year, times ${round1(v.handover_weeks)} engineer-weeks to take over`, ["builder_leaves_pct", "handover_weeks", "engineer_weekly_cost"]),
    line("build_opportunity", "Core product work not done", once((v.opportunity_pct / 100) * (full + integrations) * w), `${round1(full + integrations)} engineer-weeks off the core product, which returns ${v.opportunity_pct}% more than it costs`, ["opportunity_pct", "prototype_weeks", "prototype_share_pct", "integrations_count", "integration_weeks_each", "engineer_weekly_cost"]),
  ];
  return sum(lines, n);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sum(lines: CostLine[], n: number): Side {
  const byYear = Array.from({ length: n }, (_, y) => lines.reduce((a, l) => a + l.byYear[y], 0));
  return { total: byYear.reduce((a, b) => a + b, 0), byYear, lines };
}

/** The yearly subscription at which buying costs the same as building over the horizon. */
export function breakEvenSubscription(v: Values): number {
  const n = years(v);
  const inc = (v.buy_price_increase_pct ?? 0) / 100;
  const factor = Array.from({ length: n }, (_, y) => Math.pow(1 + inc, y)).reduce((a, b) => a + b, 0);
  const b = buySide(v);
  const nonSubscription = b.total - b.lines[0].total;
  return Math.max(0, (buildSide(v).total - nonSubscription) / factor);
}

/** For each estimate, the value at which the recommendation would flip, if one is in a plausible range. */
export function flipPoints(v: Values, inputs: Input[], limit = 3): FlipPoint[] {
  const gap = (x: Values) => buildSide(x).total - buySide(x).total; // > 0 means buy wins
  const base = gap(v);
  const out: FlipPoint[] = [];
  for (const inp of inputs) {
    if (typeof inp.value !== "number" || inp.key === "horizon_years") continue;
    const f = FIELDS.find((x) => x.key === inp.key)!;
    const cur = inp.value;
    const hi = f.max ?? Math.max(cur * 10, 10);
    const lo = f.min ?? 0;
    const at = (x: number) => gap({ ...v, [inp.key]: x });
    let flip: number | null = null;
    for (const [a0, b0] of [[cur, hi], [lo, cur]] as const) {
      let a = a0, b = b0;
      if (Math.sign(at(a)) === Math.sign(at(b)) || at(b) === 0) continue;
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        if (Math.sign(at(m)) === Math.sign(base)) a = m;
        else b = m;
      }
      flip = (a + b) / 2;
      break;
    }
    if (flip === null || !Number.isFinite(flip)) continue;
    const ratio = Math.abs(flip / (cur || 1));
    if (ratio > 5 || ratio < 0.2) continue; // outside a plausible range
    out.push({
      key: inp.key,
      label: inp.label,
      current: cur,
      flipAt: unitRound(flip, inp.unit),
      text: `If ${inp.label.toLowerCase()} were ${fmt(unitRound(flip, inp.unit), inp.unit)} instead of ${fmt(cur, inp.unit)}, ${base > 0 ? "building" : "buying"} would come out ahead.`,
    });
  }
  return out.sort((a, b) => Math.abs(a.flipAt / (a.current || 1) - 1) - Math.abs(b.flipAt / (b.current || 1) - 1)).slice(0, limit);
}

function unitRound(n: number, unit: Unit): number {
  if (unit === "pct" || unit === "weeks" || unit === "hours_per_week" || unit === "hours_per_month") return Math.round(n * 10) / 10;
  if (unit === "count" || unit === "years") return Math.round(n);
  return Math.round(n);
}

export function fmt(v: number | string | null, unit: Unit): string {
  if (v === null) return "missing";
  if (typeof v === "string") return v;
  switch (unit) {
    case "usd":
      return usd0(v);
    case "usd_per_year":
      return `${usd0(v)} a year`;
    case "usd_per_week":
      return `${usd0(v)} a week`;
    case "pct":
      return `${v}%`;
    case "weeks":
      return `${v} engineer-week${v === 1 ? "" : "s"}`;
    case "hours_per_week":
      return `${v} hours a week`;
    case "hours_per_month":
      return `${v} hours a month`;
    case "years":
      return `${v} year${v === 1 ? "" : "s"}`;
    default:
      return String(v);
  }
}

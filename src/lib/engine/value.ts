/**
 * Return on investment, measured against the status quo. The rules come from Aly's finance
 * playbook (the completed buy vs build business definition and the CFO decision-making notes):
 *
 * - Three options. The status quo is the baseline, with no new spend and no new benefit.
 * - Cash and capacity are kept apart. Only savings Finance confirms count as cash (net ROI and
 *   payback). Freed-up time is operational capacity: it shows in gross ROI, which is not cash.
 * - Year 1 benefits are prorated by time to value, so a tool that goes live in month 4 earns
 *   nine months of benefit, not twelve.
 * - Vendor cost is incremental: what you'd pay minus what you pay today.
 * - Opportunity cost is recorded, but kept out of ROI and payback.
 * - Payback is interpolated inside the year cumulative cash crosses zero; past 36 months it's
 *   "Beyond 36 months", with no number.
 * - A missing input is never treated as zero. The result says what is missing instead.
 */
import type { Side } from "./types";

export type OptionKey = "status_quo" | "buy" | "build";
export type RoiType = "hard" | "strategic" | "risk";

export const PAYBACK_LIMIT_MONTHS = 36;

export interface Payback {
  months: number | null;
  years: number | null;
  text: string;
}

export interface OptionValue {
  option: OptionKey;
  label: string;
  investmentByYear: number[];
  investment: number;
  /** Confirmed cash benefit per year, or null when nobody has confirmed any savings. */
  financialByYear: number[] | null;
  financial: number | null;
  /** Value of the time freed per year, or null when the inputs for it are missing. Not cash. */
  capacityByYear: number[] | null;
  capacity: number | null;
  timeToValueMonths: number | null;
  /** (cash benefit - investment) / investment, rounded to 6 places. */
  netRoi: number | null;
  /** Adds the capacity value to the cash benefit. Not cash. */
  grossRoi: number | null;
  payback: Payback;
}

export interface Scenario {
  name: "base" | "conservative" | "optimistic";
  label: string;
  timeReductionPct: number;
  adoptionPct: number;
  buy: { capacity: number | null; grossRoi: number | null };
  build: { capacity: number | null; grossRoi: number | null };
}

export interface ValueCase {
  options: OptionValue[];
  scenarios: Scenario[] | null;
  roiType: RoiType | null;
  opportunity: { text: string; estimatedCost: number | null; note: string };
  /** Plain-words notes on what the numbers assume or still need. */
  notes: string[];
  missing: Array<{ key: string; label: string; why: string }>;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const trunc = (n: number, dp: number) => Math.floor(n * 10 ** dp + 1e-9) / 10 ** dp;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Share of each year a benefit is earned, once it starts after `ttvMonths`. */
export function activeShare(ttvMonths: number, years: number): number[] {
  return Array.from({ length: years }, (_, y) => Math.min(12, Math.max(0, 12 * (y + 1) - ttvMonths)) / 12);
}

/** Months until cumulative cash (benefit minus investment) reaches zero, interpolated inside the year. */
export function payback(investmentByYear: number[], financialByYear: number[] | null, limitMonths = PAYBACK_LIMIT_MONTHS): Payback {
  if (!financialByYear) return { months: null, years: null, text: "Needs confirmed savings" };
  let cum = 0;
  for (let y = 0; y < investmentByYear.length; y++) {
    const net = financialByYear[y] - investmentByYear[y];
    if (cum + net >= 0 && net > 0) {
      const months = 12 * y + (cum < 0 ? (-cum / net) * 12 : 0);
      if (months > limitMonths) break;
      return { months: trunc(months, 1), years: trunc(months / 12, 2), text: `${trunc(months, 1)} months (${trunc(months / 12, 2)} years)` };
    }
    cum += net;
  }
  return { months: null, years: null, text: `Beyond ${limitMonths} months` };
}

export interface OptionValueInput {
  option: OptionKey;
  label: string;
  investmentByYear: number[];
  confirmedAnnual: number | null;
  capacityAnnual: number | null;
  ttvMonths: number;
}

/** Pure value maths for one option. The worked example in the playbook is its regression test. */
export function optionValue(i: OptionValueInput): OptionValue {
  const n = i.investmentByYear.length;
  const share = activeShare(i.ttvMonths, n);
  const investmentByYear = i.investmentByYear.map((x) => Math.round(x));
  const investment = sum(investmentByYear);
  const financialByYear = i.confirmedAnnual === null ? null : share.map((s) => Math.round(s * i.confirmedAnnual!));
  const capacityByYear = i.capacityAnnual === null ? null : share.map((s) => Math.round(s * i.capacityAnnual!));
  const financial = financialByYear ? sum(financialByYear) : null;
  const capacity = capacityByYear ? sum(capacityByYear) : null;
  const roi = (benefit: number | null) => (benefit === null || investment <= 0 ? null : round6((benefit - investment) / investment));
  return {
    option: i.option,
    label: i.label,
    investmentByYear,
    investment,
    financialByYear,
    financial,
    capacityByYear,
    capacity,
    timeToValueMonths: i.ttvMonths,
    netRoi: roi(financial),
    grossRoi: financial === null || capacity === null ? null : roi(financial + capacity),
    payback: payback(investmentByYear, financialByYear),
  };
}

export function statusQuo(years: number): OptionValue {
  const zeros = Array.from({ length: years }, () => 0);
  return {
    option: "status_quo",
    label: "Keep things as they are",
    investmentByYear: zeros,
    investment: 0,
    financialByYear: zeros,
    financial: 0,
    capacityByYear: zeros,
    capacity: 0,
    timeToValueMonths: null,
    netRoi: null,
    grossRoi: null,
    payback: { months: null, years: null, text: "Not applicable" },
  };
}

export function normalizeRoiType(raw: unknown): RoiType | null {
  if (typeof raw !== "string") return null;
  const t = raw.toLowerCase();
  if (/risk|secur|complian|reliab|downside|outage|audit/.test(t)) return "risk";
  if (/strateg|retention|retain|pricing|defens|platform|growth|nrr|segment/.test(t)) return "strategic";
  if (/hard|cash|cost|saving|avoid|margin|profit/.test(t)) return "hard";
  return null;
}

type V = Record<string, number | string | null>;
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Value of freed time per year: hours x time saved x adoption x hourly cost. Null if any is missing. */
export function capacityValue(v: V, reductionPct = num(v.time_reduction_pct), adoptionPct = num(v.adoption_pct)): number | null {
  const hours = num(v.work_hours_year), rate = num(v.staff_hourly_cost);
  if (hours === null || rate === null || reductionPct === null || adoptionPct === null) return null;
  return Math.round(hours * (reductionPct / 100) * (adoptionPct / 100) * rate);
}

const LABELS: Record<string, string> = {
  confirmed_annual_savings: "Confirmed cash savings per year",
  work_hours_year: "Hours a year spent on this work today",
  time_reduction_pct: "Time saved when it's used",
  staff_hourly_cost: "Loaded cost of an hour of their time",
  current_annual_cost: "What you pay today for this job",
  roi_type: "Kind of return",
};

/** Builds the three-option value case from the cost sides and the value inputs. */
export function valueCase(v: V, buy: Side, build: Side): ValueCase {
  const years = buy.byYear.length;
  const current = num(v.current_annual_cost);
  const today = current ?? 0;
  const opportunityLine = build.lines.find((l) => l.key === "build_opportunity");
  const opportunityByYear = opportunityLine?.byYear ?? Array.from({ length: years }, () => 0);
  const confirmed = num(v.confirmed_annual_savings);
  const missing: ValueCase["missing"] = [];
  const notes: string[] = [];

  // Incremental cost: what each option costs minus what you already pay. Anything below zero is
  // a cost that goes away, which is cash, so it moves to the benefit side once savings are confirmed.
  const split = (byYear: number[], extra: number[] = []) => {
    const inc = byYear.map((x, y) => x - (extra[y] ?? 0) - today);
    return { investment: inc.map((x) => Math.max(0, x)), avoided: inc.map((x) => Math.max(0, -x)) };
  };
  const buySplit = split(buy.byYear);
  const buildSplit = split(build.byYear, opportunityByYear);
  const cap = capacityValue(v);
  const buyTtv = num(v.buy_time_to_value_months) ?? 3;
  const buildTtv = num(v.build_time_to_value_months) ?? 6;

  const make = (option: "buy" | "build", label: string, s: { investment: number[]; avoided: number[] }, ttv: number, capacityAnnual = cap): OptionValue => {
    const base = optionValue({ option, label, investmentByYear: s.investment, confirmedAnnual: confirmed, capacityAnnual, ttvMonths: ttv });
    if (confirmed === null || !s.avoided.some((x) => x > 0)) return base;
    // Add the avoided vendor cost to cash benefit (it isn't prorated: the old bill stops when you switch).
    const financialByYear = base.financialByYear!.map((x, y) => x + Math.round(s.avoided[y]));
    const financial = sum(financialByYear);
    const roi = (b: number | null) => (b === null || base.investment <= 0 ? null : round6((b - base.investment) / base.investment));
    return { ...base, financialByYear, financial, netRoi: roi(financial), grossRoi: base.capacity === null ? null : roi(financial + base.capacity), payback: payback(base.investmentByYear, financialByYear) };
  };

  const options = [statusQuo(years), make("buy", "Buy", buySplit, buyTtv), make("build", "Build", buildSplit, buildTtv)];

  if (current === null) {
    notes.push("Assumed you pay nothing today for this job. If you do, both options cost less than shown here.");
    missing.push({ key: "current_annual_cost", label: LABELS.current_annual_cost, why: "Both options are measured against what you pay today." });
  }
  if (confirmed === null) {
    missing.push({ key: "confirmed_annual_savings", label: LABELS.confirmed_annual_savings, why: "Net ROI and payback count only cash Finance confirms. Enter 0 if there is none." });
  }
  const capKeys = ["work_hours_year", "time_reduction_pct", "staff_hourly_cost"].filter((k) => num(v[k]) === null);
  for (const k of capKeys) missing.push({ key: k, label: LABELS[k], why: "Needed to value the time people get back. That value is capacity, not cash." });
  notes.push(`Benefits start after time to value: ${buyTtv} months for buying, ${buildTtv} for building, so year 1 counts only the months after launch.`);

  let scenarios: Scenario[] | null = null;
  const r = num(v.time_reduction_pct), a = num(v.adoption_pct);
  if (cap !== null && r !== null && a !== null) {
    const clamp = (x: number) => Math.min(100, Math.round(x * 10) / 10);
    const defs: Array<[Scenario["name"], string, number, number]> = [
      ["conservative", "Conservative", clamp(r * 0.5), clamp(a * 0.75)],
      ["base", "Base", r, a],
      ["optimistic", "Optimistic", clamp(r * 1.5), clamp(a * 1.125)],
    ];
    scenarios = defs.map(([name, label, rr, aa]) => {
      const c = capacityValue(v, rr, aa);
      const b = make("buy", "Buy", buySplit, buyTtv, c), d = make("build", "Build", buildSplit, buildTtv, c);
      return { name, label, timeReductionPct: rr, adoptionPct: aa, buy: { capacity: b.capacity, grossRoi: b.grossRoi }, build: { capacity: d.capacity, grossRoi: d.grossRoi } };
    });
    notes.push("Scenarios change only time saved and adoption. Cash ROI and payback stay the same, because they count only confirmed savings.");
  }

  const displaced = typeof v.displaced_initiative === "string" && v.displaced_initiative.trim() ? v.displaced_initiative.trim() : null;
  const opportunity = {
    text: displaced ? `If you build, this waits: ${displaced}.` : "Strategic opportunity cost, not quantified.",
    estimatedCost: opportunityLine ? opportunityLine.total : null,
    note: "Recorded with the decision, but kept out of ROI and payback.",
  };
  const roiType = normalizeRoiType(v.roi_type);
  if (!roiType) missing.push({ key: "roi_type", label: LABELS.roi_type, why: "Hard (cash), strategic (retention, pricing) or risk (security, compliance). It decides which test the case has to pass." });

  return { options, scenarios, roiType, opportunity, notes, missing };
}

export interface Funding {
  /** Reasons a CFO funds an investment. met is null when only a person can say. */
  criteria: Array<{ label: string; met: boolean | null; why: string }>;
  /** Reasons for "not now". flagged is null when only a person can say. */
  notNow: Array<{ reason: string; flagged: boolean | null; why: string }>;
}

export interface KillCriteria {
  option: "buy" | "build";
  metric: string;
  window: string;
  minimumEffect: string;
  /** The person who checks the result and can stop it. Null until someone names them. */
  owner: string | null;
  fallback: string;
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The CFO funding check and the "not now" reasons, for the option the memo recommends. */
export function fundingCheck(vc: ValueCase, chosen: "buy" | "build" | "status_quo" | null, buy: Side, build: Side): Funding {
  const pick = vc.options.find((o) => o.option === (chosen === "build" ? "build" : "buy"))!;
  const confirmed = pick.financial !== null;
  const hasCapacity = pick.capacity !== null;
  const criteria: Funding["criteria"] = [
    {
      label: "Reduces a major cost driver",
      met: !confirmed ? null : pick.netRoi !== null ? pick.netRoi > 0 : pick.investment <= 0,
      why: !confirmed
        ? "Needs confirmed cash savings to tell."
        : pick.netRoi !== null
          ? `Net ROI over the horizon is ${Math.round(pick.netRoi * 1000) / 10}% on confirmed savings.`
          : "It costs no more than what you pay today.",
    },
    {
      label: "Protects against downside (security, compliance, reliability)",
      met: vc.roiType === "risk" ? true : vc.roiType ? false : null,
      why: vc.roiType === "risk" ? "The return was described as risk reduction." : vc.roiType ? `The return was described as ${vc.roiType}, not risk.` : "Only a person can say whether this lowers a real risk.",
    },
    {
      label: "Improves retention or unlocks pricing",
      met: vc.roiType === "strategic" ? true : vc.roiType ? false : null,
      why: vc.roiType === "strategic" ? "The return was described as strategic." : vc.roiType ? `The return was described as ${vc.roiType}, not strategic.` : "Only a person can say whether customers would notice.",
    },
    {
      label: "Has a leading indicator you can measure early",
      met: hasCapacity ? true : null,
      why: hasCapacity ? "Hours spent on the work can be tracked from the first month." : "Give the hours spent today and the time saved to set one.",
    },
  ];
  const buildUpkeep = build.byYear.length > 1 ? build.byYear[1] : build.byYear[0];
  const buyUpkeep = buy.byYear.length > 1 ? buy.byYear[1] : buy.byYear[0];
  const notNow: Funding["notNow"] = [
    {
      reason: "No clear link from the change to a financial result",
      flagged: !confirmed && !hasCapacity,
      why: !confirmed && !hasCapacity ? "Neither confirmed savings nor time saved were given." : "The benefit is tied to cash or to hours that can be measured.",
    },
    {
      reason: "The benefit is spread thin or hard to measure",
      flagged: confirmed && hasCapacity ? (pick.financial ?? 0) <= 0 : null,
      why: confirmed && hasCapacity && (pick.financial ?? 0) <= 0 ? "All the benefit is time freed up, with no confirmed cash." : "Check that the freed time turns into something the business uses.",
    },
    {
      reason: "Heavy ongoing support for little leverage",
      flagged: chosen === "build" ? buildUpkeep > buyUpkeep : false,
      why: chosen === "build"
        ? `Running the build costs about ${usd(buildUpkeep)} a year after launch, against ${usd(buyUpkeep)} a year to buy.`
        : `Buying leaves upkeep with the vendor. Building would cost about ${usd(buildUpkeep)} a year to run.`,
    },
    { reason: "Takes revenue from a higher-margin line", flagged: null, why: "Only a person can say." },
    { reason: "Adds complexity that raises costs or slows future shipping", flagged: null, why: "Only a person can say." },
  ];
  return { criteria, notNow };
}

/** What has to move, by when, and who can stop it: makes the decision reversible. */
export function killCriteriaFor(vc: ValueCase, chosen: "buy" | "build", owner: string | null, v: Record<string, number | string | null>): KillCriteria {
  const o = vc.options.find((x) => x.option === chosen)!;
  const ttv = o.timeToValueMonths ?? (chosen === "buy" ? 3 : 6);
  const r = num(v.time_reduction_pct), a = num(v.adoption_pct);
  const confirmed = num(v.confirmed_annual_savings);
  let metric: string, minimumEffect: string;
  if (r !== null && a !== null && num(v.work_hours_year) !== null) {
    const effect = Math.round(((r * a) / 100) * 10) / 10;
    metric = "Hours spent on this work, against today";
    minimumEffect = `At least ${Math.round(effect * 5) / 10}% fewer hours (half the ${effect}% the case expects)`;
  } else if (confirmed !== null && confirmed > 0) {
    metric = "Confirmed savings showing in the books";
    minimumEffect = `At least ${usd(confirmed / 2)} a year (half of the ${usd(confirmed)} expected)`;
  } else {
    metric = "Needs a human: the one number that must move";
    minimumEffect = "Needs a human";
  }
  return {
    option: chosen,
    metric,
    window: `${ttv + 3} months from the start (${ttv} months to go live, plus 3 to see the effect)`,
    minimumEffect,
    owner,
    fallback: chosen === "buy" ? "Cancel before the next renewal and keep things as they are." : "Stop the build and buy the tool instead.",
  };
}

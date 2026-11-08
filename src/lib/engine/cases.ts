import type { FieldDef } from "./buildVsBuy";
import type { Unit } from "./types";

/**
 * Driver-based business-case templates: launch a product, expand to a new
 * market, and the return on an AI investment. Each one is a set of drivers grouped into owner
 * cards, and a three-year model worked out in code, so a model can never change a number.
 * Build vs buy keeps its own, deeper engine in buildVsBuy.ts.
 */

export type CaseTemplateId = "new_product" | "gtm_expansion" | "ai_investment";
export const CASE_TEMPLATE_IDS: CaseTemplateId[] = ["new_product", "gtm_expansion", "ai_investment"];
export const ALL_TEMPLATE_IDS = ["build_vs_buy", ...CASE_TEMPLATE_IDS] as const;
export type TemplateId = (typeof ALL_TEMPLATE_IDS)[number];

export interface CaseDriver extends FieldDef {
  card: string;
  /** Key drivers move in scenarios. Assumptions stay as they are. */
  kind: "assumption" | "keyDriver";
  /** For key drivers: "up" if more of it is good for the case, "down" if less is. */
  favorable?: "up" | "down";
  /** Rule-based reading of the request when no model is set up. The first group is the number. */
  hint?: RegExp;
}

export interface CaseCard {
  id: string;
  title: string;
  /** The role that should stand behind these numbers. */
  owner: string;
  description: string;
  formula: string;
}

export type RowUnit = "usd" | "count" | "pct" | "hours" | "months" | "ratio";

export interface ModelRow {
  key: string;
  label: string;
  /** Card id the row belongs to, or "result". */
  section: string;
  kind: "header" | "driver" | "computed" | "total";
  unit: RowUnit;
  /** Current, Year 1, Year 2, Year 3. Null where it doesn't apply. */
  values: Array<number | null>;
  formula?: string;
  keyDriver?: boolean;
}

export interface CaseOutcome {
  model: ModelRow[];
  unitEconomics: ModelRow[];
  pnl: ModelRow[];
  /** Cash benefit, cost and net by year (Year 1 to 3). */
  benefitByYear: number[];
  costByYear: number[];
  netByYear: number[];
  /** Freed-up time valued in dollars that isn't cash (AI investment only). */
  capacityByYear?: number[];
  headlines: Record<string, { label: string; value: number | null; unit: RowUnit }>;
  guardrails: string[];
}

export interface CaseTemplate {
  id: CaseTemplateId;
  title: string;
  description: string;
  /** Example request, filled in when someone picks the template. */
  prompt: string;
  cards: CaseCard[];
  drivers: CaseDriver[];
  version: string;
  compute(v: Record<string, number | string>): CaseOutcome;
  /** What the "go" option is called in plain words, e.g. "Launch the product". */
  goLabel: string;
}

const YEARS = [1, 2, 3];
const r0 = (n: number) => Math.round(n);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const n = (v: Record<string, number | string>, k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
const row = (key: string, label: string, section: string, kind: ModelRow["kind"], unit: RowUnit, values: Array<number | null>, extra: Partial<ModelRow> = {}): ModelRow => ({
  key,
  label,
  section,
  kind,
  unit,
  values: values.map((x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100)),
  ...extra,
});
const header = (key: string, label: string) => row(key, label, key, "header", "usd", [null, null, null, null]);

const DISCOUNT: CaseDriver = {
  key: "discount_rate_pct",
  label: "Discount rate",
  unit: "pct",
  ask: "What yearly rate should future cash be discounted at (your cost of capital)?",
  benchmark: 10,
  benchmarkSource: "Uprali default for a small company's cost of capital; Finance should set its own",
  min: 0,
  max: 60,
  card: "finance",
  kind: "assumption",
};

const FINANCE_CARD: CaseCard = {
  id: "finance",
  title: "Financial impact",
  owner: "Finance · FP&A lead",
  description: "Turns the yearly net into net present value, return on investment and payback.",
  formula: "NPV = Σ net in year t ÷ (1 + discount rate)^t",
};

// ---------------------------------------------------------------- Launch a new product

const newProduct: CaseTemplate = {
  id: "new_product",
  title: "Launch a New Product",
  description: "Model the three-year P&L, investment and unit economics for a new product.",
  prompt:
    "Build a three-year business case for launching a new B2B SaaS product. We expect 60 customers in year one at $299 a month each, and the first version costs $60,000 to build.",
  version: "1.0.0",
  goLabel: "Launch the product",
  cards: [
    { id: "commercial", title: "Commercial", owner: "Sales · Revenue lead", description: "How many customers sign up, what they pay and how many stay.", formula: "Customers(t) = Customers(t−1) × (1 − churn) + New(t); New(t) = New(t−1) × (1 + growth)" },
    { id: "gtm", title: "Go-to-market", owner: "Marketing · Growth lead", description: "What it costs to win each customer and to keep the brand visible.", formula: "Acquisition = New customers × CAC + fixed marketing" },
    { id: "product", title: "Product & engineering", owner: "Engineering · Product lead", description: "Building the first version, the team that runs it and the cost to serve each customer.", formula: "Cost to serve = Customers × hosting per customer × 12 + revenue × support and payments %" },
    FINANCE_CARD,
  ],
  drivers: [
    { key: "new_customers_y1", label: "New customers in year 1", unit: "count", ask: "How many paying customers do you expect to sign in the first year?", card: "commercial", kind: "keyDriver", favorable: "up", min: 0, max: 10_000_000, hint: /(\d[\d,]*)\s+(?:paying\s+)?customers?\s+in\s+(?:the\s+)?(?:first\s+year|year\s+one|year\s+1)/i },
    { key: "new_customer_growth_pct", label: "Growth in new customers each year", unit: "pct", ask: "By what percent do yearly sign-ups grow after year 1?", benchmark: 50, benchmarkSource: "Uprali default for an early-stage product; Sales should confirm", humanShouldConfirm: true, card: "commercial", kind: "keyDriver", favorable: "up", min: -100, max: 1000 },
    { key: "price_per_month", label: "Price per customer per month", unit: "usd", ask: "What will one customer pay per month?", card: "commercial", kind: "keyDriver", favorable: "up", min: 0, max: 1_000_000, hint: /\$\s?([\d,.]+k?)\s*(?:a|per|\/)\s*month/i },
    { key: "annual_churn_pct", label: "Customers lost each year", unit: "pct", ask: "What share of customers cancel each year?", benchmark: 15, benchmarkSource: "Common range for small-business SaaS (10 to 20% a year)", card: "commercial", kind: "assumption", min: 0, max: 100 },
    { key: "cac", label: "Cost to acquire a customer (CAC)", unit: "usd", ask: "What do sales and marketing spend to win one customer?", benchmark: 800, benchmarkSource: "Uprali default for low-touch B2B SaaS; Marketing should confirm", humanShouldConfirm: true, card: "gtm", kind: "keyDriver", favorable: "down", min: 0, max: 10_000_000 },
    { key: "marketing_fixed_per_year", label: "Fixed marketing per year", unit: "usd_per_year", ask: "What's the fixed marketing budget a year, beyond paying for each customer?", benchmark: 20_000, benchmarkSource: "Uprali default: a modest launch and content budget", card: "gtm", kind: "assumption", min: 0, max: 1e9 },
    { key: "build_cost", label: "Cost to build the first version", unit: "usd", ask: "What does it cost to build the first version?", card: "product", kind: "assumption", min: 0, max: 1e10, hint: /\$\s?([\d,.]+k?)\s*to\s+build/i },
    { key: "team_cost_per_year", label: "Team to run and improve it, per year", unit: "usd_per_year", ask: "What does the team that keeps building and running it cost a year?", benchmark: 80_000, benchmarkSource: "Uprali default: about half of one engineer's fully loaded cost", humanShouldConfirm: true, card: "product", kind: "assumption", min: 0, max: 1e10 },
    { key: "hosting_per_customer_month", label: "Hosting per customer per month", unit: "usd", ask: "What does it cost to host and serve one customer a month?", benchmark: 5, benchmarkSource: "Typical cloud cost per account for a small SaaS", card: "product", kind: "assumption", min: 0, max: 100_000 },
    { key: "support_payments_pct", label: "Support and payment fees, share of revenue", unit: "pct", ask: "What share of revenue goes to support and payment processing?", benchmark: 8, benchmarkSource: "Card fees (about 3%) plus light support", card: "product", kind: "assumption", min: 0, max: 100 },
    DISCOUNT,
  ],
  compute(v) {
    const churn = n(v, "annual_churn_pct") / 100;
    const g = n(v, "new_customer_growth_pct") / 100;
    const price = n(v, "price_per_month");
    const newC: number[] = [];
    const endC: number[] = [];
    const avgC: number[] = [];
    let prevEnd = 0;
    for (const y of YEARS) {
      const nw = y === 1 ? n(v, "new_customers_y1") : newC[y - 2] * (1 + g);
      const end = prevEnd * (1 - churn) + nw;
      newC.push(nw);
      endC.push(end);
      avgC.push((prevEnd + end) / 2);
      prevEnd = end;
    }
    const revenue = avgC.map((c) => c * price * 12);
    const serve = avgC.map((c, i) => c * n(v, "hosting_per_customer_month") * 12 + revenue[i] * (n(v, "support_payments_pct") / 100));
    const gross = revenue.map((x, i) => x - serve[i]);
    const acq = newC.map((c) => c * n(v, "cac"));
    const mkt = YEARS.map(() => n(v, "marketing_fixed_per_year"));
    const team = YEARS.map(() => n(v, "team_cost_per_year"));
    const build = [n(v, "build_cost"), 0, 0];
    const cost = YEARS.map((_, i) => serve[i] + acq[i] + mkt[i] + team[i] + build[i]);
    const net = YEARS.map((_, i) => revenue[i] - cost[i]);
    const ebitda = YEARS.map((_, i) => gross[i] - acq[i] - mkt[i] - team[i]);
    const gm = revenue[2] > 0 ? gross[2] / revenue[2] : null;
    const contributionPerMonth = price * (gm ?? 0);
    const ltv = churn > 0 ? (price * 12 * (gm ?? 0)) / churn : null;
    const cac = n(v, "cac");
    return {
      model: [
        header("commercial", "Commercial"),
        row("new_customers", "New customers", "commercial", "driver", "count", [null, ...newC], { keyDriver: true, formula: "Year 1 as given, then × (1 + growth)" }),
        row("customers_end", "Customers at year end", "commercial", "computed", "count", [0, ...endC], { formula: "Last year × (1 − churn) + new" }),
        row("price", "Price per customer per month", "commercial", "driver", "usd", [null, price, price, price], { keyDriver: true }),
        row("revenue", "Revenue", "commercial", "total", "usd", [0, ...revenue], { formula: "Average customers × price × 12" }),
        header("gtm", "Go-to-market"),
        row("acquisition", "Customer acquisition", "gtm", "computed", "usd", [null, ...acq], { formula: "New customers × CAC" }),
        row("marketing", "Fixed marketing", "gtm", "driver", "usd", [null, ...mkt]),
        header("product", "Product & engineering"),
        row("build", "First version build", "product", "driver", "usd", [null, ...build]),
        row("team", "Team", "product", "driver", "usd", [null, ...team]),
        row("serve", "Cost to serve", "product", "computed", "usd", [null, ...serve], { formula: "Customers × hosting × 12 + revenue × fees %" }),
        header("finance", "Financial impact"),
        row("net", "Net cash", "finance", "total", "usd", [null, ...net], { formula: "Revenue − all costs" }),
      ],
      unitEconomics: [
        row("arpa", "Revenue per customer per month", "commercial", "driver", "usd", [null, price, price, price]),
        row("gross_margin", "Gross margin", "product", "computed", "pct", [null, ...gross.map((x, i) => (revenue[i] > 0 ? (x / revenue[i]) * 100 : null))]),
        row("cac_ue", "Cost to acquire a customer", "gtm", "driver", "usd", [null, cac, cac, cac]),
        row("cac_payback", "Months to earn back CAC", "gtm", "computed", "months", [null, ...YEARS.map(() => (contributionPerMonth > 0 ? cac / contributionPerMonth : null))], { formula: "CAC ÷ (price × gross margin)" }),
        row("ltv", "Lifetime value per customer", "commercial", "computed", "usd", [null, ltv, ltv, ltv], { formula: "Price × 12 × gross margin ÷ churn" }),
        row("ltv_cac", "Lifetime value to CAC", "finance", "computed", "ratio", [null, ...YEARS.map(() => (ltv !== null && cac > 0 ? ltv / cac : null))], { formula: "Healthy is 3 or more" }),
      ],
      pnl: [
        row("p_revenue", "Revenue", "result", "total", "usd", [0, ...revenue]),
        row("p_serve", "Cost to serve", "result", "computed", "usd", [null, ...serve]),
        row("p_gross", "Gross profit", "result", "total", "usd", [null, ...gross]),
        row("p_acq", "Sales and marketing", "result", "computed", "usd", [null, ...acq.map((x, i) => x + mkt[i])]),
        row("p_team", "Team", "result", "computed", "usd", [null, ...team]),
        row("p_ebitda", "Operating profit (EBITDA)", "result", "total", "usd", [null, ...ebitda]),
        row("p_build", "Build investment", "result", "computed", "usd", [null, ...build]),
        row("p_net", "Net cash", "result", "total", "usd", [null, ...net]),
      ],
      benefitByYear: revenue.map(r0),
      costByYear: cost.map(r0),
      netByYear: net.map(r0),
      headlines: {
        commercial: { label: "Year 3 revenue", value: r0(revenue[2]), unit: "usd" },
        gtm: { label: "Months to earn back CAC", value: contributionPerMonth > 0 ? Math.round((cac / contributionPerMonth) * 10) / 10 : null, unit: "months" },
        product: { label: "Year 1 build and team", value: r0(build[0] + team[0]), unit: "usd" },
      },
      guardrails: ["Lifetime value at least 3 times CAC", "Churn no worse than the assumption after six months", "First paying customers before the build budget is spent"],
    };
  },
};

// ---------------------------------------------------------------- Go-to-market expansion

const GTM_RAMP = [0.25, 0.6, 1];

const gtmExpansion: CaseTemplate = {
  id: "gtm_expansion",
  title: "Go-to-Market Expansion",
  description: "Model a new segment, channel or region and its ramp economics.",
  prompt:
    "Build a business case for expanding into a new market and model the ramp economics. We'd target 80 customers by year three at $15,000 a year each, with 2 sales reps.",
  version: "1.0.0",
  goLabel: "Expand into the market",
  cards: [
    { id: "market", title: "Market", owner: "Strategy · Expansion lead", description: "The new segment, channel or region, and how many customers it can bring.", formula: "Customers(t) = year-3 target × ramp (25%, 60%, 100%)" },
    { id: "sales", title: "Sales & marketing", owner: "Sales · Head of sales", description: "What each customer is worth and the team and launch spend to win them.", formula: "Revenue = average customers × annual contract value" },
    { id: "ops", title: "Operations", owner: "Operations · Ops lead", description: "Setting up in the new market and serving customers there.", formula: "Gross profit = revenue × gross margin; setup in year 1" },
    FINANCE_CARD,
  ],
  drivers: [
    { key: "market_name", label: "New segment, channel or region", unit: "text", ask: "Which segment, channel or region are you expanding into?", benchmark: "the new market", benchmarkSource: "Not named yet", card: "market", kind: "assumption" },
    { key: "target_customers_y3", label: "Customers by year 3", unit: "count", ask: "How many customers do you expect in the new market by the end of year 3?", card: "market", kind: "keyDriver", favorable: "up", min: 0, max: 1e9, hint: /(\d[\d,]*)\s+customers\s+by\s+year\s+(?:three|3)/i },
    { key: "acv", label: "Annual contract value per customer", unit: "usd_per_year", ask: "What does one customer there pay per year?", card: "sales", kind: "keyDriver", favorable: "up", min: 0, max: 1e9, hint: /\$\s?([\d,.]+k?)\s*(?:a|per|\/)\s*year\s+each/i },
    { key: "sales_reps", label: "Sales reps hired", unit: "count", ask: "How many sales reps will you hire for the market?", benchmark: 1, benchmarkSource: "Uprali default: start with one rep", humanShouldConfirm: true, card: "sales", kind: "assumption", min: 0, max: 10_000, hint: /(\d+)\s+sales\s+reps?/i },
    { key: "rep_cost_per_year", label: "Cost per rep per year (fully loaded)", unit: "usd_per_year", ask: "What does one rep cost a year, with commission and benefits?", benchmark: 120_000, benchmarkSource: "Typical US account executive, fully loaded", card: "sales", kind: "assumption", min: 0, max: 1e8 },
    { key: "launch_marketing", label: "Launch marketing (year 1)", unit: "usd", ask: "What will you spend on launch marketing in year 1?", benchmark: 30_000, benchmarkSource: "Uprali default for a regional or segment launch", card: "sales", kind: "assumption", min: 0, max: 1e9 },
    { key: "marketing_per_year", label: "Ongoing marketing per year", unit: "usd_per_year", ask: "What's the ongoing marketing budget per year after launch?", benchmark: 15_000, benchmarkSource: "Uprali default", card: "sales", kind: "assumption", min: 0, max: 1e9 },
    { key: "setup_cost", label: "Setup cost (legal, localisation, partners)", unit: "usd", ask: "What does it cost to set up: legal entity, translation, compliance, partners?", benchmark: 25_000, benchmarkSource: "Uprali default; a new country usually costs more than a new segment", humanShouldConfirm: true, card: "ops", kind: "assumption", min: 0, max: 1e9 },
    { key: "ops_cost_per_year", label: "Operating cost per year", unit: "usd_per_year", ask: "What does it cost a year to serve the market: support, success, local tools?", benchmark: 20_000, benchmarkSource: "Uprali default", card: "ops", kind: "assumption", min: 0, max: 1e9 },
    { key: "gross_margin_pct", label: "Gross margin", unit: "pct", ask: "What gross margin do you make on this revenue?", benchmark: 75, benchmarkSource: "Typical software gross margin", card: "ops", kind: "keyDriver", favorable: "up", min: -100, max: 100 },
    DISCOUNT,
  ],
  compute(v) {
    const target = n(v, "target_customers_y3");
    const end = GTM_RAMP.map((r) => target * r);
    const avg = end.map((c, i) => ((i === 0 ? 0 : end[i - 1]) + c) / 2);
    const newC = end.map((c, i) => c - (i === 0 ? 0 : end[i - 1]));
    const revenue = avg.map((c) => c * n(v, "acv"));
    const gross = revenue.map((x) => x * (n(v, "gross_margin_pct") / 100));
    const sales = YEARS.map(() => n(v, "sales_reps") * n(v, "rep_cost_per_year"));
    const mkt = YEARS.map((y) => (y === 1 ? n(v, "launch_marketing") : n(v, "marketing_per_year")));
    const setup = [n(v, "setup_cost"), 0, 0];
    const ops = YEARS.map(() => n(v, "ops_cost_per_year"));
    const cogs = revenue.map((x, i) => x - gross[i]);
    const cost = YEARS.map((_, i) => cogs[i] + sales[i] + mkt[i] + setup[i] + ops[i]);
    const net = YEARS.map((_, i) => revenue[i] - cost[i]);
    const cacs = newC.map((c, i) => (c > 0 ? (sales[i] + mkt[i]) / c : null));
    const monthlyGp = (n(v, "acv") * (n(v, "gross_margin_pct") / 100)) / 12;
    return {
      model: [
        header("market", "Market"),
        row("customers", "Customers at year end", "market", "computed", "count", [0, ...end], { keyDriver: true, formula: "Year-3 target × ramp" }),
        row("new_customers", "New customers", "market", "computed", "count", [null, ...newC]),
        header("sales", "Sales & marketing"),
        row("acv", "Annual contract value", "sales", "driver", "usd", [null, n(v, "acv"), n(v, "acv"), n(v, "acv")], { keyDriver: true }),
        row("revenue", "Revenue", "sales", "total", "usd", [0, ...revenue], { formula: "Average customers × contract value" }),
        row("sales_cost", "Sales team", "sales", "computed", "usd", [null, ...sales], { formula: "Reps × cost per rep" }),
        row("marketing", "Marketing", "sales", "driver", "usd", [null, ...mkt]),
        header("ops", "Operations"),
        row("setup", "Setup", "ops", "driver", "usd", [null, ...setup]),
        row("ops_cost", "Operating cost", "ops", "driver", "usd", [null, ...ops]),
        row("cogs", "Cost of revenue", "ops", "computed", "usd", [null, ...cogs], { formula: "Revenue × (1 − gross margin)" }),
        header("finance", "Financial impact"),
        row("net", "Net cash", "finance", "total", "usd", [null, ...net]),
      ],
      unitEconomics: [
        row("ue_acv", "Annual contract value", "sales", "driver", "usd", [null, n(v, "acv"), n(v, "acv"), n(v, "acv")]),
        row("ue_cac", "Cost to win a customer", "sales", "computed", "usd", [null, ...cacs], { formula: "(Sales team + marketing) ÷ new customers" }),
        row("ue_payback", "Months to earn back that cost", "sales", "computed", "months", [null, ...cacs.map((c) => (c !== null && monthlyGp > 0 ? c / monthlyGp : null))], { formula: "Cost to win ÷ monthly gross profit per customer" }),
        row("ue_rev_rep", "Revenue per rep", "sales", "computed", "usd", [null, ...revenue.map((x) => (n(v, "sales_reps") > 0 ? x / n(v, "sales_reps") : null))]),
      ],
      pnl: [
        row("p_revenue", "Revenue", "result", "total", "usd", [0, ...revenue]),
        row("p_cogs", "Cost of revenue", "result", "computed", "usd", [null, ...cogs]),
        row("p_gross", "Gross profit", "result", "total", "usd", [null, ...gross]),
        row("p_sm", "Sales and marketing", "result", "computed", "usd", [null, ...sales.map((x, i) => x + mkt[i])]),
        row("p_ops", "Operations and setup", "result", "computed", "usd", [null, ...ops.map((x, i) => x + setup[i])]),
        row("p_net", "Net cash", "result", "total", "usd", [null, ...net]),
      ],
      benefitByYear: revenue.map(r0),
      costByYear: cost.map(r0),
      netByYear: net.map(r0),
      headlines: {
        market: { label: "Customers by year 3", value: r0(end[2]), unit: "count" },
        sales: { label: "Year 3 revenue", value: r0(revenue[2]), unit: "usd" },
        ops: { label: "Year 1 setup and operations", value: r0(setup[0] + ops[0]), unit: "usd" },
      },
      guardrails: ["Pipeline in the new market covers 3 times the year-1 target by month 6", "Win rate within 20% of the home market", "Stop or rethink if year-1 customers fall below half the plan"],
    };
  },
};

// ---------------------------------------------------------------- AI investment ROI

const AI_RAMP = [0.6, 0.85, 1];
const WEEKS_PER_YEAR = 46;

const aiInvestment: CaseTemplate = {
  id: "ai_investment",
  title: "AI Investment ROI",
  description: "Weigh what an AI tool costs against the productivity it buys, cash kept apart from freed-up time.",
  prompt:
    "Build a business case for giving our team an AI assistant. 12 people spend about 10 hours a week on reporting, the tool costs $30 per seat a month, and we think it saves 25% of that time. We estimated the hours, we haven't measured them.",
  version: "1.0.0",
  goLabel: "Invest in the AI tool",
  cards: [
    { id: "baseline", title: "Baseline work", owner: "Operations · Team lead", description: "How much time the work takes today, and whether that was measured or estimated.", formula: "Baseline hours = people × hours a week on the task × 46 weeks" },
    { id: "impact", title: "AI impact", owner: "AI · Program owner", description: "How much of that time AI saves, and how many people actually use it.", formula: "Hours saved = baseline × time saved % × adoption × ramp (60%, 85%, 100%) × (1 − haircut if estimated)" },
    { id: "cash", title: "Cash vs capacity", owner: "Finance · FP&A lead", description: "Freed-up time is capacity, not cash. Only the share that cuts real spend counts as cash.", formula: "Cash = value of hours saved × share that becomes cash; the rest is capacity" },
    { id: "costs", title: "Program cost", owner: "IT · AI platform owner", description: "Seats, rollout, training and running costs.", formula: "Cost = seats × price × 12 + rollout (year 1) + training (year 1) + running cost" },
    { ...FINANCE_CARD, description: "NPV, ROI and payback on cash only; capacity shown beside it, never added in." },
  ],
  drivers: [
    { key: "team_size", label: "People doing the work", unit: "count", ask: "How many people do this work today?", card: "baseline", kind: "assumption", min: 0, max: 1e7, hint: /(\d[\d,]*)\s+(?:people|employees|analysts|agents|staff)/i },
    { key: "hours_per_week", label: "Hours per person per week on it", unit: "hours_per_week", ask: "How many hours a week does each person spend on the work the AI would help with?", card: "baseline", kind: "assumption", min: 0, max: 80, hint: /(\d+(?:\.\d+)?)\s+hours?\s+(?:a|per)\s+week/i },
    { key: "baseline_measured", label: "Baseline measured or estimated", unit: "text", ask: "Were those hours measured (time tracking, tickets, logs) or estimated? Answer measured or estimated.", benchmark: "estimated", benchmarkSource: "Treated as estimated until someone measures it", humanShouldConfirm: true, card: "baseline", kind: "assumption", hint: /\b(measured|estimated)\b/i },
    { key: "estimate_haircut_pct", label: "Haircut on an estimated baseline", unit: "pct", ask: "How much should savings be cut while the baseline is only an estimate?", benchmark: 30, benchmarkSource: "Uprali rule: self-reported time savings tend to run high, so they're cut until measured", card: "baseline", kind: "assumption", min: 0, max: 100 },
    { key: "loaded_hourly_cost", label: "Cost per hour of that time", unit: "usd_per_hour", ask: "What does an hour of these people's time cost, fully loaded?", benchmark: 60, benchmarkSource: "About $120k a year fully loaded", card: "baseline", kind: "assumption", min: 0, max: 10_000 },
    { key: "time_saved_pct", label: "Time saved on that work", unit: "pct", ask: "What share of that time will the AI save for someone using it?", benchmark: 20, benchmarkSource: "Uprali default; published studies range from 10 to 40%", humanShouldConfirm: true, card: "impact", kind: "keyDriver", favorable: "up", min: 0, max: 100, hint: /saves?\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*%/i },
    { key: "adoption_pct", label: "People who use it weekly", unit: "pct", ask: "What share of the team will use it every week once it's rolled out?", benchmark: 70, benchmarkSource: "Uprali default for a tool the team asked for", card: "impact", kind: "keyDriver", favorable: "up", min: 0, max: 100 },
    { key: "cash_share_pct", label: "Share of saved time that becomes cash", unit: "pct", ask: "What share of the saved time turns into cash: hires avoided, contractors or overtime cut? Enter 0 if none yet.", benchmark: 0, benchmarkSource: "Freed-up time is capacity, not cash, until Finance confirms a saving", humanShouldConfirm: true, card: "cash", kind: "keyDriver", favorable: "up", min: 0, max: 100 },
    { key: "seat_price_month", label: "Price per seat per month", unit: "usd", ask: "What does the AI tool cost per person per month?", card: "costs", kind: "keyDriver", favorable: "down", min: 0, max: 100_000, hint: /\$\s?([\d,.]+k?)\s*per\s+(?:seat|user|person)/i },
    { key: "rollout_cost", label: "Rollout and integration (year 1)", unit: "usd", ask: "What does it cost to roll out and connect it to your systems?", benchmark: 5000, benchmarkSource: "Uprali default for an off-the-shelf assistant", card: "costs", kind: "assumption", min: 0, max: 1e9 },
    { key: "training_hours", label: "Training hours per person", unit: "hours_per_year", ask: "How many hours of training does each person need in year 1?", benchmark: 6, benchmarkSource: "Uprali default", card: "costs", kind: "assumption", min: 0, max: 1000 },
    { key: "run_cost_per_year", label: "Running cost per year (usage, admin)", unit: "usd_per_year", ask: "What else does it cost each year: API usage, admin time, security review?", benchmark: 2000, benchmarkSource: "Uprali default", card: "costs", kind: "assumption", min: 0, max: 1e9 },
    DISCOUNT,
  ],
  compute(v) {
    const people = n(v, "team_size");
    const baselineHours = people * n(v, "hours_per_week") * WEEKS_PER_YEAR;
    const estimated = String(v.baseline_measured ?? "estimated").toLowerCase().trim() !== "measured";
    const haircut = estimated ? n(v, "estimate_haircut_pct") / 100 : 0;
    const saved = AI_RAMP.map((r) => baselineHours * (n(v, "time_saved_pct") / 100) * (n(v, "adoption_pct") / 100) * r * (1 - haircut));
    const value = saved.map((h) => h * n(v, "loaded_hourly_cost"));
    const cash = value.map((x) => x * (n(v, "cash_share_pct") / 100));
    const capacity = value.map((x, i) => x - cash[i]);
    const seats = YEARS.map(() => people * n(v, "seat_price_month") * 12);
    const rollout = [n(v, "rollout_cost"), 0, 0];
    const training = [people * n(v, "training_hours") * n(v, "loaded_hourly_cost"), 0, 0];
    const run = YEARS.map(() => n(v, "run_cost_per_year"));
    const cost = YEARS.map((_, i) => seats[i] + rollout[i] + training[i] + run[i]);
    const net = YEARS.map((_, i) => cash[i] - cost[i]);
    const netWithTime = YEARS.map((_, i) => value[i] - cost[i]);
    const perPersonWeek = saved.map((h) => (people > 0 ? h / people / WEEKS_PER_YEAR : null));
    const costPerHour = saved.map((h, i) => (h > 0 ? cost[i] / h : null));
    const fullValuePerPct = baselineHours * (n(v, "adoption_pct") / 100) * (1 - haircut) * n(v, "loaded_hourly_cost") / 100;
    const breakEvenPct = fullValuePerPct > 0 ? cost[2] / fullValuePerPct : null;
    return {
      model: [
        header("baseline", "Baseline work"),
        row("baseline_hours", "Hours a year on the work", "baseline", "computed", "hours", [baselineHours, baselineHours, baselineHours, baselineHours], { formula: "People × hours a week × 46" }),
        row("haircut", estimated ? "Haircut, baseline is estimated" : "Haircut, baseline is measured", "baseline", "driver", "pct", [null, haircut * 100, haircut * 100, haircut * 100]),
        header("impact", "AI impact"),
        row("hours_saved", "Hours saved", "impact", "computed", "hours", [0, ...saved], { keyDriver: true, formula: "Baseline × time saved × adoption × ramp × (1 − haircut)" }),
        row("value", "Value of hours saved", "impact", "total", "usd", [0, ...value], { formula: "Hours saved × cost per hour" }),
        header("cash", "Cash vs capacity"),
        row("cash_benefit", "Cash saved", "cash", "computed", "usd", [0, ...cash], { keyDriver: true, formula: "Value × share that becomes cash" }),
        row("capacity", "Freed-up time (capacity, not cash)", "cash", "computed", "usd", [0, ...capacity]),
        header("costs", "Program cost"),
        row("seats", "Seats", "costs", "computed", "usd", [null, ...seats], { formula: "People × seat price × 12" }),
        row("rollout", "Rollout and integration", "costs", "driver", "usd", [null, ...rollout]),
        row("training", "Training time", "costs", "computed", "usd", [null, ...training], { formula: "People × training hours × cost per hour" }),
        row("run", "Running cost", "costs", "driver", "usd", [null, ...run]),
        header("finance", "Financial impact"),
        row("net", "Net cash", "finance", "total", "usd", [null, ...net], { formula: "Cash saved − program cost" }),
        row("net_time", "Net including freed-up time", "finance", "computed", "usd", [null, ...netWithTime], { formula: "Value of hours saved − program cost" }),
      ],
      unitEconomics: [
        row("ue_seat", "Cost per person per year", "costs", "computed", "usd", [null, ...cost.map((c) => (people > 0 ? c / people : null))]),
        row("ue_hours", "Hours saved per person per week", "impact", "computed", "hours", [null, ...perPersonWeek]),
        row("ue_cost_hour", "Cost per hour saved", "costs", "computed", "usd", [null, ...costPerHour], { formula: "Program cost ÷ hours saved" }),
        row("ue_break_even", "Time saved needed to cover the cost", "impact", "computed", "pct", [null, null, null, breakEvenPct], { formula: "Year-3 cost ÷ value of 1% of the time, at this adoption" }),
      ],
      pnl: [
        row("p_cash", "Cash saved", "result", "total", "usd", [0, ...cash]),
        row("p_cost", "Program cost", "result", "computed", "usd", [null, ...cost]),
        row("p_net", "Net cash", "result", "total", "usd", [null, ...net]),
        row("p_capacity", "Freed-up time (not cash)", "result", "computed", "usd", [null, ...capacity]),
        row("p_net_time", "Net including freed-up time", "result", "total", "usd", [null, ...netWithTime]),
      ],
      benefitByYear: cash.map(r0),
      costByYear: cost.map(r0),
      netByYear: net.map(r0),
      capacityByYear: capacity.map(r0),
      headlines: {
        baseline: { label: estimated ? "Hours a year (estimated)" : "Hours a year (measured)", value: r0(baselineHours), unit: "hours" },
        impact: { label: "Hours saved in year 3", value: r0(saved[2]), unit: "hours" },
        cash: { label: "Year 3 cash saved", value: r0(cash[2]), unit: "usd" },
        costs: { label: "Cost per hour saved, year 3", value: costPerHour[2] === null ? null : Math.round(costPerHour[2] * 100) / 100, unit: "usd" },
      },
      guardrails: [
        estimated ? "Measure the baseline hours for a month before year 2" : "Re-measure hours each quarter against the baseline",
        "Quality of AI-assisted work no worse than before (error and rework rate)",
        "Weekly active users tracked against the adoption assumption",
      ],
    };
  },
};

export const CASE_TEMPLATES: Record<CaseTemplateId, CaseTemplate> = {
  new_product: newProduct,
  gtm_expansion: gtmExpansion,
  ai_investment: aiInvestment,
};

export function isCaseTemplate(id: unknown): id is CaseTemplateId {
  return typeof id === "string" && (CASE_TEMPLATE_IDS as string[]).includes(id);
}

// ---------------------------------------------------------------- metrics and scenarios

export interface CaseMetrics {
  totalBenefit: number;
  totalCost: number;
  cumulativeNet: number;
  npv: number;
  /** Net ÷ total cost, as a fraction. Null when nothing is spent. */
  roi: number | null;
  /** Months until cumulative cash turns positive, or null if not within 3 years. */
  paybackMonths: number | null;
  discountRatePct: number;
}

export function metricsFor(out: Pick<CaseOutcome, "benefitByYear" | "costByYear" | "netByYear">, discountRatePct: number): CaseMetrics {
  const r = discountRatePct / 100;
  const npv = out.netByYear.reduce((a, x, i) => a + x / Math.pow(1 + r, i + 1), 0);
  const totalCost = sum(out.costByYear);
  const cumulativeNet = sum(out.netByYear);
  // Payback: the month cumulative cash turns positive, spreading each year's net evenly over its months.
  // When year 1 is already positive, it's the share of year 1's benefit needed to cover year 1's cost.
  let paybackMonths: number | null = null;
  let cum = 0;
  for (let i = 0; i < out.netByYear.length; i++) {
    const before = cum;
    cum += out.netByYear[i];
    if (i === 0 && cum >= 0) {
      paybackMonths = out.benefitByYear[0] > 0 ? Math.round((out.costByYear[0] / out.benefitByYear[0]) * 12 * 10) / 10 : 0;
      break;
    }
    if (before < 0 && cum >= 0 && out.netByYear[i] > 0) {
      paybackMonths = Math.round((i * 12 + (-before / out.netByYear[i]) * 12) * 10) / 10;
      break;
    }
  }
  return {
    totalBenefit: r0(sum(out.benefitByYear)),
    totalCost: r0(totalCost),
    cumulativeNet: r0(cumulativeNet),
    npv: r0(npv),
    roi: totalCost > 0 ? Math.round((cumulativeNet / totalCost) * 1000) / 1000 : null,
    paybackMonths,
    discountRatePct,
  };
}

export interface Scenario {
  id: "downside" | "base" | "upside";
  label: string;
  flex: string;
  metrics: CaseMetrics;
  /** Freed-up time over the three years, valued in dollars, kept apart from cash (AI investment only). */
  capacity?: number;
}

export const SCENARIO_FLEX = 0.2;

/** Flexes the key drivers by 20% against the case (downside) and for it (upside). Assumptions stay put. */
export function scenariosFor(t: CaseTemplate, values: Record<string, number | string>): Scenario[] {
  const keys = t.drivers.filter((d) => d.kind === "keyDriver" && d.unit !== "text");
  const flexed = (dir: -1 | 1) => {
    const v = { ...values };
    for (const d of keys) {
      if (typeof v[d.key] !== "number") continue;
      const up = d.favorable !== "down";
      const f = 1 + dir * (up ? 1 : -1) * SCENARIO_FLEX;
      let x = (v[d.key] as number) * f;
      if (d.unit === "pct" && d.max !== undefined) x = Math.min(x, d.max);
      v[d.key] = x;
    }
    return v;
  };
  const rate = typeof values.discount_rate_pct === "number" ? values.discount_rate_pct : 10;
  const names = keys.map((d) => d.label.toLowerCase()).join(", ");
  const one = (id: Scenario["id"], label: string, flex: string, v: Record<string, number | string>): Scenario => {
    const out = t.compute(v);
    return { id, label, flex, metrics: metricsFor(out, rate), ...(out.capacityByYear ? { capacity: r0(sum(out.capacityByYear)) } : {}) };
  };
  return [
    one("downside", "Downside", `Key drivers 20% worse: ${names}`, flexed(-1)),
    one("base", "Base", "As entered", values),
    one("upside", "Upside", `Key drivers 20% better: ${names}`, flexed(1)),
  ];
}

export function templateList() {
  return [
    { id: "build_vs_buy" as const, title: "Buy vs Build", description: "Compare the full cost, timeline and return of building in-house against buying a tool.", prompt: "Should we build our own CRM or keep paying for HubSpot? We pay $720 a year for HubSpot Starter. Our engineer built a working prototype in 3 weeks. It would need 2 integrations, email and billing." },
    ...CASE_TEMPLATE_IDS.map((id) => ({ id, title: CASE_TEMPLATES[id].title, description: CASE_TEMPLATES[id].description, prompt: CASE_TEMPLATES[id].prompt })),
  ];
}

/** A model value in plain words: $1,200, 25%, 9.3 months, 676 hours, 3.1x. */
export function rowValue(v: number, unit: RowUnit): string {
  switch (unit) {
    case "usd":
      return (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");
    case "pct":
      return `${Math.round(v * 10) / 10}%`;
    case "months":
      return `${Math.round(v * 10) / 10} months`;
    case "hours":
      return `${Math.round(v).toLocaleString("en-US")} hours`;
    case "ratio":
      return `${Math.round(v * 10) / 10}x`;
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}

export type { Unit };

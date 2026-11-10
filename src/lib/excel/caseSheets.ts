/**
 * Live Excel sheets for Uprali's three-year business cases: launch a new product, ROI on an AI
 * investment, and unit economics. Like the build vs buy sheet, every number is a real formula
 * over named yellow input cells, and the formulas copy the engine in engine/cases.ts line by
 * line (the yearly money in, out and net are rounded to whole dollars before NPV, ROI and
 * payback, as the engine does). tests/excel.test.ts checks them against the engine.
 */
import { resolveInputs, type FieldDef } from "../engine/buildVsBuy";
import { CASE_TEMPLATES, type CaseCard, type CaseDriver } from "../engine/cases";
import type { GivenValue, Input } from "../engine/types";
import { colLetter, FORMATS, MODEL_MARKER, MONEY, toCell, UNIT_WORDS, whoGaveIt, type CellStyle, type SheetCell, type SheetInput, type SheetName, type SheetSpec } from "./buildVsBuySheet";

export type CaseSheetModel = "new_product" | "ai_investment" | "unit_economics";
export const CASE_SHEET_MODELS: CaseSheetModel[] = ["new_product", "ai_investment", "unit_economics"];

export function isCaseSheetModel(x: unknown): x is CaseSheetModel {
  return typeof x === "string" && (CASE_SHEET_MODELS as string[]).includes(x);
}

/** Every model the Excel panel offers, in the order it lists them. */
export const EXCEL_MODELS: Array<{ id: "build_vs_buy" | CaseSheetModel; title: string; blurb: string }> = [
  { id: "build_vs_buy", title: "Build vs buy", blurb: "The full cost of building a tool in-house against buying one, year by year." },
  { id: "new_product", title: "New product launch", blurb: "Three-year P&L, investment, NPV, payback and unit economics for a new product." },
  { id: "ai_investment", title: "ROI on an AI investment", blurb: "What an AI tool costs against the time it saves, with cash kept apart from freed-up time." },
  { id: "unit_economics", title: "Unit economics", blurb: "Gross margin, months to earn back CAC, lifetime value and LTV to CAC for one customer." },
];

const NEW_PRODUCT = CASE_TEMPLATES.new_product;
const AI = CASE_TEMPLATES.ai_investment;

/** Unit economics reuses the new product drivers that describe one customer. */
const UE_KEYS = ["price_per_month", "hosting_per_customer_month", "support_payments_pct", "annual_churn_pct", "cac"];
const UE_DRIVERS: CaseDriver[] = UE_KEYS.map((k) => NEW_PRODUCT.drivers.find((d) => d.key === k)!);
const UE_CARDS: CaseCard[] = [
  { id: "commercial", title: "What a customer pays and how long they stay", owner: "Sales · Revenue lead", description: "", formula: "" },
  { id: "product", title: "What it costs to serve them", owner: "Engineering · Product lead", description: "", formula: "" },
  { id: "gtm", title: "What it costs to win them", owner: "Marketing · Growth lead", description: "", formula: "" },
];

export const WEEKS_PER_YEAR = 46;
export const AI_RAMP = [0.6, 0.85, 1];

export function caseModelMeta(model: CaseSheetModel): { template: { id: string; title: string; version: string }; drivers: CaseDriver[]; cards: CaseCard[] } {
  if (model === "unit_economics") return { template: { id: "unit_economics", title: "Unit economics", version: "1.0.0" }, drivers: UE_DRIVERS, cards: UE_CARDS };
  const t = CASE_TEMPLATES[model];
  return { template: { id: t.id, title: t.title, version: t.version }, drivers: t.drivers, cards: t.cards };
}

/** Numbers only a person can give: they must be filled in before the sheet is built. */
export function requiredKeys(drivers: FieldDef[]): string[] {
  return drivers.filter((d) => d.benchmark === undefined && d.unit !== "text" && !d.optional).map((d) => d.key);
}

class Sheet {
  cells: SheetCell[] = [];
  names: SheetName[] = [];
  inputs: SheetInput[] = [];
  r = 1;
  put(address: string, c: Omit<SheetCell, "address">) {
    this.cells.push({ address, ...c });
  }
  name(name: string, address: string, comment: string) {
    this.names.push({ name, address, comment: comment.slice(0, 250) });
  }
}

const YEARS = ["B", "C", "D"];
const TOTAL = "E";
const HOW = "F";
const usdText = (expr: string) => `IF(${expr}<0,"-$","$")&FIXED(ABS(${expr}),0)`;

interface Line {
  key: string;
  label: string;
  /** Formula for one year, without "=". c is the year's column, y its index (0 to 2), hr the header row. */
  f: (c: string, y: number, hr: number) => string;
  how: string;
  total?: boolean;
  format?: string;
  style?: CellStyle;
}

/**
 * Builds a business-case sheet. Blank inputs get Uprali's benchmarks, marked as such, and
 * required numbers (the ones only a person can give) must already be filled in.
 */
export function caseSheet(model: CaseSheetModel, given: Record<string, GivenValue | undefined>): SheetSpec {
  const meta = caseModelMeta(model);
  const inputs = resolveInputs(given, [], meta.drivers);
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const s = new Sheet();
  const at: Record<string, number> = {};

  // ---- Title ----
  s.put(`A${s.r}`, { value: `Uprali: ${meta.template.title.toLowerCase()}`, style: "title" });
  s.put(`${HOW}${s.r}`, { value: `uprali:${model}`, style: "helper" });
  s.name(MODEL_MARKER, `${HOW}${s.r}`, "Which Uprali model this sheet holds.");
  s.r++;
  s.put(`A${s.r}`, { value: "Change any yellow cell and the whole model updates. The rules are Uprali's; the formulas are in the cells.", style: "subtitle" });
  s.r += 2;

  // ---- Summary (formulas point at names defined further down) ----
  s.put(`A${s.r}`, { value: "Summary", style: "section" });
  s.r++;
  const summary: Array<[string, string, string?, CellStyle?, string?]> =
    model === "unit_economics"
      ? [
          ["Verdict", `=IF(NOT(ISNUMBER(ltv_to_cac)),"Not enough to judge yet",IF(ltv_to_cac>=3,"Healthy: lifetime value is 3 times CAC or more",IF(ltv_to_cac>=1,"Thin: a customer pays back CAC, but less than 3 times over","Losing money on each customer")))`, undefined, "result"],
          ["Lifetime value to CAC", "=ltv_to_cac", '0.0"x"', "total"],
          ["Months to earn back CAC", "=months_to_recover_cac", '0.0" months"', "total"],
          ["Lifetime value of a customer", "=ltv", MONEY],
          ["Gross margin", "=gross_margin", "0.0%"],
        ]
      : [
          ["Recommendation", recommendationFormula(model), undefined, "result", "recommendation"],
          [
            "Why",
            `="Over three years: net cash "&${usdText("net_total")}&" on "&${usdText("money_out_total")}&" of cost, net present value "&${usdText("net_present_value")}&" at "&ROUND(discount_rate_pct*100,2)&"%"&IF(ISNUMBER(payback_months),", payback in "&payback_months&" months.",", and no payback within 3 years.")`,
          ],
          ["Net present value", "=net_present_value", MONEY, "total"],
          ["Return on investment (net cash over cost)", "=return_on_investment", "0.0%", "total"],
          ["Payback", "=payback_months", '0.0" months"'],
          ["Net cash over three years", "=net_total", MONEY],
          ...(model === "ai_investment" ? ([["Freed-up time over three years (capacity, not cash)", "=capacity_total", MONEY]] as Array<[string, string, string?]>) : []),
        ];
  for (const [label, formula, fmt, style, nm] of summary) {
    s.put(`A${s.r}`, { value: label, style: "label" });
    s.put(`B${s.r}`, { formula, numberFormat: fmt, style: style ?? "calc" });
    if (nm) s.name(nm, `B${s.r}`, label);
    at[`summary:${label}`] = s.r;
    s.r++;
  }
  s.put(`A${s.r}`, {
    value:
      model === "ai_investment"
        ? "Only cash counts toward NPV, ROI and payback. Freed-up time is shown beside it, never added in."
        : model === "new_product"
          ? "Scenarios (key drivers 20% better or worse) are in the Explain notes."
          : "Steady state for one customer, the same rules Uprali's new product model uses.",
    style: "note",
  });
  s.r += 2;

  // ---- Inputs, grouped by owner card ----
  s.put(`A${s.r}`, { value: "Inputs", style: "section" });
  s.r++;
  s.put(`A${s.r}`, { value: "Input", style: "header" });
  s.put(`B${s.r}`, { value: "Value", style: "header" });
  s.put(`C${s.r}`, { value: "Unit", style: "header" });
  s.put(`D${s.r}`, { value: "Where it came from", style: "header" });
  s.r++;
  for (const card of meta.cards) {
    const ds = meta.drivers.filter((d) => d.card === card.id);
    if (!ds.length) continue;
    s.put(`A${s.r}`, { value: `${card.title} (${card.owner})`, style: "total" });
    s.r++;
    for (const d of ds) {
      const inp = byKey.get(d.key)!;
      s.put(`A${s.r}`, { value: d.label, style: "label" });
      s.put(`B${s.r}`, { value: toCell(d.unit, inp.value), numberFormat: FORMATS[d.unit], style: "input" });
      s.put(`C${s.r}`, { value: d.key === "baseline_measured" ? "type measured or estimated" : (UNIT_WORDS[d.unit] ?? ""), style: "note" });
      s.put(`D${s.r}`, { value: whoGaveIt(inp), style: "note" });
      s.name(d.key, `B${s.r}`, `${d.label}. ${d.ask}`);
      s.inputs.push({ key: d.key, label: d.label, unit: d.unit, name: d.key, address: `B${s.r}` });
      s.r++;
    }
  }
  if (model === "ai_investment") {
    s.put(`A${s.r}`, { value: "Working weeks a year", style: "label" });
    s.put(`B${s.r}`, { value: WEEKS_PER_YEAR, numberFormat: "0", style: "fixed" });
    s.put(`C${s.r}`, { value: "weeks", style: "note" });
    s.put(`D${s.r}`, { value: "Fixed: Uprali's rule for a working year after leave and holidays", style: "note" });
    s.name("weeks_per_year", `B${s.r}`, "Working weeks a year");
    s.r++;
  }
  s.r++;

  if (model === "unit_economics") unitEconomicsBlock(s);
  else caseModelBlock(s, model, at);

  const notesStartRow = s.r + 1;
  s.name("uprali_notes", `A${notesStartRow}`, "Where the Uprali panel writes its notes for this sheet.");

  return {
    schema: `uprali.excel.${model}.v1`,
    model,
    template: meta.template,
    sheetName: meta.template.title.slice(0, 31),
    horizonYears: 3,
    cells: s.cells,
    names: s.names,
    inputs: s.inputs,
    columnWidths: [
      { column: "A", width: 280 },
      ...YEARS.map((c) => ({ column: c, width: 90 })),
      { column: TOTAL, width: 95 },
      { column: HOW, width: 330 },
    ],
    notesStartRow,
    checks:
      model === "unit_economics"
        ? [
            { name: "ltv", label: "Lifetime value" },
            { name: "months_to_recover_cac", label: "Months to earn back CAC" },
          ]
        : [
            { name: "net_total", label: "Net cash" },
            { name: "net_present_value", label: "Net present value" },
          ],
  };
}

function recommendationFormula(model: CaseSheetModel): string {
  const go = model === "ai_investment" ? AI.goLabel : NEW_PRODUCT.goLabel;
  const notNow = `"Not now: it doesn't pay back in three years"`;
  const otherwise = model === "ai_investment" ? `IF(net_total+capacity_total>0,"Pilot first: it pays back in freed-up time, not cash",${notNow})` : notNow;
  return `=IF(AND(net_present_value>0,ISNUMBER(payback_months)),"${go}",${otherwise})`;
}

/** The year-by-year model, the rounded results, and the metrics. */
function caseModelBlock(s: Sheet, model: "new_product" | "ai_investment", at: Record<string, number>) {
  const hr = yearHeader(s, "Model");
  const row: Record<string, number> = {};
  const prev = (y: number) => YEARS[y - 1];
  const lines: Line[] =
    model === "new_product"
      ? [
          { key: "new", label: "New customers", f: (c, y) => (y === 0 ? "new_customers_y1" : `${prev(y)}${row.new}*(1+new_customer_growth_pct)`), how: "Year 1 as given, then grows by the yearly growth", total: true, format: "#,##0.0" },
          { key: "end", label: "Customers at year end", f: (c, y) => (y === 0 ? `${c}${row.new}` : `${prev(y)}${row.end}*(1-annual_churn_pct)+${c}${row.new}`), how: "Last year's customers less churn, plus new", format: "#,##0.0" },
          { key: "avg", label: "Average customers in the year", f: (c, y) => (y === 0 ? `(0+${c}${row.end})/2` : `(${prev(y)}${row.end}+${c}${row.end})/2`), how: "Start and end of the year, averaged", format: "#,##0.0" },
          { key: "rev", label: "Revenue", f: (c) => `${c}${row.avg}*price_per_month*12`, how: "Average customers times price times 12", total: true, style: "total" },
          { key: "serve", label: "Cost to serve", f: (c) => `${c}${row.avg}*hosting_per_customer_month*12+${c}${row.rev}*support_payments_pct`, how: "Hosting per customer, plus support and payment fees on revenue", total: true },
          { key: "gross", label: "Gross profit", f: (c) => `${c}${row.rev}-${c}${row.serve}`, how: "Revenue less cost to serve", total: true },
          { key: "acq", label: "Customer acquisition", f: (c) => `${c}${row.new}*cac`, how: "New customers times CAC", total: true },
          { key: "mkt", label: "Fixed marketing", f: () => "marketing_fixed_per_year", how: "Every year", total: true },
          { key: "team", label: "Team", f: () => "team_cost_per_year", how: "Every year", total: true },
          { key: "build", label: "First version build", f: (c) => `IF(${c}$${hr}=1,build_cost,0)`, how: "Once, in year 1", total: true },
          { key: "cost", label: "Total cost", f: (c) => `${c}${row.serve}+${c}${row.acq}+${c}${row.mkt}+${c}${row.team}+${c}${row.build}`, how: "Cost to serve, acquisition, marketing, team and build", total: true, style: "total" },
          { key: "ebitda", label: "Operating profit (EBITDA)", f: (c) => `${c}${row.gross}-${c}${row.acq}-${c}${row.mkt}-${c}${row.team}`, how: "Gross profit less sales, marketing and team", total: true },
          { key: "net", label: "Net cash", f: (c) => `${c}${row.rev}-${c}${row.cost}`, how: "Revenue less total cost", total: true, style: "total" },
        ]
      : [
          { key: "ramp", label: "Rollout ramp", f: (c, y) => String(AI_RAMP[y]), how: "Fixed: share of the full saving reached each year", format: "0%", style: "fixed" },
          { key: "base", label: "Hours a year on the work", f: () => "team_size*hours_per_week*weeks_per_year", how: "People times hours a week times working weeks", format: "#,##0" },
          { key: "haircut", label: "Haircut on the savings", f: () => `IF(LOWER(TRIM(baseline_measured))="measured",0,estimate_haircut_pct)`, how: "Applied until the baseline is measured", format: "0%" },
          { key: "saved", label: "Hours saved", f: (c) => `${c}${row.base}*time_saved_pct*adoption_pct*${c}${row.ramp}*(1-${c}${row.haircut})`, how: "Baseline times time saved, adoption and ramp, less the haircut", total: true, format: "#,##0" },
          { key: "value", label: "Value of hours saved", f: (c) => `${c}${row.saved}*loaded_hourly_cost`, how: "Hours saved times the cost of an hour", total: true },
          { key: "cash", label: "Cash saved", f: (c) => `${c}${row.value}*cash_share_pct`, how: "The share of saved time that cuts real spend", total: true, style: "total" },
          { key: "capacity", label: "Freed-up time (capacity, not cash)", f: (c) => `${c}${row.value}-${c}${row.cash}`, how: "The rest of the saved time", total: true },
          { key: "seats", label: "Seats", f: () => "team_size*seat_price_month*12", how: "People times seat price times 12", total: true },
          { key: "rollout", label: "Rollout and integration", f: (c) => `IF(${c}$${hr}=1,rollout_cost,0)`, how: "Once, in year 1", total: true },
          { key: "training", label: "Training time", f: (c) => `IF(${c}$${hr}=1,team_size*training_hours*loaded_hourly_cost,0)`, how: "People times training hours at their hourly cost, in year 1", total: true },
          { key: "run", label: "Running cost", f: () => "run_cost_per_year", how: "Every year", total: true },
          { key: "cost", label: "Program cost", f: (c) => `${c}${row.seats}+${c}${row.rollout}+${c}${row.training}+${c}${row.run}`, how: "Seats, rollout, training and running cost", total: true, style: "total" },
          { key: "net", label: "Net cash", f: (c) => `${c}${row.cash}-${c}${row.cost}`, how: "Cash saved less program cost", total: true, style: "total" },
          { key: "nettime", label: "Net including freed-up time", f: (c) => `${c}${row.value}-${c}${row.cost}`, how: "Value of all hours saved less program cost", total: true },
        ];
  for (const l of lines) {
    row[l.key] = s.r;
    s.put(`A${s.r}`, { value: l.label, style: l.style === "total" ? "total" : "label" });
    YEARS.forEach((c, y) => {
      const f = l.f(c, y, hr);
      s.put(`${c}${s.r}`, l.style === "fixed" ? { value: Number(f), numberFormat: l.format, style: "fixed" } : { formula: `=${f}`, numberFormat: l.format ?? MONEY, style: l.style ?? "calc" });
    });
    if (l.total) s.put(`${TOTAL}${s.r}`, { formula: `=SUM(B${s.r}:D${s.r})`, numberFormat: l.format ?? MONEY, style: "total" });
    s.put(`${HOW}${s.r}`, { value: l.how, style: "note" });
    s.r++;
  }
  s.r++;

  // ---- Results: rounded to whole dollars, as the engine does before NPV, ROI and payback ----
  const benefit = model === "new_product" ? row.rev : row.cash;
  const rh = yearHeader(s, "Results (whole dollars)");
  void rh;
  const res: Record<string, number> = {};
  const resultLines: Array<[string, string, (c: string, y: number) => string, string?]> = [
    ["in", model === "new_product" ? "Money in (revenue)" : "Money in (cash saved)", (c) => `ROUND(${c}${benefit},0)`, "money_in_total"],
    ["out", "Money out (cost)", (c) => `ROUND(${c}${row.cost},0)`, "money_out_total"],
    ["net", "Net cash", (c) => `ROUND(${c}${row.net},0)`, "net_total"],
    ["cum", "Net cash so far", (c, y) => (y === 0 ? `${c}${res.net}` : `${YEARS[y - 1]}${res.cum}+${c}${res.net}`)],
    ...(model === "ai_investment" ? ([["cap", "Freed-up time (not cash)", (c: string) => `ROUND(${c}${row.capacity},0)`, "capacity_total"]] as Array<[string, string, (c: string, y: number) => string, string?]>) : []),
  ];
  for (const [key, label, f, nm] of resultLines) {
    res[key] = s.r;
    s.put(`A${s.r}`, { value: label, style: key === "net" ? "total" : "label" });
    YEARS.forEach((c, y) => s.put(`${c}${s.r}`, { formula: `=${f(c, y)}`, numberFormat: MONEY, style: key === "net" ? "total" : "calc" }));
    if (nm) {
      s.put(`${TOTAL}${s.r}`, { formula: `=SUM(B${s.r}:D${s.r})`, numberFormat: MONEY, style: "total" });
      s.name(nm, `${TOTAL}${s.r}`, `${label}, all three years`);
    }
    s.r++;
  }
  s.r++;

  // ---- Metrics ----
  s.put(`A${s.r}`, { value: "Financial impact", style: "section" });
  s.r++;
  const R = res;
  const metrics: Array<[string, string, string, string, string]> = [
    ["net_present_value", "Net present value", `=ROUND(NPV(discount_rate_pct,B${R.net}:D${R.net}),0)`, MONEY, "Net cash each year, discounted at the discount rate"],
    ["return_on_investment", "Return on investment", `=IF(money_out_total>0,ROUND(net_total/money_out_total,3),"n/a")`, "0.0%", "Net cash over three years divided by total cost"],
    [
      "payback_months",
      "Payback",
      `=IF(B${R.cum}>=0,IF(B${R.in}>0,ROUND(B${R.out}/B${R.in}*12,1),0),IF(AND(C${R.cum}>=0,C${R.net}>0),ROUND(12+(-B${R.cum}/C${R.net})*12,1),IF(AND(C${R.cum}<0,D${R.cum}>=0,D${R.net}>0),ROUND(24+(-C${R.cum}/D${R.net})*12,1),"Not within 3 years")))`,
      '0.0" months"',
      "The month the cash so far turns positive, spreading each year evenly",
    ],
  ];
  for (const [nm, label, formula, fmt, how] of metrics) {
    s.put(`A${s.r}`, { value: label, style: "label" });
    s.put(`B${s.r}`, { formula, numberFormat: fmt, style: "total" });
    s.put(`${HOW}${s.r}`, { value: how, style: "note" });
    s.name(nm, `B${s.r}`, label);
    s.r++;
  }
  s.r++;

  // ---- Unit economics ----
  s.put(`A${s.r}`, { value: "Unit economics", style: "section" });
  s.r++;
  if (model === "new_product") {
    s.put(`A${s.r}`, { value: "Gross margin", style: "label" });
    YEARS.forEach((c) => s.put(`${c}${s.r}`, { formula: `=IF(${c}${row.rev}>0,${c}${row.gross}/${c}${row.rev},"n/a")`, numberFormat: "0.0%", style: "calc" }));
    s.put(`${HOW}${s.r}`, { value: "Gross profit over revenue", style: "note" });
    s.r++;
    const ue: Array<[string, string, string, string, string]> = [
      ["gross_margin_y3", "Gross margin used for one customer (year 3)", `=IF(D${row.rev}>0,D${row.gross}/D${row.rev},0)`, "0.0%", "Year 3 gross margin"],
      ["months_to_recover_cac", "Months to earn back CAC", `=IF(price_per_month*gross_margin_y3>0,cac/(price_per_month*gross_margin_y3),"n/a")`, '0.0" months"', "CAC divided by price times gross margin"],
      ["ltv", "Lifetime value per customer", `=IF(annual_churn_pct>0,price_per_month*12*gross_margin_y3/annual_churn_pct,"n/a")`, MONEY, "Price times 12 times gross margin, divided by churn"],
      ["ltv_to_cac", "Lifetime value to CAC", `=IF(AND(ISNUMBER(ltv),cac>0),ltv/cac,"n/a")`, '0.0"x"', "Healthy is 3 or more"],
    ];
    for (const [nm, label, formula, fmt, how] of ue) {
      s.put(`A${s.r}`, { value: label, style: "label" });
      s.put(`B${s.r}`, { formula, numberFormat: fmt, style: "calc" });
      s.put(`${HOW}${s.r}`, { value: how, style: "note" });
      s.name(nm, `B${s.r}`, label);
      s.r++;
    }
  } else {
    const ue: Array<[string, (c: string) => string, string, string]> = [
      ["Cost per person per year", (c) => `IF(team_size>0,${c}${row.cost}/team_size,"n/a")`, MONEY, "Program cost divided by people"],
      ["Hours saved per person per week", (c) => `IF(team_size>0,${c}${row.saved}/team_size/weeks_per_year,"n/a")`, "0.0", "Hours saved divided by people and working weeks"],
      ["Cost per hour saved", (c) => `IF(${c}${row.saved}>0,${c}${row.cost}/${c}${row.saved},"n/a")`, "$#,##0.00", "Program cost divided by hours saved"],
    ];
    for (const [label, f, fmt, how] of ue) {
      s.put(`A${s.r}`, { value: label, style: "label" });
      YEARS.forEach((c) => s.put(`${c}${s.r}`, { formula: `=${f(c)}`, numberFormat: fmt, style: "calc" }));
      s.put(`${HOW}${s.r}`, { value: how, style: "note" });
      s.r++;
    }
    s.put(`A${s.r}`, { value: "Time saved needed to cover the year 3 cost", style: "label" });
    s.put(`B${s.r}`, { formula: `=IF(D${row.base}*adoption_pct*(1-D${row.haircut})*loaded_hourly_cost>0,D${row.cost}/(D${row.base}*adoption_pct*(1-D${row.haircut})*loaded_hourly_cost),"n/a")`, numberFormat: "0.0%", style: "calc" });
    s.put(`${HOW}${s.r}`, { value: "Year 3 cost over the value of all the time, at this adoption", style: "note" });
    s.name("break_even_time_saved", `B${s.r}`, "Time saved needed to cover the year 3 cost");
    s.r++;
  }
  void at;
}

/** Unit economics for one customer, in steady state. */
function unitEconomicsBlock(s: Sheet) {
  s.put(`A${s.r}`, { value: "One customer", style: "section" });
  s.r++;
  const lines: Array<[string, string, string, string, string]> = [
    ["gross_margin", "Gross margin", `=IF(price_per_month>0,1-hosting_per_customer_month/price_per_month-support_payments_pct,"n/a")`, "0.0%", "What's left of the price after hosting, support and payment fees"],
    ["contribution_per_month", "Contribution per customer per month", `=IF(ISNUMBER(gross_margin),price_per_month*gross_margin,"n/a")`, "$#,##0.00", "Price times gross margin"],
    ["months_to_recover_cac", "Months to earn back CAC", `=IF(AND(ISNUMBER(contribution_per_month),contribution_per_month>0),cac/contribution_per_month,"Never: each customer loses money")`, '0.0" months"', "CAC divided by the monthly contribution"],
    ["lifetime_months", "How long a customer stays", `=IF(annual_churn_pct>0,12/annual_churn_pct,"n/a")`, '0.0" months"', "12 months divided by the yearly churn"],
    ["ltv", "Lifetime value of a customer", `=IF(AND(annual_churn_pct>0,ISNUMBER(gross_margin)),price_per_month*12*gross_margin/annual_churn_pct,"n/a")`, MONEY, "Price times 12 times gross margin, divided by churn"],
    ["ltv_to_cac", "Lifetime value to CAC", `=IF(AND(ISNUMBER(ltv),cac>0),ltv/cac,"n/a")`, '0.0"x"', "Healthy is 3 or more"],
  ];
  for (const [nm, label, formula, fmt, how] of lines) {
    s.put(`A${s.r}`, { value: label, style: nm === "ltv_to_cac" ? "total" : "label" });
    s.put(`B${s.r}`, { formula, numberFormat: fmt, style: nm === "ltv_to_cac" ? "total" : "calc" });
    s.put(`${HOW}${s.r}`, { value: how, style: "note" });
    s.name(nm, `B${s.r}`, label);
    s.r++;
  }
}

function yearHeader(s: Sheet, title: string): number {
  s.put(`A${s.r}`, { value: title, style: "header" });
  YEARS.forEach((c, y) => s.put(`${c}${s.r}`, { value: y + 1, numberFormat: '"Year "0', style: "header" }));
  s.put(`${TOTAL}${s.r}`, { value: "Total", style: "header" });
  s.put(`${HOW}${s.r}`, { value: "How it's worked out", style: "header" });
  const hr = s.r;
  s.r++;
  return hr;
}

export type { Input };
export { colLetter };

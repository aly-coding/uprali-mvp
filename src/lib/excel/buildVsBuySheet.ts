/**
 * Lays out Uprali's build vs buy model as a live Excel sheet: yellow input cells with
 * sheet-scoped names, and real formulas for every cost line, total and the recommendation.
 * The formulas copy the rules in engine/buildVsBuy.ts line by line (each yearly cell is
 * rounded to whole dollars, like the engine), so the sheet and the web app agree on the
 * same inputs. tests/excel.test.ts checks that with a formula engine.
 *
 * Percentages are stored in Excel as fractions (7% is 0.07) with a percent format, so the
 * formulas never divide by 100. The engine and the API use whole percents (7).
 */
import { FIELDS, resolveInputs, TEMPLATE, type FieldDef } from "../engine/buildVsBuy";
import type { GivenValue, Input, Unit } from "../engine/types";

export const SHEET_SCHEMA = "uprali.excel.build_vs_buy.v1";
export const HOURS_PER_WEEK = 40;

export type CellStyle = "title" | "subtitle" | "section" | "header" | "input" | "fixed" | "label" | "calc" | "total" | "result" | "note" | "helper";

export interface SheetCell {
  address: string;
  /** A formula starting with "=", or a plain value. */
  formula?: string;
  value?: string | number;
  numberFormat?: string;
  style?: CellStyle;
}

export interface SheetName {
  name: string;
  address: string;
  /** Shown in Excel's Name Manager. */
  comment: string;
}

export interface SheetInput {
  key: string;
  label: string;
  unit: Unit;
  /** The named cell that holds it. */
  name: string;
  address: string;
}

export interface SheetSpec {
  schema: string;
  /** Which Uprali model the sheet holds: build_vs_buy, new_product, ai_investment or unit_economics. */
  model: string;
  template: { id: string; title: string; version: string };
  sheetName: string;
  horizonYears: number;
  cells: SheetCell[];
  names: SheetName[];
  inputs: SheetInput[];
  columnWidths: Array<{ column: string; width: number }>;
  /** Where the AI notes go when someone asks for them. */
  notesStartRow: number;
  /** The cells the side panel reads back to compare with the engine. */
  check?: { buyTotal: string; buildTotal: string; difference: string; recommendation: string };
  /** Named totals the panel compares with Uprali's own numbers when it explains a sheet. */
  checks: Array<{ name: string; label: string }>;
}

/** Every sheet names a cell that says which model it holds, so the panel knows how to read it back. */
export const MODEL_MARKER = "uprali_model";

/** Fields that go into the sheet: the cost comparison. The optional return-on-investment fields come later. */
export const SHEET_FIELDS: FieldDef[] = FIELDS.filter((f) => !f.optional && f.key !== "horizon_years");

export function colLetter(i: number): string {
  // 0 -> A
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const FORMATS: Partial<Record<Unit, string>> = {
  usd: "$#,##0",
  usd_per_year: "$#,##0",
  usd_per_week: "$#,##0",
  usd_per_hour: "$#,##0",
  pct: "0%",
  weeks: "0.0",
  hours_per_week: "0.0",
  hours_per_month: "0.0",
  count: "0",
  years: "0",
  months: "0.0",
};

export const UNIT_WORDS: Partial<Record<Unit, string>> = {
  usd: "$ once",
  usd_per_year: "$ a year",
  usd_per_week: "$ a week",
  usd_per_hour: "$ an hour",
  pct: "%",
  weeks: "engineer-weeks",
  hours_per_week: "hours a week",
  hours_per_month: "hours a month",
  count: "count",
  years: "years",
  months: "months",
  text: "text",
};

export const MONEY = "$#,##0";

/** Converts an engine value (7 for 7%) to the cell value (0.07). */
export function toCell(unit: Unit, v: number | string | null): number | string {
  if (v === null) return "";
  // Text that starts like a formula stays text.
  if (typeof v === "string") return v.replace(/^[=+\-@\s]+/, "");
  return unit === "pct" ? round6(v / 100) : v;
}

/** Converts a cell value back to what the engine and API take (0.07 back to 7). */
export function fromCell(unit: Unit, v: unknown): number | string | null {
  if (v === null || v === undefined || v === "") return null;
  if (unit === "text") return String(v);
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return unit === "pct" ? round6(n * 100) : n;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function whoGaveIt(i: Input): string {
  if (i.value === null) return "Missing: only you can give this";
  if (i.owner === "agent") return `${i.source}${i.needsHuman ? ". Please confirm" : ""}`;
  return i.source === "Provided by the person asking" ? "You, in the Uprali panel" : i.source;
}

export interface SheetOptions {
  sheetName?: string;
}

/**
 * Builds the sheet from what the person typed in the panel. Blank boxes get Uprali's
 * benchmarks, marked as such in the "Where it came from" column.
 */
export function buildVsBuySheet(given: Record<string, GivenValue | undefined>, opts: SheetOptions = {}): SheetSpec {
  const inputs = resolveInputs(given, []);
  const horizonInput = inputs.find((i) => i.key === "horizon_years");
  const n = Math.max(1, Math.min(10, Math.round(typeof horizonInput?.value === "number" ? horizonInput.value : 3)));
  const byKey = new Map(inputs.map((i) => [i.key, i]));

  const cells: SheetCell[] = [];
  const names: SheetName[] = [];
  const sheetInputs: SheetInput[] = [];
  const put = (address: string, c: Omit<SheetCell, "address">) => cells.push({ address, ...c });
  const name = (nm: string, address: string, comment: string) => names.push({ name: nm, address, comment });

  // Columns: A labels, B..(B+n-1) years (and input values in B), then total, then notes.
  const yearCols = Array.from({ length: n }, (_, y) => colLetter(1 + y));
  const totalCol = colLetter(1 + n);
  const lastCol = colLetter(2 + n);

  let r = 1;
  put(`A${r}`, { value: "Uprali: build or buy", style: "title" });
  put(`${lastCol}${r}`, { value: "uprali:build_vs_buy", style: "helper" });
  name(MODEL_MARKER, `${lastCol}${r}`, "Which Uprali model this sheet holds.");
  r++;
  put(`A${r}`, { value: "Change any yellow cell and the whole model updates. The rules are Uprali's build vs buy rules; the formulas are in the cells.", style: "subtitle" });
  r += 2;

  // ---- Summary (formulas point at named cells defined further down) ----
  put(`A${r}`, { value: "Summary", style: "section" });
  r++;
  const summaryRows: Array<[string, string, string?, CellStyle?]> = [
    ["Recommendation", `=IF(difference>0,"Buy "&IF(tool_name="","the tool",tool_name),"Build "&IF(what_to_build="","it",what_to_build)&" in-house")`, undefined, "result"],
    [
      "Why",
      `="Over "&horizon_years&" years, building costs $"&FIXED(build_total,0)&" against $"&FIXED(buy_total,0)&" to buy, $"&FIXED(ABS(difference),0)&IF(difference>0," more."," less.")`,
    ],
    ["Cost to buy, all years", "=buy_total", MONEY, "total"],
    ["Cost to build, all years", "=build_total", MONEY, "total"],
    ["Build minus buy", "=build_total-buy_total", MONEY],
    ["The prototype alone", "=ROUND(prototype_weeks*engineer_weekly_cost,0)", MONEY],
    ["Yearly subscription where both cost the same", "=MAX(0,ROUND((build_total-(buy_total-subscription_total))/price_growth_total,0))", MONEY],
  ];
  const rowOf: Record<string, number> = {};
  for (const [label, formula, fmt, style] of summaryRows) {
    put(`A${r}`, { value: label, style: "label" });
    put(`B${r}`, { formula, numberFormat: fmt, style: style ?? "calc" });
    rowOf[label] = r;
    r++;
  }
  put(`A${r}`, { value: "This compares cost only. Return on investment and payback come in a later version of the add-in.", style: "note" });
  r += 2;

  // ---- Inputs ----
  put(`A${r}`, { value: "Inputs", style: "section" });
  r++;
  put(`A${r}`, { value: "Input", style: "header" });
  put(`B${r}`, { value: "Value", style: "header" });
  put(`C${r}`, { value: "Unit", style: "header" });
  put(`D${r}`, { value: "Where it came from", style: "header" });
  r++;
  for (const group of ["buy", "build"] as const) {
    for (const f of SHEET_FIELDS.filter((x) => (x.group ?? "general") === group)) {
      const inp = byKey.get(f.key)!;
      put(`A${r}`, { value: f.label, style: "label" });
      // A benchmark that depends on another input stays a formula, so it follows that input.
      const linked = f.key === "buy_setup_cost" && inp.owner === "agent";
      put(`B${r}`, linked ? { formula: "=ROUND(0.1*buy_annual_cost,0)", numberFormat: FORMATS[f.unit], style: "input" } : { value: toCell(f.unit, inp.value), numberFormat: FORMATS[f.unit], style: "input" });
      put(`C${r}`, { value: UNIT_WORDS[f.unit] ?? "", style: "note" });
      put(`D${r}`, { value: linked ? `${inp.source}. Type your own number over it` : whoGaveIt(inp), style: "note" });
      name(f.key, `B${r}`, `${f.label}. ${f.ask}`.slice(0, 250));
      sheetInputs.push({ key: f.key, label: f.label, unit: f.unit, name: f.key, address: `B${r}` });
      r++;
    }
  }
  put(`A${r}`, { value: "Hours in a work week", style: "label" });
  put(`B${r}`, { value: HOURS_PER_WEEK, numberFormat: "0", style: "fixed" });
  put(`C${r}`, { value: "hours", style: "note" });
  put(`D${r}`, { value: "Fixed: turns the engineer-week cost into an hourly cost", style: "note" });
  name("hours_per_week", `B${r}`, "Hours in a work week, used to turn the engineer-week cost into an hourly cost.");
  r++;
  put(`A${r}`, { value: "Years compared", style: "label" });
  put(`B${r}`, { value: n, numberFormat: "0", style: "fixed" });
  put(`C${r}`, { value: "years", style: "note" });
  put(`D${r}`, { value: "To change the years, build a new sheet from the Uprali panel", style: "note" });
  name("horizon_years", `B${r}`, "Years compared. Fixed for this sheet: the year columns are laid out for it.");
  sheetInputs.push({ key: "horizon_years", label: "Years to compare", unit: "years", name: "horizon_years", address: `B${r}` });
  r += 2;

  // ---- Workings ----
  put(`A${r}`, { value: "Workings", style: "section" });
  r++;
  const workings: Array<[string, string, string, string, string]> = [
    ["full_build_weeks", "Engineer-weeks for the full build", "=prototype_weeks/MAX(0.01,prototype_share_pct)", "0.0", "The prototype divided by its share of the real build"],
    ["integration_weeks", "Engineer-weeks for integrations", "=integrations_count*integration_weeks_each", "0.0", "Integrations times engineer-weeks each"],
    ["engineer_hourly_cost", "Cost of an engineer-hour", "=engineer_weekly_cost/hours_per_week", MONEY, "Engineer-week cost divided by hours in a week"],
  ];
  for (const [nm, label, formula, fmt, how] of workings) {
    put(`A${r}`, { value: label, style: "label" });
    put(`B${r}`, { formula, numberFormat: fmt, style: "calc" });
    put(`D${r}`, { value: how, style: "note" });
    name(nm, `B${r}`, how);
    r++;
  }
  r++;

  // ---- Cost tables ----
  const yearHeader = (title: string) => {
    put(`A${r}`, { value: title, style: "header" });
    yearCols.forEach((c, y) => put(`${c}${r}`, { value: y + 1, numberFormat: '"Year "0', style: "header" }));
    put(`${totalCol}${r}`, { value: "Total", style: "header" });
    put(`${lastCol}${r}`, { value: "How it's worked out", style: "header" });
    const hr = r;
    r++;
    return hr;
  };
  // A line: label, per-year formula built from the year cell, how text.
  const costLine = (hr: number, label: string, perYear: (yearCell: string) => string, how: string, style: CellStyle = "calc"): number => {
    put(`A${r}`, { value: label, style: "label" });
    yearCols.forEach((c) => put(`${c}${r}`, { formula: `=ROUND(${perYear(`${c}$${hr}`)},0)`, numberFormat: MONEY, style }));
    put(`${totalCol}${r}`, { formula: `=SUM(${yearCols[0]}${r}:${yearCols[n - 1]}${r})`, numberFormat: MONEY, style: "total" });
    put(`${lastCol}${r}`, { value: how, style: "note" });
    return r++;
  };
  const totalRow = (label: string, first: number, last: number, nm: string, comment: string) => {
    put(`A${r}`, { value: label, style: "total" });
    yearCols.forEach((c) => put(`${c}${r}`, { formula: `=SUM(${c}${first}:${c}${last})`, numberFormat: MONEY, style: "total" }));
    put(`${totalCol}${r}`, { formula: `=SUM(${yearCols[0]}${r}:${yearCols[n - 1]}${r})`, numberFormat: MONEY, style: "total" });
    name(nm, `${totalCol}${r}`, comment);
    return r++;
  };

  put(`A${r}`, { value: "Cost to buy", style: "section" });
  r++;
  let hr = yearHeader("Line");
  const subsRow = costLine(hr, "Subscription", (y) => `buy_annual_cost*(1+buy_price_increase_pct)^(${y}-1)`, "Yearly subscription, rising by the yearly price increase");
  name("subscription_total", `${totalCol}${subsRow}`, "Subscription over all years");
  costLine(hr, "Setup and migration", (y) => `IF(${y}=1,buy_setup_cost,0)`, "Once, in year 1");
  const buyLast = costLine(hr, "Admin time", () => `buy_admin_hours_month*12*engineer_hourly_cost`, "Admin hours a month, times 12, at an engineer-hour");
  totalRow("Total to buy", subsRow, buyLast, "buy_total", "Total cost to buy over all years");
  // Helper row for the break-even subscription: how much the price grows each year.
  put(`A${r}`, { value: "Price growth (for the break-even line)", style: "helper" });
  yearCols.forEach((c) => put(`${c}${r}`, { formula: `=(1+buy_price_increase_pct)^(${c}$${hr}-1)`, numberFormat: "0.000", style: "helper" }));
  put(`${totalCol}${r}`, { formula: `=SUM(${yearCols[0]}${r}:${yearCols[n - 1]}${r})`, numberFormat: "0.000", style: "helper" });
  put(`${lastCol}${r}`, { value: "Year 1 is 1; each later year grows by the price increase", style: "note" });
  name("price_growth_total", `${totalCol}${r}`, "Sum of the yearly price growth, used for the break-even subscription");
  r += 2;

  put(`A${r}`, { value: "Cost to build", style: "section" });
  r++;
  hr = yearHeader("Line");
  const once = (y: string, x: string) => `IF(${y}=1,${x},0)`;
  const buildFirst = costLine(hr, "Working prototype", (y) => once(y, "prototype_weeks*engineer_weekly_cost"), "Prototype engineer-weeks at the engineer-week cost, in year 1");
  costLine(hr, "Making it production-ready", (y) => once(y, "full_build_weeks*engineer_weekly_cost-prototype_weeks*engineer_weekly_cost"), "The rest of the full build after the prototype, in year 1");
  costLine(hr, "Integrations", (y) => once(y, "integration_weeks*engineer_weekly_cost"), "Integration engineer-weeks at the engineer-week cost, in year 1");
  costLine(hr, "Upkeep", () => "maintenance_pct*(full_build_weeks+integration_weeks)*engineer_weekly_cost", "Yearly upkeep share of the build and integration cost");
  costLine(hr, "Security and compliance", () => "security_annual", "Every year");
  costLine(hr, "Hosting", () => "hosting_annual", "Every year");
  costLine(hr, "Someone on call", () => "oncall_hours_week*52*engineer_hourly_cost", "On-call hours a week, times 52, at an engineer-hour");
  costLine(hr, "Knowledge lost if the builder leaves", () => "builder_leaves_pct*handover_weeks*engineer_weekly_cost", "Chance the builder leaves, times the weeks to take over");
  const buildLast = costLine(hr, "Core product work not done", (y) => once(y, "opportunity_pct*(full_build_weeks+integration_weeks)*engineer_weekly_cost"), "Engineer-weeks off the core product, times what that work returns above its cost, in year 1");
  totalRow("Total to build", buildFirst, buildLast, "build_total", "Total cost to build over all years");
  r++;

  // The difference is named on the summary row.
  name("difference", `B${rowOf["Build minus buy"]}`, "Build total minus buy total. Above zero means buying is cheaper.");

  const notesStartRow = r + 1;
  name("uprali_notes", `A${notesStartRow}`, "Where the Uprali panel writes its notes for this sheet.");

  return {
    schema: SHEET_SCHEMA,
    model: "build_vs_buy",
    template: TEMPLATE,
    sheetName: (opts.sheetName ?? "Build vs Buy").slice(0, 31),
    horizonYears: n,
    cells,
    names,
    inputs: sheetInputs,
    columnWidths: [
      { column: "A", width: 250 },
      ...yearCols.map((c) => ({ column: c, width: 80 })),
      { column: totalCol, width: 90 },
      { column: lastCol, width: 320 },
    ],
    notesStartRow,
    check: {
      buyTotal: "buy_total",
      buildTotal: "build_total",
      difference: "difference",
      recommendation: `B${rowOf["Recommendation"]}`,
    },
    checks: [
      { name: "buy_total", label: "Cost to buy" },
      { name: "build_total", label: "Cost to build" },
    ],
  };
}

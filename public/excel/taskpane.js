/* Uprali side panel for Excel. Plain JavaScript, no build step. It asks the Uprali server for
 * the sheet layout (cells, formulas, named ranges) and writes it with Office.js. All the money
 * rules live on the server, in the same engine as the web app. */
"use strict";

const API = "/api/excel/build-vs-buy";
const SUGGESTION = "Suggestion, verify";
let FIELDS = [];
let inExcel = false;

const $ = (id) => document.getElementById(id);
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

function setStatus(text, kind) {
  const el = $("status");
  el.hidden = !text;
  el.className = "notice" + (kind ? " " + kind : "");
  el.textContent = text || "";
}

function busy(on) {
  $("build").disabled = on;
  $("explain").disabled = on;
}

/* ---------- The form ---------- */

const UNIT = {
  usd: "$", usd_per_year: "$ a year", usd_per_week: "$ a week", usd_per_hour: "$ an hour",
  pct: "%", weeks: "eng-weeks", hours_per_week: "hrs a week", hours_per_month: "hrs a month",
  count: "", years: "years", months: "months", text: "",
};

async function loadFields() {
  const res = await fetch(API);
  if (!res.ok) throw new Error("Couldn't load the questions from Uprali.");
  const data = await res.json();
  FIELDS = data.fields;
  const required = new Set(data.required);
  const box = $("fields");
  box.innerHTML = "";
  for (const g of data.groups) {
    const card = document.createElement("section");
    card.className = "card";
    const h = document.createElement("h2");
    h.textContent = g.title;
    card.appendChild(h);
    for (const f of FIELDS.filter((x) => x.group === g.id)) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.className = "label";
      label.htmlFor = "f_" + f.key;
      label.textContent = f.label + " ";
      if (required.has(f.key)) {
        const star = document.createElement("span");
        star.className = "req";
        star.textContent = "*";
        star.title = "Needed";
        label.appendChild(star);
      }
      const input = document.createElement("input");
      input.id = "f_" + f.key;
      input.name = f.key;
      input.type = f.unit === "text" ? "text" : "number";
      if (input.type === "number") { input.step = "any"; input.min = "0"; }
      if (required.has(f.key)) input.required = true;
      input.placeholder =
        f.benchmark === null ? (f.unit === "text" ? "" : "Only you know this")
        : f.benchmark === "computed" ? "Uprali works it out"
        : "Benchmark: " + f.benchmark;
      input.title = f.ask + (f.benchmarkSource ? " " + f.benchmarkSource + "." : "");
      const row = document.createElement("div");
      row.className = "unitwrap";
      row.appendChild(input);
      if (UNIT[f.unit]) {
        const u = document.createElement("span");
        u.textContent = UNIT[f.unit];
        row.appendChild(u);
      }
      const help = document.createElement("div");
      help.className = "muted small";
      help.textContent = f.help || f.ask;
      wrap.append(label, row, help);
      card.appendChild(wrap);
    }
    box.appendChild(card);
  }
}

function formInputs() {
  const inputs = {};
  for (const f of FIELDS) {
    const raw = $("f_" + f.key).value.trim();
    if (raw === "") continue;
    inputs[f.key] = f.unit === "text" ? raw : Number(raw);
  }
  inputs.horizon_years = Number($("horizon_years").value);
  return inputs;
}

/* ---------- Writing the sheet ---------- */

const STYLES = {
  title: (r) => { r.format.font.bold = true; r.format.font.size = 16; r.format.font.color = "#16294A"; },
  subtitle: (r) => { r.format.font.italic = true; r.format.font.color = "#5F6573"; },
  section: (r) => { r.format.font.bold = true; r.format.font.size = 12; r.format.font.color = "#16294A"; },
  header: (r) => { r.format.font.bold = true; r.format.fill.color = "#E8EEF8"; },
  input: (r) => { r.format.fill.color = "#FFF4CC"; r.format.font.color = "#1F4E9C"; },
  fixed: (r) => { r.format.fill.color = "#EEEEEE"; r.format.font.color = "#5F6573"; },
  label: () => {},
  calc: () => {},
  total: (r) => { r.format.font.bold = true; },
  result: (r) => { r.format.font.bold = true; r.format.font.size = 13; r.format.font.color = "#16294A"; },
  note: (r) => { r.format.font.color = "#5F6573"; },
  helper: (r) => { r.format.font.italic = true; r.format.font.color = "#8A8F99"; },
};

async function uniqueSheetName(ctx, base) {
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    const ws = ctx.workbook.worksheets.getItemOrNullObject(name);
    await ctx.sync();
    if (ws.isNullObject) return name;
  }
  return `${base} ${Date.now() % 10000}`;
}

async function writeSheet(spec) {
  return Excel.run(async (ctx) => {
    const name = await uniqueSheetName(ctx, spec.sheetName);
    const ws = ctx.workbook.worksheets.add(name);
    // 1. Plain values first, then the names, so no formula ever points at a missing name.
    for (const c of spec.cells) {
      if (c.formula === undefined) ws.getRange(c.address).values = [[c.value === undefined ? "" : c.value]];
    }
    for (const n of spec.names) ws.names.add(n.name, ws.getRange(n.address), n.comment);
    await ctx.sync();
    // 2. Formulas, number formats and looks.
    for (const c of spec.cells) {
      const r = ws.getRange(c.address);
      if (c.formula !== undefined) r.formulas = [[c.formula]];
      if (c.numberFormat) r.numberFormat = [[c.numberFormat]];
      if (c.style && STYLES[c.style]) STYLES[c.style](r);
    }
    for (const w of spec.columnWidths) ws.getRange(`${w.column}:${w.column}`).format.columnWidth = w.width;
    ws.getRange("A2").format.wrapText = false;
    ws.activate();
    ws.getRange("A1").select();
    await ctx.sync();
    return name;
  });
}

async function onBuild(ev) {
  ev.preventDefault();
  if (!inExcel) return setStatus("Open this panel inside Excel to build a sheet.", "warn");
  busy(true);
  setStatus("Building the sheet…");
  try {
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: formInputs() }) });
    const spec = await res.json();
    if (!res.ok) throw new Error(spec.error || "Uprali couldn't lay out the sheet.");
    const name = await writeSheet(spec);
    setStatus(`Done. The model is on the "${name}" sheet. Change any yellow cell and it updates. Press Explain for Uprali's notes.`, "good");
  } catch (e) {
    setStatus(friendly(e), "bad");
  } finally {
    busy(false);
  }
}

/* ---------- Explaining a sheet ---------- */

function fromCell(unit, v) {
  if (v === null || v === undefined || v === "") return null;
  if (unit === "text") return String(v);
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return unit === "pct" ? Math.round(n * 100 * 1e6) / 1e6 : n;
}

async function readSheet() {
  return Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const keys = FIELDS.map((f) => f.key).concat(["horizon_years", "buy_total", "build_total", "difference", "uprali_notes"]);
    const items = keys.map((k) => ws.names.getItemOrNullObject(k));
    await ctx.sync();
    const marker = items[keys.indexOf("build_total")];
    if (marker.isNullObject) return null;
    const ranges = items.map((it) => (it.isNullObject ? null : it.getRange().load("values,address")));
    ws.load("name");
    await ctx.sync();
    const val = (k) => { const r = ranges[keys.indexOf(k)]; return r ? r.values[0][0] : null; };
    const inputs = {};
    for (const f of FIELDS) {
      const v = fromCell(f.unit, val(f.key));
      if (v !== null && v !== "") inputs[f.key] = v;
    }
    inputs.horizon_years = fromCell("years", val("horizon_years")) || 3;
    const notes = ranges[keys.indexOf("uprali_notes")];
    return {
      sheet: ws.name,
      inputs,
      totals: { buy: val("buy_total"), build: val("build_total"), difference: val("difference") },
      notesAddress: notes ? notes.address.split("!").pop() : null,
    };
  });
}

async function writeNotes(notesAddress, ex) {
  if (!notesAddress) return;
  const row = Number(notesAddress.replace(/^\$?[A-Z]+\$?/, ""));
  const when = new Date(ex.generatedAt).toLocaleString();
  const lines = [
    ["Uprali's notes", "section"],
    [`${SUGGESTION}. Written ${when} for the numbers in this sheet at that time. They don't change when you edit inputs; press Explain again.`, "note"],
    [ex.ai.usedAi ? "AI analysis (" + SUGGESTION + ")" : "Analysis (" + SUGGESTION + ")", "header"],
    ["Biggest risk: " + ex.ai.biggestRisk, "label"],
  ];
  ex.ai.cfoQuestions.forEach((q, i) => lines.push([`Question a CFO will ask ${i + 1}: ${q}`, "label"]));
  if (ex.rules.whatWouldChangeMyMind.length) {
    lines.push(["What would change the answer (Uprali's rules, worked out from the numbers)", "header"]);
    ex.rules.whatWouldChangeMyMind.forEach((t) => lines.push([t, "label"]));
  }
  if (ex.ai.note) lines.push([ex.ai.note, "note"]);
  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    ws.getRange(`A${row}:A${row + 30}`).clear("Contents");
    ws.getRange(`A${row}:A${row + 30}`).format.font.bold = false;
    ws.getRange(`A${row}:A${row + 30}`).format.fill.clear();
    lines.forEach(([text, style], i) => {
      const r = ws.getRange(`A${row + i}`);
      r.values = [[String(text).replace(/^[=+\-@]+/, "")]];
      r.format.font.italic = false;
      r.format.font.color = "#1A1F2B";
      r.format.font.size = 11;
      if (STYLES[style]) STYLES[style](r);
    });
    await ctx.sync();
  });
}

function renderExplain(ex, sheetTotals) {
  const box = $("result");
  box.hidden = false;
  box.innerHTML = "";
  const card = document.createElement("section");
  card.className = "card";
  const add = (tag, text, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text; card.appendChild(el); return el; };

  add("h2", "Uprali's rules");
  add("div", ex.recommendation.headline, "rec");
  add("p", ex.recommendation.why, "small");
  if (ex.totals) {
    const same = sheetTotals.buy === ex.totals.buy && sheetTotals.build === ex.totals.build;
    add("div", same
      ? `The sheet matches Uprali's numbers: ${usd(ex.totals.build)} to build, ${usd(ex.totals.buy)} to buy.`
      : `The sheet's totals (${usd(sheetTotals.build || 0)} to build, ${usd(sheetTotals.buy || 0)} to buy) differ from Uprali's (${usd(ex.totals.build)} and ${usd(ex.totals.buy)}). A formula or the years cell may have been edited.`,
      "notice " + (same ? "good" : "warn"));
  }
  if (ex.rules.gaps.length) {
    add("p", "Still to confirm:", "small");
    const ul = document.createElement("ul");
    ex.rules.gaps.forEach((g) => { const li = document.createElement("li"); li.className = "small"; li.textContent = g; ul.appendChild(li); });
    card.appendChild(ul);
  }
  box.appendChild(card);

  const ai = document.createElement("section");
  ai.className = "card";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = SUGGESTION;
  ai.appendChild(tag);
  const p = (text) => { const el = document.createElement("p"); el.className = "small"; el.textContent = text; ai.appendChild(el); };
  p(ex.ai.summary);
  p("Biggest risk: " + ex.ai.biggestRisk);
  const ul = document.createElement("ul");
  ex.ai.cfoQuestions.forEach((q) => { const li = document.createElement("li"); li.className = "small"; li.textContent = q; ul.appendChild(li); });
  ai.appendChild(ul);
  const n = document.createElement("p");
  n.className = "muted small";
  n.textContent = ex.ai.note;
  ai.appendChild(n);
  box.appendChild(ai);
}

async function onExplain() {
  if (!inExcel) return setStatus("Open this panel inside Excel to explain a sheet.", "warn");
  busy(true);
  setStatus("Reading the sheet and asking Uprali…");
  try {
    const sheet = await readSheet();
    if (!sheet) throw new Error("This sheet isn't an Uprali build vs buy sheet. Open one Uprali made, or build one first.");
    const res = await fetch(API + "/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: sheet.inputs }) });
    const ex = await res.json();
    if (!res.ok) throw new Error(ex.error || "Uprali couldn't explain this sheet.");
    renderExplain(ex, sheet.totals);
    await writeNotes(sheet.notesAddress, ex);
    setStatus(`Notes written under the model on "${sheet.sheet}".`, "good");
  } catch (e) {
    setStatus(friendly(e), "bad");
  } finally {
    busy(false);
  }
}

function friendly(e) {
  const msg = (e && e.message) || String(e);
  if (/ApiNotFound|not supported|isn't supported/i.test(msg)) return "This version of Excel is too old for Uprali. It needs Excel for Microsoft 365, Excel 2021 or later, or Excel on the web.";
  return msg;
}

/* ---------- Start ---------- */

$("form").addEventListener("submit", onBuild);
$("explain").addEventListener("click", onExplain);

loadFields().catch((e) => setStatus(friendly(e), "bad"));

if (window.Office && Office.onReady) {
  Office.onReady((info) => {
    inExcel = info && info.host === Office.HostType.Excel;
    $("not-excel").hidden = inExcel;
  });
} else {
  $("not-excel").hidden = false;
}

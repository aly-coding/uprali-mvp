/* Uprali side panel for Excel. Plain JavaScript, no build step. It asks the Uprali server for
 * the sheet layout (cells, formulas, named ranges) and writes it with Office.js. All the money
 * rules live on the server, in the same engine as the web app. */
"use strict";

const SUGGESTION = "Suggestion, verify";
const MODELS = {
  build_vs_buy: { title: "Build vs buy", blurb: "The full cost of building a tool in-house against buying one, year by year." },
  new_product: { title: "New product launch", blurb: "Three-year P&L, investment, NPV, payback and unit economics for a new product." },
  ai_investment: { title: "ROI on an AI investment", blurb: "What an AI tool costs against the time it saves, with cash kept apart from freed-up time." },
  unit_economics: { title: "Unit economics", blurb: "Gross margin, months to earn back CAC, lifetime value and LTV to CAC for one customer." },
};
const api = (model) => (model === "build_vs_buy" ? "/api/excel/build-vs-buy" : "/api/excel/model/" + model);

let current = "build_vs_buy";
let FIELDS = [];
const fieldCache = {};
let inExcel = false;

const $ = (id) => document.getElementById(id);
const usd = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

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
  pct: "%", weeks: "eng-weeks", hours_per_week: "hrs a week", hours_per_month: "hrs a month", hours_per_year: "hrs a year",
  count: "", years: "years", months: "months", text: "",
};

async function getFields(model) {
  if (fieldCache[model]) return fieldCache[model];
  const res = await fetch(api(model));
  if (!res.ok) throw new Error("Couldn't load the questions from Uprali.");
  fieldCache[model] = await res.json();
  return fieldCache[model];
}

async function loadFields(model) {
  current = model;
  $("model-blurb").textContent = (MODELS[model] && MODELS[model].blurb) || "";
  $("years-card").hidden = model !== "build_vs_buy";
  const box = $("fields");
  box.innerHTML = "";
  const data = await getFields(model);
  if (current !== model) return; // the person switched again while this loaded
  FIELDS = data.fields;
  const required = new Set(data.required);
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
      if (input.type === "number") input.step = "any";
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
    const el = $("f_" + f.key);
    const raw = el ? el.value.trim() : "";
    if (raw === "") continue;
    inputs[f.key] = f.unit === "text" ? raw : Number(raw);
  }
  if (current === "build_vs_buy") inputs.horizon_years = Number($("horizon_years").value);
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
    const name = i === 1 ? base : `${base.slice(0, 27)} ${i}`;
    const ws = ctx.workbook.worksheets.getItemOrNullObject(name);
    await ctx.sync();
    if (ws.isNullObject) return name;
  }
  return `${base.slice(0, 25)} ${Date.now() % 10000}`;
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
    const res = await fetch(api(current), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: formInputs() }) });
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

/** Reads named cells from the active sheet. Missing names come back as null. */
async function readNames(keys) {
  return Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const items = keys.map((k) => ws.names.getItemOrNullObject(k));
    ws.load("name");
    await ctx.sync();
    const ranges = items.map((it) => (it.isNullObject ? null : it.getRange().load("values,address")));
    await ctx.sync();
    const out = { sheet: ws.name, values: {}, addresses: {} };
    keys.forEach((k, i) => {
      out.values[k] = ranges[i] ? ranges[i].values[0][0] : null;
      out.addresses[k] = ranges[i] ? ranges[i].address.split("!").pop() : null;
    });
    return out;
  });
}

async function readSheet() {
  const first = await readNames(["uprali_model", "build_total"]);
  let model = null;
  const marker = first.values.uprali_model;
  if (typeof marker === "string" && marker.indexOf("uprali:") === 0) model = marker.slice(7);
  else if (first.values.build_total !== null) model = "build_vs_buy"; // sheets made before the marker existed
  if (!model || !MODELS[model]) return null;
  const data = await getFields(model);
  const keys = data.fields.map((f) => f.key).concat(["horizon_years", "uprali_notes"]);
  const got = await readNames(keys);
  const inputs = {};
  for (const f of data.fields) {
    const v = fromCell(f.unit, got.values[f.key]);
    if (v !== null && v !== "") inputs[f.key] = v;
  }
  if (model === "build_vs_buy") inputs.horizon_years = fromCell("years", got.values.horizon_years) || 3;
  return { model, sheet: got.sheet, inputs, notesAddress: got.addresses.uprali_notes };
}

async function writeNotes(notesAddress, ex) {
  if (!notesAddress) return;
  const row = Number(notesAddress.replace(/^\$?[A-Z]+\$?/, ""));
  const when = new Date(ex.generatedAt).toLocaleString();
  const lines = [
    ["Uprali's notes", "section"],
    [`Written ${when} for the numbers in this sheet at that time. They don't change when you edit inputs; press Explain again.`, "note"],
    [ex.recommendation.headline, "total"],
    [ex.recommendation.why, "label"],
  ];
  if (ex.ai) {
    lines.push([(ex.ai.usedAi ? "AI analysis" : "Analysis") + " (" + SUGGESTION + ")", "header"]);
    lines.push(["Biggest risk: " + ex.ai.biggestRisk, "label"]);
    ex.ai.cfoQuestions.forEach((q, i) => lines.push([`Question a CFO will ask ${i + 1}: ${q}`, "label"]));
  }
  if (ex.rules.lines && ex.rules.lines.length) {
    lines.push([ex.rules.linesTitle, "header"]);
    ex.rules.lines.forEach((t) => lines.push([t, "label"]));
  }
  if (ex.ai && ex.ai.note) lines.push([ex.ai.note, "note"]);
  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const area = ws.getRange(`A${row}:A${row + 40}`);
    area.clear("Contents");
    area.format.font.bold = false;
    area.format.fill.clear();
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

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function fmtCheck(name, v) {
  if (typeof v !== "number") return String(v);
  return name === "months_to_recover_cac" ? `${Math.round(v * 10) / 10} months` : usd(v);
}

function renderExplain(ex, sheetValues) {
  const box = $("result");
  box.hidden = false;
  box.innerHTML = "";
  const card = document.createElement("section");
  card.className = "card";
  const add = (tag, text, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text; card.appendChild(el); return el; };

  add("h2", "Uprali's rules");
  add("div", ex.recommendation.headline, "rec");
  add("p", ex.recommendation.why, "small");
  if (ex.checks && ex.checks.length) {
    const close = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.01;
    const same = ex.checks.every((c) => close(sheetValues[c.name], c.value));
    add("div", same
      ? "The sheet matches Uprali's numbers: " + ex.checks.map((c) => `${lowerFirst(c.label)} ${fmtCheck(c.name, c.value)}`).join(", ") + "."
      : "The sheet differs from Uprali's numbers: " + ex.checks.map((c) => `${lowerFirst(c.label)} ${fmtCheck(c.name, sheetValues[c.name])} in the sheet, ${fmtCheck(c.name, c.value)} by Uprali`).join("; ") + ". A formula may have been edited.",
      "notice " + (same ? "good" : "warn"));
  }
  if (ex.rules.gaps && ex.rules.gaps.length) {
    add("p", "Still to confirm:", "small");
    const ul = document.createElement("ul");
    ex.rules.gaps.forEach((g) => { const li = document.createElement("li"); li.className = "small"; li.textContent = g; ul.appendChild(li); });
    card.appendChild(ul);
  }
  box.appendChild(card);
  if (!ex.ai) return;

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
    if (!sheet) throw new Error("This sheet isn't one the Uprali panel made. Open one it made, or build one first.");
    const res = await fetch(api(sheet.model) + "/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: sheet.inputs }) });
    const ex = await res.json();
    if (!res.ok) throw new Error(ex.error || "Uprali couldn't explain this sheet.");
    const checked = await readNames((ex.checks || []).map((c) => c.name));
    renderExplain(ex, checked.values);
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
$("model").addEventListener("change", (e) => {
  setStatus("");
  loadFields(e.target.value).catch((err) => setStatus(friendly(err), "bad"));
});

loadFields("build_vs_buy").catch((e) => setStatus(friendly(e), "bad"));

if (window.Office && Office.onReady) {
  Office.onReady((info) => {
    inExcel = info && info.host === Office.HostType.Excel;
    $("not-excel").hidden = inExcel;
  });
} else {
  $("not-excel").hidden = false;
}

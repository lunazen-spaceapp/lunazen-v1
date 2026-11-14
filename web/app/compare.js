// Compare: the landings the visitor pinned in the Planner, side by side. Each card is one landing with
// the question it answered, tested at the spot and its 12 nearby points; "Shift every pinned landing" tests every pin again at a
// later or earlier date with its own question. The pins are in the address, which is authoritative, and in this browser.

import { Ephemeris, SiteCatalog, feasible, STEP_S } from "../engine/index.js";
import { createPool } from "./pool.js";
import { createEvaluator } from "./evaluate.js";
import "./theme.js";
import "./tray.js";
import { setTrayOverride } from "./tray.js";
import { onThemeChange } from "./theme.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { spotName } from "./myspots.js";
import { ensureCustom } from "./customs.js";
import { PLANNING } from "./defaults.js";
import { DATA_VERSION, kindText, loadPins, pinDay, pinId, pinSentence, pinTime, pinsFromValue, pinsToCsv, pinsToIcs, pinsToValue, removePin, savePins } from "./pins.js";
import { esc } from "./components.js";
import { mountHelp, mountIcons } from "./planshell.js";
import { icon } from "./components.js";
import { drawEventChart } from "./eventchart.js";
import { earthLevel, longestRun, missionFacts, sunLevel } from "./events.js";
import { landingValue, parseLanding } from "./plan.js";
import { ARRAY_HINT, DSN_HINT, NIGHT_HINT, SUN_HIGHEST_HINT, SUN_HIGHEST_LABEL, darkBelowSuffix, degText, dsnSuffix, flatText, hintHtml, pctText } from "./format.js";
import { sunClearsText } from "./clearance.js";
import { robustRuns, spanText } from "./query-model.js";
import { worksText } from "./reach.js";

const $ = (id) => document.getElementById(id);
const REASON = { night: "Night exceeds limit", dsn: "DSN below limit" };
// What a failing result says: every reason that fails, joined ("Night too long · DSN in view too low").
const REASON_LOWER = { night: "night exceeds limit", dsn: "DSN below limit" };
export const failWords = (reasons) => reasons.map((r, i) => (i ? REASON_LOWER[r] : REASON[r])).join(" · ");
const pillOf = (kind, within) => ({ robust: ["", within === 0 ? "Target spot" : `Within ${within} m`], spot: ["spot", "Target spot only"], night: ["fail", REASON.night], dsn: ["fail", REASON.dsn] })[kind];
const SCORE = { robust: 3, spot: 2, night: 1, dsn: 1 };

let ephemeris, catalog, pool, evaluateRange;
let pins = [];
let shift = 0;
let runId = 0;
let results = new Map(); // pinId + shift -> evaluation
let shown = []; // what the cards show now: [{ pin, name, landing, ev, base }]

const limitOf = (p) => (p.rule === "custom" ? p.dark : catalog.darknessPresets.find((x) => x.id === p.rule)?.hours ?? p.dark);
const nameOf = (p) => spotName(p.spot);

// A landing "YYYY-MM-DDTHH" moved by whole days.
const shifted = (landing, days) => `${new Date(Date.parse(`${landing.slice(0, 10)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)}${landing.slice(10)}`;

function hashOf() {
  const h = new URLSearchParams();
  if (pins.length) h.set("pins", pinsToValue(pins));
  if (shift) h.set("shift", String(shift));
  return `#${h.toString()}`;
}

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
  } catch (error) {
    dataLoadError(error, "compare.html");
    return;
  }
  pool = createPool(new URL("data", location.href).href, { ephemeris, catalog });
  evaluateRange = createEvaluator({ ephemeris, catalog, pool });
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("pins")) { pins = pinsFromValue(params.get("pins")); savePins(pins); } else pins = loadPins(); // the address wins
  shift = Math.round(Number(params.get("shift")) || 0);
  if (shift) $("shift").value = Math.abs(shift) > 120 ? 9 : shift;
  wireCopyLink($("copy-link"));
  mountIcons();
  mountHelp("How to use Compare landings", [
    ["Pin landings", "<p>In the Planner, select a valid touchdown window and press the pin icon. Up to four pins are kept in this browser, each with its query.</p>"],
    ["Test a launch slip", "<p>Enter a slip in days and press Rerun pins. Each pin is re-tested with its own query at the shifted date. Back to original dates undoes the shift.</p>"],
  ]);
  wire();
  onThemeChange(() => drawCharts());
  window.addEventListener("resize", () => drawCharts());
  window.addEventListener("pinschange", () => { const now = loadPins(); if (pinsToValue(now) !== pinsToValue(pins)) { pins = now; if (!pins.length) shift = 0; sync(); run(); } });
  sync();
  run();
}

function sync() {
  history.replaceState(null, "", hashOf());
  carryNav({ mast: PLANNING.mast, start: PLANNING.date });
}

// One pin tested: the landing at the spot and its 12 nearby points over the whole mission, and the mission itself.
async function evaluate(pin, days) {
  const key = `${pinId(pin)}@${days}`;
  if (results.has(key)) return results.get(key);
  const promise = (async () => {
    const landing = shifted(pin.landing, days);
    const et0 = parseLanding(landing);
    await ensureCustom(catalog, "data", pin.spot);
    const limit = limitOf(pin), minLink = pin.link / 100;
    const missionS = pin.mission * 86400;
    const [rk, col] = await Promise.all([
      pool.run({ kind: "rank", id: pin.spot, mast: pin.mast, et0, missionS, minLink, maxDarkHours: limit, within: pin.within, darkBelow: (pin.dbelow ?? 0) / 100, dsnRule: pin.dstation ? "station" : undefined }),
      pool.run({ kind: "column", id: pin.spot, mast: pin.mast, et0, et1: Math.min(et0 + missionS - STEP_S, ephemeris.etMax - STEP_S), darkBelow: (pin.dbelow ?? 0) / 100, dsnRule: pin.dstation ? "station" : undefined }),
    ]);
    const m = rk.metrics;
    const works = feasible({ longestDarkHours: m.longestDarkHours, linkFraction: m.dsnLinkFraction }, minLink, limit);
    const robust = works && rk.ringOk === rk.ringTotal;
    const holds = works && feasible({ longestDarkHours: rk.raised.longestDarkHours, linkFraction: rk.raised.dsnLinkFraction }, minLink, limit);
    const kind = robust ? "robust" : works ? "spot" : m.longestDarkHours > limit ? "night" : "dsn";
    // Every check that fails, not only the first: the night and the DSN in view can both fall short.
    const reasons = works ? [] : [m.longestDarkHours > limit && "night", m.dsnLinkFraction < minLink && "dsn"].filter(Boolean);
    const link = Array.from(col.series.earthFraction, (f, i) => (f > 0 && col.series.dsnInView[i] === 1 ? 1 : 0));
    return { landing, kind, reasons, holds, metrics: m, ringOk: rk.ringOk, ringTotal: rk.ringTotal, series: col.series, link, facts: { ...missionFacts(col.series, link, STEP_S, (pin.dbelow ?? 0) / 100), sunClears: sunClearsText(col.series, (catalog.missions.has(pin.spot) ? catalog.mission(pin.spot) : catalog.spot(pin.spot, pin.mast)).horizon) }, limit, minLink };
  })();
  results.set(key, promise);
  return promise;
}

// "Rerun pins" waits for a shift of 1 to 120 days, earlier (negative) or later.
function validShift() {
  const n = Math.round(Number($("shift").value));
  $("rerun").disabled = $("shift").value === "" || !Number.isFinite(n) || n === 0 || Math.abs(n) > 120;
}

async function run() {
  const mine = ++runId;
  setTrayOverride(null);
  $("shift-bar").hidden = !pins.length;
  $("actions").hidden = !pins.length;
  $("next").hidden = !pins.length;
  $("pinned-count").textContent = `${pins.length} of 4 pinned`;
  $("reset").hidden = !shift;
  $("shift").value = shift ? String(shift) : $("shift").value; // a shift that came in the link shows in the box
  $("shift-note").textContent = shift ? `Showing every pin shifted by ${shift > 0 ? "+" : "−"}${Math.abs(shift)} days.` : "Each pin is re-tested with its own query at the shifted date.";
  validShift();
  $("version").textContent = pins.length ? `Data: ${DATA_VERSION.replace("2024-2043", "2024–2043").replace("0.25 degrees", "0.25°")}. Times are UTC.` : "";
  if (!pins.length) { shown = []; renderEmpty(); $("status").textContent = ""; return; }
  $("status").textContent = "Testing the pinned landings…";
  $("cards").classList.add("stale");
  try {
    const rows = await Promise.all(pins.map(async (pin) => {
      const base = await evaluate(pin, 0);
      const ev = shift ? await evaluate(pin, shift) : base;
      return { pin, name: nameOf(pin), landing: ev.landing, ev, base };
    }));
    if (mine !== runId) return;
    shown = rows;
    renderCards();
    if (shift) setTrayOverride(rows.map((r) => ({ id: pinId(r.pin), landing: r.landing, kind: r.ev.kind })));
    $("status").textContent = `${rows.length} pinned landing${rows.length === 1 ? "" : "s"}${shift ? `, each shifted by ${shift > 0 ? "+" : "−"}${Math.abs(shift)} d` : ""}.`;
  } catch (error) {
    $("status").textContent = `Something went wrong: ${error.message}`;
  } finally {
    if (mine === runId) $("cards").classList.remove("stale");
  }
}

function renderEmpty() {
  $("cards").innerHTML = `<section class="pl-panel lz-empty"><h2 class="exp-h">No pinned landings</h2><p class="pl-foot">Select a touchdown window in the Planner and click the pin icon to save it here. Pin up to four candidates to compare side by side and test a shared launch slip.</p><div class="na-btns"><a class="exp-btn fill" href="planner.html">Open Planner</a><a class="exp-btn" href="rank.html">Rank spots</a><a class="exp-btn" href="sidebyside.html">Compare sites</a></div></section>`;
}

// What moved when the dates shifted, in words.
function movedText(row) {
  if (!shift) return "";
  const { base, ev, pin } = row;
  const by = `${shift > 0 ? "+" : "−"}${Math.abs(shift)} d`;
  const night = Math.round(base.metrics.longestDarkHours) !== Math.round(ev.metrics.longestDarkHours) ? `; longest night ${spanText(base.metrics.longestDarkHours)} → ${spanText(ev.metrics.longestDarkHours)}` : "";
  if (ev.kind === base.kind) return `${ev.kind === "robust" ? `Still ${worksText(pin.within)}` : ev.kind === "spot" ? "Still valid at target spot only" : "Still invalid"} after ${by}${night}`;
  if (SCORE[ev.kind] > SCORE[base.kind]) return `Better after ${by}: ${ev.reasons?.length ? failWords(ev.reasons).replace(/^Night/, "night") : kindText(ev.kind, pin.within)}${night}`;
  return `${base.kind === "robust" ? `No longer ${worksText(pin.within)}` : "No longer valid"} after ${by}: ${ev.reasons?.length ? failWords(ev.reasons).replace(/^Night/, "night") : kindText(ev.kind, pin.within)}${night}`;
}

const tile = (k, v, bad = false) => `<div class="lz-tile${bad ? " bad" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

function renderCards() {
  const maxMission = Math.max(...shown.map((r) => r.pin.mission));
  const cards = shown.map((r, i) => {
    const { pin, ev } = r;
    let [cls, word] = pillOf(ev.kind, pin.within);
    if (ev.reasons?.length) word = failWords(ev.reasons);
    const moved = movedText(r);
    const broke = shift && SCORE[ev.kind] < SCORE[r.base.kind];
    const m = ev.metrics;
    const night = m.longestDarkHours;
    const f = ev.facts;
    const failing = ev.kind === "night" || ev.kind === "dsn";
    const tiles = `<div class="lz-tiles compact">`
      + tile(`Longest night${darkBelowSuffix(pin.dbelow)} ${hintHtml(NIGHT_HINT)}`, `${spanText(night)} <small>/ ${ev.limit} h limit</small>`, night > ev.limit)
      + tile(`DSN visibility${dsnSuffix(pin.dstation)} ${hintHtml(DSN_HINT)}`, `${Math.round(m.dsnLinkFraction * 100)}% <small>/ ${pin.link ? `≥ ${pin.link}% target` : "no minimum"}</small>`, m.dsnLinkFraction < ev.minLink - 1e-9)
      + tile(`${SUN_HIGHEST_LABEL} <button type="button" class="hint" data-hint="${esc(SUN_HIGHEST_HINT)}">ⓘ</button>`, `${degText(f.sunHighest)}${f.sunClears ? ` <small>${esc(f.sunClears)}</small>` : ""}`)
      + tile("Dispersion valid", pin.within ? `${ev.ringOk} <small>of ${ev.ringTotal} (${pin.within} m)</small>` : "<small>Target spot only</small>")
      + tile("+0.25° horizon margin", failing ? "–" : ev.holds ? "Holds" : "Fails", !failing && !ev.holds)
      + `</div>`;
    const array = f.capture ? `<p class="pl-note" title="${ARRAY_HINT}">A vertical Sun-tracking array captures ${pctText(f.capture.upright)} of incident sunlight; a horizontal panel ${flatText(f.capture.flat)}.</p>` : "";
    const site = r.name === pin.spot ? (catalog.spots.get(pin.spot)?.siteName ?? "") : "";
    return `<article class="lz-card" data-i="${i}" aria-label="${esc(r.name)}, ${pinDay(r.landing)}">`
      + `<header><span class="pl-tag ${cls}">${word}</span><h2>${esc(r.name)}${site ? ` <small>${esc(site)}</small>` : ""}</h2><button type="button" class="x" data-unpin="${i}" aria-label="Remove the pin for ${esc(r.name)}" title="Remove the pin for ${esc(r.name)}">${icon("x")}</button></header>`
      + `<p class="exp-h when">${pinDay(r.landing)}, ${pinTime(r.landing)} · ${pin.mast} m mast · ${pin.mission} d mission</p>`
      + (moved ? `<p class="moved ${broke ? "bad" : ""}">${esc(moved)}</p>` : "")
      + (broke ? `<p><button type="button" class="exp-btn small" data-repin="${i}">Re-pin at the next valid landing at this spot</button> <span class="repin-note" id="repin-${i}"></span></p>` : "")
      + `<canvas class="event-chart" data-i="${i}" role="img" aria-label="Sun, Earth and DSN in view over the ${pin.mission}-day mission, in days since landing"></canvas>`
      + tiles + array
      + `<details class="q"><summary>Query</summary><p>${esc(pinSentence({ ...pin, landing: pin.landing }, limitOf(pin), r.name))}</p></details></article>`;
  });
  const add = shown.length < 4 ? `<a class="lz-card add" href="planner.html"><span>${icon("pin")}</span><b>Add another landing</b><small>Select a touchdown window in the Planner and click the pin icon.</small></a>` : "";
  $("cards").innerHTML = cards.join("") + add;
  $("cards").dataset.span = String(maxMission);
  drawCharts();
}

function drawCharts() {
  const span = Number($("cards").dataset.span) * 86400;
  for (const canvas of $("cards").querySelectorAll("canvas.event-chart")) {
    const r = shown[Number(canvas.dataset.i)];
    if (!r) continue;
    const { series, link } = r.ev;
    const levels = { sun: Array.from(series.sunFraction, sunLevel), earth: Array.from(series.earthFraction, earthLevel), dsn: link };
    const perDay = 86400 / STEP_S;
    const dayStarts = [];
    for (let k = 0; k * perDay < series.et.length; k++) dayStarts.push({ index: k * perDay, label: k === 0 ? "0" : String(k) });
    const night = longestRun(levels.sun, 0);
    const nightH = night ? ((night[1] - night[0]) * STEP_S) / 3600 : 0;
    drawEventChart(canvas, { et: series.et, levels, current: null, dayStarts, night, nightText: night ? `Night ${spanText(nightH)}` : "", nightOver: nightH > r.ev.limit, spanS: span });
  }
}

// ---- events

function wire() {
  $("cards").addEventListener("click", async (e) => {
    const un = e.target.closest("[data-unpin]");
    if (un) { removePin(pinId(shown[Number(un.dataset.unpin)].pin)); return; }
    const rp = e.target.closest("[data-repin]");
    if (rp) repin(Number(rp.dataset.repin), rp);
  });
  $("shift").addEventListener("input", validShift);
  $("rerun").addEventListener("click", () => {
    const n = Math.round(Number($("shift").value));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 120) { $("status").textContent = "Enter a shift of 1 to 120 days, earlier (negative) or later."; return; }
    shift = n;
    sync();
    run();
  });
  $("reset").addEventListener("click", () => { shift = 0; sync(); run(); });
  $("csv").addEventListener("click", () => shown.length && download(pinsToCsv(entries()), "pinned-landings.csv", "text/csv"));
  $("ics").addEventListener("click", () => shown.length && download(pinsToIcs(entries()), "pinned-landings.ics", "text/calendar"));
}

// What the exports record: each pin as shown now.
function entries() {
  return shown.map((r) => ({
    pin: r.pin, name: r.name, landing: r.landing, kind: r.ev.kind, limitH: r.ev.limit, longestNightH: r.ev.metrics.longestDarkHours,
    dsnShare: r.ev.metrics.dsnLinkFraction, neighbours: `${r.ev.ringOk} of ${r.ev.ringTotal}`, holds: r.ev.holds, shiftDays: shift,
  }));
}

// A pin that broke after the shift: the next landing within 100 m at its spot after the shifted date, within six months.
async function repin(i, button) {
  const r = shown[i];
  const note = $(`repin-${i}`);
  button.disabled = true;
  note.textContent = "Searching the next six months…";
  const day = r.landing.slice(0, 10);
  const res = await evaluateRange(r.pin, day, 180);
  const rule = { maxDarkHours: limitOf(r.pin), minLinkFraction: r.pin.link / 100 };
  const run1 = res ? robustRuns(res.rows, rule)[0] : null;
  if (!run1) { note.textContent = `No landing that ${worksText(r.pin.within).replace(/ at the spot$/, "")} at this spot in the next six months.`; button.disabled = false; return; }
  const landing = landingValue(run1.startEt);
  const next = pins.map((p) => (pinId(p) === pinId(r.pin) ? { ...p, landing, start: day, days: 61, kind: "robust" } : p));
  shift = 0;
  pins = savePins(next);
  sync();
  run();
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

main();

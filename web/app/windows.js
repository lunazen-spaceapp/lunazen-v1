// Delay impact (windows.html): for one lander, a chosen spot and a chosen day, whether the spot works, how long it
// keeps working, when its next window opens, and how the other spots fare, from the year's day-by-day results
// (precomputed for the default rule in 2026-2029, computed on request for any other). The grid of every spot against
// every day is kept under "Every spot, every day". A click on a row or a grid cell opens that spot and day in the Planner.

import { Ephemeris, SiteCatalog, parseUtc } from "../engine/index.js";
import { sentenceText, normalizeReach, ringCount, tokenText } from "./reach.js";
import { mountHelp, wireRows, setSummary } from "./planshell.js";
import { createPool } from "./pool.js";
import "./theme.js";
import "./tray.js";
import { onThemeChange } from "./theme.js";
import { plannable } from "./picker.js";
import { ensureCustom } from "./customs.js";
import { loadMine } from "./myspots.js";
import { isCustomId } from "../engine/index.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { carryHash, clampDate, darkBelowSuffix, dsnRuleOf, dsnSuffix, normalizeDarkBelow, normalizeDstation, parseState, serializeState } from "./format.js";
import { PLANNING } from "./defaults.js";
import { createQuestion } from "./question.js";
import { verdictHtml } from "./components.js";
import { spanText } from "./query-model.js";
import { dayLabel } from "./plan.js";
import { spotName } from "./myspots.js";
import { WINDOW_RULE, WINDOW_YEARS, TOO_DARK, TOO_LITTLE_LINK, decodeDays, isDefaultRule, pointsWorking, slipRanking, works, yearView } from "./windows-data.js";

const MIN_DATE = "2025-01-01"; // whole calendar years, so the year view starts on 1 January
const MAX_DATE = "2042-12-31";
const MS = 86400000;
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (c) => (c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
const siteOf = (s) => (s.site === "mine" ? "mine" : s.id.replace(/-\d+$/, ""));
const rowName = (s) => s.label ?? s.id;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const DEFAULTS = { spot: "Site01-1", ...PLANNING };
const FIELDS = ["mast", "date", "mission", "rule", "dark", "link"];

let ephemeris, catalog, pool, file, question;
let state;
let runId = 0, timer = null;
let gridView = null;       // yearView of the grid tab, or null while it has not been computed
let gridKey = "";
let baseSpots = null;      // the spots of the grid without the extra rows (saved spots, a custom point)
let appliedExtras = "";    // which extra rows the grid now has
let SITES = [], ORDER = [];
let hover = null, playTimer = null;

// ---- boot
const KEYS = { spot: "spot", date: "date", mission: "len", rule: "night", dark: "night", link: "dsn", mast: "mast", within: "within", dbelow: "night", dstation: "dsn" };

let clampedTo = ""; // the date a request outside the covered years was moved to, so the note stays until the date changes
function normalize(q) {
  const out = { ...q };
  out.date = clampDate(out.date, MIN_DATE, MAX_DATE);
  if (out.date !== q.date) clampedTo = out.date;
  else if (q.date !== clampedTo) clampedTo = "";
  const note = document.getElementById("date-note");
  if (note) {
    note.hidden = !clampedTo;
    note.textContent = clampedTo ? `Launch delay sensitivity covers ${MIN_DATE.slice(0, 4)}-${MAX_DATE.slice(0, 4)}; showing ${new Date(`${clampedTo}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })}.` : "";
  }
  out.mission = Math.round(Math.min(Math.max(out.mission, 1), 120));
  out.link = Math.min(Math.max(out.link, 0), 100);
  out.dark = Math.min(Math.max(out.dark, 0), 2000);
  out.within = normalizeReach(out.within);
  out.dbelow = normalizeDarkBelow(out.dbelow);
  out.dstation = normalizeDstation(out.dstation);
  if (!catalog.mastsM.includes(out.mast)) out.mast = DEFAULTS.mast;
  if (out.rule !== "custom" && !catalog.darknessPresets.some((p) => p.id === out.rule)) out.rule = DEFAULTS.rule;
  return out;
}

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
    file = await fetchJson("data/windows.json");
  } catch (error) {
    dataLoadError(error, "windows.html");
    return;
  }
  pool = createPool(new URL("data", location.href).href, { ephemeris, catalog });
  const first = parseState(location.hash, DEFAULTS);
  if (new URLSearchParams(location.hash.slice(1)).get("tab") === "day") { // old links to the Landing day tab: the Planner has it now
    location.replace(`planner.html${carryHash("planner.html", { spot: first.spot, mast: first.mast, start: first.date, mission: first.mission, rule: first.rule, dark: first.dark, dbelow: first.dbelow, dstation: first.dstation, link: first.link, within: first.within })}`);
    return;
  }
  await ensureCustom(catalog, "data", first.spot);
  question = createQuestion({
    els: { sentence: $("sentence"), trail: $("trail"), pop: $("pop") },
    ctx: { catalog, rankHref: () => `rank.html${carryHash("rank.html", { mast: state.mast, start: state.date, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within })}`, dateField: "date" },
    parse: (hash) => { const q = parseState(hash, DEFAULTS); if (!plannable(catalog, q.spot)) q.spot = DEFAULTS.spot; return q; },
    serialize: (q) => serializeState(q),
    normalize,
    keyOf: (patch) => KEYS[Object.keys(patch)[0]] ?? "date",
    summary: () => (state && gridView ? slipSummary() : null),
    segments: (q) => [
      "Evaluate touchdown at ", { key: "spot", text: spotName(q.spot) }, " slipping to ", { key: "date", text: dayLabel(q.date) },
      " – ", { key: "len", text: `${q.mission} d` }, " mission, max night ", { key: "night", text: `${q.rule === "custom" ? q.dark : catalog.darknessPresets.find((p) => p.id === q.rule).hours} h${darkBelowSuffix(q.dbelow)}` },
      ", min DSN ", { key: "dsn", text: `${q.link > 0 ? `≥ ${q.link}%` : "none"}${dsnSuffix(q.dstation)}` }, ", mast ", { key: "mast", text: `${q.mast} m` }, ", ", { key: "within", text: sentenceText(q.within) },
    ],
    run: async (q, info) => { await ensureCustom(catalog, "data", q.spot); if (!plannable(catalog, q.spot)) question.set({ spot: DEFAULTS.spot }); state = question.state; before = info.before; run(); },
  });
  state = question.state;
  wire();
  onThemeChange(() => paint());
  addEventListener("resize", () => paint());
  wireCopyLink($("copy-link"));
  wireRows("windows.html");
  mountHelp("How to use Delay impact", [
    ["Set the question", "<p>Click the orange words in the sentence to change what you are asking: the spot or day, the mission length, the limits for darkness and DSN visibility, the mast height and the dispersion radius.</p>"],
    ["Read the results", "<p>The chart counts the valid spots for each landing day of the year; click or drag it to choose the day. The table shows how the selected target and the best backup spots fare if touchdown slips. Click any row to open that spot in the Planner.</p>"],
  ]);
  question.start();
}
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

// What the chosen spot's answer is, for the pill after a change: works on the day, how long it keeps working, the next window.
function slipSummary() {
  const me = spotOf(state.spot);
  if (!me) return null;
  const st = slipRanking([me], dayIndex(), tailOf)[0].slip;
  return { works: st.works, slack: st.slack, next: st.next, spot: state.spot };
}
let before = null;

function maxDarkHours() {
  return state.rule === "custom" ? state.dark : catalog.darknessPresets.find((p) => p.id === state.rule).hours;
}
const ruleOf = () => ({ missionDays: state.mission, maxDarkHours: maxDarkHours(), minLink: state.link / 100, mastM: state.mast, strideHours: WINDOW_RULE.strideHours, within: state.within, dbelow: state.dbelow, dstation: state.dstation });
const ruleKey = () => `${state.mast}|${state.mission}|${maxDarkHours()}|${state.link}|${state.within}|${state.dbelow}|${state.dstation}`;
const year = () => Number(state.date.slice(0, 4));
const yearStart = () => parseUtc(`${year()}-01-01T00:00:00`);
const yearDays = () => Math.round((parseUtc(`${year() + 1}-01-01T00:00:00`) - parseUtc(`${year()}-01-01T00:00:00`)) / 86400);
const dayIndex = () => Math.round((Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${year()}-01-01T00:00:00Z`)) / MS);
const dateAt = (d, y = year()) => new Date(Date.UTC(y, 0, 1) + d * MS).toISOString().slice(0, 10);
const fmt = (d, long = true) => new Date(Date.UTC(year(), 0, 1) + d * MS).toLocaleDateString("en-GB", { timeZone: "UTC", ...(long ? { weekday: "short" } : {}), day: "numeric", month: long ? "long" : "short" });

// ---- running
function run() {
  $("results").classList.remove("stale");
  carryNav({ spot: state.spot, mast: state.mast, start: state.date, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within });
  renderGrid();
  renderAnswer();
}

const task = (spot, et0, days) => ({ kind: "windows", spot, mast: state.mast, et0, days, within: state.within, darkBelow: state.dbelow / 100, dsnRule: dsnRuleOf(state.dstation), rule: ruleOf() });

const showCards = (on) => { for (const id of ["hero-card", "slip-card", "grid-details"]) $(id).hidden = !on; };
const paint = () => { drawHero(); renderSlip(); drawGrid(); renderAnswer(); };

const nameOf = (s) => s.label ?? s.id;
// A day index counted from 1 January of the chosen year; past the year's end it is a day of the next year, written with its year.
const short = (d) => {
  const t = new Date(Date.UTC(year(), 0, 1) + d * MS);
  const text = t.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  return t.getUTCFullYear() === year() ? text : `${text} ${t.getUTCFullYear()}`;
};
const shortReason = (code) => (code === TOO_LITTLE_LINK ? "DSN below limit" : "Night exceeds limit");
const reasonOf = (code) => (code === TOO_LITTLE_LINK ? "DSN visibility below threshold" : "night exceeds limit");
const days = (n) => plural(n, "day");
const spotOf = (id) => gridView?.spots.find((s) => s.id === id);

// ---- searching on into the next year: a window that crosses 31 December is whole, and "when does the next one open" looks past it
const LAST_YEAR = 2043; // the ephemeris ends in 2044, so 2043 is the last whole year
const daysIn = (y) => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / MS);
const tailCache = new Map(); // `${ruleKey}|${year}|${id}` -> day codes of that year
const tailPending = new Set(), tailTried = new Set();
const tailKey = (id, y) => `${ruleKey()}|${y}|${id}`;
// The codes of the year after the chosen one for a spot: from the precomputed file, from an earlier computation, [] at the end of the data, or null when not known yet.
function tailOf(s) {
  const y = year() + 1;
  if (y > LAST_YEAR) return [];
  const stored = isDefaultRule(ruleOf()) ? s.days?.[y] : undefined;
  if (typeof stored === "string") return decodeDays(stored);
  return tailCache.get(tailKey(s.id, y)) ?? null;
}
// Compute the next year for these spots (one pool task each), then repaint. progress(n, total) is optional.
async function ensureTails(ids, progress = () => {}) {
  const y = year() + 1;
  if (y > LAST_YEAR) return;
  const mine = runId, rk = ruleKey();
  const todo = ids.filter((id) => { const s = spotOf(id); return s && !tailOf(s) && !tailPending.has(tailKey(id, y)) && !tailTried.has(tailKey(id, y)); });
  let done = 0;
  await Promise.all(todo.map(async (id) => {
    const k = tailKey(id, y);
    tailPending.add(k);
    try {
      const r = await pool.run(task(id, parseUtc(`${y}-01-01T00:00:00`), daysIn(y)));
      tailCache.set(k, decodeDays(r.codes));
    } catch { /* leave it: the page says the search stopped at the year end and offers to compute again */ }
    tailTried.add(k);
    tailPending.delete(k);
    progress(++done, todo.length);
  }));
  if (todo.length && mine === runId && rk === ruleKey() && gridView) paint();
}
// Where a slip search stopped: the year of the last day it covered.
const searchedYear = (st) => new Date(Date.UTC(year(), 0, 1) + (st.searched - 1) * MS).getUTCFullYear();
const noWindow = (st) => `no window found before 31 Dec ${searchedYear(st)}`;
const stillSearching = (s, st) => st.endHit && !tailOf(s) && year() < LAST_YEAR && tailPending.has(tailKey(s.id, year() + 1));

// Move the chosen day (within the grid's year) without recomputing anything.
function setDay(d) {
  if (!gridView) return;
  d = Math.max(0, Math.min(gridView.nDays - 1, d));
  if (dateAt(d) === state.date) return;
  question.set({ date: dateAt(d) });
  state = question.state;
  question.render();
  carryNav({ spot: state.spot, mast: state.mast, start: state.date, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within });
  paint();
}

// The banner and the three answers on top (the chosen spot's verdict for the day, how long it keeps working and when its next
// window opens), then a sentence about the day's totals and the other spots.
function renderAnswer() {
  if (!gridView) { $("verdict").innerHTML = ""; $("answers").innerHTML = ""; $("story").textContent = `Compute ${year()} to see which spots are valid on ${fmt(dayIndex())}.`; return; }
  const d = dayIndex(), n = gridView.working[d], total = gridView.spots.length;
  const me = spotOf(state.spot);
  const st = me ? slipRanking([me], d, tailOf)[0].slip : null;
  const day = dayLabel(state.date);
  const plus = (i) => `+${i - d} d`, minus = (i) => `−${d - i} d`;
  if (me) {
    if (st.endHit && !tailOf(me) && year() < LAST_YEAR) ensureTails([me.id]); // the search reached the year end: look into the next year
    const searching = stillSearching(me, st);
    const p = pointsWorking(me.codes[d]), near = me.points - 1;
    const nothing = searching ? `Looking into ${year() + 1} for the next window…` : noWindow(st);
    const next = st.next === null ? nothing : `${short(st.next)} (${plus(st.next)})`;
    const model = st.works
      ? { state: p === me.points ? "ok" : "info", title: p === me.points ? `${day} – ${nameOf(me)} valid ${tokenText(state.within)}` : `${day} – ${nameOf(me)} valid at target spot (${p - 1} of ${near} dispersion points pass)`, reason: `${st.slack ? `Stays valid for ${days(st.slack)}, to ${short(st.runEnd)}` : "Valid on that day only"} · Next valid window: ${next}.` }
      : { state: "bad", title: `${day} – ${nameOf(me)} invalid: ${reasonOf(st.code)}`, reason: `Next valid window: ${next} · Prior valid window: ${st.prev === null ? "none found" : `${short(st.prev)} (${minus(st.prev)})`}.` };
    let delta = "";
    if (before && before.spot === state.spot) delta = `Compared with before: ${before.works !== st.works ? (st.works ? "it is valid now." : "it is no longer valid.") : st.works && before.slack !== st.slack ? `it stays valid ${days(Math.abs(st.slack - before.slack))} ${st.slack > before.slack ? "longer" : "less"}.` : "no change."}`;
    else if (before) delta = "Compared with before: a different spot.";
    $("verdict").innerHTML = verdictHtml(model, { delta });
    const tile = (k, v, bad = false) => `<div class="lz-tile${bad ? " bad" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    $("answers").innerHTML = `<div class="lz-tiles big">`
      + tile("Target date status", st.works ? `Valid <small>${near ? `${p - 1} of ${near} dispersion points` : "at the target spot"}</small>` : `Invalid <small>${shortReason(st.code)}</small>`, !st.works)
      + tile("Window duration", st.works ? (st.slack ? `${days(st.slack)} <small>to ${short(st.runEnd)}</small>` : "1 day <small>That day only</small>") : "0 days <small>Closed on target date</small>")
      + tile("Next opportunity", st.next === null ? (searching ? `Looking into ${year() + 1}…` : `None <small>before 31 Dec ${searchedYear(st)}</small>`) : `${short(st.next)} <small>${plus(st.next).replace(" d", " days")}</small>`)
      + `</div>`;
  } else {
    $("verdict").innerHTML = "";
    $("answers").innerHTML = "";
  }
  const others = slipRanking(gridView.spots.filter((x) => x.id !== state.spot), d, tailOf).filter((x) => x.slip.works).slice(0, 3).map(nameOf);
  const backups = others.length ? `Valid backup spots ranked by window duration: ${others.join(", ")}.` : "No other spot is valid that day.";
  $("story").textContent = `${n} of ${total} spots pass at nominal coordinates on ${day}${state.within ? ` (${gridView.robust[d]} pass full ${state.within} m dispersion)` : ""}. ${backups}`;
  $("planner-link").href = `planner.html${carryHash("planner.html", { spot: state.spot, mast: state.mast, start: state.date, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within })}`;
  $("planner-link").textContent = `Open ${spotName(state.spot)} in Planner`;
  $("rank-link").href = `rank.html${carryHash("rank.html", { mast: state.mast, start: state.date, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within })}`;
  $("rank-link").textContent = `Rank spots on ${day}`;
}

// ---- the spots-per-day chart: the hero
const hero = $("hero"), hg = hero.getContext("2d");
const HL = 36, HR = 12, HT = 24, HH = 176, HB = 24;
let heroGeom = { N: 365, cw: 2 };

function drawHero() {
  if (!gridView) return;
  const view = gridView, N = view.nDays, y = year();
  const W = Math.max($("hero").parentElement.clientWidth, 300), dpr = window.devicePixelRatio || 1;
  hero.width = W * dpr; hero.height = HH * dpr; hero.style.width = W + "px"; hero.style.height = HH + "px";
  hg.setTransform(dpr, 0, 0, dpr, 0, 0);
  hg.clearRect(0, 0, W, HH);
  const cw = (W - HL - HR) / N, X = (d) => HL + d * cw, base = HH - HB, th = base - HT;
  heroGeom = { N, cw };
  const top = Math.max(...view.working, 1), step = top <= 10 ? 2 : top <= 25 ? 5 : top <= 60 ? 10 : 20, max = Math.ceil(top / step) * step;
  const lo = rgb(css("--win-lo")), hi = rgb(css("--win-hi")), all = css("--win-all");
  const mut = css("--muted"), line = css("--grid"), acc = css("--accent"), fg = css("--fg");
  hg.font = "11px system-ui, sans-serif"; hg.textBaseline = "middle";
  hg.strokeStyle = line; hg.lineWidth = 1; hg.fillStyle = mut; hg.textAlign = "right";
  for (let v = 0; v <= max; v += step) { const yy = base - (v / max) * th; hg.beginPath(); hg.moveTo(HL, yy); hg.lineTo(W - HR, yy); hg.stroke(); hg.fillText(v, HL - 6, yy); }
  for (let d = 0; d < N; d++) {
    const a = (view.working[d] / max) * th, b = (view.robust[d] / max) * th;
    hg.fillStyle = mix(lo, hi, .55); hg.fillRect(X(d), base - a, cw + .3, a);
    hg.fillStyle = all; hg.fillRect(X(d), base - b, cw + .3, b);
  }
  hg.fillStyle = mut; hg.textAlign = "left";
  const t0 = Date.UTC(y, 0, 1);
  for (let mo = 0; mo < 12; mo++) {
    const d = (Date.UTC(y, mo, 1) - t0) / MS;
    hg.strokeStyle = line; hg.beginPath(); hg.moveTo(X(d), base); hg.lineTo(X(d), base + 4); hg.stroke();
    if (W < 520 && mo % 2) continue; // narrow screens: every other month is named
    hg.fillText(new Date(t0 + d * MS).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" }), X(d) + 3, base + 13);
  }
  // The chosen day: a line, with its date and count above.
  const d = dayIndex(), x = X(d) + cw / 2;
  hg.strokeStyle = acc; hg.lineWidth = 2; hg.beginPath(); hg.moveTo(x, HT - 6); hg.lineTo(x, base); hg.stroke();
  const label = `${short(d)}: ${plural(view.working[d], "spot")}`;
  hg.font = "600 12px system-ui, sans-serif"; hg.fillStyle = fg;
  const w = hg.measureText(label).width, lx = Math.max(HL, Math.min(W - HR - w, x - w / 2));
  hg.textAlign = "left"; hg.fillText(label, lx, 9);
  if (heroHover !== null && heroHover !== d) { hg.strokeStyle = mut; hg.lineWidth = 1; hg.beginPath(); hg.moveTo(X(heroHover) + cw / 2, HT - 6); hg.lineTo(X(heroHover) + cw / 2, base); hg.stroke(); }
}
let heroHover = null;

// ---- the slip table: the chosen spot, your saved spots and the best others, each with the next months as a strip
const SHOW = 12, STRIP_BEFORE = 14, STRIP_DAYS = 120;
let showAll = false;
let stripRows = [];

function renderSlip() {
  if (!gridView) return;
  const d = dayIndex(), N = gridView.nDays;
  const ranked = slipRanking(gridView.spots, d, tailOf);
  const main = ranked.find((s) => s.id === state.spot);
  const saved = ranked.filter((s) => s.site === "mine" && s.id !== state.spot);
  const rest = ranked.filter((s) => s !== main && s.site !== "mine");
  const head = [main, ...saved].filter(Boolean);
  const shown = showAll ? [...head, ...rest] : [...head, ...rest.slice(0, Math.max(0, SHOW - head.length))];
  stripRows = shown;
  const s0 = Math.max(0, d - STRIP_BEFORE), s1 = Math.min(N - 1, s0 + STRIP_DAYS - 1);
  $("slip-title").textContent = `Backup spots · ${dayLabel(state.date)}`;
  const hand = (id) => `planner.html${carryHash("planner.html", { spot: id, mast: state.mast, start: dateAt(d), mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within })}`;
  const plus = (i) => `+${i - d} d`, minus = (i) => `−${d - i} d`;
  const row = (s) => {
    const st = s.slip, p = pointsWorking(s.codes[d]);
    const status = st.works
      ? `<span class="pl-res">${p === s.points && state.within ? `Full ${state.within} m valid (${p}/${s.points} pts)` : `Nominal valid (${p}/${s.points} pts)`}</span>`
      : `<span class="pl-res ${st.code === TOO_LITTLE_LINK ? "dsn" : "fail"}">${shortReason(st.code)}</span>`;
    const tail = st.next === null ? noWindow(st) : null;
    const tolerance = st.works
      ? `<b>${st.slack ? `Valid ${days(st.slack)} (to ${short(st.runEnd)})` : `1 day only (${short(d)})`}</b> · ${tail ?? `Next window ${short(st.next)} (${plus(st.next)})`}`
      : `<b>${st.next === null ? "No valid day found" : `Next valid ${short(st.next)}`}</b>${st.next === null ? "" : ` · ${plus(st.next)}`}${st.prev === null ? "" : ` · Prior ${short(st.prev)} (${minus(st.prev)})`}`;
    const cls = [s.id === state.spot ? "slip-main" : "", s.site === "mine" ? "mine-row" : ""].filter(Boolean).join(" ");
    const note = s.id === state.spot ? "Selected target" : s.site === "mine" ? "★ My point" : s.siteName;
    return `<tr class="${cls}" data-href="${hand(s.id)}" data-id="${s.id}" tabindex="0" title="Open ${nameOf(s)} on ${fmt(d, false)} in the Planner">`
      + `<th scope="row"><span class="pl-spot"><b>${nameOf(s)}</b><small>${note}</small></span></th><td>${status}</td><td>${tolerance}</td>`
      + `<td><canvas class="strip" data-id="${s.id}" aria-label="The next four months for ${nameOf(s)}"></canvas></td></tr>`;
  };
  $("slip").innerHTML = `<thead><tr><th>Spot</th><th>${short(d)} status</th><th>Slip tolerance</th><th title="Each cell is a landing day: green valid, brown fails because the night exceeds the limit, blue fails because DSN visibility is below the threshold. The white line is the chosen day.">4-month window (${short(s0)} – ${short(s1)})</th></tr></thead><tbody>${shown.map(row).join("")}</tbody>`;
  for (const c of $("slip").querySelectorAll("canvas.strip")) drawStrip(c, spotOf(c.dataset.id), d, s0, s1);
  // Spots whose search ended at the year end, with no next year known: offer to look further instead of saying there is none.
  const open = shown.filter((s) => s.slip.endHit && !tailOf(s) && year() < LAST_YEAR && !tailPending.has(tailKey(s.id, year() + 1)));
  const lf = $("look-further");
  lf.hidden = !open.length;
  if (open.length) {
    lf.innerHTML = `${open.length === 1 ? "One spot has" : `${open.length} spots have`} no valid window found before 31 Dec ${year()}. <button type="button" id="look-btn">Compute ${year() + 1} to look further</button>`;
    $("look-btn").onclick = async () => {
      const btn = $("look-btn");
      btn.disabled = true;
      await ensureTails(gridView.spots.map((x) => x.id), (n, total) => { btn.textContent = `Computed ${n} of ${total}…`; });
    };
  }
  $("slip-more").hidden = rest.length <= Math.max(0, SHOW - head.length);
  $("slip-more").textContent = showAll ? "Show fewer" : `Show every spot (${gridView.spots.length})`;
  $("slip-more").setAttribute("aria-expanded", String(showAll));
  $("slip-key").innerHTML = `<span><i class="sw" style="background:var(--win-hi)"></i>Nominal valid</span>${state.within ? `<span><i class="sw" style="background:var(--win-all)"></i>Full ${state.within} m valid (${1 + ringCount(state.within)}/${1 + ringCount(state.within)} pts)</span>` : ""}<span><i class="sw" style="background:var(--win-dark)"></i>Night exceeds limit</span><span><i class="sw" style="background:var(--win-link)"></i>DSN below limit</span><span>White marker: selected day · Click any row to open in Planner.</span>`;
}

function drawStrip(canvas, s, d, s0, s1) {
  const W = 280, H = 18, dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lo = rgb(css("--win-lo")), hi = rgb(css("--win-hi")), all = css("--win-all"), nite = css("--win-dark"), link = css("--win-link");
  const cw = W / STRIP_DAYS;
  for (let k = s0; k <= s1; k++) {
    const code = s.codes[k], p = pointsWorking(code);
    c.fillStyle = p === s.points ? all : p > 0 ? mix(lo, hi, 0.25 + 0.7 * (p / s.points)) : code === TOO_LITTLE_LINK ? link : nite;
    c.fillRect((k - s0) * cw, 2, cw + .3, H - 4);
  }
  c.fillStyle = css("--fg");
  c.fillRect((d - s0) * cw, 0, Math.max(1.5, cw), H);
  canvas.dataset.s0 = s0;
}

// ---- the year grid
const LBL = 72, RGT = 104, TOPH = 96, AXH = 22, RH = 11, GAP = 22, PADB = 8;
const rowY = (r) => { let g = 1; for (let k = 1; k <= r; k++) if (siteOf(ORDER[k]) !== siteOf(ORDER[k - 1])) g++; return TOPH + AXH + r * RH + g * GAP - 6; };
const cv = $("chart"), g = cv.getContext("2d");
let CW = 3;

// The grid for the date's year: the precomputed file for the default rule, otherwise computed on request.
function renderGrid() {
  const y = year(), key = `${ruleKey()}|${y}`;
  const note = $("all-note");
  if (isDefaultRule(ruleOf()) && WINDOW_YEARS.includes(y)) {
    if (gridKey !== key) { baseSpots = file.spots; gridView = yearView(file, y); gridKey = key; appliedExtras = ""; setupGrid(); addMine(key); }
    else if (extraSig() !== appliedExtras) addMine(key); // another custom point was chosen
    note.hidden = true;
  } else if (gridKey !== key) {
    gridView = null;
    note.hidden = false;
    note.innerHTML = `<p>${y} is not precomputed for these settings. Computing all ${file.spots.length} spots takes a few seconds.</p><p><button id="compute" type="button">Compute ${y} for these settings</button></p>`;
    $("compute").onclick = computeGrid;
  } else { note.hidden = true; }
  showCards(Boolean(gridView));
  if (gridView) paint();
}

// The saved spots (My points), and the chosen spot if it is a custom point that is not saved, as extra rows of the grid:
// traced if needed, then computed for this year and rule.
const mineCache = new Map();
function extraSpots() {
  const saved = loadMine();
  const list = saved.map((m) => ({ ...m, siteName: "My points" }));
  if (isCustomId(state.spot) && !saved.some((m) => m.id === state.spot)) list.push({ id: state.spot, name: "This point", siteName: "Custom point" });
  return list;
}
async function mineRows(y) {
  const rows = [];
  for (const m of extraSpots()) {
    if (!(await ensureCustom(catalog, "data", m.id))) continue;
    const ck = `${ruleKey()}|${y}|${m.id}`;
    if (!mineCache.has(ck)) mineCache.set(ck, pool.run(task(m.id, parseUtc(`${y}-01-01T00:00:00`), yearDays())).catch(() => null));
    const r = await mineCache.get(ck);
    if (r) rows.push({ id: m.id, label: m.name, site: "mine", siteName: m.siteName, points: r.points, days: { [y]: r.codes } });
  }
  return rows;
}

// Add those spots under the 67 once they are ready; the page is shown first, without them.
const extraSig = () => extraSpots().map((m) => m.id).join(",");
async function addMine(key, base = baseSpots ?? file.spots) {
  const sig = extraSig();
  if (!sig && !appliedExtras) return;
  const y = year(), mine = runId;
  $("status").textContent = "Adding your saved spots…";
  const rows = await mineRows(y);
  if (mine !== runId || key !== `${ruleKey()}|${year()}`) return;
  appliedExtras = sig;
  gridView = yearView({ spots: [...base, ...rows] }, y);
  $("status").textContent = `${plural(rows.length, "saved spot")} added.`;
  setupGrid();
  paint();
}

async function computeGrid() {
  const y = year(), key = `${ruleKey()}|${y}`, mine = runId;
  const button = $("compute");
  button.disabled = true;
  let done = 0;
  const t = performance.now();
  const spots = await Promise.all(file.spots.map(async (s) => {
    const r = await pool.run(task(s.id, parseUtc(`${y}-01-01T00:00:00`), yearDays()));
    button.textContent = `Computed ${++done} of ${file.spots.length}…`;
    return { ...s, points: r.points, days: { [y]: r.codes } };
  }));
  if (mine !== runId || key !== `${ruleKey()}|${year()}`) return;
  baseSpots = spots;
  appliedExtras = "";
  gridView = yearView({ spots }, y);
  gridKey = key;
  $("status").textContent = `Computed ${y} for ${file.spots.length} spots in ${((performance.now() - t) / 1000).toFixed(0)} s.`;
  $("all-note").hidden = true;
  setupGrid();
  showCards(true);
  paint();
  addMine(key, spots);
}

function setupGrid() {
  const groups = new Map();
  for (const s of gridView.spots) { const id = siteOf(s); if (!groups.has(id)) groups.set(id, { id, name: s.siteName, spots: [], works: 0 }); const gr = groups.get(id); gr.spots.push(s); gr.works += s.works; }
  SITES = [...groups.values()].sort((a, b) => b.works - a.works);
  ORDER = SITES.flatMap((st) => st.spots.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })));
  $("key").innerHTML = `<span><i class="sw" style="background:var(--win-lo)"></i>valid at the target spot${ringCount(state.within) ? `<i class="ramp"></i>more of its ${ringCount(state.within)} dispersion points valid` : ""}</span>${state.within ? `<span><i class="sw" style="background:var(--win-all)"></i>valid within ${state.within} m dispersion</span>` : ""}<span><i class="sw" style="background:var(--win-dark)"></i>fail: night exceeds limit</span><span><i class="sw" style="background:var(--win-link)"></i>fail: DSN visibility below threshold</span>`;
  setSummary("grid", `All ${gridView.spots.length} candidate spots across every landing day of the year`);
}

function drawGrid() {
  if (!gridView) return;
  const view = gridView, N = view.nDays, y = year();
  const W = Math.max($("chart").parentElement.clientWidth, 760), dpr = window.devicePixelRatio || 1, H = rowY(ORDER.length - 1) + RH + PADB;
  CW = (W - LBL - RGT) / N;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const lo = rgb(css("--win-lo")), hi = rgb(css("--win-hi")), all = css("--win-all"), nite = css("--win-dark"), link = css("--win-link"), empty = css("--win-empty");
  const mut = css("--muted"), line = css("--grid"), acc = css("--accent"), fg = css("--fg");
  const X = (d) => LBL + d * CW, t0 = Date.UTC(y, 0, 1);
  const label = (d, long) => new Date(t0 + d * MS).toLocaleDateString("en-GB", { timeZone: "UTC", ...(long ? { weekday: "short" } : {}), day: "numeric", month: "short" });
  g.textBaseline = "middle"; g.font = "12px system-ui, sans-serif";
  const th = TOPH - 14, max = 60, base = TOPH - 2;
  g.strokeStyle = line; g.lineWidth = 1;
  for (const v of [0, 20, 40, 60]) { const yy = base - (v / max) * th; g.beginPath(); g.moveTo(LBL, yy); g.lineTo(W - RGT, yy); g.stroke(); g.fillStyle = mut; g.textAlign = "right"; g.fillText(v, LBL - 8, yy); }
  g.textAlign = "left"; g.fillStyle = mut; g.font = "10.5px system-ui, sans-serif"; g.fillText("spots", 2, base - th / 2 - 6); g.fillText("that work", 2, base - th / 2 + 7); g.font = "12px system-ui, sans-serif";
  for (let d = 0; d < N; d++) {
    const a = (view.working[d] / max) * th, b = (view.robust[d] / max) * th;
    g.fillStyle = mix(lo, hi, .55); g.fillRect(X(d), base - a, CW + .3, a);
    g.fillStyle = all; g.fillRect(X(d), base - b, CW + .3, b);
  }
  g.fillStyle = fg; g.textAlign = view.bestDay > N * .8 ? "right" : "left";
  g.fillText(`best: ${label(view.bestDay)}, ${view.working[view.bestDay]} spots`, X(view.bestDay) + (view.bestDay > N * .8 ? -6 : 6), base - (view.working[view.bestDay] / max) * th + 4);
  for (let mo = 0; mo < 12; mo++) {
    const d = (Date.UTC(y, mo, 1) - t0) / MS;
    g.strokeStyle = line; g.beginPath(); g.moveTo(X(d), TOPH + 2); g.lineTo(X(d), H - PADB); g.stroke();
    g.fillStyle = mut; g.textAlign = "left"; g.fillText(new Date(t0 + d * MS).toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" }), X(d) + 4, TOPH + AXH / 2 + 2);
  }
  ORDER.forEach((s, r) => {
    const yy = rowY(r);
    if (r === 0 || siteOf(ORDER[r - 1]) !== siteOf(s)) { g.fillStyle = s.site === "mine" ? css("--mine") : fg; g.textAlign = "left"; g.font = "600 12px system-ui, sans-serif"; g.fillText(s.site === "mine" ? "★ My points (saved on the Map)" : `${siteOf(s)}  ·  ${s.siteName}`, 2, yy - 10); g.font = "12px system-ui, sans-serif"; }
    g.fillStyle = s.site === "mine" ? css("--mine") : mut; g.textAlign = "right"; g.font = "11px system-ui, sans-serif"; g.fillText(s.label ? s.label.slice(0, 9) : s.id.split("-")[1] ?? "", LBL - 8, yy + RH / 2); g.font = "12px system-ui, sans-serif";
    for (let d = 0; d < N; d++) {
      const c = s.codes[d], p = pointsWorking(c);
      g.fillStyle = p === s.points ? all : p > 0 ? mix(lo, hi, 0.25 + 0.7 * (p / s.points)) : c === TOO_LITTLE_LINK ? link : c === TOO_DARK ? nite : empty;
      g.fillRect(X(d), yy, CW + .3, RH - 1.5);
    }
    const bw = RGT - 40;
    g.fillStyle = empty; g.fillRect(W - RGT + 8, yy + 2, bw, RH - 5);
    g.fillStyle = mix(lo, hi, .55); g.fillRect(W - RGT + 8, yy + 2, bw * s.works / N, RH - 5);
    g.fillStyle = all; g.fillRect(W - RGT + 8, yy + 2, bw * s.robust / N, RH - 5);
    g.fillStyle = mut; g.textAlign = "left"; g.font = "10px system-ui, sans-serif"; g.fillText(Math.round(100 * s.works / N) + "%", W - RGT + 8 + bw + 4, yy + RH / 2); g.font = "12px system-ui, sans-serif";
  });
  g.fillStyle = mut; g.textAlign = "left"; g.fillText("share of days", W - RGT + 6, TOPH + AXH / 2 + 2);
  const sr = ORDER.findIndex((s) => s.id === state.spot);
  if (sr >= 0) { g.strokeStyle = acc; g.lineWidth = 1.5; g.strokeRect(LBL - 1, rowY(sr) - 1.5, N * CW + 2, RH + 1); }
  g.fillStyle = acc; g.fillRect(X(dayIndex()) - 1, 4, Math.max(2, CW) + 1, H - 4 - PADB);
  if (hover) { g.strokeStyle = fg; g.lineWidth = 1.2; g.strokeRect(X(hover.d) - .5, rowY(hover.r) - .5, Math.max(CW, 2) + 1, RH - .5); }
}

function gridCell(e) {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, yy = e.clientY - r.top, d = Math.floor((x - LBL) / CW);
  if (!gridView || d < 0 || d >= gridView.nDays) return null;
  for (let k = 0; k < ORDER.length; k++) if (yy >= rowY(k) - 1 && yy < rowY(k) + RH - .5) return { d, r: k };
  return yy < TOPH ? { d, r: -1 } : null;
}

// ---- interaction
const stepDay = (k) => setDay(dayIndex() + k);

function wire() {
  $("best").onclick = () => { if (gridView) setDay(gridView.bestDay); };
  $("play").onclick = () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; $("play").textContent = "Play"; return; }
    $("play").textContent = "Pause";
    playTimer = setInterval(() => { if (gridView) setDay((dayIndex() + 1) % gridView.nDays); }, 70); // a day at a time
  };
  // The chart: click or drag to choose the day, arrows to step it.
  const dayAt = (e) => Math.floor((e.clientX - hero.getBoundingClientRect().left - HL) / heroGeom.cw);
  const tipAt = (e, html) => { const t = $("tip"); t.innerHTML = html; t.style.display = "block"; t.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; t.style.top = e.clientY + 14 + "px"; };
  hero.onpointerdown = (e) => { hero.setPointerCapture(e.pointerId); hero.dataset.drag = "1"; setDay(dayAt(e)); };
  hero.onpointermove = (e) => {
    const d = dayAt(e);
    if (hero.dataset.drag) { setDay(d); return; }
    if (!gridView || d < 0 || d >= gridView.nDays) { heroHover = null; $("tip").style.display = "none"; drawHero(); return; }
    heroHover = d; drawHero();
    tipAt(e, `<b>${fmt(d)}</b><br>${plural(gridView.working[d], "spot")} valid, ${gridView.robust[d]} ${tokenText(state.within)}<br>Click to choose this day`);
  };
  hero.onpointerup = () => { delete hero.dataset.drag; };
  hero.onpointerleave = () => { heroHover = null; $("tip").style.display = "none"; drawHero(); };
  hero.onkeydown = (e) => {
    const k = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 7, ArrowDown: -7 }[e.key];
    if (k) { e.preventDefault(); setDay(dayIndex() + k); }
  };
  // The table: a row opens the Planner; the strips say what each day is.
  $("slip").onclick = (e) => { if (e.target.closest("a")) return; const tr = e.target.closest("tr[data-href]"); if (tr) location.href = tr.dataset.href; };
  $("slip").onkeydown = (e) => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-href]"); if (tr) location.href = tr.dataset.href; } };
  $("slip").onpointermove = (e) => {
    const c = e.target.closest("canvas.strip");
    if (!c || !gridView) { $("tip").style.display = "none"; return; }
    const s = spotOf(c.dataset.id), k = Number(c.dataset.s0) + Math.floor((e.clientX - c.getBoundingClientRect().left) / (280 / STRIP_DAYS));
    if (!s || k < 0 || k >= s.codes.length) { $("tip").style.display = "none"; return; }
    const code = s.codes[k], p = pointsWorking(code);
    tipAt(e, `<b>${nameOf(s)}</b> · ${fmt(k)}<br>${p ? `valid at ${p} of ${s.points} points${p === s.points ? ` (${tokenText(state.within)})` : ""}` : `fails: ${reasonOf(code)}`}`);
  };
  $("slip").onpointerleave = () => { $("tip").style.display = "none"; };
  $("slip-more").onclick = () => { showAll = !showAll; renderSlip(); };
  cv.onclick = (e) => {
    const c = gridCell(e); if (!c) return;
    const spot = c.r >= 0 ? ORDER[c.r].id : state.spot;
    location.href = `planner.html${carryHash("planner.html", { spot, mast: state.mast, start: dateAt(c.d), mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within })}`; // exact times for that spot and day
  };
  cv.onmousemove = (e) => {
    const c = gridCell(e), t = $("tip");
    hover = c && c.r >= 0 ? c : null; drawGrid();
    if (!c) { t.style.display = "none"; return; }
    t.style.display = "block"; t.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; t.style.top = e.clientY + 14 + "px";
    const dd = dateAt(c.d);
    if (c.r < 0) { t.innerHTML = `<b>${dd}</b><br>${gridView.working[c.d]} spots valid, ${gridView.robust[c.d]} ${tokenText(state.within)}`; return; }
    const s = ORDER[c.r], code = s.codes[c.d], p = pointsWorking(code);
    t.innerHTML = `<b>${rowName(s)}</b> · ${s.siteName}<br>${dd}<br>` + (p ? `valid at ${p} of ${s.points} points${p === s.points ? ` (${tokenText(state.within)})` : ""}` : code === TOO_LITTLE_LINK ? "fail: DSN visibility below threshold" : "fail: night exceeds limit");
  };
  cv.onmouseleave = () => { hover = null; $("tip").style.display = "none"; drawGrid(); };
  cv.onkeydown = (e) => { if (e.key === "ArrowRight") { e.preventDefault(); stepDay(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); stepDay(-1); } };
}

main();

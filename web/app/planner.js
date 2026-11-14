// Planner: one question about one spot, written as a sentence. Which landing times survive the whole mission with enough
// DSN in view at the spot and at the points up to the chosen miss distance around it (reach.js)? The sentence's tokens are the controls; the verdict,
// the heatmap of landing times, the mission, the ring of nearby points and the runs follow the question.
// Survival is a darkness limit with a source (Blue Ghost 1's 5 h, VIPER's 50 h design figure) or the visitor's own number; there is no power model.

import { Ephemeris, SiteCatalog, parseUtc, STEP_S } from "../engine/index.js";
import { createPool } from "./pool.js";
import { createEvaluator } from "./evaluate.js";
import { combine, dayLabel, landingValue, parseLanding, landingIndex, withRaisedSkyline } from "./plan.js";
import { GOALS, answerOf, cellKind, deltaText, goalLabel, heatGrid, countKinds, neededNightHours, rangeEnd, robustRuns, setRange, sortRuns, spanText, summarize, verdictModel, whenText, worstDark, addDays, MAX_RANGE_DAYS, SKYLINE_DEG } from "./query-model.js";
import { gridFootnote, heatmapHtml, legendHtml, pinButton, ringHtml, ringSummary, runListHtml, takeHtml, tilesHtml, verdictHtml } from "./components.js";
import { mountHelp, mountIcons, rowOpen, setSummary, wireRows } from "./planshell.js";
import { periodTitle, shortDate } from "./explorer-model.js";
import { createQuestion } from "./question.js";
import { spotName } from "./myspots.js";
import { addPin, isPinned, pinId, removePin } from "./pins.js";
import "./tray.js";
import { onThemeChange } from "./theme.js";
import { drawEventChart } from "./eventchart.js";
import { sunClearsText } from "./clearance.js";
import { earthLevel, longestRun, missionFacts, sunLevel } from "./events.js";
import { plannable } from "./picker.js";
import { isCustomId } from "../engine/index.js";
import { ensureCustom } from "./customs.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { sentenceText, normalizeReach, ringCount, worksText } from "./reach.js";
import { PLANNING } from "./defaults.js";
import { carryHash, darkBelowSuffix, dsnRuleOf, dsnSuffix, flatText, formatUtc, normalizeDarkBelow, normalizeDstation, parseState, pctText, serializeState, windowsToCsv, windowsToIcs } from "./format.js";

const STRIDE = (6 * 3600) / STEP_S; // landing times every 6 hours
const MIN_DATE = "2024-01-02";
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  goal: "earliest", spot: "Site01-1", mast: PLANNING.mast, start: PLANNING.date, days: 61,
  mission: PLANNING.mission, rule: PLANNING.rule, dark: PLANNING.dark, link: PLANNING.link, within: PLANNING.within, dbelow: PLANNING.dbelow, dstation: PLANNING.dstation,
  landing: "", // the selected landing time, like 2027-07-12T06; empty means the answer
};
const KEYS = { goal: "goal", spot: "spot", mast: "mast", start: "from", days: "to", mission: "len", rule: "night", dark: "night", link: "dsn", within: "within", dbelow: "night", dstation: "dsn" };

let ephemeris, catalog, pool, question, evaluateRange;
let state; // the question (and the chosen landing, when the visitor chose one); always question.state
let result = null; // { rows, rule, ev, grid } of the current question
let selected = -1; // index in result.rows of the landing shown
let picked = false; // the visitor chose the landing (a cell, a run, or the address); otherwise it is the answer
let runId = 0;
let missionRun = 0;
let takeRun = 0;
let missionView = null;
let before = null; // summary of the answer before the last change, for the pill
let changedKey = null;

// What the question may be. A saved or linked custom point is checked after it is traced (onQuestion).
function normalize(q) {
  const out = { ...q };
  if (!GOALS.some((g) => g.id === out.goal)) out.goal = DEFAULTS.goal;
  if (out.rule !== "custom" && !catalog.darknessPresets.some((p) => p.id === out.rule)) out.rule = DEFAULTS.rule;
  if (!catalog.mastsM.includes(out.mast)) out.mast = DEFAULTS.mast;
  out.start = out.start < MIN_DATE ? MIN_DATE : out.start;
  out.days = Math.round(Math.min(Math.max(out.days, 1), MAX_RANGE_DAYS));
  out.mission = Math.round(Math.min(Math.max(out.mission, 1), 120));
  out.link = Math.min(Math.max(out.link, 0), 100);
  out.within = normalizeReach(out.within);
  out.dbelow = normalizeDarkBelow(out.dbelow);
  out.dstation = normalizeDstation(out.dstation);
  out.dark = Math.min(Math.max(out.dark, 0), 2000);
  if (!isCustomId(out.spot) && !plannable(catalog, out.spot)) out.spot = DEFAULTS.spot;
  return out;
}

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
  } catch (error) {
    dataLoadError(error, "planner.html");
    return;
  }
  pool = createPool(new URL("data", location.href).href, { ephemeris, catalog });
  evaluateRange = createEvaluator({ ephemeris, catalog, pool });
  await ensureCustom(catalog, "data", parseState(location.hash, DEFAULTS).spot);
  question = createQuestion({
    els: { sentence: $("sentence"), trail: $("trail"), pop: $("pop") },
    ctx: { catalog, rankHref: () => $("rank-link").href },
    parse: (hash) => parseState(hash, DEFAULTS),
    serialize: (q) => serializeState(q),
    normalize,
    reset: { landing: "" },
    keyOf: (patch) => KEYS[Object.keys(patch).find((k) => k !== "start") ?? "start"] ?? "from",
    summary: () => (result ? summarize(result.rows, result.rule, state.goal) : null),
    segments: (q) => [
      "Identify ", { key: "goal", text: goalLabel(q.goal) }, " at ", { key: "spot", text: spotLabel(q) },
      " from ", { key: "from", text: dayLabel(q.start) }, " to ", { key: "to", text: dayLabel(endDay(q)) },
      " for a ", { key: "len", text: `${q.mission} d` }, " mission – max night ", { key: "night", text: `${maxDark(q)} h${darkBelowSuffix(q.dbelow)}` },
      ", min DSN ", { key: "dsn", text: `${q.link > 0 ? `≥ ${q.link}%` : "none"}${dsnSuffix(q.dstation)}` }, ", mast ", { key: "mast", text: `${q.mast} m` }, ", ", { key: "within", text: sentenceText(q.within) },
    ],
    run: (q, info) => onQuestion(info),
  });
  state = question.state;
  wireCopyLink($("copy-link"));
  wireRows("planner.html");
  mountIcons();
  mountHelp("How to use the Planner", [
    ["Set the question", "<p>Click the orange words in the sentence to change what you are asking: the spot or day, the dates, the mission length, the limits for darkness and DSN visibility, the mast height and the dispersion radius, how far the lander may miss.</p>"],
    ["Read the results", "<p>Each square in the grid is a landing time, every 6 hours. Click one to see that landing below, and press the pin icon to keep it for Compare landings. The suggestions under the grid each change one thing that would make a window valid at the dispersion radius.</p>"],
  ]);
  wireEvents();
  onThemeChange(() => drawMission());
  window.addEventListener("resize", () => drawMission());
  document.addEventListener("rowtoggle", () => drawMission()); // a chart drawn while its row was closed has no width
  question.start();
}

// The question changed or was loaded: make sure its spot can be used, then compute the answer.
async function onQuestion(info) {
  state = question.state;
  $("results").classList.add("stale");
  await ensureCustom(catalog, "data", state.spot);
  if (!plannable(catalog, state.spot)) question.set({ spot: DEFAULTS.spot });
  question.set({}); // the address now says exactly what the page shows
  state = question.state;
  before = info.before;
  changedKey = info.changed;
  picked = parseLanding(state.landing) !== null;
  selected = -1;
  await run();
}

const maxDark = (q = state) => (q.rule === "custom" ? q.dark : catalog.darknessPresets.find((p) => p.id === q.rule).hours);
const ruleOf = (q = state) => ({ maxDarkHours: maxDark(q), minLinkFraction: q.link / 100, within: q.within, dbelow: q.dbelow, dstation: q.dstation });
const spotLabel = (q = state) => spotName(q.spot);
const endDay = (q = state) => rangeEnd(q.start, q.days);

// ---- the answer

async function run() {
  const mine = ++runId;
  ++takeRun;
  chrome();
  const t = performance.now();
  try {
    const r = await evaluateRange(state, state.start, state.days, {
      progress: (n, count) => { $("status").textContent = `Computed ${n} of ${count} points…`; },
      isStale: () => mine !== runId,
    });
    if (!r) return;
    const rule = ruleOf();
    result = { rows: r.rows, rule, ev: answerOf(r.rows, rule, state.goal), grid: heatGrid(r.rows, rule, state.start, state.days) };
    const want = parseLanding(state.landing);
    let i = want === null ? -1 : landingIndex(r.rows, want);
    if (want !== null && i < 0) { picked = false; question.set({ landing: "" }); state = question.state; }
    selected = i >= 0 ? i : result.ev.index;
    $("status").textContent = `${gridFootnote(state.within, r.rows.length, r.count, ((performance.now() - t) / 1000).toFixed(1))}${r.clipped ? " The search stops where the ephemeris ends." : ""}`;
    renderAll();
    startTakes(mine);
  } catch (error) {
    $("status").textContent = `Something went wrong: ${error.message}`;
  } finally {
    if (mine === runId) $("results").classList.remove("stale");
  }
}

// The title, the address and the links that carry the question to other pages.
function chrome() {
  const label = spotLabel();
  document.title = `LunaZen Landing Site Navigator — Planner: ${label}`;
  const near = ringCount(state.within);
  $("subtitle").textContent = near ? `Evaluate candidate touchdown times at a target spot—plus ${near} surrounding dispersion points—against darkness survival and DSN visibility constraints.` : "Evaluate candidate touchdown times at a target spot against darkness survival and DSN visibility constraints.";
  $("ring-title").textContent = near ? `Dispersion analysis (${state.within} m radius)` : "Dispersion analysis (target spot only)";
  carryQuestion(state.start);
}

// The links in the top bar and the strip: the day of the chosen landing, or the start of the search when none is chosen.
function carryQuestion(start) {
  carryNav({ spot: state.spot, mast: state.mast, start, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within });
}

// "18%", or "3 of 245" when a whole-number share would read 0% for something that exists.
const shareText = (count, of) => { const pct = Math.round((count / of) * 100); return count && !pct ? `${count} of ${of}` : `${pct}%`; };

function renderAll() {
  $("heat").innerHTML = heatmapHtml(result.grid, result.rows, selected, undefined, state.within);
  $("legend").innerHTML = legendHtml(state.within);
  const k = countKinds(result.rows, result.rule);
  const n = result.rows.length || 1;
  $("heat-summary").textContent = `${shareText(k.robust + k.spot, n)} valid at spot${state.within ? ` · ${shareText(k.robust, n)} within ${state.within} m dispersion` : ""}`;
  renderRuns();
  renderTakePlaceholder();
  markSelection({ scroll: false });
}

// The pin that this landing would be: the whole question and the landing time.
function pinOf(row) {
  return { spot: state.spot, landing: landingValue(row.startEt), mast: state.mast, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within, goal: state.goal, start: state.start, days: state.days, kind: cellKind(row, result.rule) };
}

function renderVerdict() {
  const row = result.rows[selected];
  const model = verdictModel({ row, ev: result.ev, rule: result.rule, goal: state.goal, picked });
  const delta = !picked && changedKey && before ? deltaText(before, summarize(result.rows, result.rule, state.goal)) : "";
  const works = row && (model.state === "ok" || model.state === "info") && row.ok;
  const pinned = works && isPinned(pinOf(row));
  const actions = works ? pinButton(null, pinned, 'id="pin"') : "";
  $("verdict").innerHTML = verdictHtml(model, { delta, actions });
}

// What follows the selected landing: the cell, the verdict, the ring, the run, the mission and the links.
function markSelection({ scroll }) {
  const row = result.rows[selected];
  for (const b of $("heat").querySelectorAll("button.c")) {
    const on = Number(b.dataset.i) === selected;
    b.classList.toggle("sel", on);
    b.tabIndex = on ? 0 : -1;
    b.setAttribute("aria-pressed", String(on));
  }
  if (scroll) $("heat").querySelector("button.sel")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  renderVerdict();
  if (!row) {
    $("ring").innerHTML = "";
    $("tiles").innerHTML = "";
    $("mission-facts").textContent = "";
    setSummary("ring", "");
    setSummary("mission", "");
    missionView = null;
    return;
  }
  $("ring").innerHTML = ringHtml(row, catalog.ring(state.spot).map((p) => p.offsetM), state.within);
  setSummary("ring", ringSummary(row));
  const runs = result.ev.runs;
  const cur = runs.findIndex((r) => selected >= r.first && selected <= r.last);
  for (const tr of $("runs").querySelectorAll("tbody tr")) tr.classList.toggle("sel", Number(tr.dataset.run) === cur);
  const day = formatUtc(row.startEt).slice(0, 10), time = formatUtc(row.startEt).slice(11, 16);
  carryQuestion(picked ? day : state.start);
  const hand = { spot: state.spot, mast: state.mast, start: day, mission: state.mission, rule: state.rule, dark: state.dark, dbelow: state.dbelow, dstation: state.dstation, link: state.link, within: state.within };
  $("rank-link").href = `rank.html${carryHash("rank.html", hand)}&time=${time}`;
  $("rank-link").textContent = `Compare spots on ${dayLabel(day)}`;
  $("slip-link").href = `windows.html${carryHash("windows.html", hand)}`;
  $("explorer-link").href = `explorer.html#spot=${state.spot}&mast=${state.mast}&start=${day}&days=${state.mission}&t=${Number(time.slice(0, 2)) * 4}`;
  renderMission(row);
}

// Choose a landing time: from a cell, a run or the keyboard. The address then carries it.
function select(i, { scroll = false } = {}) {
  if (i < 0 || i >= result.rows.length) return;
  selected = i;
  picked = true;
  question.set({ landing: landingValue(result.rows[i].startEt) });
  state = question.state;
  markSelection({ scroll });
}

function renderRuns() {
  const runs = result.ev.runs;
  $("runs-panel").hidden = !runs.length;
  if (!runs.length) return;
  $("runs-sub").textContent = `${runs.length} valid window${runs.length === 1 ? "" : "s"}, earliest ${shortDate(formatUtc(Math.min(...runs.map((r) => r.startEt))))}`;
  $("runs").innerHTML = runListHtml(runs, result.rows, result.rule, -1);
}

// ---- the mission of the selected landing

async function renderMission(row) {
  const mine = ++missionRun;
  $("mission-facts").textContent = "Computing the mission…";
  const day = formatUtc(row.startEt).slice(0, 10), time = formatUtc(row.startEt).slice(11, 16);
  $("mission-title").textContent = `${periodTitle(day, addDays(day, state.mission - 1), spotLabel())} · landing ${shortDate(day)}, ${time} UTC`;
  const et1 = Math.min(row.startEt + state.mission * 86400 - STEP_S, ephemeris.etMax - STEP_S);
  let series;
  try {
    ({ series } = await pool.run({ kind: "column", id: state.spot, mast: state.mast, et0: row.startEt, et1, darkBelow: state.dbelow / 100, dsnRule: dsnRuleOf(state.dstation) }));
  } catch {
    if (mine === missionRun) $("mission-facts").textContent = "The mission view could not be computed.";
    return;
  }
  if (mine !== missionRun) return;
  const link = Array.from(series.earthFraction, (f, i) => (f > 0 && series.dsnInView[i] === 1 ? 1 : 0));
  missionView = { series, link };
  drawMission();
  const facts = { ...missionFacts(series, link, STEP_S, state.dbelow / 100), sunClears: sunClearsText(series, catalog.spot(state.spot, state.mast).horizon) };
  $("tiles").innerHTML = tilesHtml(facts, result.rule);
  const night = facts.longestNightH > result.rule.maxDarkHours ? " The longest night is outlined in the chart." : "";
  const capture = facts.capture
    ? ` A vertical Sun-tracking array captures ${pctText(facts.capture.upright)} of incident sunlight, whereas a horizontal panel captures ${flatText(facts.capture.flat)}${facts.capture.flat < 0.0005 ? " at this low Sun elevation" : ""}.` : "";
  $("mission-facts").textContent = `Solar illumination ${Math.round(facts.sunShare * 100)}% · DSN visibility ${Math.round(facts.linkShare * 100)}%.${night}${capture}`;
  setSummary("mission", `Sunlit ${Math.round(facts.sunShare * 100)}% · DSN ${Math.round(facts.linkShare * 100)}% · Max night ${facts.longestNightH < 0.5 ? "none" : spanText(facts.longestNightH)}`);
}

function drawMission() {
  if (!missionView || !$("mission-chart")) return;
  const { series, link } = missionView;
  const levels = { sun: Array.from(series.sunFraction, sunLevel), earth: Array.from(series.earthFraction, earthLevel), dsn: link };
  const perDay = 86400 / STEP_S;
  const dayStarts = [];
  for (let k = 0; k * perDay < series.et.length; k++) dayStarts.push({ index: k * perDay, label: k === 0 ? "Landing" : `Day ${k}` });
  const night = longestRun(levels.sun, 0);
  const nightH = night ? ((night[1] - night[0]) * STEP_S) / 3600 : 0;
  const nightText = night ? `Longest night ${spanText(nightH)}` : "";
  drawEventChart($("mission-chart"), { et: series.et, levels, current: null, dayStarts, night, nightText, nightOver: nightH > result.rule.maxDarkHours });
}

// ---- constraint relaxation (spec §4.4): each suggestion is confirmed by a real run of the engine

const dispersion = () => (state.within ? `${state.within} m dispersion` : "the target spot");

function renderTakePlaceholder() {
  const ev = result.ev;
  $("take").hidden = ev.kind === "ok";
  if (ev.kind === "ok") return;
  $("take-sub").textContent = "Checking other spots, masts and dates…";
  $("take-list").innerHTML = "";
  $("take-progress").hidden = true;
}

async function startTakes(mine) {
  const ev = result.ev;
  if (ev.kind === "ok") return;
  const mineRun = takeRun;
  const stale = () => mine !== runId || mineRun !== takeRun;
  const items = [];
  let progress = "Still checking…";
  const show = (final) => {
    if (stale()) return;
    const list = items.length ? items : final ? [{ title: "No single change unlocks a valid window", sub: `No other spot, taller mast or later date in the next six months gives a valid landing at ${dispersion()} with these limits.` }] : [];
    $("take-list").innerHTML = takeHtml(list);
    $("take-sub").textContent = items.length ? `${items.length} single-parameter adjustment${items.length === 1 ? "" : "s"} to unlock a valid window` : final ? "No single-parameter adjustment unlocks a valid window" : "Checking other spots, masts and dates…";
    $("take-progress").hidden = final;
    $("take-progress").textContent = progress;
    for (const b of $("take-list").querySelectorAll("[data-take]")) b.onclick = () => { const it = items.find((x) => x.key === b.dataset.take); if (it) question.change(it.patch, it.label); };
  };
  const rule = result.rule;
  const row = result.rows[ev.index];
  const near = ringCount(state.within);
  // A fact, not a button: relaxing a survival limit is the thermal team's decision.
  if (row) {
    if (row.centre.longestDarkHours > rule.maxDarkHours || worstDark(row) > rule.maxDarkHours) {
      items.push({ title: `Increase night tolerance to ${neededNightHours(row)} h`, sub: `Required to satisfy ${near ? `all ${near} dispersion points` : "the target spot"} for the ${whenText(row.startEt)} window (verify against spacecraft thermal and battery margins).` });
    } else if (!row.ok || row.centre.linkFraction < rule.minLinkFraction) {
      items.push({ title: `DSN visibility of ${Math.round(row.centre.linkFraction * 100)}%`, sub: `The closest landing (${whenText(row.startEt)}) has this much against ${Math.round(rule.minLinkFraction * 100)}% required.` });
    }
  }
  show(false);
  try {
    // A taller mast: the lowest taller one that gives a valid window in this range.
    for (const m of catalog.mastsM.filter((v) => v > state.mast)) {
      const r = await evaluateRange({ ...state, mast: m }, state.start, state.days, { isStale: stale });
      if (!r) return;
      const runs = robustRuns(r.rows, rule);
      if (runs.length) { items.push({ key: `mast${m}`, title: `A ${m} m mast`, sub: `${runs.length} valid window${runs.length === 1 ? "" : "s"} at ${dispersion()}, the first on ${dayLabel(formatUtc(runs[0].startEt).slice(0, 10))}.`, patch: { mast: m }, label: "Mast" }); show(false); break; }
    }
    // A smaller dispersion radius: the same question tested at the spot and the six points at 50 m only (offered from the 100 m default).
    if (state.within === 100) {
      const r = await evaluateRange({ ...state, within: 50 }, state.start, state.days, { isStale: stale });
      if (!r) return;
      const runs = robustRuns(r.rows, rule);
      if (runs.length) {
        const landings = r.rows.filter((x) => cellKind(x, rule) === "robust").length;
        items.push({ key: "reach", title: "Tighten dispersion radius to 50 m", sub: `Unlocks ${landings} valid touchdown epoch${landings === 1 ? "" : "s"} in ${runs.length === 1 ? "a single contiguous window" : `${runs.length} windows`}, beginning ${dayLabel(formatUtc(runs[0].startEt).slice(0, 10))}.`, patch: { within: 50 }, label: "Dispersion radius" });
        show(false);
      }
    }
    // Later dates: the six months after this range, one run.
    const from = addDays(endDay(), 1);
    const r = await evaluateRange(state, from, 180, { isStale: stale });
    if (!r) return;
    const runs = robustRuns(r.rows, rule);
    if (runs.length) {
      const day = formatUtc(runs[0].startEt).slice(0, 10);
      items.push({ key: "later", title: "Later dates", sub: `The first valid landing at ${dispersion()} is ${whenText(runs[0].startEt)}.`, patch: setRange(day, rangeEnd(day, state.days)), label: "Dates" });
      show(false);
    }
    // Another spot: the same question at every other spot, a valid day anywhere in the range.
    const spots = [...catalog.spots.keys()].filter((id) => id !== state.spot);
    const found = [];
    const width = Math.max(1, pool.size || 1);
    const et0 = parseUtc(`${state.start}T00:00:00`);
    for (let k = 0; k < spots.length; k += width) {
      if (stale()) return;
      const batch = await Promise.all(spots.slice(k, k + width).map(async (id) => {
        const w = await pool.run({ kind: "windows", spot: id, mast: state.mast, et0, days: state.days, within: state.within, darkBelow: state.dbelow / 100, dsnRule: dsnRuleOf(state.dstation), rule: { missionDays: state.mission, strideHours: 6, maxDarkHours: rule.maxDarkHours, minLink: rule.minLinkFraction, mastM: state.mast } });
        const full = (1 + Math.min(ringCount(state.within), catalog.spotRecord(id).ring.length) + 1).toString(16);
        const codes = [...w.codes];
        return { id, robustDays: codes.filter((c) => c === full).length, first: codes.indexOf(full) };
      }));
      found.push(...batch.filter((b) => b.robustDays > 0));
      progress = `Checking other spots… (${Math.min(k + width, spots.length)} of ${spots.length})`;
      show(false);
    }
    if (stale()) return;
    found.sort((a, b) => b.robustDays - a.robustDays || a.first - b.first);
    if (found[0]) {
      const b = found[0];
      items.unshift({ key: "spot", title: `Alternate target: ${b.id}`, sub: `Unlocks ${b.robustDays} valid landing day${b.robustDays === 1 ? "" : "s"} within the search range at ${dispersion()}, starting ${dayLabel(addDays(state.start, b.first))}.`, patch: { spot: b.id }, label: b.id });
    }
  } catch { /* a suggestion that cannot be checked is left out */ }
  show(true);
}

// ---- events

function wireEvents() {
  $("heat").addEventListener("click", (e) => { const b = e.target.closest("button.c"); if (b) select(Number(b.dataset.i)); });
  $("heat").addEventListener("keydown", heatKey);
  $("verdict").addEventListener("click", (e) => {
    if (!e.target.closest("#pin") || !result) return;
    const row = result.rows[selected];
    if (!row) return;
    const pin = pinOf(row);
    if (isPinned(pin)) removePin(pinId(pin));
    else { const r = addPin(pin); if (!r.ok && r.reason === "full") $("status").textContent = "You can pin 4 landings. Remove one from the tray first."; }
    renderVerdict();
  });
  window.addEventListener("pinschange", () => { if (result) renderVerdict(); });
  const openRun = (tr) => {
    const r = result.ev.runs[Number(tr?.dataset.run)];
    if (r) select(state.goal === "margin" ? r.bestRow : r.first, { scroll: true });
  };
  $("runs").addEventListener("click", (e) => openRun(e.target.closest("tr[data-run]")));
  $("runs").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRun(e.target.closest("tr[data-run]")); } });
  $("csv").addEventListener("click", () => result && download(windowsToCsv(exportRows(), state.spot), `${state.spot}-landing-runs.csv`, "text/csv"));
  $("ics").addEventListener("click", () => result && download(
    windowsToIcs(exportRows(), state.spot, parseUtc(new Date().toISOString().slice(0, 19)), () => `valid landing times (${state.mission}-day mission)`),
    `${state.spot}-landing-runs.ics`, "text/calendar"));
}

// Arrow keys move through the landing times: left and right a day, up and down a time of day (00, 06, 12, 18 UTC).
function heatKey(e) {
  const cur = e.target.closest("button.c");
  if (!cur || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const i = Number(cur.dataset.i);
  let to = -1;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") to = i + (e.key === "ArrowDown" ? 1 : -1) * 1;
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") to = i + (e.key === "ArrowRight" ? 4 : -4);
  else { const ok = result.rows.map((r, k) => k).filter((k) => cellKind(result.rows[k], result.rule) === "robust"); to = e.key === "Home" ? (ok[0] ?? 0) : (ok.at(-1) ?? result.rows.length - 1); }
  if (to < 0 || to >= result.rows.length) return;
  select(to, { scroll: true });
  $("heat").querySelector(`button[data-i="${to}"]`)?.focus();
}

function exportRows() {
  return result.ev.runs.map((r) => ({ body: "Landing", startEt: r.startEt, endEt: r.endEt }));
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

main();

// Compare: two to four sites over the same window. Add or remove sites as chips, pick what matters
// most, and read a verdict, a grouped table with the best value marked, and synchronised
// Sun / DSN-contact swimlanes. Results follow the controls; finished sites are cached.

import { Ephemeris, SiteCatalog, parseUtc, STEP_S } from "../engine/index.js";
import { createPool } from "./pool.js";
import { METRICS, PRIORITIES, bestColumns, comparisonCsv, formatMetric, rankColumns, survivedBy } from "./compare-rows.js";
import { compareVerdict } from "./story.js";
import { verdictHtml, esc } from "./components.js";
import { createTokens } from "./query.js";
import { mountHelp, mountIcons, setSummary, wireRows } from "./planshell.js";
import { dayLabel } from "./plan.js";
import { pctText as _p } from "./format.js";
import "./tray.js";
import { onThemeChange } from "./theme.js";
import { plannable } from "./picker.js";
import { mineName } from "./myspots.js";
import { ensureCustom } from "./customs.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { PLANNING } from "./defaults.js";
import { artemisLabel, clampDate, formatUtc, parseState, serializeState } from "./format.js";
import { drawLanes } from "./swimlanes.js";
import { sunHighest } from "./events.js";

const MIN_DATE = "2024-01-02";
const MAX_DATE = "2043-01-01";
const MAX_SITES = 4;
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  sites: "Site01-1,Site04-1,Site23-2,DM2-4", mast: 2,
  start: PLANNING.date, days: 365, by: PRIORITIES[0].id,
};

let ephemeris;
let catalog;
let state;
let ids = []; // the chosen sites, in the order they were added
let columns = []; // computed columns for `ids`
let shown = []; // the columns in display order (ranked by the priority)
let ticks = [];
let tokens;
let editing = 0; // the index in ids of the spot the open picker changes (ids.length: a new one)
let pool;
let showAll = false;
let locate = () => null;
let runId = 0;
let timer = null;
const cache = new Map(); // "id|mast|start|days" -> column

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
  } catch (error) {
    dataLoadError(error, "sidebyside.html");
    return;
  }
  pool = createPool(new URL("data", location.href).href, { ephemeris, catalog });
  state = parseState(location.hash, DEFAULTS);
  await loadCustoms(state.sites);
  buildPriority();
  applyState();
  tokens = createTokens({
    sentenceEl: $("sentence"), popEl: $("pop"), getState: () => ({ ...state, spot: ids[editing] ?? ids[0] ?? "" }),
    ctx: { catalog, rankHref: () => "rank.html", pickerOptions: { includeMissions: true }, spotHeading: "Spot", dayPresets: [30, 90, 180, 365], maxDays: 730, apply },
  });
  $("sentence").addEventListener("click", (event) => {
    const gone = event.target.closest("[data-remove]");
    if (gone && ids.length > 2) { ids = ids.filter((x) => x !== gone.dataset.remove); renderSentence(); schedule(0); }
  });
  $("sentence").addEventListener("click", (event) => { const b = event.target.closest('[data-tok="spot"]'); if (b) editing = b.dataset.i === "new" ? ids.length : Number(b.dataset.i); }, true);
  $("more").addEventListener("click", () => {
    showAll = !showAll;
    $("more").setAttribute("aria-pressed", String(showAll));
    $("more").textContent = showAll ? "Fewer metrics" : "All metrics";
    if (columns.length) renderTable();
  });
  $("csv").addEventListener("click", () => columns.length && download(comparisonCsv(shown), "comparison.csv", "text/csv"));
  wireCopyLink($("copy-link"));
  wireRows("sidebyside.html");
  mountIcons();
  mountHelp("How to use Compare sites", [
    ["Choose the sites and dates", "<p>Click a spot in the sentence to change it, × to remove it, or + Add spot (up to four). Set the window length, start date and mast height the same way.</p>"],
    ["Read the table", `<ul><li>Best value per row in green; Optimise for changes the summary above the table.</li><li>Night survival: the longest night against 5 h (Blue Ghost 1) and 50 h (VIPER's design figure).</li><li>100 m dispersion range: lowest to highest illumination among the target spot and its 12 dispersion points.</li><li>DSN visibility: line of sight only, Earth above the skyline and a DSN complex seeing the Moon above 10°. No link budget or antenna scheduling.</li><li>Click the annual timeline to open that day in the Explorer.</li></ul>`],
    ["About these sites", '<div class="table-wrap"><table id="info" class="compare"></table></div>'],
  ]);
  wireLanes();
  window.addEventListener("resize", () => columns.length && drawChart());
  onThemeChange(() => columns.length && drawChart());
  document.addEventListener("rowtoggle", () => columns.length && drawChart());
  window.addEventListener("hashchange", async () => {
    if (location.hash === serializeState(stateNow())) return;
    state = parseState(location.hash, DEFAULTS);
    await loadCustoms(state.sites);
    applyState();
    schedule(0);
  });
  run();
}

// Trace the custom points named in a link, one after the other.
async function loadCustoms(list) {
  for (const id of list.split(",")) if (id.startsWith("pt_")) await ensureCustom(catalog, "data", id);
}

// Put the URL state into the sentence. A link that names fewer than two sites (for example from the
// nav of another page) is topped up from the default sites, so there is always something to compare.
function applyState() {
  const known = (id) => plannable(catalog, id) || catalog.missions.has(id);
  ids = [...new Set(state.sites.split(",").filter(known))].slice(0, MAX_SITES);
  for (const id of DEFAULTS.sites.split(",")) if (ids.length < 2 && !ids.includes(id)) ids.push(id);
  state.mast = catalog.mastsM.includes(state.mast) ? state.mast : DEFAULTS.mast;
  state.start = clampDate(state.start, MIN_DATE, MAX_DATE);
  state.days = Math.min(Math.max(Math.round(state.days) || DEFAULTS.days, 1), 730);
  if (!PRIORITIES.some((p) => p.id === state.by)) state.by = DEFAULTS.by;
  renderSentence();
  renderPriority();
}

function stateNow() {
  return { ...state, sites: ids.join(",") };
}

function readControls() {
  state = { ...state, sites: ids.join(",") };
  history.replaceState(null, "", serializeState(state));
  if (ids[0]) carryNav({ spot: ids[0], mast: state.mast, start: state.start });
}

const labelOf = (id) => catalog.missions.get(id)?.name ?? mineName(id) ?? (catalog.customs.get(id)?.group === "beyond" ? catalog.customs.get(id).name : catalog.customs.has(id) ? `Custom ${Math.abs(catalog.customs.get(id).latitudeDeg).toFixed(3)}°S ${catalog.customs.get(id).longitudeDeg.toFixed(2)}°E` : id);

// "Compare [Site01-1 ×] [Site04-1 ×] [+ Add spot] – [365 d] starting [15 Mar 2027], mast [2 m]": every control is a token.
function renderSentence() {
  const tok = (key, text, extra = "") => `<button type="button" class="lz-tok" data-tok="${key}" ${extra} aria-haspopup="dialog" aria-expanded="false">${esc(text)}<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3 L5 7 L8.5 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button>`;
  const chips = ids.map((id, i) => `<span class="spot-chip">${tok("spot", labelOf(id), `data-i="${i}"`)}<button type="button" class="chip-x" data-remove="${esc(id)}" aria-label="Remove ${esc(labelOf(id))}" title="Remove ${esc(labelOf(id))}"${ids.length <= 2 ? " disabled" : ""}>×</button></span>`).join(" ");
  const add = ids.length < MAX_SITES ? ` <button type="button" class="lz-tok add-spot" data-tok="spot" data-i="new" aria-haspopup="dialog" aria-expanded="false">+ Add spot</button>` : "";
  $("sentence").innerHTML = `Compare ${chips}${add} – ${tok("days", `${state.days} d`)} starting ${tok("date", dayLabel(state.start))}, mast ${tok("mast", `${state.mast} m`)}`;
}

// A token's editor applied a change (a spot, the length, the start date or the mast).
function apply(patch) {
  if (patch.spot) {
    if (editing >= ids.length) { if (ids.includes(patch.spot) || ids.length >= MAX_SITES) return; ids.push(patch.spot); }
    else if (!ids.includes(patch.spot)) ids[editing] = patch.spot;
  }
  for (const k of ["days", "start", "mast"]) if (patch[k] !== undefined) state[k] = patch[k];
  state.start = clampDate(state.start, MIN_DATE, MAX_DATE);
  renderSentence();
  schedule(0);
}

function buildPriority() {
  $("priority").innerHTML = PRIORITIES.map((p) => `<button type="button" data-by="${p.id}" aria-pressed="false">${p.label}</button>`).join("");
  $("priority").onclick = (event) => {
    const by = event.target.closest("button[data-by]")?.dataset.by;
    if (!by) return;
    state.by = by;
    renderPriority();
    history.replaceState(null, "", serializeState(stateNow()));
    if (columns.length) renderResults();
  };
}

function renderPriority() {
  for (const b of $("priority").children) b.setAttribute("aria-pressed", String(b.dataset.by === state.by));
}

// Results follow the controls: wait a moment after the last change, then recompute.
function schedule(delay = 350) {
  clearTimeout(timer);
  $("results").classList.add("stale");
  timer = setTimeout(run, delay);
}

async function run() {
  readControls();
  if (ids.length < 2) {
    columns = [];
    $("results").hidden = true;
    $("status").textContent = "Add at least two sites to compare.";
    return;
  }
  $("results").hidden = false;
  $("metrics-title").textContent = `Site metrics · ${state.days} d`;
  const mine = ++runId;
  $("results").classList.add("stale");
  try {
    await compute(mine);
  } catch (error) {
    $("status").textContent = `Something went wrong: ${error.message}`;
  } finally {
    if (mine === runId) $("results").classList.remove("stale");
  }
}

async function compute(mine) {
  const et0 = parseUtc(`${state.start}T00:00:00`);
  const et1 = Math.min(et0 + state.days * 86400, ephemeris.etMax - STEP_S);
  const clipped = et0 + state.days * 86400 > et1;
  if (cache.size > 12) cache.clear();
  const keyOf = (id) => `${id}|${catalog.missions.has(id) ? "" : state.mast}|${state.start}|${state.days}`;
  const missing = ids.filter((id) => !cache.has(keyOf(id)));
  let done = 0;
  if (missing.length) $("status").textContent = `Computing ${missing.length} site${missing.length > 1 ? "s" : ""}…`;
  await Promise.all(missing.map(async (id) => {
    const column = await computeColumn(id, et0, et1);
    cache.set(keyOf(id), column);
    if (mine === runId) {
      $("status").textContent = `Computed ${++done} of ${missing.length} sites…`;
      renderPartial(keyOf); // each site's column appears as soon as it is ready
    }
  }));
  if (mine !== runId) return; // the controls changed again: a newer run owns the page
  const fresh = ids.map((id) => cache.get(keyOf(id)));
  columns = fresh;
  ticks = makeTicks(columns[0].series);
  $("status").textContent = clipped ? "The window stops where the ephemeris ends." : "";
  renderResults();
}

function makeTicks(series) {
  const out = [];
  series.et.forEach((et, i) => {
    const text = formatUtc(et);
    if (state.days > 62 ? text.slice(8) === "01 00:00" : text.endsWith("00:00")) {
      const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(text.slice(5, 7)) - 1];
      out.push({ index: i, label: state.days > 62 ? (month === "Jan" ? `Jan ${text.slice(0, 4)}` : month) : text.slice(5, 10) });
    }
  });
  return out;
}

// While some sites are still computing: the finished ones in their columns, the others as "Computing…" columns, and the chart of the finished ones.
function pendingColumn(id) {
  const mission = catalog.missions.get(id);
  const { record } = mission ? catalog.mission(id) : catalog.spot(id, state.mast);
  return { id, name: mission ? mission.name : id, mission, record, mast: mission ? record.mastM : state.mast, pending: true };
}
function renderPartial(keyOf) {
  const done = ids.map((id) => cache.get(keyOf(id))).filter(Boolean);
  if (!done.length) return;
  ticks = makeTicks(done[0].series);
  shown = [...rankColumns(done, state.by), ...ids.filter((id) => !cache.has(keyOf(id))).map(pendingColumn)];
  $("verdict").innerHTML = '<p class="pl-note">Computing the other sites…</p>';
  renderTable();
  drawChart();
}
const ready = () => shown.filter((c) => !c.pending);

async function computeColumn(id, et0, et1) {
  const mission = catalog.missions.get(id);
  const { record } = mission ? catalog.mission(id) : catalog.spot(id, state.mast);
  const { series, metrics, raised, ringSunMin, ringSunMax } = await pool.run({ kind: "column", id, mast: state.mast, et0, et1 });
  metrics.survivedBy = survivedBy(metrics.longestDarkHours, catalog.darknessPresets);
  metrics.raisedDarkHours = raised.longestDarkHours;
  metrics.raisedSunlit = raised.sunlitFraction;
  metrics.ringSunMin = ringSunMin;
  metrics.ringSunMax = ringSunMax;
  metrics.sunMaxElevationDeg = sunHighest(series); // the highest the Sun gets in the window, above a level horizon
  return { id, name: mission ? mission.name : id, mission, record, mast: mission ? record.mastM : state.mast, series, metrics };
}

function renderResults() {
  shown = rankColumns(columns, state.by);
  $("verdict").innerHTML = verdictHtml(compareVerdict(columns, state.by, catalog.darknessPresets));
  $("planner-link").href = `planner.html#spot=${shown[0].id}&mast=${state.mast}&start=${state.start}`;
  $("planner-link").textContent = `Open ${shown[0].name} in Planner`;
  $("pinned-link").href = "compare.html";
  renderTable();
  drawChart();
}

function drawChart() {
  locate = drawLanes($("lanes"), ready().map(({ name, series }) => ({
    label: name,
    sun: series.sunFraction,
    link: Array.from(series.earthFraction, (f, i) => (f > 0 && series.dsnInView[i] === 1 ? 1 : 0)),
  })), ticks);
}

function renderTable() {
  const waiting = shown.some((c) => c.pending);
  const best = waiting ? Object.fromEntries(METRICS.map((m) => [m.key, new Set()])) : bestColumns(shown); // "best" waits until every site is in
  const head = `<tr><th scope="col">Metric</th>${shown.map(({ id, mission, record, mast }) => {
    const title = mission ? `<b>${esc(mission.name)}</b>` : `<b>${esc(id)}</b> ${esc(record.siteName)}`;
    const where = `${Math.abs(record.latitudeDeg).toFixed(3)}°${record.latitudeDeg < 0 ? "S" : "N"}, ${record.longitudeDeg.toFixed(2)}° E`;
    const explore = `explorer.html#spot=${id}&mast=${mast}&start=${state.start}&days=${Math.min(state.days, 60)}`;
    const plan = mission ? "" : ` · <a href="planner.html#spot=${id}&mast=${state.mast}&start=${state.start}">Plan</a>`;
    return `<th scope="col" class="site-head"><span class="site-title">${title}</span><small>${where} · <a href="${explore}">Explore</a>${plan}</small></th>`;
  }).join("")}</tr>`;
  const presets = catalog.darknessPresets.map((p) => `${p.hours} h`).join(" / ");
  const rows = [];
  for (const m of METRICS) {
    if (!showAll && !m.core) continue;
    const text = m.key === "survivedBy" ? `Night survival (${presets})` : m.label;
    const label = m.hint ? `${text} <button type="button" class="hint" data-hint="${esc(m.hint)}">ⓘ</button>` : text;
    rows.push(`<tr><th scope="row">${label}</th>${shown.map((c, i) => {
      if (c.pending) return '<td class="pending">Computing…</td>';
      const value = m.key === "ringSunMin" ? (c.metrics.ringSunMin === null ? "—" : `${formatMetric(m, c.metrics.ringSunMin).replace("%", "")}–${formatMetric(m, c.metrics.ringSunMax)}`) : formatMetric(m, c.metrics[m.key]);
      const isBest = best[m.key].has(i);
      return `<td class="${isBest ? "best" : ""}">${value}${isBest ? '<span class="tag-best">best</span>' : ""}</td>`;
    }).join("")}</tr>`);
  }
  $("table").innerHTML = `<thead>${head}</thead><tbody>${rows.join("")}</tbody>`;
  $("table-foot").textContent = `Green indicates optimal value per row · ${state.days}-day window from ${dayLabel(state.start)} · ${state.mast} m mast height.`;
  const end = new Date(Date.parse(`${state.start}T00:00:00Z`) + (state.days - 1) * 86400000).toISOString().slice(0, 10);
  setSummary("timeline", `Sun up and DSN in view by spot, ${dayLabel(state.start)} – ${dayLabel(end)}`);

  const info = [
    ["Slope", (c) => (c.mission || c.record.slopeDeg == null ? "—" : `${c.record.slopeDeg.toFixed(1)}°`)],
    ["NASA 18.6-year average Sun / Earth", (c) => (c.mission || c.record.nasaAvgSun == null ? "—" : `${(c.record.nasaAvgSun * 100).toFixed(0)}% / ${(c.record.nasaAvgEarth * 100).toFixed(0)}%`),
      "NASA's average over a full 18.6-year lunar cycle: a different time basis from your dates"],
    ["Ground height", (c) => `${c.record.groundM.toFixed(0)} m`],
    ["NASA Artemis candidate region", (c) => artemisLabel(c.record.artemisRegions ?? [], catalog.artemisRegions) || "—"],
  ].map(([label, f, hint]) => `<tr><th scope="row">${hint ? `<abbr title="${hint}">${label}</abbr>` : label}</th>${shown.map((c) => `<td>${f(c)}</td>`).join("")}</tr>`);
  $("info").innerHTML = `<thead><tr><th></th>${shown.map((c) => `<th scope="col">${c.name}</th>`).join("")}</tr></thead><tbody>${info.join("")}</tbody>`;
}

// Hover a swimlane for the values at that hour; click to open that day in the Explorer.
function wireLanes() {
  const canvas = $("lanes");
  const tip = $("lane-tip");
  canvas.addEventListener("mousemove", (event) => {
    const hit = ready().length ? locate(event.clientX, event.clientY) : null;
    if (!hit) { tip.hidden = true; return; }
    const c = ready()[hit.lane];
    const s = c.series;
    const link = s.earthFraction[hit.index] > 0 && s.dsnInView[hit.index] === 1;
    tip.textContent = `${c.name} · ${formatUtc(s.et[hit.index])} UTC · Sun ${(s.sunFraction[hit.index] * 100).toFixed(0)}% · DSN in view ${link ? "yes" : "no"}`;
    tip.hidden = false;
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    tip.style.left = `${Math.max(0, Math.min(x + 12, box.width - tip.offsetWidth))}px`;
    tip.style.top = `${event.clientY - box.top + 14}px`;
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; });
  canvas.addEventListener("click", (event) => {
    const hit = ready().length ? locate(event.clientX, event.clientY) : null;
    if (!hit) return;
    const c = ready()[hit.lane];
    location.href = `explorer.html#spot=${c.id}&mast=${c.mast}&start=${formatUtc(c.series.et[hit.index]).slice(0, 10)}&days=7`;
  });
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

main();

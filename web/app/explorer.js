// Explorer: pick a site, mast height and window; see the Sun and Earth against the real
// horizon over time, and the sunlight / Earth-contact windows.

import { bodyState, DSN_MASK_DEG, Ephemeris, fragility, isDark, moonElevations, parseUtc, stationInView, SiteCatalog, summarize, timeSeries, timeToChange, windows, STEP_S } from "../engine/index.js";
import { onThemeChange } from "./theme.js";
import { createQuestion } from "./question.js";
import { loadMine, mineLatLon, mineName, spotName } from "./myspots.js";
import { latLonToPolar } from "./maputil.js";
import { hydrateLinks } from "./links.js";
import { dayLabel } from "./plan.js";
import { ensureCustom } from "./customs.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { rangeEnd } from "./query-model.js";
import { mountIcons } from "./planshell.js";
import { bodyCard, clearanceNotes, dsnTag, figureGroups, momentHeading, periodTitle, shortDate, shortDateTime } from "./explorer-model.js";
import { TerrainView, parsePatch } from "./terrain3d.js";
import { artemisLabel, carryHash, clampDate, darkBelowSuffix, degText, dsnSuffix, normalizeDarkBelow, normalizeDstation, signedDeg, formatDuration, formatUtc, mapHash, panoramaRange, parseState, serializeState, windowsToCsv, windowsToIcs } from "./format.js";
import { drawPanorama, windowRange } from "./panorama.js";
import { drawEventChart } from "./eventchart.js";
import { clearanceSeries, clearanceStats, drawClearance, fragilityRows } from "./clearance.js";
import { earthLevel, lightCapture, longestRun, sunHighest, sunLevel } from "./events.js";
import { plannable } from "./picker.js";
import { describeBody, nextChange } from "./moment.js";

const MIN_DATE = "2024-01-02";
const MAX_DATE = "2043-12-01";
const $ = (id) => document.getElementById(id);

const today = new Date().toISOString().slice(0, 10);
const DEFAULTS = { spot: "Site01-1", mast: 2, start: clampDate(today, MIN_DATE, MAX_DATE), days: 30, t: 0, view: "panorama", dbelow: 0, dstation: 0 };

// What the question may be: a known spot, a mast the spot has (a mission or a site away from the pole uses the default), a date and days in range.
function normalize(q) {
  const out = { ...q };
  out.start = clampDate(out.start, MIN_DATE, MAX_DATE);
  out.days = Math.min(Math.max(Math.round(Number(out.days)) || 30, 1), 365);
  const fixed = catalog.missions.has(out.spot) || catalog.customs.get(out.spot)?.group === "beyond";
  if (fixed || !catalog.mastsM.includes(out.mast)) out.mast = catalog.defaultMastM;
  out.t = Number(out.t) || 0;
  out.view = out.view === "3d" || out.view === "period" ? out.view : "panorama";
  out.dbelow = normalizeDarkBelow(out.dbelow);
  out.dstation = normalizeDstation(out.dstation);
  return out;
}

// The question changed (or was loaded): a mission starts on its landing day, then everything is computed again.
async function onQuestion(info) {
  state = question.state;
  if (!(await ensureCustom(catalog, "data", state.spot))) { question.set({ spot: DEFAULTS.spot }); state = question.state; }
  question.render(); // the sentence names the site of a saved point once it is known
  const mission = catalog.missions.get(state.spot);
  if (info.changed) { // a token changed: start again from the first sunlit moment
    state.t = 0;
    autoT = true;
    if (state.spot !== lastSpot && mission) { state.start = mission.landedUtc.slice(0, 10); state.days = 20; }
    question.render();
  } else autoT = !hasMoment();
  lastSpot = state.spot;
  state.mast = normalize(state).mast;
  syncControls();
  if (state.dstation) await ensureRotation();
  recompute();
  setView(state.view);
}

let ephemeris;
let catalog;
let state;
let model; // everything computed for the current site and window
let snapHit = () => 0; // click x -> sample, for the snapshot chart
let chartHit = () => 0;
let clearanceHit = () => 0;
// Panorama window: the whole sky (stretched), or `span` degrees at true scale around the Sun,
// the Earth or a dragged-to direction.
const pano = { mode: "whole", span: 120, center: 180 };
let panoCenter = 180;
let playing = null;
let question;
let lastSpot = "";
let autoT = true; // no moment in the link: start at the first moment the Sun is up
let loadingPatch = false;
const hasMoment = () => new URLSearchParams(location.hash.replace(/^#/, "")).has("t");
// 3D view: created on first use; patches (data/terrain3d) cached by id.
let terrain = null;
let patchIndex = null;
const patches = new Map();
let shownPatch = null;
let customManifest = null; // data/custom/custom.json: the areas of the 13 sites
let snapshotOpen = false; // "Snapshot over the period" (kept for the session, not in the address)
const SNAPSHOT_KEY = "lunazen.explorer.snapshot";

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
    customManifest = await fetch("data/custom/custom.json").then((r) => r.json()).catch(() => null); // names the site of a saved point; the page works without it
  } catch (error) {
    dataLoadError(error, "explorer.html");
    return;
  }
  const first = parseState(location.hash, DEFAULTS);
  const known = await ensureCustom(catalog, "data", first.spot);
  buildControls();
  autoT = !hasMoment();
  question = createQuestion({
    els: { sentence: $("sentence"), trail: $("trail"), pop: $("pop") },
    ctx: { catalog, rankHref: () => `rank.html${carryHash("rank.html", { mast: state.mast, start: state.start })}`, pickerOptions: { includeMissions: true, includeBeyond: true }, spotList: { siteNameOf } },
    parse: (hash) => parseState(hash, DEFAULTS),
    serialize: (q) => serializeState(q),
    normalize,
    keyOf: (patch) => ({ spot: "spot", start: "from", days: "days", mast: "mast" })[Object.keys(patch)[0]] ?? "spot",
    segments: (q) => [{ key: "spot", text: spotLabel(q.spot) }, " from ", { key: "from", text: dayLabel(q.start) }, " over ", { key: "days", text: `${q.days} days` }, " with a ", { key: "mast", text: `${q.mast} m` }, " mast height"],
    run: (q, info) => onQuestion(info),
  });
  state = question.state;
  if (!known) { question.set({ spot: DEFAULTS.spot }); state = question.state; }
  lastSpot = state.spot;
  question.start();
  window.addEventListener("resize", render);
  onThemeChange(render);
  // A canvas is cleared whenever its bitmap is resized, and a tab restored from the background can lose it:
  // redraw when a picture changes size (layout shifts, un-hiding) or the page becomes visible again.
  let pending = 0;
  const redraw = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(render); };
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(redraw);
    for (const id of ["event-chart", "clearance-chart", "panorama", "snap-chart"]) observer.observe($(id));
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) redraw(); });
  // Back and Forward are handled by the question module, which calls onQuestion.
}

// The site a saved point lies in (its usable area, data/custom/custom.json), or "".
function siteNameOf(id) {
  const p = mineLatLon(id);
  if (!p || !customManifest) return "";
  const [x, y] = latLonToPolar(p.latitudeDeg, p.longitudeDeg);
  return customManifest.sites.find((t) => x >= t.interior.xMinM && x <= t.interior.xMaxM && y >= t.interior.yMinM && y <= t.interior.yMaxM)?.name ?? "";
}

// What the sentence calls the spot: "Site01-1 · Connecting ridge", a saved point's name with its site, a lander, or a site away from the pole.
function spotLabel(id) {
  const saved = mineName(id);
  if (saved) return [saved, siteNameOf(id)].filter(Boolean).join(" · ");
  const mission = catalog.missions.get(id);
  if (mission) return mission.name;
  const spot = catalog.spots.get(id);
  if (spot) return `${id} · ${spot.siteName}`;
  return catalog.customs.get(id)?.name ?? spotName(id);
}

// The short name the plan panel and the timeline's title use: the point's name, or the spot's id.
const shortName = (id) => mineName(id) ?? catalog.missions.get(id)?.name ?? catalog.customs.get(id)?.name ?? id;

function buildControls() {
  $("time").addEventListener("input", () => { state.t = Number($("time").value); render(); });
  $("tab-panorama").addEventListener("click", () => setView("panorama"));
  $("tab-3d").addEventListener("click", () => setView("3d"));
  $("tab-period").addEventListener("click", () => setView("period"));
  $("dark-below").addEventListener("change", () => { state.dbelow = normalizeDarkBelow($("dark-below").value); recompute(); setView(state.view); });
  $("dsn-rule").addEventListener("change", async () => {
    state.dstation = normalizeDstation($("dsn-rule").value);
    if (state.dstation) await ensureRotation();
    recompute();
    setView(state.view);
  });
  $("prev-change").addEventListener("click", () => jump(-1));
  $("next-change").addEventListener("click", () => jump(1));
  // The moment is a date and a 24-hour UTC time (a select, so the browser's own 12-hour display never appears).
  for (let m = 0; m < 1440; m += 15) $("moment-time").append(new Option(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`));
  const onMoment = () => {
    if (!$("moment-date").value || !model) return;
    const k = Math.round((parseUtc(`${$("moment-date").value}T${$("moment-time").value}:00`) - model.series.et[0]) / STEP_S);
    state.t = Math.min(Math.max(k, 0), model.series.et.length - 1);
    render();
  };
  $("moment-date").addEventListener("change", onMoment);
  $("moment-time").addEventListener("change", onMoment);
  const setPano = (mode) => {
    pano.mode = mode;
    for (const m of ["whole", "sun", "earth"]) $(`pano-${m}`).setAttribute("aria-pressed", String(mode === m));
    $("pano-span-wrap").hidden = mode === "whole";
    render();
  };
  for (const m of ["whole", "sun", "earth"]) $(`pano-${m}`).addEventListener("click", () => setPano(m));
  $("pano-span").addEventListener("change", () => { pano.span = Number($("pano-span").value); render(); });
  let drag = null;
  $("panorama").addEventListener("pointerdown", (event) => {
    if (pano.mode === "whole") return;
    drag = { x: event.clientX, center: panoCenter };
    $("panorama").setPointerCapture(event.pointerId);
  });
  $("panorama").addEventListener("pointermove", (event) => {
    if (!drag) return;
    const degPerPx = pano.span / Math.max($("panorama").clientWidth - 70, 1);
    pano.mode = "free";
    $("pano-span-wrap").hidden = false;
    for (const m of ["whole", "sun", "earth"]) $(`pano-${m}`).setAttribute("aria-pressed", "false");
    pano.center = (((drag.center - (event.clientX - drag.x) * degPerPx) % 360) + 360) % 360;
    render();
  });
  for (const type of ["pointerup", "pointercancel"]) $("panorama").addEventListener(type, () => { drag = null; });
  $("cam-orbit").addEventListener("click", () => setCamera("orbit"));
  $("cam-sky").addEventListener("click", () => setCamera("sky"));
  $("cam-sun").addEventListener("click", () => zoomTo("sun", 8));
  $("cam-earth").addEventListener("click", () => zoomTo("earth", 10));
  $("cam-reset").addEventListener("click", () => { terrain?.resetCamera(); pressCamera("orbit"); });
  $("play").addEventListener("click", togglePlay);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) $("play").textContent = "Next day";
  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input, select, textarea, button, summary") || document.querySelector("dialog[open]") || event.ctrlKey || event.metaKey || event.altKey || !model || state.view === "period") return;
    if (event.key === " ") togglePlay();
    else if (event.key === "ArrowLeft") jump(-1);
    else if (event.key === "ArrowRight") jump(1);
    else return;
    event.preventDefault();
  });
  wireCopyLink($("copy-link"));
  buildHelp();
  mountIcons();
  $("help-open").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (e) => { if (e.target === $("help-dialog")) $("help-dialog").close(); });
  try { snapshotOpen = sessionStorage.getItem(SNAPSHOT_KEY) === "1"; } catch { /* no session storage: closed */ }
  setSnapshot(snapshotOpen);
  $("snap-toggle").addEventListener("click", () => { setSnapshot(!snapshotOpen); if (snapshotOpen) render(); });
  $("tab-panorama").parentElement.addEventListener("keydown", (event) => {
    const tabs = ["panorama", "3d", "period"];
    const k = tabs.indexOf(state.view);
    const next = event.key === "ArrowRight" ? (k + 1) % 3 : event.key === "ArrowLeft" ? (k + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
    if (next < 0) return;
    event.preventDefault();
    setView(tabs[next]);
    $(`tab-${tabs[next]}`).focus();
  });
  // Click or drag on the timeline to scrub; one redraw per frame.
  let scrubbing = false;
  let scrubFrame = 0;
  const scrubTo = (event) => {
    state.t = snapHit(event.clientX);
    if (!scrubFrame) scrubFrame = requestAnimationFrame(() => { scrubFrame = 0; render(); });
  };
  $("snap-chart").addEventListener("pointerdown", (event) => { scrubbing = true; $("snap-chart").setPointerCapture(event.pointerId); scrubTo(event); });
  $("snap-chart").addEventListener("pointermove", (event) => { if (scrubbing) scrubTo(event); });
  for (const type of ["pointerup", "pointercancel"]) $("snap-chart").addEventListener(type, () => { scrubbing = false; });
  $("event-chart").addEventListener("click", (event) => { state.t = chartHit(event.clientX); render(); });
  $("clearance-chart").addEventListener("click", (event) => { state.t = clearanceHit(event.clientX); render(); });
  $("csv").addEventListener("click", () => download(windowsToCsv(model.windowRows, state.spot), `${state.spot}-windows.csv`, "text/csv"));
  $("ics").addEventListener("click", () => download(windowsToIcs(model.windowRows, state.spot, parseUtc(new Date().toISOString().slice(0, 19))), `${state.spot}-windows.ics`, "text/calendar"));
}

function setView(view) {
  state.view = view === "3d" || view === "period" ? view : "panorama";
  for (const v of ["panorama", "3d", "period"]) {
    $(`tab-${v}`).setAttribute("aria-selected", String(state.view === v));
    $(`tab-${v}`).tabIndex = state.view === v ? 0 : -1;
  }
  $("panorama").hidden = state.view !== "panorama";
  $("view3d").hidden = state.view !== "3d";
  $("exp-live").hidden = state.view === "period";
  $("period").hidden = state.view !== "period";
  $("pano-controls").hidden = state.view !== "panorama";
  $("view3d-buttons").hidden = state.view !== "3d";
  $("period-controls").hidden = state.view !== "period";
  $("pano-swipe").hidden = state.view !== "panorama";
  render();
}

// "Snapshot over the period": closed on first load; the choice lasts for the session.
function setSnapshot(open) {
  snapshotOpen = open;
  $("snap-toggle").setAttribute("aria-expanded", String(open));
  $("snap-body").hidden = !open;
  try { sessionStorage.setItem(SNAPSHOT_KEY, open ? "1" : "0"); } catch { /* the choice is not kept */ }
}

// Jump to the next (dir = 1) or previous (dir = -1) change in sunlight or contact.
function jump(dir) {
  const { series, link } = model;
  const k = nextChange([series.sunFraction, series.earthFraction, link], state.t, dir);
  if (k === null) return;
  state.t = k;
  render();
}

// What the 3D view shows and how to move in it: the help dialog lists both camera modes.
const VIEW3D_NOTES = [
  "Fly around: the camera circles the spot from 6 km away.",
  "The ground is measured terrain with real shadows. The orange pin is the spot.",
  "Sun and Earth are sky markers: filled if visible, hollow if hidden.",
  "Drag to turn. Scroll to zoom.",
];
const SKY_NOTES = [
  "Sky view: what you would see from the spot.",
  "Terrain, Sun and Earth are computed. Ground grain and stars are decoration.",
  "Earth is only 1.9° wide: zoom in, or press Look at Earth.",
  "Hover a body for its azimuth and elevation.",
];

// Loading and error text for the 3D view.
function message3d(text = "") {
  $("view3d-msg").textContent = text;
  $("view3d-msg").hidden = !text;
}

// Tooltip on the Sun and Earth: where they are in the sky from the spot, and whether they clear the skyline.
function showBodyTip(hit) {
  const tip = $("body-tip");
  if (!hit || !terrain?.sky) { tip.hidden = true; return; }
  const { title, lines } = describeBody(hit.key === "sun" ? "Sun" : "Earth", terrain.sky[hit.key]);
  tip.innerHTML = `<b>${title}</b>${lines.join("<br>")}`;
  tip.hidden = false;
  const w = $("terrain3d").clientWidth;
  const h = $("terrain3d").clientHeight;
  tip.style.left = `${Math.max(0, Math.min(hit.x + 14, w - tip.offsetWidth))}px`;
  tip.style.top = `${hit.y + 14 + tip.offsetHeight > h ? Math.max(0, hit.y - tip.offsetHeight - 10) : hit.y + 14}px`;
}

// The camera buttons: the active one has an accent border (aria-pressed).
function pressCamera(active) {
  for (const [id, m] of [["cam-orbit", "orbit"], ["cam-sky", "sky"], ["cam-sun", "sun"], ["cam-earth", "earth"]]) $(id).setAttribute("aria-pressed", String(m === active));
}

// From the spot, facing the Sun or Earth (the view keeps following it as the moment changes).
function zoomTo(body, fov) {
  pressCamera(body);
  terrain?.lookAt(body, fov);
}

function setCamera(mode) {
  pressCamera(mode);
  terrain?.setMode(mode);
}

function patchId() {
  return catalog.missions.has(state.spot) ? state.spot : catalog.spotRecord(state.spot).tileSite ?? catalog.spotRecord(state.spot).site;
}

// Load (once) and show the terrain patch for the current spot, then draw it with the Sun and
// Earth as the engine sees them from the spot (direction, size and visible fraction).
async function render3d(sun, earth) {
  try {
    if (!terrain) {
      terrain = new TerrainView($("terrain3d"), $("terrain3d-overlay"));
      terrain.onHover = showBodyTip;
    }
  } catch (error) {
    message3d(`The 3D view could not start in this browser (${error.message}). The panorama shows the same horizon.`);
    return;
  }
  if (catalog.customs.has(state.spot)) {
    message3d("The 3D terrain is not available for this site. The panorama shows the same horizon.");
    return;
  }
  const id = patchId();
  if (shownPatch !== id) {
    if (loadingPatch) return; // a fetch is already under way; the slider keeps moving meanwhile
    loadingPatch = true;
    message3d("Loading the terrain…");
    try {
      patchIndex ??= await fetch("data/terrain3d/index.json").then((r) => { if (!r.ok) throw new Error(`index.json: ${r.status}`); return r.json(); });
      const header = patchIndex.patches.find((p) => p.id === id);
      if (!header) throw new Error(`no terrain patch for ${id}`);
      if (!patches.has(id)) patches.set(id, await fetch(`data/terrain3d/${id}.bin`).then((r) => { if (!r.ok) throw new Error(`${id}.bin: ${r.status}`); return r.arrayBuffer(); }));
      terrain.setPatch(header, parsePatch(header, patches.get(id)));
      shownPatch = id;
      terrain.setSky(skyOf(sun, earth));
      terrain.resetCamera();
      message3d();
      pressCamera(terrain.camera.mode === "sky" ? "sky" : "orbit");
    } catch (error) {
      message3d(`The 3D terrain for this spot could not be loaded (${error.message}). The panorama shows the same horizon.`);
      return;
    } finally {
      loadingPatch = false;
    }
  }
  const spot = terrain.header.spots.find((s) => s.id === state.spot) ?? { eM: 0, nM: 0, zM: 0 };
  terrain.setTarget([spot.eM, spot.nM, spot.zM]);
  terrain.targetLabel = state.spot === terrain.header.id ? terrain.header.name : state.spot;
  terrain.setSky(skyOf(sun, earth));
  terrain.setHorizon(model.horizon);
  terrain.draw();
}

const skyOf = (sun, earth) => {
  const pick = (b) => ({ azimuth: b.azimuth, elevation: b.elevation, radius: b.radius, fraction: b.fraction, terrain: b.terrain });
  return { sun: pick(sun), earth: pick(earth) };
};

function syncControls() {
  $("dark-below").value = String(state.dbelow);
  $("dsn-rule").value = String(state.dstation);
  const mission = catalog.missions.get(state.spot);
  const beyond = catalog.customs.get(state.spot)?.group === "beyond" ? catalog.customs.get(state.spot) : null;
  $("mission-note").hidden = !mission && !beyond;
  if (beyond) $("mission-note").textContent = `${beyond.name}, away from the pole: Sun and Earth positions are exact for the dates you choose, but the terrain is the 474 m global map, so sunrise and sunset can be off by an hour or more. The mast is fixed at ${catalog.defaultMastM} m.`;
  if (mission) $("mission-note").textContent = `CLPS landing: the dates start on the landing day and run ${state.days} days, and the mast is the lander's own (${catalog.defaultMastM} m is used for the terrain).`;
}

function target() {
  if (catalog.missions.has(state.spot)) return catalog.mission(state.spot);
  if (!catalog.mastsM.includes(state.mast)) state.mast = catalog.defaultMastM;
  return catalog.spot(state.spot, state.mast);
}

function recompute() {
  const { site, horizon, record } = target();
  const et0 = parseUtc(`${state.start}T00:00:00`);
  const et1 = Math.min(et0 + state.days * 86400, ephemeris.etMax - STEP_S);
  const series = timeSeries(ephemeris, site, horizon, et0, et1, STEP_S, { dsnRule: state.dstation ? "station" : "disk" });
  const windowRows = [
    ...windows(series.et, (i) => series.sunFraction[i] > 0).map((w) => ({ body: "Sun", ...w })),
    ...windows(series.et, (i) => series.earthFraction[i] > 0).map((w) => ({ body: "Earth", ...w })),
  ].sort((a, b) => a.startEt - b.startEt);
  const dayStarts = [];
  series.et.forEach((et, i) => {
    const text = formatUtc(et);
    if (text.endsWith("00:00")) dayStarts.push({ index: i, label: text.slice(5, 10) });
  });
  model = {
    site, horizon, record, series, windowRows, dayStarts,
    summary: summarize(series, state.dbelow / 100),
    link: Array.from(series.earthFraction, (f, i) => (f > 0 && series.dsnInView[i] === 1 ? 1 : 0)),
    range: panoramaRange([horizon.elevation, series.sunElevation, series.earthElevation]),
  };
  $("time").max = series.et.length - 1;
  if (autoT) {
    const firstSunlit = series.sunFraction.findIndex((f) => f > 0);
    state.t = Math.max(firstSunlit, 0);
    autoT = false;
  }
  $("moment-date").min = formatUtc(series.et[0]).slice(0, 10);
  $("moment-date").max = formatUtc(series.et[series.et.length - 1]).slice(0, 10);
  state.t = Math.min(Math.max(Math.round(state.t) || 0, 0), series.et.length - 1);
  renderSiteInfo();
  renderSummary();
  renderWindows();
  render();
}

function render() {
  if (!model) return;
  const { series, site, horizon } = model;
  const i = state.t;
  const et = series.et[i];
  const sun = bodyState(ephemeris, "SUN", site, horizon, et);
  const earth = bodyState(ephemeris, "EARTH", site, horizon, et);
  $("time").value = i;
  $("moment-date").value = formatUtc(et).slice(0, 10);
  $("moment-time").value = formatUtc(et).slice(11, 16);
  $("day-of").textContent = `Day ${Math.floor(i / 96) + 1} of ${state.days}`;
  const canvas = $("panorama");
  const bodies = [sun, earth];
  const wide = pano.mode === "whole";
  const center = wide ? 180 : pano.mode === "sun" ? sun.azimuth : pano.mode === "earth" ? earth.azimuth : pano.center;
  const span = wide ? 360 : pano.span;
  panoCenter = center;
  const zoom = wide ? null : windowRange(horizon, bodies, center, span, canvas.clientHeight / Math.max(canvas.clientWidth - 70, 1), true, pano.mode === "sun" ? sun : pano.mode === "earth" ? earth : null);
  drawPanorama(canvas, {
    horizon,
    center,
    span,
    stretch: zoom?.stretch ?? null,
    range: zoom ? zoom.range : model.range,
    tracks: { sun: { az: series.sunAzimuth, el: series.sunElevation }, earth: { az: series.earthAzimuth, el: series.earthElevation } },
    now: { sun, earth },
    discs: true,
  });
  if (state.view === "3d") render3d(sun, earth);
  if (state.view === "period") renderEventChart(i);
  $("snap-title").textContent = periodTitle(state.start, rangeEnd(state.start, state.days), shortName(state.spot));
  if (snapshotOpen && state.view !== "period") snapHit = drawEventChart($("snap-chart"), eventChartOptions(i)); // the same chart as the top of the Visibility Timeline
  const dsn = dsnInfo(et, earth.fraction > 0);
  renderMoment(et, sun, earth, dsn);
  if (!playing) syncUrl();
}

// "This moment": the date, whether a DSN station is in view, and one card each for the Sun and Earth.
function renderMoment(et, sun, earth, dsn) {
  const { site, horizon } = model;
  $("moment-h").textContent = `This moment · ${momentHeading(formatUtc(et))}`;
  $("dsn-text").textContent = dsnTag(dsn.link);
  $("dsn-tag").classList.toggle("on", dsn.link);
  const tip = "Clearance above the real skyline, and height above a level horizon. Near the pole the Sun can be below level yet still above the skyline, because the ground falls away.";
  $("moment-cards").innerHTML = [["sun", "The Sun", sun, timeToChange(ephemeris, site, horizon, et, "SUN")], ["earth", "Earth", earth, timeToChange(ephemeris, site, horizon, et, "EARTH")]].map(([kind, who, body, change]) => {
    const card = bodyCard(who, body, change);
    return `<div class="exp-card ${kind}"><span class="status"><i class="dot${card.up ? " on" : ""}"></i>${card.status}</span><span class="next">${card.next}</span><span class="clear">${card.clearance}<button type="button" class="hint" data-hint="${tip}" aria-label="About: ${who} height">ⓘ</button></span></div>`;
  }).join("");
}

// While Play runs the address stays put, so Back and Copy link are not flooded with every step.
function syncUrl() {
  history.replaceState(null, "", serializeState(state));
  carryNav(state);
}


// What the Sun, Earth and DSN chart is drawn from: levels per lane, and the longest night, for the three bands. Shared by the Visibility Timeline and the snapshot.
function eventChartOptions(current) {
  const { series } = model;
  const levels = {
    sun: Array.from(series.sunFraction, sunLevel),
    earth: Array.from(series.earthFraction, earthLevel),
    dsn: Array.from(model.link),
  };
  // The night is the longest run counted as dark: no part of the Sun (default), or less than the chosen share of it.
  const night = longestRun(Array.from(series.sunFraction, (f) => (isDark(f, state.dbelow / 100) ? 0 : 1)), 0);
  const nightText = night ? `Longest night ${formatDuration(((night[1] - night[0]) * STEP_S) / 3600)}${darkBelowSuffix(state.dbelow)}` : "";
  return { et: series.et, levels, current, dayStarts: model.dayStarts, night, nightText };
}

function renderEventChart(current) {
  $("period-title").textContent = periodTitle(state.start, rangeEnd(state.start, state.days), shortName(state.spot));
  chartHit = drawEventChart($("event-chart"), eventChartOptions(current));
  renderClearance(current);
}

// The Sun's and Earth's clearance above the skyline over the window, and what a higher skyline would change.
function renderClearance(current) {
  const { series, horizon, summary } = model;
  clearanceHit = drawClearance($("clearance-chart"), { et: series.et, ...clearanceFor(), current, dayStarts: model.dayStarts });
  if (model.clearanceNotes) return;
  const stats = clearanceStats(series, clearanceFor().sun);
  const fragile = fragilityRows(summary, fragility(ephemeris, model.site, horizon, series.et[0], series.et[series.et.length - 1], STEP_S, undefined, { darkBelow: state.dbelow / 100, dsnRule: state.dstation ? "station" : "disk" }));
  model.clearanceNotes = clearanceNotes(stats, fragile, pct, (et) => shortDate(formatUtc(et)));
  $("clearance-notes").innerHTML = model.clearanceNotes.map((t) => `<li>${t}</li>`).join("");
}

// The station-level test needs the Moon-orientation table; it is fetched the first time the option is chosen.
async function ensureRotation() {
  if (!ephemeris.rotation) await Ephemeris.loadRotation(ephemeris, "data");
}

function dsnInfo(et, earthUp) {
  const elevations = moonElevations(ephemeris, et);
  if (state.dstation) { // a complex above 10° whose own direction clears the skyline
    const link = earthUp && stationInView(ephemeris, et, model.site, model.horizon);
    const list = Object.entries(elevations).map(([k, v]) => `${k} ${signedDeg(v, 0)}`).join(", ");
    return { link, list, why: !earthUp ? "Earth is behind the terrain" : link ? "a DSN complex is above the skyline" : "no DSN complex is above the skyline with the Moon above 10°" };
  }
  const best = Object.entries(elevations).sort((a, b) => b[1] - a[1])[0];
  const link = earthUp && best[1] > DSN_MASK_DEG;
  const why = !earthUp ? "Earth is behind the terrain" : best[1] > DSN_MASK_DEG ? `via ${best[0]}` : `no complex sees the Moon above ${DSN_MASK_DEG}°`;
  const list = Object.entries(elevations).map(([k, v]) => `${k} ${signedDeg(v, 0)}`).join(", ");
  return { link, why, list };
}


function renderSiteInfo() {
  const { record } = model;
  const mission = catalog.missions.get(state.spot);
  const artemis = artemisLabel(record.artemisRegions ?? [], catalog.artemisRegions);
  const saved = loadMine().find((m) => m.id === state.spot);
  const coords = `${Math.abs(record.latitudeDeg).toFixed(3)}°${record.latitudeDeg < 0 ? "S" : "N"} ${record.longitudeDeg.toFixed(2)}°E`;
  const more = mission
    ? [mission.operator, `landed ${mission.landedUtc.slice(0, 10)}`, `ended ${mission.ended}`, mission.notes, `Source: ${mission.source}`]
    : record.group === "beyond"
      ? [`${record.operator}, landed ${record.landedDate}`, record.notes, `Source: ${record.source}`, `Terrain: ${catalog.beyond.terrain}. The skyline is smoothed: on ${catalog.beyond.accuracy.site} this map put the horizon off by ${catalog.beyond.accuracy.horizonRmsDeg}° (RMS) and the first sunset ${catalog.beyond.accuracy.sunsetErrorH} h late. Sun and Earth positions are exact.`]
    : record.custom
      ? [record.siteName, "Terrain from a 20 m crop of NASA's 5 m map and a 480 m far field (longest night typically within an hour, at worst about 35 h of the stored 5 m result)."]
      : [record.siteName, `slope ${record.slopeDeg.toFixed(1)}°`, `NASA 18.6-year average: Sun ${pct(record.nasaAvgSun)}, Earth ${pct(record.nasaAvgEarth)}`];
  if (artemis) more.push(`Artemis: ${artemis}`);
  $("site-info").textContent = `${coords} · ${saved ? "saved in this browser" : `Elevation ${record.groundM.toFixed(0)} m`}`;
  const kind = mission ? "mission" : record.group === "beyond" ? "beyond" : record.custom ? "custom" : "spot";
  const hash = mapHash({ id: state.spot, kind, latitudeDeg: record.latitudeDeg, longitudeDeg: record.longitudeDeg });
  $("map-link").hidden = hash === null;
  if (hash) $("map-link").href = `map.html${hash}`;
  $("site-hint").dataset.hint = more.join("\n");
  // The one Plan button of the page: the Planner takes the south-pole spots and the visitor's saved points, not the landers or the sites away from the pole.
  const ok = plannable(catalog, state.spot);
  $("exp-plan").hidden = !ok;
  $("plan-text").textContent = `Ready to plan? Test landing dates at ${shortName(state.spot)}.`;
  $("plan-link").href = `planner.html${carryHash("planner.html", { spot: state.spot, mast: state.mast, start: state.start, dbelow: state.dbelow, dstation: state.dstation })}`;
  $("snap-sub").textContent = `Sun, Earth and DSN across all ${state.days} days · full details in Visibility Timeline`;
}

// The figures for the window, in three groups.
function renderSummary() {
  const s = model.summary;
  const limitH = catalog.darknessPresets.find((p) => p.id === "viper")?.hours ?? 50;
  const groups = figureGroups({
    summary: s, highest: sunHighest(model.series), capture: lightCapture(model.series), stats: clearanceStats(model.series, clearanceFor().sun), limitH,
    darkSuffix: darkBelowSuffix(state.dbelow), dsnSuffix: dsnSuffix(state.dstation), pct, degText, shortDay: (et) => shortDate(formatUtc(et)),
  });
  $("period-stats").innerHTML = groups.map((g) => `<section class="exp-group" style="--n:${g.figures.length}"><h3 class="exp-h">${g.title}</h3><div class="exp-figs">${g.figures.map((f) => `<div class="exp-fig"><span class="k">${f.label}<button type="button" class="hint" data-hint="${f.tip}" aria-label="About: ${f.label}">ⓘ</button></span><span class="v" data-fig="${f.key}">${f.value}</span><span class="s">${f.line}</span></div>`).join("")}</div></section>`).join("");
}

const clearanceFor = () => (model.clearance ??= clearanceSeries(model.series, model.horizon));

function renderWindows() {
  const body = $("windows").querySelector("tbody");
  body.innerHTML = model.windowRows.map((w, k) => {
    const color = w.body === "Sun" ? "var(--sun)" : "var(--earth)";
    const label = w.body === "Sun" ? "Sun" : "Earth";
    return `<tr data-k="${k}"><td><span class="dot" style="background:${color}"></span>${label}</td><td>${shortDateTime(formatUtc(w.startEt))}</td><td>${shortDateTime(formatUtc(w.endEt))}</td><td class="r">${formatDuration((w.endEt - w.startEt) / 3600)}</td></tr>`;
  }).join("") || `<tr><td colspan="4">No windows in this period.</td></tr>`;
  body.onclick = (event) => {
    const row = event.target.closest("tr[data-k]");
    if (!row) return;
    const w = model.windowRows[Number(row.dataset.k)];
    state.t = model.series.et.findIndex((et) => et >= w.startEt);
    setView("panorama");
  };
}

// Play steps about three hours a frame. With reduced motion it does not animate: each press moves one day.
function togglePlay() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.t = (state.t + 96) % model.series.et.length; // one day of 15-minute samples
    render();
    syncUrl();
    return;
  }
  if (playing) {
    clearInterval(playing);
    playing = null;
  } else {
    playing = setInterval(() => {
      state.t = (state.t + 12) % model.series.et.length; // three hours a frame
      render();
    }, 60);
  }
  if (!playing) syncUrl();
  $("play").textContent = playing ? "Pause" : "Play";
  $("play").setAttribute("aria-pressed", String(Boolean(playing)));
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function pct(fraction) {
  return `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.01 ? 1 : 0)}%`;
}

// How to use the Explorer: what to do, then what each view's old Help said, then the three "Why" questions.
function buildHelp() {
  const group = (title, body) => `<section><h3>${title}</h3>${body}</section>`;
  const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  const sub = (title, body) => `<h4>${title}</h4>${body}`;
  const why = (q, a, extra = "") => `<details><summary>${q}</summary><p>${a}</p>${extra}</details>`;
  $("exp-help").innerHTML = [
    group("Choose what to look at", "<p>Click the orange words in the sentence at the top to pick a candidate spot or one of My points, the start date, how many days to look at and the mast height.</p>"),
    group("Three views", "<p>Panorama shows the Sun and Earth against the real skyline in every direction. 3D terrain shows the same moment over the landscape. Visibility Timeline sums up the whole window: sunlight, darkness, contact with Earth and every window.</p>"),
    group("Move through time", "<p>Press Play, drag the timeline, or use Previous change and Next change to jump to the next sunrise, sunset, Earthrise or Earthset. To go straight to a moment, set its date and time (UTC). Keyboard: Space plays and pauses; ← and → jump to the previous or next change.</p>"),
    group("Reading each view", [
      sub("Panorama", list(["Drag the picture to turn.", "Discs are drawn at true size; across and up use the same scale.", "The skyline hides what is below it. A dashed ring marks a hidden body."])),
      sub("3D terrain", list([...VIEW3D_NOTES, ...SKY_NOTES])),
      sub("Visibility Timeline", list([
        "Clearance: how far the centre of the Sun or Earth stands above the terrain in its own direction; zero is the skyline.",
        "Near the pole the Sun skims the skyline, so a small error in the terrain map can move a sunrise or sunset by hours.",
        "The second line says what the window would look like if the skyline were higher by that error.",
        "Dark: no part of the Sun above the terrain.",
        "Earth in view: any part of its disk above the terrain.",
        "DSN in view: line of sight only, Earth above the skyline and a DSN complex seeing the Moon above 10°. No link budget or antenna scheduling.",
        "Click a row or the chart to see that moment.",
      ])),
    ].join("")),
    group("Why does it look like this?", [
      why("Why does the Sun barely rise?", "The Moon's axis is almost upright against the direction of the Sun, tilted by only about 1.5°. At the pole the Sun therefore circles just above or below the flat horizon and never climbs higher than about 1.5° above it; at the candidate spots, which lie up to a few degrees from the pole, it reaches between about 2° and 7°. A ridge or a crater rim a few kilometres away is often enough to hide it, which is why the terrain, not the latitude, decides what is lit."),
      why("Why does Earth move up and down?", "The Moon always shows Earth the same face, but its orbit is oval and tilted, so it rocks a little as it goes round. Seen from the south pole, Earth swings back and forth and up and down by a few degrees every month. It bobs above and below the skyline, and the times it is hidden are the times a lander at the pole cannot reach Earth directly.", '<p class="video" data-video-wrap hidden><a data-video="polar" href="#">Watch: The Sun and Earth in the South Polar Sky ↗</a></p>'),
      why("Why is a bright spot not always a good spot?", "A published average tells you how much of the time a spot is lit, not how long the longest night lasts or whether Earth is in view during it. A lander needs light and a link to Earth across a whole mission, so the longest stretch without either matters more than the average. The Planner tests exactly that."),
    ].join("")),
  ].join("");
  hydrateLinks($("exp-help"));
}

main();

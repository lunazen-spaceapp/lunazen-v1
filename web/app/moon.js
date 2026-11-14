// Moon page: the landing sites away from the pole on a map of the whole Moon, and for the chosen site the Sun and
// Earth against its terrain next to the south-pole reference spot, at the same moment.

import { bodyState, Ephemeris, parseUtc, SiteCatalog, timeSeries, STEP_S } from "../engine/index.js";
import { onThemeChange } from "./theme.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { carryHash, clampDate, formatUtc, panoramaRange, parseState, serializeState } from "./format.js";
import { drawPanorama } from "./panorama.js";
import { fullSunHours, lightCapture } from "./events.js";
import { COMPARE_ROWS, lonLatToXY, moonStory, nearestSite, POLAR_EDGE_DEG, skyFacts, sourceRects, viewOf, VIEWS, wrapLon } from "./moonmap.js";

const MIN_DATE = "2024-01-02";
const MAX_DATE = "2043-12-01";
const POLE = "Site01-1";
const DAYS = 30;
const MAST_M = 2;
const $ = (id) => document.getElementById(id);

const today = new Date().toISOString().slice(0, 10);
const DEFAULTS = { site: "a11", start: clampDate(today, MIN_DATE, MAX_DATE), t: 0, view: "" };
// Short names for the map, and where the label goes ([side, dy]); the Apollo sites are close together.
const LABELS = {
  a11: ["Apollo 11"], a12: ["Apollo 12", "left"], a14: ["Apollo 14", "right", -6], a15: ["Apollo 15"], a16: ["Apollo 16", "left", 9], a17: ["Apollo 17"],
  ce3: ["Chang'e 3"], ce4: ["Chang'e 4", "left"], ce5: ["Chang'e 5"], ce6: ["Chang'e 6"], ch3: ["Chandrayaan-3"], slim: ["SLIM", "right", 9],
};
const shortName = (record) => LABELS[record.id]?.[0] ?? record.name;

let ephemeris;
let catalog;
let moonMeta;
let moonImage;
let state;
let sites; // the sites away from the pole, in landing order
let model; // the series for the chosen site and the pole over the window
let autoT = true;
let playing = null;
const skyCache = new Map();

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
    moonMeta = await fetch("data/moon_map.json").then((r) => r.json());
    moonImage = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("data/moon_map.webp did not load")); img.src = "data/moon_map.webp"; });
  } catch (error) {
    dataLoadError(error, "moon.html");
    return;
  }
  sites = [...catalog.beyond.sites].sort((a, b) => a.landedDate.localeCompare(b.landedDate));
  state = parseState(location.hash, DEFAULTS);
  if (!sites.some((s) => s.id === state.site)) state.site = DEFAULTS.site;
  state.start = clampDate(state.start, MIN_DATE, MAX_DATE);
  if (!(state.view in VIEWS)) state.view = viewOf(sites.find((s) => s.id === state.site).longitudeDeg);
  autoT = !new URLSearchParams(location.hash.replace(/^#/, "")).has("t");
  for (const s of sites) $("site").append(new Option(`${s.name} · ${s.landedDate.slice(0, 4)}`, s.id));
  $("start").min = MIN_DATE;
  $("start").max = MAX_DATE;
  wireCopyLink($("copy-link"));
  buildHelp();
  bind();
  recompute();
  window.addEventListener("resize", draw);
  onThemeChange(draw);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) draw(); });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(draw).observe($("moon-map"));
}

function bind() {
  $("site").addEventListener("change", () => choose($("site").value));
  for (const [id, view] of [["view-near", "near"], ["view-far", "far"]]) $(id).addEventListener("click", () => { state.view = view; render(); });
  $("help-open").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (e) => { if (e.target === $("help-dialog")) $("help-dialog").close(); });
  $("start").addEventListener("change", () => { state.start = clampDate($("start").value, MIN_DATE, MAX_DATE); state.t = 0; autoT = true; recompute(); });
  $("time").addEventListener("input", () => { stop(); state.t = Number($("time").value); autoT = false; render(); });
  $("play").addEventListener("click", () => (playing ? stop() : play()));
  const map = $("moon-map");
  const hit = (event) => {
    const { left, top, width, height } = map.getBoundingClientRect();
    return nearestSite(sites, event.clientX - left, event.clientY - top, width, height, 16, VIEWS[state.view]);
  };
  map.addEventListener("pointermove", (event) => { map.style.cursor = hit(event) || inPolarBand(event) ? "pointer" : "default"; });
  map.addEventListener("click", (event) => {
    const found = hit(event);
    if (found) choose(found.id);
    else if (inPolarBand(event)) location.href = "map.html";
  });
}

function inPolarBand(event) {
  const { top, height } = $("moon-map").getBoundingClientRect();
  const view = VIEWS[state.view];
  return event.clientY - top >= (height * (view.latMax - POLAR_EDGE_DEG)) / (view.latMax - view.latMin);
}

function choose(id) {
  stop();
  state.site = id;
  state.view = viewOf(sites.find((s) => s.id === id).longitudeDeg);
  state.t = 0;
  autoT = true;
  recompute();
}

function play() {
  $("play").setAttribute("aria-pressed", "true");
  $("play-text").textContent = "Pause";
  playing = setInterval(() => {
    if (state.t >= model.hereSeries.et.length - 1) { stop(); return; }
    state.t = Math.min(state.t + 4, model.hereSeries.et.length - 1); // one hour a tick
    render();
  }, 90);
}

function stop() {
  if (playing) clearInterval(playing);
  playing = null;
  $("play").setAttribute("aria-pressed", "false");
  $("play-text").textContent = "Play";
}

// Highest Sun and the range of Earth's height over the whole default year (hourly, which is plenty for extremes).
function skyOf(id) {
  if (!skyCache.has(id)) {
    const { site, horizon } = catalog.spot(id, MAST_M);
    const start = parseUtc(`${catalog.defaultYear}-01-01T00:00:00`);
    const s = timeSeries(ephemeris, site, horizon, start, start + 365 * 86400, 3600);
    skyCache.set(id, {
      sunMaxDeg: Math.max(...s.sunElevation),
      capture: lightCapture(s), // the share of the light a Sun-tracking upright and a flat array capture (null if the Sun is never up)
      fullSunHours: fullSunHours(s, 3600), // hourly series
      earthMinDeg: Math.min(...s.earthElevation),
      earthMaxDeg: Math.max(...s.earthElevation),
    });
  }
  return skyCache.get(id);
}

const yearOf = (record) => (record.group === "beyond" ? record.years[catalog.defaultYear] : catalog.yearMetrics(record));

function recompute() {
  const start = parseUtc(`${state.start}T00:00:00`);
  const here = catalog.spot(state.site, MAST_M);
  const pole = catalog.spot(POLE, MAST_M);
  const series = (s) => timeSeries(ephemeris, s.site, s.horizon, start, start + DAYS * 86400, STEP_S);
  model = { here, pole, hereSeries: series(here), poleSeries: series(pole) };
  const n = model.hereSeries.et.length;
  $("time").max = n - 1;
  if (autoT) {
    // The first moment both skies have the Sun up, else the first with the Sun up here.
    const both = model.hereSeries.sunFraction.findIndex((v, k) => v > 0 && model.poleSeries.sunFraction[k] > 0);
    const hereOnly = model.hereSeries.sunFraction.findIndex((v) => v > 0);
    state.t = both >= 0 ? both : Math.max(hereOnly, 0);
  }
  state.t = Math.min(Math.max(state.t, 0), n - 1);
  $("site").value = state.site;
  $("start").value = state.start;
  renderStatic();
  render();
}

function renderStatic() {
  const { here, pole } = model;
  const name = shortName(here.record);
  const facts = skyFacts(yearOf(here.record), skyOf(state.site));
  const poleFacts = skyFacts(yearOf(pole.record), skyOf(POLE));
  $("th-site").textContent = name;
  $("th-pole").innerHTML = `South pole <span>${POLE}*</span>`;
  $("moon-table-h").textContent = `Site vs. South Pole (${catalog.defaultYear})`;
  $("moon-table").tBodies[0].replaceChildren(...COMPARE_ROWS.map(([key, label, tone]) => {
    const tr = document.createElement("tr");
    tr.dataset.tone = tone;
    for (const [tag, text, note] of [["th", label], ["td", facts[key], facts[`${key}Note`]], ["td", poleFacts[key], poleFacts[`${key}Note`]]]) {
      const cell = document.createElement(tag);
      if (tag === "th") cell.scope = "row";
      cell.textContent = text;
      if (note) { const small = document.createElement("small"); small.textContent = note; cell.append(small); }
      tr.append(cell);
    }
    return tr;
  }));
  $("moon-story").textContent = moonStory(name, yearOf(here.record), yearOf(pole.record), skyOf(state.site), skyOf(POLE));
  const r = here.record;
  $("site-info").textContent = `${r.operator}, landed ${r.landedDate} · ${Math.abs(r.latitudeDeg).toFixed(3)}°${r.latitudeDeg < 0 ? "S" : "N"} ${r.longitudeDeg.toFixed(2)}°E${viewOf(r.longitudeDeg) === "far" ? " · far side" : ""}`;
  $("explorer-link").href = `explorer.html${carryHash("explorer.html", { spot: state.site, mast: MAST_M, start: state.start })}`;
  $("moon-site-title").textContent = `${r.name}`;
  $("moon-pole-title").textContent = `South pole: ${POLE}, ${pole.record.siteName}*`;
}

function render() {
  const { hereSeries } = model;
  $("time").value = state.t;
  $("moon-time").innerHTML = `${formatUtc(hereSeries.et[state.t])} UTC <span>· day ${Math.floor(state.t / 96) + 1} of ${DAYS}</span>`;
  const near = state.view === "near";
  $("view-near").setAttribute("aria-pressed", String(near));
  $("view-far").setAttribute("aria-pressed", String(!near));
  $("moon-side-note").textContent = near ? "Faces Earth: Earth is in view all year at every site here." : "Never faces Earth: there is no direct line to it from here.";
  $("moon-corner").textContent = near ? "Near side · 90°W to 90°E" : "Far side · 90°E to 90°W through 180°";
  const hash = serializeState({ site: state.site, start: state.start, t: state.t, view: state.view });
  history.replaceState(null, "", hash);
  // The planning pages take only south-pole spots, so a site away from the pole carries no spot.
  carryNav({ spot: state.site === POLE ? POLE : undefined, mast: MAST_M, start: state.start });
  draw();
}

// The skyline and both tracks, but not further down than 20 degrees below the horizon: at a site where the Sun
// swings through the whole sky the part below the horizon is not what this picture is for.
function skyRange(spot, series) {
  const [lo, hi] = panoramaRange([spot.horizon.elevation, series.sunElevation, series.earthElevation]);
  return [Math.max(lo, -20), hi];
}

function drawSky(canvas, spot, series) {
  const et = series.et[state.t];
  drawPanorama(canvas, {
    horizon: spot.horizon,
    range: skyRange(spot, series),
    tracks: { sun: { az: series.sunAzimuth, el: series.sunElevation }, earth: { az: series.earthAzimuth, el: series.earthElevation } },
    now: { sun: bodyState(ephemeris, "SUN", spot.site, spot.horizon, et), earth: bodyState(ephemeris, "EARTH", spot.site, spot.horizon, et) },
  });
}

const lonText = (lon) => {
  const l = wrapLon(lon);
  return Math.abs(l) === 180 ? "180°" : l === 0 ? "0°" : `${Math.abs(l)}°${l > 0 ? "E" : "W"}`;
};

// Latitude marks on both side borders and the central meridian's longitude on the top and bottom borders (0° on the
// near side, 180° on the far side). Only the equator and the central meridian get a faint line.
function drawScale(ctx, width, height, view) {
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 3;
  for (const lat of [60, 30, 0, -30, -60, -90]) {
    const [, y] = lonLatToXY(lat, 0, width, height, view);
    if (lat === 0) {
      ctx.strokeStyle = "rgb(232 235 243 / 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgb(232 235 243 / 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x0, dir] of [[0, 1], [width, -1]]) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + dir * 6, y);
    }
    ctx.stroke();
    const text = lat === 0 ? "0°" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`;
    ctx.textBaseline = lat === 60 ? "top" : lat === -90 ? "bottom" : "middle";
    const textY = lat === 60 ? y + 2 : lat === -90 ? y - 2 : y;
    for (const [x, align] of [[9, "left"], [width - 9, "right"]]) label(ctx, text, x, textY, align);
  }
  const mid = (view.lonMin + view.lonMax) / 2;
  const [xMid] = lonLatToXY(0, mid, width, height, view);
  ctx.strokeStyle = "rgb(232 235 243 / 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xMid, 0);
  ctx.lineTo(xMid, height);
  ctx.stroke();
  ctx.strokeStyle = "rgb(232 235 243 / 0.7)";
  ctx.beginPath();
  for (const [y0, dir] of [[0, 1], [height, -1]]) {
    ctx.moveTo(xMid, y0);
    ctx.lineTo(xMid, y0 + dir * 6);
  }
  ctx.stroke();
  ctx.textBaseline = "top";
  label(ctx, lonText(mid), xMid, 8, "center");
  ctx.textBaseline = "bottom";
  label(ctx, lonText(mid), xMid, height - 8, "center");
  ctx.textBaseline = "middle";
}

function label(ctx, text, x, y, align) {
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgb(8 10 18 / 0.7)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgb(232 235 243 / 0.85)";
  ctx.fillText(text, x, y);
}

function drawMap() {
  const canvas = $("moon-map");
  const { width, height } = canvas.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const view = VIEWS[state.view];
  for (const p of sourceRects(view, moonImage.width, moonImage.height)) {
    ctx.drawImage(moonImage, p.sx, p.sy, p.sw, p.sh, p.dx * width, 0, p.dw * width, height);
  }
  const [, edgeY] = lonLatToXY(POLAR_EDGE_DEG, 0, width, height, view);
  ctx.fillStyle = "rgb(8 10 18 / 0.62)";
  ctx.fillRect(0, edgeY, width, height - edgeY);
  ctx.strokeStyle = "#e3a33b"; // the band's dashed top edge
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, edgeY);
  ctx.lineTo(width, edgeY);
  ctx.stroke();
  ctx.setLineDash([]);
  drawScale(ctx, width, height, view);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const chosenSite = sites.find((o) => o.id === state.site);
  for (const s of [...sites.filter((o) => o !== chosenSite), chosenSite]) { // the chosen site is drawn last, on top
    if (!s || viewOf(s.longitudeDeg) !== state.view) continue;
    const [x, y] = lonLatToXY(s.latitudeDeg, s.longitudeDeg, width, height, view);
    const chosen = s.id === state.site;
    if (chosen) { // the Map's "your point" target: a dark halo, an orange ring and dot, and a thin white ring outside
      ctx.beginPath(); ctx.arc(x, y, 12.5, 0, 2 * Math.PI); ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI); ctx.lineWidth = 5; ctx.strokeStyle = "#0b0d12"; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI); ctx.lineWidth = 2.5; ctx.strokeStyle = "#e3a33b"; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fillStyle = "#e3a33b"; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#0b0d12"; ctx.stroke();
    }
    if (width < 460 && !chosen) continue; // too small to name every site
    const [name, side = "right", dy = 0] = LABELS[s.id] ?? [s.name];
    ctx.font = `${chosen ? "bold " : ""}12px system-ui, sans-serif`;
    const w = ctx.measureText(name).width + 14;
    const lx = side === "left" ? x - 20 - w : x + 20;
    ctx.fillStyle = "rgb(11 13 18 / 0.86)";
    ctx.fillRect(lx, y + dy - 10, w, 20);
    ctx.lineWidth = 1;
    ctx.strokeStyle = chosen ? "#e3a33b" : "#3a404d";
    ctx.strokeRect(lx + 0.5, y + dy - 9.5, w - 1, 19);
    ctx.textAlign = "left";
    ctx.fillStyle = chosen ? "#e3a33b" : "#fff";
    ctx.fillText(name, lx + 7, y + dy + 0.5);
  }
}

function draw() {
  if (!model) return;
  drawMap();
  drawSky($("pano-site"), model.here, model.hereSeries);
  drawSky($("pano-pole"), model.pole, model.poleSeries);
}

// How to use this page: four short groups. The year comes from the data.
function buildHelp() {
  const group = (title, body) => `<section><h3>${title}</h3>${body}</section>`;
  $("moon-help").innerHTML = [
    group("Pick a site and date", "<p>Choose a landing site from the list or click one on the map. Chang'e 4 and Chang'e 6 are on the far side; choosing one switches the map.</p>"),
    group("Read the two skies", "<p>Both skylines show the same moment. Set when the 30-day window starts, then press Play or drag the slider to move through the window. Each skyline has its own height scale, printed in its corner.</p>"),
    group("Compare the year", `<p>The table gives the whole of ${catalog.defaultYear} at the chosen site and at the pole, whatever date you picked.</p>`),
    group("About the data", "<ul><li>Terrain at the landing sites is the 474 m global map, so skylines are approximate; Sun and Earth positions are exact.</li><li>The south-pole spot is Site01-1 on the Connecting Ridge, with its 5 m terrain.</li><li>\"DSN in view\" counts a direct line of sight only. Chang'e 4 and 6 reached Earth through a relay satellite, which this page does not model.</li></ul>"),
  ].join("");
}

main();

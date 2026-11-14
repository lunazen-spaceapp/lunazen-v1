// Map: the south pole coloured by NASA's 18.6-year average Sun or Earth visibility, with
// NASA's candidate-site tiles, the candidate spots and CLPS landings; pan, zoom and click.

import { Ephemeris, STEP_S, SiteCatalog, customId, parseUtc, summarize, timeSeries } from "../engine/index.js";
import { ensureCustom } from "./customs.js";
import { FIGURES, MARGIN_KM, checkInput, checkXY, coordinatesText } from "./map-custom.js";
import { bandTiles, countText, description, filterSites, latitudeText, noMatchText, pct, siteRows, sortSites, spotLines, sunSub, verdict } from "./map-model.js";
import { onThemeChange } from "./theme.js";
import { NIGHT_HINT, artemisLabel, formatDuration, parseState, serializeState } from "./format.js";
import { guideLinkHtml } from "./links.js";
import { easeView, fitBox, inBox, latLonToPolar, latitudeRadius, polarToLatLon } from "./maputil.js";
import { setupCanvas } from "./panorama.js";
import { MAX_MINE, addMine, freeName, loadMine, mineLatLon, readShareValue, removeMine, renameMine, shareValue } from "./myspots.js";

const $ = (id) => document.getElementById(id);
const FIT_M = 360_000; // the width shown at zoom 1: NASA's illumination data (300 km) and a margin, so the outermost site boxes (Nobile rim 2 reaches 167 km from the pole) are whole
const MIN_ZOOM = 0.5; // zoomed out far enough to see the whole picture
const MAX_ZOOM = 90; // a 20 m pixel of a site close-up is about 3 screen pixels
const CLOSEUP_BELOW = 150; // m per screen pixel: finer than this, the loaded site close-ups are drawn over the overview
const FOCUS_MS = 350;
const HIT_PX = 14; // a dot or star answers the pointer within this many pixels: a target at least 28 px across, though it is drawn smaller
const PICK_HINT_MS = 33; // the pick-mode label follows the pointer about 30 times a second
const DEFAULTS = { layer: "sun", zoom: 1, cx: 0, cy: 0, spot: "", landing: "", lat: "", lon: "" };
const SITE_COLORS = ["#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7", "#da77f2", "#ff922b", "#3bc9db", "#f783ac", "#a9e34b", "#ffffff", "#845ef7", "#fab005", "#20c997"];

let meta;
let images = {};
let catalog;
let state;
let view = { scale: 1, cx: 0, cy: 0 }; // metres per CSS pixel and centre (m)
let spotsXY = [];
let missionsXY = [];
let siteColor = new Map();
let activeSite = ""; // the site whose tile and dots are emphasised (selected spot or opened tree node)
let selectedMission = ""; // id of the selected CLPS landing
let home = null; // the view to go back to when the zoom to a site (or the zoom out for a landing) ends
let focused = ""; // the site the view was fitted to
let anim = null; // requestAnimationFrame id of a running view change
let ready = false; // the first view is set: from here views animate
let sitemap = null; // data/sitemap/site_map.json: where the site close-ups are
const closeups = new Map(); // site id -> { sun, earth } canvases of its close-up, "loading" or "error"
let hover = ""; // spot or mission id under the pointer or the list row
let custom = null; // manifest of the areas where a custom point can be traced (data/custom/custom.json)
let rejectedPoint = null; // { x, y }: where a point that cannot be traced fell, drawn as a grey ring
let pickSite = null; // the site box a first pick click zoomed to: the next click places the point
let customPoint = null; // { lat, lon, x, y, site, readAs }: the point the visitor placed
let markerHidden = false; // a spot was selected: the marker is hidden until the point is shown again
let hoverSite = ""; // the site whose row the pointer or focus is on: its box is emphasised on the map
let tab = "sites"; // the sidebar tab: sites, point or mine
let sortBy = "sun";
let query = "";
let allRows = []; // the site rows of map-model.js
const openSites = new Set(); // the sites open in the list
let placing = false; // the next click on the map sets the custom point
let mine = []; // the visitor's saved spots (myspots.js)
let ephemeris = null; // loaded when the first custom point is shown
let figuresRun = 0; // the point whose figures are being computed; an older run drops its result
let touchTip = ""; // the dot whose tooltip a first tap opened: a second tap on it, or a tap on the tooltip, selects it
let pickAt = 0; // when the pick-mode label last moved

async function main() {
  try {
    [meta, catalog, custom, sitemap] = await Promise.all([fetch("data/map.json").then((r) => r.json()), SiteCatalog.load("data", { horizons: false }),
      fetch("data/custom/custom.json").then((r) => r.json()), fetch("data/sitemap/site_map.json").then((r) => r.json()).catch(() => null)]);
    if (sitemap) sitemap.lut = sitemap.viridis.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    await Promise.all(Object.entries(meta.layers).map(([k, file]) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve((images[k] = img));
      img.onerror = reject;
      img.src = `data/${file}`;
    })));
  } catch (error) {
    $("site-list").textContent = `Could not load data/: ${error.message}. Start the local server (./start.sh in the packaged build, or "npm run serve" in web/ in the source repository) and open http://localhost:8000/map.html.`;
    return;
  }
  catalog.sites.forEach((s, i) => siteColor.set(s.id, SITE_COLORS[i % SITE_COLORS.length]));
  spotsXY = [...catalog.spots.values()].map((s) => ({ s, x: s.xM, y: s.yM }));
  missionsXY = [...catalog.missions.values()].map((m) => {
    const [x, y] = latLonToPolar(m.latitudeDeg, m.longitudeDeg);
    return { m, x, y, inside: Math.abs(x) <= meta.image.extentM.x1 && Math.abs(y) <= meta.image.extentM.y1 };
  });
  state = parseState(location.hash, DEFAULTS);
  allRows = siteRows(catalog);
  syncLayer();
  buildHelp();
  bindSites();
  bind();
  bindPlot();
  bindTabs();
  resetView(state.zoom, state.cx, state.cy);
  bindMine();
  renderSites();
  renderPlot();
  const [lat, lon] = [state.lat, state.lon].map((v) => (v === "" ? NaN : Number(v)));
  if (state.spot && catalog.spots.has(state.spot)) {
    const s = catalog.spots.get(state.spot);
    if (state.zoom !== 1 || state.cx !== 0 || state.cy !== 0) focused = s.site; // a link that carries its own view keeps it
    selectSpot(s);
  }
  else if (state.landing && catalog.missions.has(state.landing)) selectMission(catalog.missions.get(state.landing));
  else if (Number.isFinite(lat) && Number.isFinite(lon)) {
    plotFields.lat = lat.toFixed(4);
    plotFields.lon = lon.toFixed(4);
    setTab("point");
    const result = checkInput(plotFields.lat, plotFields.lon, geometry());
    if (result.ok) acceptPoint(result); else reject(result);
  }
  draw();
  ready = true;
}

function canvasSize() {
  const r = $("map").getBoundingClientRect();
  return [r.width, r.height];
}

// The map fits the shorter side of the canvas at zoom 1.
const fitPx = () => Math.min(...canvasSize());

function resetView(zoom = 1, cx = 0, cy = 0) {
  view = { scale: FIT_M / fitPx() / zoom, cx, cy };
}

const viewFor = (zoom = 1, cx = 0, cy = 0) => ({ scale: FIT_M / fitPx() / zoom, cx, cy });

function cancelAnim() {
  if (anim) cancelAnimationFrame(anim);
  anim = null;
}

// Move to a view, over `ms` milliseconds (at once if the page has not settled, or the visitor prefers less motion).
function animateTo(target, ms = FOCUS_MS) {
  cancelAnim();
  if (!ready || ms <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) { view = { ...target }; draw(); return; }
  const from = { ...view }, t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    view = easeView(from, target, t);
    anim = t < 1 ? requestAnimationFrame(step) : null;
    draw();
  };
  anim = requestAnimationFrame(step);
}

const tileContaining = (x, y) => meta.tiles.filter((t) => inBox(x, y, t))
  .sort((a, b) => Math.hypot(x - (a.x0M + a.x1M) / 2, y - (a.y0M + a.y1M) / 2) - Math.hypot(x - (b.x0M + b.x1M) / 2, y - (b.y0M + b.y1M) / 2))[0] ?? null;

// Fit a site's box. The view the visitor had is kept in `home`, so that leaving the site goes back to it.
function focusSite(id) {
  const tile = meta.tiles.find((t) => t.id === id);
  if (!tile || focused === id) return;
  if (!home && !focused) home = { ...view };
  focused = id;
  const [w, h] = canvasSize();
  animateTo(fitBox(tile, w, h, 1.25));
}

// End the zoom to a site: back to the view before it.
function leaveFocus() {
  if (!focused && !home) return;
  const back = home;
  home = null;
  focused = "";
  if (back) animateTo(back);
}

const toScreen = (x, y) => {
  const [w, h] = canvasSize();
  return [w / 2 + (x - view.cx) / view.scale, h / 2 - (y - view.cy) / view.scale];
};
const toMap = (sx, sy) => {
  const [w, h] = canvasSize();
  return [view.cx + (sx - w / 2) * view.scale, view.cy - (sy - h / 2) * view.scale];
};

function draw() {
  const canvas = $("map");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const { x0, x1, y0, y1 } = meta.image.extentM;
  const [ax, ay] = toScreen(x0, y1);
  const [bx, by] = toScreen(x1, y0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(images[state.layer], ax, ay, bx - ax, by - ay);
  drawCloseups(ctx, width, height);

  // Latitude circles and the pole.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  const [px, py] = toScreen(0, 0);
  for (const lat of [-89, -88, -87, -86, -85, -84, -82, -80]) {
    ctx.beginPath();
    ctx.arc(px, py, latitudeRadius(lat) / view.scale, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillText(`${-lat}°S`, px + 3, py - latitudeRadius(lat) / view.scale - 3);
  }
  for (const [lon, label] of [[0, "0°"], [90, "90°E"], [180, "180°"], [270, "90°W"]]) {
    const [ex, ey] = toScreen(...latLonToPolar(-85, lon));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillText(label, ex + 4, ey + 4);
  }
  ctx.fillText("South pole", px + 5, py + 14);

  // Where NASA's illumination data ends (85°S, a 300 km square): outside it the picture is terrain only.
  const [dx0, dy1] = toScreen(meta.extentM.x0, meta.extentM.y1);
  const [dx1, dy0] = toScreen(meta.extentM.x1, meta.extentM.y0);
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.strokeRect(dx0, dy1, dx1 - dx0, dy0 - dy1);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("NASA illumination data ends here", dx0 + 6, dy1 + 14);
  ctx.restore();

  // NASA candidate-site tiles.
  ctx.setLineDash([4, 3]);
  const labelBoxes = []; // drawn label boxes: a label that would overlap one is left for a closer zoom
  const siteLabels = [];
  for (const t of meta.tiles) {
    const [tx0, ty1] = toScreen(t.x0M, t.y1M);
    const [tx1, ty0] = toScreen(t.x1M, t.y0M);
    const on = t.id === activeSite || t.id === hoverSite;
    ctx.strokeStyle = siteColor.get(t.id) || "#fff";
    ctx.lineWidth = on ? 2.5 : 1;
    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(tx0, ty1, tx1 - tx0, ty0 - ty1);
      ctx.restore();
    }
    ctx.strokeRect(tx0, ty1, tx1 - tx0, ty0 - ty1);
    siteLabels.push({ t, on, x: tx0 + 2, y: ty1 - 4 });
  }
  // One label per site, the coloured one above its box; the open site first, and a label that would collide is hidden until the zoom gives it room.
  for (const { t, on, x: x0, y } of siteLabels.sort((a, b) => Number(b.on) - Number(a.on))) {
    ctx.font = `${on ? "bold " : ""}11px system-ui, sans-serif`;
    const x = Math.max(4, Math.min(x0, width - ctx.measureText(t.name).width - 4)); // kept inside the canvas
    const box = [x, y - 11, x + ctx.measureText(t.name).width, y + 3];
    if (!on && labelBoxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
    labelBoxes.push(box);
    ctx.fillStyle = siteColor.get(t.id) || "#fff";
    ctx.fillText(t.name, x, y);
  }
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  // Where a custom point can be traced: the usable area of each site (its box less the 2 km margin), shown while picking.
  if (placing) {
    const tone = getComputedStyle(document.documentElement).getPropertyValue("--accent-line").trim() || "#e3a33b";
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = tone;
    for (const t of custom.sites) {
      const i = t.interior;
      const [a, b] = toScreen(i.xMinM, i.yMaxM);
      const [c, d] = toScreen(i.xMaxM, i.yMinM);
      ctx.fillRect(a, b, c - a, d - b);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.5;
    for (const t of custom.sites) {
      const i = t.interior;
      const [a, b] = toScreen(i.xMinM, i.yMaxM);
      const [c, d] = toScreen(i.xMaxM, i.yMinM);
      ctx.strokeRect(a, b, c - a, d - b);
    }
    ctx.restore();
  }
  const here = currentMineId();
  const named = []; // label boxes drawn so far: a label that would overlap one waits for a closer zoom (unless its spot is hovered or open)
  for (const m of [...mine].sort((a, b) => (a.id === here || a.id === hover) - (b.id === here || b.id === hover))) { // saved spots; the open one is drawn last, on top: cyan diamonds with their name; a white ring when hovered or open
    const p = mineLatLon(m.id);
    const [qx, qy] = toScreen(...latLonToPolar(p.latitudeDeg, p.longitudeDeg));
    const on = m.id === hover || m.id === here;
    const diamond = (r) => { ctx.beginPath(); ctx.moveTo(qx, qy - r); ctx.lineTo(qx + r, qy); ctx.lineTo(qx, qy + r); ctx.lineTo(qx - r, qy); ctx.closePath(); };
    if (on) { diamond(14); ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    diamond(on ? 9 : 7);
    ctx.fillStyle = "#7fd3e6"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.font = `${on ? "bold " : ""}12px system-ui, sans-serif`;
    const box = [qx + 12, qy - 8, qx + 16 + ctx.measureText(m.name).width, qy + 8];
    if (on || !named.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) {
      named.push(box);
      ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(m.name, qx + 14, qy + 4);
      ctx.fillStyle = "#fff"; ctx.fillText(m.name, qx + 14, qy + 4);
    }
    ctx.font = "11px system-ui, sans-serif";
  }
  // NASA Artemis candidate regions with a published outline.
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "italic 11px system-ui, sans-serif";
  const siteNames = new Set(meta.tiles.map((t) => t.name.toLowerCase()));
  const labels = labelBoxes;
  for (const r of catalog.artemisRegions) {
    if (!r.outlineXyM) continue;
    ctx.beginPath();
    for (const [x, y] of r.outlineXyM) ctx.lineTo(...toScreen(x, y));
    ctx.closePath();
    ctx.stroke();
    const [lx, ly] = toScreen(Math.min(...r.outlineXyM.map((p) => p[0])), Math.min(...r.outlineXyM.map((p) => p[1])));
    if (siteNames.has(r.name.toLowerCase())) continue; // the site's own label already names it
    const tx = Math.max(4, Math.min(lx + 2, width - ctx.measureText(r.name).width - 4)); // kept inside the canvas
    const box = [tx, ly + 2, tx + ctx.measureText(r.name).width, ly + 15];
    if (labels.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
    labels.push(box);
    ctx.fillText(r.name, tx, ly + 13);
  }
  ctx.font = "11px system-ui, sans-serif";

  // Candidate spots.
  for (const { s, x, y } of spotsXY) {
    const [sx, sy] = toScreen(x, y);
    const selected = s.id === state.spot;
    ctx.globalAlpha = !activeSite || s.site === activeSite ? 1 : 0.35; // other sites step back
    if (s.id === hover || selected) {
      ctx.beginPath();
      ctx.arc(sx, sy, selected ? 13 : 10, 0, 2 * Math.PI);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (selected) { // a dark ring outside the white one, so it shows on bright and dark ground
        ctx.beginPath();
        ctx.arc(sx, sy, 15, 0, 2 * Math.PI);
        ctx.strokeStyle = "#000";
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(sx, sy, selected ? 7 : 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = siteColor.get(s.site);
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    if (selected) {
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000";
      ctx.strokeText(s.id, sx + 19, sy + 4);
      ctx.fillStyle = "#fff";
      ctx.fillText(s.id, sx + 19, sy + 4);
      ctx.font = "11px system-ui, sans-serif";
    }
    ctx.globalAlpha = 1;
  }

  // CLPS landings inside the map.
  for (const { m, x, y, inside } of missionsXY) {
    if (!inside) continue;
    const [sx, sy] = toScreen(x, y);
    if (m.id === hover || m.id === selectedMission) {
      ctx.beginPath();
      ctx.arc(sx, sy, 15, 0, 2 * Math.PI);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    star(ctx, sx, sy, m.id === hover || m.id === selectedMission ? 12 : 9);
    ctx.fillStyle = "#fff";
    ctx.fillText(m.name, sx + 11, sy + 4);
  }
  // The point the visitor is working with, drawn last, over the dots: an orange target "Your point" (a saved spot is the cyan diamond above),
  // or, for a point that cannot be traced, a hollow grey ring "Not traceable".
  const canvasEl = $("map");
  const marks = [];
  if (customPoint && !markerHidden && !mine.some((m) => m.id === here)) {
    const [qx, qy] = toScreen(customPoint.x, customPoint.y);
    const tone = getComputedStyle(document.documentElement).getPropertyValue("--accent-line").trim() || "#e3a33b";
    ctx.beginPath(); ctx.arc(qx, qy, 11, 0, 2 * Math.PI); ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke(); // a thin white ring outside the halo, so the marker stands apart from site dots of a similar colour
    ctx.beginPath(); ctx.arc(qx, qy, 10, 0, 2 * Math.PI); ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.stroke(); // the dark halo, outside the ring
    ctx.beginPath(); ctx.arc(qx, qy, 8, 0, 2 * Math.PI); ctx.stroke(); // and inside it
    ctx.beginPath(); ctx.arc(qx, qy, 9, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = tone; ctx.stroke(); // the ring, 18 px across
    ctx.beginPath(); ctx.moveTo(qx - 4, qy); ctx.lineTo(qx + 4, qy); ctx.moveTo(qx, qy - 4); ctx.lineTo(qx, qy + 4); ctx.lineWidth = 1.5; ctx.stroke(); // the small cross
    drawMarkerLabel(ctx, "Your point", qx + 15, qy + 4);
    marks.push("point");
  }
  if (rejectedPoint) {
    const [qx, qy] = toScreen(rejectedPoint.x, rejectedPoint.y);
    ctx.beginPath(); ctx.arc(qx, qy, 9, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#c2c7d0"; ctx.stroke();
    drawMarkerLabel(ctx, "Not traceable", qx + 15, qy + 4, "#c2c7d0");
    marks.push("rejected");
  }
  canvasEl.dataset.marker = marks.join(" ");
  canvasEl.dataset.hover = hover; // what the list row or the pointer is on, for the tests
  canvasEl.dataset.hoverSite = hoverSite;

  if (!anim) history.replaceState(null, "", serializeState({ ...state, zoom: +(zoomLevel().toFixed(2)), cx: Math.round(view.cx), cy: Math.round(view.cy) }));
  drawLegend();
}

function drawMarkerLabel(ctx, text, x, y, fill = "#fff") {
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.font = "11px system-ui, sans-serif";
}

// ---- site close-ups: NASA's native 60 m values over a 20 m hillshade, fetched when a site is zoomed to
function drawCloseups(ctx, width, height) {
  if (!sitemap || view.scale > CLOSEUP_BELOW) return;
  let shown = false;
  ctx.imageSmoothingEnabled = false;
  for (const s of sitemap.sites) {
    const [x0, y1] = toScreen(s.box.x0M, s.box.y1M);
    const [x1, y0] = toScreen(s.box.x1M, s.box.y0M);
    if (x1 < 0 || x0 > width || y0 < 0 || y1 > height) continue;
    const cu = closeups.get(s.id);
    if (!cu) loadCloseup(s);
    else if (typeof cu !== "string") { ctx.drawImage(cu[state.layer], x0, y1, x1 - x0, y0 - y1); shown = true; }
  }
}

async function loadCloseup(s) {
  closeups.set(s.id, "loading");
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = `data/sitemap/${s.shade.file}`; });
    const response = await fetch(`data/sitemap/${s.values.file}`);
    if (!response.ok) throw new Error(response.status);
    const values = new Uint8Array(await response.arrayBuffer());
    closeups.set(s.id, { sun: paintCloseup(s, image, values, 0), earth: paintCloseup(s, image, values, 1) });
  } catch {
    closeups.set(s.id, "error");
  }
  draw();
}

// The hillshade of the site coloured by NASA's 60 m value under each of its 20 m pixels, the way export_map.py colours the overview.
function paintCloseup(s, image, values, k) {
  const { cols, rows, pixelM } = s.shade, v = s.values, lut = sitemap.lut;
  const canvas = Object.assign(document.createElement("canvas"), { width: cols, height: rows });
  const g2 = canvas.getContext("2d");
  g2.drawImage(image, 0, 0);
  const pixels = g2.getImageData(0, 0, cols, rows), d = pixels.data;
  for (let i = 0; i < rows; i++) {
    const vr = Math.floor((v.y1M - (s.box.y1M - (i + 0.5) * pixelM)) / v.pixelM);
    for (let j = 0; j < cols; j++) {
      const o = (i * cols + j) * 4, shade = d[o] / 255;
      const vc = Math.floor((s.box.x0M + (j + 0.5) * pixelM - v.x0M) / v.pixelM);
      const value = vr >= 0 && vr < v.rows && vc >= 0 && vc < v.cols ? values[(vr * v.cols + vc) * 2 + k] : sitemap.values.noData;
      if (value === sitemap.values.noData) { d[o] = d[o + 1] = d[o + 2] = (0.5 * shade + 0.1) * 255; continue; }
      const color = lut[Math.round((Math.min(value, 100) / 100) * 255)], f = 0.55 + 0.45 * shade;
      d[o] = color[0] * f; d[o + 1] = color[1] * f; d[o + 2] = color[2] * f;
    }
  }
  g2.putImageData(pixels, 0, 0);
  return canvas;
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = "#ffd700";
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawLegend() {
  const stops = meta.legend.map(([v, c]) => `${c} ${v * 100}%`).join(", ");
  const what = state.layer === "sun" ? "Sun" : "Earth";
  $("legend").innerHTML = `<span>${what} 0%</span><span class="bar" style="background: linear-gradient(to right, ${stops})"></span><span>100%</span>`;
}

// The layer switch: the buttons say which layer is shown.
function syncLayer() {
  $("layer-sun").setAttribute("aria-pressed", String(state.layer === "sun"));
  $("layer-earth").setAttribute("aria-pressed", String(state.layer === "earth"));
}

function zoomLevel() {
  return FIT_M / fitPx() / view.scale;
}

function zoomAt(factor, sx, sy) {
  const [mx, my] = toMap(sx, sy);
  cancelAnim();
  const newZoom = Math.min(Math.max(zoomLevel() * factor, MIN_ZOOM), MAX_ZOOM);
  view.scale = FIT_M / fitPx() / newZoom;
  const [nx, ny] = toMap(sx, sy);
  view.cx += mx - nx;
  view.cy += my - ny;
  draw();
}

function bind() {
  const canvas = $("map");
  // Esc: deselect and go back to the view before the zoom to a site (not while typing in a field).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (document.activeElement?.classList.contains("hint") || document.querySelector(".hint.is-open") || document.querySelector("dialog[open]"))) return; // Esc closes a tooltip or the Help first
    if (e.key === "Escape" && placing) { endPicking(); return; }
    if (e.key !== "Escape" || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")) return;
    if (!(state.spot || state.landing || focused || activeSite)) return;
    clearSelection();
  });
  let drag = null;
  const touches = new Map(); // pointers down now, for a two-finger pinch
  let pinch = null; // { d: the finger distance last seen }
  let pinched = 0; // when two fingers last moved the map: lifting them is not a tap
  const spread = () => { const [a, b] = [...touches.values()]; return [Math.hypot(a.x - b.x, a.y - b.y), (a.x + b.x) / 2, (a.y + b.y) / 2]; };
  canvas.addEventListener("pointerdown", (e) => {
    cancelAnim();
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = { d: spread()[0] }; pinched = performance.now(); drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const [d, mx, my] = spread();
      const r = canvas.getBoundingClientRect();
      if (pinch.d > 0) zoomAt(d / pinch.d, mx - r.left, my - r.top);
      pinch.d = d;
      pinched = performance.now();
      return;
    }
    if (!drag) { hoverAt(e); return; }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    view.cx = drag.cx - dx * view.scale;
    view.cy = drag.cy + dy * view.scale;
    draw();
  });
  const release = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerup", (e) => {
    release(e);
    const wasDrag = drag?.moved || performance.now() - pinched < 400;
    drag = null;
    if (!wasDrag) click(e);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("zoom-in").addEventListener("click", () => { const [w, h] = canvasSize(); zoomAt(1.5, w / 2, h / 2); });
  $("zoom-out").addEventListener("click", () => { const [w, h] = canvasSize(); zoomAt(1 / 1.5, w / 2, h / 2); });
  $("reset").addEventListener("click", () => { home = null; focused = ""; animateTo(viewFor()); });
  for (const [id, layer] of [["layer-sun", "sun"], ["layer-earth", "earth"]]) $(id).addEventListener("click", () => { state.layer = layer; syncLayer(); draw(); });
  window.addEventListener("resize", () => { const z = zoomLevel(); resetView(z, view.cx, view.cy); draw(); });
  onThemeChange(draw);
}

// The spot or CLPS star nearest to a point on the canvas (within HIT_PX), or null.
function hitAt(sx, sy) {
  let nearest = null;
  const consider = (kind, item, x, y) => {
    const [px, py] = toScreen(x, y);
    const d = Math.hypot(px - sx, py - sy);
    if (d < HIT_PX && (!nearest || d < nearest.d)) nearest = { kind, item, d, px, py };
  };
  for (const p of spotsXY) consider("spot", p.s, p.x, p.y);
  for (const p of missionsXY) if (p.inside) consider("mission", p.m, p.x, p.y);
  for (const m of mine) { const q = mineLatLon(m.id); consider("mine", m, ...latLonToPolar(q.latitudeDeg, q.longitudeDeg)); }
  return nearest;
}

function setHover(id) {
  if (id === hover) return;
  hover = id;
  if (!id) $("map-tip").hidden = true;
  for (const li of $("panel-mine").querySelectorAll("li[data-id]")) li.classList.toggle("is-hover", li.dataset.id === id);
  for (const b of $("site-list").querySelectorAll(".s-spot")) b.classList.toggle("is-hover", b.dataset.id === id);
  for (const b of $("lander-list").querySelectorAll(".s-lander")) b.classList.toggle("is-hover", b.dataset.id === id);
  draw();
}

// A compact summary next to a dot or star: a spot's yearly numbers or a landing's facts.
function showTip(hit) {
  const tip = $("map-tip");
  if (hit.kind === "spot") {
    const s = hit.item;
    const y = catalog.yearMetrics(s, catalog.defaultYear);
    tip.innerHTML = `<b>${s.id}</b>${s.siteName}<br>Sun ${pct(y.sunlitFraction)} · Earth ${pct(y.earthFraction)} · ${catalog.defaultYear}<br>Longest night ${formatDuration(y.longestDarkHours)}<br>Slope ${s.slopeDeg.toFixed(1)}°`;
  } else if (hit.kind === "mine") {
    const q = mineLatLon(hit.item.id);
    tip.innerHTML = `<b>${hit.item.name}</b>Saved spot · ${Math.abs(q.latitudeDeg).toFixed(4)}°S ${q.longitudeDeg.toFixed(4)}°E<br>Click to open it and its links<br>Terrain: approximate (a 20 m copy of NASA's 5 m map)`;
  } else {
    const m = hit.item;
    tip.innerHTML = `<b>${m.name}</b>${m.operator} · landed ${m.landedUtc.slice(0, 10)}<br>Ended ${m.ended}`;
  }
  tip.hidden = false;
  const w = $("map").clientWidth;
  const h = $("map").clientHeight;
  tip.style.left = `${Math.max(0, Math.min(hit.px + 14, w - tip.offsetWidth))}px`;
  tip.style.top = `${hit.py + 14 + tip.offsetHeight > h ? Math.max(0, hit.py - tip.offsetHeight - 10) : hit.py + 14}px`;
  setHover(hit.item.id);
}

function hoverAt(e) {
  const r = $("map").getBoundingClientRect();
  if (placing) { pickHint(e.clientX - r.left, e.clientY - r.top); return; }
  const hit = hitAt(e.clientX - r.left, e.clientY - r.top);
  $("map").style.cursor = hit ? "pointer" : "";
  $("map-tip").classList.remove("touch");
  if (!hit) { setHover(""); return; }
  showTip(hit);
}

// The tooltip of a spot, star or saved spot by id (a list row with the keyboard focus).
function tipFor(id) {
  let hit = null;
  const spot = spotsXY.find((p) => p.s.id === id);
  const mission = missionsXY.find((p) => p.m.id === id);
  const saved = mine.find((m) => m.id === id);
  if (spot) hit = { kind: "spot", item: spot.s, xy: [spot.x, spot.y] };
  else if (mission?.inside) hit = { kind: "mission", item: mission.m, xy: [mission.x, mission.y] };
  else if (saved) { const q = mineLatLon(id); hit = { kind: "mine", item: saved, xy: latLonToPolar(q.latitudeDeg, q.longitudeDeg) }; }
  if (!hit) return;
  const [px, py] = toScreen(...hit.xy);
  $("map-tip").classList.remove("touch");
  showTip({ ...hit, px, py });
}

function selectById(id) {
  touchTip = "";
  $("map-tip").hidden = true;
  if (catalog.spots.has(id)) selectSpot(catalog.spots.get(id));
  else if (catalog.missions.has(id)) selectMission(catalog.missions.get(id));
  else openMine(id);
}

function click(e) {
  const r = $("map").getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  if (placing) return pickPoint(...toMap(sx, sy));
  const hit = hitAt(sx, sy);
  if (e.pointerType === "touch") { // a first tap on a dot shows its tooltip; a second tap on it (or on the tooltip) selects it
    if (hit && hit.item.id !== touchTip) { touchTip = hit.item.id; $("map-tip").classList.add("touch"); showTip(hit); return; }
    if (!hit) { touchTip = ""; setHover(""); }
  }
  if (hit?.kind === "spot") return selectSpot(hit.item);
  if (hit?.kind === "mission") return selectMission(hit.item);
  if (hit?.kind === "mine") return openMine(hit.item.id);
  const tile = tileContaining(...toMap(sx, sy));
  if (tile) return selectSite(tile.id); // empty ground inside a site box: the site, not the whole pole
  clearSelection();
}

// Select a landing without moving the view; if it is out of view, zoom out just far enough to show it.
function reveal(x, y) {
  const [sx, sy] = toScreen(x, y);
  const [w, h] = canvasSize();
  if (sx > 24 && sx < w - 24 && sy > 24 && sy < h - 24) return;
  const half = 1.45 * Math.max(Math.abs(x), Math.abs(y), 1);
  if (!home) home = { ...view };
  animateTo(viewFor(Math.max(Math.min(zoomLevel(), FIT_M / 2 / half), MIN_ZOOM)));
}

// A spot: fit its site if the view is not on that site; within the site the view stays (it pans only if the spot is off-screen).
function focusSpot(s) {
  if (focused !== s.site) { focusSite(s.site); return; }
  const [sx, sy] = toScreen(s.xM, s.yM);
  const [w, h] = canvasSize();
  if (sx < 24 || sx > w - 24 || sy < 24 || sy > h - 24) animateTo({ ...view, cx: s.xM, cy: s.yM });
}

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const GLOBE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.4 7 H12.6 M7 1.2 C4.9 3.2 4.9 10.8 7 12.8 M7 1.2 C9.1 3.2 9.1 10.8 7 12.8" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const CHEVRON = { open: '<svg class="s-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3 L5 7 L8.5 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>', closed: '<svg class="s-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' };
const STAR = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.8 L7.5 4.3 L11.2 4.6 L8.4 7 L9.3 10.7 L6 8.7 L2.7 10.7 L3.6 7 L0.8 4.6 L4.5 4.3 Z" fill="currentColor"/></svg>';
const TARGET = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 6.5 V15.5 M6.5 11 H15.5" stroke="currentColor" stroke-width="1.6"/></svg>';

// Put the keyboard focus back on the element a redraw replaced.
function keepFocus(root, render, selectorOf) {
  const active = document.activeElement;
  const inside = root.contains(active) ? active : null;
  const selector = inside ? selectorOf(inside) : null;
  const caret = inside && "selectionStart" in inside ? [inside.selectionStart, inside.selectionEnd] : null;
  render();
  const again = selector ? root.querySelector(selector) : null;
  if (again && again !== document.activeElement) {
    again.focus({ preventScroll: true });
    if (caret && again.setSelectionRange) try { again.setSelectionRange(...caret); } catch { /* not a text field */ }
  }
}

// ---- The Sites tab: search, sort, the sites with their best values, their spots, and the flown landers.
const focusSelector = (el) => (el.id ? `#${el.id}` : el.dataset.id ? `[data-id="${el.dataset.id}"]` : el.dataset.site ? `.s-row[data-site="${el.dataset.site}"]` : null);

function renderSites() {
  keepFocus($("panel-sites"), () => {
    const found = filterSites(sortSites(allRows, sortBy), query);
    $("sites-count").textContent = countText(found.rows.length, allRows.length, query, found.spots);
    $("no-results").hidden = found.rows.length > 0;
    $("no-results").textContent = noMatchText(query);
    $("site-list").innerHTML = found.rows.map(({ row, spots }) => {
      const open = openSites.has(row.id);
      const spotItems = open ? `<ul class="s-spots">${spots.map((id) => {
        const y = catalog.yearMetrics(catalog.spots.get(id), catalog.defaultYear);
        return `<li><button type="button" class="s-spot" data-id="${id}" aria-pressed="${state.spot === id}"><span class="id">${id}</span><span class="sun"><i><b style="width:${(y.sunlitFraction * 100).toFixed(0)}%"></b></i>${pct(y.sunlitFraction)}</span><span class="earth">${GLOBE}${pct(y.earthFraction)}</span></button></li>`;
      }).join("")}</ul>` : "";
      return `<li><button type="button" class="s-row" data-site="${row.id}" aria-expanded="${open}">${open ? CHEVRON.open : CHEVRON.closed}<span class="s-dot" style="background:${siteColor.get(row.id)}"></span><span class="s-name"><b>${esc(row.name)}</b><small>${row.count} candidate spots · ${latitudeText(row.latitudeDeg)}</small></span><span class="s-sun"><span class="s-bar"><i style="width:${(row.bestSun * 100).toFixed(0)}%"></i></span>${pct(row.bestSun)}</span><span class="s-earth">${GLOBE}${pct(row.bestEarth)}</span></button>${spotItems}</li>`;
    }).join("");
    $("lander-list").innerHTML = [...catalog.missions.values()].map((m) => `<li><button type="button" class="s-lander" data-id="${m.id}" aria-pressed="${selectedMission === m.id}">${STAR}<span class="grow">${esc(m.name)}</span><small>${m.landedUtc.slice(0, 10)}</small></button></li>`).join("");
  }, focusSelector);
}

// The sites a search leaves are open; clearing it leaves open only the site of the selection.
function setQuery(text) {
  query = text;
  openSites.clear();
  if (query.trim()) for (const { row } of filterSites(allRows, query).rows) openSites.add(row.id);
  else if (activeSite) openSites.add(activeSite);
  renderSites();
}

function toggleSite(id) {
  const wasOpen = openSites.has(id);
  if (wasOpen) { openSites.delete(id); if (activeSite === id) { activeSite = ""; leaveFocus(); } }
  else {
    if (!query.trim()) openSites.clear(); // without a search one site is open at a time, so the list fits its panel
    openSites.add(id);
    if (state.spot && catalog.spots.get(state.spot).site !== id) deselectSpot(false);
    if (selectedMission) { selectedMission = ""; state.landing = ""; renderBand(); }
    activeSite = id;
    focusSite(id); // opening a site zooms to it, closing it goes back
  }
  renderSites();
  draw();
}

function bindSites() {
  const panel = $("panel-sites");
  panel.addEventListener("click", (e) => {
    const row = e.target.closest(".s-row");
    const spot = e.target.closest(".s-spot");
    const lander = e.target.closest(".s-lander");
    if (!row && !spot && !lander) return;
    endPicking(); // opening a site or a spot from the list ends pick mode with no change
    if (row) toggleSite(row.dataset.site);
    else if (spot) (state.spot === spot.dataset.id ? deselectSpot : () => selectSpot(catalog.spots.get(spot.dataset.id)))();
    else selectMission(catalog.missions.get(lander.dataset.id));
  });
  const on = (e) => {
    const row = e.target.closest(".s-row");
    if (row) { if (hoverSite !== row.dataset.site) { hoverSite = row.dataset.site; draw(); } return; }
    const item = e.target.closest(".s-spot, .s-lander");
    setHover(item?.dataset.id ?? "");
  };
  panel.addEventListener("pointerover", on);
  panel.addEventListener("focusin", (e) => { on(e); const id = e.target.closest(".s-spot, .s-lander")?.dataset.id; if (id) tipFor(id); }); // the keyboard gets the tooltip the pointer gets
  panel.addEventListener("focusout", () => { $("map-tip").hidden = true; if (hoverSite) { hoverSite = ""; draw(); } });
  panel.addEventListener("pointerleave", () => { setHover(""); if (hoverSite) { hoverSite = ""; draw(); } });
  $("site-search").addEventListener("input", (e) => setQuery(e.target.value));
  for (const [id, by] of [["sort-sun", "sun"], ["sort-earth", "earth"], ["sort-name", "name"]]) {
    $(id).addEventListener("click", () => {
      sortBy = by;
      for (const [other, key] of [["sort-sun", "sun"], ["sort-earth", "earth"], ["sort-name", "name"]]) $(other).setAttribute("aria-pressed", String(key === by));
      renderSites();
    });
  }
}

// ---- The selected-spot band: under the map and the sidebar, only while a spot (or a landing) is selected.
const tipOf = (key) => (key === "night" ? NIGHT_HINT : FIGURES.find((f) => f.key === key).hint.replace("{year}", year()));
const hintButton = (label, text) => `<button type="button" class="hint" aria-label="About: ${esc(label)}" data-hint="${esc(text)}">ⓘ</button>`;
const BRACKETS = "<i aria-hidden=\"true\"></i>".repeat(4);

function renderBand() {
  const band = $("band");
  if (state.spot && catalog.spots.has(state.spot)) {
    const s = catalog.spots.get(state.spot);
    const site = catalog.sites.find((x) => x.id === s.site);
    const row = allRows.find((r) => r.id === s.site);
    const y = { year: catalog.defaultYear, ...catalog.yearMetrics(s, catalog.defaultYear) };
    const limit = catalog.darknessPresets.find((p) => p.id === "viper")?.hours ?? 50;
    const [where, ground] = spotLines(s);
    const tiles = bandTiles(y, sunSub(s.id, row)).map((t) => `<div class="band-tile">${BRACKETS}<span class="k">${t.label}${hintButton(t.label, tipOf(t.key))}</span><span class="v">${t.value}</span><span class="s${t.good ? " good" : ""}">${esc(t.sub)}</span></div>`).join("");
    const ring = s.ring.map((p) => catalog.ringMetrics(p, catalog.defaultYear).sunlitFraction);
    const sunByYear = catalog.years.map((yr) => catalog.yearMetrics(s, yr).sunlitFraction);
    const nightByYear = catalog.years.map((yr) => catalog.yearMetrics(s, yr).longestDarkHours);
    const roi = s.inNasaRoi === null ? "no outline for this site" : s.inNasaRoi ? "inside NASA's >70% region" : "outside NASA's >70% region";
    const artemis = artemisLabel(s.artemisRegions, catalog.artemisRegions);
    band.innerHTML = `
      <button type="button" class="band-x" id="band-x" aria-label="Clear the selected spot"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <div class="band-left">
        <p class="band-label">Selected spot</p>
        <h2>${s.id} <small>· ${esc(site.name)}</small></h2>
        <div class="band-lines"><span>${where}</span><span>${ground}</span></div>
        <p class="band-verdict">${verdict(y, limit)}</p>
        <p class="band-desc">${description(y, limit)}</p>
        <details class="why"><summary>Why is a bright spot not always a good spot? <span aria-hidden="true">↗</span></summary><p>The average says how often a spot is lit, not how long the longest night lasts or whether Earth is in view during it. A lander needs light and a link to Earth across a whole mission, so the longest stretch without either matters more than the average.</p></details>
        <details class="why"><summary>More figures</summary><dl class="band-facts">
          <dt>Region</dt><dd>${esc(site.name)}; ${roi}${artemis ? `; Artemis: ${esc(artemis)}` : ""}</dd>
          <dt>Sun within 100 m</dt><dd>${pct(Math.min(...ring, y.sunlitFraction))}–${pct(Math.max(...ring, y.sunlitFraction))}</dd>
          <dt>Sun, ${catalog.years[0]}–${catalog.years.at(-1)}</dt><dd>${pct(Math.min(...sunByYear))}–${pct(Math.max(...sunByYear))}</dd>
          <dt>Longest night, same years</dt><dd>${formatDuration(Math.min(...nightByYear))}–${formatDuration(Math.max(...nightByYear))}</dd>
          <dt>NASA average</dt><dd>Sun ${pct(s.nasaAvgSun)} · Earth ${pct(s.nasaAvgEarth)}</dd>
          <dt>Checks</dt><dd><a href="evidence.html">How accurate is this?</a> ${guideLinkHtml("method")}</dd>
        </dl></details>
      </div>
      <div class="band-tiles">${tiles}</div>
      <div class="band-actions">
        <a class="mp-btn" href="explorer.html#spot=${s.id}&mast=2&days=30&t=0">Explore this spot</a>
        <a class="mp-btn fill" href="planner.html#spot=${s.id}">Plan a landing here <span aria-hidden="true">→</span></a>
        <a class="link" href="sidebyside.html#sites=${site.spots.slice(0, 4).join(",")}">Compare all sites <span aria-hidden="true">→</span></a>
      </div>`;
    band.hidden = false;
  } else if (selectedMission && catalog.missions.has(selectedMission)) {
    const m = catalog.missions.get(selectedMission);
    const p = missionsXY.find((q) => q.m === m);
    band.innerHTML = `
      <button type="button" class="band-x" id="band-x" aria-label="Clear the selected spot"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <div class="band-left">
        <p class="band-label">Flown lander</p>
        <h2>${esc(m.name)}</h2>
        <div class="band-lines"><span>${esc(m.operator)} · ${Math.abs(m.latitudeDeg).toFixed(2)}°${m.latitudeDeg < 0 ? "S" : "N"} ${m.longitudeDeg.toFixed(2)}°E</span></div>
        <p class="band-desc">${esc(m.notes)}</p>
        ${p.inside ? "" : '<p class="band-desc">Too far from the pole for this map: see it in the Explorer.</p>'}
      </div>
      <dl class="band-facts"><dt>Landed</dt><dd>${m.landedUtc.slice(0, 10)}</dd><dt>Ended</dt><dd>${esc(m.ended)}</dd><dt>Source</dt><dd>${esc(m.source)}</dd></dl>
      <div class="band-actions"><a class="mp-btn" href="explorer.html#spot=${m.id}">Explore this lander</a></div>`;
    band.hidden = false;
  } else {
    band.hidden = true;
    band.innerHTML = "";
  }
  updateCue();
}

// The band sits under the map and the sidebar, out of sight on most screens: while it is open and below the window, a button says so and
// takes the visitor to it.
function updateCue() {
  const band = $("band");
  const cue = $("band-cue");
  const below = !band.hidden && band.getBoundingClientRect().top > window.innerHeight - 96;
  if (below) {
    const name = state.spot || (selectedMission && catalog.missions.get(selectedMission)?.name) || "";
    cue.innerHTML = `<span>${esc(name)} · details below</span><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 5 L7 10 L12 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
    cue.setAttribute("aria-label", `Show the details of ${name}, below the map`);
  }
  cue.hidden = !below;
}

function showBand() {
  const band = $("band");
  band.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  band.focus({ preventScroll: true });
}

function selectSpot(s) {
  markerHidden = true; // the plotted point steps aside until it is shown again
  state.spot = s.id;
  state.landing = state.lat = state.lon = "";
  selectedMission = "";
  activeSite = s.site;
  if (!query.trim()) openSites.clear();
  openSites.add(s.site);
  renderSites();
  $("site-list").querySelector(`.s-spot[data-id="${s.id}"]`)?.scrollIntoView({ block: "nearest" });
  renderBand();
  focusSpot(s);
  draw();
}

// The spot is deselected (× in the band, or its row clicked again); the site stays open and the view stays.
function deselectSpot(redraw = true) {
  state.spot = "";
  renderBand();
  if (redraw) { renderSites(); draw(); }
}

function selectMission(m) {
  markerHidden = true;
  state.spot = "";
  state.landing = m.id;
  state.lat = state.lon = "";
  selectedMission = m.id;
  activeSite = "";
  const p = missionsXY.find((q) => q.m === m);
  if (p.inside) { focused = ""; reveal(p.x, p.y); } else leaveFocus();
  renderSites();
  renderBand();
  draw();
}

// Click on the ground of a site box: select the site (no spot), and zoom to it.
function selectSite(id) {
  state.spot = state.landing = state.lat = state.lon = "";
  selectedMission = "";
  activeSite = id;
  if (!query.trim()) openSites.clear();
  openSites.add(id);
  renderSites();
  renderBand();
  focusSite(id);
  draw();
}

function clearSelection() {
  leaveFocus();
  state.spot = state.landing = state.lat = state.lon = "";
  selectedMission = "";
  activeSite = "";
  if (!query.trim()) openSites.clear();
  renderSites();
  renderBand();
  draw();
}


// ---- Tabs
const TABS = ["sites", "point", "mine"];
function setTab(name) {
  tab = name;
  for (const t of TABS) {
    const on = t === name;
    $(`tab-${t}`).setAttribute("aria-selected", String(on));
    $(`tab-${t}`).tabIndex = on ? 0 : -1;
    $(`panel-${t === "sites" ? "sites" : t}`).hidden = !on;
  }
}

function bindTabs() {
  for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => setTab(t));
  $("tab-sites").parentElement.addEventListener("keydown", (e) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
    $(`tab-${TABS[next]}`).focus();
  });
  $("band").addEventListener("click", (e) => { if (e.target.closest("#band-x")) { if (selectedMission) clearSelection(); else deselectSpot(); } });
  $("band").tabIndex = -1;
  $("band-cue").addEventListener("click", showBand);
  window.addEventListener("scroll", updateCue, { passive: true });
  window.addEventListener("resize", updateCue);
  $("help-open").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (e) => { if (e.target === $("help-dialog")) $("help-dialog").close(); });
}

// ---- Plot a point: place a point inside the usable area of one of the 13 sites (the box less a 2 km margin), then save it.
const geometry = () => ({ areas: custom.sites, tiles: meta.tiles });
const year = () => catalog.defaultYear;
const HELP = { lat: "e.g. −89.46", lon: "e.g. 222.6" };
const plotFields = { lat: "", lon: "" };
let coordsOpen = false; // the latitude and longitude fields are showing
let errorState = null; // the last rejection: { message, field, note, nearest }
let figuresState = { kind: "none", html: "" }; // the four figures of the placed point: loading, ready or failed
let nameDraft = null; // what the visitor typed in the Name field, until the point is saved

const coordText = (p) => `${coordinatesText(p.lat, p.lon)}${p.readAs ? ` ${p.readAs}` : ""}`;
const near = (m) => { const q = mineLatLon(m.id); return customPoint && Math.abs(q.latitudeDeg - customPoint.lat) <= 0.00005 + 1e-9 && Math.abs(q.longitudeDeg - customPoint.lon) <= 0.00005 + 1e-9; };

function fieldsHtml(button) {
  const bad = (name) => errorState?.field === name;
  const note = (name) => (bad(name) ? errorState.note : HELP[name]);
  const one = (name, label, id) => `<label>${label}<input id="${id}" inputmode="decimal" autocomplete="off" value="${esc(plotFields[name])}" aria-invalid="${bad(name)}" aria-describedby="${id}-help"><span id="${id}-help" class="c-note${bad(name) ? " is-error" : ""}">${note(name)}</span></label>`;
  return `<div class="coords-form"><div class="coords-grid">${one("lat", "Latitude (°)", "c-lat")}${one("lon", "Longitude (°E)", "c-lon")}</div><button type="button" id="c-show" class="mp-btn big">${button}</button></div>`;
}

function renderPlot() {
  keepFocus($("panel-point"), () => {
    const p = customPoint;
    const duplicate = p ? mine.find(near) : null;
    const step = (n, text) => `<p class="mp-step"><b>${n}</b>${text}</p>`;
    let html = `<div><h2 class="mp-h2">Plot and save your own point</h2><p class="mp-note">Anywhere inside a dashed site box, at least 2 km from its edge. Saved points work on every page.</p></div>${step(1, "Place a point")}`;
    if (!p) {
      html += `<button type="button" id="c-place" class="pick-btn" aria-pressed="${placing}"><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 0.8 V4 M8 12 V15.2 M0.8 8 H4 M12 8 H15.2" stroke="currentColor" stroke-width="1.4"/></svg><span id="c-place-text">${placing ? "Cancel picking" : "Pick on the map"}</span></button>
        <p class="pick-hint-note">Click inside a highlighted site box on the map. Zoom in for a more precise spot.</p>
        <button type="button" id="c-toggle" class="coords-toggle" aria-expanded="${coordsOpen}"><svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>Enter coordinates instead</button>${coordsOpen ? fieldsHtml("Show point") : ""}`;
    }
    if (errorState) {
      html += `<div id="c-bad" class="box err" role="alert"><p><span class="mark" aria-hidden="true">✗</span> ${esc(errorState.message)}</p>${errorState.nearest ? `<button type="button" class="link-btn" id="c-nearest">Nearest: ${esc(errorState.nearest.site.name)}, ${errorState.nearest.km} km away</button>` : ""}</div>`;
    }
    if (p) {
      html += `<div class="your-point"><div class="top">${TARGET}<div class="who"><b>${esc(p.site.name)}</b><button type="button" id="c-where" class="where" title="Show on map" aria-label="Show on map: ${esc(coordText(p))}">${esc(coordText(p))}</button></div></div>
        <div class="acts"><button type="button" id="c-move" class="mp-btn" aria-pressed="${placing}">${placing ? "Cancel move" : "Move"}</button><button type="button" id="c-edit" class="mp-btn">Edit coordinates</button><button type="button" id="c-clear" class="mp-btn">Clear</button></div></div>${coordsOpen ? fieldsHtml("Update point") : ""}`;
      html += step(2, "Save it");
      if (duplicate) html += `<div class="box saved" role="status"><span><span class="mark" aria-hidden="true">◆</span> Saved as <strong>${esc(duplicate.name)}</strong></span><button type="button" class="link-btn" id="view-mine">View My points</button></div>`;
      else if (mine.length >= MAX_MINE) html += `<p class="box full">My points is full (${MAX_MINE} of ${MAX_MINE}). Remove a point in My points to save another.</p>`;
      else html += `<div class="save-row"><label>Name<input id="c-name" maxlength="30" value="${esc(nameDraft ?? freeName(mine))}" autocomplete="off"></label><button type="button" id="save-mine" class="mp-btn fill big">Save to My points</button></div><p class="mp-note">${MAX_MINE - mine.length} of ${MAX_MINE} places left · kept in this browser</p>`;
      const id = customId(p.lat, p.lon);
      html += `<p class="mp-label">At this point</p><div id="c-figures" class="c-figures">${figuresState.html}</div>
        <div class="c-actions"><a class="mp-btn" href="explorer.html#spot=${id}&mast=2&days=30&t=0">Explore this point</a><a class="mp-btn" href="planner.html#spot=${id}">Plan a landing here <span aria-hidden="true">→</span></a></div>
        <details class="c-accuracy"><summary>How accurate are custom points?</summary><p>Terrain comes from a 20 m copy of NASA's 5 m map around the point and a 480 m map beyond. Checked against the 5 m results at ${custom.accuracy.spots} spots: the share of the year in sunlight is typically within ${custom.accuracy.sunShareMedianPp} points, and the longest night within an hour (worst case ${custom.accuracy.darkMaxH} h).</p></details>`;
    }
    $("panel-point").innerHTML = html;
  }, (el) => (el.id ? `#${el.id}` : null));
}

// The four figures: what is happening, or the tiles.
const figureTiles = (values) => FIGURES.map((f) => `<div class="tile"><span class="k">${f.label(year())}${hintButton(f.label(year()), tipOf(f.key))}</span><span class="v" data-fig="${f.key}">${values[f.key]}</span></div>`).join("");
function setFigures(kind, html) {
  figuresState = { kind, html };
  if ($("c-figures")) $("c-figures").innerHTML = html;
}

// The figures of the Explorer's year view for this point: the same engine, the default mast, the whole of the Map's year.
async function computeFigures(p) {
  const run = ++figuresRun;
  const id = customId(p.lat, p.lon);
  const stale = () => run !== figuresRun || customPoint !== p;
  setFigures("loading", '<p class="c-progress">Tracing the skyline…</p>');
  try {
    if (!(await ensureCustom(catalog, "data", id, () => {}))) throw new Error("the terrain of this point could not be traced");
    if (stale()) return;
    setFigures("loading", `<p class="c-progress">Computing ${year()}…</p>`);
    ephemeris ??= await Ephemeris.load("data");
    await new Promise((resolve) => setTimeout(resolve)); // let the message show before the computation holds the page
    if (stale()) return;
    const { site, horizon } = catalog.spot(id, catalog.defaultMastM);
    const et0 = parseUtc(`${year()}-01-01T00:00:00`);
    const et1 = Math.min(et0 + 365 * 86400, ephemeris.etMax - STEP_S);
    const s = summarize(timeSeries(ephemeris, site, horizon, et0, et1, STEP_S, { dsnRule: "disk" }), 0);
    setFigures("ready", figureTiles({ sun: pct(s.sunlitFraction), earth: pct(s.earthFraction), night: formatDuration(s.longestDarkHours), gap: formatDuration(s.longestDsnLinkGapHours) }));
  } catch {
    if (!stale()) setFigures("failed", '<p class="c-progress failed">Couldn\'t compute this point. Try again, or open it in the Explorer. <button type="button" id="c-retry" class="mp-btn">Retry</button></p>');
  }
}

function startPicking() {
  placing = true;
  clearErrors();
  syncPicking();
  draw();
}

function endPicking() {
  if (!placing) return;
  placing = false;
  pickSite = null;
  syncPicking();
  draw();
}

function syncPicking() {
  $("pick-banner").hidden = !placing;
  $("pick-banner").innerHTML = pickSite ? `<b>Now click to place your point in ${esc(pickSite.name)}</b> · Esc to cancel` : "<b>Click inside a highlighted area to place your point</b> · Esc to cancel";
  $("pick-hint").hidden = true;
  $("map-wrap").classList.toggle("is-picking", placing);
  $("map").style.cursor = placing ? "crosshair" : "";
  $("map-tip").hidden = true;
  renderPlot();
}

// While picking: the coordinates under the pointer and whether a point there can be traced.
function pickHint(sx, sy) {
  const now = performance.now();
  if (now - pickAt < PICK_HINT_MS) return;
  pickAt = now;
  const [x, y] = toMap(sx, sy);
  const result = checkXY(x, y, geometry());
  const [lat, lon] = polarToLatLon(x, y);
  const hint = $("pick-hint");
  hint.innerHTML = `${coordinatesText(lat, lon)}<br><span class="${result.ok ? "ok" : "no"}">${result.ok ? `Inside ${esc(result.site.name)}` : result.edge ? `Too close to the edge of ${esc(result.edge)}` : "Outside the traceable areas"}</span>`;
  hint.hidden = false;
  const w = $("map").clientWidth, h = $("map").clientHeight;
  hint.style.left = `${Math.max(0, Math.min(sx + 16, w - hint.offsetWidth))}px`;
  hint.style.top = `${sy + 18 + hint.offsetHeight > h ? Math.max(0, sy - hint.offsetHeight - 10) : sy + 18}px`;
}

// A click while picking: at the whole-pole view a first click in a box zooms to it; a click at close-up in a usable area places the point;
// anything else says why not and picking goes on.
function pickPoint(x, y) {
  const result = checkXY(x, y, geometry());
  if (view.scale > CLOSEUP_BELOW) {
    const tile = tileContaining(x, y);
    if (tile) { pickSite = tile; clearErrors(); syncPicking(); focusSite(tile.id); return; }
  }
  if (!result.ok) { reject(result); return; }
  endPicking();
  acceptPoint(result);
}

function clearErrors() {
  if (!errorState && !rejectedPoint) return;
  errorState = null;
  rejectedPoint = null;
  draw();
  renderPlot();
}

function reject(result) {
  errorState = result;
  rejectedPoint = result.x === undefined ? null : { x: result.x, y: result.y };
  if (result.field) coordsOpen = true; // the note under the field has to be seen
  if (rejectedPoint && !placing) { focused = ""; reveal(rejectedPoint.x, rejectedPoint.y); } // out of view: zoom out just far enough to show where it fell
  renderPlot();
  draw();
}

// The point is traceable: place it, zoom to its site, and compute its four figures.
function acceptPoint(result, { recentre = false } = {}) {
  coordsOpen = false;
  plotFields.lat = result.lat.toFixed(4);
  plotFields.lon = result.lon.toFixed(4);
  if (focused !== result.site.id) focusSite(result.site.id);
  else if (recentre) animateTo({ ...view, cx: result.x, cy: result.y });
  setCustomPoint(result.x, result.y, result.readAs);
}

function setCustomPoint(x, y, readAs = "") {
  const [lat, lon] = polarToLatLon(x, y);
  const site = custom.sites.find((s) => x >= s.interior.xMinM && x <= s.interior.xMaxM && y >= s.interior.yMinM && y <= s.interior.yMaxM) ?? null;
  rejectedPoint = null;
  errorState = null;
  markerHidden = false;
  nameDraft = null;
  customPoint = { lat, lon, x, y, site, readAs };
  state.spot = state.landing = "";
  state.lat = lat.toFixed(4);
  state.lon = lon.toFixed(4);
  selectedMission = "";
  activeSite = site?.id ?? "";
  plotFields.lat = state.lat;
  plotFields.lon = state.lon;
  endPicking();
  renderBand();
  renderSites();
  renderPlot();
  computeFigures(customPoint);
  markCurrent();
  draw();
}

// The plotted point goes away: its marker, its card and its figures.
function clearPoint() {
  endPicking();
  customPoint = null;
  rejectedPoint = null;
  errorState = null;
  markerHidden = false;
  coordsOpen = false;
  nameDraft = null;
  plotFields.lat = plotFields.lon = "";
  state.lat = state.lon = "";
  figuresRun++;
  figuresState = { kind: "none", html: "" };
  renderPlot();
  markCurrent();
  draw();
}

function showOnMap() {
  if (!customPoint) return;
  markerHidden = false;
  animateTo(viewFor(Math.max(zoomLevel(), 6), customPoint.x, customPoint.y));
  draw();
}

function submitFields() {
  endPicking();
  const result = checkInput(plotFields.lat, plotFields.lon, geometry());
  if (result.ok) acceptPoint(result, { recentre: true });
  else reject(result);
}

function bindPlot() {
  const panel = $("panel-point");
  panel.addEventListener("click", (e) => {
    const id = e.target.closest("button, a")?.id;
    if (!id) return;
    if (id === "c-place" || id === "c-move") placing ? endPicking() : startPicking();
    else if (id === "c-toggle") { coordsOpen = !coordsOpen; renderPlot(); if (coordsOpen) $("c-lat")?.focus(); }
    else if (id === "c-show") submitFields();
    else if (id === "c-edit") { coordsOpen = true; plotFields.lat = customPoint.lat.toFixed(4); plotFields.lon = customPoint.lon.toFixed(4); renderPlot(); $("c-lat")?.focus(); }
    else if (id === "c-clear") clearPoint();
    else if (id === "c-where") showOnMap();
    else if (id === "c-nearest") placeNearest();
    else if (id === "c-retry" && customPoint) computeFigures(customPoint);
    else if (id === "view-mine") setTab("mine");
    else if (id === "save-mine") savePoint();
  });
  panel.addEventListener("input", (e) => {
    if (e.target.id === "c-lat" || e.target.id === "c-lon") {
      plotFields[e.target.id === "c-lat" ? "lat" : "lon"] = e.target.value;
      clearErrors();
    } else if (e.target.id === "c-name") nameDraft = e.target.value;
  });
  panel.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.id === "c-lat" || e.target.id === "c-lon")) { e.preventDefault(); submitFields(); } });
}

// "Nearest: ..." places a valid point inside that box.
function placeNearest() {
  const near = errorState?.nearest;
  if (!near) return;
  const result = checkXY(near.x, near.y, geometry());
  if (!result.ok) return;
  endPicking();
  acceptPoint(result);
}

function savePoint() {
  if (!customPoint) return;
  addMine(customId(customPoint.lat, customPoint.lon), $("c-name")?.value ?? "");
  nameDraft = null;
  renderMine();
}

// ---- My points: up to five saved points, kept in this browser, usable on every page. A link may carry more (#mine=).
const tileAt = (x, y) => custom.sites.find((t) => x >= t.interior.xMinM && x <= t.interior.xMaxM && y >= t.interior.yMinM && y <= t.interior.yMaxM) ?? null;
const currentMineId = () => (customPoint ? customId(customPoint.lat, customPoint.lon) : "");
let removed = null; // the point just removed, for Undo
let removedTimer = null;

function mineRow(m) {
  const p = mineLatLon(m.id);
  const tile = tileAt(...latLonToPolar(p.latitudeDeg, p.longitudeDeg));
  const name = esc(m.name);
  return `<li data-id="${m.id}" class="${m.id === currentMineId() ? "is-current" : ""}">
    <div class="top"><span class="dia" aria-hidden="true">◆</span>
      <div class="who"><button type="button" class="mine-go" data-id="${m.id}" title="Show ${name} on the map">${name}</button><small>${Math.abs(p.latitudeDeg).toFixed(4)}°S ${p.longitudeDeg.toFixed(4)}°E${tile ? ` · ${esc(tile.name)}` : ""}</small></div>
      <button type="button" class="mine-edit" data-id="${m.id}" aria-label="Rename ${name}" title="Rename">✎</button>
      <button type="button" class="mine-del" data-id="${m.id}" aria-label="Remove ${name}" title="Remove ${name} from My points"><svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>
    <div class="mine-links"><a href="explorer.html#spot=${m.id}&mast=2&days=30&t=0" title="The Sun and Earth sky from ${name}">Explore</a><a href="planner.html#spot=${m.id}" title="When can a lander touch down at ${name}?">Plan a landing</a><a href="sidebyside.html#sites=${m.id}" title="${name} side by side with other spots">Compare</a></div>
  </li>`;
}

function renderMine(offer = []) {
  mine = loadMine();
  $("mine-count").textContent = `${mine.length}/${MAX_MINE}`;
  const fresh = offer.filter((o) => !mine.some((m) => m.id === o.id));
  const offerHtml = fresh.length ? `<p class="mine-note">This link carries ${fresh.length} point${fresh.length === 1 ? "" : "s"}: ${fresh.map((o) => esc(o.name)).join(", ")}. <button type="button" id="mine-take">Add ${fresh.length === 1 ? "it" : "them"}${fresh.length + mine.length > MAX_MINE ? ` (room for ${MAX_MINE - mine.length})` : ""}</button></p>` : "";
  const undoHtml = removed ? `<p class="mine-note">Removed ${esc(removed.name)}. <button type="button" id="mine-undo">Undo</button></p>` : "";
  $("panel-mine").innerHTML = `<div class="mine-head"><h2 class="mp-h2">My points</h2><span>${mine.length} of ${MAX_MINE} · kept in this browser</span></div>${offerHtml}${undoHtml}`
    + (mine.length
      ? `<ul class="mine-cards">${mine.map(mineRow).join("")}</ul><button type="button" id="mine-plot" class="mp-btn quiet" style="align-self:flex-start">Plot another point</button><button type="button" id="mine-share" class="mine-share" style="align-self:flex-start" title="A link that adds these points on another browser or for a colleague">Copy a link to my points</button>`
      : '<div class="mine-empty"><p>No saved points yet. Plot a point inside a site box and save it to use it on every page.</p><button type="button" id="mine-plot" class="mp-btn big" style="border-color:var(--accent-line);color:var(--accent)">Plot a point</button></div>');
  $("panel-mine").dataset.offer = JSON.stringify(fresh);
  renderPlot();
  draw();
}

// Mark the saved point that is open, in the list and on the map.
function markCurrent() {
  const id = currentMineId();
  for (const li of $("panel-mine").querySelectorAll("li[data-id]")) li.classList.toggle("is-current", li.dataset.id === id);
}

function openMine(id) {
  const p = mineLatLon(id);
  const [x, y] = latLonToPolar(p.latitudeDeg, p.longitudeDeg);
  const tile = tileContaining(x, y);
  if (tile) focusSite(tile.id); // close enough to tell neighbouring spots apart
  else animateTo(viewFor(Math.max(zoomLevel(), 6), x, y));
  setCustomPoint(x, y);
}

function startRename(li) {
  const m = mine.find((o) => o.id === li.dataset.id);
  const button = li.querySelector(".mine-go");
  const input = Object.assign(document.createElement("input"), { value: m.name, maxLength: 30 });
  input.className = "mine-rename";
  input.setAttribute("aria-label", `New name for ${m.name}`);
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    if (keep) renameMine(m.id, input.value);
    renderMine();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
  input.addEventListener("blur", () => finish(true));
}

function bindMine() {
  const traceable = (m) => { const p = mineLatLon(m.id); return Boolean(tileAt(...latLonToPolar(p.latitudeDeg, p.longitudeDeg))); };
  renderMine(readShareValue(new URLSearchParams(location.hash.slice(1)).get("mine")).filter(traceable)); // a link's point outside the traceable areas is not offered
  const panel = $("panel-mine");
  panel.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("mine-del")) {
      removed = mine.find((m) => m.id === b.dataset.id) ?? null;
      removeMine(b.dataset.id);
      clearTimeout(removedTimer);
      removedTimer = setTimeout(() => { removed = null; renderMine(); }, 8000);
      renderMine();
    } else if (b.id === "mine-undo") {
      if (removed) addMine(removed.id, removed.name);
      removed = null;
      clearTimeout(removedTimer);
      renderMine();
    } else if (b.classList.contains("mine-edit")) startRename(b.closest("li"));
    else if (b.classList.contains("mine-go")) openMine(b.dataset.id);
    else if (b.id === "mine-plot") {
      if (customPoint && mine.some(near)) clearPoint(); // a fresh start, not the point that is already saved
      setTab("point");
    } else if (b.id === "mine-take") {
      for (const o of JSON.parse(panel.dataset.offer || "[]")) addMine(o.id, o.name);
      renderMine();
    } else if (b.id === "mine-share") {
      const url = `${location.origin}${location.pathname}#${new URLSearchParams({ mine: shareValue(mine) })}`;
      const label = b.textContent;
      try { await navigator.clipboard.writeText(url); b.textContent = "Link copied"; } catch { b.textContent = "Copy failed: select the address from the address bar"; }
      setTimeout(() => { b.textContent = label; }, 2000);
    }
  });
  // A card lights its diamond on the map, and the diamond lights its card.
  for (const type of ["pointerover", "focusin"]) panel.addEventListener(type, (e) => setHover(e.target.closest("li[data-id]")?.dataset.id ?? ""));
  panel.addEventListener("focusin", (e) => { const id = e.target.closest("li[data-id]")?.dataset.id; if (id) tipFor(id); });
  panel.addEventListener("focusout", () => { $("map-tip").hidden = true; });
  panel.addEventListener("pointerleave", () => setHover(""));
}

// How to use the map: four short groups. The counts come from the catalogue and the rules from the code, so the text cannot drift from them.
function buildHelp() {
  const group = (title, items) => `<section><h3>${title}</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></section>`;
  $("map-help").innerHTML = [
    group("Reading the map", [
      "Brighter means more sunlight (or Earth in view) over NASA's 18.6-year average.",
      "NASA's illumination data stops at 85°S (the dotted square); beyond it you see terrain only.",
    ]),
    group("Sites and spots", [
      `Dashed boxes: the ${catalog.sites.length} NASA sites. Dots: their ${catalog.spots.size} candidate spots. Stars: CLPS landings.`,
      "White squares: NASA's Artemis candidate regions.",
      'Apollo, Chang\'e, Chandrayaan-3 and SLIM are on the <a href="moon.html">Whole Moon</a> page.',
    ]),
    group("Add your own point", [
      "In Plot a point, choose Pick on the map and click inside a highlighted area, or enter coordinates instead.",
      `Points need to be at least ${MARGIN_KM} km inside a box's edge. South latitudes are negative.`,
      `Choose Save to My points to keep up to ${MAX_MINE} points and use them on every page.`,
    ]),
    group("Moving around", [
      "Drag to pan, scroll or pinch to zoom, Reset to go back. Open a site to zoom to its close-up; Esc returns.",
    ]),
  ].join("");
}

main();

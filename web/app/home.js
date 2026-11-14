// Home: the terrain panorama at the Connecting Ridge with the Sun and Earth moving along one lunar month, 1-30 March 2027,
// the live status row under it, and the two counts under the headline, all computed from the catalogue and the engine.
// Nothing is typed in by hand.

import { Ephemeris, SiteCatalog, bodyState, etToUtcMs, timeSeries, utcMsToEt, STEP_S } from "../engine/index.js";
import { drawPanorama } from "./panorama.js";
import { panoramaRange } from "./format.js";
import { onThemeChange } from "./theme.js";
import { dotFilled, pillText, whenText, windowLabel } from "./home-model.js";

const $ = (id) => document.getElementById(id);
const SPOT = "Site01-1";

// Old Explorer links (index.html#spot=...) keep working.
if (/(^#|&)spot=/.test(location.hash)) location.replace(`explorer.html${location.hash}`);

let hero = null;

// Each pill is as wide as the longest text it can show: hidden copies of every wording sit in the same grid cell as the live
// text, so the widest one sets the width and the pill never changes size while the animation plays.
for (const box of document.querySelectorAll(".pill-text[data-body]")) {
  for (const fraction of [1, 0.99, 0.5, 0]) {
    const copy = document.createElement("span");
    copy.className = "sizer";
    copy.setAttribute("aria-hidden", "true");
    copy.textContent = pillText(box.dataset.body, fraction);
    box.append(copy);
  }
}

async function main() {
  let ephemeris;
  let catalog;
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
  } catch (error) {
    $("home-caption").textContent = `Could not load data/: ${error.message}. Start the local server (./start.sh in the packaged build, or "npm run serve" in web/ in the source repository) and open http://localhost:8000/.`;
    return;
  }
  $("home-count").textContent = `${catalog.spots.size} candidate spots · ${catalog.sites.length} NASA sites`;
  $("home-caption").textContent = `${windowLabel(WINDOW_START_MS, DAYS)}, animated.`;
  renderHero(ephemeris, catalog);
  const redraw = () => hero && draw();
  window.addEventListener("resize", redraw);
  onThemeChange(redraw);
}

const DAYS = 30;           // the length of the tracks and of one loop
// The animated window is fixed, not "the next 30 days": from 1 March 2027 the Sun goes behind the terrain and comes back and
// Earth rises and sets (the guide's Figure 1 and the Explorer example), so every visit shows the same instructive month.
const WINDOW_START_MS = Date.UTC(2027, 2, 1);
const LOOP_S = 15;         // seconds per loop: one lunar month
const MS_SAMPLE = 1000 * LOOP_S / ((DAYS * 86400) / STEP_S); // wall-clock ms per 15-minute sample
const play = { playing: false, inView: true, tabVisible: !document.hidden, pos: 0, raf: 0, last: 0, drawn: 0 };

const lerp = (a, b, f) => a + (b - a) * f;
const lerpAz = (a, b, f) => { const d = ((b - a + 540) % 360) - 180; return (a + d * f + 360) % 360; };

function renderHero(ephemeris, catalog) {
  const { site, horizon } = catalog.spot(SPOT, catalog.defaultMastM);
  const t0 = utcMsToEt(WINDOW_START_MS);
  const series = timeSeries(ephemeris, site, horizon, t0, t0 + DAYS * 86400, STEP_S); // once; the frames only read it
  const start = bodyState(ephemeris, "SUN", site, horizon, t0);
  hero = {
    horizon, series, now0: t0, radius: { sun: start.radius, earth: bodyState(ephemeris, "EARTH", site, horizon, t0).radius },
    range: panoramaRange([horizon.elevation, series.sunElevation, series.earthElevation]),
    tracks: { sun: { az: series.sunAzimuth, el: series.sunElevation }, earth: { az: series.earthAzimuth, el: series.earthElevation } },
  };
  setupPlayback();
}

// The frame at sample position pos (a float): the Sun and Earth interpolated between the two samples around it.
function frameAt(pos) {
  const s = hero.series, n = s.et.length;
  const k = Math.min(Math.floor(pos), n - 2), f = pos - k;
  const body = (az, el, frac, radius) => ({ azimuth: lerpAz(az[k], az[k + 1], f), elevation: lerp(el[k], el[k + 1], f), radius, fraction: frac[f < 0.5 ? k : k + 1] });
  return {
    sun: body(s.sunAzimuth, s.sunElevation, s.sunFraction, hero.radius.sun),
    earth: body(s.earthAzimuth, s.earthElevation, s.earthFraction, hero.radius.earth),
    et: s.et[k] + f * s.stepS,
  };
}

function draw() {
  const f = frameAt(play.pos);
  drawPanorama($("panorama"), { ...hero, now: { sun: f.sun, earth: f.earth } });
  $("when-text").textContent = whenText(f.et - hero.now0, etToUtcMs(f.et), DAYS);
  for (const [id, name, body] of [["sun", "Sun", f.sun], ["earth", "Earth", f.earth]]) {
    $(`${id}-text`).textContent = pillText(name, body.fraction);
    const dot = $(`${id}-dot`);
    dot.setAttribute("fill", dotFilled(body.fraction) ? "currentColor" : "none");
  }
}

const PAUSE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5V10.5M9 1.5V10.5" stroke="currentColor" stroke-width="2"/></svg>';
const PLAY_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5 10 6 3 10.5Z" fill="currentColor"/></svg>';

function setupPlayback() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const button = $("pano-toggle");
  const running = () => play.playing && play.inView && play.tabVisible;
  const label = () => {
    button.innerHTML = `${play.playing ? PAUSE_ICON : PLAY_ICON}<span class="pano-word">${play.playing ? "Pause" : "Play"}</span>`;
    button.setAttribute("aria-label", play.playing ? "Pause the animation" : "Play the animation");
  };
  const frame = (t) => {
    play.raf = 0;
    if (!running()) return;
    if (play.last) play.pos = (play.pos + Math.min(t - play.last, 100) / MS_SAMPLE) % (hero.series.et.length - 1);
    play.last = t;
    if (t - play.drawn > 30) { play.drawn = t; draw(); } // about 30 frames a second
    play.raf = requestAnimationFrame(frame);
  };
  const update = () => {
    play.last = 0;
    if (running() && !play.raf) play.raf = requestAnimationFrame(frame);
    if (!running() && play.raf) { cancelAnimationFrame(play.raf); play.raf = 0; }
  };
  button.hidden = false;
  play.playing = !reduce.matches; // with reduced motion the animation waits for Play
  label();
  draw();
  button.addEventListener("click", () => { play.playing = !play.playing; label(); update(); });
  document.addEventListener("visibilitychange", () => { play.tabVisible = !document.hidden; update(); });
  new IntersectionObserver((entries) => { play.inView = entries.at(-1).isIntersecting; update(); }).observe($("panorama"));
  reduce.addEventListener?.("change", () => { if (reduce.matches && play.playing) { play.playing = false; label(); update(); } });
  update();
}

main();

// Evidence: the validation results from data/evidence.json (pipeline/export_evidence.py),
// plus a live re-check of the browser engine against the stored Python results.

import { Ephemeris, SiteCatalog, parseUtc, summarize, timeSeries, STEP_S } from "../engine/index.js";
import { onThemeChange } from "./theme.js";

const $ = (id) => document.getElementById(id);
const li = (items) => items.map((t) => `<li>${t}</li>`).join("");
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SITE_NAMES = { near_pole: "Near the pole", malapert: "Malapert", blue_ghost_1: "Blue Ghost 1 site", farside_equator: "Far-side equator" };

let evidence;

async function main() {
  try {
    evidence = await (await fetch("data/evidence.json")).json();
  } catch (error) {
    $("status").textContent = `Could not load data/evidence.json: ${error.message}. Start the local server (./start.sh in the packaged build, or "npm run serve" in web/ in the source repository) and open http://localhost:8000/evidence.html.`;
    return;
  }
  $("status").textContent = `Generated ${evidence.generated} by pipeline/export_evidence.py (in the source repository).`;
  renderHeadline();
  renderJpl();
  renderScatter();
  renderBarker();
  renderMissions();
  renderApollo();
  renderScorecard();
  renderLimits();
  $("recheck").addEventListener("click", recheck);
  window.addEventListener("resize", renderScatter);
  onThemeChange(renderScatter);
  for (const b of document.querySelectorAll("[data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
  const fromHash = () => showTab(new URLSearchParams(location.hash.slice(1)).get("tab") || "scorecard");
  window.addEventListener("hashchange", fromHash);
  fromHash();
}

// One panel at a time, so the page stays one screen tall. The tab is kept in the address.
function showTab(name) {
  const known = [...document.querySelectorAll("[data-panel]")].some((p) => p.dataset.panel === name);
  if (!known) name = "scorecard";
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  history.replaceState(null, "", `#tab=${name}`);
  renderScatter(); // a canvas has no width while its panel is hidden
}

const pp = (v, digits = 1) => `${v.toFixed(digits)} pp`;
const utc = (iso) => new Date(Math.round(Date.parse(`${iso}Z`) / 60000) * 60000).toISOString().slice(11, 16);

function renderHeadline() {
  const worst = Math.max(...evidence.jpl.rows.map((r) => r.maxSeparationArcsec));
  const { illumination, spots, missions, barker2021 } = evidence;
  const items = [
    ["Directions vs JPL", `≤ ${worst.toFixed(2)}″`, `${evidence.jpl.rows.length} site × body series, 70 dates each, every 37 days, 2024–2030`],
    ["Sunlight vs NASA", pp(illumination.sun.rmsPp), `RMS, ${illumination.points} points over ${illumination.years} years`],
    [`${spots.scatter.length} spots vs NASA`, `r = ${spots.sun.r.toFixed(2)}`, `Sun; Earth r = ${spots.earth.r.toFixed(2)}`],
    ["Apollo Sun angle", `≤ ${evidence.apollo.maxAbsDeg.toFixed(2)}°`, `${evidence.apollo.points} moonwalk times at Apollo 11, 12 and 14, against the Surface Journal`],
  ];
  if (barker2021) {
    const [lo, hi] = barker2021.summary.ours_minus_fig19_1m_pp;
    items.push(["Barker 2021", `${lo >= 0 ? "+" : ""}${lo.toFixed(1)} to +${hi.toFixed(1)} pp`, "7 regions, ours minus published, 1 m"]);
  }
  $("headline").innerHTML = items.map(([k, v, s]) => `<div class="stat" title="${s}"><small>${k}</small><b>${v}</b></div>`).join("");
}

// The scorecard rows as stored, with the numbers a reader needs to see both views of a check: the illumination tolerance applies to
// the 6 flattest points, and the RMS and worst difference over all 26 are given beside it; the JPL row says when the dates fall.
function scorecardRow(r) {
  if (r.id === "illumination") {
    const il = evidence.illumination;
    return { ...r, result: `${r.result}<br><small>All ${il.points} points: RMS ${pp(il.sun.rmsPp)} (Sun), ${pp(il.earth.rmsPp)} (Earth); worst ${pp(il.sun.maxAbsPp)} and ${pp(il.earth.maxAbsPp)}. The tolerance applies to the 6 flattest points because on steeper ground a 60 m map pixel and our single point at its centre can differ more.</small>` };
  }
  if (r.id === "jpl") return { ...r, against: `${r.against} (${evidence.jpl.source.replace(/^.*az\/el, /, "")})` };
  return r;
}

function renderScorecard() {
  const label = { pass: "Pass", fail: "Fail", reported: "Reported" };
  $("scorecard").innerHTML = `<thead><tr><th>Check</th><th>Compared with</th><th>Result</th><th>Tolerance</th><th></th></tr></thead><tbody>${evidence.scorecard.map(scorecardRow).map((r) =>
    `<tr><td><b>${r.check}</b></td><td>${r.against}</td><td>${r.result}</td><td>${r.tolerance}</td><td><span class="verdict-chip ${r.verdict}">${label[r.verdict]}</span></td></tr>`).join("")}</tbody>`;
}

function renderApollo() {
  const a = evidence.apollo;
  $("apollo-intro").innerHTML = `The <a href="${a.source}" target="_blank" rel="noopener">Apollo Lunar Surface Journal</a> lists the Sun's elevation at the start and end of each moonwalk. We add each time to the mission's liftoff and compute the Sun above the local horizontal at the landing site.`;
  const used = a.rows.filter((r) => r.comparable);
  $("apollo").innerHTML = `<thead><tr><th>Mission</th><th>Moonwalk</th><th>UTC</th><th>Journal</th><th>Ours</th><th>Difference</th></tr></thead><tbody>${used.map((r) =>
    `<tr><td>${r.mission}</td><td>${r.event}</td><td>${r.utc.slice(0, 16).replace("T", " ")}</td><td>${r.sourceDeg.toFixed(1)}°</td><td>${r.oursDeg.toFixed(2)}°</td><td>${r.differenceDeg >= 0 ? "+" : ""}${r.differenceDeg.toFixed(2)}°</td></tr>`).join("")}</tbody>`;
  $("apollo-text").innerHTML = li([
    `<b>${a.points} times at Apollo 11, 12 and 14 agree to ${a.maxAbsDeg.toFixed(2)}° at worst</b> (RMS ${a.rmsDeg.toFixed(2)}°). The journal rounds angles to 0.1° and times to a quarter of an hour, which together allow about 0.1°.`,
    "Apollo 15, 16 and 17 are left out. They landed 9° to 26° from the equator, and the journal's angle there rises at the equator's rate, 0.51° per hour, not at the local rate (0.44° at Apollo 15), so it is not the local elevation.",
    `The time scale was checked against each landing time: it agrees to ${Math.max(...Object.values(a.timeScaleCheckHours)).toFixed(2)} h at worst.`,
  ]);
}

function renderJpl() {
  const sites = [...new Set(evidence.jpl.rows.map((r) => r.site))];
  const cell = (site, target) => {
    const r = evidence.jpl.rows.find((x) => x.site === site && x.target === target);
    return `<td>${r.maxSeparationArcsec.toFixed(3)}″</td>`;
  };
  $("jpl").innerHTML = `<thead><tr><th>Site</th><th>Latitude, longitude</th><th>Epochs</th><th>Sun, worst</th><th>Earth, worst</th></tr></thead><tbody>${sites.map((s) => {
    const r = evidence.jpl.rows.find((x) => x.site === s);
    return `<tr><td>${SITE_NAMES[s] || s}</td><td>${r.latitudeDeg.toFixed(2)}°, ${r.longitudeDeg.toFixed(2)}° E</td><td>${r.epochs}</td>${cell(s, "sun")}${cell(s, "earth")}</tr>`;
  }).join("")}</tbody>`;
}

function renderScatter() {
  const { illumination: il, spots: sp } = evidence;
  drawScatter($("plot-illumination"), [
    { color: token("--sun"), points: il.scatter.map((p) => [p[0], p[1]]) },
    { color: token("--earth"), points: il.scatter.map((p) => [p[2], p[3]]) },
  ], "NASA LOLA map (18.6 years)", "Ours, same method");
  drawScatter($("plot-spots"), [
    { color: token("--sun"), points: sp.scatter.map((r) => [r[1], r[2]]) },
    { color: token("--earth"), points: sp.scatter.map((r) => [r[3], r[4]]) },
  ], "NASA map at the spot (18.6 years)", "Ours, 2027, 2 m mast");
  $("illumination-text").innerHTML = li([
    `<b>Sun:</b> RMS ${pp(il.sun.rmsPp)}, worst ${pp(il.sun.maxAbsPp)} · <b>Earth:</b> RMS ${pp(il.earth.rmsPp)}, worst ${pp(il.earth.maxAbsPp)}`,
    `${il.points} points at ${-il.latitudeRangeDeg[1]}–${-il.latitudeRangeDeg[0]}°S over ${il.years} years.`,
    `Largest differences: Sun ${pp(il.sun.maxAbsPp)} at a ${slopeAtWorst(il.scatter, 0, 1).toFixed(1)}° slope, Earth ${pp(il.earth.maxAbsPp)} at a ${slopeAtWorst(il.scatter, 2, 3).toFixed(1)}° slope.`,
  ]);
  $("spots-text").innerHTML = li([
    `<b>Sun:</b> r = ${sp.sun.r.toFixed(2)}, RMS ${pp(sp.sun.rmsPp)} · <b>Earth:</b> r = ${sp.earth.r.toFixed(2)}, RMS ${pp(sp.earth.rmsPp)}`,
    "Not like for like: a 2 m mast and one year against NASA's 18.6-year ground average.",
    `Ours is ${pp(sp.sun.meanPp)} higher on average, as a raised eye should be.`,
  ]);
}

// Slope (degrees) of the point where ours differs most from NASA's map; columns a and b are the two values compared.
const slopeAtWorst = (scatter, a, b) => scatter.reduce((m, p) => (Math.abs(p[a] - p[b]) > Math.abs(m[a] - m[b]) ? p : m))[4];

function drawScatter(canvas, series, xLabel, yLabel) {
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const width = canvas.clientWidth;
  if (!width) return; // its panel is hidden
  const height = Math.min(width, 300);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pad = { l: 44, r: 10, t: 10, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (v) => pad.l + v * w;
  const y = (v) => pad.t + (1 - v) * h;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = color("--muted");
  ctx.strokeStyle = color("--grid");
  for (let v = 0; v <= 1.0001; v += 0.25) {
    ctx.beginPath(); ctx.moveTo(x(v), y(0)); ctx.lineTo(x(v), y(1)); ctx.moveTo(x(0), y(v)); ctx.lineTo(x(1), y(v)); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillText(`${v * 100}%`, x(v), y(0) + 13);
    ctx.textAlign = "right"; ctx.fillText(`${v * 100}%`, x(0) - 4, y(v) + 4);
  }
  ctx.textAlign = "center";
  ctx.fillText(xLabel, pad.l + w / 2, height - 4);
  ctx.save(); ctx.translate(11, pad.t + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  ctx.strokeStyle = color("--zero");
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x(0), y(0)); ctx.lineTo(x(1), y(1)); ctx.stroke();
  ctx.setLineDash([]);
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.75;
    for (const [a, b] of s.points) { ctx.beginPath(); ctx.arc(x(a), y(b), 3.5, 0, 2 * Math.PI); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

function renderBarker() {
  const b = evidence.barker2021;
  if (!b) {
    $("barker").innerHTML = `<p class="note">Not computed yet: in the source repository, run <code>validation/compare_barker2021.py</code>, then <code>pipeline/export_evidence.py</code>.</p>`;
    return;
  }
  const s = b.summary;
  const rows = b.rois.map((r, k) => `<tr><td>RoI ${r.roi}</td><td>${r.points}</td><td>${s.nominal_1m_fig19_by_roi[k].toFixed(1)}%</td><td>${r["1m"].average_illumination_pct.toFixed(1)}%</td>`
    + `<td>${(r["1m"].average_illumination_pct - s.nominal_1m_fig19_by_roi[k]).toFixed(1)}</td><td>${r["5m"].average_illumination_pct.toFixed(1)}%</td></tr>`).join("");
  const range = (v) => `${v[0].toFixed(0)}–${v[1].toFixed(0)}%`;
  $("barker").innerHTML = `
    <ul class="bullets note">
      <li>NASA Goddard study of 7 regions on the Connecting ridge, ${b.period[0].slice(0, 4)}–${Number(b.period[1].slice(0, 4)) - 1}.</li>
      <li><b>At 1 m, every region is within ${s.ours_minus_fig19_1m_pp[1].toFixed(1)} pp</b> of the published value.</li>
    </ul>
    <div class="table-wrap"><table>
      <thead><tr><th>Region</th><th>Our points</th><th>Barker, 1 m (Fig. 19)</th><th>Ours, 1 m</th><th>Difference (pp)</th><th>Ours, 5 m</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <details class="howto"><summary>Method and caveats</summary><ul>
      <li>Published values are read by eye from Fig. 19 (about ±1 pp).</li>
      <li>Their pessimistic bound (1st percentile of 100 maps): ${range(s.clone_p1_1m_table2)} at 1 m, ${range(s.clone_p1_5m_table2)} at 5 m. Ours at 5 m: ${range(s.ours_5m_range)}.</li>
      <li>We use a uniform Sun (theirs is limb-darkened) and a ${b.spacing_m} m grid.</li>
    </ul></details>`;
}

function renderMissions() {
  const { blueGhost1: bg, im1 } = evidence.missions;
  const e = bg.events;
  const rows = [
    ["NASA: operations continued \"five hours after lunar sunset\" (implied sunset)", e.nasaSunsetImplied],
    ["Model: Sun starts to drop behind terrain", e.terrain_sunset_begins],
    ["Landing + 346 h (Firefly's end of sunlit operations)", e.landingPlus346h],
    ["Model: Sun's centre behind terrain", e.sun_centre_behind_terrain],
    [`Model: Sun hidden by the ridge ${bg.terrainToSunset.distance_km.toFixed(1)} km west`, e.terrain_sunset_complete],
    ["Model: Sun set if the horizon were flat", e.flat_horizon_sunset_complete],
    ["Final transmission", e.finalTransmission],
  ];
  $("bg1").innerHTML = `<thead><tr><th>Event, ${e.landingPlus346h.slice(0, 10)}</th><th>UTC</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${utc(v)}</td></tr>`).join("")}</tbody>`;
  $("bg1-text").innerHTML = li([
    `A ridge ${bg.terrainToSunset.distance_km.toFixed(1)} km west rises ${bg.terrainToSunset.horizon_deg.toFixed(1)}°.`,
    `<b>The Sun starts to set behind it at ${utc(e.terrain_sunset_begins)}</b>, minutes from NASA's account.`,
    `On the 474 m global map the ridge is lost: the Sun is completely hidden at ${utc(evidence.awayFromPole.first_sunset_global_utc)}, not ${utc(evidence.awayFromPole.first_sunset_fine_utc)}, ${evidence.awayFromPole.sunset_error_h.toFixed(1)} h late.`,
  ]);
  const items = [
    ["Height, LROC", `${im1.lrocM.toFixed(0)} m`],
    ["Height, our LOLA maps", `${im1.groundM.toFixed(0)} m`],
    ["Sun's peak, 26 Feb 2024", `${im1.sunMaxDeg["2024-02-26"].toFixed(1)}°`],
    ["Sun's peak, 29 Feb 2024", `${im1.sunMaxDeg["2024-02-29"].toFixed(1)}°`],
    ["Model sunset behind terrain", `${im1.firstSunset.slice(0, 10)} ${utc(im1.firstSunset)} UTC`],
  ];
  $("im1").innerHTML = items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("im1-text").innerHTML = li([
    `<b>Heights ${Math.abs(im1.groundM - im1.lrocM).toFixed(0)} m apart</b> from two independent paths.`,
    "It went silent on 29 Feb 2024. The model's sunset is 2 days later.",
    "It tipped about 30° and lost power before sunset.",
  ]);
}

function renderLimits() {
  const { awayFromPole: far, customPoints: custom } = evidence;
  $("limit-away").innerHTML = `<strong>Away from the pole:</strong> the 474 m global map only. Against the 59 m map at Blue Ghost 1 the skyline is off by ${far.horizon_rms_deg.toFixed(1)}° (RMS, ${far.horizon_max_abs_deg.toFixed(1)}° at worst) and the sunset ${far.sunset_error_h.toFixed(1)} h late; mountains and craters may be worse.`;
  $("limit-custom").innerHTML = `<strong>Custom points:</strong> a 20 m crop and a 480 m far field, not the 5 m map. At the ${custom.spots} spots the skyline is off by ${custom.horizon_rms_deg.toFixed(2)}° (RMS), the sunlit share by ${custom.sun_share_pp.median.toFixed(1)} points (median) and the longest night by ${custom.longest_dark_h.median.toFixed(1)} h (median), ${custom.longest_dark_h.p90.toFixed(0)} h (90th percentile), ${custom.longest_dark_h.max.toFixed(0)} h at worst.`;
}

async function recheck() {
  const button = $("recheck");
  button.disabled = true;
  const out = $("recheck-result");
  out.textContent = "Loading the ephemeris and site catalogue…";
  try {
    const [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
    const et0 = parseUtc("2027-01-01T00:00:00");
    const et1 = parseUtc("2028-01-01T00:00:00");
    const ids = [...catalog.spots.keys()];
    let worst = 0;
    let worstId = "";
    const t = performance.now();
    for (const [k, id] of ids.entries()) {
      if (k % 4 === 0) {
        out.textContent = `Computing ${k + 1} of ${ids.length} spots…`;
        await new Promise((resolve) => setTimeout(resolve));
      }
      const { site, horizon, record } = catalog.spot(id, 2);
      const got = summarize(timeSeries(ephemeris, site, horizon, et0, et1, STEP_S));
      const expected = record.year2027["2"];
      for (const key of ["sunlitFraction", "earthFraction", "bothFraction"]) {
        const d = Math.abs(got[key] - expected[key]);
        if (d > worst) { worst = d; worstId = `${id}, ${key}`; }
      }
    }
    const seconds = ((performance.now() - t) / 1000).toFixed(1);
    out.textContent = `${ids.length} spots in ${seconds} s · worst difference from Python ${(worst * 100).toFixed(3)} pp${worstId ? ` (${worstId})` : ""}; horizons are stored in 0.01° steps`;
  } catch (error) {
    out.textContent = `Re-check failed: ${error.message}`;
  }
  button.disabled = false;
}

main();

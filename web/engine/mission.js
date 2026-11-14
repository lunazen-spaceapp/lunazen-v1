// Time series and summary metrics for a site and mission window (mirrors clps/mission.py).

import { dsnInView, stationInView } from "./dsn.js";
import { bodyState } from "./physics.js";

// Time step of every series the app samples (mirrors clps.mission.STEP_S).
export const STEP_S = 900;

// options.dsnRule: "disk" (default) counts DSN in view when any part of Earth's disk is above the skyline and a complex
// sees the Moon above 10 deg; "station" also needs the complex itself above the skyline (dsn.js stationInView; needs the
// rotation table).
export function timeSeries(ephemeris, site, horizon, etStart, etEnd, stepS, { dsnRule = "disk" } = {}) {
  const n = Math.floor((etEnd - etStart) / stepS) + 1;
  const series = {
    et: new Float64Array(n), sunFraction: new Float64Array(n), earthFraction: new Float64Array(n),
    sunElevation: new Float64Array(n), earthElevation: new Float64Array(n),
    sunAzimuth: new Float64Array(n), earthAzimuth: new Float64Array(n),
    dsnInView: new Uint8Array(n),
  };
  const scratch = new Float64Array(3);
  for (let k = 0; k < n; k++) {
    const et = etStart + k * stepS;
    const sun = bodyState(ephemeris, "SUN", site, horizon, et, scratch);
    const earth = bodyState(ephemeris, "EARTH", site, horizon, et, scratch);
    series.et[k] = et;
    series.sunFraction[k] = sun.fraction;
    series.earthFraction[k] = earth.fraction;
    series.sunElevation[k] = sun.elevation;
    series.earthElevation[k] = earth.elevation;
    series.sunAzimuth[k] = sun.azimuth;
    series.earthAzimuth[k] = earth.azimuth;
    series.dsnInView[k] = (dsnRule === "station" ? stationInView(ephemeris, et, site, horizon) : dsnInView(ephemeris, et)) ? 1 : 0;
  }
  series.stepS = stepS;
  return series;
}

// Skyline errors (deg) a result is tested against (mirrors lunazen.mission.FRAGILITY_ERRORS_DEG).
export const FRAGILITY_ERRORS_DEG = [0.1, 0.25];
export const SKYLINE_TEST_DEG = 0.25; // the error Rank, Compare and the Planner test a landing against (mirrors lunazen.mission.SKYLINE_TEST_DEG)

// How the window's result changes if the skyline were higher by each error, keyed by the error as text (mirrors lunazen.mission.fragility).
export function fragility(ephemeris, site, horizon, etStart, etEnd, stepS, errorsDeg = FRAGILITY_ERRORS_DEG, options = {}) {
  const out = {};
  for (const error of errorsDeg) {
    const s = summarize(timeSeries(ephemeris, site, horizon.raised(error), etStart, etEnd, stepS, options), options.darkBelow ?? 0);
    out[String(error)] = { sunlitFraction: s.sunlitFraction, longestDarkHours: s.longestDarkHours, dsnLinkFraction: s.dsnLinkFraction };
  }
  return out;
}

// Hours until the Sun or Earth next changes between up and hidden, on the series grid (mirrors
// clps.mission.time_to_change). up: the state at et; hours: the first differing grid sample, or null.
export function timeToChange(ephemeris, site, horizon, et, bodyName, { maxDays = 30, stepS = STEP_S } = {}) {
  const scratch = new Float64Array(3);
  const up = (t) => bodyState(ephemeris, bodyName, site, horizon, t, scratch).fraction > 0;
  const now = up(et);
  const n = Math.floor((maxDays * 86400) / stepS);
  for (let k = 1; k <= n; k++) if (up(et + k * stepS) !== now) return { up: now, hours: (k * stepS) / 3600 };
  return { up: now, hours: null };
}

// Longest run of consecutive samples where predicate(i) is true, in hours.
export function longestRunHours(n, stepS, predicate) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    run = predicate(i) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return (best * stepS) / 3600;
}

// Maximal runs of samples where predicate(i) is true, as [{startEt, endEt}] (sample times;
// edges known to within one step; windows open at either end of the series are clipped).
// Mirrors clps/mission.py windows().
export function windows(et, predicate) {
  const out = [];
  let start = -1;
  for (let i = 0; i < et.length; i++) {
    if (predicate(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ startEt: et[start], endEt: et[i - 1] });
      start = -1;
    }
  }
  if (start >= 0) out.push({ startEt: et[start], endEt: et[et.length - 1] });
  return out;
}

// darkBelow: 0 counts a sample as dark when no part of the Sun is up (default); 0.1 or 0.5 count it as dark when less than
// that share of the Sun's disk is visible (the longest dark period only; mirrors lunazen.mission.summarize dark_below).
export const isDark = (fraction, darkBelow = 0) => (darkBelow > 0 ? fraction < darkBelow : fraction <= 0);

export function summarize(series, darkBelow = 0) {
  const n = series.et.length;
  let sunlit = 0, earth = 0, both = 0, link = 0, energy = 0;
  for (let i = 0; i < n; i++) {
    const s = series.sunFraction[i] > 0;
    const e = series.earthFraction[i] > 0;
    energy += series.sunFraction[i] * Math.max(0, Math.cos((series.sunElevation[i] * Math.PI) / 180));
    sunlit += s; earth += e; both += s && e; link += e && series.dsnInView[i] === 1;
  }
  return {
    sunlitFraction: sunlit / n,
    earthFraction: earth / n,
    bothFraction: both / n,
    // Wh per W of a vertical array turning to face the Sun (mirrors clps.mission.array_energy_wh_per_w).
    energyWhPerW: (energy * series.stepS) / 3600,
    longestDarkHours: longestRunHours(n, series.stepS, (i) => isDark(series.sunFraction[i], darkBelow)),
    longestCommsGapHours: longestRunHours(n, series.stepS, (i) => series.earthFraction[i] <= 0),
    dsnLinkFraction: link / n,
    longestDsnLinkGapHours: longestRunHours(n, series.stepS, (i) => !(series.earthFraction[i] > 0 && series.dsnInView[i] === 1)),
  };
}

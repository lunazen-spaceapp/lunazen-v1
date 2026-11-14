// Pure helpers for the Over-this-period chart: discrete levels per lane and the longest run of a
// level. No DOM access, so they are unit-tested in Node.

import { isDark } from "../engine/index.js";

// Level of a body from its visible fraction: Sun 0/1 (any part up), Earth 0/1/2 (hidden, partly, wholly up).
export const sunLevel = (fraction) => (fraction > 0 ? 1 : 0);
export const earthLevel = (fraction) => (fraction >= 0.999 ? 2 : fraction > 0 ? 1 : 0);

// Start and end index (end exclusive) of the longest run of `value` in levels, or null.
export function longestRun(levels, value) {
  let best = null;
  let start = -1;
  for (let k = 0; k <= levels.length; k++) {
    const inside = k < levels.length && levels[k] === value;
    if (inside && start < 0) start = k;
    if (!inside && start >= 0) {
      if (!best || k - start > best[1] - best[0]) best = [start, k];
      start = -1;
    }
  }
  return best;
}

// The highest the centre of the Sun gets over the window, in degrees above a level horizon (any sample: the terrain does not
// change it, only the spot and the dates do).
export function sunHighest({ sunElevation }) {
  let max = -Infinity;
  for (let i = 0; i < sunElevation.length; i++) if (sunElevation[i] > max) max = sunElevation[i];
  return Number.isFinite(max) ? max : null;
}

// The share of the light the Sun puts out (the visible part of its disk, summed over the samples where it is up) that
// a Sun-tracking upright array turning to face the Sun captures (cosine of the elevation, the array behind Sun energy), and that a
// flat array captures (sine of the elevation). { upright, flat }, or null if the Sun is never up. Near the pole the
// Sun-tracking upright array loses almost nothing to the low Sun and a flat one loses almost all; at a high Sun it is the other way.
export function lightCapture({ sunFraction, sunElevation }) {
  let total = 0, upright = 0, flat = 0;
  for (let i = 0; i < sunFraction.length; i++) {
    const f = sunFraction[i];
    if (!(f > 0)) continue;
    const e = (sunElevation[i] * Math.PI) / 180;
    total += f; upright += f * Math.max(0, Math.cos(e)); flat += f * Math.max(0, Math.sin(e));
  }
  return total > 0 ? { upright: upright / total, flat: flat / total } : null;
}

// Hours of full Sun a panel that points at the Sun would collect over the window: the visible fraction of the Sun's disk
// summed over the samples, times the step. It needs no assumption about the array (a Sun-tracking upright array turning to face the
// Sun collects the share lightCapture gives, which is what Sun energy in Wh per W counts).
export function fullSunHours({ sunFraction }, stepS) {
  let sum = 0;
  for (let i = 0; i < sunFraction.length; i++) sum += sunFraction[i];
  return (sum * stepS) / 3600;
}

// What the mission looks like from the landing: the Sun and Earth levels of every sample of the mission window and
// the DSN link (0/1 per sample, same length), stepS seconds apart. All times are hours after the landing; null means
// "never in this window".
// darkBelow (0, 0.1, 0.5): the longest night counts the Sun as down when less than that share of it is visible (engine isDark).
export function missionFacts({ sunFraction, earthFraction, sunElevation }, link, stepS, darkBelow = 0) {
  const hours = (k) => (k === null ? null : (k * stepS) / 3600);
  const sun = Array.from(sunFraction, sunLevel), earth = Array.from(earthFraction, earthLevel);
  const first = (levels, value) => { const k = levels.indexOf(value); return k < 0 ? null : k; };
  const run = (levels, value) => { const r = longestRun(levels, value); return r ? ((r[1] - r[0]) * stepS) / 3600 : 0; };
  const share = (levels, up) => (levels.length ? levels.filter(up).length / levels.length : 0);
  // The first time a body that is down at landing comes up (null if it is up at landing or never rises in the window).
  const rise = (levels) => { if (!levels.length || levels[0] > 0) return null; const k = levels.findIndex((v) => v > 0); return k < 0 ? null : k; };
  return {
    firstSunsetH: hours(first(sun, 0)), firstEarthsetH: hours(first(earth, 0)),
    firstSunriseH: hours(rise(sun)), firstEarthriseH: hours(rise(earth)),
    sunUpAtLanding: sun.length > 0 && sun[0] > 0, earthUpAtLanding: earth.length > 0 && earth[0] > 0,
    longestNightH: run(Array.from(sunFraction, (f) => (isDark(f, darkBelow) ? 0 : 1)), 0), longestNoLinkH: run(Array.from(link), 0),
    sunShare: share(sun, (v) => v > 0), linkShare: share(Array.from(link), (v) => v > 0),
    sunHighest: sunElevation ? sunHighest({ sunElevation }) : null,
    capture: sunElevation ? lightCapture({ sunFraction, sunElevation }) : null,
  };
}

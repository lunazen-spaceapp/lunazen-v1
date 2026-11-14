// Landing-date planner. Mirrors clps/planner.py: for each candidate landing time, a
// mission of fixed length: its longest dark period and its DSN-link share.

import { isDark, longestRunHours } from "./mission.js";

// series: from timeSeries() (at STEP_S), covering the search range plus one mission length.
// darkBelow: see mission.js isDark; only the longest dark period uses it.
export function evaluateLandings(series, missionS, startStride, darkBelow = 0) {
  const step = series.stepS;
  const nMission = Math.round(missionS / step);
  const n = series.et.length;
  const sunUp = (i) => series.sunFraction[i] > 0;
  const link = (i) => series.earthFraction[i] > 0 && series.dsnInView[i] === 1;
  const out = [];
  for (let start = 0; start + nMission <= n; start += startStride) {
    let sun = 0;
    let linked = 0;
    for (let i = start; i < start + nMission; i++) {
      sun += sunUp(i);
      linked += link(i);
    }
    out.push({
      startIndex: start,
      startEt: series.et[start],
      sunlitFraction: sun / nMission,
      linkFraction: linked / nMission,
      longestDarkHours: longestRunHours(nMission, step, (k) => isDark(series.sunFraction[start + k], darkBelow)),
      longestLinkGapHours: longestRunHours(nMission, step, (k) => !link(start + k)),
    });
  }
  return out;
}

// Survives (longest dark period within the tolerance, in hours) and meets the link share.
export function feasible(result, minLinkFraction, maxDarkHours) {
  return result.longestDarkHours <= maxDarkHours && result.linkFraction >= minLinkFraction;
}

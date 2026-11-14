// The heavy computations behind Compare and the Planner, as plain functions of one task. They run in
// a Web Worker (worker.js) or, where workers are not available, on the main thread (pool.js), so the
// numbers are identical either way.

import { evaluateLandings, feasible, summarize, timeSeries, SKYLINE_TEST_DEG, STEP_S } from "../engine/index.js";
import { dayCodes } from "./windows-data.js";
import { ringCount } from "./reach.js";

// The three results a higher skyline changes (mirrors lunazen.mission.fragility).
const raisedSummary = (ephemeris, site, horizon, et0, et1, darkBelow = 0, dsnRule = "disk") => {
  const s = summarize(timeSeries(ephemeris, site, horizon.raised(SKYLINE_TEST_DEG), et0, et1, STEP_S, { dsnRule }), darkBelow);
  return { sunlitFraction: s.sunlitFraction, longestDarkHours: s.longestDarkHours, dsnLinkFraction: s.dsnLinkFraction };
};

// ctx: { ephemeris, catalog }. task.dsnRule ("station", default absent): test the DSN station itself against the skyline (engine dsn.js
// stationInView; needs the rotation table). task.darkBelow (0, 0.1 or 0.5, default 0): count a sample as dark when less than that share of
// the Sun is visible, for the longest dark period (engine mission.js isDark).
export function runTask({ ephemeris, catalog }, task) {
  const dsn = { dsnRule: task.dsnRule === "station" ? "station" : "disk" };
  if (task.custom && !catalog.customs.has(task.custom.id)) catalog.addCustom(task.custom);
  if (task.custom && !catalog.customs.get(task.custom.id).horizons.has(task.mast ?? catalog.defaultMastM)) catalog.addCustom(task.custom); // another mast height
  if (task.kind === "column") {
    // One site over the window: its series and metrics, and for a spot the sunlight range over its 12 nearby points.
    const mission = catalog.missions.has(task.id);
    const { site, horizon } = mission ? catalog.mission(task.id) : catalog.spot(task.id, task.mast);
    const series = timeSeries(ephemeris, site, horizon, task.et0, task.et1, STEP_S, dsn);
    const metrics = summarize(series, task.darkBelow);
    const raised = raisedSummary(ephemeris, site, horizon, task.et0, task.et1, task.darkBelow, dsn.dsnRule);
    if (mission) return { series, metrics, raised, ringSunMin: null, ringSunMax: null };
    const ring = catalog.ring(task.id).map((p) => summarize(timeSeries(ephemeris, p.site, p.horizon, task.et0, task.et1, STEP_S, dsn)).sunlitFraction);
    return { series, metrics, raised, ringSunMin: Math.min(metrics.sunlitFraction, ...ring), ringSunMax: Math.max(metrics.sunlitFraction, ...ring) };
  }
  if (task.kind === "landings") {
    // Every landing time at one point: point 0 is the spot, 1.. its ring.
    const { site, horizon } = task.point === 0 ? catalog.spot(task.spot, task.mast) : catalog.ring(task.spot)[task.point - 1];
    // task.raise: the same landings with the skyline that many degrees higher (a test against the terrain map's error)
    const series = timeSeries(ephemeris, site, task.raise ? horizon.raised(task.raise) : horizon, task.et0, task.et1, STEP_S, dsn);
    return evaluateLandings(series, task.missionS, task.stride, task.darkBelow);
  }
  if (task.kind === "windows") {
    // A code for each landing day from et0 (see windows-data.js): the spot and its nearby points, landings every rule.strideHours.
    const rule = task.rule;
    const days = Math.max(0, Math.min(task.days, Math.floor((ephemeris.etMax - STEP_S - task.et0) / 86400) - rule.missionDays));
    const et1 = task.et0 + (days + rule.missionDays) * 86400;
    const ring = catalog.ring(task.spot).slice(0, ringCount(task.within)); // the points up to the miss distance
    const evals = Array.from({ length: 1 + ring.length }, (_, p) => {
      const { site, horizon } = p === 0 ? catalog.spot(task.spot, task.mast) : ring[p - 1];
      return evaluateLandings(timeSeries(ephemeris, site, horizon, task.et0, et1, STEP_S, dsn), rule.missionDays * 86400, (rule.strideHours * 3600) / STEP_S, task.darkBelow);
    });
    return { codes: dayCodes(evals, rule, task.et0, days), points: evals.length };
  }
  if (task.kind === "rank") {
    // One candidate spot for one landing: the whole mission window (exactly missionS, in 15-minute samples)
    // at the spot, and at each of its 12 nearby points whether the same rule (feasible) would hold.
    const { site, horizon } = catalog.spot(task.id, task.mast);
    const et1 = task.et0 + task.missionS - STEP_S;
    const metrics = summarize(timeSeries(ephemeris, site, horizon, task.et0, et1, STEP_S, dsn), task.darkBelow);
    let ringOk = 0;
    const ring = catalog.ring(task.id).slice(0, ringCount(task.within));
    for (const p of ring) {
      const [r] = evaluateLandings(timeSeries(ephemeris, p.site, p.horizon, task.et0, et1, STEP_S, dsn), task.missionS, 1, task.darkBelow);
      ringOk += feasible(r, task.minLink, task.maxDarkHours) ? 1 : 0;
    }
    return { id: task.id, metrics, raised: raisedSummary(ephemeris, site, horizon, task.et0, et1, task.darkBelow, dsn.dsnRule), ringOk, ringTotal: ring.length };
  }
  throw new Error(`unknown task ${task.kind}`);
}

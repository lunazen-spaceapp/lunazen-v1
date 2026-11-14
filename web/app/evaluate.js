// Every landing time of a date range at one spot, tested at the spot and at the nearby points of the chosen miss distance (reach.js), and at the spot with the
// skyline raised: the rows the Planner and Compare work from (plan.js `combine` and `withRaisedSkyline`).

import { parseUtc, STEP_S } from "../engine/index.js";
import { combine, withRaisedSkyline } from "./plan.js";
import { SKYLINE_DEG } from "./query-model.js";
import { ringCount } from "./reach.js";

const STRIDE = (6 * 3600) / STEP_S; // landing times every 6 hours
const darkLimit = (catalog, q) => (q.rule === "custom" ? q.dark : catalog.darknessPresets.find((p) => p.id === q.rule).hours);

// ctx: { ephemeris, catalog, pool }. q: { spot, mast, mission, rule, dark, link, within, dbelow (percent of the Sun below which a sample counts as dark; 0 or absent: any part ends the night) }. Returns
// { rows, count, clipped } or null if isStale() turned true on the way.
export function createEvaluator({ ephemeris, catalog, pool }) {
  return async function evaluateRange(q, startDay, days, { progress = () => {}, isStale = () => false } = {}) {
    const et0 = parseUtc(`${startDay}T00:00:00`);
    const et1 = Math.min(et0 + (days + q.mission) * 86400, ephemeris.etMax - STEP_S);
    const count = 1 + Math.min(ringCount(q.within), catalog.spotRecord(q.spot).ring.length);
    let done = 0;
    const task = (point, raise) => ({ kind: "landings", spot: q.spot, mast: q.mast, point, et0, et1, missionS: q.mission * 86400, stride: STRIDE, darkBelow: (q.dbelow ?? 0) / 100, dsnRule: q.dstation ? "station" : undefined, ...(raise ? { raise } : {}) });
    const evaluations = await Promise.all(Array.from({ length: count }, async (_, point) => { const r = await pool.run(task(point)); if (!isStale()) progress(++done, count); return r; }));
    if (isStale()) return null;
    const raised = await pool.run(task(0, SKYLINE_DEG));
    if (isStale()) return null;
    const minLink = q.link / 100, maxDark = darkLimit(catalog, q);
    return { rows: withRaisedSkyline(combine(evaluations, minLink, maxDark), raised, minLink, maxDark), count, clipped: et0 + (days + q.mission) * 86400 > et1 };
  };
}

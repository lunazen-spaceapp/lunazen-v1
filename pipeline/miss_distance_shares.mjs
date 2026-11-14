// The share of spot-days that work at each miss distance (the Planner's "landing within ..." choice): at the spot only (0 m),
// within 50 m (the spot and the six points at 50 m) and within 100 m (all twelve nearby points), for the default rule (14-day
// mission, VIPER's 50 h, DSN in view at least 50%, 2 m mast) at every candidate spot. Quoted in the README.md.
//     node pipeline/miss_distance_shares.mjs 2027        (one year, about 1.5 minutes; run it for each year of 2026-2029)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../web/", import.meta.url));
const { Ephemeris, SiteCatalog, parseUtc, STEP_S, timeSeries, evaluateLandings } = await import(web + "engine/index.js");
const { WINDOW_RULE, dayCodes } = await import(web + "app/windows-data.js");
const buf = (f) => { const b = readFileSync(web + "data/" + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ephemeris = new Ephemeris(JSON.parse(readFileSync(web + "data/ephemeris.json", "utf8")), buf("ephemeris.bin"));
const catalog = new SiteCatalog(JSON.parse(readFileSync(web + "data/sites.json", "utf8")), buf("horizons.bin"));

const year = Number(process.argv[2] ?? 2027), rule = WINDOW_RULE;
const et0 = parseUtc(`${year}-01-01T00:00:00`);
const days = Math.round((parseUtc(`${year + 1}-01-01T00:00:00`) - et0) / 86400);
const et1 = et0 + (days + rule.missionDays) * 86400;
const RINGS = [0, 6, 12]; // nearby points tested: on the spot, within 50 m, within 100 m (the ring is stored inner-first)
const total = Object.fromEntries(RINGS.map((k) => [k, 0])), spotsWith = { ...total };
let spots = 0, site011 = {};
for (const rec of catalog.spots.values()) {
  const ring = catalog.ring(rec.id);
  const evals = [catalog.spot(rec.id, rule.mastM), ...ring].map(({ site, horizon }) => evaluateLandings(timeSeries(ephemeris, site, horizon, et0, et1, STEP_S), rule.missionDays * 86400, (rule.strideHours * 3600) / STEP_S));
  for (const k of RINGS) {
    // a day works at this distance when some landing that day works at the spot and at all 1 + k points
    const full = dayCodes(evals.slice(0, 1 + k), rule, et0, days).split("").filter((c) => parseInt(c, 16) - 1 === 1 + k).length;
    total[k] += full;
    if (full) spotsWith[k]++;
    if (rec.id === "Site01-1") site011[k] = full;
  }
  spots++;
}
console.log(`${year}: ${spots} spots, ${spots * days} spot-days`);
for (const k of RINGS) console.log(`${["on the spot", "within 50 m", "within 100 m"][RINGS.indexOf(k)].padEnd(12)} ${(100 * total[k] / (spots * days)).toFixed(1)}% of spot-days, ${spotsWith[k]} spots have a day, Site01-1 ${site011[k]} days`);

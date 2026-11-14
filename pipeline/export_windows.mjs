// web/data/windows.json: for every candidate spot and every landing day of 2026-2029, whether a mission works.
// Rule (the Planner's, fixed here): a 14-day mission, VIPER's 50 h darkness tolerance, DSN in view at least 50%, 2 m mast;
// landings every 6 h, a day counts by its best landing. Run with the browser engine (about 3 minutes):
//     node pipeline/export_windows.mjs
// The browser engine is checked against the Python reference by the fixtures, and web/app/test/windows.test.js
// recomputes spots from this file and checks Rank (also tested against Python) agrees.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../web/", import.meta.url));
const { Ephemeris, SiteCatalog } = await import(web + "engine/index.js");
const { WINDOW_RULE, WINDOW_YEARS } = await import(web + "app/windows-data.js");
const { windowsForSpot } = await import(web + "app/windows-compute.js");
const buf = (f) => { const b = readFileSync(web + "data/" + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = {
  ephemeris: new Ephemeris(JSON.parse(readFileSync(web + "data/ephemeris.json", "utf8")), buf("ephemeris.bin")),
  catalog: new SiteCatalog(JSON.parse(readFileSync(web + "data/sites.json", "utf8")), buf("horizons.bin")),
};
const out = { rule: WINDOW_RULE, years: WINDOW_YEARS, encoding: "one hex digit per day: 0 fails because the night is too long, 1 fails because DSN in view is too low, 2+ works at (value - 1) of the spot's points (spot + ring)", spots: [] };
const t = performance.now();
for (const rec of ctx.catalog.spots.values()) {
  const entry = { id: rec.id, site: rec.site, siteName: rec.siteName, x: Math.round(rec.xM), y: Math.round(rec.yM), points: 1 + ctx.catalog.ring(rec.id).length, sun: Number(rec.nasaAvgSun.toFixed(3)), days: {} };
  for (const year of WINDOW_YEARS) entry.days[year] = windowsForSpot(ctx, rec.id, year);
  out.spots.push(entry);
  console.error(rec.id, ((performance.now() - t) / 1000).toFixed(0) + " s");
}
writeFileSync(web + "data/windows.json", JSON.stringify(out));

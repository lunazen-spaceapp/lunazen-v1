// Figure data for the document, computed with the app's own engine (web/engine) from its shipped data.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ephemeris, Horizon, parseUtc, siteFromLatLon, timeSeries, summarize, timeToChange } from "../../web/engine/index.js";
const D = fileURLToPath(new URL("../../web/data", import.meta.url));
const hdr = JSON.parse(readFileSync(`${D}/ephemeris.json`, "utf8")); const eb = readFileSync(`${D}/ephemeris.bin`);
const eph = new Ephemeris(hdr, eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.byteLength));
const cat = JSON.parse(readFileSync(`${D}/sites.json`, "utf8"));
const hb = readFileSync(`${D}/horizons.bin`); const rows = new Int16Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength));
const N = cat.format.azimuths;
const horizonRow = (r) => { const e = new Float64Array(N); for (let k = 0; k < N; k++) e[k] = rows[r*N + k] / 100; return e; };
const spot = cat.spots.find((s) => s.id === "Site01-1");
const row = spot.horizonRows["2"]; const sky = horizonRow(row);
const site = siteFromLatLon(spot.latitudeDeg, spot.longitudeDeg, spot.groundM + 2);
const hz = new Horizon(sky);
const flat = Horizon.flat(1440);
const t0 = parseUtc("2027-01-01T00:00:00"), t1 = parseUtc("2028-01-01T00:00:00");
const yr = timeSeries(eph, site, hz, t0, t1 - 900, 900);
const s = summarize(yr);
// dark stretches
const dark = []; let run = 0, start = 0;
for (let i = 0; i < yr.et.length; i++) { if (yr.sunFraction[i] <= 0) { if (!run) start = i; run++; } else if (run) { dark.push([start, run*0.25]); run = 0; } }
if (run) dark.push([start, run*0.25]);
console.log("Site01-1 2027:", (s.sunlitFraction*100).toFixed(1), "% sun,", (s.earthFraction*100).toFixed(1), "% earth, longest dark", s.longestDarkHours, "h, comms gap", s.longestCommsGapHours, "h, stretches", dark.length, "energy", s.energyWhPerW.toFixed(0));
// daily min/max flat elevations for the polar-sky figure (every 15 min, decimated to hourly)
const hourly = { day: [], sunEl: [], earthEl: [], sunUp: [], earthUp: [] };
for (let i = 0; i < yr.et.length; i += 4) { hourly.day.push((yr.et[i]-t0)/86400); hourly.sunEl.push(+yr.sunElevation[i].toFixed(3)); hourly.earthEl.push(+yr.earthElevation[i].toFixed(3)); hourly.sunUp.push(yr.sunFraction[i] > 0 ? 1 : 0); hourly.earthUp.push(yr.earthFraction[i] > 0 ? 1 : 0); }
// 45 days from 1 March 2027
const m0 = parseUtc("2027-03-01T00:00:00");
const m = timeSeries(eph, site, hz, m0, m0 + 45*86400, 900);
const march = { day: Array.from(m.et, (e) => (e-m0)/86400), sunAz: Array.from(m.sunAzimuth), sunEl: Array.from(m.sunElevation), earthAz: Array.from(m.earthAzimuth), earthEl: Array.from(m.earthElevation), sunF: Array.from(m.sunFraction), earthF: Array.from(m.earthFraction), dsn: Array.from(m.dsnInView) };
// worked example moment
const ex = parseUtc("2027-03-01T06:15:00");
const one = timeSeries(eph, site, hz, ex, ex, 900);
console.log("06:15 1 Mar 2027: sun az", one.sunAzimuth[0].toFixed(1), "el", one.sunElevation[0].toFixed(2), "f", one.sunFraction[0].toFixed(3), "| earth az", one.earthAzimuth[0].toFixed(1), "el", one.earthElevation[0].toFixed(2), "f", one.earthFraction[0].toFixed(3));
console.log("time to sunset", timeToChange(eph, site, hz, ex, "SUN").hours, "earthrise", timeToChange(eph, site, hz, ex, "EARTH").hours);
// Apollo 11 against Site01-1, March 2027 (one lunar day)
const ap = cat.beyond.sites.find((b) => b.id === "a11");
let apollo = null;
if (ap) {
  const aSite = siteFromLatLon(ap.latitudeDeg, ap.longitudeDeg, (ap.groundM ?? 0) + 2);
  const aHz = new Horizon(horizonRow(ap.horizonRow));
  const a = timeSeries(eph, aSite, aHz, m0, m0 + 30*86400, 1800);
  apollo = { day: Array.from(a.et, (e) => (e-m0)/86400), sunEl: Array.from(a.sunElevation), earthEl: Array.from(a.earthElevation) };
  const ay = summarize(timeSeries(eph, aSite, aHz, t0, t1 - 900, 900));
  console.log("Apollo 11 2027 sun", (ay.sunlitFraction*100).toFixed(1), "%");
}
const p30 = timeSeries(eph, site, hz, m0, m0 + 30*86400, 1800);
const pole30 = { day: Array.from(p30.et, (e) => (e-m0)/86400), sunEl: Array.from(p30.sunElevation), earthEl: Array.from(p30.earthElevation) };
writeFileSync(fileURLToPath(new URL("figdata.json", import.meta.url)), JSON.stringify({ summary: s, dark, hourly, march, skyline: Array.from(sky), apollo, pole30,  }));


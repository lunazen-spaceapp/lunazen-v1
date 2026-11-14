// Pure helpers for the Explorer: time and duration text, CSV / ICS export, URL state,
// and the panorama's vertical range. No DOM access, so they are unit-tested in Node.

import { etToUtcMs } from "../engine/index.js";

const pad = (n) => String(n).padStart(2, "0");

export function formatUtc(et, { seconds = false } = {}) {
  const d = new Date(Math.round(etToUtcMs(et) / 1000) * 1000);
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ""}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${hms}`;
}

function icsStamp(et) {
  const d = new Date(Math.round(etToUtcMs(et) / 1000) * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function formatDuration(hours) {
  const h = Math.round(hours);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// An angle in degrees with its sign ("−" for below the flat horizon), or a dash when there is none (the Sun was never up).
export function degText(deg) {
  return deg === null || deg === undefined || Number.isNaN(deg) ? "—" : signedDeg(deg, 1);
}

// An angle with a proper minus sign for a negative value (not a hyphen), a zero value unsigned, and `digits` decimals.
export function signedDeg(deg, digits = 2) {
  const t = Math.abs(deg).toFixed(digits);
  return `${deg < 0 && Number(t) !== 0 ? "−" : ""}${t}°`;
}

// A share as a percentage. "100%" only for a whole share: 99% and above is cut down to a tenth ("99.9%"), below 10% it keeps a decimal.
export function pctText(share) {
  const p = share * 100;
  if (p >= 99 && p < 100) return `${(Math.floor(p * 10) / 10).toFixed(1)}%`;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

// The share a flat array captures, said plainly when it is next to nothing.
export const flatText = (share) => (share < 0.0005 ? "almost none" : pctText(share));

// Wording for terms that are easy to over-read; one text for every page that shows the label.
export const DSN_HINT = "Line of sight only: Earth above the skyline here, and a Deep Space Network complex seeing the Moon above 10°. It does not include antenna scheduling or the strength of the radio link.";
export const NIGHT_HINT = "The longest stretch with no part of the Sun above the skyline. A thin sliver of Sun ends the night here but gives a lander little power. Eclipses are not modelled.";
export const ARRAY_HINT = "A vertical panel that turns to face the Sun. Fixed panels collect less.";
export const hintHtml = (text) => `<button type="button" class="hint" data-hint="${text}">ⓘ</button>`;

// What the Sun energy figure is (one wording for the Explorer, Compare and the spot rows).
export const ENERGY_HINT = "Wh a 1 W Sun-tracking upright solar array would collect, which is the same number as the hours of full Sun it equals. The Sun stays within a few degrees of level near the pole, so its light arrives almost edge-on and the total is small; a flat array would collect far less. Counts only the part of the Sun above the terrain. Ignores temperature, dust and the small change in sunlight with Earth's distance. A Sun-tracking upright array suits the low polar Sun; at a high Sun it understates the light a Sun-pointing panel could collect. A measure of light, not of any lander.";

// What the light a Sun-tracking upright and a flat array capture means.
export const CAPTURE_HINT = "A Sun-tracking upright array is a vertical panel that turns to face the Sun; fixed panels collect less. Of the light the Sun puts out while it is up, the share a Sun-tracking upright array turning to face the Sun captures (it loses the cosine of the Sun's elevation), and the share a flat array captures (the sine). Near the pole the low Sun suits the Sun-tracking upright array and almost wastes the flat one.";

// What the Sun's highest elevation is, and why a higher Sun is not a better spot.
export const SUN_HIGHEST_LABEL = "Peak Sun elevation";
export const SUN_HIGHEST_HINT = "The highest the centre of the Sun climbs above a level horizon in this window. Negative means below a level horizon: the Sun can still be visible, because the ground falls away from a ridge-top site. It depends on where the spot is (it grows with distance from the pole), not on the terrain. A higher Sun is not a better spot: terrain decides how long it is up, and a Sun-tracking upright array loses almost nothing to a low Sun.";

// How far the centre of a body's disk sits above or below the skyline in its direction (margin, degrees).
export function clearanceText(marginDeg) {
  const m = Math.abs(marginDeg).toFixed(2);
  return Number(m) === 0 ? "level with the skyline" : `${m}° ${marginDeg > 0 ? "above" : "below"} the skyline`;
}

// rows: [{ body: "Sun" | "Earth", startEt, endEt }]
export function windowsToCsv(rows, label) {
  const lines = ["site,body,start_utc,end_utc,duration_h"];
  for (const r of rows) {
    lines.push([label, r.body, formatUtc(r.startEt), formatUtc(r.endEt), ((r.endEt - r.startEt) / 3600).toFixed(1)].join(","));
  }
  return `${lines.join("\n")}\n`;
}

const describeVisibility = (r) => (r.body === "Sun" ? "Sunlight" : "Earth in view (direct-to-Earth possible)");

export function windowsToIcs(rows, label, nowEt, describe = describeVisibility) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LunaZen Landing Site Navigator//Explorer//EN", "CALSCALE:GREGORIAN"];
  rows.forEach((r, i) => {
    const what = describe(r);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${label}-${r.body}-${i}-${icsStamp(r.startEt)}@lunazen-landing-site-navigator`,
      `DTSTAMP:${icsStamp(nowEt)}`,
      `DTSTART:${icsStamp(r.startEt)}`,
      `DTEND:${icsStamp(r.endEt)}`,
      `SUMMARY:${label}: ${what}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

// URL hash <-> state. Unknown keys are ignored; numbers are parsed; defaults fill gaps.
const NUMERIC = new Set(["mast", "days", "t", "mission", "dark", "link", "within", "dbelow", "dstation"]);

export function parseState(hash, defaults) {
  const state = { ...defaults };
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ""))) {
    if (!(key in defaults)) continue;
    if (!NUMERIC.has(key)) { state[key] = value; continue; }
    const n = Number(value);
    if (value !== "" && Number.isFinite(n)) state[key] = n; // a bad number keeps the default
  }
  return state;
}

// The hash another tool needs to open the same spot: Compare takes a list of sites, Rank none (it ranks every
// spot), the others one spot. Windows calls the date "date", and Rank calls the mission length "days". The lander's
// mission length, rule, dark hours and DSN share go only to the pages that have those controls.
const LANDER_PAGES = new Set(["planner.html", "windows.html", "rank.html"]);
export function carryHash(page, { spot, mast, start, mission, rule, dark, link, within, dbelow, dstation }) {
  const out = {};
  if (spot !== undefined && page !== "rank.html") out[page === "sidebyside.html" ? "sites" : "spot"] = spot;
  out.mast = mast;
  out[page === "windows.html" ? "date" : "start"] = start;
  if (mission !== undefined && LANDER_PAGES.has(page)) Object.assign(out, { [page === "rank.html" ? "days" : "mission"]: mission, rule, dark, link, ...(within !== undefined ? { within } : {}) });
  // The darkness threshold goes to the pages that count nights (the lander pages and the Explorer); 0 is the default and stays out of the address.
  if (dbelow && (LANDER_PAGES.has(page) || page === "explorer.html")) out.dbelow = dbelow;
  // Likewise the DSN line-of-sight test: 0 (any part of Earth) is the default; 1 tests the station itself.
  if (dstation && (LANDER_PAGES.has(page) || page === "explorer.html")) out.dstation = dstation;
  return serializeState(out);
}

// "Count as dark when less than ...% of the Sun is visible": 0 means any part of the Sun ends the night (the default).
export const DARK_BELOW_OPTIONS = [0, 10, 50];
export const normalizeDarkBelow = (v) => (DARK_BELOW_OPTIONS.includes(Number(v)) ? Number(v) : 0);
export const darkBelowText = (pct) => (pct ? `dark below ${pct}% of the Sun` : "");
export const darkBelowSuffix = (pct) => (pct ? ` (${darkBelowText(pct)})` : "");

// "DSN line of sight": 0 tests whether any part of Earth is above the skyline (the default); 1 tests the DSN station itself.
export const normalizeDstation = (v) => (Number(v) === 1 ? 1 : 0);
export const dsnRuleOf = (dstation) => (dstation ? "station" : undefined);
export const dsnSuffix = (dstation) => (dstation ? " (station itself)" : "");

// The hash that shows a site on the Map, or null where the Map cannot (it is a south-polar picture).
// site: { id, kind: "spot" | "mission" | "custom" | "beyond", latitudeDeg, longitudeDeg }.
export function mapHash({ id, kind, latitudeDeg, longitudeDeg }) {
  if (kind === "spot") return serializeState({ spot: id });
  if (kind === "mission") return latitudeDeg < -79 ? serializeState({ landing: id }) : null;
  if (kind === "custom") return serializeState({ lat: latitudeDeg.toFixed(4), lon: longitudeDeg.toFixed(4) });
  return null;
}

export function serializeState(state) {
  // dbelow 0 (any part of the Sun ends a night) is the default; leaving it out keeps every earlier address as it was.
  return `#${new URLSearchParams(Object.entries(state).filter(([k, v]) => !((k === "dbelow" || k === "dstation") && !v)).map(([k, v]) => [k, String(v)])).toString()}`;
}

// Vertical range (deg) for the panorama: covers the horizon and both tracks with a margin,
// at least `minSpan` degrees tall.
export function panoramaRange(arrays, { margin = 1, minSpan = 8 } = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo -= margin;
  hi += margin;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return [Math.floor(lo), Math.ceil(hi)];
}

// Calendar date (YYYY-MM-DD) -> ET, clamped into the ephemeris coverage.
export function clampDate(isoDate, minIso, maxIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return minIso;
  return isoDate < minIso ? minIso : isoDate > maxIso ? maxIso : isoDate;
}

// "Connecting Ridge (2022 list); de Gerlache Rim 2 (2022 and 2024 lists; outer part of NASA's data area)",
// or "" outside every region. matches: [{name, central}] from sites.json.
export function artemisLabel(matches, regions) {
  return matches.map(({ name, central }) => {
    const lists = regions.find((r) => r.name === name)?.lists ?? [];
    const edge = central ? "" : "; outer part of NASA's data area";
    return `${name} (${lists.join(" and ")} list${lists.length > 1 ? "s" : ""}${edge})`;
  }).join("; ");
}

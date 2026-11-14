// The Map's "Add your own point": what a typed or picked latitude and longitude means, before the engine is asked.
// Pure functions, so every message is tested. `areas` are the usable areas of the 13 sites (data/custom/custom.json: the site's
// box less a 2 km margin), `tiles` the boxes themselves (data/map.json); metres in the polar map frame.

import { latLonToPolar, polarToLatLon } from "./maputil.js";

export const MARGIN_KM = 2;
export const MESSAGES = {
  empty: "Enter a latitude and a longitude, or pick a point on the map.",
  oneEmpty: "Enter both a latitude and a longitude.",
  latNumber: "Latitude must be a number, for example −89.46.",
  lonNumber: "Longitude must be a number, for example 222.6.",
  latPositive: "Use a negative latitude for the south pole, for example −89.46.",
  latRange: "LunaZen's site maps cover 84°S to 90°S. Pick a point inside a dashed box.",
  lonRange: "Longitude must be between 0 and 360 (or −180 to 180).",
  outside: "This point is outside the areas that can be traced. Pick a spot inside a dashed site box.",
};

// The short note under the field a message is about.
export const NOTES = { required: "Required", number: "Not a number", negative: "Use a negative value", range: "Out of range" };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// A typed number: the minus sign "−" and a decimal comma are accepted; anything else, and an empty field, is NaN.
export function parseNumber(text) {
  const t = String(text ?? "").trim().replace("−", "-").replace(",", ".");
  return NUMBER.test(t) ? Number(t) : NaN;
}

// Distance (m) from a point to an area, 0 inside it.
export const distanceTo = (x, y, a) => Math.hypot(Math.max(a.xMinM - x, 0, x - a.xMaxM), Math.max(a.yMinM - y, 0, y - a.yMaxM));
const km = (m) => (m / 1000).toFixed(1);
const inside = (x, y, a) => distanceTo(x, y, a) === 0;

// The usable area nearest to a point: { site, km }.
export function nearestArea(x, y, areas) {
  let best = null;
  for (const site of areas) {
    const d = distanceTo(x, y, site.interior);
    if (!best || d < best.m) best = { site, m: d };
  }
  if (!best) return null;
  const i = best.site.interior; // a point just inside the nearest usable area, for the "Nearest" link to place
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo + 1), hi - 1);
  return { site: best.site, km: km(best.m), x: clamp(x, i.xMinM, i.xMaxM), y: clamp(y, i.yMinM, i.yMaxM) };
}

// The verdict on a point in the map frame (a click, or typed coordinates once they are numbers). Accepted: { ok: true, site, lat, lon, x, y }.
// Rejected: { ok: false, field, message, nearest }, field being "lat", "lon" or null.
export function checkXY(x, y, { areas, tiles }) {
  const [lat, lon] = polarToLatLon(x, y);
  const site = areas.find((s) => inside(x, y, s.interior)) ?? null;
  if (site) return { ok: true, site, lat, lon, x, y, readAs: "" };
  const tile = tiles.find((t) => x >= t.x0M && x <= t.x1M && y >= t.y0M && y <= t.y1M);
  if (tile) {
    const area = areas.find((s) => s.id === tile.id);
    const move = km(distanceTo(x, y, area.interior));
    return { ok: false, x, y, field: null, edge: tile.name, message: `Too close to the edge of the ${tile.name} box: a point needs ${MARGIN_KM} km of map around it. Move it ${move} km inward.`, nearest: null };
  }
  return { ok: false, x, y, field: null, message: MESSAGES.outside, nearest: nearestArea(x, y, areas) };
}

// The verdict on the two fields as typed. A rejection names the field it is about and a short note for under that field.
export function checkInput(latText, lonText, geometry) {
  const empty = (t) => String(t ?? "").trim() === "";
  const no = (field, message, note) => ({ ok: false, field, message, note, nearest: null });
  if (empty(latText) && empty(lonText)) return no(null, MESSAGES.empty, "");
  if (empty(latText)) return no("lat", MESSAGES.oneEmpty, NOTES.required);
  if (empty(lonText)) return no("lon", MESSAGES.oneEmpty, NOTES.required);
  const lat = parseNumber(latText);
  if (Number.isNaN(lat)) return no("lat", MESSAGES.latNumber, NOTES.number);
  const lonRaw = parseNumber(lonText);
  if (Number.isNaN(lonRaw)) return no("lon", MESSAGES.lonNumber, NOTES.number);
  if (lat > 0) return no("lat", MESSAGES.latPositive, NOTES.negative);
  if (lat < -90 || lat > -80) return no("lat", MESSAGES.latRange, NOTES.range);
  if (lonRaw < -180 || lonRaw > 360) return no("lon", MESSAGES.lonRange, NOTES.range);
  const lon = ((lonRaw % 360) + 360) % 360;
  const [x, y] = latLonToPolar(lat, lon);
  const verdict = checkXY(x, y, geometry);
  if (!verdict.ok) return { ...verdict, field: null, note: "" };
  return { ...verdict, lat, lon, readAs: lonRaw < 0 ? `(read as ${lon.toFixed(1)}°E)` : "" };
}

export const coordinatesText = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat < 0 ? "S" : "N"} ${lon.toFixed(4)}°E`;

// The four figures of a point, as the tiles show them: the year's summary of the engine (the same one the Explorer's year view shows).
export const FIGURES = [
  { key: "sun", label: (year) => `Sunlit share, ${year}`, hint: "Share of {year} with at least part of the Sun above the real skyline at this spot." },
  { key: "earth", label: () => "Earth in view", hint: "Share of {year} with at least part of Earth above the skyline." },
  { key: "night", label: () => "Longest night", hint: null }, // NIGHT_HINT of format.js
  { key: "gap", label: () => "Longest gap without DSN in view", hint: "Longest stretch in {year} with no Deep Space Network station in view. Line of sight only; no link budget or scheduling." },
];

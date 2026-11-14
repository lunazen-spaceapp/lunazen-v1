// My points: up to five south-pole points the visitor saved (from the Map's "Your own point"), kept in this browser.
// A spot is a custom id (pt_<lat>_<lon>, engine/custom.js) and a short name; the terrain is traced when a page needs it
// (customs.js). Nothing leaves the browser: the list moves between people and devices as a link (shareHash).

import { customId, parseCustomId } from "../engine/index.js";

export const MAX_MINE = 5;
export const NAME_MAX = 30;
const KEY = "lunazen.myspots";

let fallback = null; // the list for this page when the browser does not let us store one (private mode)

const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

// The id the tracer registers a point under: coordinates to four decimals.
const canonical = (id) => { const p = parseCustomId(id); return p ? customId(p.latitudeDeg, p.longitudeDeg) : ""; };

const clean = (list) => {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const id = canonical(typeof item?.id === "string" ? item.id : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(item.name ?? "").trim().slice(0, NAME_MAX) || `My point ${out.length + 1}` });
    if (out.length === MAX_MINE) break;
  }
  return out;
};

export function loadMine(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
  } catch { /* unreadable or corrupt: start empty */ }
  return fallback ? clean(fallback) : [];
}

function save(list, storage) {
  fallback = list;
  try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* the list lasts for this page only */ }
  return list;
}

// The lowest "My point N" not in use, so a removed name is reused.
export const freeName = (list) => {
  const used = new Set(list.map((s) => s.name));
  for (let n = 1; ; n++) if (!used.has(`My point ${n}`)) return `My point ${n}`;
};

// Save a spot. Returns { ok, reason, list }: reason is "full", "duplicate" or "invalid" when ok is false.
export function addMine(rawId, name = "", storage = defaultStorage()) {
  const list = loadMine(storage);
  const id = canonical(rawId);
  if (!id) return { ok: false, reason: "invalid", list };
  if (list.some((s) => s.id === id)) return { ok: false, reason: "duplicate", list };
  if (list.length >= MAX_MINE) return { ok: false, reason: "full", list };
  const next = [...list, { id, name: String(name).trim().slice(0, NAME_MAX) || freeName(list) }];
  return { ok: true, reason: "", list: save(next, storage) };
}

export function removeMine(id, storage = defaultStorage()) {
  return save(loadMine(storage).filter((s) => s.id !== canonical(id)), storage);
}

// Give a saved spot a new name (empty keeps the old one). Returns the list.
export function renameMine(id, name, storage = defaultStorage()) {
  const want = canonical(id);
  const next = String(name).trim().slice(0, NAME_MAX);
  return save(loadMine(storage).map((s) => (s.id === want && next ? { ...s, name: next } : s)), storage);
}

// The name of a saved spot, or null (for labels on pages that only know the id).
export const mineName = (id, storage = defaultStorage()) => loadMine(storage).find((s) => s.id === canonical(id))?.name ?? null;

// What to call a spot on a page: a saved spot's name, "Custom point 86.7065°S 332.226°E" for another custom point, else the id.
export function spotName(id, storage = defaultStorage()) {
  const saved = mineName(id, storage);
  if (saved) return saved;
  const p = parseCustomId(id);
  return p ? `Custom point ${Math.abs(p.latitudeDeg).toFixed(4)}°${p.latitudeDeg < 0 ? "S" : "N"} ${p.longitudeDeg.toFixed(3)}°E` : id;
}

// Where a saved spot is, for labels and the Map.
export const mineLatLon = (id) => parseCustomId(id);

// A link's #mine=... value: "lat,lon,name" entries joined by ";" (the id is rebuilt from the rounded coordinates).
export function shareValue(list) {
  return list.map((s) => { const p = parseCustomId(s.id); return `${p.latitudeDeg.toFixed(4)},${p.longitudeDeg.toFixed(4)},${s.name.replace(/[;,\s]+/g, " ")}`; }).join(";");
}

export function readShareValue(value) {
  const items = String(value ?? "").split(";").map((part) => {
    const [lat, lon, ...name] = part.split(",");
    const [la, lo] = [Number(lat), Number(lon)];
    if (!lat?.trim() || !lon?.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return { id: customId(la, lo), name: name.join(",") };
  }).filter(Boolean);
  return clean(items);
}

// Test hook: forget the in-page list.
export const _resetForTests = () => { fallback = null; };

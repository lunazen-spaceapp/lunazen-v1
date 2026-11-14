// Pins: up to four landings the visitor wants to compare. A pin keeps the whole question it came from
// and the landing time, not only the result, so a review can see exactly what was asked. The list lives in this browser's
// localStorage and travels as the Compare page's `pins` link value; the link is authoritative.

import { goalLabel } from "./query-model.js";
import { darkBelowSuffix, dsnSuffix, normalizeDarkBelow, normalizeDstation } from "./format.js";
import { normalizeReach, sentenceText, worksText } from "./reach.js";

export const MAX_PINS = 4;
const KEY = "lunazen.pins";
export const DATA_VERSION = "LunaZen Landing Site Navigator; ephemeris NASA/JPL DE440 (2024-2043); terrain NASA PGDA and LRO LOLA; every 15 minutes; skyline test 0.25 degrees";

let fallback = null; // the list for this page when the browser does not let us store one

const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const KINDS = new Set(["robust", "spot", "night", "dsn"]);
const GOALS = new Set(["earliest", "margin", "longest", "all"]);

// The fields of a pin: the landing (spot, landing time, mast, mission days, the darkness rule and DSN share) and the question
// it answered (goal, first day and number of days of the search), with what it was when pinned (kind).
function clean(p) {
  if (!p || typeof p.spot !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(p.landing ?? "")) return null;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
  return {
    spot: p.spot, landing: p.landing, mast: num(p.mast, 0.5, 50, 2), mission: Math.round(num(p.mission, 1, 120, 14)),
    rule: typeof p.rule === "string" && p.rule ? p.rule : "viper", dark: num(p.dark, 0, 2000, 50), link: Math.round(num(p.link, 0, 100, 50)),
    goal: GOALS.has(p.goal) ? p.goal : "earliest", start: /^\d{4}-\d{2}-\d{2}$/.test(p.start ?? "") ? p.start : p.landing.slice(0, 10),
    days: Math.round(num(p.days, 1, 366, 61)), kind: KINDS.has(p.kind) ? p.kind : "spot",
    within: normalizeReach(Number(p.within)), // how far the lander may miss; pins from before it was a choice are 100 m
    dstation: normalizeDstation(p.dstation), // 1: the DSN station itself must clear the skyline; pins from before it was a choice test any part of Earth (0)
    dbelow: normalizeDarkBelow(p.dbelow), // the Sun counts as down below this percent visible; pins from before it was a choice use 0 (any part ends the night)
  };
}

export const pinId = (p) => [p.spot, p.landing, p.mast, p.mission, p.rule, p.dark, p.link, p.within ?? 100, ...(p.dbelow ? [p.dbelow] : []), ...(p.dstation ? [`s${p.dstation}`] : [])].join("|");

export function loadPins(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return cleanList(JSON.parse(raw));
  } catch { /* unreadable: start empty */ }
  return fallback ? cleanList(fallback) : [];
}

function cleanList(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const p = clean(item);
    if (!p || seen.has(pinId(p))) continue;
    seen.add(pinId(p));
    out.push(p);
    if (out.length === MAX_PINS) break;
  }
  return out;
}

export function savePins(list, storage = defaultStorage()) {
  const next = cleanList(list);
  fallback = next;
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* the list lasts for this page only */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pinschange"));
  return next;
}

// Returns { ok, reason, list }: reason is "full", "duplicate" or "invalid" when ok is false.
export function addPin(pin, storage = defaultStorage()) {
  const list = loadPins(storage);
  const p = clean(pin);
  if (!p) return { ok: false, reason: "invalid", list };
  if (list.some((x) => pinId(x) === pinId(p))) return { ok: false, reason: "duplicate", list };
  if (list.length >= MAX_PINS) return { ok: false, reason: "full", list };
  return { ok: true, reason: "", list: savePins([...list, p], storage) };
}

export const removePin = (id, storage = defaultStorage()) => savePins(loadPins(storage).filter((p) => pinId(p) !== id), storage);
export const isPinned = (pin, storage = defaultStorage()) => loadPins(storage).some((p) => pinId(p) === pinId(pin));

// ---- the link value: pins joined by ";", fields by "," (names have no commas: spot ids and rule ids)
const FIELDS = ["spot", "landing", "mast", "mission", "rule", "dark", "link", "goal", "start", "days", "kind", "within", "dbelow", "dstation"];
// The darkness threshold and the DSN line-of-sight test are the last fields and are left out when they are 0, so addresses made before they existed read the same.
export const pinsToValue = (list) => list.map((p) => FIELDS.filter((f) => (f !== "dbelow" || p.dbelow || p.dstation) && (f !== "dstation" || p.dstation)).map((f) => String(p[f]).replace(/[;,]/g, "_")).join(",")).join(";");
export function pinsFromValue(value) {
  const items = String(value ?? "").split(";").filter(Boolean).map((part) => {
    const v = part.split(",");
    return clean(Object.fromEntries(FIELDS.map((f, i) => [f, v[i]])));
  }).filter(Boolean);
  return cleanList(items);
}

// ---- text

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const pinDay = (landing) => `${Number(landing.slice(8, 10))} ${MONTHS[Number(landing.slice(5, 7)) - 1]} ${landing.slice(0, 4)}`;
export const pinTime = (landing) => `${landing.slice(11, 13)}:00 UTC`;

// The question a pin answered, in the Planner's words, for the cards, exports and tooltips. limitH: the darkness limit in hours.
export function pinSentence(p, limitH, name = p.spot) {
  const end = new Date(Date.parse(`${p.start}T00:00:00Z`) + (p.days - 1) * 86400000).toISOString().slice(0, 10);
  return `Identify ${goalLabel(p.goal)} at ${name} from ${pinDay(p.start)} to ${pinDay(end)} for a ${p.mission} d mission – max night ${limitH} h${darkBelowSuffix(p.dbelow)}, min DSN ${p.link > 0 ? `≥ ${p.link}%` : "none"}${dsnSuffix(p.dstation)}, mast ${p.mast} m, ${sentenceText(p.within)}.`;
}

export const _resetForTests = () => { fallback = null; };

// ---- the decision record: CSV and calendar, with each pin's question and the data version
// entries: [{ pin, name, landing (the time shown, shifted or not), kind, limitH, longestNightH, dsnShare, neighbours: "12 of 12",
// holds: true|false, shiftDays }]
const csvText = (v) => `"${String(v).replace(/"/g, '""')}"`;
const KIND_TEXT = (within) => ({ robust: worksText(within), spot: "valid at the target spot only", night: "fail: night exceeds limit", dsn: "fail: DSN visibility below threshold" });
export const kindText = (kind, within) => KIND_TEXT(within)[kind];

export function pinsToCsv(entries) {
  const head = ["pin", "spot", "landing_utc", "mast_m", "mission_days", "night_limit_h", "dsn_min_pct", "verdict", "longest_night_h", "dsn_share_pct", "neighbours_working", "holds_skyline_plus_0_25", "shift_days", "question", "data_version"];
  const lines = entries.map((e, i) => [i + 1, e.name, `${e.landing.slice(0, 10)} ${e.landing.slice(11, 13)}:00`, e.pin.mast, e.pin.mission, e.limitH, e.pin.link, kindText(e.kind, e.pin.within),
    e.longestNightH.toFixed(1), (e.dsnShare * 100).toFixed(1), e.neighbours, e.holds ? "yes" : "no", e.shiftDays ?? 0, csvText(pinSentence({ ...e.pin, landing: e.landing }, e.limitH, e.name)), csvText(DATA_VERSION)].join(","));
  return `${[head.join(","), ...lines].join("\n")}\n`;
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
export function pinsToIcs(entries, nowMs = Date.now()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LunaZen Landing Site Navigator//Compare//EN", "CALSCALE:GREGORIAN"];
  entries.forEach((e, i) => {
    const start = Date.parse(`${e.landing.slice(0, 10)}T${e.landing.slice(11, 13)}:00:00Z`);
    lines.push("BEGIN:VEVENT", `UID:${e.pin.spot}-${stamp(start)}-${i}@lunazen-landing-site-navigator`, `DTSTAMP:${stamp(nowMs)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + e.pin.mission * 86400000)}`,
      `SUMMARY:${e.name} landing (${kindText(e.kind, e.pin.within)})`,
      `DESCRIPTION:${pinSentence({ ...e.pin, landing: e.landing }, e.limitH, e.name).replace(/[,;]/g, (c) => `\\${c}`)}\\n${DATA_VERSION.replace(/[,;]/g, (c) => `\\${c}`)}`, "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

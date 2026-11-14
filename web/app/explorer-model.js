// What the Explorer's panels say that is built from numbers: the dates in the design's shorter form, the cards of "This moment", the figure groups of
// the Visibility Timeline and its notes. Pure functions (no DOM), so the wording is tested. Every number is given by the caller.

import { countdown } from "./moment.js";
import { flatText, formatDuration, pctText, signedDeg } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (text) => { const [, y, m, d, hm] = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(text); return { y: Number(y), m: Number(m) - 1, d: Number(d), hm }; };

// "2027-03-09 06:15" -> "9 Mar"; "1 Mar 00:00" with the time; "1 Mar 2027, 06:15 UTC" for the moment's heading.
export const shortDate = (text) => { const p = parts(text); return `${p.d} ${MONTHS[p.m]}`; };
export const shortDateTime = (text) => { const p = parts(text); return `${p.d} ${MONTHS[p.m]} ${p.hm}`; };
export const momentHeading = (text) => { const p = parts(text); return `${p.d} ${MONTHS[p.m]} ${p.y}, ${p.hm} UTC`; };

// "1–30 March 2027 at Site01-1": the first and last day of the window, in as few words as are clear.
export function periodTitle(startIso, endIso, place) {
  const a = parts(startIso), b = parts(endIso);
  const span = a.y === b.y && a.m === b.m ? `${a.d}–${b.d} ${LONG_MONTHS[b.m]} ${b.y}`
    : a.y === b.y ? `${a.d} ${LONG_MONTHS[a.m]}–${b.d} ${LONG_MONTHS[b.m]} ${b.y}`
      : `${a.d} ${LONG_MONTHS[a.m]} ${a.y}–${b.d} ${LONG_MONTHS[b.m]} ${b.y}`;
  return `${span} at ${place}`;
}

// A card of "This moment". who: "The Sun" or "Earth"; body: { fraction, elevation, margin } from the engine; change: { up, hours } from timeToChange.
export function bodyCard(who, body, change) {
  const seen = body.fraction >= 0.999 ? "fully visible" : body.fraction > 0 ? "partly visible" : "hidden by the terrain";
  const next = change.hours === null ? `${change.up ? "stays up" : "stays hidden"} for 30 days or more` : `${change.up ? "sets" : "rises"} in ${countdown(change.hours)}`;
  const m = Math.abs(body.margin).toFixed(2);
  return {
    status: `${who} · ${seen}`,
    up: body.fraction > 0,
    next,
    clearance: `${m}° ${body.margin >= 0 ? "above" : "below"} the skyline · ${signedDeg(body.elevation)} from level`,
  };
}

export const dsnTag = (link) => (link ? "DSN station in view" : "No DSN station in view");

// The three groups of figures. v: { summary, highest, capture, stats, limitH, darkSuffix, dsnSuffix, pct }; each figure is { key, label, tip, value, line }.
export function figureGroups({ summary: s, highest, capture, stats, limitH, darkSuffix = "", dsnSuffix = "", pct, degText, shortDay }) {
  const clears = stats.sunlitSamples ? stats.maxSun > 0 : false;
  return [
    { title: "Sunlight and power", figures: [
      { key: "sun", label: "Sun up", tip: "Share of the period with at least part of the Sun above the real skyline.", value: pct(s.sunlitFraction), line: "of the period, any part of the disk" },
      { key: "clearance", label: "Best clearance", tip: "Highest the Sun gets above the real skyline in this period; and its highest point above a level horizon.",
        value: clears ? `${stats.maxSun.toFixed(2)}°` : "—", line: clears ? `above the skyline (${shortDay(stats.maxSunEt)}) · ${degText(highest)} from level` : "the Sun never clears the skyline in this window" },
      { key: "array", label: "Sun-tracking array", tip: "Share of available sunlight an upright panel that turns to face the Sun would catch.",
        value: capture ? pctText(capture.upright) : "Never up", line: capture ? `of the light it could catch · flat panel ${flatText(capture.flat)}` : "the Sun is not up in this window" },
      { key: "energy", label: "Sun energy", tip: "Equivalent hours of full Sun on a Sun-tracking upright panel.", value: `${Math.round(s.energyWhPerW).toLocaleString("en-US")} h`, line: "of full Sun (Wh per W of panel)" },
    ] },
    { title: "Darkness", figures: [
      { key: "night", label: `Longest night${darkSuffix}`, tip: "The longest stretch with no part of the Sun above the skyline. Eclipses are not modelled.", value: formatDuration(s.longestDarkHours),
        line: `${s.longestDarkHours > limitH ? "above" : "within"} a ${limitH} h darkness limit (VIPER's design figure)` },
    ] },
    { title: "Contact with Earth", figures: [
      { key: "earth", label: "Earth in view", tip: "Share of the period with at least part of Earth above the skyline.", value: pct(s.earthFraction), line: "of the period" },
      { key: "dsn", label: `DSN in view${dsnSuffix}`, tip: "Earth above the skyline and a DSN station seeing the Moon above 10°. Line of sight only.", value: pct(s.dsnLinkFraction), line: "of the period" },
      { key: "gap", label: "Longest DSN gap", tip: "Longest stretch with no Deep Space Network station in view.", value: formatDuration(s.longestDsnLinkGapHours), line: "without a DSN station in view" },
    ] },
  ];
}

// The two notes under the clearance chart. rows: [{ error, sunlit, darkHours }] for each higher skyline; pct: the share formatter.
export function clearanceNotes(stats, rows, pct, shortDay) {
  const sun = stats.sunlitSamples
    ? `The Sun clears the skyline by at most ${stats.maxSun.toFixed(2)}° (${shortDay(stats.maxSunEt)}); ${pct(stats.nearShare)} of the sunlit time is within 0.25° of it.`
    : `The Sun is never above the skyline in this window (at best ${Math.abs(stats.maxSun).toFixed(2)}° below it).`;
  const higher = rows.map((r, i) => `${i === 0 ? "If the skyline were" : "If"} ${r.error}° higher: Sun up ${pct(r.sunlit)}, longest night ${formatDuration(r.darkHours)}`).join(". ");
  return rows.length ? [sun, `${higher}.`] : [sun];
}

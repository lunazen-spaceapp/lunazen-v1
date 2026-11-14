// The Planner's question and its answer, as plain data. A query is a spot, a date range, a
// mission length, a darkness limit, a DSN requirement and a mast; the engine tests every landing time in it (rows from
// plan.js `combine`/`withRaisedSkyline`), and this module turns the rows into the heatmap, the runs and the verdict.
// No DOM access, so it is unit-tested in Node.

import { darkBelowSuffix, formatUtc } from "./format.js";
import { dayLabel } from "./plan.js";
import { worksText, workText } from "./reach.js";

export const MAX_RANGE_DAYS = 366; // a year; the heatmap draws it in blocks of HEAT_BLOCK_DAYS
export const HEAT_BLOCK_DAYS = 92;
export const SKYLINE_DEG = 0.25; // the skyline test every landing is held to (engine SKYLINE_TEST_DEG)

export const GOALS = [
  { id: "earliest", label: "earliest valid window", name: "Earliest valid window", about: "The first landing time that is valid at the target spot and at every dispersion point of the radius you chose." },
  { id: "margin", label: "shortest-night window", name: "Shortest night", about: "The valid landing time with the shortest dark period: the most room against your night limit." },
  { id: "longest", label: "widest valid window", name: "Widest window", about: "The start of the longest stretch of valid landing times: the most room if the date slips." },
  { id: "all", label: "every valid window", name: "Every window", about: "All stretches of valid landing times, earliest first." },
];
export const goalLabel = (id) => GOALS.find((g) => g.id === id)?.label ?? GOALS[0].label;

// ---- text

// Durations under 48 hours are written in hours, longer ones in days and hours (spec §8).
export function spanText(hours) {
  const h = Math.round(hours);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

// "20 Mar 2027, 06:00 UTC" for a landing time (ET).
export function whenText(et) {
  const t = formatUtc(et);
  return `${dayLabel(t.slice(0, 10))}, ${t.slice(11, 16)} UTC`;
}

// "20 Mar, 06:00" for the run table.
export function shortWhen(et) {
  const t = formatUtc(et);
  return `${dayLabel(t.slice(0, 10)).slice(0, -5)} ${t.slice(11, 16)}`;
}

// ---- dates

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) => iso(ms(day) + n * DAY_MS);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY_MS);

// The last day of a query: `days` days from `start`.
export const rangeEnd = (start, days) => addDays(start, days - 1);

// A new start or end, kept inside the rules: an end before the start moves to the start plus 30 days, and a
// range over 92 days is cut to 92. Returns { start, days }.
export function setRange(start, end) {
  if (ms(end) < ms(start)) end = addDays(start, 30);
  let days = daysBetween(start, end) + 1;
  if (days > MAX_RANGE_DAYS) days = MAX_RANGE_DAYS;
  return { start, days };
}

// ---- one landing time

// What a row is, for the heatmap (spec §4.3): "night" and "dsn" are failures at the spot (the night is checked first),
// "spot" works at the spot only, "robust" works at the spot and all its nearby points.
export function cellKind(row, rule) {
  if (!row.ok) return row.centre.longestDarkHours > rule.maxDarkHours ? "night" : "dsn";
  return row.robustness === 1 ? "robust" : "spot";
}

// The darkness limit minus the longest dark over the spot and its nearby points: what is left to spare.
export const worstDark = (row) => Math.max(...row.points.map((p) => p.longestDarkHours));
export const marginHours = (row, rule) => rule.maxDarkHours - worstDark(row);

// How the nearby points fail: counts by reason (the night is checked first), as for the spot.
export function neighbourFailures(row, rule) {
  let night = 0, dsn = 0;
  for (const p of row.points.slice(1)) {
    if (p.ok) continue;
    if (p.longestDarkHours > rule.maxDarkHours) night++; else dsn++;
  }
  return { night, dsn, total: night + dsn };
}

// ---- runs and the answer

// Maximal stretches of consecutive robust landing times (the rows are every 6 h with no gaps). Each run: first and last
// row index, count, first/last time, the best margin and whether every landing holds with the skyline raised.
export function robustRuns(rows, rule) {
  const runs = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (cellKind(r, rule) !== "robust") { cur = null; return; }
    if (!cur) { cur = { first: i, last: i, count: 0, margin: -Infinity, bestRow: i, holds: 0 }; runs.push(cur); }
    cur.last = i;
    cur.count++;
    const m = marginHours(r, rule);
    if (m > cur.margin) { cur.margin = m; cur.bestRow = i; }
    if (r.holdsRaised) cur.holds++;
  });
  return runs.map((r) => ({ ...r, startEt: rows[r.first].startEt, endEt: rows[r.last].startEt }));
}

// The runs in the order of the goal: soonest first, except the shortest night (largest margin first) and the widest window (longest first).
export function sortRuns(runs, goal) {
  const by = goal === "margin" ? (a, b) => b.margin - a.margin || a.first - b.first
    : goal === "longest" ? (a, b) => b.count - a.count || a.first - b.first
      : (a, b) => a.first - b.first;
  return [...runs].sort(by);
}

// The row nearest to meeting the brief when none does: the least shortfall in the night (against the limit) and the DSN
// share (against the requirement), each as a share of what was asked.
export function closestLanding(rows, rule) {
  let best = -1, score = Infinity;
  rows.forEach((r, i) => {
    const night = Math.max(0, r.centre.longestDarkHours - rule.maxDarkHours) / Math.max(rule.maxDarkHours, 1);
    const link = rule.minLinkFraction > 0 ? Math.max(0, rule.minLinkFraction - r.centre.linkFraction) / rule.minLinkFraction : 0;
    if (night + link < score - 1e-9) { score = night + link; best = i; }
  });
  return best;
}

// The answer to a query: { kind: "ok" | "warn" | "bad", index (the row to show, -1 if there are no rows), runs }.
// ok: robust landings exist, and the goal picks one. warn: only the spot itself works somewhere, so the one with the most
// nearby points working. bad: nothing works, so the closest.
export function answerOf(rows, rule, goal) {
  const runs = sortRuns(robustRuns(rows, rule), goal);
  if (runs.length) {
    const index = goal === "margin" ? runs[0].bestRow : runs[0].first;
    return { kind: "ok", index, runs };
  }
  const spots = rows.map((r, i) => i).filter((i) => cellKind(rows[i], rule) === "spot");
  if (spots.length) {
    const top = Math.max(...spots.map((i) => rows[i].robustness));
    const tied = spots.filter((i) => rows[i].robustness === top);
    const index = goal === "margin" ? tied.reduce((a, b) => (marginHours(rows[b], rule) > marginHours(rows[a], rule) ? b : a)) : tied[0];
    return { kind: "warn", index, runs };
  }
  return { kind: "bad", index: closestLanding(rows, rule), runs };
}

// What a change did, for the pill on the banner: compare two summaries of an answer.
export function summarize(rows, rule, goal) {
  const a = answerOf(rows, rule, goal);
  const row = rows[a.index];
  return { kind: a.kind, t: row?.startEt ?? null, worst: row ? worstDark(row) : null, runs: a.runs.length };
}

// What a change did, as a sentence: only the parts that changed. summaries from summarize().
export function deltaText(before, after) {
  if (!before || !after) return "";
  if (after.kind === "bad" && before.kind !== "bad") return "Compared with before: no valid window now.";
  const parts = [];
  if (after.t !== null && before.t !== null && after.kind !== "bad" && before.kind !== "bad") {
    const d = Math.round((after.t - before.t) / 86400);
    if (d) parts.push(`the landing shown is ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "later" : "earlier"}`);
  }
  if (after.runs !== before.runs) parts.push(`${after.runs ? `${after.runs} valid window${after.runs === 1 ? "" : "s"}` : "no valid windows"} instead of ${before.runs ? before.runs : "none"}`);
  if (after.worst !== null && before.worst !== null && Math.round(after.worst) !== Math.round(before.worst)) parts.push(`the worst night across the spot and its dispersion points ${after.worst < before.worst ? "falls" : "rises"} from ${spanText(before.worst)} to ${spanText(after.worst)}`);
  return `Compared with before: ${parts.length ? `${parts.join("; ")}.` : "no change."}`;
}

// ---- the verdict banner (spec §4.2)

const REASON_WORDS = { night: "night exceeds limit", dsn: "DSN visibility below threshold" };
const REASON_LIMIT = { night: "maximum night duration", dsn: "minimum DSN visibility" };

// Where a landing fails, in words: "Fail at the target spot: night exceeds limit", "4 of 12 dispersion points fail: night exceeds limit",
// "Fail at the target spot and at 4 of 12 dispersion points: night exceeds limit"; when the reasons differ, each is given with its count.
export function failText(row, rule) {
  const near = Math.max(0, row.points.length - 1);
  const fails = neighbourFailures(row, rule);
  const spotFails = !row.ok;
  const spotWhy = row.centre.longestDarkHours > rule.maxDarkHours ? REASON_WORDS.night : REASON_WORDS.dsn;
  const nearWhy = fails.night && fails.dsn ? `${REASON_WORDS.night} at ${fails.night}, ${REASON_WORDS.dsn} at ${fails.dsn}` : fails.night ? REASON_WORDS.night : REASON_WORDS.dsn;
  const count = `${fails.total} of ${near} dispersion points`;
  if (spotFails && !fails.total) return `Fail at the target spot: ${spotWhy}`;
  if (!spotFails && fails.total) return `${count} fail: ${nearWhy}`;
  if (!spotFails) return "";
  return nearWhy === spotWhy ? `Fail at the target spot and at ${count}: ${spotWhy}` : `Fail at the target spot (${spotWhy}) and at ${count} (${nearWhy})`;
}

// "4 fail maximum night duration" / "3 fail maximum night duration, 1 fails minimum DSN visibility": how many dispersion points fail which limit.
export function dispersionFailText(row, rule) {
  const f = neighbourFailures(row, rule);
  const part = (n, key) => `${n} fail${n === 1 ? "s" : ""} ${REASON_LIMIT[key]}`;
  return [f.night && part(f.night, "night"), f.dsn && part(f.dsn, "dsn")].filter(Boolean).join(", ");
}

// { state, title, reason } for the landing at `row`. picked: the visitor chose it (a cell or a run), so the banner says what
// that landing is; otherwise it answers the question. ev: { kind, runs } from answerOf.
export function verdictModel({ row, ev, rule, goal, picked }) {
  if (!row) return { state: "bad", title: "No valid window in this range", reason: "There are no landing times in this range." };
  const when = whenText(row.startEt);
  const kind = cellKind(row, rule);
  const holds = row.ok ? (row.holdsRaised ? `Holds under a +${SKYLINE_DEG}° horizon margin (DEM uncertainty check).` : `Fails under a +${SKYLINE_DEG}° horizon margin (DEM uncertainty check).`) : "";
  const night = `Longest night ${spanText(row.centre.longestDarkHours)}${darkBelowSuffix(rule.dbelow)} against a limit of ${rule.maxDarkHours} h.`;
  const link = `DSN visibility ${Math.round(row.centre.linkFraction * 100)}% of the mission against ${Math.round(rule.minLinkFraction * 100)}% required.`;
  const fails = neighbourFailures(row, rule);
  const near = Math.max(0, row.points.length - 1); // the dispersion points this radius tests
  const ofNearby = near - fails.total;
  const spotTitle = `${when} – Valid at target spot (${ofNearby} of ${near} dispersion points pass)`;
  const spotWhy = (lead) => `${lead} ${near} dispersion points; ${dispersionFailText(row, rule)}. ${holds}`;
  if (picked) {
    if (kind === "robust") return { state: "ok", title: `${when} – ${sentenceCap(worksText(rule.within))}`, reason: `${near ? `Valid at the target spot and all ${near} dispersion points.` : "Valid at the target spot."} Longest night ${spanText(worstDark(row))} against the ${rule.maxDarkHours} h limit. ${holds}` };
    if (kind === "spot") return { state: "info", title: spotTitle, reason: spotWhy("Not valid at all") };
    if (kind === "night") return { state: "bad", title: `${when} – Fail: Night exceeds limit`, reason: night };
    return { state: "bad", title: `${when} – Fail: DSN visibility below threshold`, reason: link };
  }
  const n = ev.runs.length;
  const goalNote = { earliest: "This is the earliest.", margin: "This one has the shortest night.", longest: "This is the start of the widest window.", all: "Showing the earliest." }[goal];
  if (ev.kind === "ok") return { state: "ok", title: `${when} – ${sentenceCap(worksText(rule.within))}`, reason: `${n} valid window${n === 1 ? "" : "s"} match. ${goalNote} ${holds}` };
  if (ev.kind === "warn") return { state: "info", title: spotTitle, reason: `No window satisfies all ${near} dispersion points; ${dispersionFailText(row, rule)}. ${holds}` };
  const shortfall = kind === "night" ? night : link;
  return { state: "bad", title: "No valid window in this range", reason: `The closest is ${when}. ${shortfall}` };
}
const sentenceCap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---- the heatmap (spec §4.3)

export const HOURS = [0, 6, 12, 18];

// One column per day of the query, four rows (00, 06, 12, 18 UTC): { days: [{ day, cells: [{ index, kind } | null] }] }.
export function heatGrid(rows, rule, start, days) {
  const byTime = new Map(rows.map((r, i) => [formatUtc(r.startEt), i]));
  const cols = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(start, d);
    cols.push({ day, cells: HOURS.map((h) => {
      const i = byTime.get(`${day} ${String(h).padStart(2, "0")}:00`);
      return i === undefined ? null : { index: i, kind: cellKind(rows[i], rule) };
    }) });
  }
  return cols;
}

// ---- what it would take (spec §4.4)

// The night limit a landing would need, in whole hours rounded up: the longest dark over the spot and its nearby points.
export const neededNightHours = (row) => Math.ceil(worstDark(row));

// Counts for the run table and the summary line.
export function countKinds(rows, rule) {
  const out = { robust: 0, spot: 0, night: 0, dsn: 0 };
  for (const r of rows) out[cellKind(r, rule)]++;
  return out;
}

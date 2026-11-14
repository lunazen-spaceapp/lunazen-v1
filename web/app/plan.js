// Pure helpers for the Planner: combine per-point landing evaluations into robustness,
// group feasible landing times into windows, and build a month x day calendar.

import { feasible, parseUtc } from "../engine/index.js";
import { formatDuration, formatUtc } from "./format.js";

// evaluations: [centre, ring1, ...], each an array from evaluateLandings() over the same times.
// maxDarkHours: the darkness tolerance in hours (a landing survives if its longest dark period is within it).
// Returns per landing time: { startEt, ok (centre feasible), robustness (share of points feasible), centre }.
export function combine(evaluations, minLinkFraction, maxDarkHours) {
  const [centre, ...ring] = evaluations;
  return centre.map((c, k) => {
    const points = [c, ...ring.map((r) => r[k])];
    const okCount = points.filter((p) => feasible(p, minLinkFraction, maxDarkHours)).length;
    const spread = points.map((p) => ({ ok: feasible(p, minLinkFraction, maxDarkHours), sunlitFraction: p.sunlitFraction, longestDarkHours: p.longestDarkHours, linkFraction: p.linkFraction }));
    return { startEt: c.startEt, ok: feasible(c, minLinkFraction, maxDarkHours), robustness: okCount / points.length, centre: c, points: spread };
  });
}

// Marks each landing time with whether it still works with the skyline higher (a result of the same landings
// evaluated on a raised horizon, centre point only). Rows that failed anyway stay false.
export function withRaisedSkyline(rows, raisedCentre, minLinkFraction, maxDarkHours) {
  return rows.map((r, k) => ({ ...r, holdsRaised: r.ok && feasible(raisedCentre[k], minLinkFraction, maxDarkHours) }));
}

// Consecutive landing times where the centre is feasible -> windows.
export function landingWindows(rows) {
  const out = [];
  let current = null;
  for (const r of rows) {
    if (r.ok) {
      if (!current) current = { startEt: r.startEt, endEt: r.startEt, minRobustness: r.robustness, rows: [] };
      current.endEt = r.startEt;
      current.minRobustness = Math.min(current.minRobustness, r.robustness);
      current.rows.push(r);
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out;
}

// Calendar status per UTC day: "robust" if some landing that day is feasible at every point,
// "centre" if feasible at the centre only, "no" otherwise.
export function dayStatus(rows) {
  const days = new Map();
  for (const r of rows) {
    const day = formatUtc(r.startEt).slice(0, 10);
    const status = r.ok && r.robustness === 1 ? "robust" : r.ok ? "centre" : "no";
    const rank = { no: 0, centre: 1, robust: 2 };
    if (!days.has(day) || rank[status] > rank[days.get(day)]) days.set(day, status);
  }
  return days;
}

// How the landing spot and the points around it differ for one landing: how many work, and the range of
// sunlit share and longest dark period across all of them. points: the row's `points` (centre first).
export function ringSummary(points) {
  const range = (key) => [Math.min(...points.map((p) => p[key])), Math.max(...points.map((p) => p[key]))];
  return { working: points.filter((p) => p.ok).length, total: points.length, sunlit: range("sunlitFraction"), darkHours: range("longestDarkHours") };
}

// A plan view of the spot (first point, at the origin) and its ring: one dot per point, north up, east right.
// offsets: the ring's [east, north] offsets in metres, in the order of points[1..]. A pure string, so it is tested in Node.
export function ringSvg(offsets, points, size = 76) {
  const reach = Math.max(1, ...offsets.map(([e, n]) => Math.hypot(e, n)));
  const half = size / 2;
  const scale = (half - 7) / reach;
  const dot = (e, n, p, r, label) => `<circle class="${p.ok ? "rd-ok" : "rd-no"}" cx="${(half + e * scale).toFixed(1)}" cy="${(half - n * scale).toFixed(1)}" r="${r}"><title>${label}: ${p.ok ? "works" : "fails"}</title></circle>`;
  const dots = offsets.map(([e, n], i) => dot(e, n, points[i + 1], 4, `${Math.round(Math.hypot(e, n))} m away`)).join("");
  return `<svg class="ringdots" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="The spot and the points around it: ${points.filter((p) => p.ok).length} of ${points.length} work">`
    + `<circle class="rd-edge" cx="${half}" cy="${half}" r="${(reach * scale).toFixed(1)}"/>${dots}${dot(0, 0, points[0], 5.5, "The spot")}</svg>`;
}

// ---- the selected landing

const percent = (fraction) => `${Math.round(fraction * 100)}%`;

// The address value of a landing time: its UTC date and hour, like 2027-07-12T06.
export function landingValue(startEt) {
  const t = formatUtc(startEt);
  return `${t.slice(0, 10)}T${t.slice(11, 13)}`;
}

// The landing time (ET) of an address value, or null if it is not one.
export function parseLanding(text) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(text ?? "");
  return m && Number(m[2]) < 24 ? parseUtc(`${m[1]}T${m[2]}:00:00`) : null;
}

// The index of the row whose landing time is `startEt` (within an hour), or -1.
export function landingIndex(rows, startEt) {
  let best = -1, gap = 3600;
  rows.forEach((r, i) => { const d = Math.abs(r.startEt - startEt); if (d < gap) { gap = d; best = i; } });
  return best;
}

// The row before (dir -1) or after (dir 1) row i, only a working one if workingOnly; null at the end.
export function stepLanding(rows, i, dir, workingOnly = false) {
  for (let k = i + dir; k >= 0 && k < rows.length; k += dir) if (!workingOnly || rows[k].ok) return k;
  return null;
}

// The margin order of the Planner's "Most margin": shortest dark period, then most DSN in view, then most nearby points.
const byMargin = (rows) => (a, b) => rows[a].centre.longestDarkHours - rows[b].centre.longestDarkHours
  || rows[b].centre.linkFraction - rows[a].centre.linkFraction || rows[b].robustness - rows[a].robustness || a - b;

// The index of the working landing with the most margin over all rows, or -1 if none works.
export function bestLanding(rows) {
  const ok = rows.map((r, i) => i).filter((i) => rows[i].ok);
  return ok.length ? ok.sort(byMargin(rows))[0] : -1;
}

// The landing to show for a day: its working time with the most margin, else its first time; -1 if the day has none.
export function bestSlotOfDay(rows, day) {
  const idx = rows.map((r, i) => i).filter((i) => formatUtc(rows[i].startEt).startsWith(day));
  if (!idx.length) return -1;
  const ok = idx.filter((i) => rows[i].ok);
  return ok.length ? ok.sort(byMargin(rows))[0] : idx[0];
}

// What a landing is, in words: kind ("robust" | "centre" | "no"), a short label, and for a failure its reason.
export function verdictOf(row, { maxDarkHours, minLinkFraction }) {
  const c = row.centre, working = row.points.filter((p) => p.ok).length;
  if (row.ok && row.robustness === 1) return { kind: "robust", reason: null, short: "Works within 100 m" };
  if (row.ok) return { kind: "centre", reason: null, short: `Works at the spot, ${working} of ${row.points.length} points within 100 m` };
  if (c.longestDarkHours > maxDarkHours) return { kind: "no", reason: "dark", short: `Fails: dark ${formatDuration(c.longestDarkHours)}, limit ${maxDarkHours} h` };
  // A shortfall of under a percent would read "50%, needs 50%": say it with a decimal.
  const have = Math.round(c.linkFraction * 100) >= Math.round(minLinkFraction * 100) ? `${(c.linkFraction * 100).toFixed(1)}%` : percent(c.linkFraction);
  return { kind: "no", reason: "link", short: `Fails: DSN in view ${have}, needs ${percent(minLinkFraction)}` };
}

// "Mon 12 Jul 2027" for an ISO date.
export const weekdayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "");
// "12 Jul 2027".
export const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

// The scenario as short phrases for the context bar.
export function scenarioParts({ label, siteName, mast, mission, ruleName, maxDarkHours, link, start, endDay }) {
  return [
    label, siteName, `${mast} m mast`, `${mission}-day mission`,
    `darkness limit ${maxDarkHours} h${ruleName ? ` (${ruleName})` : ""}`,
    `DSN in view at least ${link}%`,
    `searching ${dayLabel(start)} to ${dayLabel(endDay)}`,
  ].filter(Boolean);
}

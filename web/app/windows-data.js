// Pure helpers for the Windows page (only the small planner rule from the engine, so the page bundle stays small): the precomputed landing windows (web/data/windows.json, written by
// pipeline/export_windows.mjs), their encoding, the totals the page shows.

import { feasible } from "../engine/planner.js";

export const WINDOW_YEARS = [2026, 2027, 2028, 2029]; // 2026 is whole too, though only its last two months are still ahead
// The rule the precomputed file (web/data/windows.json) uses; the page computes other settings live.
export const WINDOW_RULE = { missionDays: 14, maxDarkHours: 50, minLink: 0.5, mastM: 2, strideHours: 6 };
// The stored grid is for the default rule at a 100 m miss distance, with any part of the Sun ending a night (rule.within and
// rule.dbelow and rule.dstation are absent in the grid's own rule).
export const isDefaultRule = (rule) => ["missionDays", "maxDarkHours", "minLink", "mastM", "strideHours"].every((k) => rule[k] === WINDOW_RULE[k]) && (rule.within ?? 100) === 100 && !rule.dbelow && !rule.dstation;

// Day codes. A day is a hex digit: 0 = fails (night too long), 1 = fails (DSN in view too low), v >= 2 = works at v - 1 points.
export const TOO_DARK = 0;
export const TOO_LITTLE_LINK = 1;
export const pointsWorking = (code) => (code >= 2 ? code - 1 : 0);
export const works = (code) => code >= 2;
export const decodeDays = (text) => Array.from(text, (c) => parseInt(c, 16));
export const dayCode = (points, survivesDark) => (points > 0 ? points + 1 : survivesDark ? TOO_LITTLE_LINK : TOO_DARK);

// A code for each day from the landings of the spot and its ring: evals[0] is the spot, the rest its nearby points, each an
// array from evaluateLandings() over the same landing times. A day works when some landing that day does, and keeps its best
// number of working points; a failing day is "too dark" unless some landing that day survives the dark. Returns a hex string.
export function dayCodes(evals, rule, et0, nDays) {
  const best = new Array(nDays).fill(0);
  const survives = new Array(nDays).fill(false);
  evals[0].forEach((c, k) => {
    const day = Math.floor((c.startEt - et0) / 86400);
    if (day < 0 || day >= nDays) return;
    if (c.longestDarkHours <= rule.maxDarkHours) survives[day] = true;
    if (!feasible(c, rule.minLink, rule.maxDarkHours)) return;
    best[day] = Math.max(best[day], evals.filter((e) => feasible(e[k], rule.minLink, rule.maxDarkHours)).length);
  });
  return best.map((b, d) => dayCode(b, survives[d]).toString(16)).join("");
}

// Everything the page derives from the file for one year: per-spot arrays and per-day totals.
export function yearView(file, year) {
  const spots = file.spots.map((s, i) => {
    const codes = decodeDays(s.days[year]);
    return { ...s, i, codes, works: codes.filter(works).length, robust: codes.filter((c) => pointsWorking(c) === s.points).length };
  });
  const nDays = spots[0].codes.length;
  const working = Array.from({ length: nDays }, (_, d) => spots.filter((s) => works(s.codes[d])).length);
  const robust = Array.from({ length: nDays }, (_, d) => spots.filter((s) => pointsWorking(s.codes[d]) === s.points).length);
  let tooDark = 0, tooLittleLink = 0;
  for (const s of spots) for (const c of s.codes) { if (c === TOO_DARK) tooDark++; else if (c === TOO_LITTLE_LINK) tooLittleLink++; }
  const sorted = [...working].sort((a, b) => a - b);
  const totalWorking = spots.reduce((a, s) => a + s.works, 0);
  const totalRobust = spots.reduce((a, s) => a + s.robust, 0);
  return {
    spots, nDays, working, robust, median: sorted[Math.floor(nDays / 2)],
    bestDay: working.indexOf(Math.max(...working)),
    robustShare: totalWorking ? totalRobust / totalWorking : 0,
    darkShare: tooDark / Math.max(tooDark + tooLittleLink, 1),
  };
}

// What a slip in the landing date does to one spot. `codes` are the spot's day codes for a year, `d` the chosen day
// index, `tail` the codes of the following year when they are known (the search then runs on into it, so a window that
// crosses 31 December is whole). If the spot works on d: `slack` is how many more days in a row it keeps working, `runEnd`
// the last of them, `next` the first working day after that (null if none in the days searched). If not: `next` is the
// first working day after d, `wait` the days until it, `prev` the last working day before d and `back` the days since
// (null when none). Day indices may be past the end of `codes` (they count on into the next year); `searched` is the number
// of days the search covered, so a caller can say where it stopped.
export function slipStats(codes, d, tail = null) {
  const all = tail ? codes.concat(tail) : codes;
  const code = codes[d];
  const first = (from, step, ok) => { for (let k = from; k >= 0 && k < all.length; k += step) if (ok(all[k])) return k; return null; };
  if (works(code)) {
    let runEnd = d;
    while (runEnd + 1 < all.length && works(all[runEnd + 1])) runEnd++;
    const next = first(runEnd + 1, 1, works);
    return { works: true, code, slack: runEnd - d, runEnd, next, wait: next === null ? null : next - runEnd, prev: null, back: null, searched: all.length, endHit: next === null };
  }
  const next = first(d + 1, 1, works), prev = first(d - 1, -1, works);
  return { works: false, code, slack: 0, runEnd: null, next, wait: next === null ? null : next - d, prev, back: prev === null ? null : d - prev, searched: all.length, endHit: next === null };
}

// The spots ordered for a slip (tailOf(spot): the codes of the following year, or null): those that work on the day first, the ones that keep working longest on top (ties: more
// of the 13 points working, then name); then the ones that fail, soonest next window first. Each result is the spot with
// its `slip` (slipStats) added.
export function slipRanking(spots, d, tailOf = () => null) {
  const rows = spots.map((s) => ({ ...s, slip: slipStats(s.codes, d, tailOf(s)) }));
  const name = (s) => s.label ?? s.id;
  return rows.sort((a, b) => {
    if (a.slip.works !== b.slip.works) return a.slip.works ? -1 : 1;
    if (a.slip.works) return b.slip.slack - a.slip.slack || pointsWorking(b.codes[d]) / b.points - pointsWorking(a.codes[d]) / a.points || name(a).localeCompare(name(b), undefined, { numeric: true });
    return (a.slip.wait ?? Infinity) - (b.slip.wait ?? Infinity) || name(a).localeCompare(name(b), undefined, { numeric: true });
  });
}

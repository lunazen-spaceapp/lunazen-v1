import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUtc } from "../../engine/index.js";
import {
  addDays, answerOf, cellKind, closestLanding, countKinds, deltaText, heatGrid, marginHours, neededNightHours, neighbourFailures,
  rangeEnd, robustRuns, setRange, shortWhen, sortRuns, spanText, summarize, verdictModel, whenText, worstDark,
} from "../query-model.js";

const RULE = { maxDarkHours: 50, minLinkFraction: 0.5 };
const T0 = parseUtc("2027-03-01T00:00:00");

// A landing time: `dark` and `link` at the spot, `ringDark` at each of 12 nearby points.
function row(k, { dark = 10, link = 0.8, ringDark = dark, ringLink = link, held = true } = {}) {
  const pt = (d, l) => ({ ok: d <= RULE.maxDarkHours && l >= RULE.minLinkFraction, sunlitFraction: 0.9, longestDarkHours: d, linkFraction: l });
  const points = [pt(dark, link), ...Array.from({ length: 12 }, (_, i) => pt(Array.isArray(ringDark) ? ringDark[i] : ringDark, ringLink))];
  const ok = points[0].ok;
  const robustness = points.filter((p) => p.ok).length / points.length;
  return { startEt: T0 + k * 6 * 3600, ok, robustness, centre: points[0], points, holdsRaised: ok && held };
}

test("durations: hours under 48 h, days and hours above", () => {
  assert.equal(spanText(38), "38 h");
  assert.equal(spanText(47.6), "2 d 0 h");
  assert.equal(spanText(48), "2 d 0 h");
  assert.equal(spanText(138), "5 d 18 h");
});

test("times read as 1 Mar 2027, 06:00 UTC", () => {
  assert.equal(whenText(T0 + 6 * 3600), "1 Mar 2027, 06:00 UTC");
  assert.equal(shortWhen(T0 + 6 * 3600), "1 Mar 06:00");
});

test("a range keeps to a year and an end before the start moves to start + 30 days", () => {
  assert.deepEqual(setRange("2027-03-01", "2027-04-30"), { start: "2027-03-01", days: 61 });
  assert.deepEqual(setRange("2027-03-01", "2027-02-01"), { start: "2027-03-01", days: 31 });
  assert.deepEqual(setRange("2027-03-01", "2027-12-31"), { start: "2027-03-01", days: 306 });
  assert.deepEqual(setRange("2027-03-01", "2029-03-01"), { start: "2027-03-01", days: 366 });
  assert.equal(rangeEnd("2027-03-01", 61), "2027-04-30");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
});

test("each landing time is robust, works at the spot only, or fails (the night is checked first)", () => {
  assert.equal(cellKind(row(0), RULE), "robust");
  assert.equal(cellKind(row(0, { ringDark: [60, ...Array(11).fill(10)] }), RULE), "spot");
  assert.equal(cellKind(row(0, { dark: 70, link: 0.2 }), RULE), "night");
  assert.equal(cellKind(row(0, { link: 0.2 }), RULE), "dsn");
});

test("margin is the limit minus the worst night over the spot and its 12 neighbours", () => {
  const r = row(0, { dark: 20, ringDark: [38, ...Array(11).fill(10)] });
  assert.equal(worstDark(r), 38);
  assert.equal(marginHours(r, RULE), 12);
  assert.equal(neededNightHours(r), 38);
});

test("neighbours fail on the night first, else on DSN in view", () => {
  const r = row(0, { ringDark: [60, 60, ...Array(10).fill(10)], ringLink: 0.8 });
  assert.deepEqual(neighbourFailures(r, RULE), { night: 2, dsn: 0, total: 2 });
  const l = row(0, { ringLink: 0.1 });
  assert.deepEqual(neighbourFailures(l, RULE), { night: 0, dsn: 12, total: 12 });
});

test("runs are maximal stretches of robust landing times", () => {
  const rows = [row(0, { dark: 30 }), row(1, { dark: 10 }), row(2, { dark: 70 }), row(3, { dark: 20 }), row(4, { dark: 20, held: false })];
  const runs = robustRuns(rows, RULE);
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].first, runs[0].last, runs[0].count, runs[0].margin, runs[0].bestRow, runs[0].holds], [0, 1, 2, 40, 1, 2]);
  assert.deepEqual([runs[1].first, runs[1].count, runs[1].holds], [3, 2, 1]);
  assert.deepEqual(sortRuns(runs, "margin").map((r) => r.first), [0, 3]);
  assert.deepEqual(sortRuns(runs, "earliest").map((r) => r.first), [0, 3]);
  const wide = [row(0), row(1, { dark: 90 }), row(2), row(3), row(4)];
  assert.deepEqual(sortRuns(robustRuns(wide, RULE), "longest").map((r) => r.count), [3, 1]);
});

test("the answer: a robust landing by the goal, else the spot-only landing with most points, else the closest", () => {
  const rows = [row(0, { dark: 30 }), row(1, { dark: 10 }), row(2, { dark: 70 }), row(3, { dark: 20 })];
  assert.equal(answerOf(rows, RULE, "earliest").index, 0);
  assert.equal(answerOf(rows, RULE, "margin").index, 1);
  assert.equal(answerOf(rows, RULE, "all").kind, "ok");

  const spotOnly = [row(0, { ringDark: [60, 60, ...Array(10).fill(10)] }), row(1, { ringDark: [60, ...Array(11).fill(10)] })];
  const warn = answerOf(spotOnly, RULE, "earliest");
  assert.deepEqual([warn.kind, warn.index, warn.runs.length], ["warn", 1, 0]);

  const none = [row(0, { dark: 90 }), row(1, { dark: 60 }), row(2, { dark: 80 })];
  assert.deepEqual([answerOf(none, RULE, "earliest").kind, answerOf(none, RULE, "earliest").index], ["bad", 1]);
  assert.equal(closestLanding([], RULE), -1);
  assert.equal(answerOf([], RULE, "earliest").index, -1);
});

test("the closest landing counts the DSN shortfall too", () => {
  const rows = [row(0, { dark: 10, link: 0.1 }), row(1, { dark: 60, link: 0.9 })];
  assert.equal(closestLanding(rows, RULE), 1); // 20% over the night limit beats 80% short of the DSN requirement
});

test("the change summary is a sentence about what changed", () => {
  const a = { kind: "ok", t: T0, worst: 66 * 1, runs: 3 };
  const b = { kind: "ok", t: T0 + 6 * 86400, worst: 38, runs: 9 };
  assert.equal(deltaText(a, b), "Compared with before: the landing shown is 6 days later; 9 valid windows instead of 3; the worst night across the spot and its dispersion points falls from 2 d 18 h to 38 h.");
  assert.equal(deltaText(a, a), "Compared with before: no change.");
  assert.equal(deltaText(a, { ...a, kind: "bad" }), "Compared with before: no valid window now.");
  assert.equal(deltaText({ kind: "warn", t: T0 + 21 * 86400, worst: 324, runs: 0 }, { kind: "ok", t: T0, worst: 0, runs: 3 }), "Compared with before: the landing shown is 21 days earlier; 3 valid windows instead of none; the worst night across the spot and its dispersion points falls from 13 d 12 h to 0 h.");
  assert.equal(deltaText(null, a), "");
  const rows = [row(0, { dark: 30 })];
  assert.deepEqual(summarize(rows, RULE, "earliest"), { kind: "ok", t: rows[0].startEt, worst: 30, runs: 1 });
});

test("the verdict says what the landing is and why", () => {
  const good = [row(0, { dark: 30, ringDark: 38 })];
  const ev = answerOf(good, RULE, "earliest");
  const v = verdictModel({ row: good[0], ev, rule: RULE, goal: "earliest", picked: false });
  assert.equal(v.state, "ok");
  assert.equal(v.title, "1 Mar 2027, 00:00 UTC – Valid within 100 m dispersion");
  assert.match(v.reason, /1 valid window match\. This is the earliest\. Holds under a \+0\.25° horizon margin \(DEM uncertainty check\)\./);

  const spotOnly = row(0, { ringDark: [60, 60, ...Array(10).fill(10)], held: false });
  const picked = verdictModel({ row: spotOnly, ev: answerOf([spotOnly], RULE, "earliest"), rule: RULE, goal: "earliest", picked: true });
  assert.equal(picked.state, "info");
  assert.equal(picked.title, "1 Mar 2027, 00:00 UTC – Valid at target spot (10 of 12 dispersion points pass)");
  assert.match(picked.reason, /Not valid at all 12 dispersion points; 2 fail maximum night duration\. Fails under a \+0\.25° horizon margin/);

  const dark = row(0, { dark: 70, link: 0.9 });
  assert.equal(verdictModel({ row: dark, ev: answerOf([dark], RULE, "earliest"), rule: RULE, goal: "earliest", picked: true }).title, "1 Mar 2027, 00:00 UTC – Fail: Night exceeds limit");
  const bad = verdictModel({ row: dark, ev: answerOf([dark], RULE, "earliest"), rule: RULE, goal: "earliest", picked: false });
  assert.equal(bad.title, "No valid window in this range");
  assert.match(bad.reason, /The closest is 1 Mar 2027, 00:00 UTC\. Longest night 2 d 22 h against a limit of 50 h\./);
  assert.equal(verdictModel({ row: undefined, ev: { kind: "bad", runs: [] }, rule: RULE, goal: "earliest", picked: false }).state, "bad");
});

test("the heatmap has a column per day and four rows", () => {
  const rows = Array.from({ length: 8 }, (_, k) => row(k, { dark: k < 4 ? 10 : 90 }));
  const grid = heatGrid(rows, RULE, "2027-03-01", 3);
  assert.deepEqual(grid.map((c) => c.day), ["2027-03-01", "2027-03-02", "2027-03-03"]);
  assert.deepEqual(grid[0].cells.map((c) => c.kind), ["robust", "robust", "robust", "robust"]);
  assert.deepEqual(grid[1].cells.map((c) => c.kind), ["night", "night", "night", "night"]);
  assert.deepEqual(grid[2].cells, [null, null, null, null]);
  assert.deepEqual(countKinds(rows, RULE), { robust: 4, spot: 0, night: 4, dsn: 0 });
});

test("the verdict follows the miss distance: a landing that fails at 100 m can work within 50 m", () => {
  // six points at 50 m work, the six at 100 m do not
  const rows = [row(0, { ringDark: [10, 10, 10, 10, 10, 10, 60, 60, 60, 60, 60, 60] })];
  const at = (within, n) => {
    const r = { ...rows[0], points: rows[0].points.slice(0, 1 + n) };
    r.robustness = r.points.filter((p) => p.ok).length / r.points.length;
    return [r];
  };
  const rule = (within) => ({ ...RULE, within });
  const v100 = verdictModel({ row: at(100, 12)[0], ev: answerOf(at(100, 12), rule(100), "earliest"), rule: rule(100), goal: "earliest", picked: false });
  assert.equal(v100.state, "info");
  assert.equal(v100.title, "1 Mar 2027, 00:00 UTC – Valid at target spot (6 of 12 dispersion points pass)");
  assert.match(v100.reason, /No window satisfies all 12 dispersion points; 6 fail maximum night duration\./);
  const v50 = verdictModel({ row: at(50, 6)[0], ev: answerOf(at(50, 6), rule(50), "earliest"), rule: rule(50), goal: "earliest", picked: false });
  assert.equal(v50.state, "ok");
  assert.equal(v50.title, "1 Mar 2027, 00:00 UTC – Valid within 50 m dispersion");
  const v0 = verdictModel({ row: at(0, 0)[0], ev: answerOf(at(0, 0), rule(0), "earliest"), rule: rule(0), goal: "earliest", picked: true });
  assert.equal(v0.state, "ok");
  assert.equal(v0.title, "1 Mar 2027, 00:00 UTC – Valid at the target spot");
  assert.match(v0.reason, /^Valid at the target spot\. Longest night/);
});

test("where a landing fails is said in words: the spot, the nearby points, or both, with each reason", async () => {
  const { failText } = await import("../query-model.js");
  const nearby = row(0, { ringDark: [60, 60, 60, 60, ...Array(8).fill(10)] });
  assert.equal(failText(nearby, RULE), "4 of 12 dispersion points fail: night exceeds limit");
  const spot = row(0, { dark: 70, ringDark: 10 });
  assert.equal(failText(spot, RULE), "Fail at the target spot: night exceeds limit");
  const both = row(0, { dark: 70, ringDark: [60, 60, 60, 60, ...Array(8).fill(10)] });
  assert.equal(failText(both, RULE), "Fail at the target spot and at 4 of 12 dispersion points: night exceeds limit");
  const mixed = row(0, { ringDark: [60, 60, 60, ...Array(9).fill(10)] });
  mixed.points[4] = { ...mixed.points[4], ok: false, longestDarkHours: 10, linkFraction: 0.1 };
  assert.equal(failText(mixed, RULE), "4 of 12 dispersion points fail: night exceeds limit at 3, DSN visibility below threshold at 1");
  assert.equal(failText(row(0), RULE), "");
});

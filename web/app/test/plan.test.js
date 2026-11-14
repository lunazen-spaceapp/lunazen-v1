import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUtc } from "../../engine/index.js";
import { bestLanding, bestSlotOfDay, combine, dayLabel, dayStatus, landingIndex, landingValue, landingWindows, parseLanding, ringSummary, ringSvg, scenarioParts, stepLanding, verdictOf, weekdayLabel, withRaisedSkyline } from "../plan.js";

const t0 = parseUtc("2027-03-01T00:00:00");
const ev = (survives, link, k) => ({ startEt: t0 + k * 6 * 3600, longestDarkHours: survives ? 0 : 99, linkFraction: link });

test("combine, windows and calendar", () => {
  //            k:   0        1        2        3        4        5
  const centre = [ev(1, .6, 0), ev(1, .6, 1), ev(0, .9, 2), ev(1, .4, 3), ev(1, .7, 4), ev(1, .7, 5)];
  const ring1 = [ev(1, .6, 0), ev(0, .6, 1), ev(0, .9, 2), ev(1, .9, 3), ev(1, .7, 4), ev(1, .7, 5)];
  const rows = combine([centre, ring1], 0.5, 50);
  assert.deepEqual(rows.map((r) => r.ok), [true, true, false, false, true, true]);
  assert.deepEqual(rows.map((r) => r.robustness), [1, 0.5, 0, 0.5, 1, 1]);

  const windows = landingWindows(rows);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].startEt, t0);
  assert.equal(windows[0].endEt, t0 + 6 * 3600);
  assert.equal(windows[0].minRobustness, 0.5);
  assert.equal(windows[1].minRobustness, 1);

  const days = dayStatus(rows); // k 0-3 on 03-01, k 4-5 on 03-02
  assert.equal(days.get("2027-03-01"), "robust");
  assert.equal(days.get("2027-03-02"), "robust");
  assert.equal(dayStatus(combine([centre.slice(1, 2), ring1.slice(1, 2)], 0.5, 50)).get("2027-03-01"), "centre");
});

test("combine judges survival by the darkness tolerance", () => {
  const at = (dark, link, k) => ({ startEt: t0 + k * 6 * 3600, linkFraction: link, longestDarkHours: dark });
  const centre = [at(4, 0.6, 0), at(40, 0.6, 1), at(60, 0.6, 2)];
  const ring1 = [at(4, 0.6, 0), at(55, 0.6, 1), at(60, 0.6, 2)];
  assert.deepEqual(combine([centre, ring1], 0.5, 50).map((r) => [r.ok, r.robustness]), [[true, 1], [true, 0.5], [false, 0]]);
  assert.deepEqual(combine([centre, ring1], 0.5, 5).map((r) => r.ok), [true, false, false]);
});

test("book chapter 10: 14-day landings at Site01-1 in 2027 under VIPER's 50 h darkness tolerance", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { Ephemeris, SiteCatalog, evaluateLandings, timeSeries, STEP_S } = await import("../../engine/index.js");
  const data = fileURLToPath(new URL("../../data/", import.meta.url));
  const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const ephemeris = new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin"));
  const catalog = new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin"));
  const et0 = parseUtc("2027-01-01T00:00:00");
  const et1 = et0 + (365 + 14) * 86400;
  const points = [catalog.spot("Site01-1", 2), ...catalog.ring("Site01-1")];
  const evaluations = points.map((p) => evaluateLandings(timeSeries(ephemeris, p.site, p.horizon, et0, et1, STEP_S), 14 * 86400, (6 * 3600) / STEP_S));
  const rows = combine(evaluations, 0.5, catalog.darknessPresets.find((p) => p.id === "viper").hours);
  const atLeast = (n) => rows.filter((r) => r.ok && Math.round(r.robustness * points.length) >= n).length;
  assert.equal(rows.length, 1461);
  assert.deepEqual([atLeast(1), atLeast(12), atLeast(13)], [628, 64, 0]); // 43% at the spot, 4% at 12 of 13 points, none at all
});

test("the spread over the spot and its ring", () => {
  const pt = (ok, sun, dark) => ({ ok, sunlitFraction: sun, longestDarkHours: dark, linkFraction: 0.6 });
  const points = [pt(true, 0.9, 10), pt(false, 0.33, 120), pt(true, 0.8, 20)];
  assert.deepEqual(ringSummary(points), { working: 2, total: 3, sunlit: [0.33, 0.9], darkHours: [10, 120] });

  const svg = ringSvg([[0, 50], [50, 0]], points);
  assert.equal((svg.match(/<circle class="rd-(ok|no)"/g) ?? []).length, 3);
  assert.match(svg, /2 of 3 work/);
  assert.match(svg, /cx="38.0" cy="38.0" r="5.5"/); // the spot at the centre
  assert.match(svg, /cx="38.0" cy="7.0"/); // 50 m north is at the top
});

test("combine keeps each point's result for the ring summary", () => {
  const rows = combine([[ev(1, .6, 0)], [ev(0, .9, 0)]], 0.5, 50);
  assert.deepEqual(rows[0].points.map((p) => p.ok), [true, false]);
});

test("landings that still work with the skyline higher", () => {
  const rows = combine([[ev(1, .6, 0), ev(1, .6, 1), ev(0, .9, 2)]], 0.5, 50);
  const raised = [ev(1, .6, 0), ev(0, .6, 1), ev(1, .9, 2)]; // k=1 now too dark; k=2 failed before and still counts as not working
  assert.deepEqual(withRaisedSkyline(rows, raised, 0.5, 50).map((r) => r.holdsRaised), [true, false, false]);
});

// ---- the selected landing
const rowsOf = (spec) => combine([spec.map(([dark, link], k) => ({ startEt: t0 + k * 6 * 3600, longestDarkHours: dark, linkFraction: link }))], 0.5, 50);

test("a landing time round-trips through its address value", () => {
  const et = t0 + 3 * 6 * 3600; // 2027-03-01 18:00
  assert.equal(landingValue(et), "2027-03-01T18");
  assert.ok(Math.abs(parseLanding("2027-03-01T18") - et) < 1);
  assert.equal(parseLanding("2027-03-01"), null);
  assert.equal(parseLanding("2027-03-01T25"), null);
  assert.equal(parseLanding(""), null);
  const rows = rowsOf([[0, 1], [0, 1], [0, 1], [0, 1]]);
  assert.equal(landingIndex(rows, parseLanding("2027-03-01T18")), 3);
  assert.equal(landingIndex(rows, parseLanding("2027-03-05T00")), -1);
});

test("stepping, the best landing and the best slot of a day", () => {
  //                    00:00      06:00     12:00     18:00       next day 00:00
  const rows = rowsOf([[60, 1], [5, 0.9], [0, 0.9], [0, 0.6], [4, 1]]);
  assert.deepEqual(rows.map((r) => r.ok), [false, true, true, true, true]);
  assert.equal(stepLanding(rows, 0, 1), 1);
  assert.equal(stepLanding(rows, 0, -1), null);
  assert.equal(stepLanding(rows, 1, 1, true), 2);
  assert.equal(stepLanding(rows, 4, 1), null);
  assert.equal(bestLanding(rows), 2); // longest dark 0 h, then more DSN in view than index 3
  assert.equal(bestSlotOfDay(rows, "2027-03-01"), 2);
  assert.equal(bestSlotOfDay(rows, "2027-03-02"), 4);
  assert.equal(bestSlotOfDay(rows, "2027-04-01"), -1);
  assert.equal(bestLanding(rowsOf([[99, 1]])), -1);
  assert.equal(bestSlotOfDay(rowsOf([[99, 1], [99, 1]]), "2027-03-01"), 0); // nothing works: the first time
});

test("verdictOf says what failed against what", () => {
  const rule = { maxDarkHours: 50, minLinkFraction: 0.5 };
  const rows = rowsOf([[60, 1], [10, 0.38], [10, 0.9]]);
  assert.deepEqual(verdictOf(rows[0], rule), { kind: "no", reason: "dark", short: "Fails: dark 2 d 12 h, limit 50 h" });
  assert.deepEqual(verdictOf(rows[1], rule), { kind: "no", reason: "link", short: "Fails: DSN in view 38%, needs 50%" });
  assert.equal(verdictOf(rowsOf([[10, 0.496]])[0], rule).short, "Fails: DSN in view 49.6%, needs 50%");
  assert.equal(verdictOf(rows[2], rule).kind, "robust"); // one point only: all of them work
  const mixed = combine([[ev(1, .9, 0)], [ev(0, .9, 0)]].map((c) => c), 0.5, 50);
  assert.equal(verdictOf(mixed[0], rule).short, "Works at the spot, 1 of 2 points within 100 m");
});

test("labels and the scenario phrases", () => {
  assert.equal(weekdayLabel("2027-07-12"), "Mon 12 Jul 2027");
  assert.equal(dayLabel("2027-03-15"), "15 Mar 2027");
  const parts = scenarioParts({ label: "Site01-1", siteName: "Connecting ridge", mast: 2, mission: 14, ruleName: "VIPER", maxDarkHours: 50, link: 50, start: "2027-03-15", endDay: "2028-03-14" });
  assert.deepEqual(parts, ["Site01-1", "Connecting ridge", "2 m mast", "14-day mission", "darkness limit 50 h (VIPER)", "DSN in view at least 50%", "searching 15 Mar 2027 to 14 Mar 2028"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { METRICS, bestColumns, comparisonCsv, formatMetric, rankColumns, survivedBy } from "../compare-rows.js";

const metrics = [
  { key: "sun", better: "high" },
  { key: "dark", better: "low" },
  { key: "ring", better: "high" },
];

test("best column per metric: direction, ties and missing values", () => {
  const best = bestColumns([
    { metrics: { sun: 0.9, dark: 120, ring: 0.3 } },
    { metrics: { sun: 0.8, dark: 80, ring: null } },
    { metrics: { sun: 0.9, dark: 200, ring: 0.6 } },
  ], metrics);
  assert.deepEqual([...best.sun].sort(), [0, 2]); // tie
  assert.deepEqual([...best.dark], [1]); // lower is better
  assert.deepEqual([...best.ring], [2]); // missing value skipped
});

test("a metric present in fewer than two columns has no best", () => {
  const best = bestColumns([{ metrics: { sun: 1, dark: 1, ring: null } }, { metrics: { sun: 0, dark: 2, ring: null } }], metrics);
  assert.equal(best.ring.size, 0);
});

test("survivedBy lists the reference darkness limits that cover the longest dark period", () => {
  const presets = [{ name: "5 h (Blue Ghost 1, flown)", hours: 5 }, { name: "50 h darkness limit (from VIPER's design)", hours: 50 }];
  assert.equal(survivedBy(3, presets), "5 h and 50 h");
  assert.equal(survivedBy(50, presets), "50 h only");
  assert.equal(survivedBy(138, presets), "neither");
  assert.equal(bestColumns([{ metrics: { t: "a" } }, { metrics: { t: "b" } }], [{ key: "t", kind: "text" }]).t.size, 0);
});

test("rankColumns orders best first by the chosen priority and keeps ties in order", () => {
  const cols = [{ id: "a", metrics: { sunlitFraction: 0.5, longestDarkHours: 10, dsnLinkFraction: 0.4 } },
    { id: "b", metrics: { sunlitFraction: 0.9, longestDarkHours: 80, dsnLinkFraction: 0.4 } },
    { id: "c", metrics: { sunlitFraction: 0.7, longestDarkHours: 40, dsnLinkFraction: 0.4 } }];
  assert.deepEqual(rankColumns(cols, "sun").map((c) => c.id), ["b", "c", "a"]);
  assert.deepEqual(rankColumns(cols, "night").map((c) => c.id), ["a", "c", "b"]); // lower is better
  assert.deepEqual(rankColumns(cols, "contact").map((c) => c.id), ["a", "b", "c"]); // all tied
});

test("comparisonCsv has a row per metric and an empty cell for a missing value", () => {
  const metrics = [{ key: "sun", label: "Sunlit", kind: "pct" }, { key: "dark", label: "Dark", kind: "hours" }, { key: "ring", label: "Ring", kind: "pct" }];
  const csv = comparisonCsv([{ id: "A", metrics: { sun: 0.9, dark: 12, ring: null } }, { id: "B", metrics: { sun: 0.5, dark: 3.25, ring: 0.2 } }], metrics);
  assert.equal(csv, 'metric,A,B\n"Sunlit (%)",90.0,50.0\n"Dark (h)",12.0,3.3\n"Ring (%)",,20.0\n');
});

test("the map-error rows: a higher skyline is compared with the actual result, and the CSV carries them", () => {
  const rows = METRICS.filter((m) => m.key === "raisedDarkHours" || m.key === "raisedSunlit");
  assert.deepEqual(rows.map((m) => [m.key, m.better, m.kind]), [["raisedDarkHours", "low", "hours"], ["raisedSunlit", "high", "pct"]]);
  const cols = [{ id: "a", metrics: { raisedDarkHours: 100, raisedSunlit: 0.5 } }, { id: "b", metrics: { raisedDarkHours: 60, raisedSunlit: 0.5 } }];
  const best = bestColumns(cols, rows);
  assert.deepEqual([...best.raisedDarkHours], [1]);
  assert.deepEqual([...best.raisedSunlit].sort(), [0, 1]);
  assert.match(comparisonCsv(cols, rows), /"Longest night \(\+0.25° horizon\) \(h\)",100.0,60.0/);
});

test("the Sun's highest elevation row: degrees with a sign, a core row that is never tagged best", () => {
  const top = METRICS.find((m) => m.key === "sunMaxElevationDeg");
  assert.equal(top.core, true);
  assert.equal(top.better, undefined); // a higher Sun is not a better spot: near the pole terrain decides
  assert.equal(METRICS.some((m) => m.key === "sunLitMeanElevationDeg" || m.key === "sunNearSkylineShare"), false);
  const cols = [{ id: "a", metrics: { sunMaxElevationDeg: 2.04 } }, { id: "b", metrics: { sunMaxElevationDeg: 7.4 } }];
  assert.deepEqual([...bestColumns(cols, [top]).sunMaxElevationDeg], []);
  assert.equal(formatMetric(top, 2.04), "2.0°");
  assert.equal(formatMetric(top, -1.2), "−1.2°");
  assert.equal(formatMetric(top, null), "—");
  assert.match(comparisonCsv(cols, [top]), /"Peak Sun elevation \(°\)",2\.0,7\.4/);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { Horizon } from "../../engine/index.js";
import { clearanceSeries, clearanceStats, fragilityRows } from "../clearance.js";

const series = {
  et: Float64Array.from([0, 900, 1800, 2700]),
  sunElevation: Float64Array.from([1.0, 0.3, -0.2, 0.1]),
  sunAzimuth: Float64Array.from([0, 0, 90, 90]),
  sunFraction: Float64Array.from([1, 1, 0, 0.2]),
  earthElevation: Float64Array.from([5, 4, 3, 2]),
  earthAzimuth: Float64Array.from([0, 0, 0, 0]),
};
const horizon = new Horizon([0.5, 0.5, -0.5, 0]); // 4 azimuths: 0, 90, 180, 270 deg

test("clearance is elevation minus the skyline in the body's direction", () => {
  const c = clearanceSeries(series, horizon);
  assert.deepEqual(Array.from(c.sun, (v) => Math.round(v * 100) / 100), [0.5, -0.2, -0.7, -0.4]);
  assert.deepEqual(Array.from(c.earth), [4.5, 3.5, 2.5, 1.5]);
});

test("highest clearance and the share of sunlit time that is marginal", () => {
  const c = clearanceSeries(series, horizon);
  const s = clearanceStats(series, c.sun, 0.25);
  assert.equal(s.maxSun, 0.5);
  assert.equal(s.maxSunEt, 0);
  assert.equal(s.sunlitSamples, 3);
  assert.equal(s.nearSamples, 2); // clearance 0.5 is not near; -0.2 and -0.4 (a sliver of the disk) are
  assert.equal(s.nearShare, 2 / 3);
  assert.equal(clearanceStats({ ...series, sunFraction: new Float64Array(4) }, c.sun).nearShare, null);
});

test("fragility rows pair each result with the actual value", () => {
  const rows = fragilityRows({ sunlitFraction: 0.7, longestDarkHours: 100 }, { 0.1: { sunlitFraction: 0.66, longestDarkHours: 110, dsnLinkFraction: 0.5 }, 0.25: { sunlitFraction: 0.6, longestDarkHours: 120, dsnLinkFraction: 0.5 } });
  assert.deepEqual(rows.map((r) => [r.error, r.sunlit, r.sunlitWas, r.darkHours, r.darkWas]), [[0.1, 0.66, 0.7, 110, 100], [0.25, 0.6, 0.7, 120, 100]]);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { earthLevel, fullSunHours, lightCapture, longestRun, missionFacts, sunHighest, sunLevel } from "../events.js";

test("levels follow the visible fraction", () => {
  assert.deepEqual([0, 0.2, 1].map(sunLevel), [0, 1, 1]);
  assert.deepEqual([0, 0.5, 1].map(earthLevel), [0, 1, 2]);
});

test("longestRun finds the longest stretch of a level", () => {
  assert.deepEqual(longestRun([1, 0, 0, 1, 0, 0, 0, 1], 0), [4, 7]);
  assert.deepEqual(longestRun([0, 0], 0), [0, 2]);
  assert.equal(longestRun([1, 1], 0), null);
});

test("missionFacts: first sunset and Earthset, longest night and gap, shares", () => {
  // 6 samples, 6 h apart: the Sun sets at sample 2 for two samples; Earth is hidden from sample 4; the link drops at 1 and 4-5
  const sunFraction = [1, 0.5, 0, 0, 1, 1], earthFraction = [1, 1, 1, 0.5, 0, 0];
  const f = missionFacts({ sunFraction, earthFraction }, [1, 0, 1, 1, 0, 0], 6 * 3600);
  assert.equal(f.firstSunsetH, 12);
  assert.equal(f.firstEarthsetH, 24);
  assert.equal(f.longestNightH, 12);
  assert.equal(f.longestNoLinkH, 12);
  assert.ok(Math.abs(f.sunShare - 4 / 6) < 1e-9 && Math.abs(f.linkShare - 3 / 6) < 1e-9);
  const never = missionFacts({ sunFraction: [1, 1], earthFraction: [1, 1] }, [1, 1], 3600);
  assert.deepEqual([never.firstSunsetH, never.firstEarthsetH, never.longestNightH, never.longestNoLinkH], [null, null, 0, 0]);
  assert.deepEqual([f.sunUpAtLanding, f.earthUpAtLanding, f.firstSunriseH, f.firstEarthriseH], [true, true, null, null]);
});

test("missionFacts: a body that is down at landing has a first rise", () => {
  // Earth is below the skyline for the first three samples and rises at the fourth; the Sun is up and sets at the third
  const f = missionFacts({ sunFraction: [1, 1, 0, 0, 0], earthFraction: [0, 0, 0, 1, 1] }, [0, 0, 0, 1, 1], 6 * 3600);
  assert.equal(f.earthUpAtLanding, false);
  assert.equal(f.firstEarthriseH, 18);
  assert.equal(f.firstEarthsetH, 0); // the old field: down at once
  assert.equal(f.sunUpAtLanding, true);
  assert.equal(f.firstSunriseH, null);
  const down = missionFacts({ sunFraction: [0, 0, 1], earthFraction: [1, 1, 1] }, [1, 1, 1], 3600);
  assert.equal(down.firstSunriseH, 2);
});

test("sunHighest: the highest centre elevation over every sample, hidden or not, and null for an empty window", () => {
  assert.equal(sunHighest({ sunElevation: [3, 1, -1, 2] }), 3);
  assert.equal(sunHighest({ sunElevation: [-2, -1.2, -3] }), -1.2);
  assert.equal(sunHighest({ sunElevation: [] }), null);
});

test("lightCapture: a Sun-tracking upright array follows cos E, a flat one sin E, both weighted by the visible fraction", () => {
  const level = lightCapture({ sunFraction: [1, 1], sunElevation: [0, 0] });
  assert.deepEqual(level, { upright: 1, flat: 0 });
  const high = lightCapture({ sunFraction: [1], sunElevation: [30] });
  assert.ok(Math.abs(high.upright - Math.sqrt(3) / 2) < 1e-12 && Math.abs(high.flat - 0.5) < 1e-12);
  const half = lightCapture({ sunFraction: [1, 0.5, 0], sunElevation: [0, 60, 10] }); // weights 1 and 0.5; the hidden sample is ignored
  assert.ok(Math.abs(half.upright - (1 + 0.5 * 0.5) / 1.5) < 1e-12);
  assert.ok(Math.abs(half.flat - (0.5 * Math.sqrt(3) / 2) / 1.5) < 1e-12);
  assert.equal(lightCapture({ sunFraction: [0], sunElevation: [5] }), null);
});

test("missionFacts carries the Sun's highest elevation and the light captured when the series has elevations", () => {
  const f = missionFacts({ sunFraction: [1, 1, 0], earthFraction: [1, 1, 1], sunElevation: [1, 3, -2] }, [1, 1, 1], 3600);
  assert.equal(f.sunHighest, 3);
  assert.ok(f.capture.upright > 0.99 && f.capture.flat < 0.05);
  assert.equal(missionFacts({ sunFraction: [1], earthFraction: [1] }, [1], 3600).sunHighest, null);
});

test("light captured at real sites: a Sun-tracking upright array loses almost nothing at the pole and a third at Apollo 11", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { Ephemeris, SiteCatalog, parseUtc, timeSeries, STEP_S } = await import("../../engine/index.js");
  const data = fileURLToPath(new URL("../../data/", import.meta.url));
  const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const eph = new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin"));
  const catalog = new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin"));
  const year = (site, horizon) => timeSeries(eph, site, horizon, parseUtc("2027-01-01T00:00:00"), parseUtc("2028-01-01T00:00:00") - STEP_S, STEP_S);
  const pole = catalog.spot("Site01-1", 2);
  const atPole = lightCapture(year(pole.site, pole.horizon));
  assert.ok(atPole.upright > 0.999, `upright ${atPole.upright}`);
  assert.ok(atPole.flat > 0.005 && atPole.flat < 0.02, `flat ${atPole.flat}`); // about 1%: 80 of 7,463 Wh/W
  const apollo = catalog.spot("a11", 2);
  const atApollo = lightCapture(year(apollo.site, apollo.horizon));
  assert.ok(atApollo.upright > 0.6 && atApollo.upright < 0.7, `Apollo 11 upright ${atApollo.upright}`); // about 64%
});

test("fullSunHours sums the visible fraction of the Sun times the step", () => {
  assert.equal(fullSunHours({ sunFraction: [1, 1, 1, 1] }, 3600), 4);
  assert.equal(fullSunHours({ sunFraction: [1, 0.5, 0, 0.5] }, 900), 0.5);
  assert.equal(fullSunHours({ sunFraction: [] }, 900), 0);
});

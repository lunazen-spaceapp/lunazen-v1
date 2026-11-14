// The browser engine must reproduce the validated Python reference (fixtures.json,
// written by pipeline/make_fixtures.py). Run: cd web && npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PolarGrid, traceHorizon } from "../tracer.js";
import { Ephemeris, Horizon, SiteCatalog, bodyState, etToUtcMs, evaluateLandings, feasible, fragility, moonElevations, parseUtc, siteFromLatLon, stationInView, summarize, timeSeries, timeToChange, windows, STEP_S } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const header = JSON.parse(readFileSync(join(dataDir, "ephemeris.json"), "utf8"));
const bin = readFileSync(join(dataDir, "ephemeris.bin"));
const ephemeris = new Ephemeris(header, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const rotationHeader = JSON.parse(readFileSync(join(dataDir, "ephemeris_rotation.json"), "utf8"));
const rotationBin = readFileSync(join(dataDir, "ephemeris_rotation.bin"));
ephemeris.setRotation(rotationHeader, rotationBin.buffer.slice(rotationBin.byteOffset, rotationBin.byteOffset + rotationBin.byteLength));

const ARCSEC = 1 / 3600;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("ET -> UTC inverts SPICE str2et to 1 millisecond", () => {
  fixtures.times_et.forEach((et, i) => {
    const expected = Date.parse(`${fixtures.times_utc[i]}Z`);
    assert.ok(Math.abs(etToUtcMs(et) - expected) < 1, `${fixtures.times_utc[i]}: ${etToUtcMs(et) - expected} ms`);
  });
});

test("UTC -> ET matches SPICE str2et to 1 microsecond", () => {
  fixtures.times_utc.forEach((utc, i) => {
    assert.ok(Math.abs(parseUtc(utc) - fixtures.times_et[i]) < 1e-6, utc);
  });
});

test("DSN: Moon elevation at each complex matches SPICE (IAU_EARTH) to 0.001 deg", () => {
  let worst = 0;
  fixtures.times_et.forEach((et, i) => {
    const got = moonElevations(ephemeris, et);
    for (const [name, expected] of Object.entries(fixtures.dsn_moon_elevation_deg)) {
      worst = Math.max(worst, Math.abs(got[name] - expected[i]));
    }
  });
  assert.ok(worst < 1e-3, `worst ${worst} deg`);
});

for (const [siteId, s] of Object.entries(fixtures.sites)) {
  test(`${siteId}: Sun/Earth direction and disk fraction match Python`, () => {
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const horizon = new Horizon(s.horizonDeg);
    fixtures.times_et.forEach((et, i) => {
      const sun = bodyState(ephemeris, "SUN", site, horizon, et);
      const earth = bodyState(ephemeris, "EARTH", site, horizon, et);
      assert.ok(angleDiff(sun.azimuth, s.sun.azimuth_deg[i]) * Math.cos((sun.elevation * Math.PI) / 180) < 0.1 * ARCSEC);
      assert.ok(Math.abs(sun.elevation - s.sun.elevation_deg[i]) < 0.1 * ARCSEC);
      assert.ok(angleDiff(earth.azimuth, s.earth.azimuth_deg[i]) * Math.cos((earth.elevation * Math.PI) / 180) < 0.1 * ARCSEC);
      assert.ok(Math.abs(earth.elevation - s.earth.elevation_deg[i]) < 0.1 * ARCSEC);
      assert.ok(Math.abs(sun.fraction - s.sun.fraction[i]) < 1e-4, `${siteId} sun fraction @${i}`);
      assert.ok(Math.abs(earth.fraction - s.earth.fraction[i]) < 1e-4, `${siteId} earth fraction @${i}`);
    });
  });
}

for (const m of fixtures.missions) {
  test(`${m.site} ${m.start_utc.slice(0, 10)}: mission summary matches Python`, () => {
    const s = fixtures.sites[m.site];
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const series = timeSeries(ephemeris, site, new Horizon(s.horizonDeg), parseUtc(m.start_utc), parseUtc(m.end_utc), m.step_s);
    const got = summarize(series);
    for (const [key, expected] of Object.entries(m.expected)) {
      const tolerance = key.endsWith("Hours") ? 1e-9 : Math.max(1e-6, Math.abs(expected) * 1e-5);
      assert.ok(Math.abs(got[key] - expected) <= tolerance, `${key}: ${got[key]} vs ${expected}`);
    }
    for (const body of ["sun", "earth"]) {
      const fraction = body === "sun" ? series.sunFraction : series.earthFraction;
      const jsWindows = windows(series.et, (i) => fraction[i] > 0).map((w) => [w.startEt, w.endEt]);
      assert.equal(jsWindows.length, m.expected_windows[body].length, `${body} window count`);
      jsWindows.forEach(([a, b], k) => {
        assert.ok(Math.abs(a - m.expected_windows[body][k][0]) < 1e-3 && Math.abs(b - m.expected_windows[body][k][1]) < 1e-3, `${body} window ${k}`);
      });
    }
  });
}

for (const [siteId, expected] of Object.entries(fixtures.dsn_station.in_view)) {
  test(`${siteId}: the station-level DSN test matches Python at the fixture moments`, () => {
    const s = fixtures.sites[siteId];
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const horizon = new Horizon(s.horizonDeg);
    fixtures.times_et.forEach((et, i) => assert.equal(stationInView(ephemeris, et, site, horizon), expected[i], `${siteId} @${i}`));
  });
}

for (const m of fixtures.dsn_station.missions) {
  test(`${m.site} ${m.start_utc.slice(0, 10)}: the station-level DSN summary matches Python`, () => {
    const s = fixtures.sites[m.site];
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const horizon = new Horizon(s.horizonDeg);
    const got = summarize(timeSeries(ephemeris, site, horizon, parseUtc(m.start_utc), parseUtc(m.end_utc), m.step_s, { dsnRule: "station" }));
    const tolerance = 2 / ((parseUtc(m.end_utc) - parseUtc(m.start_utc)) / m.step_s); // a couple of samples at an edge
    assert.ok(Math.abs(got.dsnLinkFraction - m.expected.dsnLinkFraction) <= tolerance, `${got.dsnLinkFraction} vs ${m.expected.dsnLinkFraction}`);
    assert.ok(Math.abs(got.longestDsnLinkGapHours - m.expected.longestDsnLinkGapHours) <= (2 * m.step_s) / 3600, `${got.longestDsnLinkGapHours} vs ${m.expected.longestDsnLinkGapHours}`);
    // The default rule is untouched, and the station rule never gives more DSN time than the disk rule.
    const disk = summarize(timeSeries(ephemeris, site, horizon, parseUtc(m.start_utc), parseUtc(m.end_utc), m.step_s));
    assert.ok(got.dsnLinkFraction <= disk.dsnLinkFraction + 1e-12);
    assert.ok(got.longestDsnLinkGapHours >= disk.longestDsnLinkGapHours - 1e-9);
  });
}

for (const m of fixtures.dark_below.missions) {
  test(`${m.site} ${m.start_utc.slice(0, 10)}: the longest dark period counting the Sun as down below ${m.dark_below * 100}% matches Python`, () => {
    const s = fixtures.sites[m.site];
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const series = timeSeries(ephemeris, site, new Horizon(s.horizonDeg), parseUtc(m.start_utc), parseUtc(m.end_utc), m.step_s);
    assert.equal(summarize(series, m.dark_below).longestDarkHours, m.longest_dark_hours);
    // The default is unchanged, a looser threshold never shortens the night, and no other figure moves.
    const plain = summarize(series);
    assert.ok(summarize(series, m.dark_below).longestDarkHours >= plain.longestDarkHours);
    assert.equal(summarize(series, m.dark_below).sunlitFraction, plain.sunlitFraction);
  });
}

test("planner: landings with the Sun counted as down below 10% and 50% match Python", () => {
  const p = fixtures.dark_below.planner;
  const s = fixtures.sites[p.site];
  const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
  const series = timeSeries(ephemeris, site, new Horizon(s.horizonDeg), parseUtc(p.start_utc), parseUtc(p.end_utc), STEP_S);
  for (const [below, expected] of Object.entries(p.expected)) {
    const got = evaluateLandings(series, p.mission_s, p.stride, Number(below));
    assert.equal(got.length, expected.length);
    got.forEach((r, i) => assert.equal(r.longestDarkHours, expected[i].longestDarkHours, `${below} landing ${i}`));
  }
});

test("one site-year at the standard step runs fast enough for live interaction", () => {
  const s = fixtures.sites["Site01-1"];
  const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
  const t0 = performance.now();
  timeSeries(ephemeris, site, new Horizon(s.horizonDeg), parseUtc("2030-01-01T00:00:00"), parseUtc("2031-01-01T00:00:00"), STEP_S);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `one site-year took ${ms.toFixed(0)} ms`);
});

test("the 15-minute step resolves DSN hand-offs that hourly sampling smooths away", () => {
  const s = fixtures.sites["Site01-1"];
  const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
  const horizon = new Horizon(s.horizonDeg);
  const et0 = parseUtc("2027-03-01T00:00:00");
  const et1 = parseUtc("2027-05-30T00:00:00");
  const count = (step) => {
    const series = timeSeries(ephemeris, site, horizon, et0, et1, step);
    return windows(series.et, (i) => series.earthFraction[i] > 0 && series.dsnInView[i] === 1).length;
  };
  assert.ok(count(STEP_S) >= 2 * count(3600), `${count(STEP_S)} windows at ${STEP_S} s vs ${count(3600)} hourly`);
});

test("web export: the browser reproduces the Python 2027 metrics at real spots", () => {
  const catalogue = JSON.parse(readFileSync(join(dataDir, "sites.json"), "utf8"));
  const horizons = readFileSync(join(dataDir, catalogue.format.horizons));
  const sites = new SiteCatalog(catalogue, horizons.buffer.slice(horizons.byteOffset, horizons.byteOffset + horizons.byteLength));
  const et0 = parseUtc("2027-01-01T00:00:00");
  const et1 = parseUtc("2028-01-01T00:00:00");
  let worstFraction = 0;
  let worstHours = 0;
  for (const id of sites.spots.keys()) {
    for (const mast of sites.mastsM) {
      const { site, horizon, record } = sites.spot(id, mast);
      const got = summarize(timeSeries(ephemeris, site, horizon, et0, et1, STEP_S));
      const expected = record.year2027[String(mast)];
      for (const key of ["sunlitFraction", "earthFraction", "bothFraction"]) {
        worstFraction = Math.max(worstFraction, Math.abs(got[key] - expected[key]));
      }
      for (const key of ["longestDarkHours", "longestCommsGapHours"]) {
        worstHours = Math.max(worstHours, Math.abs(got[key] - expected[key]));
      }
    }
  }
  // All spots x 4 masts. Python computed these from full-precision horizons; the export
  // stores 0.01 deg steps. Measured worst: 0.00068 in fraction, 2 h in duration.
  assert.ok(worstFraction <= 0.001, `fraction differs by ${worstFraction}`);
  assert.ok(worstHours <= 2, `duration differs by ${worstHours} h`);
});

test("planner: landing evaluations match Python for every 6-hourly landing time", () => {
  const p = fixtures.planner;
  const s = fixtures.sites[p.site];
  const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
  const series = timeSeries(ephemeris, site, new Horizon(s.horizonDeg), parseUtc(p.start_utc), parseUtc(p.end_utc), p.step_s);
  const got = evaluateLandings(series, p.mission_s, p.stride);
  assert.equal(got.length, p.expected.length);
  got.forEach((g, k) => {
    const e = p.expected[k];
    assert.equal(g.startIndex, e.startIndex);
    for (const key of ["longestDarkHours", "longestLinkGapHours"]) assert.equal(g[key], e[key], `${key} @${k}`);
    assert.equal(feasible(g, p.min_link, p.max_dark_hours), p.expected_feasible_dark[k], `darkness rule @${k}`);
    for (const key of ["sunlitFraction", "linkFraction"]) assert.ok(Math.abs(g[key] - e[key]) < 1e-9, `${key} @${k}`);
  });
});

test("planner: the same landings with the skyline 0.25 degrees higher match Python", () => {
  const p = fixtures.planner;
  const s = fixtures.sites[p.site];
  const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
  const series = timeSeries(ephemeris, site, new Horizon(s.horizonDeg).raised(0.25), parseUtc(p.start_utc), parseUtc(p.end_utc), p.step_s);
  const got = evaluateLandings(series, p.mission_s, p.stride);
  assert.deepEqual(got.map((g) => feasible(g, p.min_link, p.max_dark_hours)), p.expected_feasible_dark_raised);
  assert.notDeepEqual(p.expected_feasible_dark_raised, p.expected_feasible_dark, "a higher skyline must change some landings");
});

for (const f of fixtures.fragility) {
  test(`${f.site}: results with a higher skyline match Python`, () => {
    const s = fixtures.sites[f.site];
    const site = siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM);
    const got = fragility(ephemeris, site, new Horizon(s.horizonDeg), parseUtc(f.start_utc), parseUtc(f.end_utc), f.step_s);
    assert.deepEqual(Object.keys(got), Object.keys(f.expected));
    for (const [error, expected] of Object.entries(f.expected)) {
      for (const [key, value] of Object.entries(expected)) {
        const tolerance = key.endsWith("Hours") ? 1e-9 : 1e-6;
        assert.ok(Math.abs(got[error][key] - value) <= tolerance, `${error} ${key}: ${got[error][key]} vs ${value}`);
      }
    }
  });
}

test("time to the next set or rise matches Python on the 15-minute grid", () => {
  const sites = {};
  for (const [id, s] of Object.entries(fixtures.sites)) {
    sites[id] = { site: siteFromLatLon(s.latitudeDeg, s.longitudeDeg, s.heightM), horizon: new Horizon(Float64Array.from(s.horizonDeg)) };
  }
  assert.ok(fixtures.time_to_change.length > 0);
  for (const c of fixtures.time_to_change) {
    const { site, horizon } = sites[c.site];
    const got = timeToChange(ephemeris, site, horizon, c.et, c.body);
    assert.equal(got.up, c.up, `${c.site} ${c.body} ${c.et}`);
    assert.equal(got.hours, c.hours, `${c.site} ${c.body} ${c.et}`);
  }
});

test("custom points: the JS tracer reproduces clps/custom.py on the exported crops (1e-3 deg)", () => {
  const dir = join(dataDir, "custom");
  const manifest = JSON.parse(readFileSync(join(dir, "custom.json"), "utf8"));
  const grid = (entry) => {
    const b = readFileSync(join(dir, entry.file));
    return new PolarGrid(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), entry);
  };
  const far = grid(manifest.far);
  for (const c of fixtures.custom) {
    const crop = grid(manifest.sites.find((s) => s.id === c.site));
    const { elevation } = traceHorizon(c.latitude_deg, c.longitude_deg, c.ground_m, [crop, far]);
    let worst = 0;
    c.horizon_deg.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - elevation[i])); });
    assert.equal(elevation.length, c.horizon_deg.length);
    assert.ok(worst < 1e-3, `${c.site}: worst ${worst} deg`);
  }
});

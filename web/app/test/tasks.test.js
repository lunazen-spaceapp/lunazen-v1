import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ephemeris, SiteCatalog, feasible, parseUtc, STEP_S } from "../../engine/index.js";
import { combine } from "../plan.js";
import { runTask } from "../tasks.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = {
  ephemeris: new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin")),
  catalog: new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin")),
};

test("landing tasks reproduce the book's Planner numbers (the workers run exactly this)", () => {
  const et0 = parseUtc("2027-01-01T00:00:00");
  const et1 = et0 + (365 + 14) * 86400;
  const task = (point) => ({ kind: "landings", spot: "Site01-1", mast: 2, point, et0, et1, missionS: 14 * 86400, stride: (6 * 3600) / STEP_S });
  const evaluations = Array.from({ length: 13 }, (_, point) => runTask(ctx, task(point)));
  const rows = combine(evaluations, 0.5, 50);
  const atLeast = (n) => rows.filter((r) => r.ok && Math.round(r.robustness * 13) >= n).length;
  assert.deepEqual([atLeast(1), atLeast(12), atLeast(13)], [628, 64, 0]);
});

test("the engine reproduces the precomputed 2028 and 2029 summaries", () => {
  for (const year of ["2028", "2029"]) {
    const et0 = parseUtc(`${year}-01-01T00:00:00`);
    const et1 = parseUtc(`${Number(year) + 1}-01-01T00:00:00`);
    const out = runTask(ctx, { kind: "column", id: "Site01-1", mast: 2, et0, et1 });
    const expected = ctx.catalog.yearMetrics(ctx.catalog.spots.get("Site01-1"), year);
    assert.ok(Math.abs(out.metrics.sunlitFraction - expected.sunlitFraction) < 1e-3, year);
    assert.ok(Math.abs(out.metrics.earthFraction - expected.earthFraction) < 1e-3, year);
  }
});

test("a column task gives a spot's series, metrics and its sunlight range within 100 m", () => {
  const et0 = parseUtc("2027-01-01T00:00:00");
  const out = runTask(ctx, { kind: "column", id: "Site01-1", mast: 2, et0, et1: et0 + 365 * 86400 });
  const year = ctx.catalog.spots.get("Site01-1").year2027["2"];
  assert.ok(Math.abs(out.metrics.sunlitFraction - year.sunlitFraction) < 1e-3);
  assert.ok(out.ringSunMin <= out.metrics.sunlitFraction && out.metrics.sunlitFraction <= out.ringSunMax);
  assert.equal(out.series.et.length, 365 * 96 + 1);
  const mission = runTask(ctx, { kind: "column", id: "im1", mast: 2, et0, et1: et0 + 86400 });
  assert.equal(mission.ringSunMin, null);
  assert.throws(() => runTask(ctx, { kind: "nope" }), /unknown task/);
});

test("a custom point near Site01-1 is traced in the browser and runs through the tasks like a spot (also via a worker's copy)", async () => {
  const { ensureCustom, withCustom } = await import("../customs.js");
  globalThis.document = { createElement: () => ({ setAttribute() {}, remove() {} }), body: { append() {} } };
  globalThis.fetch = async (url) => {
    const f = readFileSync(String(url).replace(/^.*?data\//, data));
    return { json: async () => JSON.parse(f.toString()), arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) };
  };
  const catalog = new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin"));
  const spot = catalog.spots.get("Site01-1");
  const id = `pt_${spot.latitudeDeg.toFixed(4)}_${spot.longitudeDeg.toFixed(4)}`;
  assert.ok(await ensureCustom(catalog, data.replace(/\/$/, ""), id));
  assert.equal(catalog.customs.get(id).ring.length, 12);
  const et0 = parseUtc("2027-03-01T00:00:00");
  const task = { kind: "column", id, mast: 2, et0, et1: et0 + 30 * 86400 };
  const mine = runTask({ ephemeris: ctx.ephemeris, catalog }, task);
  const stored = runTask(ctx, { ...task, id: "Site01-1" });
  assert.ok(Math.abs(mine.metrics.sunlitFraction - stored.metrics.sunlitFraction) < 0.03, `${mine.metrics.sunlitFraction} vs ${stored.metrics.sunlitFraction}`);
  // A worker has only the stock catalogue: the task carries the point.
  const worker = { ephemeris: ctx.ephemeris, catalog: new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin")) };
  const viaWorker = runTask(worker, structuredClone(withCustom(catalog, task)));
  assert.equal(viaWorker.metrics.sunlitFraction, mine.metrics.sunlitFraction);
  const landings = runTask(worker, structuredClone(withCustom(catalog, { kind: "landings", spot: id, mast: 5, point: 3, et0, et1: et0 + 40 * 86400, missionS: 14 * 86400, stride: 24 })));
  assert.ok(landings.length > 0);
});

test("sites away from the pole are in the catalogue as fixed-mast records and run through the tasks", () => {
  const apollo = ctx.catalog.customs.get("a17");
  assert.equal(apollo.group, "beyond");
  assert.equal(ctx.catalog.beyond.sites.length, 12);
  const { site, record } = ctx.catalog.spot("a17", 10); // another mast falls back to the stored 2 m horizon
  assert.equal(record.id, "a17");
  const et0 = parseUtc("2027-03-01T00:00:00");
  const column = runTask(ctx, { kind: "column", id: "a17", mast: 10, et0, et1: et0 + 60 * 86400 });
  assert.ok(column.metrics.sunlitFraction > 0.3 && column.metrics.sunlitFraction < 0.7, `${column.metrics.sunlitFraction}`);
  assert.equal(ctx.catalog.ring("a17").length, 0);
});

test("a landing task with the skyline raised never makes a landing work that did not", () => {
  const et0 = parseUtc("2027-03-01T00:00:00");
  const base = { kind: "landings", spot: "Site01-1", mast: 2, point: 0, et0, et1: et0 + (90 + 14) * 86400, missionS: 14 * 86400, stride: (6 * 3600) / STEP_S };
  const plain = runTask(ctx, base);
  const raised = runTask(ctx, { ...base, raise: 0.25 });
  assert.equal(raised.length, plain.length);
  let changed = 0;
  plain.forEach((p, k) => {
    const a = feasible(p, 0.5, 50), b = feasible(raised[k], 0.5, 50);
    assert.ok(!b || a, `landing ${k} works only with the higher skyline`);
    changed += a && !b;
  });
  assert.ok(changed > 0, "some landings should fail with a higher skyline");
});

test("column and rank tasks report the result with the skyline raised, never better than the actual one", () => {
  const et0 = parseUtc("2027-03-01T00:00:00");
  const col = runTask(ctx, { kind: "column", id: "Site01-1", mast: 2, et0, et1: et0 + 60 * 86400 });
  assert.ok(col.raised.sunlitFraction <= col.metrics.sunlitFraction);
  assert.ok(col.raised.longestDarkHours >= col.metrics.longestDarkHours);
  const mission = runTask(ctx, { kind: "column", id: "im1", mast: 2, et0: parseUtc("2024-02-22T23:00:00"), et1: parseUtc("2024-03-06T00:00:00") });
  assert.ok(mission.raised.longestDarkHours >= mission.metrics.longestDarkHours);
  const rank = runTask(ctx, { kind: "rank", id: "Site01-1", mast: 2, et0, missionS: 14 * 86400, minLink: 0.5, maxDarkHours: 50 });
  assert.ok(rank.raised.sunlitFraction <= rank.metrics.sunlitFraction && rank.raised.longestDarkHours >= rank.metrics.longestDarkHours);
});

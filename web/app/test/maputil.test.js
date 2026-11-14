import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { easeView, fitBox, inBox, latLonToPolar, latitudeRadius, polarToLatLon, sampleValues } from "../maputil.js";

const data = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

test("projection reproduces the Python spot coordinates and round-trips", () => {
  const catalog = JSON.parse(readFileSync(join(data, "sites.json"), "utf8"));
  for (const s of catalog.spots) {
    const [x, y] = latLonToPolar(s.latitudeDeg, s.longitudeDeg);
    assert.ok(Math.abs(x - s.xM) < 0.01 && Math.abs(y - s.yM) < 0.01, s.id);
    const [lat, lon] = polarToLatLon(x, y);
    assert.ok(Math.abs(lat - s.latitudeDeg) < 1e-9 && Math.abs(((lon - s.longitudeDeg + 540) % 360) - 180) < 1e-9, s.id);
  }
  assert.ok(Math.abs(latitudeRadius(-85) - 151740) < 50); // the 85 deg S map edge
});

test("value lookup returns NASA's grid values at a spot's cell", () => {
  const meta = JSON.parse(readFileSync(join(data, "map.json"), "utf8"));
  const values = new Uint8Array(readFileSync(join(data, meta.values.file)));
  const catalog = JSON.parse(readFileSync(join(data, "sites.json"), "utf8"));
  const spot = catalog.spots.find((s) => s.id === "Site01-1");
  const v = sampleValues(values, meta, spot.xM, spot.yM);
  // The cell holds the brightest 60 m pixel within 600 m, so it is at least the spot's own value.
  assert.ok(v.sun >= Math.round(spot.nasaAvgSun * 100) - 1, `${v.sun} vs ${spot.nasaAvgSun}`);
  assert.equal(sampleValues(values, meta, 1e7, 0), null);
});

test("fitBox fits the longer side with the margin and centres the box", () => {
  const v = fitBox({ x0M: -19000, x1M: -3000, y0M: -20000, y1M: -4000 }, 800, 600, 1.25);
  assert.deepEqual([v.cx, v.cy], [-11000, -12000]);
  assert.equal(v.scale, (16000 / 600) * 1.25); // the tall side of a wide canvas decides
  assert.equal(fitBox({ x0M: 0, x1M: 20000, y0M: 0, y1M: 10000 }, 1000, 1000).scale, 24);
});

test("easeView starts and ends exactly on the two views and changes zoom by ratio", () => {
  const a = { scale: 400, cx: 0, cy: 0 }, b = { scale: 25, cx: 8000, cy: -4000 };
  assert.deepEqual(easeView(a, b, 0), a);
  assert.deepEqual(easeView(a, b, 1), b);
  const mid = easeView(a, b, 0.5);
  assert.equal(mid.scale, 100); // halfway in zoom, geometric mean of 400 and 25 is 100
  assert.deepEqual([mid.cx, mid.cy], [4000, -2000]);
  assert.ok(easeView(a, b, 0.1).scale > easeView(a, b, 0.5).scale);
});

test("inBox includes the edges", () => {
  const box = { x0M: 0, x1M: 10, y0M: -5, y1M: 5 };
  assert.ok(inBox(0, 5, box) && inBox(10, -5, box));
  assert.ok(!inBox(10.1, 0, box) && !inBox(5, 6, box));
});

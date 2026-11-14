import test from "node:test";
import assert from "node:assert/strict";
import { azOffset, labelOffset, windowRange } from "../panorama.js";

test("azOffset wraps through north", () => {
  assert.equal(azOffset(350, 10), -20);
  assert.equal(azOffset(10, 350), 20);
  assert.equal(azOffset(180, 0), -180);
});

const flat = (el) => ({ n: 4, elevation: [el, el, el, el] });

test("windowRange is true scale when the skyline and bodies fit", () => {
  const r = windowRange(flat(0), [{ azimuth: 10, elevation: 3, radius: 0.27 }], 0, 60, 0.45);
  assert.equal(r.stretch, 1);
  assert.ok(Math.abs(r.range[1] - r.range[0] - 27) < 1e-9);
  assert.ok(r.range[0] < 0 && r.range[1] > 3.27);
});

test("windowRange stretches only as far as needed", () => {
  const r = windowRange(flat(0), [{ azimuth: 0, elevation: 40, radius: 1 }], 0, 30, 0.45);
  assert.ok(r.stretch < 1);
  assert.ok(r.range[1] >= 41 && r.range[0] <= 0);
});

test("bodies outside the window are ignored", () => {
  const r = windowRange(flat(0), [{ azimuth: 180, elevation: 60, radius: 1 }], 0, 60, 0.45);
  assert.equal(r.stretch, 1);
});

test("in an exact window a hidden Sun far below the skyline does not push a high Earth out of frame", () => {
  const earth = { azimuth: 5, elevation: 69.4, radius: 0.9 };
  const sun = { azimuth: -8, elevation: -33, radius: 0.27 };
  const r = windowRange(flat(0), [sun, earth], 0, 120, 0.646, true, earth);
  assert.ok(r.range[0] <= 69.4 - 0.9 && r.range[1] >= 69.4 + 0.9, `${r.range}`);
  const noon = windowRange(flat(0), [{ azimuth: 0, elevation: 89.6, radius: 0.27 }], 0, 120, 0.646, true, { azimuth: 0, elevation: 89.6, radius: 0.27 });
  assert.ok(noon.range[1] >= 89.6 + 0.27, `${noon.range}`);
});

test("labelOffset keeps a label beside its dot, and lifts it off the skyline or the horizon line", () => {
  assert.equal(labelOffset(100, 150, 200, 90), 4); // clear of both lines
  assert.equal(labelOffset(100, 105, 200, 90), -9); // on the skyline: above the dot
  assert.equal(labelOffset(100, 150, 96, 90), -9); // on the horizon line
  assert.equal(labelOffset(14, 20, 200, 10), 17); // no room above: below the dot
});

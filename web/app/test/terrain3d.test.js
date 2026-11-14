import { test } from "node:test";
import assert from "node:assert/strict";

import { enuFromAzEl, parsePatch } from "../terrain3d.js";

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} vs ${b}`));

test("azimuth from north, clockwise; elevation above the horizontal", () => {
  close(enuFromAzEl(0, 0), [0, 1, 0]);
  close(enuFromAzEl(90, 0), [1, 0, 0]);
  close(enuFromAzEl(180, 0), [0, -1, 0]);
  close(enuFromAzEl(0, 90), [0, 0, 1]);
});

test("patches decode uint16 heights with each grid's offset and scale", () => {
  const q = new Uint16Array([0, 65535, 100, 200, 0, 1, 2, 3, 4]);
  const header = { grids: [
    { name: "inner", n: 2, halfM: 10, spacingM: 20, offsetM: -100, scaleM: 0.01, byteOffset: 0 },
    { name: "near", n: 2, halfM: 30, spacingM: 60, offsetM: 5, scaleM: 2, byteOffset: 8 },
  ] };
  const [inner, near] = parsePatch(header, q.buffer);
  assert.ok(Math.abs(inner.heights[1] - (-100 + 655.35)) < 1e-3);
  assert.deepEqual(Array.from(near.heights), [5, 7, 9, 11]);
  assert.equal(near.spacingM, 60);
});

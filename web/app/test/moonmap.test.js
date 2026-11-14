import test from "node:test";
import assert from "node:assert/strict";
import { COMPARE_ROWS, lonLatToXY, moonStory, nearestSite, skyFacts, sourceRects, viewOf, VIEWS, wrapLon, xyToLonLat } from "../moonmap.js";

test("longitudes wrap into [-180, 180) and the picture is centred on 0 E", () => {
  assert.ok(Math.abs(wrapLon(336.5781) - (336.5781 - 360)) < 1e-9);
  assert.equal(wrapLon(180), -180);
  assert.deepEqual(lonLatToXY(0, 0, 360, 180), [180, 90]);
  assert.deepEqual(lonLatToXY(90, -180, 360, 180), [0, 0]);
  assert.deepEqual(lonLatToXY(-90, 179.999, 360, 180).map(Math.round), [360, 180]);
});

test("a pixel maps back to the latitude and longitude it came from", () => {
  const [x, y] = lonLatToXY(-45.4561, 177.5885, 2304, 1152);
  const [lon, lat] = xyToLonLat(x, y, 2304, 1152);
  assert.ok(Math.abs(lon - 177.5885) < 1e-9 && Math.abs(lat + 45.4561) < 1e-9);
});

test("nearestSite finds a site within reach and nothing far away", () => {
  const sites = [{ id: "a11", latitudeDeg: 0.67, longitudeDeg: 23.47 }, { id: "a12", latitudeDeg: -3.01, longitudeDeg: 336.58 }];
  const [x, y] = lonLatToXY(0.67, 23.47, 2304, 1152);
  assert.equal(nearestSite(sites, x + 3, y - 2, 2304, 1152).id, "a11");
  assert.equal(nearestSite(sites, x + 200, y, 2304, 1152), null);
});

test("skyFacts and moonStory say what the numbers say, including a far-side site that never sees Earth", () => {
  const near = skyFacts({ sunlitFraction: 0.4865, earthFraction: 1, dsnLinkFraction: 0.98, longestDarkHours: 354.25 }, { sunMaxDeg: 88.6, earthMinDeg: 59.2, earthMaxDeg: 73.4, fullSunHours: 4249.4, capture: { upright: 0.64, flat: 0.64 } });
  assert.equal(near.sunUp, "49%");
  assert.equal(near.sunMax, "89°");
  assert.equal(near.fullSun, "4,249 h");
  assert.equal(near.fullSunNote, "Tracking upright array 64%, flat 64%");
  const polar = skyFacts({ sunlitFraction: 0.897, earthFraction: 0.55, dsnLinkFraction: 0.55, longestDarkHours: 138 }, { sunMaxDeg: 2.04, earthMinDeg: -7, earthMaxDeg: 6, fullSunHours: 7463.2, capture: { upright: 0.9997, flat: 0.0108 } });
  assert.equal(polar.fullSun, "7,463 h");
  assert.equal(polar.fullSunNote, "Tracking upright array 99.9%, flat 1.1%");
  assert.equal(skyFacts({ sunlitFraction: 0, earthFraction: 0, dsnLinkFraction: 0, longestDarkHours: 0 }, { sunMaxDeg: -3, earthMinDeg: -9, earthMaxDeg: -5, fullSunHours: 0, capture: null }).fullSunNote, null);
  assert.equal(near.earthRange, "59° to 73°");
  const far = skyFacts({ sunlitFraction: 0.5, earthFraction: 0, dsnLinkFraction: 0, longestDarkHours: 354 }, { sunMaxDeg: 85, earthMinDeg: -80, earthMaxDeg: -50 });
  assert.equal(far.earthRange, "Below the horizon");
  assert.equal(skyFacts({ sunlitFraction: 0.9, earthFraction: 0.5, dsnLinkFraction: 0.5, longestDarkHours: 10 }, { sunMaxDeg: 2, earthMinDeg: -7.5, earthMaxDeg: 6.2, fullSunHours: 100, capture: null }).earthRange, "−7.5° to 6.2°");
  assert.equal(far.dsn, "0%");
  const pole = { sunMaxDeg: 1.6, earthMinDeg: -6, earthMaxDeg: 8 };
  assert.match(moonStory("Chang'e 4", { earthFraction: 0 }, {}, { sunMaxDeg: 85 }, pole), /never in view from Chang'e 4/);
  assert.match(moonStory("Apollo 11", { earthFraction: 1 }, {}, { sunMaxDeg: 88.6, earthMinDeg: 59.2, earthMaxDeg: 73.4 }, pole), /never gets above 1\.6°.*59° and 73°/);
  assert.equal(COMPARE_ROWS.every(([key]) => key in near), true);
});

test("the near and far views are one hemisphere each, with the Chang'e sites side by side on the far side", () => {
  const [w, h] = [1080, 900];
  assert.deepEqual(lonLatToXY(0, 0, w, h, VIEWS.near).map(Math.round), [540, 360]);
  assert.deepEqual(lonLatToXY(60, -90, w, h, VIEWS.near), [0, 0]);
  assert.deepEqual(lonLatToXY(-90, 90, w, h, VIEWS.near), [1080, 900]);
  assert.deepEqual(lonLatToXY(0, 180, w, h, VIEWS.far).map(Math.round), [540, 360]);
  assert.equal(lonLatToXY(0, 90, w, h, VIEWS.far)[0], 0);
  const [x4] = lonLatToXY(-45.4561, 177.5885, w, h, VIEWS.far);
  const [x6] = lonLatToXY(-41.6385, 206.0148, w, h, VIEWS.far);
  assert.ok(x6 > x4 && x6 - x4 < w / 4); // 28 degrees apart, not on opposite edges
  const [lon, lat] = xyToLonLat(x6, lonLatToXY(-41.6385, 206.0148, w, h, VIEWS.far)[1], w, h, VIEWS.far);
  assert.ok(Math.abs(lon - wrapLon(206.0148)) < 1e-9 && Math.abs(lat + 41.6385) < 1e-9);
});

test("each landing site is on the side its longitude says, and a click finds it only in that view", () => {
  assert.equal(viewOf(23.47), "near");
  assert.equal(viewOf(336.58), "near");
  assert.equal(viewOf(177.59), "far");
  assert.equal(viewOf(206.01), "far");
  const ce4 = [{ id: "ce4", latitudeDeg: -45.4561, longitudeDeg: 177.5885 }];
  const [x, y] = lonLatToXY(-45.4561, 177.5885, 1080, 900, VIEWS.far);
  assert.equal(nearestSite(ce4, x + 2, y, 1080, 900, 14, VIEWS.far).id, "ce4");
});

test("the far side is cut from the whole-Moon image in two pieces that meet in the middle of the picture", () => {
  const [a, b] = sourceRects(VIEWS.far, 2304, 1152);
  assert.equal(a.sx, 2304 * 0.75); // 90 E
  assert.equal(a.sw, 2304 / 4);
  assert.equal(b.sx, 0); // -180
  assert.equal(b.sw, 2304 / 4);
  assert.equal(a.dx, 0);
  assert.equal(b.dx, 0.5);
  assert.equal(a.dw + b.dw, 1);
  assert.equal(a.sh, (150 / 180) * 1152);
  const [n] = sourceRects(VIEWS.near, 2304, 1152);
  assert.deepEqual([n.sx, n.sw, n.dx, n.dw], [2304 / 4, 2304 / 2, 0, 1]);
});

test("the table rows are the design's, in order", () => {
  assert.deepEqual(COMPARE_ROWS.map(([, label]) => label), ["Highest the Sun gets", "Hours of full Sun", "Time with the Sun up", "Longest night", "Earth's height in the sky", "Time with Earth in view", "Time with DSN in view"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MESSAGES, checkInput, checkXY, nearestArea, parseNumber } from "../map-custom.js";
import { latLonToPolar, polarToLatLon } from "../maputil.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const custom = JSON.parse(readFileSync(`${data}custom/custom.json`, "utf8"));
const meta = JSON.parse(readFileSync(`${data}map.json`, "utf8"));
const geometry = { areas: custom.sites, tiles: meta.tiles };
const check = (lat, lon) => checkInput(lat, lon, geometry);

test("typed numbers: the minus sign and a decimal comma are read, anything else is not a number", () => {
  assert.equal(parseNumber("−89.46"), -89.46);
  assert.equal(parseNumber(" -89,46 "), -89.46);
  assert.equal(parseNumber("222.6"), 222.6);
  for (const bad of ["", "  ", "abc", "89.4x", "--1", "1e3", "NaN", null]) assert.ok(Number.isNaN(parseNumber(bad)), String(bad));
});

test("each case of the design gets its message", () => {
  assert.deepEqual([check("", "").message, check("", "").field], [MESSAGES.empty, null]);
  assert.deepEqual([check("-89.46", "").message, check("-89.46", "").field, check("-89.46", "").note], ["Enter both a latitude and a longitude.", "lon", "Required"]);
  assert.deepEqual([check("", "222.6").message, check("", "222.6").field, check("", "222.6").note], ["Enter both a latitude and a longitude.", "lat", "Required"]);
  assert.deepEqual([check("abc", "222.6").message, check("abc", "222.6").field], ["Latitude must be a number, for example −89.46.", "lat"]);
  assert.deepEqual([check("-89.46", "x").message, check("-89.46", "x").field], ["Longitude must be a number, for example 222.6.", "lon"]);
  assert.deepEqual([check("89.46", "222.6").message, check("89.46", "222.6").field], ["Use a negative latitude for the south pole, for example −89.46.", "lat"]);
  for (const lat of ["-70", "-95", "0"]) assert.equal(check(lat, "222.6").message, "LunaZen's site maps cover 84°S to 90°S. Pick a point inside a dashed box.", lat);
  for (const lon of ["-181", "361"]) assert.deepEqual([check("-89.46", lon).message, check("-89.46", lon).field], ["Longitude must be between 0 and 360 (or −180 to 180).", "lon"], lon);
});

test("each rejected field gets its short note", () => {
  assert.equal(check("abc", "1").note, "Not a number");
  assert.equal(check("-89.46", "x").note, "Not a number");
  assert.equal(check("89.46", "1").note, "Use a negative value");
  assert.equal(check("-70", "1").note, "Out of range");
  assert.equal(check("-89.46", "400").note, "Out of range");
});

test("a point inside a site's usable area is accepted at the engine's coordinates", () => {
  const v = check("-89.46", "222.6");
  assert.equal(v.ok, true);
  assert.equal(v.site.name, "Connecting ridge");
  assert.equal(v.readAs, "");
  assert.ok(Math.abs(v.lat + 89.46) < 1e-9 && Math.abs(v.lon - 222.6) < 1e-9);
});

test("a negative longitude is read as degrees east and says so", () => {
  const west = check("-89.46", "-137.4");
  assert.equal(west.ok, true);
  assert.equal(west.readAs, "(read as 222.6°E)");
  assert.ok(Math.abs(west.lon - 222.6) < 1e-9);
});

test("outside every box: the message and the nearest usable area with its distance", () => {
  const v = check("-89.9", "10");
  assert.equal(v.ok, false);
  assert.equal(v.message, MESSAGES.outside);
  assert.ok(v.nearest.site.name && /^\d+\.\d$/.test(v.nearest.km));
  const [x, y] = latLonToPolar(-89.9, 10);
  assert.equal(nearestArea(x, y, custom.sites).site.id, v.nearest.site.id);
  const placed = checkXY(v.nearest.x, v.nearest.y, geometry); // the "Nearest" link places a point inside that box
  assert.equal(placed.ok, true);
  assert.equal(placed.site.id, v.nearest.site.id);
});

test("inside a box but within its 2 km margin: how far to move inward", () => {
  const tile = meta.tiles[0];
  const area = custom.sites.find((s) => s.id === tile.id).interior;
  const x = tile.x0M + 1200, y = (area.yMinM + area.yMaxM) / 2; // 1.2 km from the box's edge: 0.8 km short of the usable area
  const v = checkXY(x, y, geometry);
  assert.equal(v.ok, false);
  assert.equal(v.message, `Too close to the edge of the ${tile.name} box: a point needs 2 km of map around it. Move it 0.8 km inward.`);
  const [lat, lon] = polarToLatLon(x, y);
  assert.equal(checkInput(String(lat), String(lon), geometry).message, v.message);
});

test("the usable area is the box less 2 km on every side", () => {
  for (const t of meta.tiles) {
    const i = custom.sites.find((s) => s.id === t.id).interior;
    assert.deepEqual([i.xMinM - t.x0M, t.x1M - i.xMaxM, i.yMinM - t.y0M, t.y1M - i.yMaxM], [2000, 2000, 2000, 2000], t.id);
  }
});

test("the accuracy note's figures are the exported ones", () => {
  assert.equal(custom.accuracy.spots, 67);
  assert.ok(custom.accuracy.darkMedianH <= 1); // "within an hour"
});

// The DSN line-of-sight option ("any part of Earth" by default, or "the station itself"): addresses, pins, the stored Windows
// grid, and the tasks. The point test itself is tested against Python in engine/test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ephemeris, SiteCatalog, parseUtc } from "../../engine/index.js";
import { carryHash, dsnRuleOf, dsnSuffix, normalizeDstation, parseState, serializeState } from "../format.js";
import { feasible } from "../../engine/index.js";
import { pinId, pinSentence, pinsFromValue, pinsToValue, _resetForTests } from "../pins.js";
import { runTask } from "../tasks.js";
import { WINDOW_RULE, isDefaultRule } from "../windows-data.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = {
  ephemeris: new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin")),
  catalog: new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin")),
};
ctx.ephemeris.setRotation(JSON.parse(readFileSync(data + "ephemeris_rotation.json", "utf8")), buffer("ephemeris_rotation.bin"));

test("the option is 0 (any part of Earth) or 1 (the station itself); anything else is the default", () => {
  assert.equal(normalizeDstation(1), 1);
  assert.equal(normalizeDstation("1"), 1);
  for (const bad of [undefined, null, "", 2, -1, "x", NaN]) assert.equal(normalizeDstation(bad), 0);
  assert.equal(dsnRuleOf(1), "station");
  assert.equal(dsnRuleOf(0), undefined);
  assert.equal(dsnSuffix(1), " (station itself)");
  assert.equal(dsnSuffix(0), "");
});

test("the address carries the option to the lander pages and the Explorer, and leaves the default out", () => {
  const where = { spot: "Site01-1", mast: 2, start: "2027-03-15", mission: 14, rule: "viper", dark: 50, link: 50, within: 100, dbelow: 0, dstation: 1 };
  for (const page of ["planner.html", "windows.html", "rank.html", "explorer.html"]) assert.match(carryHash(page, where), /dstation=1/, page);
  assert.doesNotMatch(carryHash("sidebyside.html", where), /dstation/);
  assert.doesNotMatch(carryHash("planner.html", { ...where, dstation: 0 }), /dstation/);
  assert.doesNotMatch(serializeState({ spot: "A", dstation: 0 }), /dstation/);
  assert.equal(parseState("#dstation=1", { dstation: 0 }).dstation, 1);
});

test("pins keep the option, and a pin from before it existed tests any part of Earth", () => {
  _resetForTests();
  const base = { spot: "Site01-1", landing: "2027-04-07T06", mast: 2, mission: 14, rule: "viper", dark: 50, link: 50, goal: "earliest", start: "2027-03-15", days: 61, kind: "robust", within: 100, dbelow: 0, dstation: 0 };
  assert.equal(pinsToValue([base]).split(",").length, 12); // the address of a default pin is unchanged
  const [strict] = pinsFromValue(pinsToValue([{ ...base, dstation: 1 }]));
  assert.equal(strict.dstation, 1);
  assert.equal(strict.dbelow, 0);
  assert.equal(pinsFromValue(pinsToValue([{ ...base, dstation: 1, dbelow: 10 }]))[0].dbelow, 10);
  assert.equal(pinId(base), "Site01-1|2027-04-07T06|2|14|viper|50|50|100");
  assert.notEqual(pinId({ ...base, dstation: 1 }), pinId(base));
  assert.match(pinSentence({ ...base, dstation: 1 }, 50), /min DSN ≥ 50% \(station itself\)/);
  assert.doesNotMatch(pinSentence(base, 50), /station itself/);
});

test("the stored Windows grid is for any part of Earth only", () => {
  assert.equal(isDefaultRule({ ...WINDOW_RULE, dstation: 0 }), true);
  assert.equal(isDefaultRule({ ...WINDOW_RULE, dstation: 1 }), false);
});

test("a landings task with the station rule never finds more working landings than the default (Site01-1, 15 Mar to 14 May 2027)", () => {
  const et0 = parseUtc("2027-03-15T00:00:00");
  const task = { kind: "landings", spot: "Site01-1", mast: 2, point: 0, et0, et1: et0 + 75 * 86400, missionS: 14 * 86400, stride: 24 };
  const disk = runTask(ctx, task);
  const station = runTask(ctx, { ...task, dsnRule: "station" });
  assert.equal(station.length, disk.length);
  station.forEach((r, i) => assert.ok(r.linkFraction <= disk[i].linkFraction + 1e-12 && r.longestDarkHours === disk[i].longestDarkHours));
  const working = (rows) => rows.filter((r) => feasible(r, 0.5, 50)).length;
  assert.equal(working(disk), 45); // 18.4% of 245 landing times, the guide's 18%
  assert.equal(working(station), 40); // 16.3%
});

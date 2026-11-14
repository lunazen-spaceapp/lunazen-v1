import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REACH, REACHES, normalizeReach, ringCount, testText, tokenText, workText, worksText } from "../reach.js";
import { carryHash, parseState } from "../format.js";
import { isDefaultRule } from "../windows-data.js";

test("a miss distance tests the first points of the stored ring: none, six at 50 m, twelve to 100 m", () => {
  assert.deepEqual(REACHES.map((r) => [r.m, r.ring]), [[0, 0], [50, 6], [100, 12]]);
  assert.equal(ringCount(0), 0);
  assert.equal(ringCount(50), 6);
  assert.equal(ringCount(100), 12);
});

test("anything else is the default, 100 m, so old links and pins keep their meaning", () => {
  for (const v of [undefined, NaN, 75, "100", null]) assert.equal(normalizeReach(v), DEFAULT_REACH);
  assert.equal(normalizeReach(0), 0);
  assert.equal(ringCount(undefined), 12);
});

test("the words follow the distance", () => {
  assert.equal(worksText(100), "valid within 100 m dispersion");
  assert.equal(worksText(50), "valid within 50 m dispersion");
  assert.equal(worksText(0), "valid at the target spot");
  assert.equal(workText(50), "valid within 50 m dispersion");
  assert.equal(tokenText(0), "at the target spot");
  assert.equal(tokenText(100), "within 100 m");
  assert.equal(testText(50), "the spot and its 6 dispersion points");
  assert.equal(testText(0), "the spot itself");
});

test("the distance travels in the address and a missing one is 100 m", () => {
  const defaults = { spot: "A", within: 100 };
  assert.equal(parseState("#spot=B&within=50", defaults).within, 50);
  assert.equal(parseState("#spot=B", defaults).within, 100);
  assert.match(carryHash("planner.html", { spot: "A", mast: 2, start: "2027-03-15", mission: 14, rule: "viper", dark: 50, link: 50, within: 50 }), /within=50/);
  assert.doesNotMatch(carryHash("explorer.html", { spot: "A", mast: 2, start: "2027-03-15", mission: 14, rule: "viper", dark: 50, link: 50, within: 50 }), /within/);
  assert.doesNotMatch(carryHash("planner.html", { spot: "A", mast: 2, start: "2027-03-15", mission: 14, rule: "viper", dark: 50, link: 50 }), /within/);
});

test("the stored Windows grid is for 100 m only", () => {
  const rule = { missionDays: 14, maxDarkHours: 50, minLink: 0.5, mastM: 2, strideHours: 6 };
  assert.equal(isDefaultRule(rule), true);
  assert.equal(isDefaultRule({ ...rule, within: 100 }), true);
  assert.equal(isDefaultRule({ ...rule, within: 50 }), false);
  assert.equal(isDefaultRule({ ...rule, within: 0 }), false);
});

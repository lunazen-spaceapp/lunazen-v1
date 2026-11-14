// The darkness threshold ("count as dark when less than ... of the Sun is visible"): addresses, pins, the stored Windows grid,
// the wording, and the Planner's mission facts. The engines are tested against Python in engine/test and rank.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { DARK_BELOW_OPTIONS, carryHash, darkBelowSuffix, normalizeDarkBelow, parseState, serializeState } from "../format.js";
import { missionFacts } from "../events.js";
import { explorerStory } from "../story.js";
import { addPin, loadPins, pinId, pinSentence, pinsFromValue, pinsToValue, _resetForTests } from "../pins.js";
import { WINDOW_RULE, isDefaultRule } from "../windows-data.js";
import { isDark } from "../../engine/index.js";

test("the threshold is any part of the Sun, 10% or 50%; anything else is the default", () => {
  assert.deepEqual(DARK_BELOW_OPTIONS, [0, 10, 50]);
  assert.equal(normalizeDarkBelow(10), 10);
  assert.equal(normalizeDarkBelow("50"), 50);
  for (const bad of [undefined, null, "", 25, -1, "x", NaN]) assert.equal(normalizeDarkBelow(bad), 0);
});

test("a sample is dark when no part of the Sun is up, or when less than the share is visible", () => {
  assert.equal(isDark(0, 0), true);
  assert.equal(isDark(0.01, 0), false);
  assert.equal(isDark(0.05, 0.1), true);
  assert.equal(isDark(0.1, 0.1), false);
  assert.equal(isDark(0.49, 0.5), true);
  assert.equal(isDark(0.5, 0.5), false);
});

test("the address carries a threshold to the lander pages and the Explorer, and leaves the default out", () => {
  const where = { spot: "Site01-1", mast: 2, start: "2027-03-15", mission: 14, rule: "viper", dark: 50, link: 50, within: 100, dbelow: 10 };
  for (const page of ["planner.html", "windows.html", "rank.html", "explorer.html"]) assert.match(carryHash(page, where), /dbelow=10/, page);
  assert.doesNotMatch(carryHash("sidebyside.html", where), /dbelow/);
  for (const page of ["planner.html", "explorer.html"]) assert.doesNotMatch(carryHash(page, { ...where, dbelow: 0 }), /dbelow/, page);
  assert.doesNotMatch(serializeState({ spot: "A", dbelow: 0 }), /dbelow/);
  assert.equal(serializeState({ spot: "A", dbelow: 50 }), "#spot=A&dbelow=50");
  assert.equal(parseState("#dbelow=50", { dbelow: 0 }).dbelow, 50);
});

test("pins keep the threshold, and a pin from before it existed reads as any part of the Sun", () => {
  _resetForTests();
  const base = { spot: "Site01-1", landing: "2027-04-07T06", mast: 2, mission: 14, rule: "viper", dark: 50, link: 50, goal: "earliest", start: "2027-03-15", days: 61, kind: "robust", within: 100 };
  const [old] = pinsFromValue(pinsToValue([base]));
  assert.equal(old.dbelow, 0);
  assert.equal(pinsToValue([base]).split(",").length, 12); // the address of a default pin is unchanged
  const [strict] = pinsFromValue(pinsToValue([{ ...base, dbelow: 10 }]));
  assert.equal(strict.dbelow, 10);
  assert.notEqual(pinId({ ...base, dbelow: 10 }), pinId(base));
  assert.equal(pinId(base), "Site01-1|2027-04-07T06|2|14|viper|50|50|100"); // as before the threshold existed
  assert.match(pinSentence({ ...base, dbelow: 10 }, 50), /max night 50 h \(dark below 10% of the Sun\)/);
  assert.doesNotMatch(pinSentence(base, 50), /dark below/);
});

test("the stored Windows grid is for any part of the Sun only", () => {
  assert.equal(isDefaultRule({ ...WINDOW_RULE }), true);
  assert.equal(isDefaultRule({ ...WINDOW_RULE, dbelow: 0 }), true);
  assert.equal(isDefaultRule({ ...WINDOW_RULE, dbelow: 10 }), false);
});

test("the wording names the threshold beside a longest night, and says nothing at the default", () => {
  assert.equal(darkBelowSuffix(0), "");
  assert.equal(darkBelowSuffix(10), " (dark below 10% of the Sun)");
  const metrics = { sunlitFraction: 0.9, earthFraction: 0.5, longestDarkHours: 142, longestDsnLinkGapHours: 0 };
  const presets = [{ hours: 5, phrase: "5 h (Blue Ghost 1)" }, { hours: 50, phrase: "the 50 h limit" }];
  assert.match(explorerStory({ metrics, presets, dbelow: 10 })[1].replace(/\u00a0/g, " "), /^Longest night 5 d 22 h \(dark below 10% of the Sun\): more than the 50 h limit$/);
  assert.doesNotMatch(explorerStory({ metrics, presets })[1], /dark below/);
});

test("the Planner's longest night follows the threshold and nothing else changes", () => {
  // Sun fraction per 15-minute sample: dark, a thin sliver, dark, then 60% up.
  const sunFraction = [0, 0, 0.05, 0.05, 0, 0, 0.6, 0.6];
  const link = Array(8).fill(1);
  const facts = (below) => missionFacts({ sunFraction, earthFraction: Array(8).fill(1), sunElevation: Array(8).fill(1) }, link, 900, below);
  assert.equal(facts(0).longestNightH, 0.5); // the sliver splits the night: two samples, then two
  assert.equal(facts(0.1).longestNightH, 1.5); // below 10% the sliver counts as dark: six samples
  assert.equal(facts(0.5).longestNightH, 1.5);
  assert.equal(facts(0.1).sunShare, facts(0).sunShare);
});

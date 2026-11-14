import test from "node:test";
import assert from "node:assert/strict";
import { bodyCard, clearanceNotes, dsnTag, figureGroups, momentHeading, periodTitle, shortDate, shortDateTime } from "../explorer-model.js";

test("dates in the design's short form", () => {
  assert.equal(shortDate("2027-03-09 06:15"), "9 Mar");
  assert.equal(shortDateTime("2027-03-01 00:00"), "1 Mar 00:00");
  assert.equal(momentHeading("2027-03-01 06:15"), "1 Mar 2027, 06:15 UTC");
});

test("the period title names the first and last day", () => {
  assert.equal(periodTitle("2027-03-01", "2027-03-30", "Site01-1"), "1–30 March 2027 at Site01-1");
  assert.equal(periodTitle("2027-02-20", "2027-03-21", "My point 1"), "20 February–21 March 2027 at My point 1");
  assert.equal(periodTitle("2026-12-20", "2027-01-18", "DM2-4"), "20 December 2026–18 January 2027 at DM2-4");
});

test("the cards say what the Sun and Earth are doing and how far they clear the skyline", () => {
  assert.deepEqual(bodyCard("The Sun", { fraction: 1, elevation: -0.17, margin: 0.28 }, { up: true, hours: 36.25 }),
    { status: "The Sun · fully visible", up: true, next: "sets in 36 h 15 min", clearance: "0.28° above the skyline · −0.17° from level" });
  assert.deepEqual(bodyCard("Earth", { fraction: 0, elevation: -6.47, margin: -5.5 }, { up: false, hours: 90 }),
    { status: "Earth · hidden by the terrain", up: false, next: "rises in 3 d 18 h", clearance: "5.50° below the skyline · −6.47° from level" });
  assert.equal(bodyCard("The Sun", { fraction: 0.4, elevation: 0, margin: 0 }, { up: true, hours: null }).status, "The Sun · partly visible");
  assert.equal(bodyCard("The Sun", { fraction: 1, elevation: 1, margin: 1 }, { up: true, hours: null }).next, "stays up for 30 days or more");
  assert.equal(bodyCard("Earth", { fraction: 0, elevation: -1, margin: -1 }, { up: false, hours: null }).next, "stays hidden for 30 days or more");
  assert.equal(dsnTag(true), "DSN station in view");
  assert.equal(dsnTag(false), "No DSN station in view");
});

const pct = (v) => `${Math.round(v * 100)}%`;
const degText = (v) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}°`;

test("the figure groups carry the three groups and their lines", () => {
  const groups = figureGroups({
    summary: { sunlitFraction: 0.82, energyWhPerW: 535.6, longestDarkHours: 61, earthFraction: 0.51, dsnLinkFraction: 0.5, longestDsnLinkGapHours: 258 },
    highest: -0.1, capture: { upright: 0.9997, flat: 0.0001 }, stats: { sunlitSamples: 10, maxSun: 2.33, maxSunEt: "x" }, limitH: 50, pct, degText, shortDay: () => "9 Mar",
  });
  assert.deepEqual(groups.map((g) => g.title), ["Sunlight and power", "Darkness", "Contact with Earth"]);
  const f = Object.fromEntries(groups.flatMap((g) => g.figures).map((x) => [x.key, x]));
  assert.deepEqual([f.sun.value, f.sun.line], ["82%", "of the period, any part of the disk"]);
  assert.deepEqual([f.clearance.value, f.clearance.line], ["2.33°", "above the skyline (9 Mar) · −0.1° from level"]);
  assert.deepEqual([f.array.value, f.array.line], ["99.9%", "of the light it could catch · flat panel almost none"]);
  assert.deepEqual([f.energy.value, f.energy.line], ["536 h", "of full Sun (Wh per W of panel)"]);
  assert.deepEqual([f.night.value, f.night.line], ["2 d 13 h", "above a 50 h darkness limit (VIPER's design figure)"]);
  assert.deepEqual([f.earth.value, f.dsn.value, f.gap.value, f.gap.line], ["51%", "50%", "10 d 18 h", "without a DSN station in view"]);
  assert.equal(figureGroups({ summary: { sunlitFraction: 1, energyWhPerW: 1, longestDarkHours: 10, earthFraction: 1, dsnLinkFraction: 1, longestDsnLinkGapHours: 0 }, highest: 1, capture: null, stats: { sunlitSamples: 0, maxSun: -1 }, limitH: 50, pct, degText, shortDay: () => "" })[1].figures[0].line, "within a 50 h darkness limit (VIPER's design figure)");
  assert.equal(groups[1].figures[0].label, "Longest night");
  assert.equal(figureGroups({ summary: { sunlitFraction: 1, energyWhPerW: 1, longestDarkHours: 10, earthFraction: 1, dsnLinkFraction: 1, longestDsnLinkGapHours: 0 }, highest: 1, capture: null, stats: { sunlitSamples: 0, maxSun: -1 }, limitH: 50, darkSuffix: " (dark below 10% of the Sun)", dsnSuffix: " (station itself)", pct, degText, shortDay: () => "" }).flatMap((g) => g.figures).filter((x) => /\(/.test(x.label)).length, 2);
});

test("the clearance notes", () => {
  const stats = { sunlitSamples: 100, maxSun: 2.33, maxSunEt: "x", nearShare: 0.22 };
  const rows = [{ error: 0.1, sunlit: 0.8, darkHours: 67 }, { error: 0.25, sunlit: 0.76, darkHours: 76 }];
  assert.deepEqual(clearanceNotes(stats, rows, pct, () => "9 Mar"), [
    "The Sun clears the skyline by at most 2.33° (9 Mar); 22% of the sunlit time is within 0.25° of it.",
    "If the skyline were 0.1° higher: Sun up 80%, longest night 2 d 19 h. If 0.25° higher: Sun up 76%, longest night 3 d 4 h.",
  ]);
  assert.match(clearanceNotes({ sunlitSamples: 0, maxSun: -0.4 }, [], pct, () => "")[0], /never above the skyline.*0\.40° below/);
});

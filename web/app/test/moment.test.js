import { test } from "node:test";
import assert from "node:assert/strict";

import { countdown, litGradient, momentSentence, nextChange, nextEventText } from "../moment.js";

test("nextChange finds the next and previous sample where any flag differs", () => {
  const sun = [1, 1, 0, 0, 1, 1];
  const earth = [0, 0, 0, 1, 1, 1];
  assert.equal(nextChange([sun, earth], 0, 1), 2); // sunset
  assert.equal(nextChange([sun, earth], 2, 1), 3); // Earth rises
  assert.equal(nextChange([sun, earth], 5, -1), 3); // back to the last change: Earth-rise is at 3, sun at 4
  assert.equal(nextChange([sun, earth], 5, 1), null); // nothing after the end
  assert.equal(nextChange([[1, 1, 1]], 0, 1), null); // constant
});

test("litGradient has one stop per run, covering 0% to 100%", () => {
  const g = litGradient([1, 1, 0, 0, 1], "L", "D");
  assert.equal(g, "linear-gradient(to right, L 0.00% 50.00%, D 50.00% 100.00%, L 100.00% 100.00%)");
  assert.equal(litGradient([1], "L", "D"), "D");
});

test("momentSentence reads the three states in order", () => {
  assert.equal(momentSentence({ sunFraction: 0.5, earthFraction: 1, link: true }), "The Sun is up (50% of its disk above the terrain). Earth is in view, and a DSN station can reach it.");
  assert.equal(momentSentence({ sunFraction: 0, earthFraction: 0, link: false }), "The Sun is below the terrain. Earth is hidden by the terrain.");
  assert.match(momentSentence({ sunFraction: 1, earthFraction: 0.2, link: false }), /but no DSN station/);
});

import { compass, describeBody } from "../moment.js";

test("compass names the 16 points and wraps", () => {
  assert.deepEqual([0, 90, 143, 180, 270, 359.9, -10, 725].map(compass), ["N", "E", "SE", "S", "W", "N", "N", "N"]);
});

test("describeBody reads azimuth, elevation, the spot's verdict and the skyline", () => {
  assert.deepEqual(describeBody("Earth", { azimuth: 142.99, elevation: -1.89, fraction: 0.0007, terrain: -0.93 }), {
    title: "Earth",
    lines: ["azimuth 143.0\u00b0 (SE), elevation \u22121.89\u00b0", "<1% visible from the spot", "skyline there \u22120.93\u00b0"],
  });
  assert.equal(describeBody("Sun", { azimuth: 359.97, elevation: 0.7, fraction: 1 }).lines.join("|"), "azimuth 0.0\u00b0 (N), elevation 0.70\u00b0|fully visible from the spot");
  assert.equal(describeBody("Sun", { azimuth: 10, elevation: -3, fraction: 0, terrain: 1 }).lines[1], "hidden from the spot");
  assert.equal(describeBody("Earth", { azimuth: 90, elevation: 5, fraction: 0.42 }).lines[1], "42% visible from the spot");
});

test("countdown shows minutes, hours and minutes, or days and hours", () => {
  assert.equal(countdown(0.25), "15 min");
  assert.equal(countdown(3.75), "3 h 45 min");
  assert.equal(countdown(6), "6 h");
  assert.equal(countdown(53), "2 d 5 h");
});

test("next-event text says set or rise, and handles no change", () => {
  assert.equal(nextEventText("Sun", { up: true, hours: 3.75 }).short, "sets in 3 h 45 min");
  assert.equal(nextEventText("Earth", { up: false, hours: 2 }).long, "Earth rises above the terrain in 2 h");
  assert.equal(nextEventText("Sun", { up: true, hours: null }).long, "The Sun stays up for at least 30 d");
});

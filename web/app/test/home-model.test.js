import test from "node:test";
import assert from "node:assert/strict";
import { dotFilled, pillText, visibility, whenText, windowLabel } from "../home-model.js";

test("a body is up, partly visible or behind the terrain", () => {
  assert.deepEqual(visibility(1), { state: "up", percent: 100 });
  assert.deepEqual(visibility(0.4), { state: "part", percent: 40 });
  assert.deepEqual(visibility(0), { state: "behind", percent: 0 });
  assert.equal(visibility(0.004).percent, 1);   // a sliver is never shown as 0%
  assert.equal(visibility(0.994).percent, 99);  // and almost the whole disk is never shown as 100%
});

test("the pills say what the design says", () => {
  assert.equal(pillText("Sun", 1), "Sun · up");
  assert.equal(pillText("Sun", 0.4), "Sun · 40% visible");
  assert.equal(pillText("Sun", 0), "Sun · behind the terrain");
  assert.equal(pillText("Earth", 1), "Earth · in view");
  assert.equal(pillText("Earth", 0.27), "Earth · 27% visible");
  assert.equal(pillText("Earth", 0), "Earth · behind the terrain");
});

test("the dot is filled while any of the body shows, a ring when none does", () => {
  assert.equal(dotFilled(1), true);
  assert.equal(dotFilled(0.2), true);
  assert.equal(dotFilled(0), false);
});

test("the time reads day, date and UTC time to the minute", () => {
  const ms = Date.UTC(2027, 2, 19, 8, 47, 20);
  assert.equal(whenText(18 * 86400 + 8 * 3600, ms, 30), "Day 19 of 30 · 19 Mar 2027 08:47 UTC");
  assert.equal(whenText(40 * 86400, Date.UTC(2027, 2, 30, 23, 59), 30), "Day 30 of 30 · 30 Mar 2027 23:59 UTC"); // never beyond the last day
});

test("the window is named from its start and length", () => {
  assert.equal(windowLabel(Date.UTC(2027, 2, 1), 30), "1–30 March 2027");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_PINS, _resetForTests, addPin, isPinned, loadPins, pinId, pinSentence, pinsFromValue, pinsToCsv, pinsToIcs, pinsToValue, removePin } from "../pins.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const P = (spot = "Site01-1", landing = "2027-04-07T06") => ({ spot, landing, mast: 2, mission: 14, rule: "viper", dark: 50, link: 50, goal: "earliest", start: "2027-03-15", days: 61, kind: "robust", dbelow: 0, dstation: 0, within: 100 });

test("pins are added, never twice, up to four, and removed", () => {
  _resetForTests();
  const s = memory();
  assert.equal(addPin(P(), s).ok, true);
  assert.equal(addPin(P(), s).reason, "duplicate");
  for (const d of ["07", "08", "09"]) assert.equal(addPin(P("Site01-1", `2027-04-${d}T12`), s).ok, d !== "09" || true);
  assert.equal(loadPins(s).length, MAX_PINS);
  assert.equal(addPin(P("DM2-4"), s).reason, "full");
  assert.equal(addPin({ spot: "x", landing: "bad" }, s).reason, "invalid");
  removePin(pinId(P()), s);
  assert.equal(loadPins(s).length, MAX_PINS - 1);
  assert.equal(isPinned(P("Site01-1", "2027-04-07T12"), s), true);
});

test("a corrupt store starts empty and a closed store keeps the list for the page", () => {
  _resetForTests();
  const bad = { getItem: () => "{not json", setItem: () => {} };
  assert.deepEqual(loadPins(bad), []);
  _resetForTests();
  const closed = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  addPin(P(), closed);
  assert.equal(loadPins(closed).length, 1);
});

test("the link value round-trips every field", () => {
  const list = [P(), { ...P("DM2-4", "2027-05-01T18"), mast: 5, rule: "custom", dark: 72, kind: "spot" }];
  assert.deepEqual(pinsFromValue(pinsToValue(list)), list);
  assert.deepEqual(pinsFromValue(""), []);
  assert.deepEqual(pinsFromValue("Site01-1,not-a-time"), []);
});

test("the question is written out in full for the record", () => {
  assert.equal(pinSentence(P(), 50), "Identify earliest valid window at Site01-1 from 15 Mar 2027 to 14 May 2027 for a 14 d mission – max night 50 h, min DSN ≥ 50%, mast 2 m, 100 m dispersion radius.");
});

test("the exports carry each pin's question and the data version", () => {
  const e = [{ pin: P(), name: "Site01-1", landing: "2027-04-07T06", kind: "robust", limitH: 50, longestNightH: 36.4, dsnShare: 0.99, neighbours: "12 of 12", holds: true, shiftDays: 0 }];
  const csv = pinsToCsv(e).split("\n");
  assert.match(csv[0], /^pin,spot,landing_utc,/);
  assert.match(csv[1], /^1,Site01-1,2027-04-07 06:00,2,14,50,50,valid within 100 m dispersion,36\.4,99\.0,12 of 12,yes,0,"Identify earliest valid window at Site01-1/);
  assert.match(csv[1], /DE440/);
  const ics = pinsToIcs(e, Date.parse("2026-11-05T00:00:00Z"));
  assert.match(ics, /DTSTART:20270407T060000Z\r\nDTEND:20270421T060000Z/);
  assert.match(ics, /SUMMARY:Site01-1 landing \(valid within 100 m dispersion\)/);
  assert.match(ics, /DESCRIPTION:Identify earliest valid window at Site01-1/);
});

test("the pinned question reads as a sentence for every answer", () => {
  const say = (goal) => pinSentence({ ...P(), goal }, 50).split(" from ")[0];
  assert.equal(say("earliest"), "Identify earliest valid window at Site01-1");
  assert.equal(say("margin"), "Identify shortest-night window at Site01-1");
  assert.equal(say("longest"), "Identify widest valid window at Site01-1");
  assert.equal(say("all"), "Identify every valid window at Site01-1");
});

test("a pin keeps how far the lander may miss, and a link or pin from before that is 100 m", () => {
  const list = [{ ...P(), within: 50 }];
  assert.equal(pinsFromValue(pinsToValue(list))[0].within, 50);
  assert.match(pinSentence({ ...P(), within: 50 }, 50), /mast 2 m, 50 m dispersion radius\./);
  assert.match(pinSentence({ ...P(), within: 0 }, 50), /mast 2 m, target spot only\./);
  const old = "Site01-1,2027-04-07T06,2,14,viper,50,50,earliest,2027-03-15,61,robust"; // eleven fields, as before the choice existed
  assert.equal(pinsFromValue(old)[0].within, 100);
  assert.notEqual(pinId({ ...P(), within: 50 }), pinId(P()));
});

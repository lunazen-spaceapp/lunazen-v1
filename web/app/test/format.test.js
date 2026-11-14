import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUtc } from "../../engine/index.js";
import { artemisLabel, clampDate, clearanceText, degText, signedDeg, flatText, pctText, formatDuration, formatUtc, panoramaRange, carryHash, mapHash, parseState, serializeState, windowsToCsv, windowsToIcs } from "../format.js";

const et = (iso) => parseUtc(iso);

test("UTC formatting and durations", () => {
  assert.equal(formatUtc(et("2027-03-05T01:00:00")), "2027-03-05 01:00");
  assert.equal(formatUtc(et("2027-03-05T01:00:07"), { seconds: true }), "2027-03-05 01:00:07");
  assert.equal(formatDuration(5.4), "5 h");
  assert.equal(formatDuration(365), "15 d 5 h");
});

const rows = [
  { body: "Earth", startEt: et("2027-03-05T01:00:00"), endEt: et("2027-03-20T06:00:00") },
  { body: "Sun", startEt: et("2027-03-01T00:00:00"), endEt: et("2027-03-01T10:00:00") },
];

test("CSV export", () => {
  const lines = windowsToCsv(rows, "Site01-1").trim().split("\n");
  assert.equal(lines[0], "site,body,start_utc,end_utc,duration_h");
  assert.equal(lines[1], "Site01-1,Earth,2027-03-05 01:00,2027-03-20 06:00,365.0");
  assert.equal(lines.length, 3);
});

test("ICS export is a valid calendar with UTC times", () => {
  const ics = windowsToIcs(rows, "Site01-1", et("2026-10-02T00:00:00"));
  const lines = ics.trim().split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-1), "END:VCALENDAR");
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 2);
  assert.equal(lines.filter((l) => l === "END:VEVENT").length, 2);
  assert.ok(lines.includes("DTSTART:20270305T010000Z") && lines.includes("DTEND:20270320T060000Z"));
  const uids = lines.filter((l) => l.startsWith("UID:"));
  assert.equal(new Set(uids).size, uids.length);
});

test("URL state round-trips and ignores unknown keys", () => {
  const defaults = { spot: "Site01-1", mast: 2, start: "2027-01-01", days: 30, t: 0 };
  const state = { spot: "Site23-2", mast: 10, start: "2027-05-01", days: 14, t: 37 };
  assert.deepEqual(parseState(serializeState(state), defaults), state);
  assert.deepEqual(parseState("#bogus=1&mast=5", defaults), { ...defaults, mast: 5 });
});

test("a malformed number in the URL keeps the default", () => {
  const defaults = { spot: "Site01-1", mast: 2, days: 30 };
  assert.deepEqual(parseState("#mast=abc&days=", defaults), defaults);
});

test("carryHash names the spot key the target page reads", () => {
  const where = { spot: "Site01-1", mast: 2, start: "2027-01-01" };
  assert.equal(carryHash("explorer.html", where), "#spot=Site01-1&mast=2&start=2027-01-01");
  assert.equal(carryHash("sidebyside.html", where), "#sites=Site01-1&mast=2&start=2027-01-01");
});

test("carryHash gives the lander settings only to the pages that have them, under each page's own keys", () => {
  const where = { spot: "Site01-1", mast: 5, start: "2027-03-15", mission: 7, rule: "bg1", dark: 5, link: 40 };
  assert.equal(carryHash("planner.html", where), "#spot=Site01-1&mast=5&start=2027-03-15&mission=7&rule=bg1&dark=5&link=40");
  assert.equal(carryHash("windows.html", where), "#spot=Site01-1&mast=5&date=2027-03-15&mission=7&rule=bg1&dark=5&link=40");
  assert.equal(carryHash("rank.html", where), "#mast=5&start=2027-03-15&days=7&rule=bg1&dark=5&link=40");
  assert.equal(carryHash("explorer.html", where), "#spot=Site01-1&mast=5&start=2027-03-15");
  assert.equal(carryHash("sidebyside.html", where), "#sites=Site01-1&mast=5&start=2027-03-15");
  assert.equal(carryHash("rank.html", { mast: 2, start: "2027-03-15" }), "#mast=2&start=2027-03-15");
});

test("panorama range covers every value with a margin and a minimum span", () => {
  const [lo, hi] = panoramaRange([[-3.1, 7.9], [-2, 2], [-7.5, 6.2]]);
  assert.ok(lo <= -8.5 && hi >= 8.9);
  const [a, b] = panoramaRange([[0.1, 0.2]]);
  assert.ok(b - a >= 8);
});

test("dates are clamped to the ephemeris coverage", () => {
  assert.equal(clampDate("2050-01-01", "2024-01-02", "2043-12-01"), "2043-12-01");
  assert.equal(clampDate("2027-05-01", "2024-01-02", "2043-12-01"), "2027-05-01");
  assert.equal(clampDate("nonsense", "2024-01-02", "2043-12-01"), "2024-01-02");
});

test("artemisLabel names each region with the NASA lists it appears in", () => {
  const regions = [{ name: "Connecting Ridge", lists: ["2022"] }, { name: "de Gerlache Rim 2", lists: ["2022", "2024"] }];
  assert.equal(artemisLabel([], regions), "");
  assert.equal(artemisLabel([{ name: "Connecting Ridge", central: true }], regions), "Connecting Ridge (2022 list)");
  assert.equal(artemisLabel([{ name: "Connecting Ridge", central: true }, { name: "de Gerlache Rim 2", central: false }], regions),
    "Connecting Ridge (2022 list); de Gerlache Rim 2 (2022 and 2024 lists; outer part of NASA's data area)");
});

test("the Map's 3D link opens the Explorer on the same spot in the 3D view", () => {
  const defaults = { spot: "Site01-1", mast: 2, start: "2027-01-01", days: 30, t: 0, view: "panorama" };
  const state = parseState("#spot=Site23-2&mast=2&start=2027-01-01&days=30&t=0&view=3d", defaults);
  assert.equal(state.spot, "Site23-2");
  assert.equal(state.view, "3d");
});

test("mapHash opens a spot, a polar landing or a custom point on the Map, and nothing for sites off the polar picture", () => {
  assert.equal(mapHash({ id: "Site20-3", kind: "spot", latitudeDeg: -89.2, longitudeDeg: 10 }), "#spot=Site20-3");
  assert.equal(mapHash({ id: "im1", kind: "mission", latitudeDeg: -80.13, longitudeDeg: 1.44 }), "#landing=im1");
  assert.equal(mapHash({ id: "bg1", kind: "mission", latitudeDeg: 18.562, longitudeDeg: 61.81 }), null);
  assert.equal(mapHash({ id: "pt_-89.4749_222.5569", kind: "custom", latitudeDeg: -89.4749, longitudeDeg: 222.5569 }), "#lat=-89.4749&lon=222.5569");
  assert.equal(mapHash({ id: "a11", kind: "beyond", latitudeDeg: 0.67, longitudeDeg: 23.47 }), null);
});

test("clearance above or below the skyline", () => {
  assert.equal(clearanceText(0.283), "0.28° above the skyline");
  assert.equal(clearanceText(-0.171), "0.17° below the skyline");
  assert.equal(clearanceText(0.001), "level with the skyline");
});

test("pctText keeps a small loss visible and never rounds a part up to a whole", () => {
  assert.equal(pctText(1), "100%");
  assert.equal(pctText(0.99974), "99.9%");
  assert.equal(pctText(0.9955), "99.5%");
  assert.equal(pctText(0.64), "64%");
  assert.equal(pctText(0.0113), "1.1%");
  assert.equal(pctText(0), "0.0%");
});

test("degText signs a negative angle, leaves a zero unsigned and shows a dash when there is none", () => {
  assert.equal(degText(2.04), "2.0°");
  assert.equal(degText(-1.25), "−1.3°");
  assert.equal(degText(-0.01), "0.0°");
  assert.equal(degText(null), "—");
});

test("flatText says almost none for a share under a twentieth of a percent", () => {
  assert.equal(flatText(0.0001), "almost none");
  assert.equal(flatText(0.011), "1.1%");
});

test("signedDeg uses a minus sign for a negative angle, leaves a zero unsigned and keeps the digits asked for", () => {
  assert.equal(signedDeg(4.52), "4.52°");
  assert.equal(signedDeg(-1.28), "−1.28°");
  assert.equal(signedDeg(-0.001), "0.00°");
  assert.equal(signedDeg(-37.2, 0), "−37°");
});

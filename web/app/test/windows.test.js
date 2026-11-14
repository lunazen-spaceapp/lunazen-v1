import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ephemeris, SiteCatalog, feasible, parseUtc } from "../../engine/index.js";
import { WINDOW_RULE, WINDOW_YEARS, dayCode, decodeDays, pointsWorking, works, yearView } from "../windows-data.js";
import { windowsForSpot } from "../windows-compute.js";
import { runTask } from "../tasks.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = {
  ephemeris: new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin")),
  catalog: new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin")),
};
const file = JSON.parse(readFileSync(data + "windows.json", "utf8"));

test("day codes: failing for the night, failing for the link, or working at n points", () => {
  assert.deepEqual([dayCode(0, false), dayCode(0, true), dayCode(1, true), dayCode(13, true)], [0, 1, 2, 14]);
  assert.deepEqual([0, 1, 2, 14].map(pointsWorking), [0, 0, 1, 13]);
  assert.deepEqual([0, 1, 2, 14].map(works), [false, false, true, true]);
  assert.deepEqual(decodeDays("01e2"), [0, 1, 14, 2]);
});

const small = {
  spots: [
    { id: "A-1", site: "A", siteName: "A", points: 13, x: 0, y: 0, sun: 0.9, days: { 2027: "0 1 2 e".split(" ").join("") + "1" } },
    { id: "B-1", site: "B", siteName: "B", points: 13, x: 1, y: 1, sun: 0.8, days: { 2027: "ee1 e0".split(" ").join("") } },
  ],
};

test("totals for a day across the spots", () => {
  const v = yearView(small, 2027);
  assert.equal(v.nDays, 5);
  assert.deepEqual(v.working, [1, 1, 1, 2, 0]); // A: 0 1 2 e 1 ; B: e e 1 e 0
  assert.deepEqual(v.robust, [1, 1, 0, 2, 0]);
  assert.equal(v.bestDay, 3);
});

test("the file covers the precomputed years for all 67 spots", () => {
  assert.deepEqual(file.years, WINDOW_YEARS);
  assert.deepEqual(file.rule, WINDOW_RULE);
  assert.equal(file.spots.length, 67);
  for (const s of file.spots) {
    assert.equal(s.days[2027].length, 365, s.id);
    assert.equal(s.days[2028].length, 366, s.id);
    assert.equal(s.days[2029].length, 365, s.id);
  }
});

test("the file is not stale: three spots, every year, recomputed with the engine", () => {
  for (const id of ["Site01-1", "DM2-4", "Site06-5"]) {
    const entry = file.spots.find((s) => s.id === id);
    for (const year of WINDOW_YEARS) assert.equal(windowsForSpot(ctx, id, year), entry.days[year], `${id} ${year}`);
  }
});

test("Rank agrees: every spot that works for the 15 March 2027 landing at 00:00 works that day in the file", () => {
  const et0 = parseUtc("2027-03-15T00:00:00");
  const v = yearView(file, 2027);
  const day = 73; // 15 March
  let rankWorking = 0;
  for (const s of v.spots) {
    const r = runTask(ctx, { kind: "rank", id: s.id, mast: WINDOW_RULE.mastM, et0, missionS: WINDOW_RULE.missionDays * 86400, minLink: WINDOW_RULE.minLink, maxDarkHours: WINDOW_RULE.maxDarkHours });
    if (feasible({ longestDarkHours: r.metrics.longestDarkHours, linkFraction: r.metrics.dsnLinkFraction }, WINDOW_RULE.minLink, WINDOW_RULE.maxDarkHours)) {
      rankWorking++;
      assert.ok(works(s.codes[day]), `${s.id} works at 00:00 but the file says it fails that day`);
    }
  }
  assert.equal(rankWorking, 1); // Site06-5, as in the Rank page
  assert.deepEqual(v.spots.filter((s) => works(s.codes[day])).map((s) => s.id).sort(), ["Site06-5", "Site20-6"]);
});

test("slipStats: how long a working spot keeps working, and when a failing one next works", async () => {
  const { slipStats } = await import("../windows-data.js");
  const codes = [0, 0, 5, 5, 5, 1, 0, 3, 3, 0]; // 5 and 3 work, 0 and 1 fail
  const part = (st) => ({ works: st.works, code: st.code, slack: st.slack, runEnd: st.runEnd, next: st.next, wait: st.wait, prev: st.prev, back: st.back });
  assert.deepEqual(part(slipStats(codes, 2)), { works: true, code: 5, slack: 2, runEnd: 4, next: 7, wait: 3, prev: null, back: null });
  assert.deepEqual(part(slipStats(codes, 4)), { works: true, code: 5, slack: 0, runEnd: 4, next: 7, wait: 3, prev: null, back: null });
  assert.deepEqual(part(slipStats(codes, 6)), { works: false, code: 0, slack: 0, runEnd: null, next: 7, wait: 1, prev: 4, back: 2 });
  assert.deepEqual(part(slipStats(codes, 0)), { works: false, code: 0, slack: 0, runEnd: null, next: 2, wait: 2, prev: null, back: null });
  assert.equal(slipStats(codes, 9).next, null);
  assert.equal(slipStats(codes, 8).next, null); // without the next year, the search ends at the year end
  assert.equal(slipStats(codes, 8).endHit, true);
  assert.equal(slipStats(codes, 8).searched, 10);
});

test("slipStats searches on into the next year: a window that crosses 31 December is whole, and the next window may be in January", async () => {
  const { slipStats } = await import("../windows-data.js");
  const year = [0, 0, 0, 0, 5, 5, 5]; // works on the last three days
  const next = [5, 5, 0, 0, 0, 3]; // and on the first two of the next year, then again on day 5
  const st = slipStats(year, 5, next);
  assert.equal(st.runEnd, 8); // index 8 is the second day of the next year
  assert.equal(st.slack, 3);
  assert.equal(st.next, 12);
  assert.equal(st.searched, 13);
  assert.equal(st.endHit, false);
  const failing = slipStats([0, 0, 0], 1, [0, 0, 5]);
  assert.equal(failing.next, 5);
  assert.equal(failing.wait, 4);
  const none = slipStats([0, 0, 0], 1, [0, 0, 0]);
  assert.equal(none.next, null);
  assert.equal(none.endHit, true);
  assert.equal(none.searched, 6);
});

test("slipRanking passes each spot's following year to the search", async () => {
  const { slipRanking } = await import("../windows-data.js");
  const rows = slipRanking([{ id: "A", codes: [0, 0, 5], points: 13 }, { id: "B", codes: [0, 0, 0], points: 13 }], 0, (s) => (s.id === "B" ? [0, 0, 5] : null));
  assert.equal(rows.find((r) => r.id === "B").slip.next, 5);
  assert.equal(rows.find((r) => r.id === "A").slip.next, 2);
});

test("slipRanking: working spots by how long they keep working, then failing spots by the next window", async () => {
  const { slipRanking } = await import("../windows-data.js");
  const spot = (id, codes, points = 13) => ({ id, codes, points });
  const rows = slipRanking([
    spot("late", [0, 0, 0, 0, 5]),
    spot("short", [5, 0, 0, 0, 0]),
    spot("long", [5, 5, 5, 0, 0]),
    spot("soon", [0, 2, 0, 0, 0]),
  ], 0);
  assert.deepEqual(rows.map((r) => r.id), ["long", "short", "soon", "late"]);
  assert.equal(rows[0].slip.slack, 2);
});

test("robust landings are rare: the 'about 5% of spot-days' note on the Planner holds for the stored grid", () => {
  let days = 0, robust = 0;
  for (const spot of file.spots) {
    for (const year of Object.keys(spot.days)) {
      for (const ch of spot.days[year]) { days++; if (parseInt(ch, 16) - 1 === Number(spot.points)) robust++; }
    }
  }
  assert.equal(Math.round((robust / days) * 100), 5);
  const siteOne = file.spots.find((s) => s.id === "Site01-1");
  assert.ok(Object.values(siteOne.days).every((str) => ![...str].some((ch) => parseInt(ch, 16) - 1 === Number(siteOne.points))), "Site01-1 has no robust day under the default rule");
});

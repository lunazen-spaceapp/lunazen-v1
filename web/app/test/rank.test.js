import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ephemeris, SiteCatalog, parseUtc } from "../../engine/index.js";
import { rankCsv, rankRows, rankStory } from "../rank-rows.js";
import { runTask } from "../tasks.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const buffer = (f) => { const b = readFileSync(data + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = {
  ephemeris: new Ephemeris(JSON.parse(readFileSync(data + "ephemeris.json", "utf8")), buffer("ephemeris.bin")),
  catalog: new SiteCatalog(JSON.parse(readFileSync(data + "sites.json", "utf8")), buffer("horizons.bin")),
};
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL("../../engine/test/fixtures.json", import.meta.url)), "utf8"));

for (const f of fixtures.rank) {
  test(`rank ${f.start_utc.slice(0, 10)}, ${f.mission_days} days, ${f.max_dark_hours} h, within ${f.within_m} m${f.dark_below ? `, dark below ${f.dark_below * 100}%` : ""}: same order and verdicts as Python`, () => {
    const et0 = parseUtc(f.start_utc);
    const results = [...ctx.catalog.spots.keys()].map((id) => ({
      ...runTask(ctx, { kind: "rank", id, mast: 2, et0, missionS: f.mission_days * 86400, minLink: f.min_link, maxDarkHours: f.max_dark_hours, within: f.within_m, darkBelow: f.dark_below ?? 0 }),
      siteId: ctx.catalog.spots.get(id).site,
    }));
    assert.equal(results.length, 67);
    const rows = rankRows(results, { minLink: f.min_link, maxDarkHours: f.max_dark_hours });
    for (const r of rows) {
      assert.equal(r.works, f.works[r.id], `${r.id} works`);
      assert.equal(r.holds, f.holds_raised[r.id], `${r.id} holds with a higher skyline`);
      assert.ok(Math.abs(r.within - f.within[r.id]) < 1e-9, `${r.id} within ${r.within} vs ${f.within[r.id]}`);
      assert.ok(Math.abs(r.metrics.longestDarkHours - f.longest_dark_hours[r.id]) < 1e-9, `${r.id} dark`);
    }
    assert.deepEqual(rows.map((r) => r.id), f.order);
  });
}

const row = (id, dark, link, raisedDark, raisedLink, ringOk = 12) => ({ id, siteId: "S", siteName: "Site", metrics: { longestDarkHours: dark, dsnLinkFraction: link, sunlitFraction: 0.8, energyWhPerW: 100 }, raised: { longestDarkHours: raisedDark, dsnLinkFraction: raisedLink, sunlitFraction: 0.7 }, ringOk, ringTotal: 12 });

test("a spot holds when it still works with the skyline higher; 'most robust' puts those first", () => {
  const rule = { minLink: 0.5, maxDarkHours: 50 };
  const results = [row("A", 20, 0.6, 60, 0.6), row("B", 30, 0.6, 31, 0.6), row("C", 60, 0.6, 70, 0.6)];
  const overall = rankRows(results, rule);
  assert.deepEqual(overall.map((r) => [r.id, r.works, r.holds]), [["A", true, false], ["B", true, true], ["C", false, false]]);
  assert.deepEqual(rankRows(results, { ...rule, orderId: "robust" }).map((r) => r.id), ["B", "A", "C"]);
  assert.match(rankStory(overall, 3), /2 of 3 spots work.*1 of the 2 still work if the terrain is 0.25° higher than mapped/);
  assert.match(rankCsv(overall).split("\n")[1], /,no$/);
});

test("results without a raised run (older callers) have no verdict and keep the old story", () => {
  const plain = [{ id: "A", siteId: "S", siteName: "Site", metrics: { longestDarkHours: 20, dsnLinkFraction: 0.6, sunlitFraction: 0.8, energyWhPerW: 1 }, ringOk: 12, ringTotal: 12 }];
  const rows = rankRows(plain, { minLink: 0.5, maxDarkHours: 50 });
  assert.equal(rows[0].holds, null);
  assert.equal(rankStory(rows, 1), "1 of 1 spots work for this landing. Best: A.");
});

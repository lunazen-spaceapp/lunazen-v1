import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVALUATED_SITES, PLAYLIST_DURATIONS, PLAYLIST_TITLES, evidenceRows, playlistLine, playlistMinutes, scopeLead, siteCounts } from "../resources-model.js";
import { SiteCatalog } from "../../engine/index.js";

const web = fileURLToPath(new URL("../../", import.meta.url));
const evidence = JSON.parse(readFileSync(`${web}data/evidence.json`, "utf8"));
const catalogue = JSON.parse(readFileSync(`${web}data/sites.json`, "utf8"));
const catalog = new SiteCatalog(catalogue, null);

test("the evidence table reads the figures of the design from evidence.json", () => {
  const rows = evidenceRows(evidence);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => [r.check, r.result, r.limit, r.verdict]), [
    ["Sun and Earth directions", "0.10″ at worst", "1″ max", "pass"],
    ["Long-term sunlight", "1.6 pp RMS (worst: 2.0 pp on the 6 flattest)", "3 pp max", "pass"],
    ["Connecting Ridge regions", "+0.3 to +1.4 pp", "±2 pp max", "pass"],
    ["Sun angle on the surface", "0.12° at worst", "0.25° max", "pass"],
    ["All 67 candidate spots", "r = 0.96, RMS 4.4 pp", "—", "reported"],
    ["Two real landings", "15 m; 6 min", "—", "reported"],
    ["Browser engine", "tested on every run of npm test", "0.1″ and 0.1 pp max", "pass"],
  ]);
  assert.deepEqual(rows.map((r) => r.against), [
    "JPL Horizons (4 sites, 70 dates each)", "NASA LOLA illumination maps (26 points)", "Barker et al. (2021)", "Apollo 11, 12 and 14 moonwalk records",
    "NASA 18.6-year map (at the same pixel)", "IM-1's measured height; Blue Ghost 1's sunset", "The Python reference (every spot)"]);
});

test("the four Scope figures are the catalogue's, and the paragraph's counts with them", () => {
  assert.deepEqual(siteCounts(catalog).map(([n, label]) => [n, label]), [[13, "NASA sites (5 m)"], [67, "Candidate spots"], [3, "CLPS landings"], [12, "Historical & global sites"]]);
  const lead = scopeLead(catalog);
  assert.ok(lead.startsWith("All 27 NASA PGDA south-pole sites were checked against one rule"));
  assert.ok(lead.includes("a 13-site polar catalogue on 5 m terrain maps, plus 15 historical and commercial landing sites for comparison."));
});

test("the 27 evaluated sites are the rows of the site table", () => {
  const rows = readFileSync(`${web}../data/sites/site_selection.csv`, "utf8").trim().split("\n").length - 1;
  assert.equal(EVALUATED_SITES, rows);
});

test("the playlist is six videos of about 39 minutes", () => {
  assert.equal(PLAYLIST_DURATIONS.length, 6);
  assert.equal(PLAYLIST_TITLES.length, 6);
  assert.equal(playlistMinutes(), 39);
  assert.equal(playlistLine(), "Technical playlist · 6 videos · about 39 minutes");
});

test("the numbers written into the page's sentences are the catalogue's", () => {
  const html = readFileSync(`${web}resources.html`, "utf8");
  assert.ok(html.includes(`${catalog.spots.size} spots on 5 m maps`));
  assert.ok(html.includes(`The ${catalog.beyond.sites.length} historical and global sites use a 474 m map`));
  assert.ok(html.includes(`Detailed maps for the ${catalog.beyond.sites.length} non-polar sites`));
  assert.ok(html.includes(`Only inside the ${catalog.sites.length} site areas`));
  assert.ok(html.includes("View all 27 evaluated sites"));
  const presets = catalog.darknessPresets.map((p) => p.hours);
  assert.deepEqual(presets, [5, 50]);
  assert.ok(html.includes("compared with a limit: 5 h, 50 h or your own"));
});

test("the page has the five rows in order, the Challenge resources row is gone, and no jump links", () => {
  const html = readFileSync(`${web}resources.html`, "utf8");
  assert.deepEqual([...html.matchAll(/<section id="(\w+)" class="acc-row">/g)].map((m) => m[1]), ["guides", "evidence", "data", "scope", "videos"]);
  assert.ok(!/Challenge resources|res-jumps|id="sites"|id="covers"/.test(html));
});

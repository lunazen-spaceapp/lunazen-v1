import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SiteCatalog } from "../../engine/index.js";
import { bandTiles, countText, description, filterSites, latitudeText, noMatchText, siteRows, sortSites, spotLines, sunSub, verdict } from "../map-model.js";

const web = fileURLToPath(new URL("../../", import.meta.url));
const catalog = new SiteCatalog(JSON.parse(readFileSync(`${web}data/sites.json`, "utf8")), null);
const rows = siteRows(catalog);
const byName = (name) => rows.find((r) => r.name === name);
const limit = catalog.darknessPresets.find((p) => p.id === "viper").hours;
const y = (id) => ({ year: catalog.defaultYear, ...catalog.yearMetrics(catalog.spots.get(id), catalog.defaultYear) });

test("thirteen site rows with their best sunlit and Earth-in-view shares", () => {
  assert.equal(rows.length, 13);
  const pct = (r) => [Math.round(r.bestSun * 100), Math.round(r.bestEarth * 100)];
  assert.deepEqual(pct(byName("Connecting ridge")), [91, 55]);
  assert.deepEqual(pct(byName("Nobile rim 2")), [53, 98]);
  assert.equal(byName("Connecting ridge").bestSunSpot, "Site01-2");
  assert.equal(latitudeText(byName("Connecting ridge").latitudeDeg), "89.5°S");
  assert.equal(latitudeText(byName("Nobile rim 2").latitudeDeg), "84.1°S");
});

test("the sorts: sunlight and Earth by the best value, highest first, A to Z by name", () => {
  const sun = sortSites(rows, "sun").map((r) => r.name);
  assert.equal(sun[0], "Connecting ridge");
  assert.equal(sun.at(-1), "Nobile rim 2");
  assert.equal(sortSites(rows, "earth")[0].name, "Nobile rim 2");
  assert.deepEqual(sortSites(rows, "name").map((r) => r.name), rows.map((r) => r.name).sort((a, b) => a.localeCompare(b)));
});

test("a search keeps the sites whose name or spot matches and opens them", () => {
  const all = filterSites(rows, "");
  assert.equal(all.rows.length, 13);
  assert.ok(all.rows.every((r) => !r.open));
  const spot = filterSites(rows, "dm2-4");
  assert.deepEqual(spot.rows.map((r) => [r.row.name, r.spots, r.open]), [["Nobile rim 2", ["DM2-4"], true]]);
  assert.equal(spot.spots, 1);
  const name = filterSites(rows, "gerlache");
  assert.ok(name.rows.length >= 3 && name.rows.every((r) => r.open));
  assert.equal(name.rows.find((r) => r.row.name === "de Gerlache rim").spots.length, 5); // a site that matches by name shows all its spots
  assert.equal(filterSites(rows, "zzz").rows.length, 0);
});

test("the status line and the no-result message", () => {
  assert.equal(countText(13, 13, "", 0), "Showing 13 of 13 sites");
  assert.equal(countText(1, 13, "dm2-4", 1), "Showing 1 of 13 sites · 1 spot");
  assert.equal(countText(2, 13, "x", 7), "Showing 2 of 13 sites · 7 spots");
  assert.equal(noMatchText(" zzz "), "No site or spot matches “zzz”.");
});

test("Site01-1: very bright, but with long nights, about 3 times the darkness limit", () => {
  const s = y("Site01-1");
  assert.equal(verdict(s, limit), "Very bright, but with long nights");
  assert.equal(description(s, limit), "Its longest night is about 3 times a 50 h darkness limit (VIPER's design figure). Earth is above the skyline about half the year, with stretches of over a week without a DSN station in view.");
});

test("the verdict and description rules at their edges", () => {
  const at = (over) => ({ sunlitFraction: 0.9, earthFraction: 0.5, longestDarkHours: 100, longestDsnLinkGapHours: 100, ...over });
  assert.equal(verdict(at({ longestDarkHours: 50 }), 50), "Very bright, with short nights");
  assert.equal(verdict(at({ longestDarkHours: 120 }), 50), "Very bright, but with nights of a few days");
  assert.equal(verdict(at({ sunlitFraction: 0.7, longestDarkHours: 121 }), 50), "Mostly sunlit, but with long nights");
  assert.equal(verdict(at({ sunlitFraction: 0.69, longestDarkHours: 80 }), 50), "Often in shadow, with nights of a few days");
  assert.equal(verdict(at({ sunlitFraction: 0.5, longestDarkHours: 300 }), 50), "Often in shadow, with long nights");
  assert.match(description(at({ longestDarkHours: 50 }), 50), /^Its longest night stays within a 50 h darkness limit \(VIPER's design figure\)\. /);
  assert.match(description(at({ earthFraction: 0.6 }), 50), /Earth is above the skyline most of the year, with gaps of a few days/);
  assert.match(description(at({ earthFraction: 0.44, longestDsnLinkGapHours: 71 }), 50), /Earth is below the skyline more often than not, with only short gaps in DSN coverage\.$/);
});

test("the sunlit tile's line: the best spot of its site, or where the best is", () => {
  assert.deepEqual(sunSub("Site01-2", byName("Connecting ridge")), { text: "Best sunlit spot at Connecting ridge", best: true });
  assert.deepEqual(sunSub("Site01-1", byName("Connecting ridge")), { text: "Site best: 91% (Site01-2)", best: false });
});

test("the lines under a spot's name and the four tiles", () => {
  const s = catalog.spots.get("Site01-1");
  assert.deepEqual(spotLines(s), ["89.475°S 222.56°E", "Elevation 1947 m · Slope 3.0°"]);
  const tiles = bandTiles(y("Site01-1"), sunSub("Site01-1", byName("Connecting ridge")));
  assert.deepEqual(tiles.map((t) => [t.label, t.value]), [["Sunlit share (2027)", "90%"], ["Earth in view", "55%"], ["Longest night", "5 d 18 h"], ["Longest DSN gap", "12 d 6 h"]]);
});

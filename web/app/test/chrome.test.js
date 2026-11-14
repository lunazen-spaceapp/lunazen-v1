import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOOTER_TEXT, LEARN_ITEMS, PLAN_ITEMS, fileOf, headerHtml, sectionOf } from "../nav-model.js";

const data = fileURLToPath(new URL("../../data/", import.meta.url));
const web = fileURLToPath(new URL("../../", import.meta.url));

test("every page belongs to one section of the bar", () => {
  assert.equal(sectionOf("index.html"), "home");
  for (const it of LEARN_ITEMS) assert.equal(sectionOf(it.href), "learn", it.href);
  for (const it of PLAN_ITEMS) assert.equal(sectionOf(it.href), "plan", it.href);
  assert.equal(sectionOf("resources.html"), "resources");
  assert.equal(sectionOf("evidence.html"), "resources"); // reached from Resources only
  assert.equal(sectionOf("contact.html"), "contact");
});

test("the file name comes from the path, a bare folder being the home page", () => {
  assert.equal(fileOf("/"), "index.html");
  assert.equal(fileOf("/web/planner.html"), "planner.html");
});

test("the bar lists the pages of the design and Evidence is not among them", () => {
  const html = headerHtml("index.html");
  assert.deepEqual(LEARN_ITEMS.map((i) => i.label), ["Map", "Explorer", "Whole Moon"]);
  assert.deepEqual(PLAN_ITEMS.map((i) => i.label), ["Planner", "Ranker", "Delay Analyzer", "Compare landings", "Compare sites"]);
  assert.ok(!/evidence/i.test(html));
  assert.equal([...html.matchAll(/class="menu-item"/g)].length, 16); // eight items in the dropdowns and eight in the phone menu
});

test("the page you are on is marked, and only that one", () => {
  const html = headerHtml("rank.html");
  assert.equal([...html.matchAll(/aria-current="page"/g)].length, 2); // in the dropdown and in the phone menu
  assert.match(html, /<button type="button" class="nav-link is-current" aria-haspopup="true" aria-expanded="false" aria-controls="menu-plan">/);
  assert.equal([...headerHtml("index.html").matchAll(/nav-link is-current" aria-haspopup/g)].length, 0); // on Home neither menu is the current one
});

test("the menus start closed", () => {
  const html = headerHtml("map.html");
  assert.match(html, /id="menu-learn" hidden/);
  assert.match(html, /id="menu-plan" hidden/);
  assert.match(html, /id="drawer" hidden/);
});

test("the numbers in the Map line are the catalogue's", () => {
  const catalogue = JSON.parse(readFileSync(`${data}sites.json`, "utf8"));
  const map = LEARN_ITEMS.find((i) => i.href === "map.html").desc;
  assert.ok(map.includes(`${catalogue.spots.length} spots at ${catalogue.sites.length} sites`), map);
});

test("the footer is the one line of the design", () => {
  assert.equal(FOOTER_TEXT, "Terrain: NASA LRO LOLA · Ephemeris: JPL DE440");
});

test("every page loads the shared chrome and has an empty bar and footer to fill", () => {
  for (const page of ["index", "map", "explorer", "moon", "planner", "rank", "windows", "compare", "sidebyside", "evidence", "resources", "contact"]) {
    const html = readFileSync(`${web}${page}.html`, "utf8");
    assert.match(html, /<header class="topbar"><\/header>/, page);
    assert.match(html, /<footer class="site-footer"><\/footer>/, page);
    assert.ok(html.indexOf("app/chrome.js") > 0 && html.indexOf("app/chrome.js") < html.indexOf("app/hint.js"), page);
  }
});

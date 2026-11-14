import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUtc } from "../../engine/index.js";
import { heatGrid } from "../query-model.js";
import { gridFootnote, heatmapHtml, legendHtml, ringHtml, runListHtml, sentenceHtml, takeHtml, tilesHtml, trailHtml, verdictHtml } from "../components.js";

const RULE = { maxDarkHours: 50, minLinkFraction: 0.5 };
const T0 = parseUtc("2027-03-14T00:00:00");
const pt = (ok, dark = 10) => ({ ok, sunlitFraction: 0.9, longestDarkHours: dark, linkFraction: 0.8 });
const row = (k, ok, dark = 10) => ({ startEt: T0 + k * 6 * 3600, ok, robustness: ok ? 1 : 0, centre: pt(ok, dark), points: Array.from({ length: 13 }, () => pt(ok, dark)), holdsRaised: ok });

test("the sentence is text with a button for each token, and the changed one is marked", () => {
  const html = sentenceHtml(["Find ", { key: "goal", text: "the earliest landing" }, " at ", { key: "spot", text: "Site<1>" }], "spot");
  assert.match(html, /^Find <button type="button" class="lz-tok" data-tok="goal"/);
  assert.match(html, /class="lz-tok changed" data-tok="spot"/);
  assert.match(html, /Site&lt;1&gt;/);
});

test("the trail marks the current step and names where each button goes", () => {
  const html = trailHtml([{ label: "Start" }, { label: "Mast" }], 1);
  assert.match(html, /data-trail="1" aria-current="step" aria-label="Current step: Mast">Mast/);
  assert.match(html, /data-trail="0" aria-label="Go back to: Start">Start/);
  assert.match(html, /Your changes:/);
});

test("a trail of one step draws nothing: there is nothing to go back to", () => {
  assert.equal(trailHtml([{ label: "Start" }], 0), "");
});

test("the verdict is a status with an icon, the title and the reason", () => {
  const html = verdictHtml({ state: "warn", title: "T", reason: "R" }, { delta: "Compared with before: the landing shown is 6 days later." });
  assert.match(html, /class="lz-verdict warn" role="status"/);
  assert.match(html, /<div class="t">T<\/div><div class="s">R<\/div>/);
  assert.match(html, /<p class="delta">Compared with before: the landing shown is 6 days later\.<\/p>/);
});

test("each heatmap cell is a labelled button, one selected", () => {
  const rows = [row(0, true), row(1, false, 70), row(2, true), row(3, true)];
  const html = heatmapHtml(heatGrid(rows, RULE, "2027-03-14", 1), rows, 1);
  assert.match(html, /aria-label="14 Mar 2027 00:00 UTC, valid within 100 m dispersion"/);
  assert.match(html, /aria-label="14 Mar 2027 06:00 UTC, fail, night exceeds limit"/);
  assert.equal((html.match(/class="c [a-z]+ sel"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
});

test("the ring counts the working points and marks failures by shape as well as colour", () => {
  const r = row(0, true);
  r.points[3] = pt(false, 99);
  const html = ringHtml(r, Array.from({ length: 12 }, (_, i) => [i < 6 ? 50 : 100, 0]));
  assert.match(html, /<b>12 of 13 touchdown points valid<\/b>/);
  assert.equal((html.match(/class="rd-no"/g) ?? []).length, 1);
  assert.match(html, /Solid green markers pass all mission constraints; hollow orange markers exceed/);
});

test("only the tile that breaks the brief is flagged", () => {
  const facts = { sunUpAtLanding: true, earthUpAtLanding: true, firstSunsetH: 36, firstEarthsetH: null, longestNightH: 60, longestNoLinkH: 5, sunShare: 0.8, linkShare: 0.6 };
  const html = tilesHtml(facts, RULE);
  assert.equal((html.match(/lz-tile bad/g) ?? []).length, 1);
  assert.match(html, /Longest night <button type="button" class="hint"[^>]*>ⓘ<\/button><\/div><div class="v">2 d 12 h <small>\/ 50 h limit<\/small>/);
  assert.match(html, /First sunset<\/div><div class="v">\+36 h/);
  assert.match(html, /First Earthset<\/div><div class="v">Not in the mission/);
});

test("a body that is down at landing gets a first rise, not a first set at once", () => {
  const facts = { sunUpAtLanding: true, earthUpAtLanding: false, firstSunsetH: 12, firstEarthsetH: 0, firstSunriseH: null, firstEarthriseH: 89, longestNightH: 10, longestNoLinkH: 5, sunShare: 0.8, linkShare: 0.6 };
  const html = tilesHtml(facts, RULE);
  assert.match(html, /First sunset<\/div><div class="v">\+12 h/);
  assert.match(html, /First Earthrise<\/div><div class="v">\+3 d 17 h/);
  assert.doesNotMatch(html, /First Earthset|Down at landing/);
  const sunDown = tilesHtml({ ...facts, sunUpAtLanding: false, firstSunriseH: 30 }, RULE);
  assert.match(sunDown, /First sunrise<\/div><div class="v">\+30 h/);
});

test("the run list shows the first eight runs and says how many there are", () => {
  const runs = Array.from({ length: 10 }, (_, k) => ({ first: k, last: k, count: 1, margin: 12, bestRow: k, holds: k % 2, startEt: T0 + k * 86400, endEt: T0 + k * 86400 }));
  const html = runListHtml(runs, [], RULE, 2);
  assert.equal((html.match(/<tr data-run=/g) ?? []).length, 8);
  assert.match(html, /Showing 8 of 10 windows/);
  assert.match(html, /data-run="2" tabindex="0" class="sel"/);
});

test("a suggestion with a key is a button; one without is plain text", () => {
  const html = takeHtml([{ key: "mast10", title: "A 10 m mast", sub: "x" }, { title: "Fact", sub: "y" }], "What it would take");
  assert.match(html, /<button type="button" class="lz-take" data-take="mast10">/);
  assert.match(html, /<div class="lz-take plain">/);
});

test("the legend, the ring and the cell words follow the miss distance", () => {
  assert.match(legendHtml(100), /Pass: Spot \+ 12 dispersion points \(≤ 100 m\)/);
  assert.match(legendHtml(50), /Pass: Spot \+ 6 dispersion points \(≤ 50 m\)/);
  assert.doesNotMatch(legendHtml(0), /dispersion points|Target spot only/);
  assert.match(gridFootnote(100, 245, 13, "0.7"), /all 13 points \(spot \+ 12 offsets\).*~5% baseline pass rate\) · 245 epochs × 13 points evaluated in 0\.7 s\./);
  assert.match(gridFootnote(50, 245, 7, "0.7"), /~14% baseline/);
  const pt = (ok) => ({ ok });
  const r = { points: [pt(true), ...Array.from({ length: 12 }, () => pt(true))] };
  const offsets = Array.from({ length: 12 }, (_, i) => [i < 6 ? 50 : 100, 0]);
  assert.equal((ringHtml(r, offsets, 50).match(/<circle/g) || []).length, 1 + 1 + 6); // the 50 m edge, six points and the spot
  assert.equal((ringHtml(r, offsets, 100).match(/<circle/g) || []).length, 2 + 12 + 1);
  assert.match(ringHtml(r, offsets, 50), /6 at 50 m\)\./);
});

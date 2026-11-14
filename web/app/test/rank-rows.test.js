import { test } from "node:test";
import assert from "node:assert/strict";

import { rankRows, rankStory } from "../rank-rows.js";

const r = (id, siteId, dark, link, sun, ringOk, energy = 0) => ({
  id, siteId, siteName: siteId, ringTotal: 12, ringOk,
  metrics: { longestDarkHours: dark, dsnLinkFraction: link, sunlitFraction: sun, energyWhPerW: energy },
});
const RULE = { minLink: 0.5, maxDarkHours: 50 };

test("a spot that fails the rule ranks below every spot that passes", () => {
  const rows = rankRows([r("A", "S1", 80, 0.9, 0.9, 12), r("B", "S2", 30, 0.6, 0.5, 0), r("C", "S3", 10, 0.3, 0.9, 12)], RULE);
  assert.deepEqual(rows.map((x) => x.id), ["B", "C", "A"]); // C and A both fail; C has the shorter night
  assert.deepEqual(rows.map((x) => x.works), [true, false, false]);
});

test("overall order: nearby points first, then shorter night, then DSN in view, then sunlight", () => {
  const rows = rankRows([r("A", "S1", 20, 0.6, 0.6, 6), r("B", "S2", 40, 0.9, 0.9, 12), r("C", "S3", 10, 0.6, 0.6, 12), r("D", "S4", 10, 0.7, 0.6, 12), r("E", "S5", 10, 0.7, 0.8, 12)], RULE);
  assert.deepEqual(rows.map((x) => x.id), ["E", "D", "C", "B", "A"]);
});

test("a single-metric order sorts by it and breaks ties with the overall order", () => {
  const rows = rankRows([r("A", "S1", 20, 0.6, 0.6, 6), r("B", "S2", 40, 0.9, 0.9, 12)], { ...RULE, orderId: "sun" });
  assert.deepEqual(rows.map((x) => x.id), ["B", "A"]);
  assert.equal(rankRows([r("A", "S1", 20, 0.6, 0.6, 6, 100), r("B", "S2", 40, 0.9, 0.9, 12, 300)], { ...RULE, orderId: "energy" })[0].id, "B");
  assert.equal(rankRows([r("A", "S1", 20, 0.6, 0.6, 6), r("B", "S2", 40, 0.9, 0.9, 12)], { ...RULE, orderId: "night" })[0].id, "A");
});

test("best spot per site keeps the first row of each site", () => {
  const rows = rankRows([r("A", "S1", 20, 0.6, 0.6, 6), r("B", "S1", 10, 0.6, 0.6, 12), r("C", "S2", 30, 0.6, 0.6, 12)], { ...RULE, bestPerSite: true });
  assert.deepEqual(rows.map((x) => x.id), ["B", "C"]);
});

test("equal rows keep the input order and the story names the best", () => {
  const rows = rankRows([r("A", "S1", 20, 0.6, 0.6, 12), r("B", "S2", 20, 0.6, 0.6, 12)], RULE);
  assert.deepEqual(rows.map((x) => x.id), ["A", "B"]);
  assert.match(rankStory(rows, 2), /2 of 2 spots work.*Best: A/);
  assert.match(rankStory(rankRows([r("A", "S1", 90, 0.6, 0.6, 0)], RULE), 1), /None of the 1 spots works/);
});

test("in a single-measure order the story names the first spot that works and counts the failing spots above it", () => {
  const rows = rankRows([r("A", "S1", 90, 0.9, 0.9, 0), r("B", "S2", 20, 0.6, 0.5, 12), r("C", "S3", 20, 0.6, 0.4, 12)], { ...RULE, orderId: "contact" });
  assert.equal(rows[0].id, "A");
  assert.match(rankStory(rows, 3), /2 of 3 spots work.*Best: B\. One spot that fails ranks above it in this order\./);
});

test("a saved spot is named by its label, and each saved spot is its own site for Best per site", () => {
  const mine = (id, label, dark) => ({ ...r(id, `mine:${id}`, dark, 0.9, 0.9, 12), siteName: "My points", label });
  const rows = rankRows([r("A", "S1", 30, 0.9, 0.9, 12), mine("pt_-89.4_222.5", "Rim", 10), mine("pt_-89.5_222.5", "Floor", 20)], { ...RULE, bestPerSite: true });
  assert.deepEqual(rows.map((x) => x.label ?? x.id), ["Rim", "Floor", "A"]);
  assert.match(rankStory(rows, 3), /Best: Rim/);
});

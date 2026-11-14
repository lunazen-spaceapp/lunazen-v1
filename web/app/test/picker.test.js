import { test } from "node:test";
import assert from "node:assert/strict";

import { CLPS, isBeyond, plannable, siteOf, siteOptions, spotOptions } from "../picker.js";

const y = (sun, earth) => ({ 2: { sunlitFraction: sun, earthFraction: earth } });
const catalog = {
  defaultMastM: 2,
  yearMetrics: (record) => record.year2027[2],
  sites: [{ id: "Site01", name: "Connecting ridge", spots: ["Site01-1", "Site01-2"] }, { id: "Site04", name: "Shackleton rim", spots: ["Site04-1"] }],
  spots: new Map([
    ["Site01-1", { site: "Site01", year2027: y(0.897, 0.552), artemisRegions: [{ name: "Connecting Ridge", central: true }] }],
    ["Site01-2", { site: "Site01", year2027: y(0.908, 0.553), artemisRegions: [] }],
    ["Site04-1", { site: "Site04", year2027: y(0.863, 0.504), artemisRegions: [] }],
  ]),
  missions: new Map([["im1", { id: "im1", name: "IM-1 Odysseus", landedUtc: "2024-02-22T23:23:53" }]]),
};

test("siteOf maps spots to their site and missions to the CLPS group", () => {
  assert.equal(siteOf(catalog, "Site01-2"), "Site01");
  assert.equal(siteOf(catalog, "im1"), CLPS);
  assert.equal(siteOf(catalog, "nope"), "");
});

test("site options summarise each site; missions and none are optional", () => {
  assert.deepEqual(siteOptions(catalog).map((o) => o.label), ["Connecting ridge · up to 91% Sun", "Shackleton rim · up to 86% Sun"]);
  const all = siteOptions(catalog, { includeMissions: true, allowNone: true }).map((o) => o.value);
  assert.deepEqual(all, ["", "Site01", "Site04", CLPS]);
});

test("spot options carry the 2027 numbers and the Artemis flag", () => {
  assert.deepEqual(spotOptions(catalog, "Site01").map((o) => o.label), ["Site01-1 · Sun 90%, Earth 55% · Artemis", "Site01-2 · Sun 91%, Earth 55%"]);
  assert.equal(spotOptions(catalog, "Site01", { compact: true })[0].label, "Site01-1 · Sun 90%, Earth 55%");
  assert.deepEqual(spotOptions(catalog, CLPS), [{ value: "im1", label: "IM-1 Odysseus · landed 2024-02-22" }]);
  assert.deepEqual(spotOptions(catalog, ""), []);
});

test("landing sites away from the pole are listed only when asked for, and are not plannable", () => {
  const withBeyond = {
    ...catalog,
    beyond: { sites: [{ id: "ap11", name: "Apollo 11", landedDate: "1969-07-20" }] },
    customs: new Map([["ap11", { id: "ap11", group: "beyond" }]]),
    spotRecord: (id) => catalog.spots.get(id) ?? (id === "ap11" ? { id } : undefined),
  };
  assert.ok(!siteOptions(withBeyond).some((o) => o.value === "beyond"));
  assert.ok(siteOptions(withBeyond, { includeBeyond: true }).some((o) => o.value === "beyond"));
  assert.ok(isBeyond(withBeyond, "ap11"));
  assert.ok(plannable(withBeyond, "Site01-1"));
  assert.ok(!plannable(withBeyond, "ap11"));
  assert.ok(!plannable(withBeyond, "nope"));
});

test("a point opened from a link is listed under My points and belongs to that group", () => {
  const id = "pt_-89.4709_222.5769";
  const withPoint = { ...catalog, customs: new Map([[id, { id, group: "custom", latitudeDeg: -89.4709, longitudeDeg: 222.5769 }]]) };
  assert.equal(siteOf(withPoint, id), "custom");
  assert.equal(siteOf(catalog, id), "custom"); // not traced yet: still the My points group
  assert.ok(siteOptions(withPoint).some((o) => o.value === "custom" && o.label.startsWith("My points")));
  assert.ok(!siteOptions(catalog).some((o) => o.value === "custom")); // nothing saved, nothing linked
  assert.deepEqual(spotOptions(withPoint, "custom").map((o) => o.value), [id]);
});

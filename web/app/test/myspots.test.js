import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MAX_MINE, _resetForTests, addMine, loadMine, mineName, readShareValue, removeMine, renameMine, shareValue } from "../myspots.js";
import { customId } from "../../engine/index.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const id = (k) => customId(-89.4 - k * 0.01, 222.5);
beforeEach(_resetForTests);

test("a saved spot is kept and named in order", () => {
  const s = memory();
  assert.equal(addMine(id(0), "", s).ok, true);
  assert.equal(addMine(id(1), "Rim", s).ok, true);
  assert.deepEqual(loadMine(s).map((x) => x.name), ["My point 1", "Rim"]);
});

test("at most five spots, no duplicates, and a removed name is reused", () => {
  const s = memory();
  for (let k = 0; k < MAX_MINE; k++) assert.equal(addMine(id(k), "", s).ok, true);
  assert.deepEqual(addMine(id(9), "", s), { ok: false, reason: "full", list: loadMine(s) });
  assert.equal(addMine(id(0), "", s).reason, "duplicate");
  removeMine(id(2), s);
  assert.equal(loadMine(s).length, 4);
  assert.equal(addMine(id(0), "", s).reason, "duplicate");
  addMine(id(9), "", s);
  assert.ok(loadMine(s).some((x) => x.id === id(9) && x.name === "My point 3"));
});

test("an id that is not a custom point is refused", () => {
  assert.equal(addMine("Site01-1", "", memory()).reason, "invalid");
});

test("corrupt or missing storage gives an empty list, and a page without storage still keeps the list", () => {
  const bad = { getItem: () => "{not json", setItem: () => {} };
  assert.deepEqual(loadMine(bad), []);
  const none = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(addMine(id(0), "A", none).ok, true);
  assert.equal(loadMine(none).length, 1);
});

test("a link's spots round-trip and are capped and validated", () => {
  const list = [{ id: id(0), name: "A, b;c" }, { id: id(1), name: "Rim" }];
  const back = readShareValue(shareValue(list));
  assert.deepEqual(back.map((x) => x.id), list.map((x) => x.id));
  assert.equal(back[0].name, "A b c");
  assert.deepEqual(readShareValue("x,y,z;;-89.4"), []);
  const many = Array.from({ length: 8 }, (_, k) => `${-89.4 - k * 0.01},222.5,s${k}`).join(";");
  assert.equal(readShareValue(many).length, MAX_MINE);
});

test("an id with fewer decimals is stored in the four-decimal form the tracer uses", () => {
  const s = memory();
  assert.equal(addMine("pt_-89.41_222.6", "", s).list[0].id, "pt_-89.4100_222.6000");
  assert.equal(addMine("pt_-89.4100_222.6000", "", s).reason, "duplicate");
  assert.deepEqual(removeMine("pt_-89.41_222.6", s), []);
});

test("a spot can be renamed, an empty name keeps the old one, and its name can be looked up by id", () => {
  const s = memory();
  addMine(id(0), "Rim", s);
  renameMine(id(0), "  North rim  ", s);
  assert.equal(mineName(id(0), s), "North rim");
  renameMine(id(0), "   ", s);
  assert.equal(mineName(id(0), s), "North rim");
  assert.equal(mineName(id(5), s), null);
});

test("a spot is called by its saved name, 'Custom point …' for another custom point, or its id", async () => {
  const { spotName, addMine, _resetForTests } = await import("../myspots.js");
  _resetForTests();
  const s = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })();
  assert.equal(spotName("Site01-1", s), "Site01-1");
  assert.equal(spotName("pt_-86.7065_332.2260", s), "Custom point 86.7065°S 332.226°E");
  addMine("pt_-86.7065_332.2260", "My point 1", s);
  assert.equal(spotName("pt_-86.7065_332.2260", s), "My point 1");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { compareVerdict, darknessVerdict, explorerStory, storyHtml } from "../story.js";

const presets = [{ name: "5 h (Blue Ghost 1, flown)", hours: 5, phrase: "5 h (Blue Ghost 1)" }, { name: "50 h darkness limit (from VIPER's design)", hours: 50, phrase: "the 50 h limit" }];
const nb = (bullets) => bullets.map((s) => s.replace(/\u00a0/g, " "));

test("darknessVerdict compares a night with the reference landers", () => {
  assert.equal(nb([darknessVerdict(3, presets)])[0], "within 5 h (Blue Ghost 1)");
  assert.equal(nb([darknessVerdict(20, presets)])[0], "within the 50 h limit, not 5 h");
  assert.equal(nb([darknessVerdict(138, presets)])[0], "more than the 50 h limit");
  assert.equal(darknessVerdict(138, []), "");
});

test("explorer bullets carry the numbers they are given", () => {
  const metrics = { sunlitFraction: 0.73, earthFraction: 0.54, longestDarkHours: 125, longestDsnLinkGapHours: 287 };
  assert.deepEqual(nb(explorerStory({ metrics, presets })), [
    "Sun up 73% · Earth in view 54%", "Longest night 5 d 5 h: more than the 50 h limit", "Longest gap without DSN in view 11 d 23 h"]);
  assert.deepEqual(nb(explorerStory({ metrics: { sunlitFraction: 1, earthFraction: 1, longestDarkHours: 0, longestDsnLinkGapHours: 0 }, presets })).slice(1),
    ["No night in this window", "DSN in view never drops out"]);
});

test("compare verdict follows the priority and says how sure we are", () => {
  const col = (id, sun, dark, link, ring) => ({ id, metrics: { sunlitFraction: sun, longestDarkHours: dark, dsnLinkFraction: link, ringSunMin: ring } });
  const cols = [col("A", 0.9, 138, 0.55, 0.33), col("B", 0.86, 82, 0.5, 0.36)];
  const v = compareVerdict(cols, "sun", presets);
  assert.equal(nb([v.title])[0], "Best illumination: A (90%, +4 pp over B)");
  assert.equal(nb([v.reason])[0], "A longest night is 5 d 18 h (exceeds 50 h limit); 100 m dispersion reduces worst-case illumination to 33%.");
  assert.equal(nb([compareVerdict(cols, "night", presets).title])[0], "Shortest night: B (3 d 10 h, 2 d 8 h shorter than A)");
  const tie = compareVerdict([col("A", 0.9, 0, 0.5, null), col("B", 0.9, 5, 0.5, null)], "sun", presets);
  assert.equal(nb([tie.title, tie.reason]).join("|"), "Best illumination: A and B tie (90%)|A has no night in this window.");
  assert.equal(compareVerdict([cols[0]], "sun", presets), null);
});

test("storyHtml escapes text into list items", () => {
  assert.equal(storyHtml(["a < b", "c"]), "<li>a &lt; b</li><li>c</li>");
});

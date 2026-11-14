import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_LABELS, GUIDE_PAGES, VIDEO_PLAYLIST, VIDEO_POLAR_SKY, guideHref, guideLinkHtml, hasUrl } from "../links.js";

test("a placeholder is not a link, a web address is", () => {
  assert.equal(hasUrl("PLAYLIST_URL_HERE"), false);
  assert.equal(hasUrl("https://www.youtube.com/playlist?list=x"), true);
  assert.equal(typeof VIDEO_PLAYLIST, "string");
  assert.equal(typeof VIDEO_POLAR_SKY, "string");
});

test("the checks link says Checks and names the page", () => {
  assert.match(guideLinkHtml("method"), new RegExp(`Checks: guide, p\\. ${GUIDE_PAGES.method}<`));
  assert.ok(GUIDE_LABELS.method.startsWith("Checks"));
});

test("guide links open the stored page", () => {
  for (const n of Object.values(GUIDE_PAGES)) assert.ok(Number.isInteger(n) && n >= 1);
  assert.equal(guideHref("method"), `lunazen_guide.pdf#page=${GUIDE_PAGES.method}`);
  assert.match(guideLinkHtml("limits", "Guide, p. {n}"), new RegExp(`#page=${GUIDE_PAGES.limits}".*Guide, p\\. ${GUIDE_PAGES.limits}<`));
});

test("the addresses come from one file and start as placeholders", async () => {
  const cfg = await import("../site-config.js");
  for (const key of ["REPO_URL", "APP_URL", "OVERVIEW_URL", "PLAYLIST_URL", "EXPLORER_VIDEO_URL"]) assert.equal(typeof cfg[key], "string");
  assert.equal(VIDEO_PLAYLIST, cfg.PLAYLIST_URL);
  assert.equal(VIDEO_POLAR_SKY, cfg.EXPLORER_VIDEO_URL);
});

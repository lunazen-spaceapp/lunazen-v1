import test from "node:test";
import assert from "node:assert/strict";
import { contactRows, isPlaceholder } from "../contact-model.js";

test("placeholders are bare constant names and text with a bracketed part", () => {
  assert.equal(isPlaceholder("CONTACT_EMAIL"), true);
  assert.equal(isPlaceholder("[Team name] · [Members and roles]"), true);
  assert.equal(isPlaceholder("REPO_URL"), true);
  assert.equal(isPlaceholder("team@example.org"), false);
  assert.equal(isPlaceholder("Moonshot · Ada (lead), Grace"), false);
});

test("with nothing filled in only the email row shows, in brackets", () => {
  const rows = contactRows({ email: "CONTACT_EMAIL", repo: "REPO_URL", team: "[Team name] · [Members and roles]" });
  assert.deepEqual(rows.email, { text: "[CONTACT_EMAIL]", href: "mailto:[CONTACT_EMAIL]" });
  assert.equal(rows.repo, null);
  assert.equal(rows.team, null);
});

test("filled in, every row shows", () => {
  const rows = contactRows({ email: "team@example.org", repo: "https://example.org/lunazen", team: "Moonshot · Ada (lead)" });
  assert.deepEqual(rows.email, { text: "team@example.org", href: "mailto:team@example.org" });
  assert.deepEqual(rows.repo, { text: "https://example.org/lunazen", href: "https://example.org/lunazen" });
  assert.deepEqual(rows.team, { text: "Moonshot · Ada (lead)" });
});

test("the values in site-config.js show all three rows", async () => {
  const { CONTACT_EMAIL, REPO_URL, TEAM } = await import("../site-config.js");
  const rows = contactRows({ email: CONTACT_EMAIL, repo: REPO_URL, team: TEAM });
  assert.equal(rows.email.text, "lunazen.spaceapp@gmail.com");
  assert.equal(rows.repo.href, "https://github.com/lunazen-spaceapp/lunazen-v1");
  assert.equal(rows.team.text, "Team LunaZen · Ishaan & Anirban");
});

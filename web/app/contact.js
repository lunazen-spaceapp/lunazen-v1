// Contact: the email, the repository and the team, from site-config.js. A row whose value is still a placeholder is left out,
// except the email row.

import { CONTACT_EMAIL, REPO_URL, TEAM } from "./site-config.js";
import { contactRows } from "./contact-model.js";

const $ = (id) => document.getElementById(id);
const rows = contactRows({ email: CONTACT_EMAIL, repo: REPO_URL, team: TEAM });

$("email-text").textContent = rows.email.text;
$("row-email").href = rows.email.href;
if (rows.repo) {
  $("repo-text").textContent = rows.repo.text;
  $("row-repo").href = rows.repo.href;
  $("row-repo").target = "_blank";
  $("row-repo").rel = "noopener";
  $("row-repo").hidden = false;
}
if (rows.team) {
  $("team-text").textContent = rows.team.text;
  $("row-team").hidden = false;
}

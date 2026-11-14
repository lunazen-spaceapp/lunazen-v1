// Resources: an accordion of five rows. The Scope figures come from the catalogue, the evidence table and its date from
// evidence.json, the page count from links.js; a link whose address is still a placeholder is left out or shown as text.

import { SiteCatalog } from "../engine/index.js";
import { GUIDE_PAGE_COUNT, hasUrl, hydrateLinks } from "./links.js";
import { OVERVIEW_URL, PLAYLIST_URL, REPO_URL, VIDEO_1_TITLE, VIDEO_URLS } from "./site-config.js";
import { PLAYLIST_DURATIONS, PLAYLIST_TITLES, evidenceRows, playlistLine, scopeLead, siteCounts } from "./resources-model.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PLAY = '<svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="36" fill="#0b0d12" fill-opacity="0.55" stroke="#f0f2f5" stroke-width="1.6"/><path d="M32 26 L52 38 L32 50 Z" fill="none" stroke="#f0f2f5" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9.5 L10.5 3" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const external = (a, url) => { a.href = url; a.target = "_blank"; a.rel = "noopener"; };

// One row open at a time, all closed at first; a hash naming a row opens it and scrolls to it.
function wireAccordion() {
  const rows = [...document.querySelectorAll(".acc-row")];
  const set = (row, open) => { row.querySelector(".acc-head").setAttribute("aria-expanded", String(open)); row.querySelector(".acc-panel").hidden = !open; };
  for (const row of rows) {
    row.querySelector(".acc-head").addEventListener("click", () => {
      const open = row.querySelector(".acc-head").getAttribute("aria-expanded") !== "true";
      for (const other of rows) set(other, other === row && open);
    });
  }
  const fromHash = () => {
    const row = rows.find((r) => r.id === decodeURIComponent(location.hash.slice(1)));
    if (!row) return;
    for (const other of rows) set(other, other === row);
    row.scrollIntoView();
  };
  fromHash();
  window.addEventListener("hashchange", fromHash);
}

function renderVideos() {
  const titles = PLAYLIST_TITLES.map((t) => t ?? VIDEO_1_TITLE);
  $("playlist-line").textContent = playlistLine();
  $("playlist").innerHTML = titles.map((t, i) => `<li><span class="n">${i + 1}</span>${hasUrl(VIDEO_URLS[i]) ? `<a class="t" href="${esc(VIDEO_URLS[i])}" target="_blank" rel="noopener">${esc(t)}</a>` : `<span class="t">${esc(t)}</span>`}<span class="d">${PLAYLIST_DURATIONS[i]}</span></li>`).join("");
  const live = hasUrl(OVERVIEW_URL);
  for (const id of ["overview-box", "overview-link"]) $(id).insertAdjacentHTML("beforeend", PLAY);
  $("overview-box").hidden = live;
  $("overview-link").hidden = !live;
  $("overview-watch").hidden = !live;
  if (live) { external($("overview-link"), OVERVIEW_URL); external($("overview-watch"), OVERVIEW_URL); }
  const list = $("playlist-link");
  list.hidden = !hasUrl(PLAYLIST_URL);
  if (hasUrl(PLAYLIST_URL)) external(list, PLAYLIST_URL);
}

async function renderScope() {
  try {
    const catalog = await SiteCatalog.load("data", { horizons: false });
    $("scope-lead").textContent = scopeLead(catalog);
    $("site-figures").innerHTML = siteCounts(catalog).map(([n, label]) => `<div><span class="n">${n}</span><span class="l">${esc(label)}</span></div>`).join("");
  } catch (error) {
    $("scope-lead").textContent = `Could not load data/sites.json: ${error.message}.`;
  }
  const table = $("site-table");
  if (hasUrl(REPO_URL)) {
    external(table, `${REPO_URL.replace(/\/$/, "")}/blob/main/data/sites/site_selection.csv`);
    table.hidden = false;
  }
}

async function renderEvidence() {
  try {
    const evidence = await (await fetch("data/evidence.json")).json();
    $("evidence-rows").innerHTML = evidenceRows(evidence).map((r) => {
      const result = esc(r.result.replace(/^tested/, "Tested")).replace("npm test", "<code>npm test</code>");
      const status = r.verdict === "pass" ? `<span class="rstatus pass">Pass${CHECK}</span>` : r.verdict === "reported" ? '<span class="rstatus reported">Reported</span>' : '<span class="rstatus fail">Fail</span>';
      return `<tr><td class="c">${esc(r.check)}</td><td class="a">${esc(r.against)}</td><td class="r">${result}</td><td class="a">${esc(r.limit)}</td><td>${status}</td></tr>`;
    }).join("");
  } catch (error) {
    const note = $("evidence-status");
    note.textContent = `Could not load data/evidence.json: ${error.message}.`;
    note.hidden = false;
  }
}

$("guide-pages").textContent = GUIDE_PAGE_COUNT;
hydrateLinks();
renderVideos();
renderScope();
renderEvidence();
wireAccordion();

// Rank: every candidate spot for one landing time and mission length, written as a sentence. A spot works when the
// lander survives the longest dark period and has DSN in view often enough over the whole mission (the Planner's rule), and is
// robust when it also works at the 12 nearby points; the table puts the robust spots first, then those that work at the spot
// only, then the failures.

import { Ephemeris, SiteCatalog, parseUtc, STEP_S } from "../engine/index.js";
import { sentenceText, normalizeReach, ringCount, worksText } from "./reach.js";
import { mountHelp, mountIcons } from "./planshell.js";
import { createPool } from "./pool.js";
import { ORDERS, rankCsv, rankRows } from "./rank-rows.js";
import "./theme.js";
import "./tray.js";
import { carryNav, dataLoadError, wireCopyLink } from "./shell.js";
import { PLANNING } from "./defaults.js";
import { ensureCustom } from "./customs.js";
import { loadMine } from "./myspots.js";
import { DSN_HINT, NIGHT_HINT, carryHash, darkBelowSuffix, dsnRuleOf, dsnSuffix, normalizeDarkBelow, normalizeDstation, parseState, serializeState } from "./format.js";
import { createQuestion } from "./question.js";
import { verdictHtml, esc, pinButton } from "./components.js";
import { addDays } from "./query-model.js";
import { addPin, isPinned, pinId, removePin } from "./pins.js";
import { dayLabel } from "./plan.js";
import { spanText } from "./query-model.js";

const MIN_DATE = "2024-01-02";
const MAX_DATE = "2043-01-01";
const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)}%`;

// The address keeps the app's old names: the mission length is `days`.
const URL_DEFAULTS = {
  start: PLANNING.date, time: "00:00", days: PLANNING.mission, mast: PLANNING.mast,
  rule: PLANNING.rule, dark: PLANNING.dark, link: PLANNING.link, within: PLANNING.within, dbelow: PLANNING.dbelow, dstation: PLANNING.dstation, order: "overall", best: "0",
};

let ephemeris, catalog, pool, question;
let rows = [];
let allResults = [];
let total = 0;
let runId = 0;

const parse = (hash) => { const u = parseState(hash, URL_DEFAULTS); const { days, ...rest } = u; return { ...rest, mission: days }; };
const serialize = ({ mission, ...rest }) => serializeState({ start: rest.start, time: rest.time, days: mission, mast: rest.mast, rule: rest.rule, dark: rest.dark, link: rest.link, within: rest.within, dbelow: rest.dbelow, dstation: rest.dstation, order: rest.order, best: rest.best });
const maxDark = (q) => (q.rule === "custom" ? q.dark : catalog.darknessPresets.find((p) => p.id === q.rule).hours);
const timeOk = (t) => /^\d{2}:\d{2}$/.test(t);

function normalize(q) {
  const out = { ...q };
  out.start = out.start < MIN_DATE ? MIN_DATE : out.start > MAX_DATE ? MAX_DATE : out.start;
  if (!timeOk(out.time)) out.time = "00:00";
  out.mission = Math.round(Math.min(Math.max(out.mission, 1), 120));
  out.link = Math.min(Math.max(out.link, 0), 100);
  out.dark = Math.min(Math.max(out.dark, 0), 2000);
  out.within = normalizeReach(out.within);
  out.dbelow = normalizeDarkBelow(out.dbelow);
  out.dstation = normalizeDstation(out.dstation);
  if (!catalog.mastsM.includes(out.mast)) out.mast = URL_DEFAULTS.mast;
  if (out.rule !== "custom" && !catalog.darknessPresets.some((p) => p.id === out.rule)) out.rule = URL_DEFAULTS.rule;
  if (!ORDERS.some((o) => o.id === out.order)) out.order = URL_DEFAULTS.order;
  out.best = out.best === "1" ? "1" : "0";
  return out;
}

const KEYS = { start: "date", time: "time", mission: "len", rule: "night", dark: "night", link: "dsn", mast: "mast", within: "within", dbelow: "night", dstation: "dsn" };

async function main() {
  try {
    [ephemeris, catalog] = await Promise.all([Ephemeris.load("data"), SiteCatalog.load("data")]);
  } catch (error) {
    dataLoadError(error, "rank.html");
    return;
  }
  pool = createPool(new URL("data", location.href).href, { ephemeris, catalog });
  for (const o of ORDERS) $("order").append(new Option(o.label, o.id));
  question = createQuestion({
    els: { sentence: $("sentence"), trail: $("trail"), pop: $("pop") },
    ctx: { catalog, rankHref: () => "rank.html" },
    parse, serialize, normalize,
    keyOf: (patch) => KEYS[Object.keys(patch)[0]] ?? "date",
    summary: () => (rows.length ? { robust: rows.filter((r) => r.works && r.within === 1).length, working: rows.filter((r) => r.works).length } : null),
    segments: (q) => [
      "Rank spots for touchdown on ", { key: "date", text: dayLabel(q.start) }, " at ", { key: "time", text: `${q.time} UTC` },
      " – ", { key: "len", text: `${q.mission} d` }, " mission, max night ", { key: "night", text: `${maxDark(q)} h${darkBelowSuffix(q.dbelow)}` },
      ", min DSN ", { key: "dsn", text: `${q.link > 0 ? `≥ ${q.link}%` : "none"}${dsnSuffix(q.dstation)}` }, ", mast ", { key: "mast", text: `${q.mast} m` }, ", ", { key: "within", text: sentenceText(q.within) },
    ],
    run: (q, info) => run(q, info),
  });
  $("order").value = question.state.order;
  $("best").checked = question.state.best === "1";
  for (const id of ["order", "best"]) $(id).addEventListener("change", () => { question.set({ order: $("order").value, best: $("best").checked ? "1" : "0" }); render(); });
  $("csv").addEventListener("click", () => rows.length && download(rankCsv(rows), "ranked-spots.csv"));
  wireCopyLink($("copy-link"));
  mountIcons();
  mountHelp("How to use Ranker", [
    ["Set the question", "<p>Click the orange words in the sentence to change what you are asking: the day and time, the mission length, the limits for darkness and DSN visibility, the mast height and the dispersion radius.</p>"],
    ["Read the results", "<p>Spots are ranked best first. Valid = spot + dispersion points pass the whole mission. The bar is the longest night and its marker the limit. Press the pin icon to keep a landing for Compare landings, or select a row to open it in the Planner. CLPS landers are not ranked.</p>"],
  ]);
  window.addEventListener("pinschange", () => render());
  window.addEventListener("hashchange", () => { $("order").value = question.state.order; $("best").checked = question.state.best === "1"; });
  question.start();
}

async function run(q, { before }) {
  const mine = ++runId;
  carryNav({ mast: q.mast, start: q.start, mission: q.mission, rule: q.rule, dark: q.dark, link: q.link, dbelow: q.dbelow });
  $("results").classList.add("stale");
  try {
    await compute(q, mine, before);
  } catch (error) {
    $("status").textContent = `Something went wrong: ${error.message}`;
  } finally {
    if (mine === runId) { $("results").classList.remove("stale"); $("rank-progress").hidden = true; }
  }
}

// The landing, snapped to the 15-minute step, and a mission that must end inside the ephemeris.
function landingWindow(q) {
  const [h, m] = q.time.split(":").map(Number);
  const et0 = parseUtc(`${q.start}T00:00:00`) + Math.round((h * 60 + m) / 15) * 900;
  const room = Math.floor((ephemeris.etMax - STEP_S - et0) / 86400);
  const days = Math.max(1, Math.min(q.mission, room));
  return { et0, days, clipped: days < q.mission };
}

async function compute(q, mine, before) {
  const { et0, days, clipped } = landingWindow(q);
  const t = performance.now();
  // The visitor's saved spots join the 67, once their terrain is traced (about 3 s each, kept for the session).
  const own = new Map();
  const saved = loadMine();
  for (const [k, m] of saved.entries()) {
    if (!catalog.customs.has(m.id)) $("status").textContent = `Tracing your spot ${k + 1} of ${saved.length}…`;
    if (await ensureCustom(catalog, "data", m.id)) own.set(m.id, m.name);
    if (mine !== runId) return;
  }
  const ids = [...catalog.spots.keys(), ...own.keys()];
  let done = 0;
  $("status").textContent = `Ranking ${ids.length} spots…`;
  const bar = $("rank-bar");
  bar.max = ids.length; bar.value = 0;
  $("rank-count").textContent = `Ranking spots… 0 of ${ids.length}`;
  $("rank-progress").hidden = false;
  const results = await Promise.all(ids.map(async (id) => {
    const r = await pool.run({ kind: "rank", id, mast: q.mast, et0, missionS: days * 86400, minLink: q.link / 100, maxDarkHours: maxDark(q), within: q.within, darkBelow: q.dbelow / 100, dsnRule: dsnRuleOf(q.dstation) }).catch((error) => {
      if (catalog.spots.has(id)) throw error;
      return null; // a saved spot that cannot be evaluated is left out rather than stopping the ranking
    });
    if (!r) return null;
    if (mine === runId) {
      $("status").textContent = `Ranked ${++done} of ${ids.length} spots…`;
      bar.value = done;
      $("rank-count").textContent = `Ranking spots… ${done} of ${ids.length}`;
    }
    const record = catalog.spots.get(id);
    if (!record) return { ...r, siteId: `mine:${id}`, siteName: "My points", label: own.get(id) }; // its own "site", so Best per site keeps every saved spot
    return { ...r, siteId: record.site, siteName: record.siteName };
  })).then((all) => all.filter(Boolean));
  if (mine !== runId) return;
  allResults = results;
  total = results.length;
  render(before);
  $("status").textContent = `${ids.length} candidate spots evaluated · ${days} d window from ${q.start} ${q.time} UTC (${((performance.now() - t) / 1000).toFixed(1)} s)`
    + (clipped ? " The mission is shortened where the ephemeris ends." : "");
}

// A row's result: robust, works at the spot only, or the reason it fails (the night is checked first).
const kindOf = (r, limit) => (r.works ? (r.within === 1 ? "robust" : "spot") : r.metrics.longestDarkHours > limit ? "night" : "dsn");
const pillOf = (kind) => ({ robust: ["", "Valid"], spot: ["spot", "Target spot only"], night: ["fail", "Night exceeds limit"], dsn: ["dsn", "DSN below limit"] })[kind];
const KIND_ORDER = { robust: 0, spot: 1, night: 2, dsn: 2 };

function render(before) {
  if (!allResults.length) return;
  const q = question.state;
  const limit = maxDark(q);
  rows = rankRows(allResults, { minLink: q.link / 100, maxDarkHours: limit, orderId: q.order, bestPerSite: q.best === "1" });
  if (q.order === "overall") rows.sort((a, b) => KIND_ORDER[kindOf(a, limit)] - KIND_ORDER[kindOf(b, limit)]); // stable: the overall order holds within each group
  renderVerdict(q, limit, before);
  const when = landingWindow(q);
  const day = q.start;
  const plannerFor = (spot) => {
    const hh = String(Math.floor(Number(q.time.slice(0, 2)) / 6) * 6).padStart(2, "0");
    return `planner.html${carryHash("planner.html", { spot, mast: q.mast, start: addDays(day, -20), mission: q.mission, rule: q.rule, dark: q.dark, dbelow: q.dbelow, dstation: q.dstation, link: q.link, within: q.within })}&days=61&landing=${day}T${hh}`;
  };
  const scale = Math.max(limit * 2, 1);
  const head = `<thead><tr><th scope="col" class="pincol"><span class="sr-only">Pin</span></th><th scope="col">#</th><th scope="col">Spot</th><th scope="col">Result</th><th scope="col"><abbr title="${NIGHT_HINT}">Longest night (${limit} h)</abbr></th><th scope="col"><abbr title="${DSN_HINT}">DSN${dsnSuffix(q.dstation)}</abbr></th><th scope="col">Sunlit</th><th scope="col"><abbr title="Wh per W of a Sun-tracking upright array">Energy (Wh/W)</abbr></th><th scope="col"><abbr title="How many of the dispersion points (up to the radius in the sentence) the landing is also valid at">Dispersion valid</abbr></th><th scope="col"><abbr title="Whether the landing stays valid if the terrain skyline were 0.25° higher than the map says (the map's own error). Shown only for valid spots.">+0.25° margin</abbr></th></tr></thead>`;
  const body = rows.map((r, k) => {
    const kind = kindOf(r, limit), [cls, word] = pillOf(kind);
    const dark = r.metrics.longestDarkHours;
    const name = r.label ?? r.id;
    return `<tr data-href="${plannerFor(r.id)}" tabindex="0"${r.label ? ' class="mine-row" title="One of your saved spots"' : ""}><td class="pincol">${r.works ? pinButton(name, isPinned(pinOf(r, kind, q)), `data-pin="${esc(r.id)}" data-kind="${kind}"`, "sm") : ""}</td><td>${k + 1}</td>`
      + `<th scope="row"><span class="pl-spot"><b>${esc(name)}</b><small>${r.label ? "★ My point" : esc(r.siteName)}</small></span></th>`
      + `<td><span class="pl-res ${cls}">${word}</span></td>`
      + `<td><span class="nightbar" role="img" aria-label="Longest night ${spanText(dark)}, limit ${limit} h"><i class="${dark > limit ? "over" : ""}" style="width:${Math.min(100, (dark / scale) * 100).toFixed(1)}%"></i><b style="left:${((limit / scale) * 100).toFixed(1)}%"></b></span><span class="nightnum${dark > limit ? " bad" : ""}">${spanText(dark)}</span></td>`
      + `<td class="${r.metrics.dsnLinkFraction < q.link / 100 ? "bad" : ""}">${pct(r.metrics.dsnLinkFraction)}</td>`
      + `<td>${pct(r.metrics.sunlitFraction)}</td><td>${Math.round(r.metrics.energyWhPerW)}</td><td>${r.ringOk} of ${r.ringTotal}</td><td>${r.works ? (r.holds ? "Holds" : "Fails") : "–"}</td></tr>`;
  }).join("");
  $("table").innerHTML = `${head}<tbody>${body}</tbody>`;
  $("rank-foot").textContent = `Valid = spot + ${ringCount(q.within)} dispersion points (≤ ${q.within} m) pass the whole mission · Bar: longest night, marker: limit · CLPS landers excluded · Select a row to open in Planner.`;
  $("table").onclick = (event) => {
    const pin = event.target.closest("button[data-pin]");
    if (pin) {
      const r = rows.find((x) => x.id === pin.dataset.pin);
      if (r) { const p = pinOf(r, pin.dataset.kind, question.state); if (isPinned(p)) removePin(pinId(p)); else { const res = addPin(p); if (!res.ok && res.reason === "full") $("status").textContent = "You can pin 4 landings. Remove one from the tray first."; } render(); }
      return;
    }
    const row = event.target.closest("tr[data-href]");
    if (row && !event.target.closest("a")) location.href = row.dataset.href;
  };
  $("table").onkeydown = (event) => {
    if (event.target.closest("button")) return;
    const row = event.target.closest("tr[data-href]");
    if (row && event.key === "Enter") location.href = row.dataset.href;
  };
  const top = rows.find((r) => kindOf(r, limit) === "robust") ?? rows.find((r) => r.works) ?? rows[0];
  if (top) {
    $("planner-link").href = plannerFor(top.id);
    $("planner-link").textContent = `Open ${top.label ?? top.id} in Planner`;
    $("slip-link").href = `windows.html${carryHash("windows.html", { spot: top.id, mast: q.mast, start: q.start, mission: q.mission, rule: q.rule, dark: q.dark, dbelow: q.dbelow, dstation: q.dstation, link: q.link, within: q.within })}`;
  }
  void when;
}

// The pin this row would be: the landing at the chosen date and hour, with the question Rank answered.
const hourOf = (q) => `${q.start}T${q.time.slice(0, 2)}`;
const pinOf = (r, kind, q) => ({ spot: r.id, landing: hourOf(q), mast: q.mast, mission: q.mission, rule: q.rule, dark: q.dark, dbelow: q.dbelow, dstation: q.dstation, link: q.link, within: q.within, goal: "earliest", start: q.start, days: 1, kind });
function renderVerdict(q, limit, before) {
  const kinds = rows.map((r) => kindOf(r, limit));
  const robust = kinds.filter((k) => k === "robust").length, spotOnly = kinds.filter((k) => k === "spot").length;
  const when = `${dayLabel(q.start)}, ${q.time} UTC`;
  const first = (kind) => rows[kinds.indexOf(kind)];
  const holding = rows.filter((r, i) => kinds[i] === "robust" && r.holds).length;
  const radius = q.within ? `full ${q.within} m dispersion` : "at the target spot";
  const best = first("robust") ?? first("spot") ?? rows[0];
  const title = `${when} – ${robust} spot${robust === 1 ? "" : "s"} pass${robust === 1 ? "es" : ""} ${radius}${spotOnly && q.within ? ` (${spotOnly} valid at target spot only)` : ""}`;
  let model;
  if (robust) model = { state: "ok", title, reason: `Top candidate: ${best.label ?? best.id}, longest night ${spanText(best.metrics.longestDarkHours)} against ${limit} h. ${holding} of the ${robust} still pass with a +0.25° horizon margin (DEM uncertainty check).` };
  else if (spotOnly) model = { state: "info", title, reason: `Top candidate: ${best.label ?? best.id} passes at the nominal coordinate (${best.ringOk} of ${best.ringTotal} dispersion points valid).` };
  else model = { state: "bad", title: `${when} – No spot is valid`, reason: best ? `The closest is ${best.label ?? best.id}, longest night ${spanText(best.metrics.longestDarkHours)} against ${limit} h and DSN visibility ${pct(best.metrics.dsnLinkFraction)}.` : "There are no spots to rank." };
  let delta = "";
  if (before && question.state && robust !== before.robust) delta = `Compared with before: ${robust} valid spot${robust === 1 ? "" : "s"} instead of ${before.robust}.`;
  else if (before) delta = "Compared with before: no change.";
  $("verdict").innerHTML = verdictHtml(model, { delta });
}

function download(text, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

main();

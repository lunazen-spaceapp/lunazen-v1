// The shared pieces of the planning pages, as functions from data to HTML text: the query sentence, the
// trail, the verdict banner, the landing heatmap, the dispersion ring, the metric tiles and the run list. Strings only, so
// they are tested in Node; the pages put them in the document and wire the events.

import { HEAT_BLOCK_DAYS, HOURS, cellKind, marginHours, shortWhen, spanText, whenText } from "./query-model.js";
import { dayLabel } from "./plan.js";
import { DSN_HINT, NIGHT_HINT, SUN_HIGHEST_HINT, SUN_HIGHEST_LABEL, darkBelowSuffix, degText, dsnSuffix, hintHtml } from "./format.js";
import { normalizeReach, ringCount, testText, workText, worksText } from "./reach.js";

export const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ICONS = {
  down: '<path d="m6 9 6 6 6-6"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  warn: '<path d="M12 3 2.5 20h19Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  pin: '<path d="M15 2.7 21.3 9 18.9 9.9 15.3 13.5 15.9 18 14.1 19.8 9.9 15.6 4.5 21 3 19.5 8.4 14.1 4.2 9.9 6 8.1 10.5 8.7 14.1 5.1Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
// The 16 px outline icons of the Plan pages' icon-only buttons: the export arrow, the calendar and the pushpin.
const ICONS16 = {
  csv: '<path d="M8 2V10M4.5 6.8 8 10.3 11.5 6.8M2.5 12V13.8H13.5V12"/>',
  cal: '<rect x="2.5" y="3.5" width="11" height="10"/><path d="M2.5 6.5H13.5M5.5 2V4.5M10.5 2V4.5"/>',
  pin: '<path d="M10 1.8 14.2 6 12.6 6.6 10.2 9 10.6 12 9.4 13.2 6.6 10.4 3 14 2 13 5.6 9.4 2.8 6.6 4 5.4 7 5.8 9.4 3.4Z"/>',
};
export const icon16 = (name) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS16[name]}</svg>`;

// Every export is an icon-only button (the download arrow = CSV, the calendar = calendar file); the label is spoken and shown as a tooltip.
const EXPORTS = { csv: "Export CSV", ics: "Export to calendar" };
export const exportButton = (kind, id) => `<button type="button" id="${id}" class="exp-ico" aria-label="${EXPORTS[kind]}" title="${EXPORTS[kind]}">${icon16(kind === "csv" ? "csv" : "cal")}</button>`;

// The pin button of a landing: an outlined pushpin, tinted when pinned. spot: the name in its label.
export const pinButton = (spot, pinned, attrs = "", cls = "") => {
  const label = spot ? `Pin ${spot}` : "Pin this landing";
  return `<button type="button" class="pl-pin${cls ? ` ${cls}` : ""}" ${attrs} aria-pressed="${pinned}" aria-label="${esc(pinned ? `Unpin ${spot ?? "this landing"}` : label)}" title="${esc(pinned ? `Unpin ${spot ?? "this landing"}` : label)}">${icon16("pin")}</button>`;
};

export const icon = (name, cls = "") => `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---- query sentence and trail (§4.1)

// segments: strings and { key, text } tokens. changed: the key of the token changed last (outlined until the next change).
export function sentenceHtml(segments, changed = null) {
  const parts = segments.map((s) => (typeof s === "string" ? esc(s)
    : `<button type="button" class="lz-tok${changed === s.key ? " changed" : ""}" data-tok="${s.key}" aria-haspopup="dialog" aria-expanded="false">${esc(s.text)}${icon("down")}</button>`));
  return parts.join("");
}

// trail: [{ label }]; at: the index of the step shown now. With one step there is nothing to go back to, so nothing is drawn.
export function trailHtml(trail, at) {
  if (trail.length < 2) return "";
  const steps = trail.map((s, i) => `${i ? '<span class="sep" aria-hidden="true">›</span>' : ""}<button type="button" data-trail="${i}"${i === at ? ' aria-current="step"' : ""} aria-label="${i === at ? `Current step: ${esc(s.label)}` : `Go back to: ${esc(s.label)}`}">${esc(s.label)}</button>`).join("");
  return `<span class="trail-lead">Your changes:</span>${steps}`;
}

// ---- verdict banner (§4.2)

export function verdictHtml({ state, title, reason }, { delta = "", actions = "" } = {}) {
  return `<div class="lz-verdict ${state}" role="status">${icon(state, "ic")}<div class="body"><div class="t">${esc(title)}</div><div class="s">${esc(reason)}</div></div>`
    + `${actions ? `<div class="acts">${actions}</div>` : ""}${delta ? `<p class="delta">${esc(delta)}</p>` : ""}</div>`;
}

// ---- landing heatmap (§4.3)

const cellWordsOf = (within) => ({ robust: worksText(within), spot: "valid at the target spot only", night: "fail, night exceeds limit", dsn: "fail, DSN visibility below threshold" });
export const cellWords = (kind, within) => cellWordsOf(within)[kind];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// grid: heatGrid(); rows: the landing rows (for the labels); selected: the row index shown now. A range longer than
// `block` days is drawn as stacked blocks, each with its own month labels and the four times of day, so a year fits the width.
export function heatmapHtml(grid, rows, selected, block = HEAT_BLOCK_DAYS, within) {
  const words = cellWordsOf(within);
  const one = (cols, first) => {
    const monthAt = cols.map((col, d) => d === 0 || col.day.endsWith("-01")).map((on, d) => (on ? d : -1)).filter((d) => d >= 0);
    const head = cols.map((col, d) => {
      const day = Number(col.day.slice(8, 10));
      const text = monthAt.includes(d) ? MONTHS[Number(col.day.slice(5, 7)) - 1] : day % 5 === 0 && monthAt.every((m) => Math.abs(m - d) >= 4) ? String(day) : ""; // numbers keep clear of the month names
      return `<div class="hl" aria-hidden="true">${text}</div>`;
    }).join("");
    const body = HOURS.map((h, r) => `<div class="rl" aria-hidden="true">${String(h).padStart(2, "0")}:00</div>` + cols.map((col) => {
      const c = col.cells[r];
      if (!c) return `<div class="c none" aria-hidden="true"></div>`;
      const t = `${dayLabel(col.day)} ${String(h).padStart(2, "0")}:00 UTC`;
      return `<button type="button" class="c ${c.kind}${c.index === selected ? " sel" : ""}" data-i="${c.index}" tabindex="${c.index === selected ? 0 : -1}" aria-label="${t}, ${words[c.kind]}" aria-pressed="${c.index === selected}"></button>`;
    }).join("")).join("");
    const width = grid.length > block && cols.length < block ? ` width:calc(38px + (100% - 38px) * ${cols.length} / ${block});` : ""; // the last block of a long range lines up with the others
    return `<div class="lz-heat" ${first ? 'role="group" aria-label="Landing times, one column per day, four rows per day"' : 'role="group" aria-label="More landing times"'} style="--days:${cols.length};${width}"><div></div>${head}${body}</div>`;
  };
  const blocks = [];
  for (let i = 0; i < grid.length; i += block) blocks.push(grid.slice(i, i + block));
  return blocks.map((cols, k) => one(cols, k === 0)).join("");
}

// Share of spot-days that pass each miss distance at the default rule, 2026-2029 (measured: see the Delay impact grid and pipeline/miss_distance_shares.mjs).
const RARITY = { 0: "about a third", 50: "~14%", 100: "~5%" };
export const legendHtml = (within) => {
  const near = ringCount(within);
  const robust = `<span><i class="c robust"></i>${near ? `Pass: Spot + ${near} dispersion points (≤ ${normalizeReach(within)} m)` : "Pass: Target spot"}</span>`;
  const spot = near ? '<span><i class="c spot"></i>Pass: Target spot only</span>' : "";
  return `<div class="lz-legend">${robust}${spot}<span><i class="c night"></i>Fail: Night exceeds limit</span><span><i class="c dsn"></i>Fail: DSN visibility below threshold</span></div>`;
};

// The line under the grid: what a full pass needs, how rare it is at the default rule, and what was evaluated.
export function gridFootnote(within, epochs, points, seconds) {
  const near = ringCount(within);
  const need = near ? `Full dispersion requires all ${1 + near} points (spot + ${near} offsets) to pass across the entire mission (${RARITY[normalizeReach(within)]} baseline pass rate)` : `A landing passes when the target spot passes across the entire mission (${RARITY[0]} baseline pass rate)`;
  return `${need} · ${epochs} epochs × ${points} points evaluated in ${seconds} s.`;
}

// ---- dispersion ring (§4.5)

// What the ring diagram counts, in words: the nominal target plus the offsets of the chosen radius.
export function ringExplain(within) {
  const m = normalizeReach(within), near = ringCount(m);
  const offsets = { 0: "", 50: "6 at 50 m", 100: "6 at 50 m, 6 at 100 m" }[m];
  return near ? `evaluated across the nominal target plus ${near} radial offsets (${offsets}). Solid green markers pass all mission constraints; hollow orange markers exceed the night or DSN limits.` : "evaluated at the nominal target only. A solid green marker passes all mission constraints; a hollow orange marker exceeds the night or DSN limits.";
}
export const ringCaption = (within) => ({ 0: "Target spot only", 50: "50 m dispersion ring", 100: "50 m · 100 m dispersion rings" })[normalizeReach(within)];
export const ringSummary = (row) => `${row.points.filter((p) => p.ok).length} of ${row.points.length} touchdown points valid`;

// row.points: the spot first, then its 12 dispersion points; offsets: their [east, north] metres in the same order.
export function ringHtml(row, offsets, within) {
  offsets = offsets.slice(0, ringCount(within)); // the points this miss distance tests
  const size = 220, half = size / 2, reach = Math.max(100, ...offsets.map(([e, n]) => Math.hypot(e, n)));
  const k = (half - 14) / reach;
  const dot = (e, n, p, r, label) => `<circle class="${p.ok ? "rd-ok" : "rd-no"}" cx="${(half + e * k).toFixed(1)}" cy="${(half - n * k).toFixed(1)}" r="${r}"><title>${label}: ${p.ok ? "valid" : "fail"}</title></circle>`;
  const dots = offsets.map(([e, n], i) => dot(e, n, row.points[i + 1], 7, `${Math.round(Math.hypot(e, n))} m away`)).join("");
  const working = row.points.filter((p) => p.ok).length;
  const ringAt = (m) => `<circle class="rd-edge" cx="${half}" cy="${half}" r="${(m * k).toFixed(1)}"/>`;
  return `<figure class="lz-ringfig"><svg class="lz-ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="The target spot and the ${row.points.length - 1} dispersion points around it: ${working} of ${row.points.length} touchdown points valid">${[50, 100].filter((m) => m <= normalizeReach(within)).map(ringAt).join("")}${dots}${dot(0, 0, row.points[0], 8.5, "The target spot")}</svg><figcaption>${ringCaption(within)}</figcaption></figure>`
    + `<p class="ring-text"><b>${working} of ${row.points.length} touchdown points valid</b>, ${ringExplain(within)}</p>`;
}

// ---- metric tiles (§4.7)

// The first change of a body in the mission: its first set if it is up at landing, its first rise if it is down ("Not in the
// mission" when the window holds none).
function eventTile({ up, setH, riseH, setName, riseName }) {
  const h = up ? setH : riseH;
  const value = h === null || h === undefined ? "Not in the mission" : h === 0 ? "At landing" : `+${spanText(h)} <small>after touchdown</small>`;
  return `<div class="lz-tile"><div class="k">First ${up ? setName : riseName}</div><div class="v">${value}</div></div>`;
}

// facts: events.js missionFacts; rule: { maxDarkHours, minLinkFraction }; the tile that breaks the brief is coloured.
export function tilesHtml(facts, rule) {
  const tile = (k, v, bad = false) => `<div class="lz-tile${bad ? " bad" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const night = facts.longestNightH;
  const need = Math.round(rule.minLinkFraction * 100);
  return `<div class="lz-tiles compact">`
    + eventTile({ up: facts.sunUpAtLanding, setH: facts.firstSunsetH, riseH: facts.firstSunriseH, setName: "sunset", riseName: "sunrise" })
    + eventTile({ up: facts.earthUpAtLanding, setH: facts.firstEarthsetH, riseH: facts.firstEarthriseH, setName: "Earthset", riseName: "Earthrise" })
    + tile(`Longest night${darkBelowSuffix(rule.dbelow)} ${hintHtml(NIGHT_HINT)}`, `${night < 0.5 ? "None" : spanText(night)} <small>/ ${rule.maxDarkHours} h limit</small>`, night > rule.maxDarkHours)
    + tile("Longest DSN gap", `${spanText(facts.longestNoLinkH)} <small>no DSN station in view</small>`)
    + tile(`DSN visibility${dsnSuffix(rule.dstation)} ${hintHtml(DSN_HINT)}`, `${Math.round(facts.linkShare * 100)}% <small>/ ${need ? `≥ ${need}% target` : "no minimum"}</small>`, facts.linkShare < rule.minLinkFraction - 1e-9)
    + (facts.sunHighest === null || facts.sunHighest === undefined ? "" : tile(`${SUN_HIGHEST_LABEL} <button type="button" class="hint" data-hint="${esc(SUN_HIGHEST_HINT)}">ⓘ</button>`, `${degText(facts.sunHighest)}${facts.sunClears ? ` <small>${esc(facts.sunClears)}</small>` : ""}`))
    + `</div>`;
}

// ---- run list (§4.7)

// runs: sorted runs from query-model; selectedRun: the index (in `runs`) of the run holding the selected landing, or -1.
export function runListHtml(runs, rows, rule, selectedRun, limit = 8) {
  const shown = runs.slice(0, limit);
  const body = shown.map((r, k) => {
    const holds = r.holds === r.count ? '<span class="holds">Holds</span>' : r.holds === 0 ? '<span class="fails">Fails</span>' : `<span class="part">Holds at ${r.holds} of ${r.count}</span>`;
    return `<tr data-run="${k}" tabindex="0" class="${k === selectedRun ? "sel" : ""}"><td>${shortWhen(r.startEt)} to ${shortWhen(r.endEt)}</td><td class="num">${r.count}</td><td class="num">${spanText(r.margin)}</td><td>${holds}</td></tr>`;
  }).join("");
  return `<div class="scrollx"><table class="lz-runs"><thead><tr><th scope="col">Window (UTC)</th><th scope="col" class="num">Epochs</th><th scope="col" class="num">Night margin</th><th scope="col">+0.25° margin</th></tr></thead><tbody>${body}</tbody></table></div>`
    + (runs.length > limit ? `<p class="lz-note">Showing ${limit} of ${runs.length} windows.</p>` : "");
}

// ---- constraint relaxation (§4.4)

// items: [{ title, sub, key } | { text }]: a button when it has a key (the change applies as a new step), plain text otherwise.
export function takeHtml(items) {
  const body = items.map((it) => (it.key
    ? `<button type="button" class="lz-take" data-take="${it.key}"><span class="h">${esc(it.title)}</span><span class="s">${esc(it.sub)}</span></button>`
    : `<div class="lz-take plain"><span class="h">${esc(it.title)}</span><span class="s">${esc(it.sub)}</span></div>`)).join("");
  return `<div class="lz-takes">${body}</div>`;
}

export { whenText, cellKind, marginHours };

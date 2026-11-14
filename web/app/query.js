// The query sentence's tokens and their pop-over editors. A token is a button in a plain-English
// sentence; clicking it opens a small editor under it. Applying a change calls apply(patch, label) and the page reruns
// the question. The editors close on Escape, on an outside click and after applying, and return focus to the token.

import { createPicker } from "./picker.js";
import { createSaveSpot } from "./savespot.js";
import { loadMine } from "./myspots.js";
import { CLPS_GROUP_NAME, BEYOND_GROUP_NAME } from "./picker.js";
import { rangeEnd, setRange, GOALS } from "./query-model.js";
import { esc } from "./components.js";
import { DARK_BELOW_OPTIONS, DSN_HINT } from "./format.js";
import { REACHES } from "./reach.js";

const MIN_DATE = "2024-01-02";
const MAX_DATE = "2043-01-01";

// The Explorer's spot picker: a list under the sentence, My points first, then every spot under its site's name (and the landers and the sites away
// from the pole at the end), each row at least 40 px tall. ctx.spotList: { siteNameOf(id) } names the site of a saved point.
function spotListEditor(q, ctx, node, choose) {
  const row = (id, inner, selected) => `<button type="button" class="spot-opt${selected ? " sel" : ""}" role="option" data-v="${esc(id)}" aria-selected="${selected}">${inner}${selected ? '<span class="tick" aria-hidden="true">✓</span>' : ""}</button>`;
  const saved = loadMine();
  let html = `<div class="spotlist" role="listbox" aria-label="Spot">`;
  if (saved.length) {
    html += `<p class="spot-group mine">My points</p>${saved.map((m) => row(m.id, `<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 L13 7 L7 13 L1 7 Z" fill="currentColor" stroke="var(--bg)" stroke-width="1.5"/></svg><span class="name"><strong>${esc(m.name)}</strong> <span class="site">${ctx.spotList.siteNameOf(m.id) ? `· ${esc(ctx.spotList.siteNameOf(m.id))}` : ""}</span></span>`, q.spot === m.id)).join("")}`;
  }
  for (const site of ctx.catalog.sites) html += `<p class="spot-group">${esc(site.name)}</p>${site.spots.map((id) => row(id, `<span class="name">${esc(id)}</span>`, q.spot === id)).join("")}`;
  if (ctx.pickerOptions?.includeMissions && ctx.catalog.missions.size) html += `<p class="spot-group">${CLPS_GROUP_NAME}</p>${[...ctx.catalog.missions.values()].map((m) => row(m.id, `<span class="name">${esc(m.name)}<span class="site"> · landed ${esc(m.landedUtc.slice(0, 10))}</span></span>`, q.spot === m.id)).join("")}`;
  if (ctx.pickerOptions?.includeBeyond && ctx.catalog.beyond?.sites.length) html += `<p class="spot-group">${BEYOND_GROUP_NAME}</p>${ctx.catalog.beyond.sites.map((b) => row(b.id, `<span class="name">${esc(b.name)}<span class="site"> · ${esc(b.landedDate.slice(0, 4))}</span></span>`, q.spot === b.id)).join("")}`;
  node.innerHTML = `${html}</div>`;
  node.addEventListener("click", (e) => { const o = e.target.closest(".spot-opt"); if (o) choose({ spot: o.dataset.v }, o.dataset.v); });
  node.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...node.querySelectorAll(".spot-opt")];
    const k = all.indexOf(document.activeElement);
    all[Math.min(Math.max(k + (e.key === "ArrowDown" ? 1 : -1), 0), all.length - 1)]?.focus();
    e.preventDefault();
  });
  return { node, focus: node.querySelector(".spot-opt.sel") ?? node.querySelector(".spot-opt") };
}

// One editor body for a token. q: the current state; ctx: { catalog, apply(patch, label), rankHref, close }.
// Returns { node, focus } (what to focus when it opens).
function editorFor(key, q, ctx) {
  const node = document.createElement("div");
  const opt = (value, label, sub = "", pressed = false) => `<button type="button" class="opt" data-v="${esc(value)}" aria-pressed="${pressed}">${esc(label)}${sub ? `<small>${sub}</small>` : ""}</button>`;
  const numberRow = (id, value, { min, max, step = 1, unit = "" }) => `<div class="row-inline"><input type="number" id="${id}" data-in min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Other value"> ${unit}<button type="button" class="lz-btn small primary" data-apply>Apply</button></div>`;
  const choose = (patch, label) => { ctx.close(); ctx.apply(patch, label); };
  const field = ctx.dateField ?? "start"; // the state field that holds a single date

  if (key === "goal") {
    node.innerHTML = `<div class="label">What should the answer be?</div><div class="opts">${GOALS.map((g) => opt(g.id, g.name, esc(g.about), q.goal === g.id)).join("")}</div>`;
    node.addEventListener("click", (e) => { const o = e.target.closest(".opt"); if (o) choose({ goal: o.dataset.v }, "Goal"); });
  } else if (key === "spot" && ctx.spotList) {
    return spotListEditor(q, ctx, node, choose);
  } else if (key === "spot") {
    node.innerHTML = `<div class="label">${esc(ctx.spotHeading ?? "Target spot")}</div><div class="spot-picker"></div><p class="row-inline"><button type="button" class="lz-btn primary" data-use>Use this spot</button><button type="button" class="lz-btn" data-cancel>Cancel</button></p><div class="save-spot"></div><p class="lz-note trace-note" role="status"></p><p class="lz-note">To search every spot for one date, use <a href="${esc(ctx.rankHref)}">Rank</a>.</p>`;
    const picker = createPicker(node.querySelector(".spot-picker"), ctx.catalog, { compact: true, deferSite: true, ...(ctx.pickerOptions ?? {}), onBusy: (text) => { node.querySelector(".trace-note").textContent = text; }, onChange: (id) => choose({ spot: id }, id) });
    picker.set(q.spot);
    node.querySelector("[data-use]").addEventListener("click", () => { if (picker.value === q.spot) ctx.close(); else picker.commit(); });
    node.querySelector("[data-cancel]").addEventListener("click", () => ctx.cancel());
    const save = createSaveSpot(node.querySelector(".save-spot"), (id) => picker.set(id));
    save.update(q.spot);
    return { node, focus: node.querySelector("select") };
  } else if (key === "from" || key === "to") {
    const end = rangeEnd(q.start, q.days);
    node.innerHTML = `<div class="label">${key === "from" ? "Earliest" : "Latest"} landing date (UTC)</div><div class="row-inline"><input type="date" data-in min="${MIN_DATE}" max="${MAX_DATE}" value="${key === "from" ? q.start : end}" aria-label="Date"><button type="button" class="lz-btn small primary" data-apply>Apply</button></div><p class="lz-note">A range is at most a year (366 days). For a spot against every day of a year, use If the date slips.</p>`;
    node.addEventListener("click", (e) => {
      if (!e.target.closest("[data-apply]")) return;
      const v = node.querySelector("[data-in]").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const day = v < MIN_DATE ? MIN_DATE : v > MAX_DATE ? MAX_DATE : v;
      choose(key === "from" ? setRange(day, end < day ? day : end) : setRange(q.start, day), "Dates");
    });
  } else if (key === "date") {
    node.innerHTML = `<div class="label">Landing date (UTC)</div><div class="row-inline"><input type="date" data-in min="${MIN_DATE}" max="${MAX_DATE}" value="${q[field]}" aria-label="Date"><button type="button" class="lz-btn small primary" data-apply>Apply</button></div>`;
    node.addEventListener("click", (e) => {
      if (!e.target.closest("[data-apply]")) return;
      const v = node.querySelector("[data-in]").value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) choose({ [field]: v < MIN_DATE ? MIN_DATE : v > MAX_DATE ? MAX_DATE : v }, "Date");
    });
  } else if (key === "time") {
    node.innerHTML = `<div class="label">Landing time (UTC)</div><div class="opts">${["00:00", "06:00", "12:00", "18:00"].map((v) => opt(v, `${v} UTC`, "", q.time === v)).join("")}</div><div class="label sep">Or a time on the 15-minute step</div><div class="row-inline"><input type="time" data-in step="900" value="${q.time}" aria-label="Time"><button type="button" class="lz-btn small primary" data-apply>Apply</button></div>`;
    node.addEventListener("click", (e) => {
      const o = e.target.closest(".opt");
      const v = o ? o.dataset.v : e.target.closest("[data-apply]") ? node.querySelector("[data-in]").value : "";
      if (/^\d{2}:\d{2}$/.test(v)) choose({ time: v }, "Time");
    });
  } else if (key === "days") {
    node.innerHTML = `<div class="label">How long to look at</div><div class="opts">${(ctx.dayPresets ?? [7, 14, 30, 90]).map((v) => opt(v, `${v} days`, "", q.days === v)).join("")}</div><div class="label sep">Or enter days</div>${numberRow("in-days", q.days, { min: 1, max: ctx.maxDays ?? 365, unit: "days" })}`;
    node.addEventListener("click", (e) => {
      const o = e.target.closest(".opt");
      const v = o ? Number(o.dataset.v) : e.target.closest("[data-apply]") ? Number(node.querySelector("[data-in]").value) : NaN;
      if (v >= 1 && v <= (ctx.maxDays ?? 365)) choose({ days: Math.round(v) }, "Length");
    });
  } else if (key === "len") {
    node.innerHTML = `<div class="label">Mission length</div><div class="opts">${[3, 7, 14, 28].map((v) => opt(v, `${v} days`, "", q.mission === v)).join("")}</div><div class="label sep">Or enter days</div>${numberRow("in-len", q.mission, { min: 1, max: 120, unit: "days" })}`;
    node.addEventListener("click", (e) => {
      const o = e.target.closest(".opt");
      const v = o ? Number(o.dataset.v) : e.target.closest("[data-apply]") ? Number(node.querySelector("[data-in]").value) : NaN;
      if (v >= 1 && v <= 120) choose({ mission: Math.round(v) }, "Length");
    });
  } else if (key === "night") {
    const presets = ctx.catalog.darknessPresets;
    node.innerHTML = `<div class="label">Darkness limit</div><div class="opts">${presets.map((p) => opt(p.id, p.option ?? `${p.hours} h`, `${esc(p.quote ?? p.basis)} <a href="${esc(p.source)}">Source</a>`, q.rule === p.id)).join("")}</div>`
      + (presets.find((p) => p.note) ? `<p class="lz-note">${esc(presets.find((p) => p.note).note)}</p>` : "")
      + `<div class="label sep">Or your own number of hours</div>${numberRow("in-night", q.rule === "custom" ? q.dark : "", { min: 0, max: 2000, unit: "h" })}<p class="lz-note">A limit is a tolerance, not a power model: passing it does not mean a lander has enough power.</p>`
      + `<div class="label sep">Count as dark when less than … of the Sun is visible</div><div class="opts">${DARK_BELOW_OPTIONS.map((v) => `<button type="button" class="opt" data-dbelow="${v}" aria-pressed="${(q.dbelow ?? 0) === v}">${v ? `${v}% of the Sun` : "Any part of the Sun"}</button>`).join("")}</div><p class="lz-note">Any part (the default) gives the shortest possible nights. A higher threshold counts the thin slivers of Sun before sunset and after sunrise as dark too, which lengthens the longest night.</p>`;
    node.addEventListener("click", (e) => {
      const d = e.target.closest("[data-dbelow]");
      if (d) return choose({ dbelow: Number(d.dataset.dbelow) }, "Dark threshold");
      const o = e.target.closest(".opt");
      if (o && !e.target.closest("a")) return choose({ rule: o.dataset.v }, "Night limit");
      if (e.target.closest("[data-apply]")) {
        const v = Number(node.querySelector("[data-in]").value);
        if (node.querySelector("[data-in]").value !== "" && v >= 0 && v <= 2000) choose({ rule: "custom", dark: v }, "Night limit");
      }
    });
  } else if (key === "dsn") {
    node.innerHTML = `<div class="label">Minimum DSN visibility</div><div class="opts">${[0, 25, 50, 75].map((v) => opt(v, v ? `At least ${v}%` : "No requirement", "", q.link === v)).join("")}</div><div class="label sep">Or another share</div>${numberRow("in-dsn", q.link, { min: 0, max: 100, unit: "%" })}<p class="lz-note">${DSN_HINT}</p>`
      + `<div class="label sep">DSN line of sight</div><div class="opts">${[[0, "Any part of Earth (default)"], [1, "The station itself"]].map(([v, text]) => `<button type="button" class="opt" data-dstation="${v}" aria-pressed="${(q.dstation ?? 0) === v}">${text}</button>`).join("")}</div><p class="lz-note">Any part of Earth: Earth's disk is partly above the skyline and a complex sees the Moon. The station itself: the lander must see the DSN complex, a point on Earth's disk, above its skyline; this lowers DSN visibility when Earth is partly hidden, for example from 54.8% to 50.3% at Site01-1 in 2027.</p>`;
    node.addEventListener("click", (e) => {
      const d = e.target.closest("[data-dstation]");
      if (d) return choose({ dstation: Number(d.dataset.dstation) }, "DSN line of sight");
      const o = e.target.closest(".opt");
      const v = o ? Number(o.dataset.v) : e.target.closest("[data-apply]") ? Number(node.querySelector("[data-in]").value) : NaN;
      if (v >= 0 && v <= 100) choose({ link: Math.round(v) }, "DSN");
    });
  } else if (key === "mast") {
    node.innerHTML = `<div class="label">Mast height (sensor or antenna)</div><div class="opts">${ctx.catalog.mastsM.map((v) => opt(v, `${v} m`, "", q.mast === v)).join("")}</div><p class="lz-note">Mast height changes the result about as much as the landing position does.</p>`;
    node.addEventListener("click", (e) => { const o = e.target.closest(".opt"); if (o) choose({ mast: Number(o.dataset.v) }, "Mast"); });
  } else if (key === "within") {
    node.innerHTML = `<div class="label">Dispersion radius</div><div class="opts">${REACHES.map((r) => opt(r.m, r.name, esc(r.about), q.within === r.m)).join("")}</div><p class="lz-note">A landing is valid only if the spot and every dispersion point up to that radius pass for the whole mission. Tested at 12 sample points on two rings (6 at 50 m, 6 at 100 m), not a full landing ellipse. Real landers have often missed by more than 100 m.</p>`;
    node.addEventListener("click", (e) => { const o = e.target.closest(".opt"); if (o) choose({ within: Number(o.dataset.v) }, "Miss distance"); });
  }
  return { node, focus: node.querySelector('[aria-pressed="true"]') ?? node.querySelector("[data-in]") ?? node.querySelector("button") };
}

// popEl: the (hidden) pop-over element; sentenceEl: where the tokens are. getState() -> the current state;
// ctx: { catalog, apply(patch, label), rankHref() }.
export function createTokens({ sentenceEl, popEl, getState, ctx }) {
  let open = null; // { key, anchor }
  const close = ({ focus = true } = {}) => {
    if (!open) return;
    const { anchor } = open;
    popEl.hidden = true;
    popEl.replaceChildren();
    anchor.setAttribute("aria-expanded", "false");
    open = null;
    if (focus && anchor.isConnected) anchor.focus();
  };
  const show = (anchor) => {
    const key = anchor.dataset.tok;
    if (open?.anchor === anchor) return close();
    close({ focus: false });
    const { node, focus } = editorFor(key, getState(), { ...ctx, rankHref: ctx.rankHref(), close: () => { close({ focus: false }); }, cancel: () => close() });
    popEl.replaceChildren(node);
    popEl.dataset.kind = key === "spot" && ctx.spotList ? "spot-list" : key;
    popEl.hidden = false;
    anchor.setAttribute("aria-expanded", "true");
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - popEl.offsetWidth - 8));
    popEl.style.left = `${left}px`;
    popEl.style.top = `${window.scrollY + r.bottom + 6}px`;
    open = { key, anchor };
    focus?.focus();
  };
  sentenceEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tok]");
    if (b) { e.stopPropagation(); show(b); }
  });
  document.addEventListener("click", (e) => { if (open && !popEl.contains(e.target) && !e.target.closest("[data-tok]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) close(); });
  return { close, current: () => open?.key ?? null };
}

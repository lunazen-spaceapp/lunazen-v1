// Two-level site picker shared by the Explorer, Planner and Compare: first a NASA candidate
// site (or the CLPS landings), then one of its spots. Two plain native selects, so it stays
// keyboard-, screen-reader- and phone-friendly. The value is a spot or mission id, as before,
// so existing links keep working.

import { isCustomId } from "../engine/index.js";
import { ensureCustom } from "./customs.js";
import { MAX_MINE, loadMine, mineLatLon } from "./myspots.js";

const pct = (v) => `${Math.round(v * 100)}%`;
export const CLPS = "clps";
export const CUSTOM = "custom";
export const BEYOND = "beyond"; // landing sites away from the pole (global map terrain)
export const CLPS_GROUP_NAME = "CLPS landings";
export const BEYOND_GROUP_NAME = "Beyond the pole (approximate terrain)";

// The first-level key for a spot or mission id: a site id, "clps", or "" if unknown.
export function siteOf(catalog, id) {
  if (catalog.missions.has(id)) return CLPS;
  if (catalog.customs?.has(id)) return catalog.customs.get(id).group === "beyond" ? BEYOND : CUSTOM;
  if (isCustomId(id)) return CUSTOM; // a saved or linked point, traced when chosen
  return catalog.spots.get(id)?.site ?? "";
}

function year(catalog, id) {
  return catalog.yearMetrics(catalog.spots.get(id));
}

// True for a spot or mission id the planning pages can use: not a landing site away from the pole.
export const plannable = (catalog, id) => Boolean(catalog.spotRecord(id)) && !isBeyond(catalog, id);
export const isBeyond = (catalog, id) => catalog.customs?.get(id)?.group === "beyond";

// The visitor's saved spots (named), then any other custom point already open from a link.
const customs = (catalog) => {
  const saved = loadMine();
  const linked = [...(catalog.customs?.values() ?? [])].filter((c) => c.group !== "beyond" && !saved.some((m) => m.id === c.id));
  return [...saved, ...linked.map((c) => ({ id: c.id, name: "From a link" }))];
};

export function siteOptions(catalog, { includeMissions = false, includeBeyond = false, allowNone = false } = {}) {
  const options = allowNone ? [{ value: "", label: "(none)" }] : [];
  for (const s of catalog.sites) {
    const best = Math.max(...s.spots.map((id) => year(catalog, id).sunlitFraction));
    options.push({ value: s.id, label: `${s.name} · up to ${pct(best)} Sun` });
  }
  if (includeMissions) options.push({ value: CLPS, label: CLPS_GROUP_NAME });
  if (includeBeyond && catalog.beyond?.sites.length) options.push({ value: BEYOND, label: BEYOND_GROUP_NAME });
  const mine = customs(catalog);
  if (mine.length) options.push({ value: CUSTOM, label: `My points (${loadMine().length}/${MAX_MINE})` });
  return options;
}

export function spotOptions(catalog, siteKey, { compact = false } = {}) {
  if (siteKey === CLPS) return [...catalog.missions.values()].map((m) => ({ value: m.id, label: `${m.name} · landed ${m.landedUtc.slice(0, 10)}` }));
  if (siteKey === BEYOND) return catalog.beyond.sites.map((b) => ({ value: b.id, label: `${b.name} · ${b.landedDate.slice(0, 4)}` }));
  if (siteKey === CUSTOM) return customs(catalog).map((c) => { const p = mineLatLon(c.id); return { value: c.id, label: `${c.name} · ${Math.abs(p.latitudeDeg).toFixed(4)}°S ${p.longitudeDeg.toFixed(3)}°E` }; });
  const site = catalog.sites.find((s) => s.id === siteKey);
  if (!site) return [];
  return site.spots.map((id) => {
    const y = year(catalog, id);
    const artemis = !compact && catalog.spots.get(id).artemisRegions?.length ? " · Artemis" : "";
    return { value: id, label: `${id} · Sun ${pct(y.sunlitFraction)}, Earth ${pct(y.earthFraction)}${artemis}` };
  });
}

// container: an element to fill. Returns { value, set(id) }; onChange(id) fires on user choices.
export function createPicker(container, catalog, { siteLabel = "Site", includeMissions = false, includeBeyond = false, allowNone = false, compact = false, deferSite = false, onBusy = () => {}, onChange = () => {} } = {}) {
  container.classList.add("picker");
  container.innerHTML = `<label>${siteLabel} <select class="picker-site"></select></label><label>Spot <select class="picker-spot"></select></label>`;
  const [siteSelect, spotSelect] = container.querySelectorAll("select");
  for (const o of siteOptions(catalog, { includeMissions, includeBeyond, allowNone })) siteSelect.append(new Option(o.label, o.value));

  const fillSpots = (siteKey) => {
    spotSelect.replaceChildren(...spotOptions(catalog, siteKey, { compact }).map((o) => new Option(o.label, o.value)));
    spotSelect.disabled = spotSelect.options.length === 0;
  };
  const set = (id) => {
    const key = siteOf(catalog, id);
    siteSelect.value = key;
    fillSpots(key);
    if (key) spotSelect.value = id;
    current = id;
  };
  // A saved or linked point is traced (a few seconds) before the page is told; if that fails the choice is undone.
  let current = "";
  const choose = async (id) => {
    if (isCustomId(id) && !catalog.customs?.has(id)) {
      siteSelect.disabled = spotSelect.disabled = true;
      onBusy("Tracing the terrain of this point, about 3 seconds…");
      const ok = await ensureCustom(catalog, "data", id);
      siteSelect.disabled = false;
      spotSelect.disabled = spotSelect.options.length === 0;
      onBusy(ok ? "" : "That point could not be traced. It must lie inside a NASA site area, at least 2 km from the edge.");
      if (!ok) return set(current || catalog.sites[0].spots[0]);
    }
    current = id;
    onChange(id);
  };
  siteSelect.addEventListener("change", () => {
    fillSpots(siteSelect.value);
    if (deferSite) spotSelect.focus(); // in a pop-over the visitor now picks the spot
    else choose(spotSelect.value || "");
  });
  spotSelect.addEventListener("change", () => choose(spotSelect.value));
  set(allowNone ? "" : catalog.sites[0].spots[0]);
  return {
    get value() { return siteSelect.value ? spotSelect.value : ""; },
    set,
    // Use the spot now showing (a one-spot list fires no change event when it is clicked).
    commit: () => choose(siteSelect.value ? spotSelect.value : ""),
  };
}

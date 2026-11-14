// Custom south-pole points on the Explorer, Planner and Compare: an id like pt_-89.5000_12.0000 is traced in
// the browser from small terrain grids (engine/custom.js) before the page uses it, and registered in the catalogue.

import { CustomTerrain, exportCustom, isCustomId, parseCustomId } from "../engine/index.js";

let terrain = null;

// Make sure `id` is usable: a spot, a CLPS landing, or a custom point (traced now). Returns false if it is none of these.
// `onStatus(text)`, when given, receives the progress (the Map shows it in its result area); otherwise a banner does.
export async function ensureCustom(catalog, base, id, onStatus = null) {
  if (!isCustomId(id)) return Boolean(catalog.spotRecord(id)) || catalog.missions.has(id);
  if (catalog.customs.has(id)) return true;
  const point = parseCustomId(id);
  if (!point) return false;
  const banner = onStatus ? null : document.createElement("div");
  if (banner) {
    banner.className = "custom-status";
    banner.setAttribute("role", "status");
    document.body.append(banner);
    onStatus = (text) => { banner.textContent = text; };
  }
  try {
    onStatus("Loading the terrain for a custom point…");
    terrain ??= CustomTerrain.load(base);
    const record = await (await terrain).build(point.latitudeDeg, point.longitudeDeg, {
      onProgress: (k, n) => onStatus(`Tracing the terrain horizon of the custom point and the 12 points around it (${k} of ${n})…`),
    });
    catalog.addCustom(record);
    return true;
  } catch {
    return false;
  } finally {
    banner?.remove();
  }
}

// The same task, carrying the plain data of a custom point (for a Web Worker, which has no copy of it).
export function withCustom(catalog, task) {
  const id = [task.id, task.spot].find((v) => catalog.customs.get(v)?.traceMast); // sites away from the pole are in every catalogue
  return id ? { ...task, custom: exportCustom(catalog.customs.get(id), task.mast ?? catalog.defaultMastM) } : task;
}

// "Save to My points" under the spot picker of the Explorer and the Planner, for a custom point opened from a link or a
// saved one: it says whether the point is saved and offers to save it (myspots.js, up to five).

import { isCustomId } from "../engine/index.js";
import { MAX_MINE, addMine, loadMine } from "./myspots.js";

const esc = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// container: an empty element. onSaved(id) runs after a save (the page refreshes its picker).
export function createSaveSpot(container, onSaved = () => {}) {
  let current = "";
  const update = (id) => {
    current = id;
    container.hidden = !isCustomId(id);
    if (container.hidden) { container.replaceChildren(); return; }
    const list = loadMine();
    const saved = list.find((m) => m.id === id);
    container.innerHTML = saved ? `<p class="note mine-saved" title="Saved points are kept in this browser and listed in every spot picker">★ Saved in My points as <b>${esc(saved.name)}</b>.</p>`
      : list.length >= MAX_MINE ? `<p class="note">This custom point is not saved. My points is full (${MAX_MINE}): remove one on the Map to save it.</p>`
        : `<p class="note">This custom point is not saved. <button type="button" class="save-spot-btn" title="Keep this point in this browser and use it in every page">Save to My points (${list.length}/${MAX_MINE})</button></p>`;
  };
  container.addEventListener("click", (event) => {
    if (!event.target.closest(".save-spot-btn") || !current) return;
    addMine(current);
    update(current);
    onSaved(current);
  });
  return { update };
}

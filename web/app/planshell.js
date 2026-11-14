// What the five Plan pages share beyond the question sentence: the "How to use" dialog (with About the method), the
// collapsible rows (closed on first load, open or closed remembered for the session) and the one-line summary a row shows when closed.

import { hydrateLinks } from "./links.js";
import { icon16 } from "./components.js";

const CHEVRON = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const ROWS_KEY = "lunazen.plan.rows";

// "How accurate is this?", the checks and how the Plan pages work leave the pages and live here.
export const METHOD_HTML = '<p><a href="evidence.html">How accurate is this? ↗</a> · <a data-guide="method" href="lunazen_guide.pdf">Checks: guide</a> · <a data-guide="series" href="lunazen_guide.pdf">How the Plan pages work: guide</a></p>';

// groups: [[title, html]]. Appends the dialog to the page and wires the "How to use" button (#help-open); About the method is always last.
export function mountHelp(title, groups) {
  const dialog = document.createElement("dialog");
  dialog.id = "help-dialog";
  dialog.className = "mp-dialog";
  dialog.setAttribute("aria-labelledby", "help-title");
  const all = [...groups, ["About the method", METHOD_HTML]];
  dialog.innerHTML = `<div class="mp-dialog-in"><div class="mp-dialog-head"><h2 id="help-title">${title}</h2><button type="button" id="help-close" aria-label="Close">×</button></div><div id="exp-help">${all.map(([t, body]) => `<section><h3>${t}</h3>${body}</section>`).join("")}</div></div>`;
  document.body.append(dialog);
  hydrateLinks(dialog);
  document.getElementById("help-open").addEventListener("click", () => dialog.showModal());
  dialog.querySelector("#help-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}

const load = () => { try { return JSON.parse(sessionStorage.getItem(ROWS_KEY) ?? "{}"); } catch { return {}; } };
const save = (all) => { try { sessionStorage.setItem(ROWS_KEY, JSON.stringify(all)); } catch { /* the choice is not kept */ } };

// Every `.exp-snap[data-row]` becomes a collapsible row: a head button (chevron, title, summary) that shows or hides the body.
export function wireRows(page = location.pathname.split("/").pop() || "index.html") {
  for (const row of document.querySelectorAll(".exp-snap[data-row]")) {
    const head = row.querySelector(".exp-snap-head"), body = row.querySelector(".exp-snap-body");
    if (!head.querySelector("svg")) head.insertAdjacentHTML("afterbegin", CHEVRON);
    const key = `${page}:${row.dataset.row}`;
    const set = (open) => { head.setAttribute("aria-expanded", String(open)); body.hidden = !open; };
    set(load()[key] === true);
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      set(open);
      save({ ...load(), [key]: open });
      row.dispatchEvent(new CustomEvent("rowtoggle", { detail: { open }, bubbles: true }));
    });
  }
}

// The empty icon buttons of a page (#csv, #ics) get their drawings.
export function mountIcons() {
  for (const [id, name] of [["csv", "csv"], ["ics", "cal"]]) { const b = document.getElementById(id); if (b?.classList.contains("exp-ico") && !b.firstChild) b.innerHTML = icon16(name); }
}

export const setSummary = (id, text) => { const el = document.querySelector(`.exp-snap[data-row="${id}"] .s`); if (el) el.textContent = text; };
export const rowOpen = (id) => document.querySelector(`.exp-snap[data-row="${id}"] .exp-snap-head`)?.getAttribute("aria-expanded") === "true";

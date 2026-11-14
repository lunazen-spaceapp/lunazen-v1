// The pin tray: fixed at the bottom of the Plan pages once something is pinned. Each chip shows a status
// dot (green valid within the dispersion radius, blue valid at the target spot only, vermilion fail), the spot, the landing and the mast, with a button to
// remove the pin; a link opens Compare. Compare's shifted view shows the shifted dates and statuses (setTrayOverride).

import { loadPins, pinId, pinDay, removePin, pinsToValue } from "./pins.js";
import { worksText } from "./reach.js";
import { spotName } from "./myspots.js";
import { esc, icon } from "./components.js";
import { fileOf, sectionOf } from "./nav-model.js";

let override = null; // [{ id, landing, kind }] while Compare shows shifted landings

const DOT = { robust: "var(--cell-robust)", spot: "var(--info)", night: "var(--cell-night)", dsn: "var(--cell-night)" };
const kindWords = (within) => ({ robust: worksText(within), spot: "valid at the target spot only", night: "fail, night exceeds limit", dsn: "fail, DSN visibility below threshold" });

export function setTrayOverride(items) {
  override = items;
  render();
}

function render() {
  const el = document.getElementById("lz-tray");
  if (!el) return;
  const pins = loadPins();
  const onCompare = location.pathname.endsWith("compare.html");
  el.hidden = !pins.length;
  document.body.classList.toggle("has-tray", pins.length > 0);
  if (!pins.length) { el.replaceChildren(); return; }
  const base = pins.map((p) => { const o = override?.find((x) => x.id === pinId(p)); const landing = o?.landing ?? p.landing; return `${spotName(p.spot)}, ${pinDay(landing).slice(0, -5)} ${landing.slice(11, 13)}:00, ${p.mast} m`; });
  const chips = pins.map((p, i) => {
    const o = override?.find((x) => x.id === pinId(p));
    const kind = o?.kind ?? p.kind;
    const label = base.filter((b) => b === base[i]).length > 1 ? `${base[i]} · ${p.within} m` : base[i]; // two pins that differ only in the radius say so
    return `<span class="chip"><span class="d" style="background:${DOT[kind]}" role="img" aria-label="${kindWords(p.within)[kind]}"></span>${esc(label)}<button type="button" data-unpin="${esc(pinId(p))}" aria-label="Unpin ${esc(label)}" title="Unpin ${esc(label)}">${icon("x")}</button></span>`;
  }).join("");
  el.innerHTML = `<span class="tray-title">${icon("pin")}<span>Pinned (${pins.length} of 4)</span></span>${chips}`
    + (onCompare ? "" : `<a class="go" href="compare.html#pins=${encodeURIComponent(pinsToValue(pins))}">Compare pinned →</a>`);
}

if (typeof document !== "undefined" && sectionOf(fileOf(location.pathname)) === "plan") {
  const el = document.createElement("div");
  el.id = "lz-tray";
  el.className = "lz-tray";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Pinned landings");
  el.hidden = true;
  document.body.append(el);
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-unpin]"); if (b) { override = null; removePin(b.dataset.unpin); } });
  window.addEventListener("pinschange", render);
  window.addEventListener("storage", render);
  render();
}

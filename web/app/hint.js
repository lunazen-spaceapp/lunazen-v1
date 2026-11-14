// Hover boxes: every <details class="howto"> opens as a small floating box on hover or keyboard
// focus (and on tap). Delegated, so boxes added later by a page's script work too.
// An ⓘ button, <button class="hint" data-hint="...">, shows its text in CSS (hover, focus); here it is also opened by a tap, kept on screen,
// named for screen readers ("About: Longest night") and closed on blur, Escape or a tap elsewhere.

const hoverOpened = new WeakSet();

// Keeps the box on screen. Sideways: shifted so it sits inside the window with an 8 px margin (the page's own rule may
// anchor it to either side of its button). Down: when it would run past the bottom of the window it opens above its
// button if there is more room there, and if it is still too tall it scrolls inside itself. Without this a tall box on a
// short window stretched the page below it.
function place(details) {
  const box = details.querySelector(":scope > :not(summary)");
  if (!box) return;
  for (const side of ["left", "right", "top", "bottom", "maxHeight", "overflowY"]) box.style[side] = "";
  const rect = box.getBoundingClientRect();
  const shift = rect.right > window.innerWidth - 8 ? window.innerWidth - 8 - rect.right : 0;
  const left = rect.left + shift < 8 ? 8 - rect.left : shift;
  if (left) { box.style.left = `${box.offsetLeft + left}px`; box.style.right = "auto"; }
  const button = details.querySelector(":scope > summary").getBoundingClientRect();
  const height = box.getBoundingClientRect().height;
  const below = window.innerHeight - button.bottom - 14;
  const above = button.top - 14;
  if (height <= below) return;
  const room = above > below ? above : below;
  if (above > below) { box.style.top = "auto"; box.style.bottom = "calc(100% + 6px)"; }
  if (height > room) { box.style.maxHeight = `${Math.max(Math.floor(room), 120)}px`; box.style.overflowY = "auto"; }
}

const howto = (event) => event.target.closest?.("details.howto") ?? null;
const open = (d) => { d.open = true; place(d); };
const close = (d) => { d.open = false; hoverOpened.delete(d); };

document.addEventListener("pointerover", (event) => {
  const d = howto(event);
  if (d && event.pointerType === "mouse" && !d.open) { hoverOpened.add(d); open(d); }
});
document.addEventListener("pointerout", (event) => {
  const d = howto(event);
  if (d && event.pointerType === "mouse" && !d.contains(event.relatedTarget)) close(d);
});
document.addEventListener("focusin", (event) => { const d = howto(event); if (d && !d.open) open(d); });
document.addEventListener("focusout", (event) => { const d = howto(event); if (d && !d.contains(event.relatedTarget)) close(d); });
document.addEventListener("click", (event) => {
  const summary = event.target.closest?.("details.howto > summary");
  if (!summary) return;
  event.preventDefault();
  const d = summary.parentElement;
  if (hoverOpened.has(d)) hoverOpened.delete(d); // already showing from the hover: keep it
  else if (d.open) close(d);
  else open(d);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") for (const d of document.querySelectorAll("details.howto[open]")) close(d);
});

// ---- ⓘ buttons
const hints = () => document.querySelectorAll(".hint");
const closeHints = (except = null) => { for (const h of document.querySelectorAll(".hint.is-open")) if (h !== except) h.classList.remove("is-open"); };

// Keeps the 260 px panel inside the window: it is aligned to the icon's right edge and shifted back in when that would cut it off.
function fit(hint) {
  hint.style.removeProperty("--hint-dx");
  const r = hint.getBoundingClientRect();
  const width = Math.min(260, window.innerWidth - 32);
  const left = r.right + 6 - width;
  const dx = left < 8 ? 8 - left : left + width > window.innerWidth - 8 ? window.innerWidth - 8 - (left + width) : 0;
  if (dx) hint.style.setProperty("--hint-dx", `${dx}px`);
}

// "About: <what the figure is>", from the text next to the icon.
function name(hint) {
  if (hint.hasAttribute("aria-label")) return;
  const parent = hint.closest("[data-hint-label]") ?? hint.parentElement;
  const text = [...(parent?.childNodes ?? [])].filter((n) => n !== hint && !(n.nodeType === 1 && n.classList.contains("hint"))).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  hint.setAttribute("aria-label", text ? `About: ${text.slice(0, 60)}` : "About this figure");
}

const label = (root = document) => { for (const h of root.querySelectorAll?.(".hint") ?? []) name(h); };
label();
new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) { if (n.matches(".hint")) name(n); else label(n); } }).observe(document.body, { childList: true, subtree: true });

document.addEventListener("pointerover", (event) => { const h = event.target.closest?.(".hint"); if (h) fit(h); });
document.addEventListener("focusin", (event) => { const h = event.target.closest?.(".hint"); if (h) fit(h); });
document.addEventListener("focusout", (event) => { const h = event.target.closest?.(".hint"); if (h) h.classList.remove("is-open"); });
document.addEventListener("click", (event) => {
  const h = event.target.closest?.(".hint");
  closeHints(h);
  if (!h) return;
  event.preventDefault();
  fit(h);
  h.classList.toggle("is-open");
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const showing = [...hints()].filter((h) => h.classList.contains("is-open") || h === document.activeElement);
  if (!showing.length) return;
  closeHints();
  for (const h of showing) if (h === document.activeElement) h.blur();
  event.stopImmediatePropagation(); // Esc closed a tooltip: the page's own Esc handling (the Map's deselect) does not also run
});

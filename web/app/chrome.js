// The chrome every page shares: the top bar with its Learn and Plan menus, the phone menu and the one-line footer.
// The pages carry an empty <header class="topbar"> and <footer class="site-footer">; this module fills them from nav-model.js
// and makes the menus work.

import { FOOTER_TEXT, fileOf, headerHtml } from "./nav-model.js";
import { mountThemeToggles } from "./theme.js";

// Behaviour: one menu open at a time; Escape, a click outside or any link closes them; a page never opens with one showing.
export function wireMenus(bar) {
  const groups = [...bar.querySelectorAll(".nav-group")].map((g) => ({ button: g.querySelector("button"), menu: g.querySelector(".menu") }));
  const burger = bar.querySelector(".menu-button");
  const drawer = bar.querySelector(".drawer");
  const set = (button, panel, open) => { button.setAttribute("aria-expanded", String(open)); panel.hidden = !open; };
  const closeAll = () => { for (const g of groups) set(g.button, g.menu, false); set(burger, drawer, false); };
  for (const g of groups) {
    g.button.addEventListener("click", () => {
      const open = g.button.getAttribute("aria-expanded") !== "true";
      closeAll();
      set(g.button, g.menu, open);
    });
  }
  burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") !== "true";
    closeAll();
    set(burger, drawer, open);
  });
  document.addEventListener("click", (event) => {
    if (!bar.contains(event.target) || event.target.closest("a")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const inside = bar.contains(document.activeElement) ? document.activeElement : null;
    const owner = groups.find((g) => g.menu.contains(inside))?.button ?? (drawer.contains(inside) ? burger : null);
    closeAll();
    owner?.focus();
  });
  window.addEventListener("pageshow", closeAll); // coming back to a page from the history shows no menu open
  matchMedia("(min-width: 960px)").addEventListener("change", closeAll);
  return closeAll;
}

if (typeof document !== "undefined") {
  const file = fileOf(location.pathname);
  const bar = document.querySelector("header.topbar");
  if (bar) {
    bar.innerHTML = headerHtml(file);
    wireMenus(bar);
  }
  const footer = document.querySelector("footer.site-footer");
  if (footer) footer.innerHTML = `<span>${FOOTER_TEXT}</span>`;
  mountThemeToggles();
}

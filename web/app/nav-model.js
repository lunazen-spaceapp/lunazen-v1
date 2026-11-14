// What the shared chrome says: the menus and their wording, which section a page belongs to, and the markup of the top bar
// and the phone menu. Pure functions of the page's file name; chrome.js puts the result on the page.

export const FOOTER_TEXT = "Terrain: NASA LRO LOLA · Ephemeris: JPL DE440";

// The wording is the design's. The two counts in the Map line are checked against the catalogue by test/chrome.test.js.
export const LEARN_ITEMS = [
  { label: "Map", href: "map.html", desc: "NASA's sunlight and Earth-visibility maps, with 67 spots at 13 sites" },
  { label: "Explorer", href: "explorer.html", desc: "The Sun and Earth against the real skyline, in a panorama and in 3D" },
  { label: "Whole Moon", href: "moon.html", desc: "Apollo and other landing sites beside the pole, at the same moment" },
];
export const PLAN_ITEMS = [
  { label: "Planner", href: "planner.html", desc: "Find viable touchdown dates based on sunlight and Earth line-of-sight" },
  { label: "Rank", href: "rank.html", desc: "Every spot for one landing time, best first" },
  { label: "Delay impact", href: "windows.html", desc: "See if a site still works after a launch slip, or find the next open window" },
  { label: "Compare landings", href: "compare.html", desc: "Pinned landings side by side, shifted by any number of days" },
  { label: "Compare sites", href: "sidebyside.html", desc: "Two to four sites over the same dates, and how sure we can be" },
];

// Which part of the bar a page belongs to. Evidence is reached from Resources, so Resources stays marked there.
const SECTIONS = {
  "index.html": "home",
  "map.html": "learn", "explorer.html": "learn", "moon.html": "learn",
  "planner.html": "plan", "rank.html": "plan", "windows.html": "plan", "compare.html": "plan", "sidebyside.html": "plan",
  "resources.html": "resources", "evidence.html": "resources",
  "contact.html": "contact",
};
export const sectionOf = (file) => SECTIONS[file] ?? "home";
export const fileOf = (pathname) => pathname.split("/").pop() || "index.html";

const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><clipPath id="logo-disk"><circle cx="16" cy="16" r="14"/></clipPath></defs><circle cx="16" cy="16" r="14" fill="#141a2e"/><g clip-path="url(#logo-disk)"><circle cx="9.5" cy="19" r="3.4" fill="#e69f00"/><circle cx="22.5" cy="10" r="2.6" fill="#3b9be0"/><path d="M0 22.5 5 19.8 8.6 21.4 12.8 17.8 16.6 20.4 20.8 18.2 25.6 21.2 32 19.2V32H0Z" fill="#8a94ad"/></g><circle cx="16" cy="16" r="14" fill="none" stroke="#2c3656"/></svg>';
const CHEVRON = '<svg class="chev" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const BURGER = '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" stroke-width="1.6"/></svg>';

const item = (it, file, cls) => `<a class="${cls}" href="${it.href}"${it.href === file ? ' aria-current="page"' : ""}><span class="menu-label">${it.label}</span><span class="menu-desc">${it.desc}</span></a>`;
const link = (label, href, file, section, mine, cls) => `<a class="${cls}${section === mine ? " is-current" : ""}" href="${href}"${href === file ? ' aria-current="page"' : ""}>${label}</a>`;
const group = (id, label, items, file, section) => `<div class="nav-group"><button type="button" class="nav-link${section === id ? " is-current" : ""}" aria-haspopup="true" aria-expanded="false" aria-controls="menu-${id}">${label}${CHEVRON}</button><div class="menu" id="menu-${id}" hidden>${items.map((it) => item(it, file, "menu-item")).join("")}</div></div>`;
const THEME = '<div class="theme-toggle" role="group" aria-label="Colour theme"></div>';

// The markup of the bar and of the phone menu for the page `file`.
export function headerHtml(file) {
  const section = sectionOf(file);
  return `<div class="topbar-inner">
    <a class="brand" href="index.html" aria-label="LunaZen home">${LOGO}<span class="wordmark">LunaZen</span></a>
    <nav class="nav" aria-label="Main">
      ${link("Home", "index.html", file, section, "home", "nav-link")}
      ${group("learn", "Learn", LEARN_ITEMS, file, section)}
      ${group("plan", "Plan", PLAN_ITEMS, file, section)}
      ${link("Resources", "resources.html", file, section, "resources", "nav-link")}
      ${link("Contact", "contact.html", file, section, "contact", "nav-link")}
      ${THEME}
    </nav>
    <button type="button" class="menu-button" aria-expanded="false" aria-controls="drawer">${BURGER}<span>Menu</span></button>
  </div>
  <div class="drawer" id="drawer" hidden>
    ${link("Home", "index.html", file, section, "home", "drawer-link")}
    <p class="drawer-head">Learn</p>${LEARN_ITEMS.map((it) => item(it, file, "menu-item")).join("")}
    <p class="drawer-head">Plan</p>${PLAN_ITEMS.map((it) => item(it, file, "menu-item")).join("")}
    ${link("Resources", "resources.html", file, section, "resources", "drawer-link")}
    ${link("Contact", "contact.html", file, section, "contact", "drawer-link")}
    ${THEME}
  </div>`;
}

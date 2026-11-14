// Colour theme: dark by default, or light, or the system's. The choice lives on
// <html data-theme> (set before the first paint by an inline snippet in each page's head)
// and in localStorage. Pages redraw their canvases when "themechange" fires.

const KEY = "lunazen-theme";
const DEFAULT = "dark"; // the look the app is designed around; "system" and "light" stay one click away
export const THEMES = ["system", "light", "dark"];
const ICONS = {
  system: '<path d="M3 5h18v11H3zM8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};
const LABELS = { system: "Follow the system theme", light: "Light theme", dark: "Dark theme" };

// The theme the page actually shows: "light" or "dark".
export function resolveTheme(stored, systemDark) {
  const theme = THEMES.includes(stored) ? stored : "system";
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

function stored() {
  try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; }
}

export function onThemeChange(redraw) {
  window.addEventListener("themechange", redraw);
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: the choice lasts for this page only */ }
  for (const b of document.querySelectorAll(".theme-toggle button")) b.setAttribute("aria-pressed", String(b.dataset.theme === theme));
  window.dispatchEvent(new Event("themechange"));
}

// Draws the three theme buttons into every .theme-toggle on the page (the bar and the phone menu each have one).
export function mountThemeToggles(root = document) {
  const current = stored();
  for (const box of root.querySelectorAll(".theme-toggle")) {
    box.innerHTML = THEMES.map((t) => `<button type="button" data-theme="${t}" title="${LABELS[t]}" aria-label="${LABELS[t]}" aria-pressed="${current === t}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[t]}</svg></button>`).join("");
    box.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-theme]");
      if (button) apply(button.dataset.theme);
    });
  }
}

if (typeof document !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.documentElement.dataset.theme === "system") window.dispatchEvent(new Event("themechange"));
  });
}

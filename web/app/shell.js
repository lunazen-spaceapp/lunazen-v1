// Page chrome shared by the tools: a readable error panel, a "Copy link"
// button, and nav links that carry the current spot, mast and start date to the other tools.

import { carryHash } from "./format.js";

// Replace a bare status line with a panel: a plain message, and the developer hint folded away.
export function showError(message, hint = "") {
  const panel = document.createElement("div");
  panel.className = "error-panel";
  panel.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = message;
  panel.append(text);
  if (hint) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const code = document.createElement("p");
    code.textContent = hint;
    details.append(summary, code);
    panel.append(details);
  }
  (document.querySelector(".page-head") ?? document.body).after(panel);
}

export function dataLoadError(error, page) {
  showError("The data for this page could not be loaded.", `${error.message}. Start the local server (./start.sh in the packaged build, or "npm run serve" in web/ in the source repository) and open http://localhost:8000/${page}.`);
}

// button: the element to wire. Copies the current URL (the page keeps its state in the hash).
export function wireCopyLink(button) {
  const label = button.textContent;
  const icon = button.hasAttribute("data-icon"); // an icon-only button says "Link copied" in a small note beside it, not in its own text
  let note = null;
  const say = (text) => {
    if (!icon) { button.textContent = text; return; }
    note ??= Object.assign(document.createElement("span"), { className: "copy-status" });
    note.setAttribute("role", "status");
    note.textContent = text;
    button.after(note);
  };
  const reset = () => { if (!icon) button.textContent = label; else note?.remove(); };
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      say("Link copied");
    } catch {
      say("Press Ctrl/Cmd+C to copy the address bar");
    }
    setTimeout(reset, 2000);
  });
}

// Point the nav links (the top bar and the planning strip) of the tools that take them at the current spot, mast and
// start date, and, from a page that has them, the lander's mission length, rule, dark hours and DSN share. Rank has no
// spot to give. A link to the page you are on keeps its plain address (the Compare entry still carries from the other
// pages).
const CARRIED = new Set(["explorer.html", "planner.html", "sidebyside.html", "windows.html", "rank.html"]);
export function carryNav(where) {
  const here = location.pathname.split("/").pop() || "index.html";
  for (const a of document.querySelectorAll(".nav a, .drawer a")) {
    const page = a.getAttribute("href").split("#")[0];
    if (page === here) continue;
    if (CARRIED.has(page)) a.href = `${page}${carryHash(page, where)}`;
  }
}

// Where the guide and the videos live. The addresses come from site-config.js; a link whose address is still a placeholder
// is hidden, never shown dead.
import { EXPLORER_VIDEO_URL, PLAYLIST_URL, REPO_URL } from "./site-config.js";

export const VIDEO_PLAYLIST = PLAYLIST_URL;             // the six-part series "The south polar sky"
export const VIDEO_POLAR_SKY = EXPLORER_VIDEO_URL;      // "The Sun and Earth in the South Polar Sky"

export const GUIDE_PDF = "lunazen_guide.pdf";
export const GUIDE_PAGE_COUNT = 10;
// Physical page numbers of the user guide (docs/learn/lunazen_guide.pdf, 10 pages), the ones a #page=N link opens.
// UPDATE THESE WHEN THE PDF IS REBUILT: read them from the PDF (pdftotext -f N -l N), they move when the text does.
export const GUIDE_PAGES = {
  summary: 2,   // Overview at a Glance
  series: 7,    // 4.2 Plan tab
  method: 8,    // 5 Data: where the numbers come from
  limits: 8,    // 5.2 Modelling assumptions and limitations
};

// The wording of the guide links, in one place ({n} is the page).
export const GUIDE_LABELS = {
  method: "Checks: guide, p. {n}",                  // Section 5, Data
  series: "How the Plan pages work: guide, p. {n}",  // Section 4.2, Plan tab
};

export const hasUrl = (url) => /^https?:\/\//.test(url);
export const guideHref = (key) => `${GUIDE_PDF}#page=${GUIDE_PAGES[key]}`;

// <a data-guide="method"> (optionally data-guide-text) gets its address and page number from GUIDE_PAGES.
// <a data-repo> goes to the source repository; while that address is a placeholder the link is replaced by its text.
// <a data-video="playlist"> or "polar" gets its address, and its container (data-video-wrap, else itself) is hidden
// while the address is a placeholder.
export function hydrateLinks(root = document) {
  for (const a of root.querySelectorAll("a[data-guide]")) {
    const key = a.dataset.guide;
    a.href = guideHref(key);
    a.target = "_blank";
    a.rel = "noopener";
    const text = a.dataset.guideText ?? GUIDE_LABELS[key];
    if (text) a.textContent = text.replace("{n}", GUIDE_PAGES[key]);
  }
  for (const a of root.querySelectorAll("a[data-repo]")) {
    if (hasUrl(REPO_URL)) { a.href = REPO_URL; a.target = "_blank"; a.rel = "noopener"; } else a.replaceWith(a.textContent);
  }
  const urls = { playlist: VIDEO_PLAYLIST, polar: VIDEO_POLAR_SKY };
  for (const a of root.querySelectorAll("a[data-video]")) {
    const url = urls[a.dataset.video];
    const wrap = a.closest("[data-video-wrap]") ?? a;
    wrap.hidden = !hasUrl(url);
    if (hasUrl(url)) { a.href = url; a.target = "_blank"; a.rel = "noopener"; }
  }
}

// The same link as a string, for pages that build their markup in script.
export const guideLinkHtml = (key, text = GUIDE_LABELS[key]) => `<a href="${guideHref(key)}" target="_blank" rel="noopener">${text.replace("{n}", GUIDE_PAGES[key])}</a>`;

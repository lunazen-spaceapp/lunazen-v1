// Pure helpers: short bullets on top of each result, for readers who are not
// mission planners. Every number comes from the result passed in.

import { PRIORITIES, rankColumns } from "./compare-rows.js";
import { darkBelowSuffix, formatDuration } from "./format.js";

const pct = (v) => `${Math.round(v * 100)}%`;
const hours = (h) => formatDuration(h).replace(/ /g, "\u00a0");
const bare = (p) => `${p.hours}\u00a0h`;
const phrase = (p) => (p.phrase ?? bare(p)).replace(/(\d) h/g, "$1\u00a0h");

// The mission is named once, as the source of the figure: "within 5 h (Blue Ghost 1)" /
// "within the 50 h limit, not 5 h" / "more than the 50 h limit".
export function darknessVerdict(darkHours, presets) {
  if (!presets.length) return "";
  const sorted = [...presets].sort((a, b) => a.hours - b.hours);
  const ok = sorted.filter((p) => darkHours <= p.hours);
  if (ok.length === sorted.length) return `within ${phrase(sorted[0])}`;
  if (ok.length) return `within ${phrase(ok[0])}, not ${bare(sorted[0])}`;
  const longest = sorted[sorted.length - 1];
  return `more than ${phrase(longest)}`;
}

const night = (darkHours, presets, dbelow = 0) => (darkHours === 0
  ? "No night in this window"
  : `Longest night ${hours(darkHours)}${darkBelowSuffix(dbelow)}: ${darknessVerdict(darkHours, presets)}`);

// Explorer: the window as a whole.
export function explorerStory({ metrics: m, presets, dbelow = 0 }) {
  return [
    `Sun up ${pct(m.sunlitFraction)} · Earth in view ${pct(m.earthFraction)}`,
    night(m.longestDarkHours, presets, dbelow),
    m.longestDsnLinkGapHours === 0 ? "DSN in view never drops out" : `Longest gap without DSN in view ${hours(m.longestDsnLinkGapHours)}`,
  ];
}

// Compare sites: the banner. A title naming the best site for the priority, then what it costs on darkness and what a miss does to it
// (a landing 100 m off). Every number comes from the columns passed in. Returns { state, title, reason } (null for fewer than two sites).
export function compareVerdict(columns, priorityId, presets) {
  if (columns.length < 2) return null;
  const p = PRIORITIES.find((x) => x.id === priorityId) ?? PRIORITIES[0];
  const [top, second] = rankColumns(columns, p.id);
  const name = (c) => c.name ?? c.id;
  const value = (c) => c.metrics[p.key];
  const show = (v) => (p.kind === "hours" ? hours(v) : pct(v));
  const gap = Math.abs(value(top) - value(second));
  const what = { sun: "illumination", night: "night", contact: "DSN visibility" }[p.id];
  const lead = { sun: "Best illumination", night: "Shortest night", contact: "Best DSN visibility" }[p.id];
  let title;
  if (gap < 1e-9) title = `${lead}: ${name(top)} and ${name(second)} tie (${show(value(top))})`;
  else if (p.kind === "hours") title = `${lead}: ${name(top)} (${show(value(top))}, ${hours(gap)} shorter than ${name(second)})`;
  else { const points = Math.round(gap * 100); title = `${lead}: ${name(top)} (${show(value(top))}, ${points ? `+${points} pp over` : "just ahead of"} ${name(second)})`; }
  void what;
  const dark = top.metrics.longestDarkHours;
  const sorted = [...presets].sort((a, b) => a.hours - b.hours);
  const limit = sorted[sorted.length - 1];
  const verdict = limit && dark > limit.hours ? `exceeds ${limit.hours}\u00a0h limit` : darknessVerdict(dark, presets);
  const night = dark === 0 ? `${name(top)} has no night in this window` : `${name(top)} longest night is ${hours(dark)}${verdict ? ` (${verdict})` : ""}`;
  const ring = top.metrics.ringSunMin !== null && top.metrics.ringSunMin !== undefined ? `; 100 m dispersion reduces worst-case illumination to ${pct(top.metrics.ringSunMin)}` : "";
  return { state: "info", title, reason: `${night}${ring}.` };
}

// Bullets as list items (text escaped).
export function storyHtml(bullets) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return bullets.map((b) => `<li>${esc(b)}</li>`).join("");
}

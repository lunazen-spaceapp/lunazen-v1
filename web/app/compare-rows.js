// Pure helpers for Compare: the metric rows (grouped, with a hint each), which column is best on
// each, how to rank columns by what the reader cares about, and a CSV of the table.

import { DSN_HINT, ENERGY_HINT, NIGHT_HINT, SUN_HIGHEST_HINT, SUN_HIGHEST_LABEL, degText, formatDuration } from "./format.js";

// core: shown by default; the rest appear under "All metrics". The order is the table's.
export const METRICS = [
  { key: "sunlitFraction", label: "Solar illumination", core: true, better: "high", kind: "pct" },
  { key: "sunMaxElevationDeg", label: SUN_HIGHEST_LABEL, core: true, kind: "deg", hint: SUN_HIGHEST_HINT },
  { key: "energyWhPerW", label: "Sun energy (Wh/W)", better: "high", kind: "num", hint: ENERGY_HINT },
  { key: "earthFraction", label: "Earth in view", better: "high", kind: "pct" },
  { key: "dsnLinkFraction", label: "DSN visibility", core: true, better: "high", kind: "pct", hint: DSN_HINT },
  { key: "bothFraction", label: "Sun + Earth together", better: "high", kind: "pct" },
  { key: "longestDsnLinkGapHours", label: "Longest DSN gap", better: "low", kind: "hours", hint: DSN_HINT },
  { key: "longestDarkHours", label: "Longest night", core: true, better: "low", kind: "hours", hint: NIGHT_HINT },
  { key: "survivedBy", label: "Night survival", core: true, kind: "text",
    hint: "Which reference darkness limits cover the longest night. 5 h is what Blue Ghost 1 survived after sunset; 50 h is the design figure of NASA's VIPER rover, a rover meant to move to sunlit areas, used here as a limit for a lander that stays in one place." },
  { key: "ringSunMin", label: "100 m dispersion range", core: true, better: "high", kind: "pct",
    hint: "Lowest to highest illumination among the target spot and its 12 dispersion points within 100 m: how forgiving the site is to a landing miss." },
  { key: "raisedDarkHours", label: "Longest night (+0.25° horizon)", core: true, better: "low", kind: "hours",
    hint: "The longest night if the terrain skyline were 0.25° higher than the map says (the map's own error; about the Sun's radius). Compare it with the longest night above: the smaller the difference, the less this result depends on the map being exact." },
  { key: "raisedSunlit", label: "Illumination (+0.25° horizon)", better: "high", kind: "pct",
    hint: "Solar illumination if the terrain skyline were 0.25° higher than the map says." },
];

// What the reader cares about most; it picks the banner and orders the columns.
export const PRIORITIES = [
  { id: "sun", label: "Illumination", key: "sunlitFraction", better: "high", kind: "pct" },
  { id: "night", label: "Night", key: "longestDarkHours", better: "low", kind: "hours" },
  { id: "contact", label: "DSN", key: "dsnLinkFraction", better: "high", kind: "pct" },
];

export function formatMetric(m, v) {
  if (v === null || v === undefined) return "—";
  return m.kind === "pct" ? `${(v * 100).toFixed(0)}%` : m.kind === "hours" ? formatDuration(v)
    : m.kind === "deg" ? degText(v) : m.kind === "text" ? v.charAt(0).toUpperCase() + v.slice(1) : v.toFixed(0);
}

// Darkness limits (sites.json darknessPresets) that cover a site's longest dark period: "5 h and 50 h", "50 h only" or "neither".
export function survivedBy(longestDarkHours, presets) {
  const hours = (p) => `${p.hours} h`;
  const ok = presets.filter((p) => longestDarkHours <= p.hours).map(hours);
  if (ok.length === presets.length && ok.length) return ok.join(" and ");
  if (ok.length) return `${ok.join(" and ")} only`;
  return presets.length === 2 ? "neither" : "none";
}

// columns: [{ metrics: {key: value} }]. Returns {key: Set of best column indices}; ties share the best,
// and a metric missing from a column (null / undefined) is skipped for that column.
export function bestColumns(columns, metrics = METRICS) {
  const best = {};
  for (const m of metrics) {
    if (!m.better) { best[m.key] = new Set(); continue; }
    const values = columns.map((c) => c.metrics[m.key]).map((v) => (v === null || v === undefined ? null : v));
    const present = values.filter((v) => v !== null);
    if (present.length < 2) { best[m.key] = new Set(); continue; }
    const target = m.better === "high" ? Math.max(...present) : Math.min(...present);
    best[m.key] = new Set(values.flatMap((v, i) => (v !== null && Math.abs(v - target) < 1e-9 ? [i] : [])));
  }
  return best;
}

// Columns best-first for a priority id; equal values keep their order. Unknown id: the first priority.
export function rankColumns(columns, priorityId) {
  const p = PRIORITIES.find((x) => x.id === priorityId) ?? PRIORITIES[0];
  const sign = p.better === "high" ? -1 : 1;
  return columns.map((c, i) => [c, i]).sort((a, b) => sign * (a[0].metrics[p.key] - b[0].metrics[p.key]) || a[1] - b[1]).map(([c]) => c);
}

// One row per metric, one column per site; raw numbers (percent, hours, Wh) so a spreadsheet can use them.
export function comparisonCsv(columns, metrics = METRICS) {
  const cell = (m, v) => (v === null || v === undefined ? "" : m.kind === "pct" ? (v * 100).toFixed(1) : m.kind === "text" ? `"${String(v).replace(/"/g, '""')}"` : Number(v).toFixed(1));
  const unit = (m) => ({ pct: " (%)", hours: " (h)", deg: " (°)" })[m.kind] ?? "";
  const lines = [["metric", ...columns.map((c) => c.id)].join(",")];
  for (const m of metrics) lines.push([`"${m.label}${unit(m)}"`, ...columns.map((c) => cell(m, c.metrics[m.key]))].join(","));
  return `${lines.join("\n")}\n`;
}

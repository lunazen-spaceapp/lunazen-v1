// Pure helpers for the Rank page: whether a spot works for a landing, and the order of the spots.
// A result is { id, siteId, metrics, ringOk, ringTotal } from the "rank" task (tasks.js).

import { feasible, SKYLINE_TEST_DEG } from "../engine/index.js";

export const ORDERS = [
  { id: "overall", label: "Overall" },
  { id: "night", label: "Shortest night", key: "longestDarkHours", better: "low" },
  { id: "sun", label: "Most sunlight", key: "sunlitFraction", better: "high" },
  { id: "energy", label: "Most Sun energy", key: "energyWhPerW", better: "high" },
  { id: "contact", label: "Most DSN visibility", key: "dsnLinkFraction", better: "high" },
  { id: "within", label: "Most dispersion points valid", key: "within", better: "high" },
  { id: "robust", label: "+0.25° margin holds (then dispersion)" },
];

const EPS = 1e-9;
// Negative when a goes first. Values closer than EPS are ties (the JavaScript and the Python round differently).
const by = (a, b, sign) => (Math.abs(a - b) < EPS ? 0 : sign * (a - b));

// Share of the spot and its nearby points where the landing works (the Planner's dispersion share).
export const within = (r, works) => (r.ringOk + (works ? 1 : 0)) / (r.ringTotal + 1);

// rule: { minLink (0..1), maxDarkHours }. Returns the results with .works and .within, best first.
// "overall": works first, then the share of nearby points that also work, then the shorter longest night,
// then more DSN in view, then more sunlight. Equal rows keep their input order.
export function rankRows(results, { minLink, maxDarkHours, orderId = "overall", bestPerSite = false }) {
  const rows = results.map((r, i) => {
    const works = feasible({ longestDarkHours: r.metrics.longestDarkHours, linkFraction: r.metrics.dsnLinkFraction }, minLink, maxDarkHours);
    // holds: still works with the skyline higher by the test error; null when the result has no such run (an older result).
    const holds = r.raised ? works && feasible({ longestDarkHours: r.raised.longestDarkHours, linkFraction: r.raised.dsnLinkFraction }, minLink, maxDarkHours) : null;
    return { ...r, works, holds, within: within(r, works), index: i, key: { ...r.metrics, within: within(r, works) } };
  });
  const order = ORDERS.find((o) => o.id === orderId) ?? ORDERS[0];
  const overall = (a, b) => (b.works - a.works) || by(a.within, b.within, -1) || by(a.metrics.longestDarkHours, b.metrics.longestDarkHours, 1)
    || by(a.metrics.dsnLinkFraction, b.metrics.dsnLinkFraction, -1) || by(a.metrics.sunlitFraction, b.metrics.sunlitFraction, -1);
  const robust = (a, b) => (b.works - a.works) || (Number(b.holds) - Number(a.holds)) || overall(a, b);
  const single = (a, b) => by(a.key[order.key], b.key[order.key], order.better === "high" ? -1 : 1) || overall(a, b);
  rows.sort((a, b) => (order.id === "overall" ? overall(a, b) : order.id === "robust" ? robust(a, b) : single(a, b)) || a.index - b.index);
  if (!bestPerSite) return rows;
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.siteId) ? false : (seen.add(r.siteId), true)));
}

// One plain sentence from the numbers: how many spots work and which working spot comes first. A single-measure
// order does not put the spots that work first, so the sentence names the first one that works and says so when
// spots that fail rank above it.
export function rankStory(rows, total) {
  const working = rows.filter((r) => r.works).length;
  if (!rows.length) return "No spots to rank.";
  if (!working) return `None of the ${total} spots works for this landing. The closest is ${rows[0].label ?? rows[0].id}.`;
  const best = rows.find((r) => r.works);
  const above = rows.indexOf(best);
  const holding = rows.filter((r) => r.holds).length;
  return `${working} of ${total} spots work for this landing. Best: ${best.label ?? best.id}.`
    + (rows[0].holds === null ? "" : holding === working ? ` ${working === 1 ? "It still works" : "All of them still work"} if the terrain is ${SKYLINE_TEST_DEG}° higher than mapped (a check against map error).`
      : holding === 0 ? ` ${working === 1 ? "It would stop working" : "None of them would still work"} if the terrain were ${SKYLINE_TEST_DEG}° higher than mapped (a check against map error).`
        : ` ${holding} of the ${working} still work if the terrain is ${SKYLINE_TEST_DEG}° higher than mapped (a check against map error).`)
    + (above ? ` ${above === 1 ? "One spot that fails ranks" : `${above} spots that fail rank`} above it in this order.` : "");
}

export function rankCsv(rows) {
  const head = ["rank", "spot", "site", "works", "longest_dark_h", "dsn_contact_pct", "sunlit_pct", "sun_energy_wh_per_w", "within_100m_pct", "holds_skyline_plus_0_25"];
  const lines = rows.map((r, k) => [k + 1, r.label ?? r.id, `"${r.siteName}"`, r.works ? "yes" : "no", r.metrics.longestDarkHours.toFixed(2),
    (r.metrics.dsnLinkFraction * 100).toFixed(1), (r.metrics.sunlitFraction * 100).toFixed(1), r.metrics.energyWhPerW.toFixed(1), (r.within * 100).toFixed(0), r.holds === null ? "" : r.holds ? "yes" : "no"].join(","));
  return `${[head.join(","), ...lines].join("\n")}\n`;
}

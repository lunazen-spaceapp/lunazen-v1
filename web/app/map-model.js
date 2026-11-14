// What the Map's Sites tab and selected-spot band say that comes from data: the site rows with their best values, sorting and searching,
// and the verdict and description of a spot. Pure functions of the catalogue, so the figures and the wording are tested. Every number is
// read from the catalogue (the year's metrics at the default mast); the words are the design's.

import { formatDuration } from "./format.js";

export const pct = (v) => `${(v * 100).toFixed(0)}%`;

// One row per NASA site: its spots, and the best sunlit and Earth-in-view shares among them (the year's figures at the default mast).
export function siteRows(catalog) {
  const year = catalog.defaultYear;
  return catalog.sites.map((site) => {
    const spots = site.spots.map((id) => catalog.spots.get(id));
    const figs = spots.map((s) => ({ id: s.id, ...catalog.yearMetrics(s, year) }));
    const bestSun = figs.reduce((a, b) => (b.sunlitFraction > a.sunlitFraction ? b : a));
    return {
      id: site.id,
      name: site.name,
      spots: site.spots,
      count: site.spots.length,
      latitudeDeg: spots.reduce((sum, s) => sum + s.latitudeDeg, 0) / spots.length, // negative, south
      bestSun: bestSun.sunlitFraction,
      bestSunSpot: bestSun.id,
      bestEarth: Math.max(...figs.map((f) => f.earthFraction)),
    };
  });
}

export const latitudeText = (deg) => `${Math.abs(deg).toFixed(1)}°S`;

// Sunlight and Earth: the highest first; A–Z by name.
export function sortSites(rows, by) {
  const out = [...rows];
  if (by === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
  const key = by === "earth" ? "bestEarth" : "bestSun";
  return out.sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
}

// The rows a search leaves, each with the spots to show. A query matches a site's name or a spot's id; a matching site shows all its
// spots, otherwise only the matching ones, and every matching site is open. Without a query nothing is filtered and no site is forced open.
export function filterSites(rows, query) {
  const q = query.trim().toLowerCase();
  if (!q) return { rows: rows.map((row) => ({ row, spots: row.spots, open: false })), spots: 0 };
  const shown = [];
  for (const row of rows) {
    const byName = row.name.toLowerCase().includes(q);
    const spots = byName ? row.spots : row.spots.filter((id) => id.toLowerCase().includes(q));
    if (byName || spots.length) shown.push({ row, spots, open: true });
  }
  return { rows: shown, spots: shown.reduce((n, s) => n + s.spots.length, 0) };
}

export function countText(found, total, query, spots) {
  return `Showing ${found} of ${total} sites${query.trim() ? ` · ${spots} ${spots === 1 ? "spot" : "spots"}` : ""}`;
}

export const noMatchText = (query) => `No site or spot matches “${query.trim()}”.`;

// The sunlit-share tile's line under the value: the spot is its site's best, or where the best is.
export function sunSub(spotId, row) {
  return spotId === row.bestSunSpot ? { text: `Best sunlit spot at ${row.name}`, best: true } : { text: `Site best: ${(row.bestSun * 100).toFixed(0)}% (${row.bestSunSpot})`, best: false };
}

// The verdict: a sunlight word, then what the nights are like.
export function verdict(y, limitH) {
  const sun = y.sunlitFraction;
  const word = sun >= 0.85 ? "Very bright" : sun >= 0.7 ? "Mostly sunlit" : "Often in shadow";
  if (y.longestDarkHours <= limitH) return `${word}, with short nights`;
  return `${word}${sun >= 0.7 ? ", but with " : ", with "}${y.longestDarkHours <= 120 ? "nights of a few days" : "long nights"}`;
}

// The description explains the tiles without repeating them: the night against the darkness limit, Earth, and the DSN gap.
export function description(y, limitH) {
  const night = y.longestDarkHours > limitH
    ? `Its longest night is about ${Math.round(y.longestDarkHours / limitH)} times a ${limitH} h darkness limit (VIPER's design figure).`
    : `Its longest night stays within a ${limitH} h darkness limit (VIPER's design figure).`;
  const earth = y.earthFraction >= 0.6 ? "Earth is above the skyline most of the year" : y.earthFraction >= 0.45 ? "Earth is above the skyline about half the year" : "Earth is below the skyline more often than not";
  const gap = y.longestDsnLinkGapHours >= 168 ? ", with stretches of over a week without a DSN station in view." : y.longestDsnLinkGapHours >= 72 ? ", with gaps of a few days without a DSN station in view." : ", with only short gaps in DSN coverage.";
  return `${night} ${earth}${gap}`;
}

// The two lines under a spot's name.
export const spotLines = (s) => [`${Math.abs(s.latitudeDeg).toFixed(3)}°S ${s.longitudeDeg.toFixed(2)}°E`, `Elevation ${s.groundM.toFixed(0)} m · Slope ${s.slopeDeg.toFixed(1)}°`];

// The four tiles of the band (and of a plotted point): label, value, line beneath.
export const bandTiles = (y, sub) => [
  { key: "sun", label: `Sunlit share (${y.year})`, value: pct(y.sunlitFraction), sub: sub.text, good: sub.best },
  { key: "earth", label: "Earth in view", value: pct(y.earthFraction), sub: "Earth above the skyline" },
  { key: "night", label: "Longest night", value: formatDuration(y.longestDarkHours), sub: "No part of the Sun visible" },
  { key: "gap", label: "Longest DSN gap", value: formatDuration(y.longestDsnLinkGapHours), sub: "No DSN station in view" },
];

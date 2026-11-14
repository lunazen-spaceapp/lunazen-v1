// Pure helpers for the Moon page: the picture of the Moon (simple cylindrical; the whole Moon is -180 to 180 deg E across,
// 90 N at the top, and the page shows one hemisphere of it at a time) and the plain comparison between a site and the south-pole reference. No DOM access, so they are unit-tested in Node.

import { flatText, formatDuration, pctText } from "./format.js";

export const POLAR_EDGE_DEG = -79; // south of this the Map (not this page) is the tool

// Longitude in [-180, 180).
export const wrapLon = (lonDeg) => ((((lonDeg + 180) % 360) + 360) % 360) - 180;

// What a picture shows: longitudes lonMin..lonMax (degrees east, lonMax may pass 180), latitudes latMax down to latMin.
// The default is the whole Moon; the two views are one hemisphere each, from 60 N (no site is further north) to the pole.
export const WHOLE = { lonMin: -180, lonMax: 180, latMax: 90, latMin: -90 };
export const VIEWS = {
  near: { lonMin: -90, lonMax: 90, latMax: 60, latMin: -90 },
  far: { lonMin: 90, lonMax: 270, latMax: 60, latMin: -90 },
};

// The side of the Moon a longitude is on: the near side faces Earth.
export const viewOf = (lonDeg) => (Math.abs(wrapLon(lonDeg)) <= 90 ? "near" : "far");

// Pixel of a latitude/longitude on a picture of size w x h.
export function lonLatToXY(latDeg, lonDeg, w, h, view = WHOLE) {
  const across = ((((lonDeg - view.lonMin) % 360) + 360) % 360) / (view.lonMax - view.lonMin);
  return [across * w, ((view.latMax - latDeg) / (view.latMax - view.latMin)) * h];
}

export function xyToLonLat(x, y, w, h, view = WHOLE) {
  return [wrapLon(view.lonMin + (x / w) * (view.lonMax - view.lonMin)), view.latMax - (y / h) * (view.latMax - view.latMin)];
}

// The pieces of the whole-Moon image (iw x ih) that make up a view, each with the share of the canvas width it
// fills: the far side is two pieces, 90..180 E and 180..270 E (= -180..-90), joined at the seam.
export function sourceRects(view, iw, ih) {
  const spans = view.lonMax > 180 ? [[view.lonMin, 180], [-180, view.lonMax - 360]] : [[view.lonMin, view.lonMax]];
  const total = view.lonMax - view.lonMin;
  let from = 0;
  return spans.map(([a, b]) => {
    const piece = {
      sx: ((a + 180) / 360) * iw, sy: ((90 - view.latMax) / 180) * ih,
      sw: ((b - a) / 360) * iw, sh: ((view.latMax - view.latMin) / 180) * ih,
      dx: from, dw: (b - a) / total,
    };
    from += piece.dw;
    return piece;
  });
}

// The site nearest to a pixel, within maxPx, or null. sites: [{id, latitudeDeg, longitudeDeg}].
export function nearestSite(sites, x, y, w, h, maxPx = 14, view = WHOLE) {
  let best = null;
  let bestD = maxPx;
  for (const s of sites) {
    const [sx, sy] = lonLatToXY(s.latitudeDeg, s.longitudeDeg, w, h, view);
    const d = Math.hypot(sx - x, sy - y);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const deg = (v) => {
  const t = Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0);
  return `${v < 0 && Number(t) !== 0 ? "−" : ""}${t}°`; // a proper minus sign, as everywhere else in the app
};

// What one site's year looks like. metrics: the year summary (sunlitFraction, earthFraction, dsnLinkFraction,
// longestDarkHours); sky: { sunMaxDeg, earthMinDeg, earthMaxDeg, fullSunHours, capture } over the same year (events.js fullSunHours; capture: lightCapture, { upright, flat }).
export function skyFacts(metrics, sky) {
  return {
    sunMax: deg(sky.sunMaxDeg),
    fullSun: `${Math.round(sky.fullSunHours).toLocaleString("en-US")} h`,
    fullSunNote: sky.capture ? `Tracking upright array ${pctText(sky.capture.upright)}, flat ${flatText(sky.capture.flat)}` : null,
    sunUp: pct(metrics.sunlitFraction),
    longestNight: formatDuration(metrics.longestDarkHours),
    earthUp: pct(metrics.earthFraction),
    dsn: pct(metrics.dsnLinkFraction),
    earthRange: metrics.earthFraction > 0 || sky.earthMaxDeg > 0 ? `${deg(sky.earthMinDeg)} to ${deg(sky.earthMaxDeg)}` : "Below the horizon",
  };
}

// [key, label, tone]: the tone is the colour the app gives that thing everywhere (amber Sun, blue Earth, green DSN).
export const COMPARE_ROWS = [
  ["sunMax", "Highest the Sun gets", "sun"],
  ["fullSun", "Hours of full Sun", "sun"],
  ["sunUp", "Time with the Sun up", "sun"],
  ["longestNight", "Longest night", "sun"],
  ["earthRange", "Earth's height in the sky", "earth"],
  ["earthUp", "Time with Earth in view", "earth"],
  ["dsn", "Time with DSN in view", "dsn"],
];

// One plain sentence from the two sets of facts and the numbers behind them.
export function moonStory(name, site, pole, siteSky, poleSky) {
  const earth = site.earthFraction <= 0
    ? `Earth is never in view from ${name}: it is on the far side.`
    : `Earth stays between ${deg(siteSky.earthMinDeg)} and ${deg(siteSky.earthMaxDeg)} in the sky, against ${deg(poleSky.earthMinDeg)} to ${deg(poleSky.earthMaxDeg)} at the pole.`;
  return `At ${name} the Sun climbs to ${deg(siteSky.sunMaxDeg)}; at the pole it never gets above ${deg(poleSky.sunMaxDeg)}, so every ridge matters. ${earth}`;
}

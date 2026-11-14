// Pure helpers for the Map: south-polar stereographic projection (matches clps/geometry.py)
// and lookup of NASA's visibility values on the exported grid.

const R = 1737400;
const RAD = Math.PI / 180;

export function latLonToPolar(latDeg, lonDeg) {
  const rho = 2 * R * Math.tan((Math.PI / 2 + latDeg * RAD) / 2);
  return [rho * Math.sin(lonDeg * RAD), rho * Math.cos(lonDeg * RAD)];
}

export function polarToLatLon(x, y) {
  const lat = -90 + (2 * Math.atan2(Math.hypot(x, y), 2 * R)) / RAD;
  const lon = ((Math.atan2(x, y) / RAD) % 360 + 360) % 360;
  return [lat, lon];
}

// Radius (m) of a latitude circle on the map.
export function latitudeRadius(latDeg) {
  return 2 * R * Math.tan((Math.PI / 2 + latDeg * RAD) / 2);
}

// {sun, earth} in percent at (x, y), or null outside the grid / on no-data.
export function sampleValues(values, meta, x, y) {
  const { x0, y1 } = meta.extentM;
  const col = Math.floor((x - x0) / meta.pixelM);
  const row = Math.floor((y1 - y) / meta.pixelM);
  if (col < 0 || row < 0 || col >= meta.size || row >= meta.size) return null;
  const k = (row * meta.size + col) * 2;
  const sun = values[k];
  const earth = values[k + 1];
  return sun === meta.values.noData ? null : { sun, earth };
}

// The view that fits a box (metres) in a canvas of w x h pixels with some margin: { scale: metres per pixel, cx, cy }.
export function fitBox({ x0M, x1M, y0M, y1M }, w, h, margin = 1.2) {
  return { scale: Math.max((x1M - x0M) / w, (y1M - y0M) / h) * margin, cx: (x0M + x1M) / 2, cy: (y0M + y1M) / 2 };
}

// A view between two views at t in 0..1: the zoom changes at an even rate (scale is interpolated by ratio), the
// centre follows the same eased fraction, and the motion starts and ends gently.
export function easeView(a, b, t) {
  const e = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return { scale: a.scale * (b.scale / a.scale) ** e, cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e };
}

// Whether a point (metres) lies inside a box.
export const inBox = (x, y, { x0M, x1M, y0M, y1M }) => x >= x0M && x <= x1M && y >= y0M && y <= y1M;

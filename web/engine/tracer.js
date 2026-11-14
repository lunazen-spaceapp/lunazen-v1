// Terrain horizon from browser-sized grids: the JavaScript twin of clps/terrain.py trace_horizon_nested and
// clps/custom.py. Used for custom points near the south pole (web/data/custom/).

import { Horizon } from "./horizon.js";
import { MOON_RADIUS_M } from "./site.js";

export const OBSERVER_HEIGHT_M = 2;
export const MIN_RANGE_M = 10;
const NODATA = -32768;

// South-polar stereographic (true scale at the pole), as clps/geometry.py.
export function latLonToPolar(latDeg, lonDeg, R = MOON_RADIUS_M) {
  const rho = 2 * R * Math.tan((Math.PI / 2 + (latDeg * Math.PI) / 180) / 2);
  const lon = (lonDeg * Math.PI) / 180;
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

export function polarToLatLon(x, y, R = MOON_RADIUS_M) {
  const lat = -Math.PI / 2 + 2 * Math.atan2(Math.hypot(x, y), 2 * R);
  const lon = Math.atan2(x, y);
  return [(lat * 180) / Math.PI, (((lon * 180) / Math.PI) % 360 + 360) % 360];
}

// A height grid in the polar frame; row 0 is the top (largest y). Bilinear on pixel centres, NaN outside.
export class PolarGrid {
  constructor(int16, { x0M, y0M, pixelM, rows, cols, scaleM, offsetM }) {
    this.h = new Float64Array(rows * cols);
    for (let i = 0; i < this.h.length; i++) this.h[i] = int16[i] === NODATA ? NaN : offsetM + int16[i] * scaleM;
    this.x0 = x0M; this.y0 = y0M; this.pixel = pixelM; this.rows = rows; this.cols = cols;
  }

  sample(x, y) {
    const row = (this.y0 - y) / this.pixel - 0.5;
    const col = (x - this.x0) / this.pixel - 0.5;
    const r0 = Math.floor(row), c0 = Math.floor(col);
    if (r0 < 0 || r0 >= this.rows - 1 || c0 < 0 || c0 >= this.cols - 1) return NaN;
    const a = row - r0, b = col - c0, i = r0 * this.cols + c0, h = this.h;
    return h[i] * (1 - a) * (1 - b) + h[i + 1] * (1 - a) * b + h[i + this.cols] * a * (1 - b) + h[i + this.cols + 1] * a * b;
  }
}

export function rayDistances(minRangeM, maxRangeM, stepMinM = 5, k = 400) {
  const d = [Math.max(minRangeM, stepMinM)];
  while (d[d.length - 1] < maxRangeM) d.push(d[d.length - 1] + Math.max(stepMinM, d[d.length - 1] / k));
  return d;
}

// One ray per azimuth; at every sample the first grid in `grids` that covers it gives the height.
export function traceHorizon(latDeg, lonDeg, groundM, grids, { azimuthStepDeg = 0.25, observerHeightM = OBSERVER_HEIGHT_M,
  minRangeM = MIN_RANGE_M, maxRangeM = 300000, R = MOON_RADIUS_M } = {}) {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const r0 = R + groundM + observerHeightM;
  const dist = rayDistances(minRangeM, maxRangeM);
  const n = dist.length;
  const sinD = new Float64Array(n), cosD = new Float64Array(n), delta = new Float64Array(n);
  for (let j = 0; j < n; j++) { delta[j] = dist[j] / R; sinD[j] = Math.sin(delta[j]); cosD[j] = Math.cos(delta[j]); }
  const count = Math.round(360 / azimuthStepDeg);
  const out = new Float64Array(count);
  for (let a = 0; a < count; a++) {
    const az = (a * azimuthStepDeg * Math.PI) / 180, sinA = Math.sin(az), cosA = Math.cos(az);
    let best = -Infinity;
    for (let j = 0; j < n; j++) {
      const sinLat2 = Math.min(1, Math.max(-1, sinLat * cosD[j] + cosLat * sinD[j] * cosA));
      const lat2 = Math.asin(sinLat2);
      const lon2 = lon + Math.atan2(sinA * sinD[j] * cosLat, cosD[j] - sinLat * sinLat2);
      const [x, y] = latLonToPolar((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI, R);
      let h = NaN;
      for (const g of grids) { h = g.sample(x, y); if (!Number.isNaN(h)) break; }
      if (Number.isNaN(h)) continue;
      const r1 = R + h;
      const angle = Math.atan2(r1 * cosD[j] - r0, r1 * sinD[j]);
      if (angle > best) best = angle;
    }
    out[a] = (best * 180) / Math.PI;
  }
  return new Horizon(out);
}

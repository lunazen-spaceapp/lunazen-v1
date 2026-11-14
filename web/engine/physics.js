// Sun / Earth apparent geometry above the terrain and disk fractions.
// Mirrors clps/visibility.py and clps/disk.py.

import { azEl } from "./site.js";

const RAD = Math.PI / 180;
export const SUN_RADIUS_KM = 695700.0;
export const EARTH_RADIUS_KM = 6378.137;
const BODY_RADIUS_KM = { SUN: SUN_RADIUS_KM, EARTH: EARTH_RADIUS_KM };

// Visible area fraction of a disk centred at (azimuth, elevation) with angular radius r (deg).
export function diskFraction(azimuth, elevation, radius, horizon, columns = 64) {
  const cosEl = Math.cos(elevation * RAD);
  let visible = 0;
  let total = 0;
  for (let k = 0; k < columns; k++) {
    const u = -1 + (k + 0.5) * (2 / columns);
    const half = radius * Math.sqrt(1 - u * u);
    const terrain = horizon.at(azimuth + (radius * u) / cosEl);
    const top = elevation + half;
    visible += Math.max(top - Math.max(elevation - half, terrain), 0);
    total += 2 * half;
  }
  return visible / total;
}

// Apparent state of SUN or EARTH from a site at one ET.
export function bodyState(ephemeris, bodyName, site, horizon, et, scratch = new Float64Array(3)) {
  const p = ephemeris.position(ephemeris.bodyIndex(bodyName), et, scratch);
  const v = [p[0] * 1000 - site.position[0], p[1] * 1000 - site.position[1], p[2] * 1000 - site.position[2]];
  const distanceKm = Math.hypot(v[0], v[1], v[2]) / 1000;
  const { azimuth, elevation } = azEl(site, v);
  const terrain = horizon.at(azimuth);
  const radius = Math.asin(BODY_RADIUS_KM[bodyName] / distanceKm) / RAD;
  const fraction = diskFraction(azimuth, elevation, radius, horizon);
  return { azimuth, elevation, terrain, margin: elevation - terrain, radius, distanceKm, fraction, visible: fraction > 0 };
}

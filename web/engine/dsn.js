// Deep Space Network visibility of the Moon. Mirrors clps/dsn.py: DSN 810-005 Module 301
// station coordinates, SPICE's IAU_EARTH orientation model from pck00011 (no nutation),
// and the Moon from Earth's centre in J2000 from the exported ephemeris.

import { azEl } from "./site.js";

const RAD = Math.PI / 180;
export const DSN_MASK_DEG = 10; // ~ DSN general uplink limit; receive works down to ~6 deg (810-005 Module 301)

// Earth-fixed Cartesian coordinates (m) of the 70 m antennas.
export const DSN_COMPLEXES = {
  Goldstone: [-2353621.420, -4641341.472, 3677052.318], // DSS-14
  Canberra: [-4460894.917, 2682361.507, -3674748.152], // DSS-43
  Madrid: [4849092.518, -360180.348, 4115109.251], // DSS-63
};

function geodeticUp([x, y, z]) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 5; i++) {
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (e2 * n) / (n + h)));
  }
  const lon = Math.atan2(y, x);
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

const UP = Object.fromEntries(Object.entries(DSN_COMPLEXES).map(([k, v]) => [k, geodeticUp(v)]));

// J2000 -> IAU_EARTH: R3(W) R1(90 deg - dec) R3(90 deg + ra), pck00011 Earth constants.
function toEarthFixed(et, v) {
  const T = et / (36525 * 86400);
  const d = et / 86400;
  const ra = (0 - 0.641 * T) * RAD;
  const dec = (90 - 0.557 * T) * RAD;
  const w = ((190.147 + 360.9856235 * d) % 360) * RAD;
  const rot3 = (ang, [x, y, z]) => [Math.cos(ang) * x + Math.sin(ang) * y, -Math.sin(ang) * x + Math.cos(ang) * y, z];
  const rot1 = (ang, [x, y, z]) => [x, Math.cos(ang) * y + Math.sin(ang) * z, -Math.sin(ang) * y + Math.cos(ang) * z];
  return rot3(w, rot1(Math.PI / 2 - dec, rot3(Math.PI / 2 + ra, v)));
}

// IAU_EARTH -> J2000: the transpose of toEarthFixed.
function fromEarthFixed(et, v) {
  const T = et / (36525 * 86400);
  const d = et / 86400;
  const ra = (0 - 0.641 * T) * RAD;
  const dec = (90 - 0.557 * T) * RAD;
  const w = ((190.147 + 360.9856235 * d) % 360) * RAD;
  const rot3 = (ang, [x, y, z]) => [Math.cos(ang) * x + Math.sin(ang) * y, -Math.sin(ang) * x + Math.cos(ang) * y, z];
  const rot1 = (ang, [x, y, z]) => [x, Math.cos(ang) * y + Math.sin(ang) * z, -Math.sin(ang) * y + Math.cos(ang) * z];
  return rot3(-(Math.PI / 2 + ra), rot1(-(Math.PI / 2 - dec), rot3(-w, v)));
}

// {complex: elevation (deg) of the Moon's centre} at one ET.
export function moonElevations(ephemeris, et, scratch = new Float64Array(3)) {
  const m = ephemeris.position(ephemeris.bodyIndex("MOON"), et, scratch);
  const moon = toEarthFixed(et, [m[0] * 1000, m[1] * 1000, m[2] * 1000]);
  const out = {};
  for (const [name, s] of Object.entries(DSN_COMPLEXES)) {
    const v = [moon[0] - s[0], moon[1] - s[1], moon[2] - s[2]];
    const u = UP[name];
    out[name] = Math.asin((v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / Math.hypot(v[0], v[1], v[2])) / RAD;
  }
  return out;
}

export function dsnInView(ephemeris, et, maskDeg = DSN_MASK_DEG) {
  return Object.values(moonElevations(ephemeris, et)).some((e) => e > maskDeg);
}

// The stricter, station-level rule (mirrors lunazen/dsn.py station_in_view): a complex sees the Moon above the mask
// and the lander sees that complex itself, a point on Earth's disk, above its skyline. Needs the rotation table
// (Ephemeris.loadRotation). site/horizon as in physics.js bodyState.
export function stationInView(ephemeris, et, site, horizon, maskDeg = DSN_MASK_DEG) {
  const moon = moonElevations(ephemeris, et);
  const earth = ephemeris.position(ephemeris.bodyIndex("EARTH"), et);
  const R = ephemeris.rotationJ2000ToMoonMe(et);
  for (const [name, station] of Object.entries(DSN_COMPLEXES)) {
    if (!(moon[name] > maskDeg)) continue;
    const j = fromEarthFixed(et, station);
    const v = [
      earth[0] * 1000 + R[0] * j[0] + R[1] * j[1] + R[2] * j[2] - site.position[0],
      earth[1] * 1000 + R[3] * j[0] + R[4] * j[1] + R[5] * j[2] - site.position[1],
      earth[2] * 1000 + R[6] * j[0] + R[7] * j[1] + R[8] * j[2] - site.position[2],
    ];
    const { azimuth, elevation } = azEl(site, v);
    if (elevation > horizon.at(azimuth)) return true;
  }
  return false;
}

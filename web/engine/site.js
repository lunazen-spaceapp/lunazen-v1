// Observer position and local East-North-Up basis in MOON_ME (metres).

export const MOON_RADIUS_M = 1737400.0;
const RAD = Math.PI / 180;

export function siteFromLatLon(latitudeDeg, longitudeDeg, heightM, radiusM = MOON_RADIUS_M) {
  const lat = latitudeDeg * RAD;
  const lon = longitudeDeg * RAD;
  const r = radiusM + heightM;
  const position = [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = position.map((v) => v / r);
  return { latitudeDeg, longitudeDeg: ((longitudeDeg % 360) + 360) % 360, heightM, position, east, north, up };
}

// Azimuth (deg from north, east-positive) and elevation (deg) of a MOON_ME vector.
export function azEl(site, v) {
  const e = v[0] * site.east[0] + v[1] * site.east[1] + v[2] * site.east[2];
  const n = v[0] * site.north[0] + v[1] * site.north[1] + v[2] * site.north[2];
  const u = v[0] * site.up[0] + v[1] * site.up[1] + v[2] * site.up[2];
  const azimuth = ((Math.atan2(e, n) / RAD) % 360 + 360) % 360;
  return { azimuth, elevation: Math.atan2(u, Math.hypot(e, n)) / RAD };
}

// Custom points near the south pole, traced in the browser from small terrain grids (web/data/custom/,
// written by pipeline/export_custom_terrain.py; Python reference: clps/custom.py).

import { Horizon } from "./horizon.js";
import { PolarGrid, OBSERVER_HEIGHT_M, latLonToPolar, polarToLatLon, traceHorizon } from "./tracer.js";

export const CUSTOM_PREFIX = "pt_";
const RING_RADII_M = [50, 100];
const RING_POINTS = 6;
const tick = () => new Promise((resolve) => setTimeout(resolve));

export const isCustomId = (id) => typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
export const customId = (latDeg, lonDeg) => `${CUSTOM_PREFIX}${latDeg.toFixed(4)}_${lonDeg.toFixed(4)}`;

export function parseCustomId(id) {
  const m = /^pt_(-?\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)$/.exec(id ?? "");
  return m ? { latitudeDeg: Number(m[1]), longitudeDeg: Number(m[2]) } : null;
}

export class CustomTerrain {
  constructor(base, manifest, far) {
    this.base = base;
    this.manifest = manifest;
    this.far = far;
    this.crops = new Map();
  }

  static async load(base) {
    const manifest = await fetch(`${base}/custom/custom.json`).then((r) => r.json());
    const far = new PolarGrid(await fetchInt16(`${base}/custom/${manifest.far.file}`), manifest.far);
    return new CustomTerrain(base, manifest, far);
  }

  // The site whose tile (less a 2 km margin) contains the point, or null.
  locate(latDeg, lonDeg) {
    const [x, y] = latLonToPolar(latDeg, lonDeg);
    return this.manifest.sites.find((s) => x >= s.interior.xMinM && x <= s.interior.xMaxM && y >= s.interior.yMinM && y <= s.interior.yMaxM) ?? null;
  }

  async crop(site) {
    if (!this.crops.has(site.id)) this.crops.set(site.id, fetchInt16(`${this.base}/custom/${site.file}`).then((a) => new PolarGrid(a, site)));
    return this.crops.get(site.id);
  }

  // A custom spot record, as SiteCatalog.addCustom expects. Traces the point and its 12 neighbours at the
  // default mast now; other mast heights are traced when asked for.
  async build(latDeg, lonDeg, { onProgress = () => {} } = {}) {
    const site = this.locate(latDeg, lonDeg);
    if (!site) throw new Error("this point is outside the areas covered by the custom terrain");
    const grids = [await this.crop(site), this.far];
    const groundAt = (lat, lon) => {
      const [x, y] = latLonToPolar(lat, lon);
      for (const g of grids) { const h = g.sample(x, y); if (!Number.isNaN(h)) return h; }
      return NaN;
    };
    const trace = (lat, lon, ground, mast) => traceHorizon(lat, lon, ground, grids, { observerHeightM: mast });
    const [x, y] = latLonToPolar(latDeg, lonDeg);
    const offsets = [];
    for (const radius of RING_RADII_M) {
      for (let k = 0; k < RING_POINTS; k++) {
        const a = (2 * Math.PI * (k + (radius === RING_RADII_M[1] ? 0.5 : 0))) / RING_POINTS;
        offsets.push([radius * Math.sin(a), radius * Math.cos(a)]);
      }
    }
    const groundM = groundAt(latDeg, lonDeg);
    const horizons = new Map([[OBSERVER_HEIGHT_M, trace(latDeg, lonDeg, groundM, OBSERVER_HEIGHT_M)]]);
    const ring = [];
    for (const [dx, dy] of offsets) {
      onProgress(ring.length + 1, offsets.length + 1);
      await tick();
      const [lat, lon] = polarToLatLon(x + dx, y + dy);
      const ground = groundAt(lat, lon);
      ring.push({ offsetM: [dx, dy], latitudeDeg: lat, longitudeDeg: lon, groundM: ground, mastM: OBSERVER_HEIGHT_M, horizon: trace(lat, lon, ground, OBSERVER_HEIGHT_M) });
    }
    return {
      id: customId(latDeg, lonDeg), custom: true, site: "custom", siteName: `Custom point (in ${site.name} tile)`,
      latitudeDeg: Number(latDeg.toFixed(4)), longitudeDeg: Number(lonDeg.toFixed(4)), groundM,
      slopeDeg: null, nasaAvgSun: null, nasaAvgEarth: null, artemisRegions: [],
      horizons, ring, traceMast: (mast) => trace(latDeg, lonDeg, groundM, mast),
    };
  }
}

async function fetchInt16(url) {
  const buffer = await fetch(url).then((r) => r.arrayBuffer());
  return new Int16Array(buffer);
}

// The plain-data form of a record, for a Web Worker (a given mast height only).
export function exportCustom(record, mastM) {
  if (!record.horizons.has(mastM)) record.horizons.set(mastM, record.traceMast(mastM));
  return {
    id: record.id, siteName: record.siteName, latitudeDeg: record.latitudeDeg, longitudeDeg: record.longitudeDeg, groundM: record.groundM,
    horizons: [...record.horizons].map(([m, h]) => [m, h.elevation]),
    ring: record.ring.map((p) => ({ ...p, horizon: p.horizon.elevation })),
  };
}

export function importCustom(data) {
  return {
    ...data, custom: true, site: "custom", slopeDeg: null, nasaAvgSun: null, nasaAvgEarth: null, artemisRegions: [],
    horizons: new Map(data.horizons.map(([m, e]) => [m, new Horizon(e)])),
    ring: data.ring.map((p) => ({ ...p, horizon: new Horizon(p.horizon) })),
  };
}

// Site catalogue for the browser: NASA candidate spots and CLPS mission sites, with their
// terrain horizons. Reads web/data/sites.json + horizons.bin (pipeline/export_web.py).

import { Horizon } from "./horizon.js";
import { siteFromLatLon } from "./site.js";
import { importCustom } from "./custom.js";

export class SiteCatalog {
  constructor(catalogue, buffer) {
    this.catalogue = catalogue;
    this.format = catalogue.format;
    this.rows = buffer ? new Int16Array(buffer) : null; // null: the horizons were not loaded
    if (this.rows && this.rows.length !== this.format.rows * this.format.azimuths) {
      throw new Error("horizons.bin does not match sites.json");
    }
    this.spots = new Map(catalogue.spots.map((s) => [s.id, s]));
    this.missions = new Map(catalogue.missions.map((m) => [m.id, m]));
    this.customs = new Map(); // custom points traced in this session (engine/custom.js) and the sites away from the pole, by id
    this.beyond = catalogue.beyond ?? { sites: [] }; // landing sites away from the pole, on the global map only
    if (this.rows) {
      for (const b of this.beyond.sites) {
        this.customs.set(b.id, {
          ...b, group: "beyond", site: "beyond", siteName: b.name, slopeDeg: null, nasaAvgSun: null, nasaAvgEarth: null, artemisRegions: [],
          horizons: new Map([[b.mastM, this.horizon(b.horizonRow)]]), ring: [],
        });
      }
    }
    this.sites = catalogue.sites;
    this.defaultMastM = catalogue.defaultMastM;
    this.mastsM = catalogue.mastsM;
    this.years = catalogue.years ?? ["2027"]; // calendar years with precomputed summaries; the engine accepts any date 2024-2043
    this.defaultYear = catalogue.defaultYear ?? "2027";
    this.artemisRegions = catalogue.artemisRegions?.regions ?? [];
    this.darknessPresets = catalogue.darknessPresets ?? [];
  }

  // horizons: false loads only the catalogue (the Map needs no terrain horizons), saving the 0.9 MB download.
  static async load(baseUrl, { horizons = true } = {}) {
    const catalogue = await fetch(`${baseUrl}/sites.json`).then((r) => r.json());
    if (!horizons) return new SiteCatalog(catalogue, null);
    const buffer = await fetch(`${baseUrl}/${catalogue.format.horizons}`).then((r) => r.arrayBuffer());
    return new SiteCatalog(catalogue, buffer);
  }

  // Yearly summary of a spot at one mast height (default: the default year and mast).
  yearMetrics(record, year = this.defaultYear, mastM = this.defaultMastM) {
    return (record.years ?? { 2027: record.year2027 })[year][String(mastM)];
  }

  // The same for one ring point (landing-position spread).
  ringMetrics(point, year = this.defaultYear) {
    return (point.years ?? { 2027: point.year2027 })[year];
  }

  horizon(row) {
    if (!this.rows) throw new Error("the horizons were not loaded: use SiteCatalog.load(url) without horizons: false");
    const n = this.format.azimuths;
    const elevation = new Float64Array(n);
    for (let k = 0; k < n; k++) elevation[k] = this.rows[row * n + k] / 100;
    return new Horizon(elevation);
  }

  // The record of a candidate spot or a custom point, if known.
  spotRecord(id) {
    return this.spots.get(id) ?? this.customs.get(id);
  }

  addCustom(record) {
    this.customs.set(record.id, record.horizons instanceof Map ? record : importCustom(record));
  }

  // {site, horizon, record} for a candidate spot at one of the precomputed mast heights.
  spot(id, mastM = this.defaultMastM) {
    const custom = this.customs.get(id);
    if (custom) {
      if (!custom.horizons.has(mastM) && !custom.traceMast) mastM = this.defaultMastM; // fixed-mast records
      if (!custom.horizons.has(mastM)) custom.horizons.set(mastM, custom.traceMast(mastM));
      return { site: siteFromLatLon(custom.latitudeDeg, custom.longitudeDeg, custom.groundM + mastM), horizon: custom.horizons.get(mastM), record: custom };
    }
    const record = this.spots.get(id);
    if (!record) throw new Error(`unknown spot ${id}`);
    const row = record.horizonRows[String(mastM)];
    if (row === undefined) throw new Error(`no ${mastM} m horizon for ${id}; available: ${this.mastsM.join(", ")} m`);
    const site = siteFromLatLon(record.latitudeDeg, record.longitudeDeg, record.groundM + mastM);
    return { site, horizon: this.horizon(row), record };
  }

  // The points around a spot (landing-position spread), each with its own site and horizon.
  ring(id) {
    const custom = this.customs.get(id);
    if (custom) return custom.ring.map((p) => ({ offsetM: p.offsetM, site: siteFromLatLon(p.latitudeDeg, p.longitudeDeg, p.groundM + p.mastM), horizon: p.horizon }));
    const record = this.spots.get(id);
    if (!record) throw new Error(`unknown spot ${id}`);
    return record.ring.map((p) => ({
      offsetM: p.offsetM,
      site: siteFromLatLon(p.latitudeDeg, p.longitudeDeg, p.groundM + p.mastM),
      horizon: this.horizon(p.horizonRow),
    }));
  }

  mission(id) {
    const record = this.missions.get(id);
    if (!record) throw new Error(`unknown mission ${id}`);
    const site = siteFromLatLon(record.latitudeDeg, record.longitudeDeg, record.groundM + record.mastM);
    return { site, horizon: this.horizon(record.horizonRow), record };
  }
}

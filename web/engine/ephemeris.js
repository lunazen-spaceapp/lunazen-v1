// Sun / Earth positions (km, MOON_ME, from the Moon's centre, LT+S) interpolated
// from the SPICE export written by pipeline/export_ephemeris.py.

export class Ephemeris {
  constructor(header, buffer) {
    this.header = header;
    this.data = new Float32Array(buffer);
    this.bodies = header.bodies;
    this.stride = header.bodies.length * 3;
    this.et0 = header.et0;
    this.step = header.step_s;
    this.count = header.count;
    this.etMin = this.et0 + this.step;
    this.etMax = this.et0 + (this.count - 2) * this.step;
  }

  static async load(baseUrl) {
    const [header, buffer] = await Promise.all([
      fetch(`${baseUrl}/ephemeris.json`).then((r) => r.json()),
      fetch(`${baseUrl}/ephemeris.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new Ephemeris(header, buffer);
  }

  // The Moon's orientation table (ephemeris_rotation.bin), needed only by the station-level DSN test (dsn.js
  // stationInView). header/buffer as written by pipeline/export_ephemeris_rotation.py.
  setRotation(header, buffer) {
    this.rotation = { et0: header.et0, step: header.step_s, count: header.count, data: new Float32Array(buffer) };
    return this;
  }

  static async loadRotation(ephemeris, baseUrl) {
    const [header, buffer] = await Promise.all([
      fetch(`${baseUrl}/ephemeris_rotation.json`).then((r) => r.json()),
      fetch(`${baseUrl}/ephemeris_rotation.bin`).then((r) => r.arrayBuffer()),
    ]);
    return ephemeris.setRotation(header, buffer);
  }

  // Row-major matrix (9 numbers) turning a J2000 vector into MOON_ME at et; 4-point Lagrange like position().
  rotationJ2000ToMoonMe(et, out = new Float64Array(9)) {
    const r = this.rotation;
    if (!r) throw new Error("the rotation table is not loaded (Ephemeris.loadRotation)");
    const u = (et - r.et0) / r.step;
    const i = Math.min(Math.max(Math.floor(u) - 1, 0), r.count - 4);
    const x = u - i;
    const w0 = (-(x - 1) * (x - 2) * (x - 3)) / 6;
    const w1 = (x * (x - 2) * (x - 3)) / 2;
    const w2 = (-x * (x - 1) * (x - 3)) / 2;
    const w3 = (x * (x - 1) * (x - 2)) / 6;
    const d = r.data;
    for (let c = 0; c < 9; c++) {
      const o = i * 9 + c;
      out[c] = w0 * d[o] + w1 * d[o + 9] + w2 * d[o + 18] + w3 * d[o + 27];
    }
    return out;
  }

  bodyIndex(name) {
    const index = this.bodies.indexOf(name.toUpperCase());
    if (index < 0) throw new Error(`unknown body ${name}`);
    return index;
  }

  // 4-point Lagrange interpolation; writes [x, y, z] km into out.
  position(body, et, out = new Float64Array(3)) {
    if (et < this.etMin || et > this.etMax) throw new RangeError("time outside the exported ephemeris");
    const u = (et - this.et0) / this.step;
    const i = Math.min(Math.max(Math.floor(u) - 1, 0), this.count - 4);
    const x = u - i;
    const w0 = (-(x - 1) * (x - 2) * (x - 3)) / 6;
    const w1 = (x * (x - 2) * (x - 3)) / 2;
    const w2 = (-x * (x - 1) * (x - 3)) / 2;
    const w3 = (x * (x - 1) * (x - 2)) / 6;
    const d = this.data;
    const s = this.stride;
    for (let c = 0; c < 3; c++) {
      const o = i * s + body * 3 + c;
      out[c] = w0 * d[o] + w1 * d[o + s] + w2 * d[o + 2 * s] + w3 * d[o + 3 * s];
    }
    return out;
  }
}

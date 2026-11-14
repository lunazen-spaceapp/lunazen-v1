// Terrain horizon H(A) on a uniform azimuth grid starting at 0 deg, wrapping at 360.

export class Horizon {
  constructor(elevationDeg) {
    this.elevation = Float64Array.from(elevationDeg);
    this.n = this.elevation.length;
    this.step = 360 / this.n;
  }

  at(azimuthDeg) {
    const a = ((azimuthDeg % 360) + 360) % 360;
    const u = a / this.step;
    const i = Math.floor(u);
    const f = u - i;
    const h = this.elevation;
    return h[i % this.n] * (1 - f) + h[(i + 1) % this.n] * f;
  }

  // The same horizon with every elevation raised by deg (mirrors lunazen.horizon.Horizon.raised).
  raised(deg) {
    return new Horizon(this.elevation.map((v) => v + deg));
  }

  static flat(n = 360) {
    return new Horizon(new Float64Array(n));
  }
}

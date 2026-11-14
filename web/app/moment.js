// Pure helpers for the Explorer's chosen moment: jump to the next change, tint the time slider,
// and say in a sentence what the sky is doing. No DOM access, so they are unit-tested in Node.

// flagSets: arrays of 0/1 (or booleans) over the samples, e.g. [sunUp, earthUp, dsnLink]. Returns the
// next index (dir = 1) or previous index (dir = -1) where any flag differs from its value at i, or null.
export function nextChange(flagSets, i, dir = 1) {
  const at = (k) => flagSets.map((f) => (f[k] ? 1 : 0)).join("");
  const here = at(i);
  for (let k = i + dir; k >= 0 && k < flagSets[0].length; k += dir) if (at(k) !== here) return k;
  return null;
}

// A CSS gradient along the slider: litColor where lit[i] > 0, darkColor elsewhere (runs, not samples).
export function litGradient(lit, litColor, darkColor) {
  const n = lit.length;
  if (n < 2) return darkColor;
  const pct = (k) => `${((Math.min(k, n - 1) / (n - 1)) * 100).toFixed(2)}%`;
  const stops = [];
  let start = 0;
  for (let k = 1; k <= n; k++) {
    if (k === n || (lit[k] > 0) !== (lit[start] > 0)) {
      stops.push(`${lit[start] > 0 ? litColor : darkColor} ${pct(start)} ${pct(k)}`);
      start = k;
    }
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

const pct = (v) => `${Math.round(v * 100)}%`;

// One plain sentence for the chosen moment.
export function momentSentence({ sunFraction, earthFraction, link }) {
  const sun = sunFraction > 0 ? `The Sun is up (${pct(sunFraction)} of its disk above the terrain)` : "The Sun is below the terrain";
  const earth = earthFraction > 0 ? "Earth is in view" : "Earth is hidden by the terrain";
  const dsn = earthFraction > 0 ? (link ? ", and a DSN station can reach it" : ", but no DSN station sees the Moon above 10°") : "";
  return `${sun}. ${earth}${dsn}.`;
}

// "3 h 45 min", "45 min", "2 d 5 h": a countdown from hours on the 15-minute grid.
export function countdown(hours) {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const h = Math.round(minutes / 60);
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// What happens next to the Sun or Earth. change: { up, hours } from timeToChange(); name: "Sun" or "Earth".
// Returns { short, long }: "sets in 3 h 45 min" and "The Sun sets behind the terrain in 3 h 45 min".
export function nextEventText(name, change, maxDays = 30) {
  const who = name === "Sun" ? "The Sun" : "Earth";
  if (change.hours === null) {
    const short = `stays ${change.up ? "up" : "hidden"} for at least ${maxDays} d`;
    return { short, long: `${who} ${short}` };
  }
  const t = countdown(change.hours);
  return {
    short: change.up ? `sets in ${t}` : `rises in ${t}`,
    long: change.up ? `${who} sets behind the terrain in ${t}` : `${who} rises above the terrain in ${t}`,
  };
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// Compass point (16 of them) of an azimuth in degrees from north, any angle.
export function compass(azimuthDeg) {
  const a = ((azimuthDeg % 360) + 360) % 360;
  return POINTS[Math.round(a / 22.5) % 16];
}

// The tooltip for the Sun or Earth: a title and lines. b: { azimuth, elevation, fraction, terrain? } from the
// engine at the spot; terrain is the skyline elevation behind the body.
export function describeBody(name, b) {
  const signed = (v) => `${v < 0 ? "\u2212" : ""}${Math.abs(v).toFixed(2)}\u00b0`;
  const a = ((b.azimuth % 360) + 360) % 360;
  const az = a.toFixed(1) === "360.0" ? "0.0" : a.toFixed(1);
  const seen = b.fraction >= 0.999 ? "fully visible from the spot"
    : b.fraction > 0 ? `${Math.round(b.fraction * 100) || "<1"}% visible from the spot` : "hidden from the spot";
  const lines = [`azimuth ${az}\u00b0 (${compass(b.azimuth)}), elevation ${signed(b.elevation)}`, seen];
  if (Number.isFinite(b.terrain)) lines.push(`skyline there ${signed(b.terrain)}`);
  return { title: name, lines };
}

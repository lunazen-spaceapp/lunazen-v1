// Clearance above the skyline: how far the centre of the Sun or Earth stands above (positive) or below
// (negative) the terrain in its direction, over the window. Pure helpers, then the chart.

import { setupCanvas } from "./panorama.js";

// Colours come from the canvas's own computed style, so a page can keep a chart dark in either theme (the Explorer does).
let scope = null;
const cssVar = (name) => getComputedStyle(scope ?? document.documentElement).getPropertyValue(name).trim();

// Degrees above the skyline at each sample (elevation minus the terrain horizon at the body's azimuth).
export function clearanceSeries(series, horizon) {
  const n = series.et.length;
  const sun = new Float64Array(n);
  const earth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sun[i] = series.sunElevation[i] - horizon.at(series.sunAzimuth[i]);
    earth[i] = series.earthElevation[i] - horizon.at(series.earthAzimuth[i]);
  }
  return { sun, earth };
}

// "clears the skyline by up to 0.45°": the most the centre of the Sun stands above the terrain in its direction over the window,
// the figure that explains a Sun whose highest point above a flat horizon is negative but which is still visible.
export function sunClearsText(series, horizon) {
  const { maxSun } = clearanceStats(series, clearanceSeries(series, horizon).sun);
  return maxSun > 0 ? `clears the skyline by up to ${maxSun.toFixed(2)}°` : "never clears the skyline in this window";
}

// The highest the Sun clears the skyline, and how much of the sunlit time is marginal: sunlit samples
// whose clearance is below nearDeg, so that a skyline error of that size would remove them.
export function clearanceStats(series, sunClearance, nearDeg = 0.25) {
  let best = -Infinity;
  let bestEt = null;
  let sunlit = 0;
  let near = 0;
  for (let i = 0; i < series.et.length; i++) {
    if (sunClearance[i] > best) { best = sunClearance[i]; bestEt = series.et[i]; }
    if (series.sunFraction[i] > 0) {
      sunlit++;
      if (sunClearance[i] < nearDeg) near++;
    }
  }
  return { maxSun: best, maxSunEt: bestEt, sunlitSamples: sunlit, nearSamples: near, nearShare: sunlit ? near / sunlit : null };
}

// One row per skyline error: the window's sunlit share and longest night with the skyline that much higher, beside the actual values.
export function fragilityRows(summary, fragility) {
  return Object.entries(fragility).map(([error, r]) => ({
    error: Number(error),
    sunlit: r.sunlitFraction, sunlitWas: summary.sunlitFraction,
    darkHours: r.longestDarkHours, darkWas: summary.longestDarkHours,
  }));
}

// Two bands (Sun, Earth), each with its own scale and a line at the skyline; the part above it is filled.
// Returns a function mapping a click (clientX) to a sample index, like drawEventChart.
export function drawClearance(canvas, { et, sun, earth, current, dayStarts }) {
  scope = canvas;
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 52, right: 22, top: 14, bottom: 20 };
  const w = width - pad.left - pad.right;
  const t0 = et[0];
  const span = Math.max(et[et.length - 1] - t0, 1);
  const x = (t) => pad.left + ((t - t0) / span) * w;
  const lanes = [["Sun", sun, cssVar("--sun")], ["Earth", earth, cssVar("--earth")]];
  const gap = 12;
  const bandH = (height - pad.top - pad.bottom - gap) / lanes.length;
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px system-ui, sans-serif";

  lanes.forEach(([label, values, color], li) => {
    const y0 = pad.top + li * (bandH + gap);
    let lo = 0;
    let hi = 0;
    for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad2 = Math.max((hi - lo) * 0.08, 0.05);
    lo -= pad2; hi += pad2;
    const y = (v) => y0 + ((hi - v) / (hi - lo)) * bandH;
    ctx.fillStyle = cssVar("--sky");
    ctx.fillRect(pad.left, y0, w, bandH);
    ctx.fillStyle = cssVar("--muted");
    ctx.textAlign = "right";
    ctx.fillText(label, pad.left - 8, y0 + bandH / 2 + 4);
    ctx.fillText(`${hi.toFixed(1)}°`, pad.left - 8, y0 + 10);
    ctx.fillText(`${lo.toFixed(1)}°`, pad.left - 8, y0 + bandH);
    // Above the skyline: filled. The skyline itself: a dashed line.
    const zero = y(0);
    ctx.beginPath();
    ctx.moveTo(x(et[0]), zero);
    for (let i = 0; i < values.length; i++) ctx.lineTo(x(et[i]), y(Math.max(values[i], 0)));
    ctx.lineTo(x(et[values.length - 1]), zero);
    ctx.closePath();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(et[i]), y(v)) : ctx.moveTo(x(et[i]), y(v))));
    ctx.stroke();
    ctx.strokeStyle = cssVar("--muted");
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zero);
    ctx.lineTo(pad.left + w, zero);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssVar("--muted");
    ctx.textAlign = "left";
    ctx.fillText("skyline", pad.left + 4, zero - 4);
  });

  ctx.strokeStyle = cssVar("--grid");
  ctx.fillStyle = cssVar("--muted");
  ctx.textAlign = "center";
  const every = Math.max(1, Math.ceil(dayStarts.length / Math.max(1, Math.floor(w / 64))));
  dayStarts.forEach(({ index, label }, k) => {
    if (k % every) return;
    const gx = x(et[index]);
    ctx.beginPath();
    ctx.moveTo(gx, height - pad.bottom);
    ctx.lineTo(gx, height - pad.bottom + 4);
    ctx.stroke();
    ctx.fillText(label, gx, height - 4);
  });

  ctx.strokeStyle = "#d55e00";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(et[current]), pad.top - 2);
  ctx.lineTo(x(et[current]), height - pad.bottom);
  ctx.stroke();

  return (clientX) => {
    const px = clientX - canvas.getBoundingClientRect().left;
    const i = Math.round(((px - pad.left) / w) * (et.length - 1));
    return Math.min(Math.max(i, 0), et.length - 1);
  };
}

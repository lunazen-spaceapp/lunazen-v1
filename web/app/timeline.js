// Timeline strip: Sun and Earth visible fractions and the DSN link across the window,
// with day ticks and the current-time cursor. Returns a function mapping a click x to an index.

import { setupCanvas } from "./panorama.js";


// Colours come from the canvas's own computed style, so a page can keep a chart dark in either theme (the Explorer does).
let scope = null;
function cssVar(name) {
  return getComputedStyle(scope ?? document.documentElement).getPropertyValue(name).trim();
}

export function drawTimeline(canvas, { series, link, current, dayStarts }) {
  scope = canvas;
  const { ctx, width, height } = setupCanvas(canvas);
  const COLORS = { sun: cssVar("--sun"), earth: cssVar("--earth"), link: cssVar("--link-band") };
  const pad = { left: 38, right: 14, top: 4, bottom: 16 };
  const w = width - pad.left - pad.right;
  const n = series.et.length;
  const x = (i) => pad.left + (i / Math.max(n - 1, 1)) * w;
  const bands = [
    { label: "Sun", values: series.sunFraction, color: COLORS.sun },
    { label: "Earth", values: series.earthFraction, color: COLORS.earth },
    { label: "DSN", values: link, color: COLORS.link },
  ];
  const bandH = (height - pad.top - pad.bottom) / bands.length;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "11px system-ui, sans-serif";
  bands.forEach((band, b) => {
    const top = pad.top + b * bandH;
    const base = top + bandH - 3;
    const scale = bandH - 6;
    ctx.fillStyle = cssVar("--sky");
    ctx.fillRect(pad.left, top, w, bandH - 3);
    ctx.fillStyle = cssVar("--muted");
    ctx.textAlign = "right";
    ctx.fillText(band.label, pad.left - 6, top + bandH / 2 + 4);
    ctx.beginPath();
    ctx.moveTo(x(0), band.line ? base - band.values[0] * scale : base);
    for (let i = 0; i < n; i++) ctx.lineTo(x(i), base - band.values[i] * scale);
    if (band.line) {
      ctx.strokeStyle = band.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.lineTo(x(n - 1), base);
      ctx.closePath();
      ctx.fillStyle = band.color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });

  ctx.strokeStyle = cssVar("--grid");
  ctx.fillStyle = cssVar("--muted");
  ctx.textAlign = "center";
  const every = Math.max(1, Math.ceil(dayStarts.length / Math.max(1, Math.floor(w / 46)))); // ~46 px per label
  dayStarts.forEach(({ index, label }, k) => {
    ctx.beginPath();
    ctx.moveTo(x(index), pad.top);
    ctx.lineTo(x(index), height - pad.bottom);
    ctx.stroke();
    if (k % every === 0) ctx.fillText(label, x(index), height - 4);
  });

  ctx.strokeStyle = "#d55e00";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(current), pad.top);
  ctx.lineTo(x(current), height - pad.bottom);
  ctx.stroke();

  return (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const i = Math.round(((clientX - rect.left - pad.left) / w) * (n - 1));
    return Math.min(Math.max(i, 0), n - 1);
  };
}

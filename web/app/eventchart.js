// Over this period: three bands (Sun, Earth, DSN in view) across the window, a bracket on the
// longest night, and the chosen moment. Returns a function mapping a click (clientX) to a sample index.

import { setupCanvas } from "./panorama.js";

// Colours come from the canvas's own computed style, so a page can keep a chart dark in either theme (the Explorer does).
let scope = null;
const cssVar = (name) => getComputedStyle(scope ?? document.documentElement).getPropertyValue(name).trim();

// levels: { sun, earth, dsn } integer arrays (sun 0/1, earth 0/1/2, dsn 0/1);
// night: [start, end) sample indexes of the longest night, or null, with its label nightText.
export function drawEventChart(canvas, { et, levels, current, dayStarts, night = null, nightText = "", nightOver = false, spanS = null }) {
  scope = canvas;
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 52, right: 22, top: 24, bottom: 20 };
  const w = width - pad.left - pad.right;
  const t0 = et[0];
  const span = Math.max(spanS ?? et[et.length - 1] - t0, 1);
  const x = (t) => pad.left + ((t - t0) / span) * w;
  const colors = { sun: cssVar("--sun"), earth: cssVar("--earth"), dsn: cssVar("--link-band") };
  const lanes = [["sun", "Sun", 1], ["earth", "Earth", 2], ["dsn", "DSN", 1]];
  const gap = 8;
  const bandH = (height - pad.top - pad.bottom - gap * (lanes.length - 1)) / lanes.length;
  const half = (et[1] - et[0]) / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px system-ui, sans-serif";

  lanes.forEach(([lane, label, top], li) => {
    const y0 = pad.top + li * (bandH + gap);
    ctx.fillStyle = cssVar("--sky");
    ctx.fillRect(pad.left, y0, w, bandH);
    ctx.fillStyle = cssVar("--muted");
    ctx.textAlign = "right";
    ctx.fillText(label, pad.left - 8, y0 + bandH / 2 + 4);
    // Runs of one level, drawn as blocks: full colour at the top level, half colour in between.
    const lv = levels[lane];
    let start = 0;
    for (let k = 1; k <= lv.length; k++) {
      if (k < lv.length && lv[k] === lv[start]) continue;
      if (lv[start] > 0) {
        ctx.globalAlpha = lv[start] === top ? 1 : 0.45;
        ctx.fillStyle = colors[lane];
        const x0 = x(et[start] - (start ? half : 0));
        const x1 = x(et[k - 1] + (k < lv.length ? half : 0));
        ctx.fillRect(x0, y0, Math.max(x1 - x0, 1), bandH);
        ctx.globalAlpha = 1;
      }
      start = k;
    }
  });

  // Day labels about every 60 px.
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

  // The longest night: a bracket above the Sun band.
  if (night) {
    const a = x(et[night[0]]);
    const b = x(et[night[1] - 1]);
    const ink = nightOver ? cssVar("--bad") : cssVar("--fg"); // vermilion when the night breaks the limit
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a, pad.top - 3);
    ctx.lineTo(a, pad.top - 8);
    ctx.lineTo(b, pad.top - 8);
    ctx.lineTo(b, pad.top - 3);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = "bold 12px system-ui, sans-serif";
    const text = nightText;
    const tw = ctx.measureText(text).width;
    ctx.textAlign = "left";
    ctx.fillText(text, Math.min(Math.max((a + b) / 2 - tw / 2, pad.left), width - pad.right - tw), pad.top - 11);
  }

  if (current !== null && current !== undefined) { // the chosen moment (a chart of a whole mission has none)
    ctx.strokeStyle = "#d55e00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(et[current]), pad.top - 2);
    ctx.lineTo(x(et[current]), height - pad.bottom);
    ctx.stroke();
  }

  return (clientX) => {
    const px = clientX - canvas.getBoundingClientRect().left;
    const i = Math.round(((px - pad.left) / w) * (et.length - 1));
    return Math.min(Math.max(i, 0), et.length - 1);
  };
}

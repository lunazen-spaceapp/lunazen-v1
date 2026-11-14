// The annual visibility timeline in the shared lane style (Explorer, Planner): per spot a block with its name and two 14 px lanes,
// Sun (gold) and DSN (green), on a dark track, with month or day ticks underneath. The canvas stays dark in both themes.
// Returns locate(clientX, clientY) -> {lane, index} | null.

import { setupCanvas } from "./panorama.js";

const SUN = "#e9a63a", DSN = "#3fb58c", TRACK = "#0d1118", TEXT = "#e9ecf1", MUTED = "#8e95a3", GRID = "#1e222b";
const LANE = 14, GAP = 3, TITLE = 20, BLOCK = TITLE + LANE * 2 + GAP + 12, AXIS = 22;

export function drawLanes(canvas, lanes, ticks) {
  canvas.style.height = `${lanes.length * BLOCK + AXIS + 6}px`;
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 38, right: 14, top: 6 };
  const w = width - pad.left - pad.right;
  ctx.clearRect(0, 0, width, height);
  const n = lanes[0]?.sun.length || 1;
  const x = (i) => pad.left + (i / Math.max(n - 1, 1)) * w;
  ctx.textBaseline = "middle";
  lanes.forEach((lane, k) => {
    const top = pad.top + k * BLOCK;
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = TEXT;
    ctx.textAlign = "left";
    ctx.fillText(lane.label, 2, top + TITLE / 2);
    [["Sun", lane.sun, SUN, top + TITLE], ["DSN", lane.link, DSN, top + TITLE + LANE + GAP]].forEach(([name, values, color, y0]) => {
      ctx.fillStyle = TRACK;
      ctx.fillRect(pad.left, y0, w, LANE);
      ctx.fillStyle = color;
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && values[i] > 0;
        if (on && start < 0) start = i;
        if (!on && start >= 0) { ctx.fillRect(x(start), y0, Math.max(x(i - 1) - x(start), 1), LANE); start = -1; }
      }
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = MUTED;
      ctx.textAlign = "right";
      ctx.fillText(name, pad.left - 6, y0 + LANE / 2);
    });
  });
  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  const every = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor(w / 56))));
  const axisY = pad.top + lanes.length * BLOCK;
  ticks.forEach(({ index, label }, k) => {
    const tx = x(index);
    ctx.beginPath();
    ctx.moveTo(tx, pad.top);
    ctx.lineTo(tx, axisY);
    ctx.stroke();
    if (k % every === 0) ctx.fillText(label, tx, axisY + 12);
  });
  return (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const lane = Math.floor((clientY - r.top - pad.top) / BLOCK);
    if (px < pad.left || px > pad.left + w || lane < 0 || lane >= lanes.length) return null;
    return { lane, index: Math.min(n - 1, Math.max(0, Math.round(((px - pad.left) / w) * (n - 1)))) };
  };
}

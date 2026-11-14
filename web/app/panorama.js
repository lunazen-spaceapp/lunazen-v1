// The horizon panorama: azimuth 0-360 deg across, elevation up the side, terrain filled
// below the horizon H(A) (whole sky, or a window of `span` degrees around `center` at true scale), the Sun and Earth at the current time (a centre marker and a bar
// from the upper to the lower limb), and their tracks over the window. Heights are exaggerated or compressed relative to azimuth (labelled on screen).


export function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

// Colours come from the canvas's own computed style, so a container can restyle it (the home hero).
let scope = null;
function cssVar(name) {
  return getComputedStyle(scope ?? document.documentElement).getPropertyValue(name).trim();
}

// Signed azimuth offset of az from center, in [-180, 180).
export function azOffset(az, center) {
  return ((((az - center) % 360) + 540) % 360) - 180;
}

// Vertical range (deg) for a zoomed window: true scale (span deg across the plot width means
// span * h / w deg up the side) when the skyline and the two bodies fit, otherwise the smallest
// stretch that fits them. Returns { range: [lo, hi], stretch } with stretch = 1 at true scale.
// With exact, a window too tall for true scale is clipped rather than stretched; then `focus` (the body
// the window is centred on) always stays in frame, and another body joins the range only if it still fits,
// so a hidden Sun far below the skyline cannot push a high Earth out of the picture.
export function windowRange(horizon, bodies, center, span, aspect, exact = false, focus = null) {
  const n = horizon.n;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < n; k++) {
    if (Math.abs(azOffset((k * 360) / n, center)) > span / 2) continue;
    lo = Math.min(lo, horizon.elevation[k]);
    hi = Math.max(hi, horizon.elevation[k]);
  }
  const trueSpan = span * aspect;
  const inside = (b) => Math.abs(azOffset(b.azimuth, center)) <= span / 2;
  const add = (b) => { lo = Math.min(lo, b.elevation - b.radius); hi = Math.max(hi, b.elevation + b.radius); };
  if (exact && focus && inside(focus)) add(focus);
  for (const b of bodies) {
    if (!inside(b) || (exact && focus && b !== focus && (Math.max(hi, b.elevation + b.radius) - Math.min(lo, b.elevation - b.radius) + 1 > trueSpan * 0.9))) continue;
    add(b);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
  const need = hi - lo + 1;
  if (need <= trueSpan * 0.9) {
    // Skyline in the lower third, so there is room above it for the Sun and Earth.
    const bottom = lo - trueSpan * 0.25;
    return { range: [bottom, bottom + trueSpan], stretch: 1 };
  }
  const mid = (hi + lo) / 2;
  if (exact) {
    let bottom = mid - trueSpan / 2;
    if (focus && inside(focus)) { // keep the focus body in frame, with a degree to spare
      bottom = Math.min(bottom, focus.elevation - focus.radius - 1);
      bottom = Math.max(bottom, focus.elevation + focus.radius + 1 - trueSpan);
    }
    return { range: [bottom, bottom + trueSpan], stretch: 1 };
  }
  return { range: [mid - need / 2 - 0.5, mid + need / 2 + 0.5], stretch: trueSpan / (need + 1) };
}

// discs: draw each body as its full disk (an ellipse, a circle at true scale) instead of a limb bar.
// Where a body's label sits, as the baseline offset from its dot (px, down is positive). Beside the dot at its own level
// (+4) unless the dot is within 12 px of the skyline or the horizon line, where the text would sit on the line: then above
// the dot (-9), or below it (+17) if there is no room above (`room` px between the dot and the top of the plot).
export function labelOffset(dotY, skylineY, horizonY, room) {
  const near = (line) => Math.abs(dotY - line) < 12;
  if (!near(skylineY) && !near(horizonY)) return 4;
  return room >= 22 ? -9 : 17;
}

export function drawPanorama(canvas, { horizon, range, tracks, now, center = 180, span = 360, stretch = null, discs = false }) {
  scope = canvas;
  const COLORS = { sun: cssVar("--sun") || "#e69f00", earth: cssVar("--earth") || "#0072b2" };
  const { ctx, width, height } = setupCanvas(canvas);
  const pad = { left: 54, right: 26, top: 12, bottom: 26 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  if (w <= 0 || h <= 0) return; // the canvas is hidden or not laid out yet; a redraw follows when it gets a size
  const [lo, hi] = range;
  const x = (az) => pad.left + (azOffset(az, center) / span + 0.5) * w;
  const xOff = (d) => pad.left + (d / span + 0.5) * w;
  const whole = span >= 360;
  const y = (el) => pad.top + ((hi - el) / (hi - lo)) * h;
  const pxPerDegX = w / span;
  const pxPerDegY = h / (hi - lo);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssVar("--sky");
  ctx.fillRect(pad.left, pad.top, w, h);

  // Grid and labels.
  ctx.strokeStyle = cssVar("--grid");
  ctx.fillStyle = cssVar("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  const azStep = whole ? (w < 520 ? 90 : 30) : span > 120 ? 30 : span > 50 ? 10 : 5;
  const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  const first = Math.ceil((center - span / 2) / azStep) * azStep;
  ctx.textAlign = "center";
  for (let a = first; a <= center + span / 2 + 1e-9; a += azStep) {
    const az = ((a % 360) + 360) % 360;
    const gx = whole && a === 360 ? x(360) : xOff(a - center);
    ctx.beginPath();
    ctx.moveTo(gx, pad.top);
    ctx.lineTo(gx, pad.top + h);
    ctx.stroke();
    ctx.fillText(names[az] ? `${names[az]} ${az}°` : `${az}°`, gx, height - 8);
  }
  const step = hi - lo > 120 ? 30 : hi - lo > 60 ? 20 : hi - lo > 30 ? 10 : hi - lo > 12 ? 4 : hi - lo > 6 ? 2 : 1;
  ctx.textAlign = "right";
  for (let el = Math.ceil(lo / step) * step; el <= hi; el += step) {
    ctx.beginPath();
    ctx.moveTo(pad.left, y(el));
    ctx.lineTo(pad.left + w, y(el));
    ctx.strokeStyle = el === 0 ? cssVar("--zero") : cssVar("--grid");
    ctx.stroke();
    ctx.fillText(el === 0 ? "0° level" : `${el}°`, pad.left - 6, y(el) + 4);
  }

  // Tracks over the window (broken where azimuth wraps through north).
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, w, h);
  ctx.clip();
  for (const [key, color] of [["sun", COLORS.sun], ["earth", COLORS.earth]]) {
    const { az, el } = tracks[key];
    ctx.strokeStyle = color;
    ctx.globalAlpha = key === "sun" ? 0.55 : 0.35;
    ctx.lineWidth = key === "sun" ? 2.5 : 1.5;
    ctx.beginPath();
    for (let i = 0; i < az.length; i++) {
      if (i === 0 || Math.abs(az[i] - az[i - 1]) > 180 || Math.abs(x(az[i]) - x(az[i - 1])) > w / 2) ctx.moveTo(x(az[i]), y(el[i]));
      else ctx.lineTo(x(az[i]), y(el[i]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Limb bars: the disk's true extent in elevation (upper to lower limb), as horizon plots
  // usually show it. Drawn behind the terrain, so the skyline hides the part of the disk it covers.
  ctx.lineCap = "butt";
  for (const [key, color] of [["sun", COLORS.sun], ["earth", COLORS.earth]]) {
    const b = now[key];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (discs) {
      ctx.beginPath();
      ctx.ellipse(x(b.azimuth), y(b.elevation), b.radius * pxPerDegX, b.radius * pxPerDegY, 0, 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x(b.azimuth), y(b.elevation + b.radius));
    ctx.lineTo(x(b.azimuth), y(b.elevation - b.radius));
    ctx.stroke();
  }

  // Terrain in front: everything below the horizon (samples around the window, wrapped through north).
  const n = horizon.n;
  const dAz = 360 / n;
  ctx.beginPath();
  let started = false;
  let lastX = pad.left;
  for (let k = -n; k <= 2 * n; k++) {
    const d = k * dAz - center;
    if (Math.abs(d) > span / 2 + dAz) continue;
    const px = xOff(d);
    if (!started) { ctx.moveTo(px, pad.top + h); started = true; }
    ctx.lineTo(px, y(horizon.elevation[((k % n) + n) % n]));
    lastX = px;
  }
  ctx.lineTo(lastX, pad.top + h);
  ctx.closePath();
  ctx.fillStyle = cssVar("--terrain");
  ctx.fill();
  ctx.strokeStyle = cssVar("--terrain-edge");
  ctx.stroke();
  ctx.restore();

  const dAzLabel = 360 / horizon.n;
  // In front of the terrain, so a hidden Sun or Earth can still be found: the limb bar's full
  // extent (dashed, with end ticks), a centre marker (filled if any part is visible, dashed if
  // hidden) and the engine's visible fraction.
  for (const [key, color, label] of [["sun", COLORS.sun, "Sun"], ["earth", COLORS.earth, "Earth"]]) {
    const b = now[key];
    if (Math.abs(azOffset(b.azimuth, center)) > span / 2) continue;
    const cx = x(b.azimuth);
    const top = y(b.elevation + b.radius);
    const bottom = y(b.elevation - b.radius);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    if (discs) {
      // An outline of the whole disk (at least 4 px across, so a small one can be found).
      const rx = Math.max(b.radius * pxPerDegX, 4);
      const ry = Math.max(b.radius * pxPerDegY, 4);
      // Visible (any part): a solid outline with a light fill in the body's colour. Hidden: a dashed outline with the sky inside.
      ctx.beginPath();
      ctx.ellipse(cx, y(b.elevation), rx + 1, ry + 1, 0, 0, 2 * Math.PI);
      if (b.fraction > 0) {
        ctx.save(); ctx.globalAlpha = 0.3; ctx.fill(); ctx.restore();
        ctx.stroke();
      } else {
        ctx.save(); ctx.fillStyle = cssVar("--sky"); ctx.fill(); ctx.restore();
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const ty of [top, bottom]) { ctx.moveTo(cx - 5, ty); ctx.lineTo(cx + 5, ty); }
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (b.fraction > 0) { ctx.arc(cx, y(b.elevation), 5, 0, 2 * Math.PI); ctx.fill(); }
      else { // behind the terrain: a larger hollow ring (sky inside), clearly not the filled dot
        ctx.arc(cx, y(b.elevation), 6.5, 0, 2 * Math.PI);
        ctx.save(); ctx.fillStyle = cssVar("--sky"); ctx.fill(); ctx.restore();
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.font = "bold 12px system-ui, sans-serif";
    const text = b.fraction >= 0.999 ? label : b.fraction > 0 ? `${label} ${Math.round(b.fraction * 100) || "<1"}% visible` : `${label} (hidden)`;
    const gap = discs ? Math.max(b.radius * pxPerDegX, 4) + 8 : 10;
    const onRight = cx + gap + 2 + ctx.measureText(text).width < pad.left + w;
    ctx.textAlign = onRight ? "left" : "right";
    const skylineEl = horizon.elevation[((Math.round(b.azimuth / dAzLabel) % horizon.n) + horizon.n) % horizon.n];
    const ty = y(b.elevation) + labelOffset(y(b.elevation), y(skylineEl), y(0), y(b.elevation) - pad.top);
    // A halo in the sky colour keeps the label readable where it crosses the terrain.
    const keep = ctx.strokeStyle, keepWidth = ctx.lineWidth;
    ctx.strokeStyle = cssVar("--sky");
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.strokeText(text, cx + (onRight ? gap : -gap), ty);
    ctx.strokeStyle = keep;
    ctx.lineWidth = keepWidth;
    ctx.fillText(text, cx + (onRight ? gap : -gap), ty);
    ctx.font = "11px system-ui, sans-serif";
  }

  ctx.textAlign = "left";
  ctx.fillStyle = cssVar("--muted");
  const factor = stretch ?? pxPerDegY / pxPerDegX;
  const scaleText = factor < 0.9 ? `heights compressed ${(1 / factor).toFixed(1)}×` : factor < 1.1 ? "true scale" : `heights exaggerated ${factor.toFixed(factor < 10 ? 1 : 0)}×`;
  const note = whole ? scaleText : `${Math.round(span)}° wide, ${scaleText}`;
  // On a narrow picture the width is dropped so the note does not run past the frame.
  ctx.fillText(ctx.measureText(note).width > w - 12 ? scaleText : note, pad.left + 6, pad.top + 14);
}

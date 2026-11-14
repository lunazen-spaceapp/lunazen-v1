// 3D terrain view for the Explorer: a patch (pipeline/export_terrain3d.py) of three nested
// height grids in the east-north-up frame of its origin, lit by the Sun and shadowed by the
// terrain itself. WebGL2, no libraries. Sunlight at each vertex is found by marching toward
// the Sun through the same grids (curvature is already in the heights), and a partly hidden
// Sun dims the light the way the engine's disk fraction does. The view illustrates the
// horizon model; the numbers on the page come from the engine.

const DEG = Math.PI / 180;

// Unit east-north-up vector of a direction given by azimuth (from north, clockwise) and elevation.
export function enuFromAzEl(azimuthDeg, elevationDeg) {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

// header: one entry of terrain3d/index.json; buffer: its .bin. Returns grids finest first,
// each { name, n, halfM, spacingM, heights: Float32Array (row 0 = northern edge) }.
export function parsePatch(header, buffer) {
  return header.grids.map((g) => {
    const q = new Uint16Array(buffer, g.byteOffset, g.n * g.n);
    const heights = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) heights[i] = g.offsetM + q[i] * g.scaleM;
    return { name: g.name, n: g.n, halfM: g.halfM, spacingM: g.spacingM, heights };
  });
}

const VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uH0, uH1, uH2;      // inner, near, context heights (R32F)
uniform vec3 uGrid0, uGrid1, uGrid2;  // (n, half, spacing) per grid
uniform int uLevel;                   // which grid this draw call meshes
uniform mat4 uViewProj;
uniform vec3 uSun;                    // unit ENU direction
uniform float uSunRadius;             // radians
out vec3 vPos;
out vec3 vNormal;
out float vLight;

float fetchGrid(sampler2D t, vec3 g, vec2 xy, out bool ok) {
  float col = (xy.x + g.y) / g.z;
  float row = (g.y - xy.y) / g.z;
  ok = col >= 0.0 && row >= 0.0 && col < g.x - 1.0 && row < g.x - 1.0;
  if (!ok) return 0.0;
  ivec2 c = ivec2(floor(col), floor(row));
  vec2 f = vec2(col, row) - vec2(c);
  float a = texelFetch(t, c, 0).r, b = texelFetch(t, c + ivec2(1, 0), 0).r;
  float d = texelFetch(t, c + ivec2(0, 1), 0).r, e = texelFetch(t, c + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

// Finest grid that covers xy; ok = false outside the patch.
float heightAt(vec2 xy, out bool ok) {
  float h = fetchGrid(uH0, uGrid0, xy, ok); if (ok) return h;
  h = fetchGrid(uH1, uGrid1, xy, ok); if (ok) return h;
  return fetchGrid(uH2, uGrid2, xy, ok);
}

void main() {
  vec3 g = uLevel == 0 ? uGrid0 : uLevel == 1 ? uGrid1 : uGrid2;
  int n = int(g.x);
  int col = gl_VertexID % n, row = gl_VertexID / n;
  vec2 xy = vec2(-g.y + float(col) * g.z, g.y - float(row) * g.z);
  float h = uLevel == 0 ? texelFetch(uH0, ivec2(col, row), 0).r : uLevel == 1 ? texelFetch(uH1, ivec2(col, row), 0).r : texelFetch(uH2, ivec2(col, row), 0).r;
  vPos = vec3(xy, h);
  bool ok;
  float s = g.z;
  float hx = heightAt(xy + vec2(s, 0.0), ok); if (!ok) hx = h;
  float hy = heightAt(xy + vec2(0.0, s), ok); if (!ok) hy = h;
  vNormal = normalize(vec3(h - hx, h - hy, s));

  // March toward the Sun: the highest terrain angle along its azimuth, seen from this vertex.
  vec2 dir = normalize(uSun.xy + vec2(1e-9));
  float tanEl = uSun.z / max(length(uSun.xy), 1e-6);
  float best = -1e9;
  float d = max(g.z, 5.0);
  for (int k = 0; k < 220; k++) {
    float th = heightAt(xy + dir * d, ok);
    if (!ok) break;
    best = max(best, (th - h - 0.5) / d);
    d = max(d + g.z, d * 1.04);
  }
  float margin = atan(tanEl) - atan(best);   // Sun centre above the terrain, radians
  float fraction = clamp(0.5 + margin / (2.0 * uSunRadius), 0.0, 1.0);
  // Tone curve: grazing light on flat ground is physically very dim; lift it so lit and
  // shadowed ground read apart, while full shadow stays dark.
  vLight = fraction * (0.3 + 0.7 * sqrt(max(dot(vNormal, uSun), 0.0)));
  gl_Position = uViewProj * vec4(vPos, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform int uLevel;
uniform vec3 uGrid0, uGrid1;
uniform vec3 uRock, uShade;
uniform vec3 uEye;
uniform float uPhoto;       // 1 in the sky view: decorative regolith texture, fading with distance
in vec3 vPos;
in vec3 vNormal;
in float vLight;
out vec4 colour;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // Each grid gives way to the finer one inside it (one cell of overlap hides the seam).
  if (uLevel == 1 && max(abs(vPos.x), abs(vPos.y)) < uGrid0.y - uGrid0.z) discard;
  if (uLevel == 2 && max(abs(vPos.x), abs(vPos.y)) < uGrid1.y - uGrid1.z) discard;
  float relief = 0.5 + 0.5 * normalize(vNormal).z;            // faint fill so shadowed relief stays readable
  vec3 c = mix(uShade, uRock, clamp(vLight * 1.15, 0.0, 1.0)) + 0.05 * relief;
  if (uPhoto > 0.5) {
    // Decorative grain: the measured terrain has no boulders or small craters, so the near ground gets noise.
    float fade = 1.0 - smoothstep(60.0, 1500.0, length(vPos - uEye));
    float n = vnoise(vPos.xy * 0.9) * 0.5 + vnoise(vPos.xy * 3.7) * 0.3 + vnoise(vPos.xy * 13.0) * 0.2;
    c *= 1.0 + (n - 0.5) * 0.55 * fade;
  }
  colour = vec4(c, 1.0);
}`;

// Sun and Earth: camera-facing disks far out along their directions, drawn after the terrain
// with the depth test on, so ridges hide them exactly where the terrain rises above them.
const DISK_VERTEX = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
uniform vec3 uCenter, uRight, uUp;
uniform float uRadius;
uniform float uScale;       // quad size in disk radii (> 1 leaves room for the Sun's glare)
out vec2 vUV;
void main() {
  vec2 corner = vec2(gl_VertexID % 2 == 0 ? -1.0 : 1.0, gl_VertexID < 2 ? -1.0 : 1.0) * uScale;
  vUV = corner;
  gl_Position = uViewProj * vec4(uCenter + (corner.x * uRight + corner.y * uUp) * uRadius, 1.0);
}`;

const DISK_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform int uKind;          // 0 Sun, 1 Earth
uniform vec3 uSunLocal;     // Sun direction in the disk's (right, up, toward viewer) basis
uniform vec3 uColour;
uniform float uGlare;       // 1 in the sky view
uniform float uScaleMax;    // the quad half-size in disk radii
in vec2 vUV;
out vec4 colour;
void main() {
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) {
    // Camera glare around the Sun (the Moon has no atmosphere: the Sun itself stays white).
    float a = uKind == 0 && uGlare > 0.5 ? 0.55 * exp(-(sqrt(r2) - 1.0) * 1.6) * (1.0 - smoothstep(1.0, uScaleMax, sqrt(r2))) : 0.0;
    if (a < 0.01) discard;
    colour = vec4(1.0, 0.98, 0.95, a);
    return;
  }
  if (uKind == 0) {
    colour = vec4(vec3(1.0, 0.98, 0.95) * (0.62 + 0.38 * sqrt(1.0 - r2)), 1.0);  // white, with limb darkening
  } else {
    vec3 n = vec3(vUV, sqrt(1.0 - r2));                 // Earth's lit half faces the Sun
    float lit = smoothstep(-0.06, 0.06, dot(n, uSunLocal));
    colour = vec4(mix(vec3(0.07, 0.09, 0.14), uColour, lit), 1.0);
  }
}`;

// Decorative stars for the sky view: fixed points on the sky above the horizon.
const STAR_VERTEX = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
uniform vec3 uEye;
in vec4 aStar;             // xyz direction, w brightness
out float vB;
void main() {
  vB = aStar.w;
  gl_Position = uViewProj * vec4(uEye + aStar.xyz * 100000.0, 1.0);
  gl_PointSize = 1.0 + 1.6 * aStar.w;
}`;

const STAR_FRAGMENT = `#version 300 es
precision highp float;
in float vB;
out vec4 colour;
void main() { colour = vec4(vec3(0.45 + 0.55 * vB), 1.0); }`;

function starField(count = 450) {
  const out = new Float32Array(count * 4);
  let s = 12345;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < count; i++) {
    const z = rand() * 1.05 - 0.05;                       // upper hemisphere (a little below the horizon is hidden by the ground)
    const phi = rand() * 2 * Math.PI;
    const r = Math.sqrt(1 - z * z);
    out.set([r * Math.cos(phi), r * Math.sin(phi), z, rand() ** 3], i * 4);
  }
  return out;
}

// The far skyline: the engine's horizon profile (terrain out to 300 km) as a dark wall 100 km out,
// nearer than the Sun and Earth (150 km) and farther than the patch (60 km). Without it the sky
// would show through where terrain beyond the patch really hides a body.
const RING_VERTEX = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
in vec3 aPos;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const RING_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 uColour;
out vec4 colour;
void main() { colour = vec4(uColour, 1.0); }`;

const RING_RADIUS_M = 100000;
const BODY_DISTANCE_M = 150000;
const SPACE = [2 / 255, 3 / 255, 5 / 255]; // the sky in every view: the Moon has no atmosphere to colour it

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function gridIndices(n) {
  const out = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const i = r * n + c;
      out.set([i, i + n, i + 1, i + 1, i + n, i + n + 1], k);
      k += 6;
    }
  }
  return out;
}

// Column-major 4x4 helpers.
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return w > 0 ? [x / w, y / w] : null;
}

export class TerrainView {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.gl = canvas.getContext("webgl2", { antialias: true });
    if (!this.gl) throw new Error("WebGL2 is not available in this browser");
    const gl = this.gl;
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.vao = gl.createVertexArray();
    this.diskProgram = gl.createProgram();
    gl.attachShader(this.diskProgram, compile(gl, gl.VERTEX_SHADER, DISK_VERTEX));
    gl.attachShader(this.diskProgram, compile(gl, gl.FRAGMENT_SHADER, DISK_FRAGMENT));
    gl.linkProgram(this.diskProgram);
    if (!gl.getProgramParameter(this.diskProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.diskProgram));
    this.diskVao = gl.createVertexArray();
    this.starProgram = gl.createProgram();
    gl.attachShader(this.starProgram, compile(gl, gl.VERTEX_SHADER, STAR_VERTEX));
    gl.attachShader(this.starProgram, compile(gl, gl.FRAGMENT_SHADER, STAR_FRAGMENT));
    gl.bindAttribLocation(this.starProgram, 0, "aStar");
    gl.linkProgram(this.starProgram);
    if (!gl.getProgramParameter(this.starProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.starProgram));
    this.starVao = gl.createVertexArray();
    gl.bindVertexArray(this.starVao);
    this.ringProgram = gl.createProgram();
    gl.attachShader(this.ringProgram, compile(gl, gl.VERTEX_SHADER, RING_VERTEX));
    gl.attachShader(this.ringProgram, compile(gl, gl.FRAGMENT_SHADER, RING_FRAGMENT));
    gl.bindAttribLocation(this.ringProgram, 0, "aPos");
    gl.linkProgram(this.ringProgram);
    if (!gl.getProgramParameter(this.ringProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.ringProgram));
    this.ringVao = gl.createVertexArray();
    this.ringBuffer = gl.createBuffer();
    this.horizon = null;
    gl.bindVertexArray(this.starVao);
    this.stars = starField();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, this.stars, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    this.indexCache = new Map();
    this.camera = { mode: "orbit", azimuth: 0, elevation: 14, distance: 6000, fov: 45 };
    this.sky = null;
    this.target = [0, 0, 0];
    this.bindPointer();
  }

  setPatch(header, grids) {
    const gl = this.gl;
    this.header = header;
    this.grids = grids;
    this.textures = grids.map((g) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, g.n, g.n, 0, gl.RED, gl.FLOAT, g.heights);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      return t;
    });
    for (const g of grids) {
      if (this.indexCache.has(g.n)) continue;
      const buffer = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      const indices = gridIndices(g.n);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.indexCache.set(g.n, { buffer, count: indices.length });
    }
  }

  // Marker (east, north, up) of the selected spot, and the patch-origin height at it.
  setTarget(enu) {
    this.target = enu;
  }

  // sky: { sun, earth }, each { azimuth, elevation, radius (deg), fraction } from the engine at the spot
  setSky(sky) {
    this.sky = sky;
    if (this.follow && this.camera.mode === "sky") this.aimAt(this.follow); // keep a zoomed body centred as time moves
  }

  aimAt(body) {
    const b = this.sky[body];
    Object.assign(this.camera, { azimuth: b.azimuth, elevation: Math.max(b.elevation, 0) });
  }

  // horizon: the engine's Horizon for the spot (elevation of the skyline in every direction).
  setHorizon(horizon) {
    this.horizon = horizon;
  }

  // Face the Sun or the Earth with a given field of view (degrees), from the spot, and keep facing it as the
  // sky changes (dragging the view lets go). A body below the skyline is faced at horizon level.
  lookAt(body, fov) {
    if (!this.sky) return;
    this.camera.mode = "sky";
    this.camera.fov = fov;
    this.follow = body;
    this.aimAt(body);
    this.draw();
  }

  // Modes: "orbit" (fly around) and "sky" (level view from the spot; lookAt() zooms it onto a body).
  setMode(mode) {
    this.camera.mode = mode;
    this.follow = null;
    if (this.sky) {
      Object.assign(this.camera, this.defaultView(mode));
    }
    this.draw();
  }

  defaultView(mode) {
    const { sun, earth } = this.sky;
    if (mode === "orbit") return { azimuth: (sun.azimuth + 200) % 360, elevation: 14, fov: 45 };
    // Sky view: level, wide, facing Earth when it is up and the Sun otherwise.
    return { azimuth: earth.fraction > 0 ? earth.azimuth : sun.azimuth, elevation: 8, fov: 50 };
  }

  resetCamera() {
    this.camera.distance = 6000;
    this.setMode(this.camera.mode);
  }

  bindPointer() {
    let drag = null;
    const hit = (e) => {
      const box = this.canvas.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const m = (this.markers ?? []).find((k) => Math.hypot(k.x - x, k.y - y) <= k.r + 10);
      return m ? { key: m.key, x, y } : null;
    };
    this.canvas.addEventListener("pointerdown", (e) => { this.canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, az: this.camera.azimuth, el: this.camera.elevation, moved: false }; });
    this.canvas.addEventListener("pointerleave", () => { if (!drag) this.onHover?.(null); });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) { this.onHover?.(hit(e)); return; }
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) { drag.moved = true; this.follow = null; this.onHover?.(null); }
      const orbit = this.camera.mode === "orbit";
      const k = orbit ? 1 : this.camera.fov / 60;  // pan more finely when zoomed in
      this.camera.azimuth = (drag.az - (e.clientX - drag.x) * 0.3 * k + 360) % 360;
      const limit = orbit ? [3, 85] : [-20, 40];
      this.camera.elevation = Math.min(Math.max(drag.el + (e.clientY - drag.y) * 0.2 * k * (orbit ? 1 : -1), limit[0]), limit[1]);
      this.draw();
    });
    this.canvas.addEventListener("pointerup", (e) => {
      // A tap on a touch screen has no hover: show the tooltip for a few seconds instead.
      if (drag && !drag.moved && e.pointerType === "touch") {
        this.onHover?.(hit(e));
        setTimeout(() => this.onHover?.(null), 4000);
      }
      drag = null;
    });
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.15 : 0.87;
      if (this.camera.mode === "orbit") this.camera.distance = Math.min(Math.max(this.camera.distance * f, 400), 30000);
      else this.camera.fov = Math.min(Math.max(this.camera.fov * f, 1.5), 75);  // zoom by field of view
      this.draw();
    }, { passive: false });
  }

  matrices() {
    const { canvas, camera, target } = this;
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    if (camera.mode === "orbit") {
      const dir = enuFromAzEl(camera.azimuth, camera.elevation);
      const eye = [target[0] + dir[0] * camera.distance, target[1] + dir[1] * camera.distance, target[2] + dir[2] * camera.distance];
      return { eye, viewProj: multiply(perspective(45 * DEG, aspect, camera.distance / 200, 400000), lookAt(eye, target, [0, 0, 1])) };
    }
    // Standing at the spot, 2 m up, looking along the camera azimuth (dragging pans).
    const eye = [target[0], target[1], target[2] + 2];
    const look = enuFromAzEl(camera.azimuth, camera.elevation);
    const at = [eye[0] + look[0], eye[1] + look[1], eye[2] + look[2]];
    return { eye, viewProj: multiply(perspective(camera.fov * DEG, aspect, 0.5, 200000), lookAt(eye, at, [0, 0, 1])) };
  }

  draw({ overlay = true } = {}) {
    const { gl, canvas } = this;
    if (!this.grids || !this.sky) return;
    const photo = this.camera.mode === "sky";
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const orbit = this.camera.mode === "orbit";
    gl.viewport(0, 0, w, h);
    gl.clearColor(SPACE[0], SPACE[1], SPACE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { eye, viewProj } = this.matrices();
    this.drawStars(viewProj, eye);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const u = (name) => gl.getUniformLocation(this.program, name);
    gl.uniformMatrix4fv(u("uViewProj"), false, viewProj);
    gl.uniform3fv(u("uEye"), eye);
    gl.uniform1f(u("uPhoto"), orbit ? 0 : 1);
    gl.uniform3fv(u("uSun"), enuFromAzEl(this.sky.sun.azimuth, this.sky.sun.elevation));
    gl.uniform1f(u("uSunRadius"), this.sky.sun.radius * DEG);
    gl.uniform3fv(u("uRock"), [0.62, 0.6, 0.57]);
    gl.uniform3fv(u("uShade"), [0.035, 0.04, 0.055]);
    this.grids.forEach((g, k) => {
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[k]);
      gl.uniform1i(u(`uH${k}`), k);
      gl.uniform3fv(u(`uGrid${k}`), [g.n, g.halfM, g.spacingM]);
    });
    for (let k = this.grids.length - 1; k >= 0; k--) {
      const g = this.grids[k];
      const { buffer, count } = this.indexCache.get(g.n);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.uniform1i(u("uLevel"), k);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
    }
    // The far skyline is centred on the spot, also when flying around it.
    this.drawFarSkyline(viewProj, orbit ? [this.target[0], this.target[1], this.target[2] + 2] : eye);
    const bodies = this.drawBodies(viewProj, eye, h, photo);
    if (overlay) this.drawOverlay(viewProj, eye, w, h, dpr, bodies);
    else this.overlay.getContext("2d").clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  drawFarSkyline(viewProj, eye) {
    const { gl, horizon } = this;
    if (!horizon) return;
    const n = horizon.n;
    const v = new Float32Array((n + 1) * 6);
    for (let i = 0; i <= n; i++) {
      const az = (i % n) * horizon.step * DEG;
      for (const [k, el] of [[0, horizon.elevation[i % n] * DEG], [1, -45 * DEG]]) {
        const d = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
        v.set([eye[0] + d[0] * RING_RADIUS_M, eye[1] + d[1] * RING_RADIUS_M, eye[2] + d[2] * RING_RADIUS_M], i * 6 + k * 3);
      }
    }
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.ringProgram);
    gl.bindVertexArray(this.ringVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.ringProgram, "uViewProj"), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(this.ringProgram, "uColour"), [0.1, 0.105, 0.12]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, (n + 1) * 2);
  }

  drawStars(viewProj, eye) {
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.starProgram);
    gl.bindVertexArray(this.starVao);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.starProgram, "uViewProj"), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(this.starProgram, "uEye"), eye);
    gl.drawArrays(gl.POINTS, 0, this.stars.length / 4);
  }

  // True-size disks (at least ~3 px so they stay findable), occluded by the terrain.
  drawBodies(viewProj, eye, heightPx, photo = false) {
    const { gl } = this;
    const orbit = this.camera.mode === "orbit";
    const fov = (orbit ? 45 : this.camera.fov) * DEG;
    const minRadius = (orbit ? 6 : 3) * (2 * Math.tan(fov / 2)) / heightPx;  // radians for 3 (6 when flying around) device pixels
    const css = getComputedStyle(this.canvas);
    const hex = (v) => { const m = v.trim().match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0.23, 0.6, 0.88]; };
    const sunDir = enuFromAzEl(this.sky.sun.azimuth, this.sky.sun.elevation);
    gl.useProgram(this.diskProgram);
    gl.bindVertexArray(this.diskVao);
    gl.depthMask(false);
    // Standing at the spot, terrain hides a body exactly as at the spot. Flying around, the camera is
    // elsewhere, so the bodies are sky markers: never hidden by nearby terrain, filled only if the engine
    // says they are visible from the spot.
    if (orbit) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const u = (name) => gl.getUniformLocation(this.diskProgram, name);
    gl.uniformMatrix4fv(u("uViewProj"), false, viewProj);
    const out = {};
    for (const [key, kind] of [["sun", 0], ["earth", 1]]) {
      const b = this.sky[key];
      const d = enuFromAzEl(b.azimuth, b.elevation);
      let right = [d[1], -d[0], 0];
      const len = Math.hypot(right[0], right[1]) || 1;
      right = right.map((x) => x / len);
      const up = [right[1] * d[2] - right[2] * d[1], right[2] * d[0] - right[0] * d[2], right[0] * d[1] - right[1] * d[0]];
      const toViewer = [-d[0], -d[1], -d[2]];
      const radius = Math.max(b.radius * DEG, minRadius);
      const center = [eye[0] + d[0] * BODY_DISTANCE_M, eye[1] + d[1] * BODY_DISTANCE_M, eye[2] + d[2] * BODY_DISTANCE_M];
      const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      gl.uniform3fv(u("uCenter"), center);
      gl.uniform3fv(u("uRight"), right);
      gl.uniform3fv(u("uUp"), up);
      gl.uniform1f(u("uRadius"), Math.tan(radius) * BODY_DISTANCE_M);
      gl.uniform1i(u("uKind"), kind);
      const glare = photo && kind === 0;
      gl.uniform1f(u("uGlare"), glare ? 1 : 0);
      gl.uniform1f(u("uScale"), glare ? 7 : 1);
      gl.uniform1f(u("uScaleMax"), 7);
      gl.uniform3fv(u("uSunLocal"), [dot(sunDir, right), dot(sunDir, up), dot(sunDir, toViewer)]);
      gl.uniform3fv(u("uColour"), hex(css.getPropertyValue("--earth")));
      if (!orbit || b.fraction > 0) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.uniform1f(u("uScale"), 1); // for the Earth that follows
      out[key] = { center, edge: [center[0] + up[0] * Math.tan(radius) * BODY_DISTANCE_M, center[1] + up[1] * Math.tan(radius) * BODY_DISTANCE_M, center[2] + up[2] * Math.tan(radius) * BODY_DISTANCE_M] };
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return out;
  }

  drawOverlay(viewProj, eye, w, h, dpr, bodies) {
    const o = this.overlay;
    o.width = w;
    o.height = h;
    const ctx = o.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = w / dpr;
    const H = h / dpr;
    const toScreen = (p) => {
      const s = project(viewProj, p);
      return s && Math.abs(s[0]) <= 1.2 && Math.abs(s[1]) <= 1.2 ? [(s[0] + 1) / 2 * W, (1 - s[1]) / 2 * H] : null;
    };
    ctx.font = "600 12px system-ui, sans-serif";
    const css = getComputedStyle(this.canvas);
    // As in the panorama: the full disk outlined (dashed), labelled with the engine's visible fraction.
    const photo = this.camera.mode === "sky";
    this.markers = [];
    const body = (name, colour, b, geo, key) => {
      const c = toScreen(geo.center);
      const e = toScreen(geo.edge);
      if (!c || !e) return;
      const r = Math.max(Math.hypot(e[0] - c[0], e[1] - c[1]), 3) + (photo ? 8 : 2);
      this.markers.push({ key, x: c[0], y: c[1], r });
      ctx.strokeStyle = ctx.fillStyle = photo ? "rgb(230 232 240 / 85%)" : colour;
      ctx.lineWidth = 1.5;
      if (!photo) {
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(c[0], c[1], r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const percent = `${Math.round(b.fraction * 100) || "<1"}%`;
      const state = this.camera.mode === "orbit"
        ? ` ${b.fraction >= 0.999 ? "visible from the spot" : b.fraction > 0 ? `${percent} visible from the spot` : "hidden from the spot"}`
        : b.fraction >= 0.999 ? "" : b.fraction > 0 ? ` ${percent} visible` : " (hidden)";
      ctx.fillText(`${name}${state}`, c[0] + r + 6, c[1] + 4);
    };
    body("Sun", css.getPropertyValue("--sun").trim() || "#e69f00", this.sky.sun, bodies.sun, "sun");
    body("Earth", css.getPropertyValue("--earth").trim() || "#3b9be0", this.sky.earth, bodies.earth, "earth");
    if (this.camera.mode === "orbit") {
      // A short line from the spot toward each body, to see whether it clears the near terrain.
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      for (const [key, colour] of [["sun", css.getPropertyValue("--sun").trim() || "#e69f00"], ["earth", css.getPropertyValue("--earth").trim() || "#3b9be0"]]) {
        const d = enuFromAzEl(this.sky[key].azimuth, this.sky[key].elevation);
        const from = toScreen([this.target[0], this.target[1], this.target[2] + 2]);
        const to = toScreen([this.target[0] + d[0] * 4000, this.target[1] + d[1] * 4000, this.target[2] + 2 + d[2] * 4000]);
        if (!from || !to) continue;
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const base = toScreen(this.target);
      const top = toScreen([this.target[0], this.target[1], this.target[2] + this.camera.distance * 0.06]);
      if (base && top) {
        ctx.strokeStyle = ctx.fillStyle = css.getPropertyValue("--accent").trim() || "#d55e00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(base[0], base[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(top[0], top[1], 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillText(this.targetLabel || "spot", top[0] + 8, top[1] + 4);
      }
    }
  }
}

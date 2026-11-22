// Procedural Chocolate-Glazed Donut Renderer
// Node 22, no dependencies, writes 1024x1024 PNG to /output/entry.png

const { deflateSync } = require('node:zlib');
const { writeFileSync, readFileSync } = require('node:fs');

const W = 1024;
const H = 1024;

// ===========================
// PNG Encoder (RFC 2083)
// ===========================

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeBE32(view, offset, val) { view.setUint32(offset, val, false); }
function writeBE16(view, offset, val) { view.setUint16(offset, val, false); }

function makeChunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  writeBE32(view, 0, len);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  writeBE32(view, 8 + len, crc32(out.subarray(4, 8 + len)));
  return out;
}

function encodePNG(pixels) {
  const raw = new Uint8Array(W * H * (3 + 1));
  let dst = 0;
  for (let y = 0; y < H; y++) {
    raw[dst++] = 0;
    const rowStart = y * W * 4;
    for (let x = 0; x < W; x++) {
      raw[dst++] = pixels[rowStart + x * 4 + 0];
      raw[dst++] = pixels[rowStart + x * 4 + 1];
      raw[dst++] = pixels[rowStart + x * 4 + 2];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  writeBE32(v, 0, W); writeBE32(v, 4, H);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', new Uint8Array(0))
  ];
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ===========================
// Math Utilities
// ===========================

const PI = Math.PI;
const TAU = PI * 2;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function mix(a, b, t) { return a * (1 - t) + b * t; }

function hash1(x) {
  x = (x ^ 61) ^ (x >>> 16);
  x = x + (x << 3);
  x = x ^ (x >>> 4);
  x = x * 0x27d4eb2d;
  x = x ^ (x >>> 15);
  return (x >>> 0) / 0x100000000;
}
function hash2(x, y) { return hash1(x * 374761393 + y * 668265263 + 12345); }
function hash3(x, y, z) { return hash1(x * 73856093 ^ y * 19349663 ^ z * 83492791); }

function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm2(x, y, octaves) {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x * freq, y * freq);
    amp *= 0.5; freq *= 2;
  }
  return v;
}

// ===========================
// Vector Types
// ===========================

class Vec3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  static zero() { return new Vec3(0, 0, 0); }
  add(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o) { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  div(s) { return new Vec3(this.x / s, this.y / s, this.z / s); }
  dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o) { return new Vec3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x); }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len(); return l > 0 ? this.div(l) : Vec3.zero(); }
  neg() { return new Vec3(-this.x, -this.y, -this.z); }
}

class Vec2 {
  constructor(x, y) { this.x = x; this.y = y; }
  add(o) { return new Vec2(this.x + o.x, this.y + o.y); }
  sub(o) { return new Vec2(this.x - o.x, this.y - o.y); }
  mul(s) { return new Vec2(this.x * s, this.y * s); }
  div(s) { return new Vec2(this.x / s, this.y / s); }
  dot(o) { return this.x * o.x + this.y * o.y; }
  len() { return Math.hypot(this.x, this.y); }
  norm() { const l = this.len(); return l > 0 ? this.div(l) : new Vec2(0, 0); }
}

// ===========================
// SDF Primitives
// ===========================

function sdTorus(p, ringR, tubeR) {
  const qx = Math.hypot(p.x, p.z) - ringR;
  return Math.hypot(qx, p.y) - tubeR;
}

function sdPlane(p, n, d) {
  return p.x * n.x + p.y * n.y + p.z * n.z - d;
}

function sdGlaze(p) {
  const ringR = 0.62;
  const tubeR = 0.26 + 0.02;
  const dTorus = sdTorus(p, ringR, tubeR);
  const phi = Math.atan2(p.z, p.x);
  const dripAngle = 0.15 + 0.12 * noise2(phi * 3, 0);
  const nx = Math.cos(phi), nz = Math.sin(phi);
  const cut = p.y * Math.cos(dripAngle) + (p.x * nx + p.z * nz) * Math.sin(dripAngle) + tubeR * 0.3;
  return Math.max(dTorus, cut);
}

function sdDough(p) {
  return sdTorus(p, 0.62, 0.26);
}

function sdTable(p) {
  return p.y + 0.27;
}

function sdScene(p) {
  const dGlaze = sdGlaze(p);
  const dDough = sdDough(p);
  const dTable = sdTable(p);

  if (dGlaze < dDough && dGlaze < dTable) return { d: dGlaze, mat: 1 };
  if (dDough < dTable) return { d: dDough, mat: 2 };
  return { d: dTable, mat: 3 };
}

// ===========================
// Ray Marching
// ===========================

const MAX_STEPS = 128;
const MAX_DIST = 20;
const EPS = 1e-4;

function rayMarch(ro, rd) {
  let t = 0;
  let mat = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const p = ro.add(rd.mul(t));
    const sd = sdScene(p);
    if (sd.d < EPS) {
      const eps = 1e-3;
      const nx = sdScene(new Vec3(p.x + eps, p.y, p.z)).d - sd.d;
      const ny = sdScene(new Vec3(p.x, p.y + eps, p.z)).d - sd.d;
      const nz = sdScene(new Vec3(p.x, p.y, p.z + eps)).d - sd.d;
      return { hit: true, pos: p, normal: new Vec3(nx, ny, nz).norm(), mat: sd.mat, dist: t };
    }
    t += sd.d;
    if (t > MAX_DIST) break;
    mat = sd.mat;
  }
  return { hit: false, pos: Vec3.zero(), normal: Vec3.zero(), mat: 0, dist: MAX_DIST };
}

// ===========================
// Lighting & Shading
// ===========================

const LIGHT_DIR = new Vec3(-0.6, 0.7, -0.4).norm();
const FILL_DIR = new Vec3(0.3, 0.2, 0.8).norm();

function shade(pos, normal, mat, rd) {
  const N = normal;
  const V = rd.neg();
  const L = LIGHT_DIR;
  const H = L.add(V).norm();

  const NdotL = clamp(N.dot(L), 0, 1);
  const NdotH = clamp(N.dot(H), 0, 1);
  const VdotH = clamp(V.dot(H), 0, 1);

  let col = new Vec3(0, 0, 0);

  if (mat === 1) {
    const base = new Vec3(0.13, 0.065, 0.035);
    col = col.add(base.mul(NdotL * 0.6));
    // Two sharp warm specular lobes
    const spec1 = Math.pow(NdotH, 180) * 3.0;
    col = col.add(new Vec3(1.0, 0.75, 0.45).mul(spec1));
    const spec2 = Math.pow(NdotH, 24) * 1.0;
    col = col.add(new Vec3(0.95, 0.55, 0.25).mul(spec2));
    // Warm rim sheen (fresnel)
    const rim = Math.pow(1 - clamp(N.dot(V), 0, 1), 2.5) * 0.7;
    col = col.add(new Vec3(0.7, 0.35, 0.12).mul(rim));
    // Glaze thickness variation (drips)
    const phi = Math.atan2(pos.z, pos.x);
    const thickness = 0.93 + 0.12 * noise2(phi * 5, pos.y * 10);
    col = col.mul(thickness);
    // Subtle glaze surface noise
    const surfNoise = noise2(pos.x * 8, pos.z * 8) * 0.02;
    col = col.add(new Vec3(0.05, 0.02, 0.01).mul(surfNoise));
  } else if (mat === 2) {
    const base = new Vec3(0.55, 0.35, 0.16);
    const nNoise = fbm2(pos.x * 30, pos.z * 30, 4) * 0.02;
    const perturbedN = new Vec3(N.x + nNoise, N.y, N.z + nNoise).norm();
    const NdotL2 = clamp(perturbedN.dot(L), 0, 1);
    col = col.add(base.mul(NdotL2 * 0.85));
    const H2 = L.add(V).norm();
    const NdotH2 = clamp(perturbedN.dot(H2), 0, 1);
    col = col.add(new Vec3(0.8, 0.6, 0.3).mul(Math.pow(NdotH2, 32) * 0.3));
    col = col.add(new Vec3(0.4, 0.25, 0.1).mul(0.15));
  } else if (mat === 3) {
    // Low-frequency grain with directional streaks
    const grain1 = fbm2(pos.x * 4, pos.z * 4, 3);
    const grain2 = fbm2(pos.x * 12 + pos.z * 3, pos.z * 12 - pos.x * 3, 2) * 0.3;
    const grainVal = (grain1 + grain2) * 0.5 + 0.5;
    const baseDark = new Vec3(0.10, 0.06, 0.03);
    const baseLight = new Vec3(0.20, 0.12, 0.07);
    const woodCol = baseDark.add(baseLight.sub(baseDark).mul(grainVal));
    col = col.add(woodCol.mul(NdotL * 0.65 + 0.35));
    // Soft contact shadow under donut - elliptical, directional
    const lightAngle = Math.atan2(LIGHT_DIR.z, LIGHT_DIR.x);
    const ellipticalDist = Math.sqrt(
      Math.pow((pos.x * Math.cos(lightAngle) + pos.z * Math.sin(lightAngle)) * 1.3, 2) +
      Math.pow((-pos.x * Math.sin(lightAngle) + pos.z * Math.cos(lightAngle)) * 0.7, 2)
    );
    if (ellipticalDist < 0.85) {
      const shadow = smoothstep(0.85, 0.35, ellipticalDist) * 0.7;
      col = col.mul(1 - shadow);
    }
    // Subtle highlight on wood grain ridges
    const ridge = Math.max(0, noise2(pos.x * 20, pos.z * 20) * 0.5 + 0.5 - 0.6) * 2.5;
    col = col.add(new Vec3(0.08, 0.05, 0.02).mul(ridge * NdotL));
  }

  return col;
}

// ===========================
// Sprinkles
// ===========================

function getSprinkles() {
  const out = [];
  let h = 0xC0FFEE;
  for (let i = 0; i < 90; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const u = h / 0x100000000;
    h = (h * 1664525 + 1013904223) >>> 0;
    const v = h / 0x100000000;

    const phi = u * TAU;
    const theta = v * TAU;

    const ringR = 0.62;
    const tubeR = 0.28;
    const cx = (ringR + tubeR * Math.cos(theta)) * Math.cos(phi);
    const cy = tubeR * Math.sin(theta);
    const cz = (ringR + tubeR * Math.cos(theta)) * Math.sin(phi);

    if (theta > Math.PI * 0.6) continue;

    h = (h * 1664525 + 1013904223) >>> 0;
    const r = 0.7 + 0.3 * (h / 0x100000000);
    h = (h * 1664525 + 1013904223) >>> 0;
    const g = 0.6 + 0.4 * (h / 0x100000000);
    h = (h * 1664525 + 1013904223) >>> 0;
    const b = 0.5 + 0.5 * (h / 0x100000000);

    out.push({ pos: new Vec3(cx, cy, cz), color: new Vec3(r, g, b) });
  }
  return out;
}

const SPRINKLES = getSprinkles();

function projectSprinkle(pos, cam) {
  const view = pos.sub(cam.eye);
  const z = view.dot(cam.forward);
  if (z <= 0.01) return null;
  const x = view.dot(cam.right);
  const y = view.dot(cam.up);
  const f = cam.focal;
  const sx = W * 0.5 + x * f / z;
  const sy = H * 0.5 - y * f / z;
  if (sx < -50 || sx >= W + 50 || sy < -50 || sy >= H + 50) return null;
  return new Vec2(sx, sy);
}

// ===========================
// Camera
// ===========================

class Camera {
  constructor(eye, target, vfovDeg) {
    this.eye = eye;
    this.forward = target.sub(eye).norm();
    const worldUp = new Vec3(0, 1, 0);
    this.right = this.forward.cross(worldUp).norm();
    this.up = this.right.cross(this.forward).norm();
    this.focal = 0.5 * H / Math.tan(vfovDeg * PI / 360);
  }

  getRay(u, v) {
    const px = (u - 0.5) * W;
    const py = (0.5 - v) * H;
    const dir = this.forward.mul(this.focal).add(this.right.mul(px)).add(this.up.mul(py));
    return dir.norm();
  }
}

const CAM = new Camera(
  new Vec3(0, 1.3, 2.35),
  new Vec3(0, 0, 0),
  44
);

// ===========================
// Background
// ===========================

function background(rd) {
  const t = clamp((rd.y + 0.3) / 1.6, 0, 1);
  const top = new Vec3(0.95, 0.88, 0.75);
  const bottom = new Vec3(0.45, 0.32, 0.22);
  let col = top.add(bottom.sub(top).mul(t));

  if (rd.y > 0.1) {
    for (let i = 0; i < 6; i++) {
      const hx = hash1(i * 1000 + 1) * 1.4 - 0.2;
      const hy = hash1(i * 1000 + 2) * 0.4 + 0.15;
      const hr = 0.15 + 0.1 * hash1(i * 1000 + 3);
      const dx = rd.x - hx;
      const dy = rd.y - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < hr * hr) {
        const intensity = smoothstep(hr, 0, Math.sqrt(d2));
        // Softer, larger bokeh with warm color
        col = col.add(new Vec3(1.0, 0.88, 0.65).mul(intensity * 0.35));
      }
    }
  }

  // Bright warm glow from upper left - larger and softer
  const glowDir = new Vec3(-0.7, 0.5, -0.3).norm();
  const glow = Math.pow(clamp(rd.dot(glowDir), 0, 1), 32) * 1.2;
  col = col.add(new Vec3(1.0, 0.75, 0.35).mul(glow));

  // Second softer glow lobe
  const glowDir2 = new Vec3(-0.5, 0.3, -0.4).norm();
  const glow2 = Math.pow(clamp(rd.dot(glowDir2), 0, 1), 16) * 0.5;
  col = col.add(new Vec3(1.0, 0.7, 0.4).mul(glow2));

  return col;
}

// ===========================
// Main Render Loop
// ===========================

function render() {
  const pixels = new Uint8Array(W * H * 4);
  const sprinkleDepth = new Float32Array(W * H);
  sprinkleDepth.fill(1e9);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const rd = CAM.getRay(u, v);
      const rm = rayMarch(CAM.eye, rd);

      let col = new Vec3(0, 0, 0);
      if (rm.hit) {
        col = shade(rm.pos, rm.normal, rm.mat, rd);
        if (rm.mat === 1) {
          sprinkleDepth[y * W + x] = rm.dist;
        }
      } else {
        col = background(rd);
      }

      const dx = (x - W * 0.5) / (W * 0.5);
      const dy = (y - H * 0.5) / (H * 0.5);
      const vign = 1 - 0.35 * (dx * dx + dy * dy);
      col = col.mul(vign);

      const idx = (y * W + x) * 4;
      pixels[idx + 0] = Math.round(clamp(Math.pow(col.x, 1/2.2) * 255, 0, 255));
      pixels[idx + 1] = Math.round(clamp(Math.pow(col.y, 1/2.2) * 255, 0, 255));
      pixels[idx + 2] = Math.round(clamp(Math.pow(col.z, 1/2.2) * 255, 0, 255));
      pixels[idx + 3] = 255;
    }
  }

  for (const sp of SPRINKLES) {
    const proj = projectSprinkle(sp.pos, CAM);
    if (!proj) continue;
    const sx = proj.x | 0;
    const sy = proj.y | 0;
    const rad = 3 + Math.random() * 2;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const px = sx + dx;
        const py = sy + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > rad * rad) continue;
        const spDist = sp.pos.sub(CAM.eye).dot(CAM.forward);
        if (spDist > sprinkleDepth[py * W + px] + 0.01) continue;
        const alpha = smoothstep(rad, 0, Math.sqrt(d2)) * 0.9;
        const idx = (py * W + px) * 4;
        const sr = Math.pow(sp.color.x, 1/2.2) * 255;
        const sg = Math.pow(sp.color.y, 1/2.2) * 255;
        const sb = Math.pow(sp.color.z, 1/2.2) * 255;
        pixels[idx + 0] = Math.round(lerp(pixels[idx + 0], sr, alpha));
        pixels[idx + 1] = Math.round(lerp(pixels[idx + 1], sg, alpha));
        pixels[idx + 2] = Math.round(lerp(pixels[idx + 2], sb, alpha));
      }
    }
  }

  return pixels;
}

// ===========================
// Run & Save
// ===========================

console.time('render');
const pixels = render();
console.timeEnd('render');

const png = encodePNG(pixels);
writeFileSync('/root/makefun-setup/race/tastes/repo/output/entry.png', png);
console.log(`Saved ${png.length} bytes to entry.png`);
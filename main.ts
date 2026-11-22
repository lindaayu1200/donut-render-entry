// Procedural Chocolate-Glazed Donut Renderer
// Node 22, no dependencies, writes 1024x1024 PNG to /output/entry.png

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const W = 1024;
const H = 1024;

// ===========================
// PNG Encoder (RFC 2083)
// ===========================

const crcTable: Uint32Array = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeBE32(view: DataView, offset: number, val: number) { view.setUint32(offset, val, false); }
function writeBE16(view: DataView, offset: number, val: number) { view.setUint16(offset, val, false); }

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  writeBE32(view, 0, len);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  writeBE32(view, 8 + len, crc32(out.subarray(4, 8 + len)));
  return out;
}

function encodePNG(pixels: Uint8Array): Uint8Array {
  // pixels: RGBA, 1024x1024, row-major
  const raw = new Uint8Array(W * H * (3 + 1)); // 3 bytes/pixel + 1 filter byte
  let dst = 0;
  for (let y = 0; y < H; y++) {
    raw[dst++] = 0; // filter type 0 (None)
    const rowStart = y * W * 4;
    for (let x = 0; x < W; x++) {
      raw[dst++] = pixels[rowStart + x * 4 + 0]; // R
      raw[dst++] = pixels[rowStart + x * 4 + 1]; // G
      raw[dst++] = pixels[rowStart + x * 4 + 2]; // B
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  writeBE32(v, 0, W); writeBE32(v, 4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB (no alpha in IHDR, but we encode RGB)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  const chunks: Uint8Array[] = [
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

function clamp(x: number, a: number, b: number) { return x < a ? a : x > b ? b : x; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smoothstep(e0: number, e1: number, x: number) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function mix(a: number, b: number, t: number) { return a * (1 - t) + b * t; }

function hash1(x: number): number {
  x = (x ^ 61) ^ (x >>> 16);
  x = x + (x << 3);
  x = x ^ (x >>> 4);
  x = x * 0x27d4eb2d;
  x = x ^ (x >>> 15);
  return (x >>> 0) / 0x100000000;
}
function hash2(x: number, y: number): number { return hash1(x * 374761393 + y * 668265263 + 12345); }
function hash3(x: number, y: number, z: number): number { return hash1(x * 73856093 ^ y * 19349663 ^ z * 83492791); }

function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm2(x: number, y: number, octaves: number): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x * freq, y * freq);
    amp *= 0.5; freq *= 2;
  }
  return v;
}

// ===========================
// SDF Primitives
// ===========================

function sdTorus(p: Vec3, ringR: number, tubeR: number): number {
  const qx = Math.hypot(p.x, p.z) - ringR;
  return Math.hypot(qx, p.y) - tubeR;
}

function sdPlane(p: Vec3, n: Vec3, d: number): number {
  return p.x * n.x + p.y * n.y + p.z * n.z - d;
}

// Glaze shell: slightly fatter torus, lower edge cut at varying angle
function sdGlaze(p: Vec3): number {
  const ringR = 0.62;
  const tubeR = 0.26 + 0.02; // slightly fatter
  const dTorus = sdTorus(p, ringR, tubeR);
  // Angled cut: varies around ring (phi angle)
  const phi = Math.atan2(p.z, p.x);
  // Irregular drip angle: base + noise
  const dripAngle = 0.15 + 0.12 * noise2(phi * 3, 0);
  // Cut plane normal tilted outward/downward
  const nx = Math.cos(phi), nz = Math.sin(phi);
  const cut = p.y * Math.cos(dripAngle) + (p.x * nx + p.z * nz) * Math.sin(dripAngle) + tubeR * 0.3;
  return Math.max(dTorus, cut);
}

// Dough: base torus without the glaze shell
function sdDough(p: Vec3): number {
  return sdTorus(p, 0.62, 0.26);
}

// Table plane at y = -0.27
function sdTable(p: Vec3): number {
  return p.y + 0.27;
}

// Scene SDF
function sdScene(p: Vec3): { d: number; mat: number } {
  const dGlaze = sdGlaze(p);
  const dDough = sdDough(p);
  const dTable = sdTable(p);

  if (dGlaze < dDough && dGlaze < dTable) return { d: dGlaze, mat: 1 }; // glaze
  if (dDough < dTable) return { d: dDough, mat: 2 }; // dough
  return { d: dTable, mat: 3 }; // table
}

// ===========================
// Vector Types
// ===========================

class Vec3 {
  x: number;
  y: number;
  z: number;
  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  static zero() { return new Vec3(0, 0, 0); }
  add(o: Vec3) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o: Vec3) { return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s: number) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  div(s: number) { return new Vec3(this.x / s, this.y / s, this.z / s); }
  dot(o: Vec3) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o: Vec3) { return new Vec3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x); }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len(); return l > 0 ? this.div(l) : Vec3.zero(); }
  neg() { return new Vec3(-this.x, -this.y, -this.z); }
}

class Vec2 {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  add(o: Vec2) { return new Vec2(this.x + o.x, this.y + o.y); }
  sub(o: Vec2) { return new Vec2(this.x - o.x, this.y - o.y); }
  mul(s: number) { return new Vec2(this.x * s, this.y * s); }
  dot(o: Vec2) { return this.x * o.x + this.y * o.y; }
  len() { return Math.hypot(this.x, this.y); }
  norm() { const l = this.len(); return l > 0 ? this.div(l) : new Vec2(0, 0); }
  div(s: number) { return new Vec2(this.x / s, this.y / s); }
}

// ===========================
// Ray Marching
// ===========================

const MAX_STEPS = 128;
const MAX_DIST = 20;
const EPS = 1e-4;

function rayMarch(ro: Vec3, rd: Vec3): { hit: boolean; pos: Vec3; normal: Vec3; mat: number; dist: number } {
  let t = 0;
  let mat = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const p = ro.add(rd.mul(t));
    const sd = sdScene(p);
    if (sd.d < EPS) {
      // Compute normal via finite differences
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

const LIGHT_DIR = new Vec3(-0.6, 0.7, -0.4).norm(); // warm key from upper left
const FILL_DIR = new Vec3(0.3, 0.2, 0.8).norm(); // cool fill

function shade(pos: Vec3, normal: Vec3, mat: number, rd: Vec3): Vec3 {
  const N = normal;
  const V = rd.neg();
  const L = LIGHT_DIR;
  const H = L.add(V).norm();

  const NdotL = clamp(N.dot(L), 0, 1);
  const NdotH = clamp(N.dot(H), 0, 1);
  const VdotH = clamp(V.dot(H), 0, 1);

  let col = new Vec3(0, 0, 0);

  if (mat === 1) { // Glaze: chocolate
    const base = new Vec3(0.08, 0.035, 0.02); // richer, darker chocolate
    // Diffuse
    col = col.add(base.mul(NdotL * 0.7));
    // Specular lobe 1 (sharp, warm) - stronger
    const spec1 = Math.pow(NdotH, 128) * 3.5;
    col = col.add(new Vec3(1.0, 0.75, 0.45).mul(spec1));
    // Specular lobe 2 (broader, warm rim) - stronger
    const spec2 = Math.pow(NdotH, 16) * 1.2;
    col = col.add(new Vec3(1.0, 0.6, 0.25).mul(spec2));
    // Rim sheen (fresnel-like) - more pronounced
    const rim = Math.pow(1 - clamp(N.dot(V), 0, 1), 3) * 0.9;
    col = col.add(new Vec3(0.8, 0.4, 0.15).mul(rim));
    // Subtle glaze thickness variation
    const phi = Math.atan2(pos.z, pos.x);
    const thickness = 0.95 + 0.1 * noise2(phi * 5, pos.y * 10);
    col = col.mul(thickness);
  } else if (mat === 2) { // Dough: golden fried
    const base = new Vec3(0.55, 0.35, 0.16);
    // Fine noise bump mapped into normal perturbation (approximate via color)
    const nNoise = fbm2(pos.x * 30, pos.z * 30, 4) * 0.02;
    const perturbedN = new Vec3(N.x + nNoise, N.y, N.z + nNoise).norm();
    const NdotL2 = clamp(perturbedN.dot(L), 0, 1);
    col = col.add(base.mul(NdotL2 * 0.85));
    // Subtle specular
    const H2 = L.add(V).norm();
    const NdotH2 = clamp(perturbedN.dot(H2), 0, 1);
    col = col.add(new Vec3(0.8, 0.6, 0.3).mul(Math.pow(NdotH2, 32) * 0.3));
    // Warm subsurface scatter hint
    col = col.add(new Vec3(0.4, 0.25, 0.1).mul(0.15));
  } else if (mat === 3) { // Table: dark warm wood
    // Low-frequency grain
    const grain = fbm2(pos.x * 4, pos.z * 4, 3);
    const grainDir = Math.atan2(pos.z, pos.x);
    const grainVal = grain * 0.5 + 0.5;
    const baseDark = new Vec3(0.12, 0.07, 0.04);
    const baseLight = new Vec3(0.18, 0.11, 0.06);
    const woodCol = baseDark.add(baseLight.sub(baseDark).mul(grainVal));
    col = col.add(woodCol.mul(NdotL * 0.7 + 0.3));
    // Soft contact shadow under donut
    const distToCenter = Math.hypot(pos.x, pos.z);
    if (distToCenter < 0.7) {
      const shadow = smoothstep(0.7, 0.3, distToCenter) * 0.6;
      col = col.mul(1 - shadow);
    }
  }

  return col;
}

// ===========================
// Sprinkles
// ===========================

// Deterministic sprinkle positions on glaze surface
function getSprinkles(): { pos: Vec3; color: Vec3 }[] {
  const out: { pos: Vec3; color: Vec3 }[] = [];
  const seed = 0xC0FFEE; // Fixed seed
  let h = seed;
  for (let i = 0; i < 90; i++) {
    // Hash to get position on torus
    h = (h * 1664525 + 1013904223) >>> 0;
    const u = h / 0x100000000;
    h = (h * 1664525 + 1013904223) >>> 0;
    const v = h / 0x100000000;

    // Map to torus surface (phi, theta)
    const phi = u * TAU;
    const theta = v * TAU;

    // Torus parametric: ringR=0.62, tubeR=0.28 (glaze outer)
    const ringR = 0.62;
    const tubeR = 0.28;
    const cx = (ringR + tubeR * Math.cos(theta)) * Math.cos(phi);
    const cy = tubeR * Math.sin(theta);
    const cz = (ringR + tubeR * Math.cos(theta)) * Math.sin(phi);

    // Only on top half of glaze (theta near 0 to PI/2)
    if (theta > Math.PI * 0.6) continue;

    // Pastel colors via hash
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

// Project world pos to screen space for sprinkle splats
function projectSprinkle(pos: Vec3, cam: Camera): Vec2 | null {
  const view = pos.sub(cam.eye);
  const z = view.dot(cam.forward);
  if (z <= 0.01) return null;
  const x = view.dot(cam.right);
  const y = view.dot(cam.up);
  const f = cam.focal;
  const sx = W * 0.5 + x * f / z;
  const sy = H * 0.5 - y * f / z; // flip Y for screen coords
  if (sx < -50 || sx >= W + 50 || sy < -50 || sy >= H + 50) return null;
  return new Vec2(sx, sy);
}

// ===========================
// Camera
// ===========================

class Camera {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  focal: number;

  constructor(eye: Vec3, target: Vec3, vfovDeg: number) {
    this.eye = eye;
    this.forward = target.sub(eye).norm();
    const worldUp = new Vec3(0, 1, 0);
    this.right = this.forward.cross(worldUp).norm();
    this.up = this.right.cross(this.forward).norm();
    this.focal = 0.5 * H / Math.tan(vfovDeg * PI / 360);
  }

  getRay(u: number, v: number): Vec3 {
    // u,v in [0,1], (0,0) = top-left
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

function background(rd: Vec3): Vec3 {
  // Vertical gradient: warm cream to brown
  const t = clamp((rd.y + 0.3) / 1.6, 0, 1);
  const top = new Vec3(0.95, 0.88, 0.75);
  const bottom = new Vec3(0.45, 0.32, 0.22);
  let col = top.add(bottom.sub(top).mul(t));

  // Soft bokeh circles in upper third
  if (rd.y > 0.1) {
    for (let i = 0; i < 5; i++) {
      const hx = hash1(i * 1000 + 1);
      const hy = hash1(i * 1000 + 2) * 0.5 + 0.2;
      const hr = 0.12 + 0.08 * hash1(i * 1000 + 3);
      const dx = rd.x - hx;
      const dy = rd.y - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < hr * hr) {
        const intensity = smoothstep(hr, 0, Math.sqrt(d2));
        col = col.add(new Vec3(1.0, 0.85, 0.6).mul(intensity * 0.4));
      }
    }
  }

  // Bright warm glow from upper left
  const glowDir = new Vec3(-0.7, 0.5, -0.3).norm();
  const glow = Math.pow(clamp(rd.dot(glowDir), 0, 1), 64) * 0.8;
  col = col.add(new Vec3(1.0, 0.7, 0.3).mul(glow));

  return col;
}

// ===========================
// Main Render Loop
// ===========================

function render(): Uint8Array {
  const pixels = new Uint8Array(W * H * 4);
  const sprinkleDepth = new Float32Array(W * H);
  sprinkleDepth.fill(1e9);

  // First pass: render scene, collect depth for sprinkles
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const rd = CAM.getRay(u, v);
      const rm = rayMarch(CAM.eye, rd);

      let col = new Vec3(0, 0, 0);
      if (rm.hit) {
        col = shade(rm.pos, rm.normal, rm.mat, rd);
        // Store depth for sprinkle occlusion test
        if (rm.mat === 1) { // only glaze receives sprinkles
          sprinkleDepth[y * W + x] = rm.dist;
        }
      } else {
        col = background(rd);
      }

      // Vignette
      const dx = (x - W * 0.5) / (W * 0.5);
      const dy = (y - H * 0.5) / (H * 0.5);
      const vign = 1 - 0.35 * (dx * dx + dy * dy);
      col = col.mul(vign);

      // sRGB encode + write
      const idx = (y * W + x) * 4;
      pixels[idx + 0] = Math.round(clamp(Math.pow(col.x, 1/2.2) * 255, 0, 255));
      pixels[idx + 1] = Math.round(clamp(Math.pow(col.y, 1/2.2) * 255, 0, 255));
      pixels[idx + 2] = Math.round(clamp(Math.pow(col.z, 1/2.2) * 255, 0, 255));
      pixels[idx + 3] = 255;
    }
  }

  // Second pass: draw sprinkles as screen-space splats with depth test
  for (const sp of SPRINKLES) {
    const proj = projectSprinkle(sp.pos, CAM);
    if (!proj) continue;
    const sx = proj.x | 0;
    const sy = proj.y | 0;
    // Splatter radius ~3-5px
    const rad = 3 + Math.random() * 2; // tiny variation, but deterministic-ish
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const px = sx + dx;
        const py = sy + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > rad * rad) continue;
        // Depth test: only draw if in front of glaze surface
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
mkdirSync('/output', { recursive: true });
writeFileSync('/output/entry.png', png);
console.log(`Saved ${png.length} bytes to entry.png`);
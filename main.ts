// Deterministic, dependency-free chocolate-glazed donut renderer.
// node main.ts  ->  /output/entry.png (1024x1024 RGB PNG)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 1024;
const H = 1024;
const TAN = 0.50;
const SEED = 20261122;

// ---------- small deterministic hash / value noise ----------
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^
          Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(SEED, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  const a = c000 + (c100 - c000) * fx;
  const b = c010 + (c110 - c010) * fx;
  const c = c001 + (c101 - c001) * fx;
  const d = c011 + (c111 - c011) * fx;
  return (a + (b - a) * fy) * (1 - fz) + (c + (d - c) * fy) * fz;
}
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- scene constants ----------
const RING = 0.62;
const TUBE = 0.26;
const TH = 0.031;          // glaze thickness
const CY = 0.264;          // torus centre height: just resting on table
const BOUND = RING + TUBE + TH + 0.08;

// Irregular glaze hem: smooth waves plus a handful of long chocolate drips.
const DRIP_C = [0.35, 1.05, 1.62, 2.25, 2.92, 3.55, 4.15, 4.86, 5.62];
const DRIP_W = [0.13, 0.08, 0.17, 0.19, 0.09, 0.12, 0.16, 0.14, 0.10];
const DRIP_D = [0.140, 0.200, 0.105, 0.100, 0.190, 0.140, 0.085, 0.170, 0.120];
function edgeAt(theta: number, q: number): number {
  let e = 0.125;
  e += 0.034 * Math.sin(3 * theta + 0.6);
  e += 0.019 * Math.sin(7 * theta - 1.1);
  e += 0.010 * Math.sin(13 * theta + 2.3);
  e += 0.030 * Math.cos(theta - 0.9);
  for (let k = 0; k < DRIP_C.length; k++) {
    let d = theta - DRIP_C[k];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e -= DRIP_D[k] * Math.exp(-(d * d) / (DRIP_W[k] * DRIP_W[k]));
  }
  // the hem runs lower on the outside of the ring than on the inside
  e -= 0.17 * q;
  return clamp(e, -0.160, 0.200);
}
function torusDist(px: number, py: number, pz: number, rad: number): number {
  const q = Math.sqrt(px * px + pz * pz) - RING;
  const y = py - CY;
  return Math.sqrt(q * q + y * y) - rad;
}
function cutDist(px: number, py: number, pz: number): number {
  const theta = Math.atan2(pz, px);
  const q = Math.sqrt(px * px + pz * pz) - RING;
  return CY + edgeAt(theta, q) - py;
}
function glazeDist(px: number, py: number, pz: number): number {
  return Math.max(torusDist(px, py, pz, TUBE + TH), cutDist(px, py, pz));
}
function donutDist(px: number, py: number, pz: number): number {
  const d = torusDist(px, py, pz, TUBE);
  const g = glazeDist(px, py, pz);
  return d < g ? d : g;
}

// ---------- camera ----------
const RO = [1.25, 2.05, 2.90];
const TA = [0.0, 0.78, 0.0];
function norm3(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const CF = norm3([TA[0] - RO[0], TA[1] - RO[1], TA[2] - RO[2]]);
const CR = norm3(cross(CF, [0, 1, 0]));
const CU = cross(CR, CF);

const KEY = norm3([-0.62, 0.86, 0.52]);
const FILL = norm3([0.78, 0.36, -0.58]);

// scratch colour buffer, filled by the shade* functions
const col = [0, 0, 0];

function softShadow(px: number, py: number, pz: number, lx: number, ly: number, lz: number, maxT: number): number {
  let res = 1;
  let t = 0.018;
  for (let i = 0; i < 22; i++) {
    const h = donutDist(px + lx * t, py + ly * t, pz + lz * t);
    if (h < 0.0015) return 0.08;
    res = Math.min(res, 13 * h / t);
    t += clamp(h, 0.018, 0.17);
    if (t > maxT) break;
  }
  return clamp(res, 0.08, 1);
}
function ambientOcclusion(px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  let occ = 0;
  let s = 1;
  for (let i = 0; i < 4; i++) {
    const h = 0.035 + i * 0.075;
    const d = donutDist(px + nx * h, py + ny * h, pz + nz * h);
    occ += (h - d) * s;
    s *= 0.65;
  }
  return clamp(1 - 1.8 * occ, 0.35, 1);
}
function surfaceNormal(px: number, py: number, pz: number, glaze: boolean): number[] {
  const e = 0.0013;
  let a: number, b: number;
  if (glaze) {
    a = glazeDist(px + e, py, pz) - glazeDist(px - e, py, pz);
    b = glazeDist(px, py + e, pz) - glazeDist(px, py - e, pz);
    const c = glazeDist(px, py, pz + e) - glazeDist(px, py, pz - e);
    return norm3([a, b, c]);
  }
  a = torusDist(px + e, py, pz, TUBE) - torusDist(px - e, py, pz, TUBE);
  b = torusDist(px, py + e, pz, TUBE) - torusDist(px, py - e, pz, TUBE);
  const c = torusDist(px, py, pz + e, TUBE) - torusDist(px, py, pz - e, TUBE);
  return norm3([a, b, c]);
}

function shadeGlaze(px: number, py: number, pz: number, nx: number, ny: number, nz: number,
                    vx: number, vy: number, vz: number): void {
  const ndv = clamp(nx * vx + ny * vy + nz * vz, 0, 1);
  const ndl = clamp(nx * KEY[0] + ny * KEY[1] + nz * KEY[2], 0, 1);
  const ndf = clamp(nx * FILL[0] + ny * FILL[1] + nz * FILL[2], 0, 1);
  const sh = softShadow(px + nx * 0.006, py + ny * 0.006, pz + nz * 0.006, KEY[0], KEY[1], KEY[2], 3.2);
  const ao = ambientOcclusion(px, py, pz, nx, ny, nz);
  const varia = 0.94 + 0.12 * noise3(px * 13, py * 13, pz * 13);

  // warm chocolate body
  let r = 0.098 * varia * (0.22 + 0.78 * ndl * sh) * ao;
  let g = 0.040 * varia * (0.22 + 0.78 * ndl * sh) * ao;
  let b = 0.026 * varia * (0.22 + 0.78 * ndl * sh) * ao;
  r += 0.018 * ndf; g += 0.026 * ndf; b += 0.045 * ndf;

  // two-lobe specular: tight glossy hotspot plus a soft sheen
  let hx = KEY[0] + vx, hy = KEY[1] + vy, hz = KEY[2] + vz;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const nh = clamp(nx * hx + ny * hy + nz * hz, 0, 1);
  const spec = Math.pow(nh, 130) * 2.5 + Math.pow(nh, 420) * 1.10 + Math.pow(nh, 20) * 0.17;
  r += spec * sh * 1.00; g += spec * sh * 0.79; b += spec * sh * 0.57;

  let fx = FILL[0] + vx, fy = FILL[1] + vy, fz = FILL[2] + vz;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  const nf = clamp(nx * fx + ny * fy + nz * fz, 0, 1);
  const sp2 = Math.pow(nf, 70) * 0.55;
  r += sp2 * 0.62; g += sp2 * 0.76; b += sp2 * 1.0;

  // faux environment reflection + warm rim sheen
  const dx = 2 * ndv * nx - vx, dy = 2 * ndv * ny - vy, dz = 2 * ndv * nz - vz;
  const sky = clamp(dy * 0.5 + 0.5, 0, 1);
  const fres = 0.028 + 0.20 * Math.pow(1 - ndv, 4);
  r += mix(0.30, 0.82, sky) * fres;
  g += mix(0.17, 0.66, sky) * fres;
  b += mix(0.12, 0.50, sky) * fres;
  const rim = Math.pow(1 - ndv, 3.2) * (0.22 + 0.55 * clamp(nx * KEY[0] + nz * KEY[2] + 0.3, 0, 1));
  r += rim * 0.85; g += rim * 0.42; b += rim * 0.20;
  // caramel-coloured light catching the rolled lip of the glaze
  const cd = cutDist(px, py, pz);
  const hem = Math.exp(-Math.pow((cd + 0.010) / 0.012, 2));
  r += hem * 0.17; g += hem * 0.080; b += hem * 0.030;
  col[0] = r; col[1] = g; col[2] = b;
}

function shadeDough(px: number, py: number, pz: number, nx: number, ny: number, nz: number,
                    vx: number, vy: number, vz: number): void {
  // fine fried-dough bump: gradient of a high-frequency value noise
  const f = 42;
  const e = 0.0045;
  const gx = noise3((px + e) * f, py * f, pz * f) - noise3((px - e) * f, py * f, pz * f);
  const gy = noise3(px * f, (py + e) * f, pz * f) - noise3(px * f, (py - e) * f, pz * f);
  const gz = noise3(px * f, py * f, (pz + e) * f) - noise3(px * f, py * f, (pz - e) * f);
  let bx = nx - gx * 1.5, by = ny - gy * 1.5, bz = nz - gz * 1.5;
  const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;

  const ndl = clamp(bx * KEY[0] + by * KEY[1] + bz * KEY[2], 0, 1);
  const ndf = clamp(bx * FILL[0] + by * FILL[1] + bz * FILL[2], 0, 1);
  const sh = softShadow(px + bx * 0.006, py + by * 0.006, pz + bz * 0.006, KEY[0], KEY[1], KEY[2], 3.0);
  const ao = ambientOcclusion(px, py, pz, nx, ny, nz);
  const fine = noise3(px * 70, py * 70, pz * 70);
  const coarse = noise3(px * 8, py * 8, pz * 8);
  const toast = clamp((py - CY + 0.23) / 0.42, 0, 1);
  const tint = (0.72 + 0.30 * fine) * (0.88 + 0.20 * coarse) * (0.66 + 0.34 * toast);
  let r = 1.00 * tint * (0.34 + 0.86 * ndl * sh) * ao;
  let g = 0.50 * tint * (0.34 + 0.86 * ndl * sh) * ao;
  let b = 0.17 * tint * (0.34 + 0.86 * ndl * sh) * ao;
  r += 0.11 * ndf; g += 0.13 * ndf; b += 0.17 * ndf;
  let hx = KEY[0] + vx, hy = KEY[1] + vy, hz = KEY[2] + vz;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const nh = clamp(bx * hx + by * hy + bz * hz, 0, 1);
  const spec = Math.pow(nh, 22) * 0.22 * sh;
  r += spec; g += spec * 0.86; b += spec * 0.65;
  col[0] = r; col[1] = g; col[2] = b;
}

function shadeTable(px: number, py: number, pz: number): void {
  const warp = Math.sin(px * 3.1 + noise3(px * 1.4, 0, pz * 1.4) * 3.4);
  const grain = 0.5 + 0.5 * Math.sin((pz * 10.5 + warp * 0.55) * 3.6);
  const fine = noise3(px * 26, py * 26, pz * 26);
  const wood = 0.55 + 0.45 * grain;
  let r = mix(0.062, 0.17, wood) * (0.82 + 0.28 * fine);
  let g = mix(0.032, 0.088, wood) * (0.82 + 0.28 * fine);
  let b = mix(0.020, 0.049, wood) * (0.82 + 0.28 * fine);

  const sh = softShadow(px, py + 0.004, pz, KEY[0], KEY[1], KEY[2], 3.5);
  const q = Math.sqrt(px * px + pz * pz);
  const foot = Math.abs(q - RING) - TUBE;
  const contact = 1 - 0.62 * Math.exp(-Math.max(foot, 0) * 11);
  const lit = 0.36 + 0.85 * KEY[1] * sh;
  r *= lit * contact; g *= lit * contact; b *= lit * contact;
  // faint warm bounce from the cream backdrop into the table
  r += 0.020; g += 0.013; b += 0.008;
  col[0] = r; col[1] = g; col[2] = b;
}

function shadeBackground(nx: number, ny: number, rdy: number): void {
  const t = clamp(rdy * 2.8 + 0.05, 0, 1);
  let r = mix(0.95, 0.28, t);
  let g = mix(0.83, 0.15, t);
  let b = mix(0.64, 0.11, t);
  const bo = [
    [-0.66, 0.44, 0.17, 0.60], [0.57, 0.52, 0.14, 0.55],
    [0.80, 0.16, 0.20, 0.42], [-0.84, 0.09, 0.12, 0.48],
    [0.10, 0.74, 0.11, 0.38]
  ];
  for (let i = 0; i < bo.length; i++) {
    const dx = nx - bo[i][0], dy = ny - bo[i][1];
    const d = Math.hypot(dx, dy);
    const rad = bo[i][2];
    const soft = (1 - smoothstep(rad * 0.15, rad, d)) * bo[i][3];
    const ring = Math.exp(-Math.pow((d - rad * 0.88) / (rad * 0.16), 2)) * 0.12 * bo[i][3];
    r += (soft + ring) * 0.46;
    g += (soft + ring) * 0.33;
    b += (soft + ring) * 0.19;
  }
  col[0] = r; col[1] = g; col[2] = b;
}

// ---------- main raster pass ----------
const pix = Buffer.alloc(W * H * 3);
const zbuf = new Float32Array(W * H);
const mbuf = new Uint8Array(W * H);
let nGlaze = 0, nDough = 0, nTable = 0, nBack = 0;

for (let y = 0; y < H; y++) {
  const sy = (1 - 2 * (y + 0.5) / H) * TAN;
  for (let x = 0; x < W; x++) {
    const sx = (2 * (x + 0.5) / W - 1) * TAN;
    let dx = CF[0] + CR[0] * sx + CU[0] * sy;
    let dy = CF[1] + CR[1] * sx + CU[1] * sy;
    let dz = CF[2] + CR[2] * sx + CU[2] * sy;
    const dl = 1 / Math.hypot(dx, dy, dz);
    dx *= dl; dy *= dl; dz *= dl;

    const nx = 2 * (x + 0.5) / W - 1;
    const ny = 1 - 2 * (y + 0.5) / H;

    // analytic table intersection
    let tTable = 1e9;
    if (dy < -1e-7) tTable = -RO[1] / dy;

    // bounding sphere of the pastry
    const ox = RO[0], oy = RO[1] - CY, oz = RO[2];
    const bb = ox * dx + oy * dy + oz * dz;
    const cc = ox * ox + oy * oy + oz * oz - BOUND * BOUND;
    const disc = bb * bb - cc;
    let material = 0;
    let tHit = 1e9;
    if (disc > 0) {
      const sq = Math.sqrt(disc);
      let t = Math.max(0.001, -bb - sq);
      const tExit = -bb + sq;
      const limit = Math.min(tExit, tTable);
      for (let step = 0; step < 84 && t < limit; step++) {
        const px = RO[0] + dx * t, py = RO[1] + dy * t, pz = RO[2] + dz * t;
        const d = donutDist(px, py, pz);
        if (d < 0.00075) {
          tHit = t;
          material = glazeDist(px, py, pz) < 0.0035 ? 2 : 1;
          break;
        }
        t += Math.max(d * 0.88, 0.0007);
      }
    }

    if (material !== 0 && tHit < tTable) {
      if (material === 2) nGlaze++; else nDough++;
      const px = RO[0] + dx * tHit, py = RO[1] + dy * tHit, pz = RO[2] + dz * tHit;
      const nn = surfaceNormal(px, py, pz, material === 2);
      const vx = -dx, vy = -dy, vz = -dz;
      if (material === 2) shadeGlaze(px, py, pz, nn[0], nn[1], nn[2], vx, vy, vz);
      else shadeDough(px, py, pz, nn[0], nn[1], nn[2], vx, vy, vz);
      zbuf[y * W + x] = tHit * (dx * CF[0] + dy * CF[1] + dz * CF[2]);
      mbuf[y * W + x] = material;
    } else if (tTable < 1e8) {
      const px = RO[0] + dx * tTable, py = RO[1] + dy * tTable, pz = RO[2] + dz * tTable;
      shadeTable(px, py, pz);
      // distant table dissolves into the warm cream studio backdrop
      const fog = smoothstep(3.9, 8.2, tTable);
      if (fog > 0.001) {
        const wr = col[0], wg = col[1], wb = col[2];
        shadeBackground(nx, ny, dy);
        col[0] = mix(wr, col[0], fog);
        col[1] = mix(wg, col[1], fog);
        col[2] = mix(wb, col[2], fog);
      }
      nTable++;
    } else {
      nBack++;
      shadeBackground(nx, ny, dy);
    }

    const vig = 1 - 0.34 * Math.pow(clamp((nx * nx + ny * ny) / 2, 0, 1), 1.4);
    const o = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) {
      let c = 1 - Math.exp(-Math.max(col[k], 0) * 1.42 * vig);
      c = Math.pow(c, 1 / 2.2);
      pix[o + k] = Math.round(clamp(c, 0, 1) * 255);
    }
  }
}

// ---------- sprinkles: shaded screen-space capsule splats, depth-tested ----------
const rnd = mulberry32(0x5eed711);
const PASTEL = [
  [1.00, 0.60, 0.70], [0.60, 0.93, 0.77], [1.00, 0.87, 0.52],
  [0.83, 0.71, 1.00], [0.57, 0.80, 1.00], [1.00, 0.95, 0.84]
];
function project(p: number[]): number[] {
  const x = p[0] - RO[0], y = p[1] - RO[1], z = p[2] - RO[2];
  const cz = x * CF[0] + y * CF[1] + z * CF[2];
  if (cz < 0.05) return [-1e4, -1e4, cz];
  const cx = x * CR[0] + y * CR[1] + z * CR[2];
  const cy = x * CU[0] + y * CU[1] + z * CU[2];
  return [(cx / (cz * TAN) * 0.5 + 0.5) * W, (0.5 - cy / (cz * TAN) * 0.5) * H, cz];
}
const NS = 96;
let sprinkleDrawn = 0;
for (let i = 0; i < NS; i++) {
  const theta = rnd() * Math.PI * 2;
  let phi = 0.8, valid = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const e0 = edgeAt(theta, 0.03);
    const s0 = clamp(e0 / TUBE + 0.06, -0.92, 0.9);
    const s = s0 + rnd() * (0.99 - s0);
    const a = Math.asin(clamp(s, -1, 1));
    phi = rnd() < 0.68 ? a : Math.PI - a;
    const q = TUBE * Math.cos(phi);
    if (TUBE * Math.sin(phi) > edgeAt(theta, q) + 0.025) { valid = true; break; }
  }
  if (!valid) continue;

  const ct = Math.cos(theta), st = Math.sin(theta);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const nx = cp * ct, ny = sp, nz = cp * st;
  const rho = RING + TUBE * cp + TH + 0.002;
  const pos = [rho * ct, CY + TUBE * sp + (TH + 0.002) * sp, rho * st];
  // tangent frame on the torus surface
  const t1 = [-st, 0, ct];
  let t2 = [ny * ct, -nz * st - nx * ct, ny * st];
  const tl = Math.hypot(t2[0], t2[1], t2[2]); t2 = [t2[0] / tl, t2[1] / tl, t2[2] / tl];
  const ang = rnd() * Math.PI;
  const ax3 = t1[0] * Math.cos(ang) + t2[0] * Math.sin(ang);
  const ay3 = t1[1] * Math.cos(ang) + t2[1] * Math.sin(ang);
  const az3 = t1[2] * Math.cos(ang) + t2[2] * Math.sin(ang);
  const len = 0.058 + rnd() * 0.038;
  const wid = 0.014 + rnd() * 0.006;
  const pc = project(pos);
  const pe = project([pos[0] + ax3 * 0.05, pos[1] + ay3 * 0.05, pos[2] + az3 * 0.05]);
  let axx = pe[0] - pc[0], axy = pe[1] - pc[1];
  const al = Math.hypot(axx, axy);
  if (al < 0.001 || pc[2] < 0.1) continue;
  axx /= al; axy /= al;
  const scale = H / (2 * TAN * pc[2]);
  const halfLen = len * 0.5 * scale;
  const rad = wid * scale;
  if (rad < 1.1) continue;
  const col3 = PASTEL[Math.floor(rnd() * PASTEL.length)];
  const x0 = Math.max(0, Math.floor(pc[0] - halfLen - rad - 2));
  const x1 = Math.min(W - 1, Math.ceil(pc[0] + halfLen + rad + 2));
  const y0 = Math.max(0, Math.floor(pc[1] - halfLen - rad - 2));
  const y1 = Math.min(H - 1, Math.ceil(pc[1] + halfLen + rad + 2));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const idx = yy * W + xx;
      if (mbuf[idx] !== 2 || Math.abs(zbuf[idx] - pc[2]) > 0.075) continue;
      const ddx = xx + 0.5 - pc[0], ddy = yy + 0.5 - pc[1];
      const along = ddx * axx + ddy * axy;
      const across = -ddx * axy + ddy * axx;
      const q = Math.abs(along) - halfLen + rad;
      const dist = Math.hypot(Math.max(q, 0), across) - rad;
      if (dist >= 2.2) continue;
      const o = idx * 3;
      if (dist > 0) {
        // soft contact shadow cast by the sprinkle onto the chocolate
        const dark = 0.30 * (1 - dist / 2.2);
        for (let k = 0; k < 3; k++) pix[o + k] = Math.round(pix[o + k] * (1 - dark));
        continue;
      }
      sprinkleDrawn++;
      const body = 0.62 + 0.38 * clamp(-dist / (rad * 1.1), 0, 1);
      const hi = 0.30 * Math.exp(-Math.pow((across + rad * 0.42) / (rad * 0.42), 2)) *
                 clamp((halfLen - Math.abs(along)) / (halfLen * 0.6) + 0.4, 0, 1);
      for (let k = 0; k < 3; k++) {
        pix[o + k] = Math.round(clamp(col3[k] * body + hi * (1 - 0.12 * k), 0, 1) * 255);
      }
    }
  }
}

// ---------- hand-written PNG encoder ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter type 0
  pix.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
writeFileSync('/output/entry.png', png);
console.log(`wrote /output/entry.png ${png.length} bytes; glaze=${nGlaze} dough=${nDough} table=${nTable} backdrop=${nBack} sprinklePixels=${sprinkleDrawn}`);

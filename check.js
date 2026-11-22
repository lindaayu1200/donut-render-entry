// Self-check script for donut render
// Verifies: fill fraction, orientation, dimensions, file size

const { readFileSync } = require('node:fs');
const { inflateSync } = require('node:zlib');

const W = 1024;
const H = 1024;

// PNG decoder (minimal, for our own format: RGB, 8-bit, no interlace, filter 0)
function decodePNG(buf) {
  // Skip signature
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len; // skip CRC too
    chunks.push({ type, data });
    if (type === 'IEND') break;
  }

  const ihdr = chunks.find(c => c.type === 'IHDR');
  const idat = chunks.find(c => c.type === 'IDAT');
  if (!ihdr || !idat) throw new Error('Missing IHDR or IDAT');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];

  if (width !== W || height !== H) throw new Error(`Wrong dimensions: ${width}x${height}`);
  if (bitDepth !== 8 || colorType !== 2) throw new Error(`Wrong format: bitDepth=${bitDepth}, colorType=${colorType}`);

  const raw = inflateSync(idat.data);
  // raw has filter byte per row
  const pixels = new Uint8Array(W * H * 3);
  let src = 0;
  for (let y = 0; y < H; y++) {
    src++; // skip filter byte
    for (let x = 0; x < W; x++) {
      const dst = (y * W + x) * 3;
      pixels[dst + 0] = raw[src++];
      pixels[dst + 1] = raw[src++];
      pixels[dst + 2] = raw[src++];
    }
  }
  return pixels;
}

const png = readFileSync('/root/makefun-setup/race/tastes/repo/output/entry.png');
console.log(`File size: ${png.length} bytes (${(png.length / 1024).toFixed(1)} KB)`);

const pixels = decodePNG(png);

// Check 1: Fill fraction - donut-colored pixels (R > 90, B < 120) at center rows
const centerY = H / 2;
const checkRows = [centerY - 2, centerY - 1, centerY, centerY + 1, centerY + 2];
let totalDonutPixels = 0;
let totalCheckedPixels = 0;

for (const y of checkRows) {
  const rowY = Math.round(y);
  if (rowY < 0 || rowY >= H) continue;
  let rowDonut = 0;
  for (let x = 0; x < W; x++) {
    const idx = (rowY * W + x) * 3;
    const r = pixels[idx];
    const b = pixels[idx + 2];
    if (r > 90 && b < 120) rowDonut++;
  }
  totalDonutPixels += rowDonut;
  totalCheckedPixels += W;
}

const fillFraction = (totalDonutPixels / totalCheckedPixels) * 100;
console.log(`Fill fraction: ${fillFraction.toFixed(1)}% (donut pixels / total at center rows)`);

// Check 2: Orientation - texture variance per row
console.log('\nRow texture analysis (every 64th row):');
for (let y = 0; y < H; y += 64) {
  let varianceSum = 0;
  let sampleCount = 0;
  for (let x = 0; x < W; x += 8) {
    const idx = (y * W + x) * 3;
    const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
    // Simple variance: color difference from neighbors
    if (x + 8 < W) {
      const idx2 = (y * W + x + 8) * 3;
      const dr = r - pixels[idx2], dg = g - pixels[idx2 + 1], db = b - pixels[idx2 + 2];
      varianceSum += Math.sqrt(dr*dr + dg*dg + db*db);
      sampleCount++;
    }
  }
  const avgVar = sampleCount > 0 ? varianceSum / sampleCount : 0;
  const zone = y < 340 ? 'BG' : y > 400 ? 'TABLE' : 'MID';
  console.log(`  Row ${y.toString().padStart(4)}: avgVar=${avgVar.toFixed(2)} ${zone}`);
}

// Check 3: BG smooth (rows 0-340), Table textured (rows 400-1020)
let bgVar = 0, bgCount = 0;
let tableVar = 0, tableCount = 0;
for (let y = 0; y < 340; y += 32) {
  for (let x = 0; x < W; x += 16) {
    const idx = (y * W + x) * 3;
    if (x + 16 < W) {
      const idx2 = (y * W + x + 16) * 3;
      const dr = pixels[idx] - pixels[idx2], dg = pixels[idx+1] - pixels[idx2+1], db = pixels[idx+2] - pixels[idx2+2];
      bgVar += Math.sqrt(dr*dr + dg*dg + db*db);
      bgCount++;
    }
  }
}
for (let y = 400; y < H; y += 32) {
  for (let x = 0; x < W; x += 16) {
    const idx = (y * W + x) * 3;
    if (x + 16 < W) {
      const idx2 = (y * W + x + 16) * 3;
      const dr = pixels[idx] - pixels[idx2], dg = pixels[idx+1] - pixels[idx2+1], db = pixels[idx+2] - pixels[idx2+2];
      tableVar += Math.sqrt(dr*dr + dg*dg + db*db);
      tableCount++;
    }
  }
}
console.log(`\nBG (0-340) avg variance: ${(bgVar/bgCount).toFixed(3)}`);
console.log(`Table (400-1023) avg variance: ${(tableVar/tableCount).toFixed(3)}`);

// Summary
console.log('\n=== SUMMARY ===');
console.log(`Dimensions: ${W}x${H} ${W===1024 && H===1024 ? '✓' : '✗'}`);
console.log(`File size: ${png.length} bytes ${png.length < 1048576 ? '✓' : '✗'} (limit 1048576)`);
console.log(`Fill fraction: ${fillFraction.toFixed(1)}% ${fillFraction >= 55 && fillFraction <= 80 ? '✓' : '✗'} (target 55-80%)`);
console.log(`BG smooth / Table textured: ${(bgVar/bgCount) < (tableVar/tableCount) ? '✓' : '✗'}`);

if (fillFraction < 55 || fillFraction > 80) {
  console.log('\n⚠️  FILL FRACTION OUT OF RANGE - Camera/projection needs adjustment');
  process.exit(1);
}
if ((bgVar/bgCount) >= (tableVar/tableCount)) {
  console.log('\n⚠️  ORIENTATION WRONG - Table should be more textured than background');
  process.exit(1);
}
if (png.length >= 1048576) {
  console.log('\n⚠️  FILE TOO LARGE');
  process.exit(1);
}

console.log('\n✅ All checks passed!');
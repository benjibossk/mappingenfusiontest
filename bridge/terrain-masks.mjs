// Surface masks for Paint -> Import/export masks (format measured on MG_Test, docs/ARCHITECTURE.md):
// one 8-bit greyscale PNG per surface, named like the .emat, side = sqrt(TilesCount) * 252 + 1 px,
// pixel row 0 = NORTH (z max), column 0 = west, value 0..255 = surface weight.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { enforcePixelBlocks, limitPixelBlocks, paintMasks, roadLayers, sampler } from "../src/shared/maskPaint.mjs";

export { enforcePixelBlocks, limitPixelBlocks, paintMasks, roadLayers };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

//! pixel(col, row) returns a byte (channels 1) or [r, g, b(, a)] (channels 3 / 4). height defaults to side (square).
export function png(side, pixel, channels = 1, height = side) {
  const stride = side * channels + 1;
  const raw = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const o = row * stride + 1; // filter byte 0 = none
    for (let col = 0; col < side; col++) {
      const v = pixel(col, row);
      if (channels === 1) raw[o + col] = v;
      else for (let c = 0; c < channels; c++) raw[o + col * channels + c] = v[c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : channels === 4 ? 6 : 2; // greyscale / RGBA / RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

//! side of the mask image for a terrain, from <terr>.meta
export function maskSide(terrPath) {
  const tiles = Number(/TilesCount\s+(\d+)/.exec(readFileSync(terrPath + ".meta", "utf-8"))?.[1] ?? 0);
  const perSide = Math.round(Math.sqrt(tiles));
  if (!tiles || perSide * perSide !== tiles) throw new Error("TilesCount missing or not square in " + terrPath + ".meta");
  return perSide * 252 + 1;
}

//! Satellite map (Manage -> Satellite Map -> Import, untick "linear colour space"): RGB PNG, row 0 = NORTH,
//! each pixel = weighted mix of the surface colours, background colour where no surface has weight.
//! colours: {surfaceName: [r, g, b]}. Without it the terrain renders white.
export function writeSatellite(outFile, side, terrainSize, surfaces, colours, background = [40, 60, 80], roads = []) {
  const mPerPx = terrainSize / (side - 1);
  const samplers = surfaces.map((s) => ({ c: colours[s.name] ?? [128, 128, 128], f: sampler(s) }));
  const layers = roadLayers(side, mPerPx, roads);
  const roadCol = [...layers].map(([name, a]) => ({ c: colours[name] ?? [90, 90, 90], a }));
  writeFileSync(outFile, png(side, (col, row) => {
    let road = 0;
    const racc = [0, 0, 0];
    for (const { c, a } of roadCol) {
      const w = Math.min(a[row * side + col], 1 - road);
      road += w;
      for (let k = 0; k < 3; k++) racc[k] += c[k] * w;
    }
    const x = col * mPerPx;
    const z = (side - 1 - row) * mPerPx;
    let total = 0;
    const acc = [0, 0, 0];
    for (const { c, f } of samplers) {
      const w = Math.min(Math.max(f(x, z), 0), 1);
      total += w;
      for (let k = 0; k < 3; k++) acc[k] += c[k] * w;
    }
    if (total < 1) for (let k = 0; k < 3; k++) acc[k] += background[k] * (1 - total);
    const n = Math.max(total, 1);
    return acc.map((v, k) => Math.round((v / n) * (1 - road) + racc[k]));
  }, 3));
  return { file: outFile, side };
}

//! Writes one PNG per surface into outDir (emptied first, PNGs only).
//! terrainSize: world size in metres (X = Z). surfaces: [{name, minX, minZ, step, cols, rows, weights}]
//! with weights 0..1, row 0 = south (same layout as /heightmap), sampled bilinearly.
//! roads: [{points: [x0, z0, ...], half, edge, core, side?}] painted over the surfaces at pixel precision
//! (see roadLayers). The pixels come from paintMasks (src/shared/maskPaint.mjs), shared with the app preview.
export function writeMasks(outDir, side, terrainSize, surfaces, roads = [], colours = null) {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.toLowerCase().endsWith(".png")) rmSync(join(outDir, f));
  const { names, bytes } = paintMasks(side, terrainSize, surfaces, roads, colours);
  const written = [];
  names.forEach((name, k) => {
    writeFileSync(join(outDir, name + ".png"), png(side, (col, row) => bytes[k][row * side + col]));
    written.push(name);
  });
  return { dir: outDir, side, written };
}

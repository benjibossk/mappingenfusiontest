// Surface masks for Paint -> Import/export masks (format measured on MG_Test, docs/ARCHITECTURE.md):
// one 8-bit greyscale PNG per surface, named like the .emat, side = sqrt(TilesCount) * 252 + 1 px,
// pixel row 0 = NORTH (z max), column 0 = west, value 0..255 = surface weight.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { cleanColour, hillshade } from "./satmap-clean.mjs";
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
//! opts: { relief?: height grid (hillshade), seed? }. Every surface = one flat colour hand-matched to the
//! vanilla look (bridge/satmap-clean.mjs) + seeded multi-scale noise + relief shading. No game file is read
//! (Bohemia advice, HorribleGoat: no thumbnails derived from the game textures).
export function writeSatellite(outFile, side, terrainSize, surfaces, colours, background = [40, 60, 80], roads = [], opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  const seed = Number.isFinite(o.seed) ? o.seed | 0 : 1;
  const shade = hillshade(o.relief);
  const mPerPx = terrainSize / (side - 1);
  const samplers = surfaces.map((s) => ({ name: s.name, c: colours[s.name] ?? [128, 128, 128], f: sampler(s) }));
  const layers = roadLayers(side, mPerPx, roads);
  const roadCol = [...layers].map(([name, a]) => ({ name, c: colours[name] ?? [90, 90, 90], a }));
  writeFileSync(outFile, png(side, (col, row) => {
    let road = 0;
    const racc = [0, 0, 0];
    const x = col * mPerPx;
    const z = (side - 1 - row) * mPerPx;
    for (const { name, c, a } of roadCol) {
      const w = Math.min(a[row * side + col], 1 - road);
      if (!w) continue;
      road += w;
      const rc = cleanColour(name, c, x, z, seed);
      for (let k = 0; k < 3; k++) racc[k] += Math.min(255, rc[k]) * w;
    }
    let total = 0;
    const acc = [0, 0, 0];
    for (const { name, c, f } of samplers) {
      const w = Math.min(Math.max(f(x, z), 0), 1);
      if (!w) continue;
      total += w;
      const cc = cleanColour(name, c, x, z, seed);
      for (let k = 0; k < 3; k++) acc[k] += Math.min(255, cc[k]) * w;
    }
    const land = Math.min(total, 1) + road * (1 - Math.min(total, 1));
    if (total < 1) for (let k = 0; k < 3; k++) acc[k] += background[k] * (1 - total);
    const n = Math.max(total, 1);
    const sh = land > 0 ? 1 + (shade(x, z) - 1) * land : 1;
    return acc.map((v, k) => Math.min(255, Math.max(0, Math.round(((v / n) * (1 - road) + racc[k]) * sh))));
  }, 3));
  return { file: outFile, side };
}

//! Writes one PNG per surface into outDir (emptied first, PNGs only).
//! terrainSize: world size in metres (X = Z). surfaces: [{name, minX, minZ, step, cols, rows, weights}]
//! with weights 0..1, row 0 = south (same layout as /heightmap), sampled bilinearly.
//! roads: [{points: [x0, z0, ...], half, edge, core, side?}] painted over the surfaces at pixel precision
//! (see roadLayers). The pixels come from paintMasks (src/shared/maskPaint.mjs), shared with the app preview.
//! opts (opt-in climate ground classes, src/biomes/groundMasks.ts): fileNames {surface: file name without
//! .png, import-ordered e.g. 01_mer__SeaBed_01} and readme. The Workbench importer matches masks by SURFACE
//! name, so outDir keeps plain names (scripts/wb-ui/wb-import-masks.ps1 unchanged) and skips the
//! manquant_* layers (no such surface); the prefixed copies + 00_LISEZMOI_import.txt go to `<outDir>_ordre_import`.
export function writeMasks(outDir, side, terrainSize, surfaces, roads = [], colours = null, opts = {}) {
  mkdirSync(outDir, { recursive: true });
  // surfaces painted by an earlier export (old PNGs + the LAYERS list) and absent now get an all-zero mask:
  // the importer skips a missing file and KEEPS that layer on the terrain, so the forests of the previous
  // map stayed and blocks ended with 6 surfaces ("Too many layers", import failed, image map 2026-11-26)
  const stale = new Set();
  try { for (const n of JSON.parse(readFileSync(join(outDir, LAYERS), "utf-8"))) if (typeof n === "string") stale.add(n); } catch { /* first export */ }
  for (const f of readdirSync(outDir)) if (f.toLowerCase().endsWith(".png")) { stale.add(f.slice(0, -4)); rmSync(join(outDir, f)); }
  const { names, bytes } = paintMasks(side, terrainSize, surfaces, roads, colours);
  const fileNames = opts.fileNames ?? {};
  const ordered = Object.keys(fileNames).length > 0 || !!opts.readme;
  const orderDir = outDir + ORDER_SUFFIX;
  if (ordered) { mkdirSync(orderDir, { recursive: true }); for (const f of readdirSync(orderDir)) if (f.toLowerCase().endsWith(".png") || f === README) rmSync(join(orderDir, f)); }
  const written = [], orderedFiles = [];
  names.forEach((name, k) => {
    const buf = png(side, (col, row) => bytes[k][row * side + col]);
    if (!name.startsWith("manquant_")) { writeFileSync(join(outDir, name + ".png"), buf); written.push(name); }
    const f = fileNames[name];
    if (ordered && /^[\w+-]+$/.test(f ?? "")) { writeFileSync(join(orderDir, f + ".png"), buf); orderedFiles.push(f); }
  });
  const cleared = [...stale].filter((n) => /^[\w+-]+$/.test(n) && !n.startsWith("manquant_") && !names.includes(n)).sort();
  if (cleared.length) { const zero = png(side, () => 0); for (const n of cleared) writeFileSync(join(outDir, n + ".png"), zero); }
  writeFileSync(join(outDir, LAYERS), JSON.stringify([...new Set([...written, ...cleared])].sort()));
  if (ordered && typeof opts.readme === "string" && opts.readme) { writeFileSync(join(orderDir, README), opts.readme.replace(/\n/g, "\r\n"), "utf-8"); orderedFiles.unshift(README); }
  if (cleared.length) return ordered ? { dir: outDir, side, written, cleared, orderDir, ordered: orderedFiles.sort() } : { dir: outDir, side, written, cleared };
  return ordered ? { dir: outDir, side, written, orderDir, ordered: orderedFiles.sort() } : { dir: outDir, side, written };
}
const ORDER_SUFFIX = "_ordre_import";
const README = "00_LISEZMOI_import.txt";
const LAYERS = "mapgen-layers.json";

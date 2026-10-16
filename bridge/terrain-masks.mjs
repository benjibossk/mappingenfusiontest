// Surface masks for Paint -> Import/export masks (format measured on MG_Test, docs/ARCHITECTURE.md):
// one 8-bit greyscale PNG per surface, named like the .emat, side = sqrt(TilesCount) * 252 + 1 px,
// pixel row 0 = NORTH (z max), column 0 = west, value 0..255 = surface weight.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

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

//! pixel(col, row) returns a byte (channels 1) or [r, g, b] (channels 3)
function png(side, pixel, channels = 1) {
  const stride = side * channels + 1;
  const raw = Buffer.alloc(side * stride);
  for (let row = 0; row < side; row++) {
    const o = row * stride + 1; // filter byte 0 = none
    for (let col = 0; col < side; col++) {
      const v = pixel(col, row);
      if (channels === 1) raw[o + col] = v;
      else for (let c = 0; c < 3; c++) raw[o + col * 3 + c] = v[c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 2; // greyscale / RGB
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

//! Road surfaces at pixel precision (row 0 = NORTH): core surface within `half` metres of the centre
//! line, fading out over `edge` metres; the optional `side` surface fills the fade band (dirt shoulders).
//! Returns Map(surface name -> Float32Array side*side, 0..1), first road layer wins where they overlap.
export function roadLayers(side, mPerPx, roads) {
  const layers = new Map();
  const layer = (name) => {
    if (!/^[\w-]+$/.test(name ?? "")) throw new Error("road surface invalid: " + name);
    if (!layers.has(name)) layers.set(name, new Float32Array(side * side));
    return layers.get(name);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  for (const r of roads) {
    const core = layer(r.core);
    const shoulder = r.side ? layer(r.side) : null;
    const reach = r.half + r.edge;
    const p = r.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / mPerPx));
      const c1 = Math.min(side - 1, Math.ceil((Math.max(ax, bx) + reach) / mPerPx));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / mPerPx));
      const z1 = Math.min(side - 1, Math.ceil((Math.max(az, bz) + reach) / mPerPx));
      for (let zi = z0; zi <= z1; zi++) {
        const row = side - 1 - zi;
        const z = zi * mPerPx;
        for (let col = c0; col <= c1; col++) {
          const x = col * mPerPx;
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
          if (d >= reach) continue;
          const i2 = row * side + col;
          const w = d <= r.half ? 1 : 1 - smooth((d - r.half) / r.edge);
          if (shoulder) {
            // core: hard-ish edge (1 m fade), shoulder fills the band outside
            const cw = d <= r.half ? 1 : Math.max(0, 1 - (d - r.half) / 1);
            core[i2] = Math.max(core[i2], cw);
            shoulder[i2] = Math.max(shoulder[i2], w - cw);
          } else core[i2] = Math.max(core[i2], w);
        }
      }
    }
  }
  // a pixel can't be more than 100 % road: the first layers keep their weight
  const list = [...layers.values()];
  for (let i = 0; i < side * side; i++) {
    let left = 1;
    for (const a of list) { if (!a[i]) continue; a[i] = Math.min(a[i], left); left -= a[i]; }
  }
  return layers;
}

//! paints the road layers into the surface bytes (adds the road surfaces to `names` when missing)
function stampRoads(bytes, names, side, mPerPx, roads) {
  if (!roads.length) return;
  for (const [name, a] of roadLayers(side, mPerPx, roads)) {
    let k = names.indexOf(name);
    if (k < 0) { names.push(name); bytes.push(new Uint8Array(side * side)); k = names.length - 1; }
    const own = bytes[k];
    for (let i = 0; i < a.length; i++) {
      const w = a[i];
      if (!w) continue;
      for (let j = 0; j < bytes.length; j++) if (j !== k) bytes[j][i] = Math.round(bytes[j][i] * (1 - w));
      own[i] = Math.min(255, Math.round(own[i] * (1 - w) + 255 * w));
    }
  }
}

function sampler(s) {
  if (!/^[\w-]+$/.test(s.name ?? "")) throw new Error("surface name invalid: " + s.name);
  if (!(s.cols >= 2 && s.rows >= 2 && s.step > 0 && s.weights?.length === s.cols * s.rows))
    throw new Error("grid invalid for " + s.name);
  return (x, z) => {
    const gx = Math.min(Math.max((x - (s.minX ?? 0)) / s.step, 0), s.cols - 1);
    const gz = Math.min(Math.max((z - (s.minZ ?? 0)) / s.step, 0), s.rows - 1);
    const x0 = Math.min(Math.floor(gx), s.cols - 2);
    const z0 = Math.min(Math.floor(gz), s.rows - 2);
    const fx = gx - x0;
    const fz = gz - z0;
    const w = s.weights;
    const i = z0 * s.cols + x0;
    const a = w[i] + (w[i + 1] - w[i]) * fx;
    const b = w[i + s.cols] + (w[i + s.cols + 1] - w[i + s.cols]) * fx;
    return a + (b - a) * fz;
  };
}

//! Writes one PNG per surface into outDir (emptied first, PNGs only).
//! terrainSize: world size in metres (X = Z). surfaces: [{name, minX, minZ, step, cols, rows, weights}]
//! with weights 0..1, row 0 = south (same layout as /heightmap), sampled bilinearly.
//! roads: [{points: [x0, z0, ...], half, edge, core, side?}] painted over the surfaces at pixel precision
//! (see roadLayers).
export function writeMasks(outDir, side, terrainSize, surfaces, roads = [], colours = null) {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.toLowerCase().endsWith(".png")) rmSync(join(outDir, f));

  const mPerPx = terrainSize / (side - 1);
  const bytes = surfaces.map((s) => {
    const sample = sampler(s);
    const a = new Uint8Array(side * side);
    for (let row = 0; row < side; row++)
      for (let col = 0; col < side; col++)
        a[row * side + col] = Math.round(Math.min(Math.max(sample(col * mPerPx, (side - 1 - row) * mPerPx), 0), 1) * 255);
    return a;
  });
  const names = surfaces.map((s) => s.name);
  stampRoads(bytes, names, side, mPerPx, roads);
  limitPixelBlocks(bytes, side, 63, 5, 3, colours ? names.map((n) => colours[n] ?? null) : null);
  const written = [];
  names.forEach((name, k) => {
    const s = { name };
    writeFileSync(join(outDir, s.name + ".png"), png(side, (col, row) => bytes[k][row * side + col]));
    written.push(s.name);
  });
  return { dir: outDir, side, written };
}

//! The engine allows `max` surfaces per block (tile 252 px / 4 = 63 px) and reads a few pixels past
//! the block edge. Enforced on the final pixels: for each block region (+ margin) with too many
//! surfaces, one is removed and its weight goes to a surface left on that pixel (or nearby).
//! With `cols` (rgb per surface) the removed surface is the one that changes the look least
//! (weight x colour gap to its closest kept surface) and it is replaced by that closest-coloured
//! surface, so blocks along roads don't show up as squares of another colour.
//! Repeated until every region is fine, since a move can touch a neighbour region.
export function limitPixelBlocks(bytes, side, blockPx = 63, max = 5, margin = 3, cols = null) {
  const gap = (a, b) => (cols && cols[a] && cols[b] ? Math.hypot(cols[a][0] - cols[b][0], cols[a][1] - cols[b][1], cols[a][2] - cols[b][2]) : null);
  const nb = Math.ceil((side - 1) / blockPx);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let by = 0; by < nb; by++) {
      for (let bx = 0; bx < nb; bx++) {
        const r0 = Math.max(0, by * blockPx - margin), r1 = Math.min(side - 1, by * blockPx + blockPx + margin);
        const c0 = Math.max(0, bx * blockPx - margin), c1 = Math.min(side - 1, bx * blockPx + blockPx + margin);
        for (;;) {
          const totals = bytes.map((a) => {
            let t = 0;
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) t += a[r * side + c];
            return t;
          });
          const used = totals.map((t, k) => [t, k]).filter(([t]) => t > 0).sort((a, b) => b[0] - a[0]);
          if (used.length <= max) break;
          changed = true;
          let drop = used[used.length - 1][1];
          if (cols) {
            let bestCost = Infinity;
            for (const [t, k] of used) {
              const g = Math.min(...used.filter(([, o]) => o !== k).map(([, o]) => gap(k, o) ?? 1e3));
              if (t * (g + 5) < bestCost) { bestCost = t * (g + 5); drop = k; }
            }
          }
          // kept surfaces, closest colour to the dropped one first
          const kept = used.map(([, k]) => k).filter((k) => k !== drop);
          if (cols) kept.sort((a, b) => (gap(drop, a) ?? 1e3) - (gap(drop, b) ?? 1e3));
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const i = r * side + c;
              const v = bytes[drop][i];
              if (!v) continue;
              bytes[drop][i] = 0;
              // strongest kept surface on this pixel, else nearby (so no surface appears out of
              // nowhere in a neighbouring block)
              // with colours: the closest-coloured kept surface present here or nearby;
              // without: the strongest one
              let best = -1, bv = 0;
              const pick = (j) => {
                if (cols) { for (const k of kept) if (bytes[k][j] > 0) { if (best < 0 || kept.indexOf(k) < kept.indexOf(best)) best = k; break; } }
                else for (const k of kept) if (bytes[k][j] > bv) { bv = bytes[k][j]; best = k; }
              };
              pick(i);
              for (let rad = 1; best < 0 && rad <= 8; rad++)
                for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
                  const rr = r + dr, cc = c + dc;
                  if (rr < 0 || cc < 0 || rr >= side || cc >= side) continue;
                  pick(rr * side + cc);
                }
              if (best < 0) best = kept[0];
              bytes[best][i] = Math.min(255, bytes[best][i] + v);
            }
          }
        }
      }
    }
    if (!changed) return;
  }
}

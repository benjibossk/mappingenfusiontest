// satmap-clean.mjs - "clean" satellite map source: no pixel from BI files. Each surface = a hand-tuned colour
// (library/satmap-clean-palette.json) + procedural detail: seeded multi-scale value noise and, when the height
// grid is sent, a slope / hillshade modulation. Deterministic: same inputs + seed = same image.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let PALETTE = null;
export function cleanPalette() {
  if (PALETTE) return PALETTE;
  try {
    const j = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "library", "satmap-clean-palette.json"), "utf-8"));
    PALETTE = new Map(Object.entries(j.surfaces).map(([k, v]) => [k.toLowerCase(), v]));
  } catch { PALETTE = new Map(); }
  return PALETTE;
}
const key = (name) => String(name).replace(/\.emat$/i, "").split("/").pop().toLowerCase();
//! palette entry of a surface (GUID / path / case ignored), null if not in the table
export const cleanEntry = (name) => cleanPalette().get(key(name)) ?? null;

function hash(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function value(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
//! multi-scale value noise in -1..1 (4 octaves from `scale` metres up to 8x), seeded
export function fbm(x, z, scale, seed) {
  let s = 0, amp = 1, norm = 0, f = 1 / scale;
  for (let o = 0; o < 4; o++) { s += (value(x * f, z * f, seed + o * 31) * 2 - 1) * amp; norm += amp; amp *= 0.6; f /= 2.2; }
  return s / norm;
}

//! relief = {minX, minZ, step, cols, rows, heights} (row 0 = south) -> (x, z) => shade factor around 1
export function hillshade(relief) {
  if (!relief || !Array.isArray(relief.heights) || !(relief.step > 0)) return () => 1;
  const { minX, minZ, step, cols, rows, heights: h } = relief;
  const at = (i, j) => h[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  // sun from the north-west, 45 deg up (classic cartographic shading)
  const L = [-0.5, 0.7071, 0.5];
  return (x, z) => {
    const i = Math.round((x - minX) / step), j = Math.round((z - minZ) / step);
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    const n = Math.hypot(dx, 1, dz);
    const lit = (-dx * L[0] + L[1] - dz * L[2]) / n; // normal (-dx, 1, -dz)/n . L, flat = 0.7071
    return Math.min(1.25, Math.max(0.7, 1 + (lit - 0.7071) * 0.9));
  };
}

//! colour of one surface at world (x, z) in clean mode: palette (or the app colour) x noise grain
export function cleanColour(name, appColour, x, z, seed = 1) {
  const e = cleanEntry(name);
  const c = e?.rgb ?? appColour;
  const grain = e?.grain ?? 0.6, scale = e?.scale ?? 3;
  const n = fbm(x, z, scale, seed), broad = fbm(x, z, 60, seed + 101);
  const lum = 1 + grain * (0.22 * n + 0.06 * broad);
  // slight warm / cool drift at large scale, so a big meadow is not one flat tone
  const tint = 0.04 * grain * fbm(x, z, 140, seed + 202);
  return [c[0] * lum * (1 + tint), c[1] * lum, c[2] * lum * (1 - tint)];
}

// Edits an Enfusion terrain on disk (the world must NOT be open in the Workbench).
//
// <world>.terr is IFF-like: "FORM" + u32 BE size + "TERR", then chunks (4-char name + u32 BE size + body).
//   MATS = surface list: 2 bytes (08 00), then entries u32 LE length (with \0) + "{GUID}path.emat\0".
//          The Paint panel only writes it after a surface is used; writing it ourselves preloads them.
//   TEXS = byte 3 goes 0 -> 1 when the normal map exists ("Generate normal/vegetation map": one
//          .Data/<name>_<tile>_normal.edds + .EditorData/<name>_<tile>_normal.dds per tile; without it
//          script sculpting is silently ignored), byte 5 when the surface map is initialised.
//          A flat terrain's normal files are all identical: templates/flat_normal_tile128.* (128-quad tiles).
// <world>.terr.meta gets "TerrainSurfaceBits 8" in its PC config at the same time.
// Verified on a terrain copy (2026-10-15); see docs/ARCHITECTURE.md "Surfaces du terrain".

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "templates");

function readChunks(buf) {
  if (buf.toString("ascii", 0, 4) !== "FORM" || buf.toString("ascii", 8, 12) !== "TERR")
    throw new Error("not a terrain file (FORM/TERR)");
  const chunks = [];
  for (let o = 12; o < buf.length; ) {
    const size = buf.readUInt32BE(o + 4);
    chunks.push({ name: buf.toString("ascii", o, o + 4), body: buf.subarray(o + 8, o + 8 + size) });
    o += 8 + size;
  }
  return chunks;
}

function writeChunks(chunks) {
  const parts = [Buffer.from("TERR")];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.write(c.name, 0, "ascii");
    head.writeUInt32BE(c.body.length, 4);
    parts.push(head, c.body);
  }
  const body = Buffer.concat(parts);
  const form = Buffer.alloc(8);
  form.write("FORM", 0, "ascii");
  form.writeUInt32BE(body.length, 4);
  return Buffer.concat([form, body]);
}

function parseMats(body) {
  const names = [];
  for (let p = 2; p < body.length; ) {
    const len = body.readUInt32LE(p);
    names.push(body.toString("utf-8", p + 4, p + 4 + len).replace(/\0$/, ""));
    p += 4 + len;
  }
  return { prefix: body.subarray(0, 2), names };
}

function buildMats(prefix, names) {
  return Buffer.concat([
    prefix,
    ...names.map((n) => {
      const s = Buffer.from(n + "\0", "utf-8");
      const len = Buffer.alloc(4);
      len.writeUInt32LE(s.length);
      return Buffer.concat([len, s]);
    }),
  ]);
}

// path without GUID: "{37DC7E40C529A95A}Terrains/x.emat" -> "Terrains/x.emat"
const bare = (n) => n.replace(/^\{[0-9A-F]{16}\}/i, "");

//! Registration order of NEW surfaces (community mapping docs): hard / dirt materials before
//! grass, so the parallax of the grass layer blends over the ground ones. Stable inside a rank.
//! Existing MATS entries are never reordered (painted layers reference them by index).
const PARALLAX_RANK = [/rock|stone|cliff|gravel|scree/i, /dirt|soil|mud|sand|earth|ground|forest|field|crop|asphalt|concrete/i];
export function parallaxOrder(names) {
  const rank = (n) => {
    const b = bare(n).split("/").pop();
    if (/grass|meadow|moss|lawn/i.test(b)) return 3;
    const k = PARALLAX_RANK.findIndex((r) => r.test(b));
    return k < 0 ? 2 : k;
  };
  return names.map((n, i) => [rank(n), i, n]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((e) => e[2]);
}

/**
 * Adds the surfaces missing from the terrain and initialises the surface map if needed.
 * Writes <terr>.bak first. Returns a short report.
 */
export function prepareTerrain(terrPath, surfaces, surfaceBits = 8) {
  const chunks = readChunks(readFileSync(terrPath));
  const mats = chunks.find((c) => c.name === "MATS");
  const texs = chunks.find((c) => c.name === "TEXS");
  if (!mats || !texs) throw new Error("MATS/TEXS chunk missing");

  const { prefix, names } = parseMats(mats.body);
  const have = new Set(names.map(bare));
  const added = parallaxOrder(surfaces.filter((s) => s && !have.has(bare(s))));
  mats.body = buildMats(prefix, [...names, ...added]);

  texs.body = Buffer.from(texs.body);
  const wasInit = texs.body[5] === 1;
  texs.body[5] = 1;

  // normal map: copy the flat template for every tile (only on a terrain that never had one)
  let normalsWritten = 0;
  if (texs.body[3] !== 1) {
    const metaText = readFileSync(terrPath + ".meta", "utf-8");
    const tiles = Number(/TilesCount\s+(\d+)/.exec(metaText)?.[1] ?? 0);
    const perTile = Number(/BlocksPerTile\s+(\d+)/.exec(metaText)?.[1] ?? 4);
    if (!tiles) throw new Error("TilesCount missing in " + terrPath + ".meta");
    if (perTile !== 4) throw new Error("normal template is for 4 blocks per tile (128 quads), got " + perTile);
    const name = basename(terrPath, ".terr");
    const dir = dirname(terrPath);
    for (let t = 0; t < tiles; t++) {
      const edds = join(dir, ".Data", `${name}_${t}_normal.edds`);
      const dds = join(dir, ".EditorData", `${name}_${t}_normal.dds`);
      if (!existsSync(edds)) copyFileSync(join(TEMPLATES, "flat_normal_tile128.edds"), edds);
      if (!existsSync(dds)) copyFileSync(join(TEMPLATES, "flat_normal_tile128.dds"), dds);
      normalsWritten++;
    }
    texs.body[3] = 1;
  }

  copyFileSync(terrPath, terrPath + ".bak");
  writeFileSync(terrPath, writeChunks(chunks));

  // meta: TerrainSurfaceBits in the PC config (the other platforms inherit it)
  const metaPath = terrPath + ".meta";
  let meta = readFileSync(metaPath, "utf-8");
  let metaChanged = false;
  if (!/TerrainSurfaceBits/.test(meta)) {
    meta = meta.replace(/(TerrainResourceClass PC \{\r?\n)/, `$1   TerrainSurfaceBits ${surfaceBits}\n`);
    metaChanged = /TerrainSurfaceBits/.test(meta);
    if (metaChanged) {
      copyFileSync(metaPath, metaPath + ".bak");
      writeFileSync(metaPath, meta);
    }
  }

  return { surfaces: names.length + added.length, added: added.length, surfaceMapInitialised: !wasInit, normalsWritten, metaChanged };
}

//! surface materials declared in a .terr (MATS chunk), read-only: ["{GUID}path.emat", ...]
export function listTerrainMaterials(terrPath) {
  const mats = readChunks(readFileSync(terrPath)).find((c) => c.name === "MATS");
  return mats ? parseMats(mats.body).names : [];
}

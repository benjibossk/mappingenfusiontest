#!/usr/bin/env node
// mg-audit.mjs - numeric audit of a world after /apply, without pixels (model: Life-Framework agent-box/place-audit.mjs).
//
//   node scripts/mg-audit.mjs [--live] [--step 8] [--tol 0.5] [--json out.json] [--max 15]
//
// Inputs (Workbench profile/MapGen, override with MAPGEN_WB_PROFILE):
//   mapgen.json, mapgen.1.json, ...   what the web app sent (shapes + entities)
//   entities.txt                      what the world holds (MG_ExportEntities: prefab, x, z, AABB)
//   heights.txt                       terrain of the open world (MG_ExportHeights; header has the ocean height)
//   heightmap.txt                     terrain the app sent (optional)
// --live first asks the bridge (http://127.0.0.1:5780, MAPGEN_BRIDGE_PORT) for GET /entities and /heights,
// which rewrites entities.txt / heights.txt from the open Workbench.
//
// Checks:
//   port-dry      port / naval pieces whose terrain is above the ocean (+0.3 m) and outside every lake; quay-edge
//                 furniture (bollards, buoys, ladders, davits, quay blocks): no water within 3 m (+ half a grid step)
//   on-road       placed objects standing on a road carriageway (road shapes of the project)
//   pole-in-bldg  poles (entity or power-line vertex) inside a building's AABB (built entities.txt)
//   ycm           absolute-height entities (bridges) whose deck is under the terrain or > 15 m above it; the end deck
//                 (DECK_0) sits on its bank: 1 m; harbour pieces keep their vanilla heights: sea piles / piers > 16 m over
//                 the seabed, other pieces > 0.8 m under the ground or > 15 m over max(ground, sea); cliffRocks: burial
//                 per prefab + the slope sink of cliffRocks.ts
//                 vanilla harbours (ids *-h<k>, src/modules/harbour.ts): only their sea parts (piles, piers, dolphins, buoys)
//                 must be wet, their nets / winches / flat pads are quay props on dry land
//   terrain       sent heightmap (+ the 2 m heightpatch.txt of harbours / bridge ramps, sampled first) vs built terrain:
//                 cells off by more than --tol
// Exit code 1 when a check finds something.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LIVE = argv.includes("--live");
const STEP = Number(opt("--step", 8));
const TOL = Number(opt("--tol", 0.5));
const MAX = Number(opt("--max", 15));
const JSON_OUT = opt("--json", null);
const PROFILE = process.env.MAPGEN_WB_PROFILE ?? join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "profile");
const DIR = join(PROFILE, "MapGen");
const BRIDGE = `http://127.0.0.1:${process.env.MAPGEN_BRIDGE_PORT ?? 5780}`;

if (LIVE) {
  for (const u of ["/entities", `/heights?step=${STEP}`]) {
    const r = await fetch(BRIDGE + u).catch((e) => ({ ok: false, statusText: e.message }));
    if (!r.ok) { console.error(`bridge ${u}: ${r.status ?? ""} ${r.statusText} (is node bridge/server.mjs running and the world open?)`); process.exit(2); }
  }
}

// --- sent project ---
const shapes = [], sent = [];
for (let i = 0; ; i++) {
  const f = join(DIR, i === 0 ? "mapgen.json" : `mapgen.${i}.json`);
  if (!existsSync(f)) break;
  const j = JSON.parse(readFileSync(f, "utf-8"));
  shapes.push(...(j.shapes ?? []));
  sent.push(...(j.entities ?? []));
}
if (!shapes.length && !sent.length) { console.error(`no project in ${DIR}`); process.exit(2); }

// --- built entities ---
const built = [];
if (existsSync(join(DIR, "entities.txt")))
  for (const l of readFileSync(join(DIR, "entities.txt"), "utf-8").split(/\r?\n/)) {
    const f = l.trim().split(" ");
    if (f[0] !== "E" || f.length < 9) continue;
    const [x, z, yaw, x0, z0, x1, z1] = f.slice(-7).map(Number);
    built.push({ prefab: f.slice(1, -7).join(" "), x, z, yaw, box: [x0, z0, x1, z1] });
  }

// --- height grids ---
function readGrid(file) {
  if (!existsSync(file)) return null;
  const [h, ...rows] = readFileSync(file, "utf-8").trim().split(/\r?\n/);
  const [minX, minZ, step, cols, nrows, ocean] = h.split(" ").map(Number);
  const v = new Float32Array(cols * nrows);
  let k = 0;
  for (const r of rows) for (const s of r.trim().split(" ")) if (k < v.length) v[k++] = Number(s);
  const at = (x, z) => {
    const fx = Math.min(Math.max((x - minX) / step, 0), cols - 1.001), fz = Math.min(Math.max((z - minZ) / step, 0), nrows - 1.001);
    const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * cols + c;
    return (v[i] * (1 - tx) + v[i + 1] * tx) * (1 - tz) + (v[i + cols] * (1 - tx) + v[i + cols + 1] * tx) * tz;
  };
  return { minX, minZ, step, cols, rows: nrows, ocean: ocean || 0, v, at };
}
const terrain = readGrid(join(DIR, "heights.txt"));
const target = readGrid(join(DIR, "heightmap.txt"));
// 2 m patches (bridge server.mjs heightpatch.txt: per patch a "minX minZ step cols rows" line then rows of heights),
// sampled first by MG_HeightmapApplier: the expected height inside a patch is the patch's
const patches = [];
if (existsSync(join(DIR, "heightpatch.txt"))) {
  const L = readFileSync(join(DIR, "heightpatch.txt"), "utf-8").trim().split(/\r?\n/);
  for (let i = 0; i < L.length; ) {
    const [minX, minZ, step, cols, rows] = L[i].trim().split(/\s+/).map(Number);
    const v = new Float32Array(cols * rows); let k = 0;
    for (const r of L.slice(i + 1, i + 1 + rows)) for (const q of r.trim().split(/\s+/)) if (k < v.length) v[k++] = Number(q);
    patches.push({ minX, minZ, step, cols, rows, v });
    i += 1 + rows;
  }
}
const patchAt = (x, z) => {
  for (const p of patches) {
    const fx = (x - p.minX) / p.step, fz = (z - p.minZ) / p.step;
    if (fx < 0 || fz < 0 || fx > p.cols - 1 || fz > p.rows - 1) continue;
    const c = Math.min(Math.floor(fx), p.cols - 2), r = Math.min(Math.floor(fz), p.rows - 2), tx = fx - c, tz = fz - r, i = r * p.cols + c;
    return (p.v[i] * (1 - tx) + p.v[i + 1] * tx) * (1 - tz) + (p.v[i + p.cols] * (1 - tx) + p.v[i + p.cols + 1] * tx) * tz;
  }
  return null;
};

// --- geometry ---
const pts = (s) => { const o = []; for (let i = 0; i + 1 < s.points.length; i += 2) o.push([s.points[i], s.points[i + 1]]); return o; };
function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// spatial hash of segments
function segIndex(lines, cell = 32) {
  const m = new Map();
  for (const ln of lines) for (let i = 0; i + 1 < ln.p.length; i++) {
    const [a, b] = [ln.p[i], ln.p[i + 1]], r = ln.half;
    for (let cx = Math.floor((Math.min(a[0], b[0]) - r) / cell); cx <= Math.floor((Math.max(a[0], b[0]) + r) / cell); cx++)
      for (let cz = Math.floor((Math.min(a[1], b[1]) - r) / cell); cz <= Math.floor((Math.max(a[1], b[1]) + r) / cell); cz++) {
        const k = cx + "," + cz;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({ a, b, ln });
      }
  }
  return (x, z) => m.get(Math.floor(x / cell) + "," + Math.floor(z / cell)) ?? [];
}

const findings = { "port-dry": [], "on-road": [], "pole-in-bldg": [], ycm: [], terrain: [] };
const r1 = (n) => Math.round(n * 10) / 10;

// port-dry
const lakes = shapes.filter((s) => s.closed && /Lake|WATER_LAKE/i.test(s.generator + s.id)).map(pts);
const isPort = (e) => !/^(ROAD|RB|DAM)/.test(e.id) && /Naval|Pier|Breakwater|Quay|Davit|Jetty|Bollard_Mooring|Mooring/i.test(e.prefab);
// quay furniture (bollards, life buoys, pier ladders, davits, concrete quay blocks) stands ON the quay edge: it only
// needs water within QUAY_REACH m (the 8 m terrain read makes the quay wall a ramp, so the edge is searched around it)
const isQuayEdge = (e) => /SeaBollard|LifeBuoy|Ladder_Pier|Davit|PierConcrete/i.test(e.prefab);
const QUAY_REACH = 3;
const wetNear = (x, z, r) => {
  for (let a = 0; a < 16; a++) for (const d of [r / 2, r]) if (terrain.at(x + Math.cos(a * Math.PI / 8) * d, z + Math.sin(a * Math.PI / 8) * d) <= terrain.ocean + 0.3) return true;
  return false;
};
// vanilla harbour pieces (harbour.ts PORT_SEA_RX / harbourIssues seaDry): sea parts only, breakwaters / wooden piers exempt
const isHarbour = (e) => /-h\d+$/.test(e.id);
const HARBOUR_SEA = /\/Naval\/(Breakwater|Piers\/MooringDolphin|Piers\/Pier_?Wood|Piers\/PierWooden)|\/Naval\/Buoy_01_(red|green)|MooringBuoy/i;
if (terrain)
  for (const e of sent.filter(isPort)) {
    const h = terrain.at(e.x, e.z);
    if (isHarbour(e)) {
      if (HARBOUR_SEA.test(e.prefab) && !/Breakwater|Pier_?Wood/i.test(e.prefab) && h > terrain.ocean + 0.3) findings["port-dry"].push({ id: e.id, prefab: e.prefab.split("/").pop(), x: e.x, z: e.z, ground: r1(h), ocean: r1(terrain.ocean) });
      continue;
    }
    if (isQuayEdge(e) ? !wetNear(e.x, e.z, QUAY_REACH + terrain.step / 2) && h > terrain.ocean + 0.3 && !lakes.some((p) => inPoly(e.x, e.z, p))
      : h > terrain.ocean + 0.3 && !lakes.some((p) => inPoly(e.x, e.z, p)))
      findings["port-dry"].push({ id: e.id, prefab: e.prefab.split("/").pop(), x: e.x, z: e.z, ground: r1(h), ocean: r1(terrain.ocean) });
  }

// on-road
const roadHalf = (g) => (/Narrow/i.test(g) ? 2.6 : /Dirt/i.test(g) ? 2.0 : /DashedLine|Highway|Wide/i.test(g) ? 3.4 : 3.0);
const roads = shapes.filter((s) => /\/RG_Road/.test(s.generator ?? "")).map((s) => ({ id: s.id, half: roadHalf(s.generator), p: pts(s) }));
const roadAt = segIndex(roads);
const roadside = /Sign|VergePost|CrashBarrier|Barrier|Guard|Bollard|Embankment|Probe|Bridge|Culvert|Crossing|Junction|Marking|Lamp|Pole/i;
for (const e of sent) {
  if (roadside.test(e.prefab) || /^(ROAD|RB|DAM|PSTA_ROAD)/.test(e.id) || e.ycm) continue;
  for (const { a, b, ln } of roadAt(e.x, e.z)) {
    const d = segDist(e.x, e.z, a, b);
    if (d < ln.half - 0.3) { findings["on-road"].push({ id: e.id, prefab: e.prefab.split("/").pop(), x: e.x, z: e.z, road: ln.id, dist: r1(d) }); break; }
  }
}

// pole-in-bldg
const isBldg = (p) => /Prefabs\/Structures\/(Houses|Buildings|Industrial|Military\/Buildings|Commercial|Agriculture)/i.test(p) || /Prefabs\/Buildings\//i.test(p);
const bldgs = built.filter((b) => isBldg(b.prefab));
const bcell = new Map();
for (const b of bldgs) for (let cx = Math.floor(b.box[0] / 32); cx <= Math.floor(b.box[2] / 32); cx++) for (let cz = Math.floor(b.box[1] / 32); cz <= Math.floor(b.box[3] / 32); cz++) {
  const k = cx + "," + cz; if (!bcell.has(k)) bcell.set(k, []); bcell.get(k).push(b);
}
// the AABB of a rotated building is up to ~2x its footprint (4th send: poles 18 m from a yawed L house "inside" it):
// its local half sizes are solved back from the AABB and the yaw (|c| w + |s| d = hx, |s| w + |c| d = hz), then the
// pole is tested in that oriented box (0.3 m tolerance). Near 45° the system is singular: the AABB test stands.
// footprints of the library buildings (src/data/buildings.ts rows: prefab, cat|role, [tags,] minX, minZ, maxX, maxZ,
// local to the pivot): exact oriented test when the prefab is known (5th send: lamps 9 m from a 42°-yawed house
// flagged by the AABB fallback)
// cliffRocks burial per prefab (P('guid', 'Name', dy) rows of src/modules/cliffRocks.ts): a rock is wrong when its
// height strays from ground + dy by more than half the burial (6th send: 782 CLIFF_ findings, all vanilla burial)
const ROCK_DY = new Map();
try {
  for (const m of readFileSync(new URL("../src/modules/cliffRocks.ts", import.meta.url), "utf-8").matchAll(/P\('[0-9A-F]{16}', '([^']+)', (-?[\d.]+)\)/g)) ROCK_DY.set(m[1], +m[2]);
} catch {}
const FOOT = new Map();
try {
  const src = readFileSync(new URL("../src/data/buildings.ts", import.meta.url), "utf-8");
  for (const m of src.matchAll(/\['(\{[0-9A-F]{16}\}[^']+\.et)',[^\]]*?(-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/g))
    FOOT.set(m[1].split("/").pop(), [m[2], m[3], m[4], m[5]].map(Number));
} catch {}
function inOriented(b, x, z) {
  const f = FOOT.get(b.prefab.split("/").pop());
  if (f) {
    const dx = x - b.x, dz = z - b.z;
    // the app's convention (gen-common toWorld / industrial footprintOf): world = pivot + (lx c + lz s, -lx s + lz c)
    const r = (b.yaw * Math.PI) / 180, u = dx * Math.cos(r) - dz * Math.sin(r), v = dx * Math.sin(r) + dz * Math.cos(r);
    return u > f[0] + 0.3 && u < f[2] - 0.3 && v > f[1] + 0.3 && v < f[3] - 0.3;
  }
  const a = (b.yaw * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), det = c * c - s * s;
  if (Math.abs(det) < 0.2) return true;
  const hx = (b.box[2] - b.box[0]) / 2, hz = (b.box[3] - b.box[1]) / 2, cx = (b.box[0] + b.box[2]) / 2, cz = (b.box[1] + b.box[3]) / 2;
  const w = (c * hx - s * hz) / det, d = (c * hz - s * hx) / det;
  if (w <= 0 || d <= 0) return true;
  // the yaw sign convention is not certain: inside under either rotation counts (conservative)
  const dx = x - cx, dz = z - cz;
  return [a, -a].some((r) => { const u = dx * Math.cos(r) - dz * Math.sin(r), v = dx * Math.sin(r) + dz * Math.cos(r); return Math.abs(u) < w - 0.3 && Math.abs(v) < d - 0.3; });
}
const poles = [
  // vanilla compositions (ids *_parcel_*: RP sites, yards) carry their own lamps against their own buildings
  ...sent.filter((e) => /Pole|PowerLine|Pylon|Lamp|StreetLight/i.test(e.prefab) && !/_parcel_/.test(e.id)).map((e) => ({ id: e.id, x: e.x, z: e.z })),
  // power-line vertices only: WEGenerators/Walls/Pole/WG_PoleFence_* are fences, not poles (24 false hits, 4th send)
  ...shapes.filter((s) => /PowerLine|Pole/i.test(s.generator ?? "") && !/\/Walls\//i.test(s.generator ?? "")).flatMap((s) => pts(s).map(([x, z], i) => ({ id: `${s.id}#${i}`, x, z }))),
];
for (const p of poles)
  for (const b of bcell.get(Math.floor(p.x / 32) + "," + Math.floor(p.z / 32)) ?? [])
    if (p.x > b.box[0] + 0.3 && p.x < b.box[2] - 0.3 && p.z > b.box[1] + 0.3 && p.z < b.box[3] - 0.3 && inOriented(b, p.x, p.z)) {
      findings["pole-in-bldg"].push({ id: p.id, x: r1(p.x), z: r1(p.z), building: b.prefab.split("/").pop() });
      break;
    }

// ycm
if (terrain)
  for (const e of sent.filter((e) => e.ycm && !/PILLAR|_WALL_/.test(e.id) && !/PierConcrete/.test(e.prefab))) {
    const y = e.ycm / 100, g = terrain.at(e.x, e.z);
    // cliffRocks bury their pivot on purpose (vanilla burial, up to ~0.6 x the piece height): only a rock lost
    // deep under the ground or floating counts (6th send: 782 CLIFF_ findings, all burial)
    const rock = /^CLIFF_/.test(e.id);
    const name = e.prefab.split("/").pop().replace(/\.et$/, "");
    const dy = ROCK_DY.get(name) ?? 0;
    let bad;
    if (rock) {
      // cliffRocks sink the big pieces by the drop across their footprint (+ half-burial on > 40 deg): sink = sl R 0.6
      // + 0.2 min(1, sl) [+ 1.5 R (sl - 0.84) + 1 for cliffs / rocks], dy itself +-15 % (seed 21 live: 80 rocks on slopes)
      const kind = /Cliff/.test(name) ? "cliff" : /GraniteRock/.test(name) ? "rock" : /SurfaceStone/.test(name) ? "slab" : /Boulder/.test(name) ? "boulder" : /Cluster/.test(name) ? "cluster" : /Beach/.test(name) ? "beach" : "stone";
      const R = { cliff: 6, rock: 4, slab: 2.5, boulder: 1.5, cluster: 1.5, stone: 0.6, beach: 1 }[kind], d = Math.max(2, R);
      const sl = Math.hypot(terrain.at(e.x + d, e.z) - terrain.at(e.x - d, e.z), terrain.at(e.x, e.z + d) - terrain.at(e.x, e.z - d)) / (2 * d);
      const sink = sl * R * 0.6 + 0.2 * Math.min(1, sl) + ((kind === "cliff" || kind === "rock") && sl > 0.84 ? 1.5 * R * (sl - 0.84) + 1 : 0);
      // the 8 m audit grid misses ~3 m on 35 deg rock faces, more on steeper ones (bilinear error ~ slope x half a step)
      const tol = Math.max(3, Math.abs(dy) * 0.5) + sl * terrain.step * 0.5;
      bad = y - g > dy * 0.85 + tol || y - g < dy * 1.15 - sink * 1.5 - tol;
    } else if (isHarbour(e)) {
      if (/Buoy/i.test(e.prefab)) bad = false; // floating at the surface or grounded: vanilla height
      else if (HARBOUR_SEA.test(e.prefab)) bad = y - g > 16; // piles hanging in open water (seabed under sea parts -7.5)
      else bad = (g > 0 && y < g - 0.8) || y > Math.max(g, 0) + 15;
    } else bad = y < g - (/_DECK_0$/.test(e.id) ? 1 : 0.2) || y > g + 15;
    if (bad) findings.ycm.push({ id: e.id, x: e.x, z: e.z, y: r1(y), ground: r1(g), delta: r1(y - g) });
  }

// terrain
let tStats = null;
if (terrain && target) {
  let n = 0, bad = 0, max = 0, sum = 0;
  for (let r = 0; r < target.rows; r++) for (let c = 0; c < target.cols; c++) {
    const x = target.minX + c * target.step, z = target.minZ + r * target.step;
    if (x >= terrain.minX + (terrain.cols - 1) * terrain.step || z >= terrain.minZ + (terrain.rows - 1) * terrain.step) continue;
    const want = patchAt(x, z) ?? target.v[r * target.cols + c], d = terrain.at(x, z) - want;
    n++; sum += Math.abs(d);
    if (Math.abs(d) > max) max = Math.abs(d);
    if (Math.abs(d) > TOL) { bad++; if (findings.terrain.length < 500) findings.terrain.push({ x, z, sent: r1(want), built: r1(d + want), delta: r1(d) }); }
  }
  findings.terrain.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  tStats = { cells: n, bad, maxAbs: r1(max), meanAbs: Math.round((sum / Math.max(n, 1)) * 100) / 100 };
}

// --- report ---
console.log(`mg-audit  ${DIR}`);
console.log(`  sent: ${shapes.length} shapes, ${sent.length} entities | built: ${built.length} entities (${bldgs.length} buildings) | terrain: ${terrain ? `${terrain.cols}x${terrain.rows} step ${terrain.step}, ocean ${terrain.ocean}` : "missing (heights.txt)"}`);
const skipped = [];
if (!terrain) skipped.push("port-dry", "ycm", "terrain");
else if (!target) skipped.push("terrain (no heightmap.txt)");
if (!built.length) skipped.push("pole-in-bldg (no entities.txt)");
if (skipped.length) console.log(`  skipped: ${skipped.join(", ")}`);
let total = 0;
for (const [k, list] of Object.entries(findings)) {
  const n = k === "terrain" && tStats ? tStats.bad : list.length;
  total += n;
  console.log(`\n[${n ? "FAIL" : " ok "}] ${k}: ${n}${k === "terrain" && tStats ? `  (cells ${tStats.cells}, max |d| ${tStats.maxAbs} m, mean |d| ${tStats.meanAbs} m, tol ${TOL})` : ""}`);
  for (const f of list.slice(0, MAX)) console.log("   " + Object.entries(f).map(([a, b]) => `${a}=${b}`).join(" "));
  if (list.length > MAX) console.log(`   ... ${list.length - MAX} more`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ dir: DIR, terrain: tStats, findings }, null, 1));
process.exit(total ? 1 : 0);

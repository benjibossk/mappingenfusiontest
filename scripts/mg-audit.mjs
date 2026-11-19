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
//   port-dry      port / naval pieces whose terrain is above the ocean (+0.3 m) and outside every lake
//   on-road       placed objects standing on a road carriageway (road shapes of the project)
//   pole-in-bldg  poles (entity or power-line vertex) inside a building's AABB (built entities.txt)
//   ycm           absolute-height entities (bridges) whose deck is under the terrain or > 15 m above it
//   terrain       sent heightmap vs built terrain: cells off by more than --tol
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
if (terrain)
  for (const e of sent.filter(isPort)) {
    const h = terrain.at(e.x, e.z);
    if (h > terrain.ocean + 0.3 && !lakes.some((p) => inPoly(e.x, e.z, p)))
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
const poles = [
  ...sent.filter((e) => /Pole|PowerLine|Pylon|Lamp|StreetLight/i.test(e.prefab)).map((e) => ({ id: e.id, x: e.x, z: e.z })),
  ...shapes.filter((s) => /PowerLine|Pole/i.test(s.generator ?? "")).flatMap((s) => pts(s).map(([x, z], i) => ({ id: `${s.id}#${i}`, x, z }))),
];
for (const p of poles)
  for (const b of bcell.get(Math.floor(p.x / 32) + "," + Math.floor(p.z / 32)) ?? [])
    if (p.x > b.box[0] + 0.3 && p.x < b.box[2] - 0.3 && p.z > b.box[1] + 0.3 && p.z < b.box[3] - 0.3) {
      findings["pole-in-bldg"].push({ id: p.id, x: r1(p.x), z: r1(p.z), building: b.prefab.split("/").pop() });
      break;
    }

// ycm
if (terrain)
  for (const e of sent.filter((e) => e.ycm && !/PILLAR|_WALL_/.test(e.id))) {
    const y = e.ycm / 100, g = terrain.at(e.x, e.z);
    if (y < g - 0.2 || y > g + 15) findings.ycm.push({ id: e.id, x: e.x, z: e.z, y: r1(y), ground: r1(g), delta: r1(y - g) });
  }

// terrain
let tStats = null;
if (terrain && target) {
  let n = 0, bad = 0, max = 0, sum = 0;
  for (let r = 0; r < target.rows; r++) for (let c = 0; c < target.cols; c++) {
    const x = target.minX + c * target.step, z = target.minZ + r * target.step;
    if (x >= terrain.minX + (terrain.cols - 1) * terrain.step || z >= terrain.minZ + (terrain.rows - 1) * terrain.step) continue;
    const d = terrain.at(x, z) - target.v[r * target.cols + c];
    n++; sum += Math.abs(d);
    if (Math.abs(d) > max) max = Math.abs(d);
    if (Math.abs(d) > TOL) { bad++; if (findings.terrain.length < 500) findings.terrain.push({ x, z, sent: r1(target.v[r * target.cols + c]), built: r1(d + target.v[r * target.cols + c]), delta: r1(d) }); }
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

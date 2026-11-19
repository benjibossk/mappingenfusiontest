// Reconstruction benchmark: give our generators only the 2D layer of a vanilla map (relief, roads,
// rivers / lakes, settlement sites) and compare what they fill in with the real vanilla entities.
//   npx tsx scripts/bench/bench.ts [everon|arland|kolguyev] [--png outDir] [--json out.json]
// Scores are 0..100 (100 = identical statistics). Categories: villages (building count per 250 m tile,
// road setback, orientation vs road, nearest-neighbour spacing), power (pole spans).
import { settlementDensityMul } from '../../src/biomes/vegetation'
import '../../src/workers/shim'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { refHeights, type RefMap } from '../../src/modules/refMap'
import { ROAD_TYPES, centreLine, roadHalf, type Road, type RoadType } from '../../src/modules/roads'
import { roadTypeOf } from '../../src/atelier/networks/roads'
import { settleVillages } from '../../src/modules/village'
import { generateTown } from '../../src/modules/town'
import { WORLD } from '../../src/data/worldParams'
import { lotFences, makeBlocker, townLots, type FenceLot } from '../../src/modules/worldextras'
import { worldPowerGrid, powerWorld } from '../../src/modules/worldpower'
import type { Site } from '../../src/modules/network'
import type { Water } from '../../src/modules/water'

const args = process.argv.slice(2)
const mapId = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? 'everon'
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const TILE = 250
const noPower = !args.includes('--power') // whole-map power planning takes > 25 min on Everon: opt-in
const m: RefMap = JSON.parse(readFileSync(new URL(`../../public/refmaps/${mapId}.json`, import.meta.url), 'utf8'))
const hb = m.heights!
const grid = { minX: m.minX, minZ: m.minZ, step: hb.step, cols: hb.cols, rows: hb.rows }
const heights = refHeights(hb)

// ---- 2D input layer -------------------------------------------------------------------------------
const byGen = new Map(Object.entries(ROAD_TYPES).filter(([k]) => k !== 'motorway').map(([k, v]) => [v.generator.replace(/^.*\//, '').replace(/\.et$/, '').toLowerCase(), k as RoadType]))
export const roads: Road[] = m.roads.map((r, i) => {
  const g = r.gen.replace(/^.*\//, '').replace(/\.et$/, '').toLowerCase()
  const type = byGen.get(g) ?? roadTypeOf(r.gen)
  return { id: `R${i}`, type, pts: r.pts, ...(r.w > 0 ? { width: r.w } : {}) }
})
const waters: Water[] = [
  ...(m.lakes2 ?? []).map((l, i) => ({ id: `L${i}`, type: 'lake', pts: l.pts, width: 0, depth: 2, level: l.level }) as Water),
  ...(m.rivers2 ?? []).map((l, i) => ({ id: `W${i}`, type: 'river', pts: l.pts, width: l.w, depth: 1.5 }) as Water),
]
// settlement sites = clusters of vanilla civil buildings (single link, 45 m)
const CIVIL = new Set(['house', 'shed', 'civic', 'church', 'farm'])
// graves, calvaries, castle walls are not buildings a village generator places (cemetery = its own site)
export const NOT_BUILDING = /Grave|Calvary|Castle|Fence|Wall|Monument|Statue|Ruin/i
const vb = m.buildings.items.filter((b) => CIVIL.has(b[4]) && !NOT_BUILDING.test(m.buildings.prefabs[b[0]])).map(([, x, z, yaw, cls]) => ({ x, z, yaw, cls }))
function clusters(pts: { x: number; z: number }[], link: number): number[][] {
  const cell = new Map<string, number[]>(), key = (x: number, z: number) => `${Math.floor(x / link)},${Math.floor(z / link)}`
  pts.forEach((p, i) => { const k = key(p.x, p.z); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i) })
  const lab = new Int32Array(pts.length).fill(-1), out: number[][] = []
  for (let i = 0; i < pts.length; i++) {
    if (lab[i] >= 0) continue
    const c: number[] = [i]; lab[i] = out.length
    for (let q = 0; q < c.length; q++) {
      const p = pts[c[q]], cx = Math.floor(p.x / link), cz = Math.floor(p.z / link)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? [])
        if (lab[j] < 0 && Math.hypot(pts[j].x - p.x, pts[j].z - p.z) < link) { lab[j] = out.length; c.push(j) }
    }
    out.push(c)
  }
  return out
}
const cl = clusters(vb, 45)
const sites: (Site & { n: number })[] = []
cl.forEach((c, k) => {
  if (c.length < 3) return
  const x = c.reduce((a, i) => a + vb[i].x, 0) / c.length, z = c.reduce((a, i) => a + vb[i].z, 0) / c.length
  const kind = c.length >= 120 ? 'town' : c.length >= 10 ? 'village' : 'hamlet'
  sites.push({ id: `S${k}`, x, z, kind, n: c.length })
})
// a vanilla village often splits into a core + satellite clusters: satellites within 220 m of a bigger site are the
// same place (worldgen never puts two sites that close), their buildings stay in the reference
for (let i = sites.length - 1; i >= 0; i--) if (sites.some((o) => o !== sites[i] && o.n > sites[i].n && Math.hypot(o.x - sites[i].x, o.z - sites[i].z) < 220)) sites.splice(i, 1)
// experiment overrides: --set village.density=0.8
for (let i = 0; i < args.length; i++) if (args[i] === '--set') { const [k, v] = args[i + 1].split('='), [a, b] = k.split('.'); (WORLD.villages as never as Record<string, Record<string, number>>)[a][b] = Number(v) }
const inSites = new Set(cl.filter((c) => c.length >= 3).flat())
const vanillaB = vb.filter((_, i) => inSites.has(i))

// ---- run the generators ---------------------------------------------------------------------------
const t0 = Date.now()
const lots: FenceLot[] = []
let placed: { x: number; z: number; yaw: number; cat: string; prefab: string }[] = []
for (const kind of ['town', 'village', 'hamlet'] as const) {
  const ks = sites.filter((s) => s.kind === kind)
  if (kind === 'town') {
    // same as worldgen: "vraie ville" on a 300 m disc, fallback to settleVillages when it lays out < 30 buildings
    for (const s of ks.splice(0)) {
      const ring: number[] = []
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ring.push(s.x + Math.cos(a) * 300, s.z + Math.sin(a) * 300) }
      const tr = generateTown(ring, roads, waters, heights, grid, { seed: 21, density: WORLD.villages.town.density, prefix: s.id }, placed as never)
      if (tr.placed.length - placed.length < 30) { ks.push(s); continue }
      placed = tr.placed
    }
  }
  if (!ks.length) continue
  const V = WORLD.villages[kind]
  const vr = settleVillages(ks, roads, waters, heights, grid, { seed: 21, density: V.density * Number(opt("--vmul") ?? settlementDensityMul(mapId === 'kolguyev' ? 'nordic_kolguyev' : mapId === 'arland' ? 'woodland_arland' : undefined)), maxStreets: V.maxStreets, dropScale: WORLD.villages.dropScale, variant: 'auto', template: true }, placed as never)
  placed = vr.placed
  lots.push(...vr.lots)
}
const kinds = new Map<string, string>(sites.map((q) => [q.id, q.kind]))
if (!args.includes('--no-town-lots')) lots.push(...townLots(placed as never, (id) => kinds.get(id) === 'town'))
const fenceParcels = lots.length ? lotFences(lots, { seed: 21, ...(opt("--fence-share") ? { share: Number(opt("--fence-share")) } : {}), ...(opt("--garden") ? { garden: Number(opt("--garden")) } : {}), kindOf: (id) => kinds.get(id) as never, blocked: makeBlocker((placed as never as { corners: number[] }[]).map((q) => q.corners), roads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) }))) }) : []
const genFences = fenceParcels.flatMap((fp) => fp.fences.map((f) => f.pts))
const isWater = (x: number, z: number) => { const c = Math.round((x - grid.minX) / grid.step), r = Math.round((z - grid.minZ) / grid.step); return (heights[Math.min(grid.rows - 1, Math.max(0, r)) * grid.cols + Math.min(grid.cols - 1, Math.max(0, c))] ?? 0) <= 0 }
const pw = noPower ? null : worldPowerGrid(heights, grid, sites, [], roads.map((r) => r.pts), isWater, m.size, 'eden', powerWorld(roads, (placed as never as { corners: number[] }[]).map((q) => q.corners), lots.filter((l) => l.used).map((l) => l.corners), []), 'auto')
const genSec = (Date.now() - t0) / 1000
placed = placed.filter((b) => !NOT_BUILDING.test(b.prefab))

// ---- metrics ---------------------------------------------------------------------------------------
const lines = roads.filter((r) => r.pts.length >= 4).map((r) => { const pts = centreLine(r.pts, 4); let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < pts.length; i += 2) { a = Math.min(a, pts[i]); b = Math.min(b, pts[i + 1]); c = Math.max(c, pts[i]); d = Math.max(d, pts[i + 1]) } return { pts, half: roadHalf(r), a, b, c, d } })
const lcell = new Map<string, number[]>()
lines.forEach((l, i) => { for (let x = Math.floor((l.a - 60) / 100); x <= Math.floor((l.c + 60) / 100); x++) for (let z = Math.floor((l.b - 60) / 100); z <= Math.floor((l.d + 60) / 100); z++) (lcell.get(`${x},${z}`) ?? lcell.set(`${x},${z}`, []).get(`${x},${z}`)!).push(i) })
/** distance to the nearest road edge (<= 60 m) and the road heading there (degrees) */
function nearRoad(x: number, z: number): { d: number; dir: number } {
  let best = 60, dir = NaN
  for (const i of lcell.get(`${Math.floor(x / 100)},${Math.floor(z / 100)}`) ?? []) {
    const l = lines[i], p = l.pts
    for (let k = 2; k < p.length; k += 2) {
      const ax = p[k - 2], az = p[k - 1], dx = p[k] - ax, dz = p[k + 1] - az, L = dx * dx + dz * dz
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz) - l.half
      if (d < best) { best = d; dir = (Math.atan2(-dz, dx) * 180) / Math.PI }
    }
  }
  return { d: Math.max(0, best), dir }
}
const fold90 = (a: number) => { let r = ((a % 90) + 90) % 90; if (r > 45) r = 90 - r; return r }
function nn(pts: { x: number; z: number }[]): number[] {
  const cell = new Map<string, number[]>()
  pts.forEach((p, i) => { const k = `${Math.floor(p.x / 50)},${Math.floor(p.z / 50)}`; (cell.get(k) ?? cell.set(k, []).get(k)!).push(i) })
  return pts.map((p, i) => {
    let b = 100
    const cx = Math.floor(p.x / 50), cz = Math.floor(p.z / 50)
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) if (j !== i) b = Math.min(b, Math.hypot(pts[j].x - p.x, pts[j].z - p.z))
    return b
  })
}
/** 100 * (1 - Kolmogorov-Smirnov distance) */
function ksScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0
  const A = a.slice().sort((x, y) => x - y), B = b.slice().sort((x, y) => x - y)
  let i = 0, j = 0, d = 0
  while (i < A.length && j < B.length) { const v = Math.min(A[i], B[j]); while (i < A.length && A[i] <= v) i++; while (j < B.length && B[j] <= v) j++; d = Math.max(d, Math.abs(i / A.length - j / B.length)) }
  return 100 * (1 - d)
}
const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN }
const desc = (v: { x: number; z: number; yaw: number }[]) => {
  const r = v.map((b) => nearRoad(b.x, b.z))
  return { setback: r.map((q) => q.d), orient: v.map((b, i) => (Number.isNaN(r[i].dir) ? NaN : fold90(b.yaw - r[i].dir))).filter((x) => !Number.isNaN(x)), nn: nn(v) }
}
const dv = desc(vanillaB), dg = desc(placed)

// per-tile counts
const T = Math.ceil(m.size / TILE), cv = new Float64Array(T * T), cg = new Float64Array(T * T)
const ti = (x: number, z: number) => Math.min(T - 1, Math.max(0, Math.floor((z - m.minZ) / TILE))) * T + Math.min(T - 1, Math.max(0, Math.floor((x - m.minX) / TILE)))
for (const b of vanillaB) cv[ti(b.x, b.z)]++
for (const b of placed) cg[ti(b.x, b.z)]++
let num = 0, den = 0
const tiles: { t: number; v: number; g: number }[] = []
for (let k = 0; k < T * T; k++) if (cv[k] || cg[k]) { num += Math.min(cv[k], cg[k]); den += Math.max(cv[k], cg[k]); tiles.push({ t: k, v: cv[k], g: cg[k] }) }
// per-site counts (a site = the vanilla cluster; ours = buildings within the cluster reach)
const siteScore = sites.map((s) => {
  const R = s.kind === 'town' ? 300 : s.kind === 'village' ? 170 : 80
  const g = placed.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) < R).length, v = vanillaB.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) < R).length
  return { id: s.id, kind: s.kind, x: Math.round(s.x), z: Math.round(s.z), v, g }
})
const kindRatio = (k: string) => { const ss = siteScore.filter((s) => s.kind === k); const v = ss.reduce((a, s) => a + s.v, 0), g = ss.reduce((a, s) => a + s.g, 0); return { sites: ss.length, v, g, ratio: v ? +(g / v).toFixed(2) : 0 } }

const villages = {
  tileCount: +(100 * num / den).toFixed(1),
  total: +(100 * Math.min(placed.length, vanillaB.length) / Math.max(placed.length, vanillaB.length)).toFixed(1),
  setback: +ksScore(dv.setback, dg.setback).toFixed(1),
  orient: +ksScore(dv.orient, dg.orient).toFixed(1),
  spacing: +ksScore(dv.nn, dg.nn).toFixed(1),
}
const villageScore = +((villages.tileCount + villages.total + villages.setback + villages.orient + villages.spacing) / 5).toFixed(1)

// ---- fences: length per site disc (vanilla pieces vs our lot fences)
const fenceLen = (pl: number[]) => { let L = 0; for (let i = 2; i < pl.length; i += 2) L += Math.hypot(pl[i] - pl[i - 2], pl[i + 1] - pl[i - 1]); return L }
const vf = m.fences.items.map(([, x, z, , len]) => ({ x, z, len })), gf = genFences.map((pl) => ({ x: pl[0], z: pl[1], len: fenceLen(pl) }))
const fenceSites = sites.map((q) => { const R = q.kind === 'town' ? 300 : q.kind === 'village' ? 170 : 80; const s2 = (a: { x: number; z: number; len: number }[]) => a.reduce((t, f) => t + (Math.hypot(f.x - q.x, f.z - q.z) < R ? f.len : 0), 0); return { v: s2(vf), g: s2(gf) } })
const fv = fenceSites.reduce((a, q) => a + q.v, 0), fg = fenceSites.reduce((a, q) => a + q.g, 0)
const fenceScore = +(100 * fenceSites.reduce((a, q) => a + Math.min(q.v, q.g), 0) / Math.max(1, fenceSites.reduce((a, q) => a + Math.max(q.v, q.g), 0))).toFixed(1)
const fences = { score: fenceScore, perSiteKm: { vanilla: +(fv / 1000).toFixed(1), ours: +(fg / 1000).toFixed(1) }, ratio: +(fg / Math.max(1, fv)).toFixed(2) }

// ---- power: poles per tile + spans per kind
const vPoles: { x: number; z: number; k: string }[] = [], gPoles: typeof vPoles = []
const spanOf = (pts: number[]) => { const o: number[] = []; for (let i = 2; i < pts.length; i += 2) o.push(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])); return o }
const vSpan: Record<string, number[]> = {}, gSpan: Record<string, number[]> = {}, vLen: Record<string, number> = {}, gLen: Record<string, number> = {}
for (const l of m.power) { const k = (l as { kind?: string }).kind ?? 'mv'; for (let i = 0; i < l.pts.length; i += 2) vPoles.push({ x: l.pts[i], z: l.pts[i + 1], k }); const sp = spanOf(l.pts); (vSpan[k] ??= []).push(...sp); vLen[k] = (vLen[k] ?? 0) + sp.reduce((a, b) => a + b, 0) }
for (const l of pw?.lines ?? []) { const k = l.kind; for (let i = 0; i < l.poles.length; i += 2) gPoles.push({ x: l.poles[i], z: l.poles[i + 1], k }); const sp = spanOf(l.poles); (gSpan[k] ??= []).push(...sp); gLen[k] = (gLen[k] ?? 0) + sp.reduce((a, b) => a + b, 0) }
const pv = new Float64Array(T * T), pg = new Float64Array(T * T)
for (const q of vPoles) pv[ti(q.x, q.z)]++
for (const q of gPoles) pg[ti(q.x, q.z)]++
let pn = 0, pd = 0
for (let k = 0; k < T * T; k++) { pn += Math.min(pv[k], pg[k]); pd += Math.max(pv[k], pg[k]) }
const nearShare = (a: { x: number; z: number; k: string }[], k: string) => { const b = a.filter((q) => q.k === k); return b.length ? +(b.filter((q) => nearRoad(q.x, q.z).d < 10).length / b.length).toFixed(2) : null }
const kindsP = [...new Set([...Object.keys(vSpan), ...Object.keys(gSpan)])]
const power = noPower ? null : {
  tilePoles: +(100 * pn / Math.max(1, pd)).toFixed(1),
  poles: { vanilla: vPoles.length, ours: gPoles.length },
  byKind: Object.fromEntries(kindsP.map((k) => [k, { km: [+((vLen[k] ?? 0) / 1000).toFixed(1), +((gLen[k] ?? 0) / 1000).toFixed(1)], span: [+med(vSpan[k] ?? []).toFixed(1), +med(gSpan[k] ?? []).toFixed(1)], spanKS: +ksScore(vSpan[k] ?? [], gSpan[k] ?? []).toFixed(1), nearRoad10: [nearShare(vPoles, k), nearShare(gPoles, k)] }])),
}
// ---- power: pole spans of the vanilla lines (reference only, our routing is fed by the same sites)
const spans = (kind: string) => m.power.filter((l) => (l as { kind?: string }).kind === kind).flatMap((l) => { const o: number[] = []; for (let i = 2; i < l.pts.length; i += 2) o.push(Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1])); return o })

const report = {
  map: m.name, genSec, sites: sites.length,
  villages: { score: villageScore, ...villages, counts: { vanilla: vanillaB.length, ours: placed.length }, byKind: { town: kindRatio('town'), village: kindRatio('village'), hamlet: kindRatio('hamlet') },
    median: { setback: [med(dv.setback), med(dg.setback)].map((x) => +x.toFixed(1)), orient: [med(dv.orient), med(dg.orient)].map((x) => +x.toFixed(1)), nn: [med(dv.nn), med(dg.nn)].map((x) => +x.toFixed(1)) },
    worstSites: siteScore.map((s) => ({ ...s, err: Math.abs(s.g - s.v) })).sort((a, b) => b.err - a.err).slice(0, 8) },
  fences,
  power,
  scores: { villages: villageScore, fences: fenceScore, power: power?.tilePoles ?? null },
  powerRef: { nearRoad10: Object.fromEntries(kindsP.map((k) => [k, nearShare(vPoles, k)])), lvMedianSpan: +med(spans('lv')).toFixed(1), mvMedianSpan: +med(spans('mv')).toFixed(1), hvMedianSpan: +med(spans('hv')).toFixed(1) },
}
console.log(JSON.stringify(report, null, 1))
if (opt("--png")) mkdirSync(opt("--png")!, { recursive: true })
if (opt("--json")) writeFileSync(opt('--json')!, JSON.stringify(report, null, 1))

// ---- heatmap PNG: red = we place more, blue = fewer, brightness = |error| -------------------------
const dir = opt('--png')
if (dir) {
  mkdirSync(dir, { recursive: true })
  const S = 8, W = T * S, px = Buffer.alloc((W * 3 + 1) * W)
  for (let r = 0; r < W; r++) {
    px[r * (W * 3 + 1)] = 0
    const tz = T - 1 - Math.floor(r / S)
    for (let c = 0; c < W; c++) {
      const k = tz * T + Math.floor(c / S), e = cg[k] - cv[k], a = Math.min(1, Math.abs(e) / 20), o = r * (W * 3 + 1) + 1 + c * 3
      const land = heights[Math.min(grid.rows - 1, Math.floor(((tz + 0.5) * TILE) / grid.step)) * grid.cols + Math.min(grid.cols - 1, Math.floor(((Math.floor(c / S) + 0.5) * TILE) / grid.step))] > 0
      const base = land ? 60 : 20
      px[o] = e > 0 ? base + a * 195 : base; px[o + 1] = base; px[o + 2] = e < 0 ? base + a * 195 : base + (land ? 0 : 30)
    }
  }
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2
  writeFileSync(join(dir, `${mapId}-villages-heat.png`), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]))
}

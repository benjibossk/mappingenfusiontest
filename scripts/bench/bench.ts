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
import { settleVillages, villageOblique } from '../../src/modules/village'
import { parcelShareOf, setParcelHoldout } from '../../src/modules/parcelTemplates'
import { generateTown } from '../../src/modules/town'
import { WORLD } from '../../src/data/worldParams'
import { lotFences, makeBlocker, townLots, type FenceLot } from '../../src/modules/worldextras'
import { worldPowerGrid, powerWorld } from '../../src/modules/worldpower'
import { parallelOverlap } from '../../src/modules/powergrid'
import type { Site } from '../../src/modules/network'
import type { Water } from '../../src/modules/water'
import { GROW_VILLAGE } from '../../src/modules/villageStreets'
import { pastureFences, pastureDensity, pastureStyles } from '../../src/modules/pastures'
import { streetLights } from '../../src/modules/streetLights'
import { gameplayReport, GAMEPLAY_NOT_BUILDING } from '../../src/modules/gameplay'
import { localStreets, streetStats, polyLen, STREET_REACH } from './streets'
import { rocksBench } from './rocks'
import { ensemblesBench } from './ensembles'

const args = process.argv.slice(2)
const mapId = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? 'everon'
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const TILE = 250
// --parcel-holdout: farmstead parcels harvested on this map are not used (held-out score)
if (args.includes('--parcel-holdout')) setParcelHoldout(mapId)
const BIOME = mapId === 'kolguyev' ? 'nordic_kolguyev' : mapId === 'arland' ? 'woodland_arland' : undefined
const SEED = Number(opt('--seed') ?? 21)
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
for (let i = 0; i < args.length; i++) if (args[i] === '--grow') { const [k, v] = args[i + 1].split('='); (GROW_VILLAGE as never as Record<string, number>)[k] = Number(v) }
const inSites = new Set(cl.filter((c) => c.length >= 3).flat())
const vanillaB = vb.filter((_, i) => inSites.has(i))

// ---- run the generators ---------------------------------------------------------------------------
const t0 = Date.now()
const lots: FenceLot[] = []
const benchLanes: Road[] = [] // village / town lanes (street lamps)
let placed: { x: number; z: number; yaw: number; cat: string; prefab: string }[] = []
for (const kind of ['town', 'village', 'hamlet'] as const) {
  const ks = sites.filter((s) => s.kind === kind)
  if (kind === 'town') {
    // same as worldgen: "vraie ville" on a 300 m disc, fallback to settleVillages when it lays out < 30 buildings
    for (const s of ks.splice(0)) {
      const ring: number[] = []
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ring.push(s.x + Math.cos(a) * 300, s.z + Math.sin(a) * 300) }
      const tr = generateTown(ring, roads, waters, heights, grid, { seed: SEED, density: WORLD.villages.town.density, prefix: s.id }, placed as never)
      if (tr.placed.length - placed.length < 30) { ks.push(s); continue }
      placed = tr.placed
      benchLanes.push(...tr.lanes)
    }
  }
  if (!ks.length) continue
  const V = WORLD.villages[kind]
  const vr = settleVillages(ks, roads, waters, heights, grid, { seed: SEED, ...(BIOME ? { yards: BIOME } : {}), density: V.density * Number(opt("--vmul") ?? settlementDensityMul(mapId === 'kolguyev' ? 'nordic_kolguyev' : mapId === 'arland' ? 'woodland_arland' : undefined)), maxStreets: V.maxStreets, dropScale: WORLD.villages.dropScale, variant: 'auto', template: true, parcelShare: opt('--pshare') !== undefined ? Number(opt('--pshare')) : parcelShareOf(BIOME), oblique: villageOblique(BIOME) }, placed as never)
  placed = vr.placed
  lots.push(...vr.lots)
  benchLanes.push(...vr.lanes)
}
const kinds = new Map<string, string>(sites.map((q) => [q.id, q.kind]))
if (!args.includes('--no-town-lots')) lots.push(...townLots(placed as never, (id) => kinds.get(id) === 'town'))
const fenceParcels = lots.length ? lotFences(lots, { seed: SEED, ...(opt("--fence-share") ? { share: Number(opt("--fence-share")) } : {}), ...(opt("--garden") ? { garden: Number(opt("--garden")) } : {}), ...(opt("--back") ? { back: Number(opt("--back")) } : {}), kindOf: (id) => kinds.get(id) as never, blocked: makeBlocker((placed as never as { corners: number[] }[]).map((q) => q.corners), roads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) }))) }) : []
let genFences = fenceParcels.flatMap((fp) => fp.fences.map((f) => f.pts))
const isWater = (x: number, z: number) => { const c = Math.round((x - grid.minX) / grid.step), r = Math.round((z - grid.minZ) / grid.step); return (heights[Math.min(grid.rows - 1, Math.max(0, r)) * grid.cols + Math.min(grid.cols - 1, Math.max(0, c))] ?? 0) <= 0 }
const pw = noPower ? null : worldPowerGrid(heights, grid, sites, [], roads.map((r) => r.pts), isWater, m.size, 'eden', powerWorld(roads, (placed as never as { corners: number[] }[]).map((q) => q.corners), lots.filter((l) => l.used).map((l) => l.corners), []), 'auto')
const genSec = (Date.now() - t0) / 1000
placed = placed.filter((b) => !NOT_BUILDING.test(b.prefab))

// ---- metrics ---------------------------------------------------------------------------------------
function roadIndex(rs: Road[]) {
  const lines = rs.filter((r) => r.pts.length >= 4).map((r) => { const pts = centreLine(r.pts, 4); let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < pts.length; i += 2) { a = Math.min(a, pts[i]); b = Math.min(b, pts[i + 1]); c = Math.max(c, pts[i]); d = Math.max(d, pts[i + 1]) } return { pts, half: roadHalf(r), a, b, c, d } })
  const lcell = new Map<string, number[]>()
  lines.forEach((l, i) => { for (let x = Math.floor((l.a - 60) / 100); x <= Math.floor((l.c + 60) / 100); x++) for (let z = Math.floor((l.b - 60) / 100); z <= Math.floor((l.d + 60) / 100); z++) (lcell.get(`${x},${z}`) ?? lcell.set(`${x},${z}`, []).get(`${x},${z}`)!).push(i) })
  /** distance to the nearest road edge (<= 60 m) and the road heading there (degrees) */
  return function nearRoad(x: number, z: number): { d: number; dir: number } {
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
}
const nearRoad = roadIndex(roads)
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
const desc = (v: { x: number; z: number; yaw: number }[], nr = nearRoad) => {
  const r = v.map((b) => nr(b.x, b.z))
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

// ---- farmsteads (reported apart, not in the village score): each outbuilding vs its nearest house within 35 m,
// distance and squareness (fold90 of the yaw difference), plus the outbuildings-per-house ratio
const yard = (v: { x: number; z: number; yaw: number }[], isOut: (i: number) => boolean) => {
  const hs = v.filter((_, i) => !isOut(i)), dist: number[] = [], ang: number[] = []
  let n = 0
  v.forEach((b, i) => {
    if (!isOut(i)) return
    n++
    let best = 35, h: { yaw: number } | null = null
    for (const q of hs) { const d = Math.hypot(q.x - b.x, q.z - b.z); if (d < best) { best = d; h = q } }
    if (h) { dist.push(best); ang.push(fold90(b.yaw - h.yaw)) }
  })
  return { dist, ang, perHouse: n / Math.max(1, hs.length) }
}
const yv = yard(vanillaB, (i) => (vanillaB[i] as { cls?: string }).cls === 'shed'), yg = yard(placed, (i) => placed[i].cat === 'shed' || placed[i].cat === 'annex')
const farmsteads = { score: +((ksScore(yv.dist, yg.dist) + ksScore(yv.ang, yg.ang) + 100 * Math.min(yv.perHouse, yg.perHouse) / Math.max(yv.perHouse, yg.perHouse, 1e-6)) / 3).toFixed(1),
  dist: +ksScore(yv.dist, yg.dist).toFixed(1), square: +ksScore(yv.ang, yg.ang).toFixed(1), perHouse: [+yv.perHouse.toFixed(2), +yg.perHouse.toFixed(2)], median: [med(yv.dist), med(yg.dist)].map((x) => +x.toFixed(1)) }
// ---- rural fences (pastures, paddocks) outside every site disc: vanilla pole / wooden / dry stone pieces vs ours
const SITE_R: Record<string, number> = { town: 300, village: 170, hamlet: 80 }
const inDisc = (x: number, z: number) => sites.some((s) => Math.hypot(x - s.x, z - s.z) < SITE_R[s.kind])
const RURAL_RE = /Walls\/(Pole|Wooden|Stone)\//i, NOT_RURAL = /Retaining|Gate|Castle/i
const farmC = cl.filter((c) => c.length < 3).map((c) => ({ x: c.reduce((a, i) => a + vb[i].x, 0) / c.length, z: c.reduce((a, i) => a + vb[i].z, 0) / c.length })).filter((q) => !inDisc(q.x, q.z))
const fBox = m.forests.map((f) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < f.pts.length; i += 2) { a = Math.min(a, f.pts[i]); b = Math.min(b, f.pts[i + 1]); c = Math.max(c, f.pts[i]); d = Math.max(d, f.pts[i + 1]) } return [a, b, c, d] })
const inPoly = (p: number[], x: number, z: number) => { let s = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) s = !s; return s }
const inForest = (x: number, z: number) => m.forests.some((f, i) => x >= fBox[i][0] && x <= fBox[i][2] && z >= fBox[i][1] && z <= fBox[i][3] && inPoly(f.pts, x, z))
const hAt = (x: number, z: number) => { const c = Math.min(grid.cols - 1, Math.max(0, Math.round((x - grid.minX) / grid.step))), r = Math.min(grid.rows - 1, Math.max(0, Math.round((z - grid.minZ) / grid.step))); return heights[r * grid.cols + c] ?? 0 }
const gentle = (x: number, z: number) => Math.hypot(hAt(x + 5, z) - hAt(x - 5, z), hAt(x, z + 5) - hAt(x, z - 5)) / 10 < 0.3
const rLines = roads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) }))
const PDISC = Number(opt('--pdisc') ?? 0.6) // pastures may reach the outer 40 % of a site disc (vanilla: pole fences at the village edge)
const tP = Date.now()
const pastures = args.includes('--no-pastures') ? [] : pastureFences({ seed: SEED, roads: rLines, buildings: [...placed, ...farmC], density: Number(opt('--pmul') ?? 1) * pastureDensity(BIOME), styles: pastureStyles(BIOME),
  ok: (x, z) => !isWater(x, z) && !sites.some((s) => Math.hypot(x - s.x, z - s.z) < SITE_R[s.kind] * PDISC) && gentle(x, z) && !inForest(x, z), blocked: makeBlocker((placed as never as { corners: number[] }[]).map((q) => q.corners), rLines) })
const pSec = (Date.now() - tP) / 1000
genFences = [...genFences, ...pastures.flatMap((pc) => pc.fences.map((f) => f.pts))]
const vRural = m.fences.items.filter(([pi, x, z]) => RURAL_RE.test(m.fences.prefabs[pi]) && !NOT_RURAL.test(m.fences.prefabs[pi]) && !inDisc(x, z)).map(([, x, z, yaw, len]) => ({ x, z, yaw, len }))
// ours cut into ~4 m pieces (vanilla pieces: 2-8 m), yaw from the piece heading
const gRural: { x: number; z: number; yaw: number; len: number }[] = []
for (const pc of pastures) for (const f of pc.fences) for (let i = 2; i < f.pts.length; i += 2) { const ax = f.pts[i - 2], az = f.pts[i - 1], dx = f.pts[i] - ax, dz = f.pts[i + 1] - az; gRural.push({ x: ax + dx / 2, z: az + dz / 2, yaw: (Math.atan2(-dz, dx) * 180) / Math.PI, len: Math.hypot(dx, dz) }) }
const rv = new Float64Array(T * T), rg = new Float64Array(T * T)
for (const q of vRural) rv[ti(q.x, q.z)] += q.len
for (const q of gRural) rg[ti(q.x, q.z)] += q.len
let rn = 0, rdn = 0
for (let k = 0; k < T * T; k++) { rn += Math.min(rv[k], rg[k]); rdn += Math.max(rv[k], rg[k]) }
const rdesc = (a: typeof vRural) => { const r = a.map((q) => nearRoad(q.x, q.z)); return { d: r.map((q) => q.d), o: a.map((q, i) => (Number.isNaN(r[i].dir) ? NaN : fold90(q.yaw - r[i].dir))).filter((x) => !Number.isNaN(x)) } }
// weight by length: repeat each piece per started 2 m
const wt = (a: typeof vRural) => a.flatMap((q) => Array(Math.max(1, Math.round(q.len / 2))).fill(q))
const rdv = rdesc(wt(vRural)), rdg = rdesc(wt(gRural))
const kmV = vRural.reduce((a, q) => a + q.len, 0) / 1000, kmG = gRural.reduce((a, q) => a + q.len, 0) / 1000
const rural = { tileKm: +(100 * rn / Math.max(1, rdn)).toFixed(1), total: +(100 * Math.min(kmV, kmG) / Math.max(1e-6, kmV, kmG)).toFixed(1), roadDist: +ksScore(rdv.d, rdg.d).toFixed(1), orient: +ksScore(rdv.o, rdg.o).toFixed(1) }
const ruralScore = +((rural.tileKm + rural.total + rural.roadDist + rural.orient) / 4).toFixed(1)
const ruralInfo = { score: ruralScore, ...rural, km: [+kmV.toFixed(1), +kmG.toFixed(1)], medRoadDist: [+med(rdv.d).toFixed(1), +med(rdg.d).toFixed(1)], near30: [+(rdv.d.filter((d) => d < 30).length / Math.max(1, rdv.d.length)).toFixed(2), +(rdg.d.filter((d) => d < 30).length / Math.max(1, rdg.d.length)).toFixed(2)], paddocks: pastures.length, sec: pSec }

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

// ---- power window mode (--power-window [auto|x,z,size[;x,z,size]]): the whole-map plan takes > 25 min and the vanilla
// lines come from a hand-made grid whose trunk crosses the island, so compare on sub-areas instead: crop relief / roads /
// sites to each window, plan it alone, and compare with the vanilla poles inside the same window.
const winArg = opt('--power-window')
type PWin = { x: number; z: number; s: number }
const pwindows: PWin[] = !winArg ? [] : winArg === 'auto'
  ? sites.filter((s) => s.kind !== 'hamlet').sort((a, b) => b.n - a.n).slice(0, 3).map((s) => ({ x: s.x - 1500, z: s.z - 1500, s: 3000 }))
  : winArg.split(';').map((w) => { const [x, z, s] = w.split(',').map(Number); return { x, z, s } })
function powerInWindow(w: PWin) {
  const c0 = Math.max(0, Math.floor((w.x - grid.minX) / grid.step)), r0 = Math.max(0, Math.floor((w.z - grid.minZ) / grid.step))
  const c1 = Math.min(grid.cols - 1, Math.ceil((w.x + w.s - grid.minX) / grid.step)), r1 = Math.min(grid.rows - 1, Math.ceil((w.z + w.s - grid.minZ) / grid.step))
  const g2 = { minX: grid.minX + c0 * grid.step, minZ: grid.minZ + r0 * grid.step, step: grid.step, cols: c1 - c0 + 1, rows: r1 - r0 + 1 }
  const h2 = new Float32Array(g2.cols * g2.rows)
  for (let r = 0; r < g2.rows; r++) for (let c = 0; c < g2.cols; c++) h2[r * g2.cols + c] = heights[(r + r0) * grid.cols + c + c0]
  const inW = (x: number, z: number, m0 = 0) => x >= w.x - m0 && z >= w.z - m0 && x <= w.x + w.s + m0 && z <= w.z + w.s + m0
  // roads: keep the runs of points inside the window
  const rw: Road[] = []
  for (const r of roads) { let run: number[] = []; const flush = () => { if (run.length >= 4) rw.push({ ...r, id: `${r.id}_${rw.length}`, pts: run }); run = [] }; for (let i = 0; i < r.pts.length; i += 2) { if (inW(r.pts[i], r.pts[i + 1])) run.push(r.pts[i], r.pts[i + 1]); else flush() } flush() }
  const sw = sites.filter((s) => inW(s.x, s.z, -150))
  const bw = (placed as never as { x: number; z: number; corners: number[] }[]).filter((b) => inW(b.x, b.z))
  const t = Date.now()
  const p = worldPowerGrid(h2, g2, sw, [], rw.map((r) => r.pts), isWater, w.s, 'eden', powerWorld(rw, bw.map((q) => q.corners), lots.filter((l) => l.used && inW(l.corners[0], l.corners[1])).map((l) => l.corners), []), (opt('--distrib') ?? 'auto') as never)
  const vp: { x: number; z: number; k: string }[] = [], gp: typeof vp = [], vs: number[] = [], gs: number[] = []
  const vl: number[] = [], gl: number[] = []
  for (const l of m.power) { const k = (l as { kind?: string }).kind ?? 'mv'; let run = 0; for (let i = 0; i < l.pts.length; i += 2) if (inW(l.pts[i], l.pts[i + 1])) { vp.push({ x: l.pts[i], z: l.pts[i + 1], k }); if (i >= 2 && inW(l.pts[i - 2], l.pts[i - 1])) { const d = Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1]); run += d; if (k !== 'ehv') vs.push(d) } } if (run > 0) vl.push(run) }
  for (const l of p.lines) { let run = 0; for (let i = 0; i < l.poles.length; i += 2) { gp.push({ x: l.poles[i], z: l.poles[i + 1], k: l.kind }); if (i >= 2) { const d = Math.hypot(l.poles[i] - l.poles[i - 2], l.poles[i + 1] - l.poles[i - 1]); run += d; if (l.kind !== 'ehv') gs.push(d) } } if (run > 0) gl.push(run) }
  // road following: share of poles < 10 / < 30 m from a road edge; distance distribution KS
  const rd = (a: typeof vp) => a.map((q) => nearRoad(q.x, q.z).d)
  const vr = rd(vp), gr = rd(gp), share = (a: number[], d: number) => (a.length ? +(a.filter((x) => x < d).length / a.length).toFixed(2) : null)
  const T2 = Math.ceil(w.s / TILE), tc = (a: typeof vp) => { const o = new Float64Array(T2 * T2); for (const q of a) { const i = Math.floor((q.x - w.x) / TILE), j = Math.floor((q.z - w.z) / TILE); if (i >= 0 && j >= 0 && i < T2 && j < T2) o[j * T2 + i]++ } return o }
  const tv = tc(vp), tg = tc(gp); let n = 0, d = 0; for (let k = 0; k < tv.length; k++) { n += Math.min(tv[k], tg[k]); d += Math.max(tv[k], tg[k]) }
  const sc = { tiles: +(100 * n / Math.max(1, d)).toFixed(1), spanKS: +ksScore(vs, gs).toFixed(1), roadKS: +ksScore(vr, gr).toFixed(1), lenKS: +ksScore(vl, gl).toFixed(1), count: +(100 * Math.min(vp.length, gp.length) / Math.max(1, vp.length, gp.length)).toFixed(1) }
  return {
    window: [Math.round(w.x), Math.round(w.z), w.s], sec: +((Date.now() - t) / 1000).toFixed(1), sites: sw.length,
    poles: [vp.length, gp.length], spanMedian: [+med(vs).toFixed(1), +med(gs).toFixed(1)], lineKm: [+(vl.reduce((a, b) => a + b, 0) / 1000).toFixed(1), +(gl.reduce((a, b) => a + b, 0) / 1000).toFixed(1)],
    lines: [vl.length, gl.length], lineMedian: [Math.round(med(vl)), Math.round(med(gl))], nearRoad10: [share(vr, 10), share(gr, 10)], nearRoad30: [share(vr, 30), share(gr, 30)],
    roadDistMedian: [+med(vr).toFixed(1), +med(gr).toFixed(1)], parallelLvMv: Math.round(parallelOverlap(p.lines)), stations: { ours: p.stations.length, byKind: p.stations.reduce((a, s) => { a[s.kind] = (a[s.kind] ?? 0) + 1; return a }, {} as Record<string, number>) },
    byKind: Object.fromEntries([...new Set([...vp, ...gp].map((q) => q.k))].map((k) => [k, [vp.filter((q) => q.k === k).length, gp.filter((q) => q.k === k).length]])),
    spanByKind: Object.fromEntries([...new Set(p.lines.map((l) => l.kind))].map((k) => [k, +med(p.lines.filter((l) => l.kind === k).flatMap((l) => spanOf(l.poles))).toFixed(1)])),
    scores: sc, score: +((sc.tiles + sc.spanKS + sc.roadKS + sc.lenKS + sc.count) / 5).toFixed(1),
  }
}
const powerWin = pwindows.map(powerInWindow)
const powerWindowScore = powerWin.length ? +(powerWin.reduce((a, q) => a + q.score, 0) / powerWin.length).toFixed(1) : null
// ---- village streets: strip the vanilla local streets of villages / hamlets, let settleVillages grow its own,
// compare the street shapes and the houses vs their street (both sides measured against their own road set)
const vSites = sites.filter((s) => STREET_REACH[s.kind])
const loc = localStreets(roads.map((r) => r.pts), vSites)
const locSet = new Set(loc.map((l) => l.idx))
const stripped = roads.filter((_, i) => !locSet.has(i))
if (args.includes("--loc-info")) { const by: Record<string, number> = {}; for (const l of loc) { const k = vSites[l.site].kind + " " + m.roads[l.idx].gen.split("/").pop()!; by[k] = (by[k] ?? 0) + Math.round(polyLen(roads[l.idx].pts)) } console.error(JSON.stringify(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14))) }
let sPlaced: typeof placed = [], sLanes: Road[] = []
for (const kind of ['village', 'hamlet'] as const) {
  const ks = vSites.filter((s) => s.kind === kind)
  if (!ks.length) continue
  const V = WORLD.villages[kind]
  const vr = settleVillages(ks, stripped, waters, heights, grid, { seed: SEED, density: V.density * Number(opt("--vmul") ?? settlementDensityMul(mapId === 'kolguyev' ? 'nordic_kolguyev' : mapId === 'arland' ? 'woodland_arland' : undefined)), maxStreets: V.maxStreets, dropScale: WORLD.villages.dropScale, variant: 'auto', template: true, oblique: villageOblique(BIOME), parcelShare: opt('--pshare') !== undefined ? Number(opt('--pshare')) : parcelShareOf(BIOME) }, sPlaced as never)
  sPlaced = vr.placed as never
  sLanes.push(...vr.lanes)
}
sPlaced = sPlaced.filter((b) => !NOT_BUILDING.test(b.prefab))
const inReach = (x: number, z: number) => vSites.some((s) => Math.hypot(x - s.x, z - s.z) < STREET_REACH[s.kind])
const vStreets = loc.map((l) => roads[l.idx].pts), gStreets = sLanes.map((r) => r.pts).filter((p) => p.length >= 4)
const svs = streetStats(vStreets, stripped.map((r) => r.pts)), sgs = streetStats(gStreets, stripped.map((r) => r.pts))
const perSite = (ps: number[][]) => vSites.map((s) => ps.reduce((a, p) => { const R = STREET_REACH[s.kind]; let L = 0; for (let i = 2; i < p.length; i += 2) if (Math.hypot(p[i] - s.x, p[i + 1] - s.z) < R) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return a + L }, 0))
const lv = perSite(vStreets), lg = perSite(gStreets)
if (args.includes('--site-info')) console.error(vSites.map((s, i) => `${s.kind[0]}${s.n}:${Math.round(lv[i])}/${Math.round(lg[i])}`).join(' '))
const sHousesV = vanillaB.filter((b) => inReach(b.x, b.z)), sHousesG = sPlaced.filter((b) => inReach(b.x, b.z))
const dsv = desc(sHousesV), dsg = desc(sHousesG, roadIndex([...stripped, ...sLanes]))
const dead = (s: typeof svs) => s.ends ? s.deadEnds / s.ends : 0
const streets = {
  siteLength: +(100 * lv.reduce((a, v, i) => a + Math.min(v, lg[i]), 0) / Math.max(1, lv.reduce((a, v, i) => a + Math.max(v, lg[i]), 0))).toFixed(1),
  pieceLen: +ksScore(svs.pieces, sgs.pieces).toFixed(1),
  angle: +ksScore(svs.angles, sgs.angles).toFixed(1),
  deadEnd: +(100 * (1 - Math.abs(dead(svs) - dead(sgs)))).toFixed(1),
  houseSetback: +ksScore(dsv.setback, dsg.setback).toFixed(1),
  houseOrient: +ksScore(dsv.orient, dsg.orient).toFixed(1),
  houseCount: +(100 * Math.min(sHousesV.length, sHousesG.length) / Math.max(1, sHousesV.length, sHousesG.length)).toFixed(1),
}
const streetScore = +(Object.values(streets).reduce((a, b) => a + b, 0) / Object.values(streets).length).toFixed(1)
const streetInfo = { score: streetScore, ...streets,
  km: [+(svs.total / 1000).toFixed(1), +(sgs.total / 1000).toFixed(1)], n: [vStreets.length, gStreets.length], pieces: [svs.pieces.length, sgs.pieces.length],
  medPiece: [+med(svs.pieces).toFixed(0), +med(sgs.pieces).toFixed(0)], medAngle: [+med(svs.angles).toFixed(0), +med(sgs.angles).toFixed(0)], deadShare: [+dead(svs).toFixed(2), +dead(sgs).toFixed(2)],
  houses: [sHousesV.length, sHousesG.length], medSetback: [+med(dsv.setback).toFixed(1), +med(dsg.setback).toFixed(1)], medOrient: [+med(dsv.orient).toFixed(1), +med(dsg.orient).toFixed(1)] }
void polyLen

// ---- street lamps (streetLights.ts) vs the vanilla street lamps (scripts/bench/vanilla-lamps.json, PakTools lamps_dump.py):
// count inside the site reach, nearest-lamp spacing, offset from the nearest road edge
const vLampAll: [number, number, number, string][] = (JSON.parse(readFileSync(new URL('./vanilla-lamps.json', import.meta.url), 'utf8')) as Record<string, [number, number, number, string][]>)[mapId] ?? []
const LREACH: Record<string, number> = { town: 300, village: 170, hamlet: 90 }
const inLampReach = (x: number, z: number) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < (LREACH[s.kind] ?? 90))
const gLamps = streetLights({ roads: [...roads, ...benchLanes], sites, buildings: (placed as never as { corners: number[]; x: number; z: number; site?: string }[]), seed: SEED, biome: BIOME })
const vL = vLampAll.filter((l) => inLampReach(l[0], l[1])).map((l) => ({ x: l[0], z: l[1] })), gL = gLamps.filter((l) => inLampReach(l.x, l.z))
const lampNN = (L: { x: number; z: number }[]) => L.map((a) => { let b = Infinity; for (const o of L) if (o !== a && Math.abs(o.x - a.x) < 120 && Math.abs(o.z - a.z) < 120) b = Math.min(b, Math.hypot(o.x - a.x, o.z - a.z)); return b }).filter((d) => d < 120)
const lampLines = [...roads, ...benchLanes].filter((r) => r.pts.length >= 4).map((r) => ({ l: centreLine(r.pts, 4), h: roadHalf(r) }))
const lampOff = (L: { x: number; z: number }[]) => L.map((p) => { let b = Infinity; for (const q of lampLines) for (let i = 2; i < q.l.length; i += 2) { const ax = q.l[i - 2], az = q.l[i - 1]; if (Math.abs(ax - p.x) > 60 || Math.abs(az - p.z) > 60) continue; const dx = q.l[i] - ax, dz = q.l[i + 1] - az, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / L2)) : 0; b = Math.min(b, Math.hypot(p.x - ax - t * dx, p.z - az - t * dz) - q.h) } return b }).filter((d) => d < 30)
const lampCount = +(100 * Math.min(vL.length, gL.length) / Math.max(1, vL.length, gL.length)).toFixed(1)
const lampSpacing = +ksScore(lampNN(vL), lampNN(gL)).toFixed(1), lampOffset = +ksScore(lampOff(vL), lampOff(gL)).toFixed(1)
const streetLightScore = +((lampCount + lampSpacing + lampOffset) / 3).toFixed(1)
const streetLightInfo = { score: streetLightScore, count: lampCount, spacing: lampSpacing, offset: lampOffset, n: [vL.length, gL.length],
  medNN: [+med(lampNN(vL)).toFixed(1), +med(lampNN(gL)).toFixed(1)], medOffset: [+med(lampOff(vL)).toFixed(1), +med(lampOff(gL)).toFixed(1)] }

// gameplay score (src/modules/gameplay.ts): the vanilla map, and its forests + relief with our buildings in place of vanilla's
const gpIn = { heights, grid, forests: m.forests ?? [] }
const gpV = gameplayReport({ ...gpIn, houses: m.buildings.items.filter((b) => !GAMEPLAY_NOT_BUILDING.test(m.buildings.prefabs[b[0]])).map(([, x, z]) => ({ x, z })) })
const gpO = gameplayReport({ ...gpIn, houses: placed.map((b) => ({ x: b.x, z: b.z })) })
const gpBrief = (r: typeof gpV) => ({ score: r.score, sub: Object.fromEntries(Object.entries(r.sub).map(([k, v]) => [k, v.score])) })
const rocks = rocksBench(mapId, { minX: grid.minX, minZ: grid.minZ, maxX: grid.minX + (grid.cols - 1) * grid.step, maxZ: grid.minZ + (grid.rows - 1) * grid.step }, hAt, (x, z) => nearRoad(x, z).d > 8)
const ensembles = ensemblesBench(sites, { b: vanillaB.map((b) => ({ x: b.x, z: b.z, out: (b as { cls?: string }).cls === 'shed' })), f: vf },
  // our fences are long polylines: cut into ~5 m pieces like the vanilla ones (closure test by distance)
  { b: placed.map((b) => ({ x: b.x, z: b.z, out: b.cat === 'shed' || b.cat === 'annex' })), f: genFences.flatMap((pl) => { const o: { x: number; z: number; len: number }[] = []
    for (let i = 2; i < pl.length; i += 2) { const L = Math.hypot(pl[i] - pl[i - 2], pl[i + 1] - pl[i - 1]), n = Math.max(1, Math.round(L / 5)); for (let k = 0; k < n; k++) o.push({ x: pl[i - 2] + ((pl[i] - pl[i - 2]) * (k + 0.5)) / n, z: pl[i - 1] + ((pl[i + 1] - pl[i - 1]) * (k + 0.5)) / n, len: L / n }) }
    return o }) }, ksScore)
const report = {
  map: m.name, genSec, sites: sites.length,
  gameplay: { vanilla: gpBrief(gpV), ours: gpBrief(gpO) },
  farmsteads,
  ensembles,
  villages: { score: villageScore, ...villages, counts: { vanilla: vanillaB.length, ours: placed.length }, byKind: { town: kindRatio('town'), village: kindRatio('village'), hamlet: kindRatio('hamlet') },
    median: { setback: [med(dv.setback), med(dg.setback)].map((x) => +x.toFixed(1)), orient: [med(dv.orient), med(dg.orient)].map((x) => +x.toFixed(1)), nn: [med(dv.nn), med(dg.nn)].map((x) => +x.toFixed(1)) },
    worstSites: siteScore.map((s) => ({ ...s, err: Math.abs(s.g - s.v) })).sort((a, b) => b.err - a.err).slice(0, 8) },
  fences,
  streets: streetInfo,
  ruralFences: ruralInfo,
  power,
  streetLights: streetLightInfo,
  powerWindows: powerWin.length ? { score: powerWindowScore, windows: powerWin } : null,
  rocks,
  scores: { villages: villageScore, fences: fenceScore, streets: streetScore, ruralFences: ruralScore, farmsteads: farmsteads.score, streetLights: streetLightScore, power: power?.tilePoles ?? null, powerWindow: powerWindowScore, rocks: rocks?.score ?? null, ensembles: ensembles.score },
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

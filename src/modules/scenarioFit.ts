// Scenario fit: does the map suit Conflict PvP, Combat Ops / PvE, Freedom Fighters, King of the Hill, Game Master,
// Overthrow, and what is missing otherwise. Thresholds (research 2026-11-22):
//   Conflict: HQs >= 2000 m apart (3000 preferred, SCR_GameModeCampaign.c), relay / base radio reach 1000 m
//     (ConflictMilitaryBase.et RelayTransceiver), victory at 4 control points (GameMode_Campaign.et), so >= 8 places;
//   FF: >= 25 km2 aimed, Arland ~6 km2 the soft minimum, all places on one road network (FF road graph: a place on
//     a road island gets no traffic / QRF / convoys), asphalt between towns; places = towns, bases, radio sites...;
//   Combat Ops: Scenario Framework tasks on varied places (>= 6) reachable by AI on roads;
//   King of the Hill (community, unsourced): one dense central town (> 40 houses) with flat HQ spots 2-4 km away.
// Every number below that is not in that list is a proposal, tuned on the generated maps.
import { settlementClusters } from './gameplay.ts'

export interface FitInput {
  heights: ArrayLike<number>; grid: { cols: number; rows: number; cell: number; minX?: number; minZ?: number }
  sea?: number
  places: { x: number; z: number; kind: string }[] // towns, villages, hamlets, military sites...
  houses: { x: number; z: number }[]
  roads: { type: string; pts: number[] }[]
}
export type ScenarioId = 'conflict' | 'combatops' | 'ff' | 'koth' | 'gm' | 'overthrow'
export interface Lack { key: string; vars?: Record<string, string | number> }
export interface ScenarioFit { id: ScenarioId; level: 'ok' | 'partial' | 'no'; lacks: Lack[] }
export interface FitMetrics {
  landKm2: number; places: number; towns: number; biggestTown: number
  hqPair: number // m between the two farthest flat HQ spots
  radioGroups: number // groups of places linked by <= 1000 m hops
  roadGroups: number; placesOnMainRoad: number // share 0..1 of places within reach of the main road network
  asphaltTowns: number // share 0..1 of the towns on the main paved network
  flatSpots: number
}

const PAVED = /asphalt|motorway|concrete|cobble/i

function unionFind(n: number) {
  const p = Array.from({ length: n }, (_, i) => i)
  const f = (i: number): number => (p[i] === i ? i : (p[i] = f(p[i])))
  return { f, u: (a: number, b: number) => { p[f(a)] = f(b) } }
}

/** flat spots for a HQ / helipad: 32 m squares with every slope < 5 deg, near a place, at least 300 m apart */
export function flatSpots(inp: FitInput): { x: number; z: number }[] {
  const { cols, rows, cell } = inp.grid, x0 = inp.grid.minX ?? 0, z0 = inp.grid.minZ ?? 0, sea = inp.sea ?? 0
  const h = (c: number, r: number) => inp.heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]
  const k = Math.max(1, Math.round(16 / cell)), tan5 = Math.tan(5 * Math.PI / 180), out: { x: number; z: number }[] = []
  for (const p of inp.places) {
    let best: { x: number; z: number; s: number } | null = null
    for (let a = 0; a < 16; a++) for (const rad of [150, 300, 450]) {
      const x = p.x + rad * Math.cos(a * Math.PI / 8), z = p.z + rad * Math.sin(a * Math.PI / 8)
      const c = Math.round((x - x0) / cell), r = Math.round((z - z0) / cell)
      if (c < k || r < k || c >= cols - k || r >= rows - k || h(c, r) <= sea + 1) continue
      let worst = 0
      for (let i = -k; i < k; i++) for (let j = -k; j < k; j++) worst = Math.max(worst, Math.abs(h(c + i + 1, r + j) - h(c + i, r + j)) / cell, Math.abs(h(c + i, r + j + 1) - h(c + i, r + j)) / cell)
      if (worst < tan5 && (!best || worst < best.s)) best = { x, z, s: worst }
    }
    if (best && out.every((q) => Math.hypot(q.x - best!.x, q.z - best!.z) > 300)) out.push({ x: best.x, z: best.z })
  }
  return out
}

/** road groups: roads whose points come within 20 m of each other are one network */
function roadNetwork(roads: FitInput['roads']) {
  const cellOf = (x: number, z: number) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`
  const uf = unionFind(roads.length), seen = new Map<string, number>()
  roads.forEach((r, i) => {
    for (let k = 0; k + 1 < r.pts.length; k += 2) {
      const cx = Math.floor(r.pts[k] / 20), cz = Math.floor(r.pts[k + 1] / 20)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const o = seen.get(`${cx + a},${cz + b}`); if (o !== undefined) uf.u(i, o) }
      seen.set(cellOf(r.pts[k], r.pts[k + 1]), i)
    }
  })
  const size = new Map<number, number>()
  roads.forEach((r, i) => size.set(uf.f(i), (size.get(uf.f(i)) ?? 0) + r.pts.length))
  let main = -1, best = -1
  for (const [g, s] of size) if (s > best) { best = s; main = g }
  return { groups: size.size, inMain: (i: number) => uf.f(i) === main }
}
const nearRoad = (roads: FitInput['roads'], ok: (i: number) => boolean, x: number, z: number, d: number) =>
  roads.some((r, i) => { if (!ok(i)) return false; for (let k = 0; k + 1 < r.pts.length; k += 2) if (Math.hypot(r.pts[k] - x, r.pts[k + 1] - z) < d) return true; return false })

export function fitMetrics(inp: FitInput): FitMetrics {
  const { cols, rows, cell } = inp.grid, sea = inp.sea ?? 0
  let land = 0
  for (let i = 0; i < cols * rows; i++) if (inp.heights[i] > sea) land++
  const clusters = settlementClusters(inp.houses)
  const spots = flatSpots(inp)
  let hqPair = 0
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) hqPair = Math.max(hqPair, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z))
  const uf = unionFind(inp.places.length)
  for (let i = 0; i < inp.places.length; i++) for (let j = i + 1; j < inp.places.length; j++) if (Math.hypot(inp.places[i].x - inp.places[j].x, inp.places[i].z - inp.places[j].z) <= 1000) uf.u(i, j)
  const radioGroups = new Set(inp.places.map((_, i) => uf.f(i))).size
  const net = roadNetwork(inp.roads)
  const served = inp.places.filter((p) => nearRoad(inp.roads, net.inMain, p.x, p.z, 150)).length
  const paved = roadNetwork(inp.roads.filter((r) => PAVED.test(r.type)))
  const pavedRoads = inp.roads.filter((r) => PAVED.test(r.type))
  const towns = inp.places.filter((p) => p.kind === 'town' || p.kind === 'village')
  const pavedTowns = towns.filter((p) => nearRoad(pavedRoads, paved.inMain, p.x, p.z, 200)).length
  return {
    landKm2: Math.round(land * cell * cell / 1e4) / 100, places: inp.places.length, towns: towns.length,
    biggestTown: clusters.reduce((m, c) => Math.max(m, c.n), 0), hqPair: Math.round(hqPair), radioGroups,
    roadGroups: net.groups, placesOnMainRoad: inp.places.length ? served / inp.places.length : 0,
    asphaltTowns: towns.length ? pavedTowns / towns.length : 0, flatSpots: spots.length,
  }
}

export function scenarioFit(inp: FitInput, m: FitMetrics = fitMetrics(inp)): ScenarioFit[] {
  const level = (hard: Lack[], soft: Lack[]): ScenarioFit['level'] => (hard.length ? 'no' : soft.length ? 'partial' : 'ok')
  const pct = (v: number) => Math.round(v * 100)
  const out: ScenarioFit[] = []
  const add = (id: ScenarioId, hard: Lack[], soft: Lack[]) => out.push({ id, level: level(hard, soft), lacks: [...hard, ...soft] })
  const roadsHard = (min: number): Lack[] => (m.placesOnMainRoad < min ? [{ key: 'roads', vars: { pct: pct(m.placesOnMainRoad), need: pct(min) } }] : [])
  // Conflict PvP
  add('conflict', [
    ...(m.hqPair < 2000 ? [{ key: 'hq', vars: { d: m.hqPair, need: 2000 } }] : []),
    ...(m.places < 8 ? [{ key: 'places', vars: { n: m.places, need: 8 } }] : []),
    ...roadsHard(0.8),
  ], [
    ...(m.hqPair >= 2000 && m.hqPair < 3000 ? [{ key: 'hqPref', vars: { d: m.hqPair, need: 3000 } }] : []),
    ...(m.radioGroups > 1 ? [{ key: 'radio', vars: { n: m.radioGroups } }] : []),
  ])
  // Combat Ops / PvE
  add('combatops', [...(m.places < 6 ? [{ key: 'places', vars: { n: m.places, need: 6 } }] : []), ...roadsHard(0.7)],
    m.roadGroups > 1 ? [{ key: 'roadGroups', vars: { n: m.roadGroups } }] : [])
  // Freedom Fighters
  add('ff', [
    ...(m.landKm2 < 6 ? [{ key: 'area', vars: { a: m.landKm2, need: 6 } }] : []),
    ...roadsHard(0.95),
    ...(m.towns < 5 ? [{ key: 'towns', vars: { n: m.towns, need: 5 } }] : []),
  ], [
    ...(m.landKm2 >= 6 && m.landKm2 < 25 ? [{ key: 'areaPref', vars: { a: m.landKm2, need: 25 } }] : []),
    ...(m.asphaltTowns < 1 && m.towns ? [{ key: 'asphalt', vars: { pct: pct(m.asphaltTowns) } }] : []),
    ...(m.towns >= 5 && m.towns < 10 ? [{ key: 'townsPref', vars: { n: m.towns, need: 10 } }] : []),
  ])
  // King of the Hill
  add('koth', [
    ...(m.biggestTown < 40 ? [{ key: 'centre', vars: { n: m.biggestTown, need: 40 } }] : []),
    ...(m.flatSpots < 3 ? [{ key: 'flat', vars: { n: m.flatSpots, need: 3 } }] : []),
  ], m.hqPair < 2000 ? [{ key: 'hq', vars: { d: m.hqPair, need: 2000 } }] : [])
  // Game Master: anything works, variety helps
  add('gm', [], [...(m.places < 4 ? [{ key: 'places', vars: { n: m.places, need: 4 } }] : []), ...(m.flatSpots < 1 ? [{ key: 'flat', vars: { n: m.flatSpots, need: 1 } }] : [])])
  // Overthrow: a whole-island revolution, like FF without its road graph
  add('overthrow', [...(m.towns < 6 ? [{ key: 'towns', vars: { n: m.towns, need: 6 } }] : []), ...roadsHard(0.8)],
    m.landKm2 < 16 ? [{ key: 'areaPref', vars: { a: m.landKm2, need: 16 } }] : [])
  return out
}

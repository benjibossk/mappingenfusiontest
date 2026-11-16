// Military sites generator (pure): checkpoint, outpost / FOB, main base. Output = prefab placements
// (ProjectEntity), wall/fence generator polylines and internal road splines (ProjectShape), and a
// terrain flatten request (gen-common applyFlatten). Plus a placement suggester over the heightmap.
//
// Layout convention (Everon / Arland vanilla bases: Montignac, Levie, Arland military base): rectangular
// compound, single gate on the side facing the access road, guard towers in the corners, a straight
// main street from the gate to a parade/HQ area, accommodation in rows, vehicle park near the gate,
// helipad in the open far corner. Local frame: gate on the -Z side, the site's yaw turns +Z away from
// the road (the base "looks" away from its access).

import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'
import {
  rng, toWorld, boxesOverlap, inBox, heightAt, bestPlane, maxSlope, toEntity, wallShape, roadShape, round,
  type Box, type FlattenRequest, type SitePlacement, type Disc,
} from './gen-common'

export type MilitaryKind = 'checkpoint' | 'outpost' | 'main'

//! Prefab paths found in the base game index (enfusion-mcp asset_search, 2026-11-16). Bare paths: the
//! plugin resolves the GUID. Footprints (hw/hd = half sizes, metres) are ESTIMATES: none of these is in
//! profile/MapGen/prefabs.txt yet — measure them with the capture plugin and update.
export const MIL_PREFABS = {
  tower: { p: 'Prefabs/Structures/Military/Houses/GuardTower_01/GuardTower_01.et', hw: 2.5, hd: 2.5 },
  barracks: { p: 'Prefabs/Structures/Military/Houses/Barracks_01/Barracks_01.et', hw: 5, hd: 12 }, // path inferred from PrefabLibrary/…/Military/Barracks_01
  hq: { p: 'Prefabs/Structures/Military/Houses/Barracks_01/Barracks_01_camo.et', hw: 5, hd: 12 }, // idem
  tent: { p: 'Prefabs/Structures/Military/Camps/TentFIA_01/TentFIA_01.et', hw: 3, hd: 4.5 },
  tentSmall: { p: 'Prefabs/Structures/Military/Camps/TentSmallUS_01/TentSmallUS_01.et', hw: 1.5, hd: 2 },
  vehicleCover: { p: 'Prefabs/Structures/Military/Camps/Canvas_Covers/US/CanvasCover_Large_US.et', hw: 5, hd: 7 },
  helipad: { p: 'Prefabs/Structures/Military/Camps/HelipadImprovised_01/HelipadImprovised_USSR_01.et', hw: 10, hd: 10 },
  fuel: { p: 'Prefabs/Structures/Industrial/FuelTank_01/FuelTank_01.et', hw: 2, hd: 5 }, // path inferred from PrefabLibrary
  flag: { p: '{1A8791C2BC2B8B75}Prefabs/Structures/Military/Flags/FlagPole_01/FlagPole_01_empty.et', hw: 0.3, hd: 0.3 }, // measured (entities.txt)
} as const

//! wall generators (docs/GENERATORS.md, Walls/): no Hesco / sandbag generator exists in vanilla
export const MIL_WALLS = {
  concrete: 'Prefabs/WEGenerators/Walls/Concrete/WG_ConcreteWall_USSR_03.et',
  net: 'Prefabs/WEGenerators/Walls/Net/WG_NetFence_USSR_01.et',
  netLight: 'Prefabs/WEGenerators/Walls/Net/WG_NetFence_01_Green.et',
}
const ROAD_GEN = { concrete: 'Prefabs/WEGenerators/Roads/Concrete/RG_Road_ConcretePanel_01.et', dirt: '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et' }

const SPEC: Record<MilitaryKind, { hw: number; hd: number; wall: keyof typeof MIL_WALLS | null; gate: number; road: number }> = {
  checkpoint: { hw: 14, hd: 9, wall: null, gate: 0, road: 0 },
  outpost: { hw: 35, hd: 35, wall: 'net', gate: 8, road: 6 },
  main: { hw: 90, hd: 70, wall: 'concrete', gate: 10, road: 7 },
}

export interface MilitaryOptions { kind: MilitaryKind; x: number; z: number; yaw: number; seed: number | string; wall?: keyof typeof MIL_WALLS }

export interface MilitarySite {
  kind: MilitaryKind
  /** perimeter box (world) */
  area: Box
  placements: SitePlacement[]
  entities: ProjectEntity[]
  /** perimeter wall (open at the gate) and internal roads */
  shapes: ProjectShape[]
  /** internal road footprints (world boxes), for tests / previews */
  roads: Box[]
  /** gate centre (world), where the access road must arrive */
  gate: [number, number]
  /** ground request: whole compound + margin (h0 == h1 = flat unless set with flattenFor) */
  flatten: FlattenRequest
}

/** builds the site; call flattenFor() afterwards to fit the platform height on a real heightmap */
export function generateMilitary(o: MilitaryOptions): MilitarySite {
  const R = rng(`${o.seed}|mil|${o.kind}`), S = SPEC[o.kind], yaw = o.yaw
  const W = (lx: number, lz: number) => toWorld(o.x, o.z, yaw, lx, lz)
  const lbox = (lx: number, lz: number, hw: number, hd: number, ly = 0): Box => { const [x, z] = W(lx, lz); return { x, z, hw, hd, yaw: yaw + ly } }
  const area: Box = { x: o.x, z: o.z, hw: S.hw, hd: S.hd, yaw }
  const placements: SitePlacement[] = [], roads: Box[] = [], shapes: ProjectShape[] = []
  const put = (role: string, pf: { p: string; hw: number; hd: number }, b: Box) => placements.push({ role, prefab: pf.p, box: b })
  const free = (b: Box, m = 1.5) => inBoxFully(area, b, -1) && !placements.some((p) => boxesOverlap(b, p.box, m)) && !roads.some((r) => boxesOverlap(b, r, m))

  if (o.kind === 'checkpoint') {
    // astride the road (road along local Z): tower on one side, tents on the other, flag
    put('tower', MIL_PREFABS.tower, lbox(-8, 0, 2.5, 2.5))
    put('tent', MIL_PREFABS.tent, lbox(9, -2, 3, 4.5))
    put('tentSmall', MIL_PREFABS.tentSmall, lbox(9, 6, 1.5, 2))
    put('flag', MIL_PREFABS.flag, lbox(-8, -6, 0.3, 0.3))
    shapes.push(wallShape(`mil-${o.seed}-sb`, [...W(-12, -8), ...W(-5, -8)], MIL_WALLS.netLight))
  } else {
    const gw = S.gate / 2, wall = o.wall ?? S.wall!
    // perimeter: open polyline starting right of the gate, around, back to left of the gate
    const ring = [[gw, -S.hd], [S.hw, -S.hd], [S.hw, S.hd], [-S.hw, S.hd], [-S.hw, -S.hd], [-gw, -S.hd]]
    shapes.push(wallShape(`mil-${o.seed}-wall`, ring.flatMap(([a, b]) => W(a, b)), MIL_WALLS[wall]))
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) put('tower', MIL_PREFABS.tower, lbox(sx * (S.hw - 4), sz * (S.hd - 4), 2.5, 2.5, sx * sz > 0 ? 45 : -45))
    // gate towers either side of the entrance (main base) / flag (outpost)
    if (o.kind === 'main') { put('tower', MIL_PREFABS.tower, lbox(gw + 5, -S.hd + 4, 2.5, 2.5)); put('tower', MIL_PREFABS.tower, lbox(-gw - 5, -S.hd + 4, 2.5, 2.5)) }
    // main street gate → centre, then a cross street (main base)
    const hr = S.road / 2, streetLen = o.kind === 'main' ? S.hd + 10 : S.hd
    const street = lbox(0, -S.hd + streetLen / 2, hr, streetLen / 2)
    roads.push(street)
    const sp = [...W(0, -S.hd - 15), ...W(0, -S.hd + streetLen)]
    if (o.kind === 'main') {
      const cz = -S.hd + streetLen
      roads.push(lbox(0, cz, S.hw - 14, hr))
      shapes.push(roadShape(`mil-${o.seed}-x`, [...W(-(S.hw - 14), cz), ...W(S.hw - 14, cz)], ROAD_GEN.concrete, S.road))
    }
    shapes.push(roadShape(`mil-${o.seed}-st`, sp, o.kind === 'main' ? ROAD_GEN.concrete : ROAD_GEN.dirt, S.road))
    // HQ facing the street end + flag
    const endZ = -S.hd + streetLen + hr
    if (o.kind === 'main') put('hq', MIL_PREFABS.hq, lbox(0, endZ + 9, 5, 12, 90))
    put('flag', MIL_PREFABS.flag, lbox(o.kind === 'main' ? 8 : hr + 3, o.kind === 'main' ? endZ + 3 : -S.hd + 8, 0.3, 0.3))
    // helipad: far corner, open ground
    const hs = R() < 0.5 ? 1 : -1
    if (o.kind === 'main' || R() < 0.6) {
      const hp = lbox(hs * (S.hw - 22), S.hd - 22, 10, 10)
      if (free(hp, 4)) put('helipad', MIL_PREFABS.helipad, hp)
    }
    // vehicle park: covers in a row beside the gate, opening on the street
    const nCov = o.kind === 'main' ? 4 : 2
    for (let i = 0; i < nCov; i++) {
      const b = lbox(-hs * (hr + 8 + i * 11.5), -S.hd + 16, 5, 7)
      if (free(b)) put('vehicle', MIL_PREFABS.vehicleCover, b)
    }
    if (o.kind === 'main') { const f = lbox(-hs * (S.hw - 10), -S.hd + 14, 2, 5); if (free(f)) put('fuel', MIL_PREFABS.fuel, f) }
    // accommodation: rows of barracks (main) / tents (outpost), aligned on the street, random fill
    const unit = o.kind === 'main' ? MIL_PREFABS.barracks : MIL_PREFABS.tent
    const want = o.kind === 'main' ? 8 + Math.floor(R() * 4) : 4 + Math.floor(R() * 3)
    const slots: Box[] = []
    const stepX = unit.hw * 2 + 6, stepZ = unit.hd * 2 + 6
    for (let lz = -S.hd + 8 + unit.hd; lz <= S.hd - 8 - unit.hd; lz += stepZ) for (let lx = hr + 4 + unit.hw; lx <= S.hw - 8 - unit.hw; lx += stepX) {
      slots.push(lbox(lx, lz, unit.hw, unit.hd), lbox(-lx, lz, unit.hw, unit.hd))
    }
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]] }
    let n = 0
    for (const b of slots) { if (n >= want) break; if (free(b, 2.5)) { put(o.kind === 'main' ? 'barracks' : 'tent', unit, b); n++ } }
    // small tents fill (outpost)
    if (o.kind === 'outpost') for (let k = 0; k < 4; k++) { const b = lbox((R() * 2 - 1) * (S.hw - 8), (R() * 2 - 1) * (S.hd - 8), 1.5, 2); if (free(b)) put('tentSmall', MIL_PREFABS.tentSmall, b) }
  }
  const gate = W(0, -S.hd) as [number, number]
  const flatten: FlattenRequest = { box: { ...area, hw: S.hw + 4, hd: S.hd + 4 }, h0: 0, h1: 0, falloff: o.kind === 'main' ? 30 : 15 }
  return {
    kind: o.kind, area, placements, shapes, roads, gate, flatten,
    entities: placements.map((p, i) => toEntity(p, `mil-${o.seed}-${i}`)),
  }
}

function inBoxFully(area: Box, b: Box, margin: number): boolean {
  const [x0, z0] = toWorld(b.x, b.z, b.yaw, -b.hw, -b.hd), [x1, z1] = toWorld(b.x, b.z, b.yaw, b.hw, -b.hd)
  const [x2, z2] = toWorld(b.x, b.z, b.yaw, b.hw, b.hd), [x3, z3] = toWorld(b.x, b.z, b.yaw, -b.hw, b.hd)
  return inBox(area, x0, z0, margin) && inBox(area, x1, z1, margin) && inBox(area, x2, z2, margin) && inBox(area, x3, z3, margin)
}

/** fits the platform on the terrain: best plane through the compound, grade ≤ maxGrade (2 % default) */
export function flattenFor(site: MilitarySite, heights: ArrayLike<number>, g: Grid, maxGrade = 0.02): FlattenRequest {
  const [h0, h1] = bestPlane(heights, g, site.flatten.box, maxGrade)
  site.flatten = { ...site.flatten, h0: round(h0), h1: round(h1) }
  return site.flatten
}

export interface MilitarySuggestOptions {
  kind: MilitaryKind
  seaLevel?: number
  /** villages / towns / other sites to stay away from */
  keepOut?: Disc[]
  /** road centre lines (flat X/Z) for the access score; the yaw turns the gate toward the nearest one */
  roads?: number[][]
  /** prefer sites near the coast (+) or inland (−), 0 = ignore */
  coast?: number
  count?: number
  step?: number
}

export interface MilitarySuggestion { x: number; z: number; yaw: number; score: number; slope: number; relief: number; roadDist: number }

/** Scores candidates on a grid: flat (max slope in the compound), elevated relative to the surroundings
 *  (strategic), close to a road (≤ 300 m, best ~60 m), away from keep-outs, optional coast bias. */
export function suggestMilitary(heights: ArrayLike<number>, g: Grid, o: MilitarySuggestOptions): MilitarySuggestion[] {
  const S = SPEC[o.kind], r = Math.hypot(S.hw, S.hd), sea = o.seaLevel ?? 0
  const step = o.step ?? Math.max(64, r * 1.5), out: MilitarySuggestion[] = []
  const W = g.minX + (g.cols - 1) * g.step, H = g.minZ + (g.rows - 1) * g.step
  for (let z = g.minZ + r + 50; z < H - r - 50; z += step) for (let x = g.minX + r + 50; x < W - r - 50; x += step) {
    const h = heightAt(heights, g, x, z)
    if (h < sea + 3) continue
    if (o.keepOut?.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r + 150)) continue
    const slope = maxSlope(heights, g, x, z, r)
    if (slope > 0.15) continue
    let ring = 0, nr = 0, wet = 0
    for (let a = 0; a < 12; a++) {
      const hx = heightAt(heights, g, x + Math.cos(a * Math.PI / 6) * r * 3, z + Math.sin(a * Math.PI / 6) * r * 3)
      ring += hx; nr++; if (hx < sea) wet++
    }
    const relief = h - ring / nr
    let roadDist = Infinity, yaw = 0
    for (const l of o.roads ?? []) for (let i = 0; i + 1 < l.length; i += 2) {
      const d = Math.hypot(l[i] - x, l[i + 1] - z)
      if (d < roadDist) { roadDist = d; yaw = Math.atan2(x - l[i], z - l[i + 1]) * 180 / Math.PI }
    }
    let score = 1 - slope / 0.15
    score += Math.max(-0.5, Math.min(1, relief / 30)) * 0.8
    if (o.roads?.length) score += roadDist < 300 ? 1 - Math.abs(roadDist - 60) / 300 : -0.5
    if (o.coast) score += o.coast * (wet / 12)
    out.push({ x: round(x), z: round(z), yaw: round(yaw), score: round(score), slope: round(slope), relief: round(relief), roadDist: round(roadDist) })
  }
  out.sort((a, b) => b.score - a.score)
  const keep: MilitarySuggestion[] = []
  for (const s of out) { if (keep.length >= (o.count ?? 5)) break; if (keep.every((k) => Math.hypot(k.x - s.x, k.z - s.z) > r * 6)) keep.push(s) }
  return keep
}

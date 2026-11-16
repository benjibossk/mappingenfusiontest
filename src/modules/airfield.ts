// Airfield generator (pure): runway, parallel taxiway + links, apron, hangars, control tower, fuel,
// runway edge lights; strong flatten along the runway (grade ≤ 1 %); orientation chosen to minimise
// earthwork; suggester for long flat areas.
//
// RUNWAY REPRESENTATION (choice): the runway, taxiways and apron are ROAD GENERATOR splines
// (RG_Road_Concrete_USSR_02 / RG_Road_ConcretePanel_01) with an explicit RoadWidth, sent exactly like
// roads.ts roadShapes (AdjustHeightMap=0: the relief is shaped by our FlattenRequest first). That is
// the only path the Workbench pipeline already builds (MG_ApplyProjectPlugin: shapes + generator +
// params); there is no surface-paint-only object in mapgen.json, and no runway prefab in vanilla
// (only decals Runway_Cracks_*, LightRunway_*, AirfieldMatting_*). Vanilla Everon (Saint-Philippe) /
// Arland airfields use the same idea: a wide concrete road object over a flattened strip.
// UNVERIFIED: that RoadWidth 30–45 m renders cleanly (segment tessellation, UV stretch); fallback =
// two or three parallel splines of 15 m. The apron is a short wide spline along its long axis.

import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'
import {
  rng, toWorld, heightAt, bestPlane, earthwork, toEntity, roadShape, round,
  type Box, type FlattenRequest, type SitePlacement, type Disc,
} from './gen-common'

export type AirfieldSize = 'small' | 'medium' | 'large'

export const AIRFIELD_SIZES: Record<AirfieldSize, { length: number; width: number; taxi: number; apronW: number; apronD: number; hangars: number }> = {
  small: { length: 800, width: 25, taxi: 12, apronW: 120, apronD: 60, hangars: 1 },
  medium: { length: 1100, width: 35, taxi: 15, apronW: 200, apronD: 80, hangars: 2 },
  large: { length: 1500, width: 45, taxi: 18, apronW: 280, apronD: 100, hangars: 3 },
}

//! base-game paths (enfusion-mcp asset_search 2026-11-16); footprints are ESTIMATES (not in prefabs.txt)
export const AIR_PREFABS = {
  hangar: { p: 'Prefabs/Structures/Airport/Hangar_01/Hangar_01.et', hw: 18, hd: 22 },
  tower: { p: 'Prefabs/Structures/Airport/ControlTower_01/ControlTower_01.et', hw: 6, hd: 6 },
  fuel: { p: 'Prefabs/Structures/Industrial/FuelTank_01/FuelTank_01.et', hw: 2, hd: 5 }, // inferred from PrefabLibrary
  pump: { p: 'Prefabs/Structures/Airport/AirfieldPipeline_01/AirfieldPipeline_01_pump.et', hw: 1.5, hd: 1.5 },
  antenna: { p: 'Prefabs/Structures/Airport/AntennaAirport_01/AntennaAirport_01.et', hw: 1, hd: 1 },
  light: { p: 'Prefabs/Structures/Airport/LightRunway_01/LightRunway_01_white.et', hw: 0.3, hd: 0.3 },
  lightEnd: { p: 'Prefabs/Structures/Airport/LightRunway_01/LightRunway_01_green_red.et', hw: 0.3, hd: 0.3 },
}
const GEN = { runway: 'Prefabs/WEGenerators/Roads/Concrete/RG_Road_Concrete_USSR_02.et', taxi: 'Prefabs/WEGenerators/Roads/Concrete/RG_Road_ConcretePanel_01.et' }

export const MAX_RUNWAY_GRADE = 0.01

export interface AirfieldOptions { size: AirfieldSize; x: number; z: number; yaw: number; seed: number | string; side?: 1 | -1 }

export interface Airfield {
  size: AirfieldSize
  runway: Box
  taxiways: Box[]
  apron: Box
  placements: SitePlacement[]
  entities: ProjectEntity[]
  shapes: ProjectShape[]
  /** [0] runway strip (grade ≤ 1 %), [1] taxiway + apron platform; set heights with flattenAirfield */
  flatten: FlattenRequest[]
}

export function generateAirfield(o: AirfieldOptions): Airfield {
  const R = rng(`${o.seed}|air|${o.size}`), S = AIRFIELD_SIZES[o.size], yaw = o.yaw
  const side = o.side ?? (R() < 0.5 ? 1 : -1)
  const W = (lx: number, lz: number) => toWorld(o.x, o.z, yaw, lx, lz)
  const lbox = (lx: number, lz: number, hw: number, hd: number, ly = 0): Box => { const [x, z] = W(lx, lz); return { x, z, hw, hd, yaw: yaw + ly } }
  const L = S.length / 2, off = side * (S.width / 2 + 60) // taxiway centre line, 60 m clear of the runway edge
  const runway = lbox(0, 0, S.width / 2, L)
  const tL = L - 40
  const taxiways: Box[] = [lbox(off, 0, S.taxi / 2, tL)]
  const shapes: ProjectShape[] = [roadShape(`air-${o.seed}-rwy`, [...W(0, -L), ...W(0, L)], GEN.runway, S.width)]
  shapes.push(roadShape(`air-${o.seed}-twy`, [...W(off, -tL), ...W(off, tL)], GEN.taxi, S.taxi))
  // links runway ↔ taxiway: both ends + middle
  for (const lz of [-tL, 0, tL]) {
    const a = side * S.width / 2, mid = (a + off) / 2
    taxiways.push(lbox(mid, lz, Math.abs(off - a) / 2, S.taxi / 2))
    shapes.push(roadShape(`air-${o.seed}-lk${lz}`, [...W(a, lz), ...W(off + side * S.taxi / 2, lz)], GEN.taxi, S.taxi))
  }
  // apron beyond the taxiway, centred on the middle link (offset along the runway by seed)
  const az = round((R() - 0.5) * (tL - S.apronW / 2) * 0.6)
  const ax = off + side * (S.taxi / 2 + S.apronD / 2)
  const apron = lbox(ax, az, S.apronD / 2, S.apronW / 2)
  shapes.push(roadShape(`air-${o.seed}-apron`, [...W(ax, az - S.apronW / 2), ...W(ax, az + S.apronW / 2)], GEN.taxi, S.apronD))
  taxiways.push(lbox(off, az, S.taxi / 2, S.apronW / 2)) // (covered by the main taxiway; kept for footprint)

  const placements: SitePlacement[] = []
  const put = (role: string, pf: { p: string; hw: number; hd: number }, b: Box) => placements.push({ role, prefab: pf.p, box: b })
  // hangars behind the apron, doors (+Z) facing the runway
  const back = ax + side * (S.apronD / 2 + AIR_PREFABS.hangar.hd + 4)
  const face = side > 0 ? -90 : 90
  for (let i = 0; i < S.hangars; i++) {
    const lz = az + (i - (S.hangars - 1) / 2) * (AIR_PREFABS.hangar.hw * 2 + 14)
    put('hangar', AIR_PREFABS.hangar, lbox(back, lz, AIR_PREFABS.hangar.hw, AIR_PREFABS.hangar.hd, face))
  }
  // control tower at one end of the apron, near the edge, clear view on the runway
  const towerZ = az + (R() < 0.5 ? 1 : -1) * (S.apronW / 2 + 16)
  put('tower', AIR_PREFABS.tower, lbox(ax - side * (S.apronD / 2 - 8), towerZ, 6, 6, face))
  put('antenna', AIR_PREFABS.antenna, lbox(ax + side * 6, towerZ, 1, 1))
  // fuel farm on the other end
  const fz = az - Math.sign(towerZ - az) * (S.apronW / 2 + 14)
  for (let i = 0; i < 3; i++) put('fuel', AIR_PREFABS.fuel, lbox(ax + side * (i * 7 - 7), fz, 2, 5))
  put('pump', AIR_PREFABS.pump, lbox(ax - side * (S.apronD / 2 - 4), fz + Math.sign(fz - az) * -9, 1.5, 1.5))
  // edge lights every 60 m, threshold lights at both ends
  for (let lz = -L; lz <= L + 0.1; lz += 60) for (const sx of [-1, 1]) put('light', AIR_PREFABS.light, lbox(sx * (S.width / 2 + 2), lz, 0.3, 0.3))
  for (const lz of [-L - 4, L + 4]) for (let lx = -S.width / 2; lx <= S.width / 2 + 0.1; lx += 5) put('lightEnd', AIR_PREFABS.lightEnd, lbox(lx, lz, 0.3, 0.3))

  // flatten: runway strip (shoulders + 60 m overrun); platform = taxiway, apron and buildings
  const strip: FlattenRequest = { box: lbox(0, 0, S.width / 2 + 20, L + 60), h0: 0, h1: 0, falloff: 60 }
  const pw = Math.abs(back + side * AIR_PREFABS.hangar.hd - (side * S.width / 2 + side * 20)) / 2 + 6
  const pc = (back + side * AIR_PREFABS.hangar.hd + side * (S.width / 2 + 20)) / 2
  const plat: FlattenRequest = { box: lbox(pc, 0, pw, tL + S.taxi), h0: 0, h1: 0, falloff: 40 }
  return { size: o.size, runway, taxiways, apron, placements, shapes, flatten: [strip, plat], entities: placements.map((p, i) => toEntity(p, `air-${o.seed}-${i}`)) }
}

/** fits the two planes on the terrain (runway ≤ 1 %, platform ≤ 1.5 %), and makes the platform meet
 *  the runway at the same height along their common edge. Returns the estimated earthwork (m³). */
export function flattenAirfield(a: Airfield, heights: ArrayLike<number>, g: Grid): number {
  const [s, p] = a.flatten
  const [h0, h1] = bestPlane(heights, g, s.box, MAX_RUNWAY_GRADE)
  s.h0 = round(h0); s.h1 = round(h1)
  // platform has the same length axis: same grade as the runway → no step between them
  p.h0 = s.h0; p.h1 = s.h1
  return Math.round(earthwork(heights, g, s, 10) + earthwork(heights, g, p, 10))
}

export interface AirfieldSuggestOptions { size: AirfieldSize; seaLevel?: number; keepOut?: Disc[]; count?: number; step?: number; angleStep?: number }
export interface AirfieldSuggestion { x: number; z: number; yaw: number; earthwork: number; meanCut: number; score: number }

/** best orientation at one centre: tries yaw 0..180 by angleStep, keeps the least earthwork on the
 *  runway strip (dry land along the whole strip required). */
export function bestRunwayYaw(heights: ArrayLike<number>, g: Grid, x: number, z: number, size: AirfieldSize, seaLevel = 0, angleStep = 10): { yaw: number; earthwork: number } | null {
  const S = AIRFIELD_SIZES[size]
  let best: { yaw: number; earthwork: number } | null = null
  for (let yaw = 0; yaw < 180; yaw += angleStep) {
    const box: Box = { x, z, hw: S.width / 2 + 20, hd: S.length / 2 + 60, yaw }
    let dry = true
    for (let lz = -box.hd; lz <= box.hd && dry; lz += 50) for (const lx of [-box.hw, 0, box.hw]) {
      const [px, pz] = toWorld(x, z, yaw, lx, lz)
      if (px < g.minX || pz < g.minZ || px > g.minX + (g.cols - 1) * g.step || pz > g.minZ + (g.rows - 1) * g.step || heightAt(heights, g, px, pz) < seaLevel + 2) { dry = false; break }
    }
    if (!dry) continue
    const [h0, h1] = bestPlane(heights, g, box, MAX_RUNWAY_GRADE, 20)
    const ew = earthwork(heights, g, { box, h0, h1, falloff: 0 }, 20)
    if (!best || ew < best.earthwork) best = { yaw, earthwork: Math.round(ew) }
  }
  return best
}

/** scans the map for long flat dry strips; returns the best sites (yaw included), far apart */
export function suggestAirfield(heights: ArrayLike<number>, g: Grid, o: AirfieldSuggestOptions): AirfieldSuggestion[] {
  const S = AIRFIELD_SIZES[o.size], step = o.step ?? 250, out: AirfieldSuggestion[] = []
  const area = (S.width + 40) * (S.length + 120)
  for (let z = g.minZ + step; z < g.minZ + (g.rows - 1) * g.step - step; z += step) for (let x = g.minX + step; x < g.minX + (g.cols - 1) * g.step - step; x += step) {
    if (o.keepOut?.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + S.length / 2 + 100)) continue
    const b = bestRunwayYaw(heights, g, x, z, o.size, o.seaLevel ?? 0, o.angleStep ?? 15)
    if (!b) continue
    const meanCut = b.earthwork / area
    out.push({ x: round(x), z: round(z), yaw: b.yaw, earthwork: b.earthwork, meanCut: round(meanCut), score: round(1 / (1 + meanCut)) })
  }
  out.sort((a, b) => b.score - a.score)
  const keep: AirfieldSuggestion[] = []
  for (const s of out) { if (keep.length >= (o.count ?? 3)) break; if (keep.every((k) => Math.hypot(k.x - s.x, k.z - s.z) > S.length)) keep.push(s) }
  return keep
}

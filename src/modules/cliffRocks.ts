// Rocks, cliffs, scree and field stones after the vanilla maps (PakTools/analyses/ROCKS_VANILLA.md).
// [M] measured on Everon / Arland / Kolguyev:
//  - rock and cliff pieces sit on the steepest ground of the map, by RANK, not by an absolute angle: median slope
//    percentile 81-98 (cliffs 94-98) whatever the map's relief. Our 4 km islands rarely pass 37 deg, so the
//    thresholds come from the slope distribution of the island itself (relative percentile, absolute caps).
//  - they come in groups: Arland / Kolguyev median cluster 2, p90 13-16 (12 m linkage), Everon 79 % singles;
//    crests (TPI > 3 m) carry 11-21 %, hollows 14-20 % (scree at the foot of the slopes).
//  - every big piece is sunk deep: pivot below the terrain by the median offset of its prefab
//    (GraniteRock -5..-6 m, GraniteCliff_01 -4.6, _02 -14, _03 -17, SurfaceStone -1.6..-3, Boulder_V2 -0.85,
//    clusters / stones ~0). Without it a GraniteRock floats ~5 m above the ground.
//  - tilted 74-92 % (pitch / roll median: cliff 15-30, rock 5-9, boulder 9-23, stone 3 deg), cliffs face
//    the valley (|yaw - downhill| median 18-23 deg), rocks / boulders any yaw (median 74-105 deg = random).
//  - Everon 36 % in forest (all its GraniteRock are the _Forest variants), Arland / Kolguyev 2-4 %;
//    37-56 % within 60 m of the sea (beach clusters / stones).
// Scale is not exported by the Workbench plugin yet: the size variety comes from the prefab mix.

import type { ProjectEntity } from '../project'
import { mulberry } from './vegLayers'

type Kind = 'cliff' | 'rock' | 'slab' | 'boulder' | 'cluster' | 'stone' | 'beach'
interface Piece { p: string; dy: number }
const P = (g: string, path: string, dy: number): Piece => ({ p: `{${g}}Prefabs/Rocks/Granite/${path}.et`, dy })

/** vanilla granite prefabs with their median pivot offset below the terrain (m, ROCKS_VANILLA.md §4) */
export const ROCK_SETS: Record<Kind | 'rockForest' | 'slabForest' | 'stoneForest', Piece[]> = {
  cliff: [P('3F68EE5DCB004B10', 'GraniteCliff_01', -4.6), P('533CDABD77C4C43E', 'GraniteCliff_02', -14.2), P('B6A096447B215355', 'GraniteCliff_03', -17)],
  rock: [P('DF692A1784D6B324', 'GraniteRock_01_V2', -6.2), P('D5CC7A5A32C640A3', 'GraniteRock_02_V2', -5.8), P('1200EAC7C79003AF', 'GraniteRock_03_V2', -4.9)],
  rockForest: [P('2BBA69F7F0BCD76E', 'GraniteRock_01_Forest', -5.2), P('019E4E540652B141', 'GraniteRock_02_Forest', -5.6), P('D9D20C6C33517ED5', 'GraniteRock_03_Forest', -4.6)],
  slab: [P('A0BB927F0EBB5828', 'GraniteSurfaceStone_05', -1.76), P('CCEFA69FB27FD706', 'GraniteSurfaceStone_06', -1.62), P('2973EA66BE9A406D', 'GraniteSurfaceStone_07', -1.74)],
  slabForest: [P('5F799252A82209D2', 'GraniteSurfaceStone_01_Forest', -2.4), P('755DB5F15ECC6FFD', 'GraniteSurfaceStone_02_Forest', -1.71)],
  boulder: [P('ADC53C3320B368DA', 'Granite_Boulder_01_V2', -0.8), P('A7606C7E96A39B5D', 'Granite_Boulder_02_V2', -0.88)],
  cluster: [P('221F1E889AAF89B2', 'Granite_Cluster_01_V2', 0), P('BA73CB6DADFB194E', 'Granite_Cluster_Large_01_V2', -0.19)],
  stone: [P('F5837A3933EFF7CF', 'GraniteStone_01_V2', -0.01), P('38EABAE970A94744', 'GraniteStone_03_V2', -0.07)],
  stoneForest: [P('FF676E917668C455', 'Granite_ForestStone_01', -0.13), P('93335A71CAAC4B7B', 'Granite_ForestStone_02', -0.43), P('44E78971B16213FB', 'Granite_ForestCluster_02', 0)],
  beach: [P('45BE489A63A25CA6', 'Granite_BeachCluster_01', -0.19), P('29EA7C7ADF66D388', 'Granite_BeachCluster_02', -0.19), P('07FBB9A2F51332E4', 'Granite_BeachStone_01', -0.09), P('6BAF8D4249D7BDCA', 'Granite_BeachStone_02', -0.49)],
}
/** kept for older imports: cliff faces and big rocks */
export const CLIFF_PREFABS = { cliff: ROCK_SETS.cliff.map((q) => q.p), rock: [...ROCK_SETS.rock, ...ROCK_SETS.rockForest].map((q) => q.p) }
const KIND_OF = new Map<string, Kind>()
for (const [k, set] of Object.entries(ROCK_SETS)) for (const q of set) KIND_OF.set(q.p, k.replace(/Forest$/, '') as Kind)
export const rockKind = (prefab: string): Kind | undefined => KIND_OF.get(prefab)
const DY = new Map<string, number>([...Object.values(ROCK_SETS).flat().map((q) => [q.p, q.dy] as [string, number]), ['{FF262A7485FF0448}Prefabs/Rocks/Granite/GraniteStone_02_V2.et', -0.08]])

/** sinks the granite pieces placed elsewhere (vegLayers scatter) by their vanilla median pivot offset: a
 *  GraniteRock on ycm 0 floats ~5 m above the ground. Entities that already carry ycm are left alone. */
export function buryRocks<T extends ProjectEntity>(es: T[], groundAt: (x: number, z: number) => number): T[] {
  for (const e of es) {
    const dy = DY.get(e.prefab)
    if (dy === undefined || e.ycm !== undefined || Math.abs(dy) < 0.3) continue
    e.ycm = Math.round((groundAt(e.x, e.z) + dy) * 100) || -1
  }
  return es
}

/** [M] tilt half-ranges (deg) ~ 2x the vanilla median |pitch| / |roll| */
const TILT: Record<Kind, number> = { cliff: 25, rock: 10, slab: 8, boulder: 20, cluster: 5, stone: 6, beach: 8 }
/** min spacing to another piece (m) */
const GAP: Record<Kind, number> = { cliff: 9, rock: 5, slab: 3, boulder: 2.5, cluster: 3, stone: 1.5, beach: 2.5 }

/** absolute caps (rise/run): rock rank threshold never above 30 deg, cliff never above 42 deg; floors 12 / 20 deg */
export const CLIFF_MIN_SLOPE = Math.tan((30 * Math.PI) / 180)
export const CLIFF_FACE_SLOPE = Math.tan((42 * Math.PI) / 180)
const FLOOR_ROCK = Math.tan((12 * Math.PI) / 180), FLOOR_CLIFF = Math.tan((20 * Math.PI) / 180)

export interface CliffOptions {
  box: { minX: number; minZ: number; maxX: number; maxZ: number }
  /** terrain height (used for slope); `groundAt` (smooth, bilinear) for the burial height when given */
  heightAt: (x: number, z: number) => number
  groundAt?: (x: number, z: number) => number
  ok: (x: number, z: number) => boolean
  forest?: (x: number, z: number) => boolean
  seed: number
  /** outcrop lattice (m) */
  spacing?: number
  /** absolute override of the rock threshold (rise/run); default from the slope percentiles */
  minSlope?: number
  max?: number
  /** multiplier of the outcrop chance (1 = vanilla Everon-like density) */
  density?: number
  /** land-slope quantile of the rock threshold (default 0.72, Everon) */
  rockQ?: number
  prefix?: string
}

export interface RockThresholds { rock: number; cliff: number; field: number; q: (p: number) => number; rank: (s: number) => number }

function slopeAt(h: (x: number, z: number) => number, x: number, z: number, d = 4): [number, number, number] {
  const gx = (h(x + d, z) - h(x - d, z)) / (2 * d), gz = (h(x, z + d) - h(x, z - d)) / (2 * d)
  return [Math.hypot(gx, gz), gx, gz]
}

/** land slope distribution of the box (16 m lattice) -> rank thresholds clamped to absolute bounds */
export function rockThresholds(o: Pick<CliffOptions, 'box' | 'heightAt' | 'rockQ'>): RockThresholds {
  const s: number[] = []
  for (let z = o.box.minZ + 8; z < o.box.maxZ; z += 16) for (let x = o.box.minX + 8; x < o.box.maxX; x += 16) {
    if (o.heightAt(x, z) <= 0.5) continue
    s.push(slopeAt(o.heightAt, x, z)[0])
  }
  s.sort((a, b) => a - b)
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0)
  const rank = (v: number) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m } return s.length ? lo / s.length : 0 }
  // [M] rock median rank 81-98, p10 25-78 -> from the 72nd percentile up, more likely the higher the rank;
  // cliffs median rank 94-98 -> 98.5th
  const rock = Math.min(CLIFF_MIN_SLOPE, Math.max(FLOOR_ROCK, q(o.rockQ ?? 0.72)))
  const cliff = Math.min(CLIFF_FACE_SLOPE, Math.max(FLOOR_CLIFF, q(0.985), rock * 1.25))
  return { rock, cliff, field: Math.max(Math.tan((6 * Math.PI) / 180), q(0.5)), q, rank }
}

/** per-map rockiness (bench tour Bohemia 2026-11-20, vanilla-rocks.json big pieces per km2 of land: Everon 22,
 *  Kolguyev 120, Arland 373, 30 % of Arland's above 45 deg): outcrop chance multiplier, threshold quantile, cap of
 *  pieces per km2 of land */
export function rockProfile(biome?: string): { density: number; rockQ: number; perKm2: number; spacing: number } {
  if (biome && /arland/i.test(biome)) return { density: 10, rockQ: 0.88, perKm2: 900, spacing: 11 }
  if (biome && /kolguyev|nordic/i.test(biome)) return { density: 3, rockQ: 0.72, perKm2: 400, spacing: 22 }
  return { density: 1, rockQ: 0.72, perKm2: 200, spacing: 22 }
}

export function cliffRocks(o: CliffOptions): ProjectEntity[] {
  const sp = o.spacing ?? 22, rand = mulberry(o.seed * 17 + 3), max = o.max ?? 4000
  const th = rockThresholds(o)
  const rockT = o.minSlope ?? th.rock, cliffT = Math.max(th.cliff, rockT * 1.15)
  const ground = o.groundAt ?? o.heightAt
  const out: ProjectEntity[] = []
  const cell = new Map<number, { x: number; z: number; g: number }[]>()
  const free = (x: number, z: number, g: number) => {
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of cell.get((cx + i) * 100003 + cz + j) ?? []) if (Math.hypot(q.x - x, q.z - z) < Math.max(q.g, g)) return false
    return true
  }
  const inBox = (x: number, z: number) => x > o.box.minX && z > o.box.minZ && x < o.box.maxX && z < o.box.maxZ
  const tpi = (x: number, z: number) => { let m = 0; for (let k = 0; k < 8; k++) m += o.heightAt(x + 60 * Math.cos(k * Math.PI / 4), z + 60 * Math.sin(k * Math.PI / 4)); return o.heightAt(x, z) - m / 8 }
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]
  const add = (kind: Kind, x: number, z: number, downYaw?: number): boolean => {
    if (out.length >= max || !inBox(x, z) || o.heightAt(x, z) <= 0.5 || !o.ok(x, z) || !free(x, z, GAP[kind])) return false
    const forest = !!o.forest?.(x, z)
    const set = kind === 'rock' && forest ? ROCK_SETS.rockForest : kind === 'slab' && forest ? ROCK_SETS.slabForest : kind === 'stone' && forest ? ROCK_SETS.stoneForest : ROCK_SETS[kind]
    const pc = pick(set)
    // cliffs: +Z towards the valley, +-20 deg ([M] median 18-23); the rest any yaw
    const yaw = Math.round((kind === 'cliff' && downYaw !== undefined ? downYaw + (rand() - 0.5) * 40 + 720 : rand() * 360) % 360)
    const t = TILT[kind]
    // burial: vanilla median offset +-15 % (cliffs / rocks), a few cm for the small ones
    const dy = pc.dy * (0.85 + rand() * 0.3) - (Math.abs(pc.dy) < 0.5 ? rand() * 0.1 : 0)
    const ycm = Math.round((ground(x, z) + dy) * 100) || -1
    const e: ProjectEntity = { id: `${o.prefix ?? 'CLIFF_'}${out.length + 1}`, prefab: pc.p, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw,
      ycm, pitch: Math.round((rand() - 0.5) * 2 * t), roll: Math.round((rand() - 0.5) * 2 * t), role: kind === 'stone' || kind === 'beach' ? 'clutter' : 'essential' }
    if (!e.pitch) delete e.pitch
    if (!e.roll) delete e.roll
    out.push(e)
    const k = Math.floor(x / 10) * 100003 + Math.floor(z / 10)
    let c = cell.get(k); if (!c) cell.set(k, (c = []))
    c.push({ x, z, g: GAP[kind] })
    return true
  }
  const downOf = (gx: number, gz: number) => (Math.atan2(-gx, -gz) * 180) / Math.PI
  // 1. outcrops on the steepest ranks (+ crests): a group strung along the contour, scree below
  for (let z = o.box.minZ + sp / 2; z < o.box.maxZ; z += sp) {
    for (let x = o.box.minX + sp / 2; x < o.box.maxX; x += sp) {
      if (out.length >= max) return out
      const px = x + (rand() - 0.5) * sp * 0.8, pz = z + (rand() - 0.5) * sp * 0.8
      if (o.heightAt(px, pz) <= 0.5) continue
      const [s, gx, gz] = slopeAt(o.heightAt, px, pz)
      const ridge = s > rockT * 0.7 && tpi(px, pz) > 3
      const t0 = ridge ? rockT * 0.8 : rockT
      if (s < t0) continue
      // chance grows with the rank above the threshold ([M] Everon: big pieces spread over ranks 25-98, median 81)
      const r0 = th.rank(t0), u = Math.max(0, (th.rank(s) - r0) / Math.max(1e-3, 1 - r0))
      const pr = Math.min(0.6, (o.density ?? 1) * (0.012 + 0.12 * u * u))
      if (rand() > pr) continue
      const L = Math.max(1e-6, Math.hypot(gx, gz)), ux = -gz / L, uz = gx / L, dx = -gx / L, dz = -gz / L
      const down = downOf(gx, gz)
      // [M] cluster sizes: ~40 % single, median 2, p90 13-16
      const n = rand() < 0.4 ? 1 : 2 + Math.min(10, Math.floor(-Math.log(1 - rand() * 0.999) * 3))
      let placed = 0
      for (let k = 0; k < n; k++) {
        const along = k === 0 ? 0 : (rand() - 0.5) * (6 + 2.2 * n), across = k === 0 ? 0 : (rand() - 0.5) * 4
        const qx = px + ux * along + dx * across, qz = pz + uz * along + dz * across
        const qs = k === 0 ? s : slopeAt(o.heightAt, qx, qz)[0]
        const kind: Kind = qs >= cliffT && (k === 0 || rand() < 0.15) ? 'cliff' : qs >= t0 * 0.85 ? (rand() < 0.65 ? 'rock' : 'slab') : rand() < 0.5 ? 'slab' : 'boulder'
        if (add(kind, qx, qz, down)) placed++
      }
      if (!placed || s < rockT) continue
      // 2. scree: walk downhill to the foot (slope under ~55 % of the threshold), boulders / clusters / stones there
      let fx = px, fz = pz
      for (let w = 0; w < 14; w++) {
        const [ws, wgx, wgz] = slopeAt(o.heightAt, fx, fz)
        if (ws < rockT * 0.55 && w > 1) break
        const wl = Math.max(1e-6, Math.hypot(wgx, wgz)); fx -= (wgx / wl) * 4; fz -= (wgz / wl) * 4
      }
      const m = 2 + Math.floor(rand() * (3 + placed))
      for (let k = 0; k < m; k++) {
        const r = 2 + rand() * 9, a = rand() * Math.PI * 2, kr = rand()
        add(kr < 0.35 ? 'boulder' : kr < 0.6 ? 'cluster' : kr < 0.8 ? 'slab' : 'stone', fx + r * Math.cos(a), fz + r * Math.sin(a))
      }
    }
  }
  // 3. field stones on hill ground (Everon: stones median slope 10 deg, rank ~50, 36 % in forest), sparse
  for (let z = o.box.minZ + 35; z < o.box.maxZ; z += 70) {
    for (let x = o.box.minX + 35; x < o.box.maxX; x += 70) {
      if (out.length >= max) return out
      const px = x + (rand() - 0.5) * 60, pz = z + (rand() - 0.5) * 60
      if (o.heightAt(px, pz) <= 0.5 || rand() > 0.35) continue
      const [s] = slopeAt(o.heightAt, px, pz)
      if (s < th.field || s >= rockT) continue
      const n = 1 + Math.floor(rand() * 3)
      // [M] Everon: 23 % of the GraniteRock lie under 10 deg (forest floor) -> a lone rock now and then
      for (let k = 0; k < n; k++) { const kr = rand(); add(kr < 0.2 ? 'rock' : kr < 0.4 ? 'boulder' : kr < 0.7 ? 'slab' : 'stone', px + (rand() - 0.5) * 8, pz + (rand() - 0.5) * 8) }
    }
  }
  // 4. rocky shore: steep ground 0.5..5 m above the sea with the water within 25 m (beach clusters / stones)
  for (let z = o.box.minZ + 15; z < o.box.maxZ; z += 30) {
    for (let x = o.box.minX + 15; x < o.box.maxX; x += 30) {
      if (out.length >= max) return out
      const px = x + (rand() - 0.5) * 24, pz = z + (rand() - 0.5) * 24, h = o.heightAt(px, pz)
      if (h <= 0.5 || h > 5 || rand() > 0.5) continue
      let sea = false
      for (let k = 0; k < 8 && !sea; k++) sea = o.heightAt(px + 25 * Math.cos((k * Math.PI) / 4), pz + 25 * Math.sin((k * Math.PI) / 4)) < 0
      if (!sea || slopeAt(o.heightAt, px, pz)[0] < th.q(0.6)) continue
      const n = 2 + Math.floor(rand() * 5)
      for (let k = 0; k < n; k++) add('beach', px + (rand() - 0.5) * 10, pz + (rand() - 0.5) * 10)
    }
  }
  return out
}

// ---------------------------------------------------------------- ground texture around the rocks
// [M] ROCKS_VANILLA.md §6: no tight stamp under each rock. Rocks sit in a broad rocky patch: Debris_Rock
// (scree-grass) 42-52 % of the ground within 10 m of rocks vs 1-6 % on the same slopes > 60 m away
// (Arland / Kolguyev), still ~45 % at 40 m. Bare Rock_01 only right at cliffs / rocks (Everon 3.7 % under them
// vs 0.9 % at 128 m). Everon's scree is also slope-driven (10 % flat -> 58 % at 45 deg), which rockMask.ts
// already paints: this adds the rock-driven part.
export interface RockStamp { x: number; z: number; r: number; w: number; surface: string }

export function rockStamps(es: ProjectEntity[], scree = 'Debris_Rock_01', bare = 'Rock_01'): RockStamp[] {
  const out: RockStamp[] = []
  for (const e of es) {
    const k = rockKind(e.prefab)
    if (k === 'cliff') out.push({ x: e.x, z: e.z, r: 10, w: 0.65, surface: bare }, { x: e.x, z: e.z, r: 32, w: 0.55, surface: scree })
    else if (k === 'rock') out.push({ x: e.x, z: e.z, r: 6, w: 0.4, surface: bare }, { x: e.x, z: e.z, r: 26, w: 0.5, surface: scree })
    else if (k === 'slab' || k === 'boulder' || k === 'cluster') out.push({ x: e.x, z: e.z, r: 14, w: 0.4, surface: scree })
  }
  return out
}

interface WGrid { name: string; minX: number; minZ: number; step: number; cols: number; rows: number; weights: number[] }

/** raises each stamp's surface to max(current, w * smoothstep falloff), taking the weight from the other land
 *  surfaces in proportion (never from `keep`: sea bed, river bed, shore). Vertices where a kept surface
 *  passes 30 % and `skip` vertices (> 0: village lots + margin) are left alone. Mutates the grids; returns the number of weights raised. */
export function paintRockSurfaces(surfaces: WGrid[], stamps: RockStamp[], keep: RegExp = /^(SeaBed|Pebbles_0[12]|BeachGrass)/, skip?: ArrayLike<number>): number {
  if (!surfaces.length || !stamps.length) return 0
  const g = surfaces[0], byName = new Map(surfaces.map((s) => [s.name, s]))
  const target = new Map<number, Map<string, number>>()
  for (const s of stamps) {
    if (!byName.has(s.surface)) continue
    const c0 = Math.max(0, Math.floor((s.x - s.r - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((s.x + s.r - g.minX) / g.step))
    const r0 = Math.max(0, Math.floor((s.z - s.r - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((s.z + s.r - g.minZ) / g.step))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const d = Math.hypot(g.minX + c * g.step - s.x, g.minZ + r * g.step - s.z) / s.r
      if (d >= 1) continue
      const i = r * g.cols + c, w = s.w * (1 - d * d * (3 - 2 * d))
      let m = target.get(i); if (!m) target.set(i, (m = new Map()))
      m.set(s.surface, Math.max(m.get(s.surface) ?? 0, w))
    }
  }
  let changed = 0
  for (const [i, m] of target) {
    if ((skip && skip[i] > 0) || surfaces.some((s) => keep.test(s.name) && s.weights[i] > 0.3)) continue
    for (const [name, w] of m) {
      const own = byName.get(name)!, cur = own.weights[i]
      if (cur >= w) continue
      const donors = surfaces.filter((s) => s !== own && !keep.test(s.name) && !m.has(s.name))
      const pool = donors.reduce((a, s) => a + s.weights[i], 0)
      const need = Math.min(w - cur, pool)
      if (need < 1 / 255) continue
      for (const s of donors) s.weights[i] -= (s.weights[i] / pool) * need
      own.weights[i] = cur + need; changed++
    }
    for (const s of surfaces) if (s.weights[i] < 1 / 255) s.weights[i] = 0
  }
  return changed
}

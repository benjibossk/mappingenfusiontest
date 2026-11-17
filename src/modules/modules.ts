// Module assembly on a grid, DeBroglie style (own code, no dependency): the polygon is cut into square cells
// in the road frame, every cell gets one module label from a small constraint solver (WFC-like: smallest
// domain first, seeded weighted choice, forward checking of "apart" adjacency rules and min / max counts,
// chronological backtracking; on failure the min counts are relaxed, then a greedy fallback label is used).
// Used by the site zones "Military camp" (US / USSR / FIA) and "Scrapyard": each label is then dressed with
// vanilla prefabs inside its cell, so modules never overlap and stay inside the polygon.
// Prefab refs: all checked in library/prefabs-catalogue.json (base game GUIDs). Footprints: the real .xob bbox
// (catalogue dims, library/dims.ts) when it fits a module cell; the literal estimate otherwise (shed 16x43 m,
// US antenna with its guy wires, camo nets, helipad: bigger than a 12 m cell, the module layout reserves their room).

import type { ProjectEntity, ProjectShape } from '../project'
import type { FlattenRequest as Platform } from './industrial'
import { round, wallShape } from './gen-common'
import { prefabDims } from '../library/dims.ts'
import { centroid, distLine, fencePosts, frameOf, inPoly, insetRing, nearestPoint, rectAt, slopeAt, type Frame, type RoadLine } from './rowgrid'

// ---- solver -------------------------------------------------------------------------------------
export interface ModuleCell { i: number; j: number; x: number; z: number; corner: boolean }
export interface ModuleSpec {
  labels: string[]
  weight: number[]
  /** unary rule: may `label` sit on cell k */
  allow?: (k: number, label: number) => boolean
  /** [a, b, d]: no a within Chebyshev distance d (cells) of b */
  apart?: [number, number, number][]
  min?: number[]
  max?: number[]
  /** pre-assigned cells (lanes, gate, helipad) */
  fixed?: Map<number, number>
  /** label used when nothing else fits (no rule, always allowed) */
  fallback: number
}
export interface ModuleSolution { label: number[]; backtracks: number; relaxed: boolean }

const bits = (m: number) => { const o: number[] = []; for (let l = 0; m; l++, m >>>= 1) if (m & 1) o.push(l); return o }
const pop = (m: number) => bits(m).length

export function solveModules(cells: ModuleCell[], spec: ModuleSpec, rand: () => number, maxSteps = 20000): ModuleSolution {
  const n = cells.length, L = spec.labels.length
  const at = new Map<string, number>()
  cells.forEach((c, k) => at.set(`${c.i},${c.j}`, k))
  const near = (k: number, d: number) => {
    const o: number[] = [], c = cells[k]
    for (let di = -d; di <= d; di++) for (let dj = -d; dj <= d; dj++) { const q = at.get(`${c.i + di},${c.j + dj}`); if (q !== undefined && q !== k) o.push(q) }
    return o
  }
  let backtracks = 0
  const attempt = (useMin: boolean): number[] | null => {
    const d0 = new Int32Array(n)
    for (let k = 0; k < n; k++) {
      const f = spec.fixed?.get(k)
      if (f !== undefined) { d0[k] = 1 << f; continue }
      for (let l = 0; l < L; l++) if (l === spec.fallback || !spec.allow || spec.allow(k, l)) d0[k] |= 1 << l
    }
    // propagation to a fixed point; false = contradiction
    const settle = (d: Int32Array): boolean => {
      for (let changed = true; changed;) {
        changed = false
        for (let k = 0; k < n; k++) {
          if (!d[k]) return false
          if (pop(d[k]) !== 1) continue
          const l = bits(d[k])[0]
          for (const [a, b, r] of spec.apart ?? []) {
            const other = l === a ? b : l === b ? a : -1
            if (other < 0) continue
            for (const q of near(k, r)) if (d[q] & (1 << other)) { if (pop(d[q]) === 1) return false; d[q] &= ~(1 << other); changed = true }
          }
        }
        for (let l = 0; l < L; l++) {
          let done = 0, can = 0
          for (let k = 0; k < n; k++) { if (d[k] === 1 << l) done++; if (d[k] & (1 << l)) can++ }
          const mx = spec.max?.[l] ?? Infinity, mn = useMin ? spec.min?.[l] ?? 0 : 0
          if (done > mx || can < mn) return false
          if (done === mx && can > done) { for (let k = 0; k < n; k++) if (d[k] !== 1 << l && d[k] & (1 << l)) { d[k] &= ~(1 << l); changed = true } }
          else if (can === mn && can > done) { for (let k = 0; k < n; k++) if (d[k] & (1 << l) && d[k] !== 1 << l) { d[k] = 1 << l; changed = true } }
        }
      }
      return true
    }
    const order = (d: Int32Array, m: number) => {
      // weighted shuffle; labels still short of their min count are boosted
      const ls = bits(m).map((l) => {
        let done = 0
        for (let k = 0; k < n; k++) if (d[k] === 1 << l) done++
        const w = (spec.weight[l] || 0.01) * (useMin && done < (spec.min?.[l] ?? 0) ? 20 : 1)
        return { l, key: Math.pow(rand(), 1 / w) }
      })
      return ls.sort((a, b) => b.key - a.key).map((o) => o.l)
    }
    const first = Int32Array.from(d0)
    if (!settle(first)) return null
    const stack: { d: Int32Array; k: number; todo: number[] }[] = []
    let cur = first, steps = 0
    for (;;) {
      // smallest open domain (ties broken by the seed)
      let k = -1, bp = Infinity
      for (let q = 0; q < n; q++) { const p = pop(cur[q]); if (p > 1 && p + rand() * 0.5 < bp) { bp = p + rand() * 0.5; k = q } }
      if (k < 0) return Array.from(cur, (m) => bits(m)[0])
      stack.push({ d: cur, k, todo: order(cur, cur[k]) })
      for (;;) {
        if (++steps > maxSteps || !stack.length) return null
        const top = stack[stack.length - 1]
        const l = top.todo.shift()
        if (l === undefined) { stack.pop(); backtracks++; continue }
        const d = Int32Array.from(top.d)
        d[top.k] = 1 << l
        if (settle(d)) { cur = d; break }
      }
    }
  }
  let label = attempt(true), relaxed = false
  if (!label) { relaxed = true; label = attempt(false) }
  if (!label) label = cells.map((_, k) => spec.fixed?.get(k) ?? spec.fallback)
  return { label, backtracks, relaxed }
}

// ---- grid of cells ------------------------------------------------------------------------------
export interface CellGrid { frame: Frame & { road?: [number, number, number] }; size: number; cells: ModuleCell[]; yaw: number; gate: number; gatePt: [number, number] | null; fence: number[] }
export interface GridCtx { roads: RoadLine[]; ground?: (x: number, z: number) => number; ok?: (x: number, z: number) => boolean; maxSlope: number; avoid?: number[][] /* open water lines (rivers) */ }

/** convex hull (monotone chain), flat [x, z, ...] counter-clockwise */
function hull(p: [number, number][]): number[] {
  const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (s.length < 3) return s.flat()
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], up: [number, number][] = []
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q) }
  for (const q of s.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop(); up.push(q) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].flat()
}
const edgeSamples = (r: number[], step: number) => {
  const o: [number, number][] = [], n = r.length / 2
  for (let k = 0; k < n; k++) {
    const ax = r[k * 2], az = r[k * 2 + 1], bx = r[((k + 1) % n) * 2], bz = r[((k + 1) % n) * 2 + 1], L = Math.hypot(bx - ax, bz - az)
    for (let d = 0; d < L; d += step) o.push([ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L])
  }
  return o
}

/** square cells of `size` m fully inside the polygon (inset `margin`), off roads / water / steep ground; gate = the
 *  road-side cell facing the road, gatePt = where its axis crosses the border */
export function cellGrid(polygon: number[], size: number, c: GridCtx, margin = 3): CellGrid {
  const f = frameOf(polygon, c.roads, 200), ring = insetRing(polygon, margin)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < polygon.length; i += 2) {
    const ax = polygon[i] - f.ox, az = polygon[i + 1] - f.oz, u = ax * f.ux + az * f.uz, v = ax * f.vx + az * f.vz
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  const W = (u: number, v: number): [number, number] => [f.ox + f.ux * u + f.vx * v, f.oz + f.uz * u + f.vz * v]
  const nc = Math.floor((u1 - u0 - 2 * margin) / size), nr = Math.floor((v1 - v0 - 2 * margin) / size)
  const su = u0 + (u1 - u0 - nc * size) / 2, sv = v0 + margin
  const raw: ModuleCell[] = []
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
    const cu = su + (i + 0.5) * size, cv = sv + (j + 0.5) * size, h = size / 2
    const probe = [[0, 0], [-h, -h], [h, -h], [h, h], [-h, h], [0, -h], [h, 0], [0, h], [-h, 0]].map(([a, b]) => W(cu + a, cv + b))
    if (!probe.every(([x, z]) => inPoly(ring, x, z))) continue
    if (c.ok && !probe.every(([x, z]) => c.ok!(x, z))) continue
    if (c.roads.some((r) => r.pts.length >= 4 && probe.some(([x, z]) => distLine(r.pts, x, z) < r.half + 4))) continue
    const [x, z] = probe[0]
    if (c.ground && slopeAt(c.ground, x, z, size / 3) > c.maxSlope) continue
    if (c.avoid?.some((l) => distLine(l, x, z) < size)) continue
    raw.push({ i, j, x, z, corner: false })
  }
  // keep the largest 4-connected block (a road or a stream across the zone splits it; the far side is dropped)
  const key = (i: number, j: number) => `${i},${j}`, all = new Map(raw.map((q) => [key(q.i, q.j), q]))
  let cells: ModuleCell[] = []
  const seen = new Set<string>()
  for (const q of raw) {
    if (seen.has(key(q.i, q.j))) continue
    const comp: ModuleCell[] = [], st = [q]
    seen.add(key(q.i, q.j))
    while (st.length) {
      const o = st.pop()!
      comp.push(o)
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = key(o.i + di, o.j + dj), n = all.get(k); if (n && !seen.has(k)) { seen.add(k); st.push(n) } }
    }
    if (comp.length > cells.length) cells = comp
  }
  cells.sort((p, q) => p.j - q.j || p.i - q.i)
  const has = (i: number, j: number) => cells.some((q) => q.i === i && q.j === j)
  for (const q of cells) q.corner = (!has(q.i - 1, q.j) || !has(q.i + 1, q.j)) && (!has(q.i, q.j - 1) || !has(q.i, q.j + 1))
  // fence ring: hull of the cells + 2 m when it stays in the polygon and off the roads, else the polygon itself
  const h = size / 2 + 2, pts: [number, number][] = []
  for (const q of cells) for (const [a, b] of [[-h, -h], [h, -h], [h, h], [-h, h]]) pts.push([q.x + f.ux * a + f.vx * b, q.z + f.uz * a + f.vz * b])
  let fence = hull(pts)
  const okRing = fence.length >= 6 && edgeSamples(fence, 3).every(([x, z]) => inPoly(polygon, x, z) && !c.roads.some((r) => r.pts.length >= 4 && distLine(r.pts, x, z) < r.half + 1))
  if (!okRing) fence = polygon
  // gate: on the road side (cell with no neighbour towards -V), the one whose U is closest to the road point
  let gate = -1, gatePt: [number, number] | null = null
  if (cells.length) {
    const ru = f.road ? (f.road[0] - f.ox) * f.ux + (f.road[1] - f.oz) * f.uz : 0
    const jmin = Math.min(...cells.map((q) => q.j))
    let bd = Infinity
    cells.forEach((q, k) => {
      if (has(q.i, q.j - 1)) return
      const d = Math.abs(su + (q.i + 0.5) * size - ru) + (q.j - jmin) * size * 2
      if (d < bd) { bd = d; gate = k }
    })
    const g = cells[gate]
    let x = g.x, z = g.z
    for (let s = 0; s < 400 && inPoly(fence, x - f.vx * 0.5, z - f.vz * 0.5); s++) { x -= f.vx * 0.5; z -= f.vz * 0.5 }
    gatePt = fence === polygon ? [x + f.vx * 1.5, z + f.vz * 1.5] : [x, z]
  }
  return { frame: f, size, cells, yaw: (Math.atan2(f.vx, f.vz) * 180) / Math.PI, gate, gatePt, fence }
}

/** wall-generator fence round the polygon with a `half`*2 m gap centred on the gate point (open polyline) */
export function fenceWithGap(polygon: number[], generator: string, id: string, gx: number, gz: number, half = 4): ProjectShape {
  const ring = insetRing(polygon, 0.5), n = ring.length / 2
  let bk = 0, bd = Infinity
  for (let k = 0; k < n; k++) {
    const a = [ring[k * 2], ring[k * 2 + 1], ring[((k + 1) % n) * 2], ring[((k + 1) % n) * 2 + 1]]
    const d = distLine(a, gx, gz)
    if (d < bd) { bd = d; bk = k }
  }
  const ax = ring[bk * 2], az = ring[bk * 2 + 1], b = ((bk + 1) % n) * 2, bx = ring[b], bz = ring[b + 1]
  const Le = Math.hypot(bx - ax, bz - az) || 1, t = Math.max(0, Math.min(Le, ((gx - ax) * (bx - ax) + (gz - az) * (bz - az)) / Le))
  const ta = Math.max(0.5, t - half), tb = Math.min(Le - 0.5, t + half)
  const P = (s: number) => [ax + ((bx - ax) * s) / Le, az + ((bz - az) * s) / Le]
  const pts = [...P(tb)]
  for (let s = 1; s <= n; s++) { const k = (bk + s) % n; pts.push(ring[k * 2], ring[k * 2 + 1]) }
  pts.push(...P(ta))
  return wallShape(id, fencePosts(pts, false), generator, false)
}

// ---- prefabs --------------------------------------------------------------------------------------
export type Faction = 'US' | 'USSR' | 'FIA'
export const FACTIONS: Faction[] = ['US', 'USSR', 'FIA']
const P = (g: string, p: string) => `{${g}}Prefabs/${p}.et`
export const CAMP_PREFABS: Record<Faction, { wall: string; tent: string; tentW: number; tentD: number; tents: number; hq: string; net: string; netLarge: string; cover: string; crates: string[]; antenna: string; tower: string; heli: string }> = {
  US: {
    wall: P('8A673D57F92669B2', 'WEGenerators/Walls/Net/WG_NetFence_01_Green'),
    tent: P('01AE5FD77A9A4C21', 'Structures/Military/Camps/TentSmallUS_01/TentSmallUS_01'), tentW: 3, tentD: 4, tents: 4,
    hq: P('6A30882656A63268', 'Structures/Military/CamoNets/US/CamoNet_Tent_US'),
    net: P('B89C671B75B43849', 'Structures/Military/CamoNets/US/CamoNet_Medium_US'),
    netLarge: P('CD8641F8E583489F', 'Structures/Military/CamoNets/US/CamoNet_Large_US'),
    cover: P('FA9066DE33E8E67D', 'Structures/Military/Camps/Canvas_Covers/US/CanvasCover_Large_US'),
    crates: [P('E25E6578ED58CEF3', 'Props/Military/AmmoBoxes/EquipmentBoxStack/US/EquipmentBoxStack_US_01_V1'), P('8E0A5198519C41DD', 'Props/Military/AmmoBoxes/EquipmentBoxStack/US/EquipmentBoxStack_US_01_V2'), P('6B961D615D79D6B6', 'Props/Military/AmmoBoxes/EquipmentBoxStack/US/EquipmentBoxStack_US_01_V3')],
    antenna: P('B4F2701CBBE49C48', 'Props/Military/Antennas/Antenna_RC292_01'),
    tower: P('FBCE1861B987EA68', 'Structures/Military/Houses/GuardTower_01/GuardTower_01'),
    heli: P('CF1FFB7BAA1A0769', 'Structures/Military/Camps/HelipadImprovised_01/HelipadImprovised_US_01'),
  },
  USSR: {
    wall: P('CA5FA41E2FC5DDA1', 'WEGenerators/Walls/Net/WG_NetFence_USSR_01'),
    tent: P('4E331E7D8DAD1EAD', 'Structures/Military/Camps/TentUSSR_01/TentUSSR_01'), tentW: 5, tentD: 8, tents: 2,
    hq: P('A817454D4372DBCA', 'Structures/Military/CamoNets/Soviet/CamoNet_Tent_Soviet'),
    net: P('B90CA0BEF3CC1D19', 'Structures/Military/CamoNets/Soviet/CamoNet_Medium_Soviet'),
    netLarge: P('A700AD9077074654', 'Structures/Military/CamoNets/Soviet/CamoNet_Large_Soviet'),
    cover: P('FCCB91AC2A242FE5', 'Structures/Military/Camps/Canvas_Covers/Soviet/CanvasCover_Large_Soviet'),
    crates: [P('65CD3EE14677E3AA', 'Props/Military/AmmoBoxes/EquipmentBoxStack/USSR/EquipmentBoxStack_USSR_01_V1'), P('09990A01FAB36C84', 'Props/Military/AmmoBoxes/EquipmentBoxStack/USSR/EquipmentBoxStack_USSR_01_V2'), P('EC0546F8F656FBEF', 'Props/Military/AmmoBoxes/EquipmentBoxStack/USSR/EquipmentBoxStack_USSR_01_V3')],
    antenna: P('5B8922E61D8DF345', 'Props/Military/Antennas/Antenna_R161_01'),
    tower: P('52D3F2118C1B68E0', 'Structures/Military/Houses/GuardTower_USSR_01/GuardTower_USSR_01_green'),
    heli: P('8CDB9C117669AF4A', 'Structures/Military/Camps/HelipadImprovised_01/HelipadImprovised_USSR_01'),
  },
  FIA: {
    wall: P('8F597EE22331F6D3', 'WEGenerators/Walls/Wooden/WG_WoodenRural_01'),
    tent: P('4A1E3B17DB672E35', 'Structures/Military/Camps/TentFIA_01/TentFIA_01'), tentW: 6, tentD: 9, tents: 2,
    hq: P('F287B6C31BFC28AA', 'Structures/Military/CamoNets/FIA/CamoNet_Tent_FIA_01_V1'),
    net: P('7A4078C035F198C1', 'Structures/Military/CamoNets/FIA/CamoNet_Medium_FIA_01_V1'),
    netLarge: P('BA80DD7144145924', 'Structures/Military/CamoNets/FIA/CamoNet_Large_FIA_01_V1'),
    cover: P('3582FEEA4BD89C81', 'Structures/Military/Camps/Canvas_Covers/FIA/CanvasCover_Medium_FIA'),
    crates: [P('CEA6C2073B3DB240', 'Props/Military/AmmoBoxes/EquipmentBoxStack/FIA/EquipmentBoxStack_FIA_01_V1'), P('A2F2F6E787F93D6E', 'Props/Military/AmmoBoxes/EquipmentBoxStack/FIA/EquipmentBoxStack_FIA_01_V2'), P('476EBA1E8B1CAA05', 'Props/Military/AmmoBoxes/EquipmentBoxStack/FIA/EquipmentBoxStack_FIA_01_V3')],
    antenna: P('DD49716491710760', 'Props/Military/Compositions/FIA/Antenna_01_FIA'),
    tower: P('FBCE1861B987EA68', 'Structures/Military/Houses/GuardTower_01/GuardTower_01'),
    heli: P('CF1FFB7BAA1A0769', 'Structures/Military/Camps/HelipadImprovised_01/HelipadImprovised_US_01'),
  },
}
export const MOD_PREFABS = {
  barGate: P('07F043DD6AACCD0B', 'Structures/Infrastructure/Barriers/BarGate_01/BarGate_01'),
  sandbagLong: P('21D83950DF36F250', 'Props/Military/Sandbags/Sandbag_01_long_burlap'),
  sandbagWall: P('CD67070EFAFC28C7', 'Props/Military/Sandbags/Sandbag_01_wall_burlap'),
  flag: P('1A8791C2BC2B8B75', 'Structures/Military/Flags/FlagPole_01/FlagPole_01_empty'),
  dirtTracks: P('5AA67DAA2FB46434', 'WEGenerators/Decals/Dirt/RG_Dirt_Tracks_01'),
  metalWall: '{191C938B76395B29}PrefabLibrary/DefaultLibrary/Generators/Walls/Metal/WG_MetalWall_01.et',
  oil: '{BD7194E89FF448BA}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_OilStain_01_large.et',
  dirt: P('4932978A48FA10B0', 'Decals/Dirt/Decal_Dirt_Patch_05'),
  wrecks: ['{002B8C09F0E7E371}Prefabs/Props/Wrecks/S1203_wreck/S1203_wreck_static.et', '{1A1CE09F7BCA6650}Prefabs/Props/Wrecks/S105_wreck/S105_wreck_static.et', '{44277710A8E45F97}Prefabs/Props/Wrecks/UAZ469_wreck/UAZ469_wreck_rusty_static.et', '{56FFF0C990358ED2}Prefabs/Props/Wrecks/UAZ452_wreck/UAZ452_wreck_static.et', '{3386EAA823BE462E}Prefabs/Props/Wrecks/UAZ469_wreck/UAZ469_wreck_static.et'],
  bigWrecks: ['{AE300E34EA8FF40C}Prefabs/Props/Wrecks/Ural4320_wreck/Ural4320_wreck_static.et', '{6BE5C753730DBFED}Prefabs/Props/Wrecks/M923A1_wreck/M923A1_wreck_static.et'],
  shed: P('B15E04A8710481BD', 'Structures/Agriculture/ShedMetal_04/ShedMetal_E_04'),
  office: P('F08D8E78433D713A', 'Structures/Houses/Shed/Shed_01/Shed_01'),
  bin: P('72E42BEAFED9B5A7', 'Props/Garbage/Bins/GarbageContainer_01'),
  tireMed: P('3F0D0593590519DA', 'Props/Garbage/Tires/TirePile_01_medium'),
  tireSmall: P('CEA239D9E1899899', 'Props/Garbage/Tires/TirePile_01_small'),
  tireTractor: P('6929659CE9375CAF', 'Props/Garbage/Tires/TireTractor_01_single'),
  garbage: [P('D5062960B7211EB4', 'Props/Construction/GarbageStack_01/GarbageStack_01_Long'), P('A240B5FCD17D5686', 'Props/Construction/GarbageStack_01/GarbageStack_01_Medium')],
  farmWrecks: [P('DE59CB05202006E8', 'Props/Agriculture/CultivatorWreck_01'), P('A98BA618430E9BAA', 'Props/Agriculture/PlowWreck_01')],
  container: P('17ADCDC2721AC2E7', 'Props/Construction/ContainerMetal_01/ContainerMetal_01_low_grey'),
  craneCabin: P('D64EDF0C93A27B62', 'Props/Industrial/CrawlerCraneWreck_01/CrawlerCraneWreck_01_cabin_rusty'),
} as const

// ---- shared dressing helpers ---------------------------------------------------------------------
export interface ModuleOut {
  entities: ProjectEntity[]; shapes: ProjectShape[]; boxes: { corners: number[]; role: string; h?: number }[]; plat: Platform[]; warnings: string[]
  yaw: number; plan: { cell: ModuleCell; label: string }[]; gate: [number, number] | null
}
export interface ModuleCtx extends GridCtx { id: string; seed: number; faction?: Faction }

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}
const sat = (a: number[], b: number[]) => {
  for (const p of [a, b]) for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8, nx = -(p[j + 1] - p[i + 1]), nz = p[j] - p[i]
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (let k = 0; k < 8; k += 2) { const s = a[k] * nx + a[k + 1] * nz; a0 = Math.min(a0, s); a1 = Math.max(a1, s) }
    for (let k = 0; k < 8; k += 2) { const s = b[k] * nx + b[k + 1] * nz; b0 = Math.min(b0, s); b1 = Math.max(b1, s) }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false
  }
  return true
}
/** do two oriented rectangles (rectAt corners) overlap */
export const rectsOverlap = sat

function dresser(polygon: number[], g: CellGrid, c: ModuleCtx) {
  const out: ModuleOut = { entities: [], shapes: [], boxes: [], plat: [], warnings: [], yaw: Math.round(g.yaw), plan: [], gate: g.gatePt }
  const solid: number[][] = [], f = g.frame
  const ent = (prefab: string, x: number, z: number, yaw: number) => { out.entities.push({ id: `${c.id}_${out.entities.length + 1}`, prefab, x: round(x), z: round(z), yaw: round(((yaw % 360) + 360) % 360) }) }
  /** world point of cell-local (lu along U, lv along V) */
  const L = (cell: ModuleCell, lu: number, lv: number): [number, number] => [cell.x + f.ux * lu + f.vx * lv, cell.z + f.uz * lu + f.vz * lv]
  /** solid prop: skipped when it would leave the polygon or overlap another solid prop */
  const prop = (prefab: string, x: number, z: number, yaw: number, w: number, d: number, h: number, role = 'prop', real = true) => {
    const r = real ? prefabDims(prefab) : null
    if (r && r.w > 0 && r.dz > 0 && Math.max(r.w, r.dz) <= g.size + 2) { w = r.w; d = r.dz; h = r.h || h }
    const cn = rectAt(x, z, yaw, w, d)
    for (let i = 0; i < 8; i += 2) if (!inPoly(polygon, cn[i], cn[i + 1])) return false
    if (solid.some((s) => sat(s, cn))) return false
    solid.push(cn); ent(prefab, x, z, yaw); out.boxes.push({ corners: cn, role, h })
    return true
  }
  /** flatten a module footprint when the ground under it is not level (as the industrial zones do) */
  const level = (cell: ModuleCell, w: number, d: number) => {
    if (!c.ground) return
    const cn = rectAt(cell.x, cell.z, g.yaw, w, d), hs = [0, 2, 4, 6].map((i) => c.ground!(cn[i], cn[i + 1]))
    if (Math.max(...hs) - Math.min(...hs) < 0.4) return
    out.plat.push({ kind: 'platform', polygon: cn.map(round), height: round(hs.reduce((a, b) => a + b, 0) / 4), falloff: 6, slope: 0 })
  }
  return { out, ent, prop, L, level }
}
/** lane cells: the gate column (contiguous from the gate) + the middle cross row; returns their indices */
function lanes(g: CellGrid, every = 0): Set<number> {
  const s = new Set<number>()
  if (g.gate < 0) return s
  const gc = g.cells[g.gate], at = new Map(g.cells.map((q, k) => [`${q.i},${q.j}`, k]))
  // the whole gate column, across holes (a cell dropped for slope / water / a road must not cut the lane short)
  const jMax = Math.max(...g.cells.filter((q) => q.i === gc.i).map((q) => q.j))
  for (let j = gc.j; j <= jMax; j++) { const k = at.get(`${gc.i},${j}`); if (k !== undefined) s.add(k) }
  const js = [...s].map((k) => g.cells[k].j)
  // cross lanes: the middle row, or every `every` rows from the gate
  const rows = every ? js.filter((j) => j > gc.j && (j - gc.j) % every === every - 1) : js.length >= 3 ? [js[Math.floor(js.length / 2)]] : []
  const iMin = Math.min(...g.cells.map((q) => q.i)), iMax = Math.max(...g.cells.map((q) => q.i))
  for (const r of rows) for (let i = iMin; i <= iMax; i++) { const k = at.get(`${i},${r}`); if (k !== undefined) s.add(k) }
  return s
}
const cheb = (a: ModuleCell, b: ModuleCell) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j))
const adj4 = (cells: ModuleCell[], k: number, set: Set<number>) => [...set].some((q) => Math.abs(cells[q].i - cells[k].i) + Math.abs(cells[q].j - cells[k].j) === 1)
/** dirt-track spline + flat lane boxes over the lane cells */
function drawLanes(g: CellGrid, lane: Set<number>, o: ModuleOut, id: string, roads: RoadLine[]) {
  const f = g.frame, cs = [...lane].map((k) => g.cells[k])
  const gc = g.cells[g.gate]
  const col = cs.filter((q) => q.i === gc.i).sort((a, b) => a.j - b.j)
  const row = cs.filter((q) => q.j !== gc.j || q.i !== gc.i).filter((q) => q.i !== gc.i).sort((a, b) => a.i - b.i)
  if (g.gatePt) {
    // access track from the gate to the nearest road (when close)
    let best: [number, number] | null = null, bd = 80
    for (const r of roads) if (r.pts.length >= 4) { const n = nearestPoint(r.pts, g.gatePt[0], g.gatePt[1]); if (n[2] < bd) { bd = n[2]; best = [n[0], n[1]] } }
    if (best && bd > 3) o.shapes.push({ id: `${id}_access`, kind: 'spline', closed: false, points: [...best, ...g.gatePt].map(round), generator: MOD_PREFABS.dirtTracks })
  }
  if (g.gatePt) o.shapes.push({ id: `${id}_lane`, kind: 'spline', closed: false, points: [...g.gatePt, ...col.flatMap((q) => [q.x, q.z])].map(round), generator: MOD_PREFABS.dirtTracks })
  for (const j of [...new Set(row.map((q) => q.j))]) {
    const rq = row.filter((q) => q.j === j), left = rq.filter((q) => q.i < gc.i), right = rq.filter((q) => q.i > gc.i)
    const hub = col.find((q) => q.j === j)
    const pts = [...left, ...(hub ? [hub] : []), ...right].flatMap((q) => [q.x, q.z])
    if (pts.length >= 4) o.shapes.push({ id: `${id}_cross${j}`, kind: 'spline', closed: false, points: pts.map(round), generator: MOD_PREFABS.dirtTracks })
  }
  for (const q of col) o.boxes.push({ corners: rectAt(q.x, q.z, g.yaw, g.size * 0.5, g.size), role: 'pave', h: 0.05 })
  // holes in the gate column (dropped cell): the lane runs on through them
  for (let k = 1; k < col.length; k++) {
    const a = col[k - 1], b = col[k], n = b.j - a.j
    for (let t = 1; t < n; t++) o.boxes.push({ corners: rectAt(a.x + ((b.x - a.x) * t) / n, a.z + ((b.z - a.z) * t) / n, g.yaw, g.size * 0.5, g.size), role: 'pave', h: 0.05 })
  }
  for (const q of row) o.boxes.push({ corners: rectAt(q.x, q.z, g.yaw, g.size, g.size * 0.5), role: 'pave', h: 0.05 })
  void f
}

// ---- military camp --------------------------------------------------------------------------------
export const CAMP_LABELS = ['lane', 'tent', 'hq', 'motor', 'ammo', 'tower', 'heli', 'empty'] as const
export function makeCamp(polygon: number[], c: ModuleCtx): ModuleOut {
  const fac = c.faction ?? 'US', F = CAMP_PREFABS[fac], rand = rng(c.seed * 31 + FACTIONS.indexOf(fac) * 7 + 5)
  const g = cellGrid(polygon, 16, c)
  const { out, prop, L, level, ent } = dresser(polygon, g, c)
  if (g.cells.length < 4 || g.gate < 0) { out.warnings.push('camp: zone too small / too steep (needs 4 cells of 16 m)'); return out }
  const cells = g.cells, n = cells.length, Lb = CAMP_LABELS as readonly string[], I = (s: string) => Lb.indexOf(s)
  const lane = lanes(g), fixed = new Map<number, number>()
  for (const k of lane) fixed.set(k, I('lane'))
  const gc = cells[g.gate], [cx, cz] = centroid(polygon)
  // helipad: 2x2 free block far from the gate when the camp is big
  let heli: number[] = []
  if (n >= 30) {
    const at = new Map(cells.map((q, k) => [`${q.i},${q.j}`, k]))
    let bd = -1
    cells.forEach((q) => {
      const ks = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => at.get(`${q.i + a},${q.j + b}`))
      if (ks.some((k) => k === undefined || lane.has(k) || cells[k].corner)) return
      const d = cheb(q, gc)
      if (d > bd) { bd = d; heli = ks as number[] }
    })
    for (const k of heli) fixed.set(k, I('heli'))
  }
  const byCentre = cells.map((q, k) => ({ k, d: Math.hypot(q.x - cx, q.z - cz) })).filter((o) => !fixed.has(o.k)).sort((a, b) => a.d - b.d)
  const central = new Set(byCentre.slice(0, Math.max(3, Math.ceil(byCentre.length * 0.25))).map((o) => o.k))
  const allow = (k: number, l: number) => {
    const q = cells[k]
    switch (Lb[l]) {
      case 'lane': case 'heli': return false
      case 'tower': return q.corner
      case 'hq': return central.has(k) && adj4(cells, k, lane) && !q.corner
      case 'motor': return cheb(q, gc) <= 1 && !q.corner
      case 'ammo': return cheb(q, gc) >= 2 && !q.corner
      case 'tent': return !q.corner || n < 8
      default: return true
    }
  }
  const free = n - fixed.size
  const sol = solveModules(cells, {
    labels: [...Lb], weight: [0, 6, 1, 2, 1, 3, 0, 0.4], allow,
    apart: [[I('ammo'), I('tent'), 1], [I('ammo'), I('hq'), 1], [I('ammo'), I('motor'), 1], [I('hq'), I('hq'), 2]],
    min: [0, 1, free >= 4 ? 1 : 0, free >= 6 ? 1 : 0, free >= 10 ? 1 : 0, 0, 0, 0],
    max: [99, 99, 1, 3, free >= 30 ? 2 : 1, 4, 99, 99],
    fixed, fallback: I('empty'),
  }, rand)
  if (sol.relaxed) out.warnings.push('camp: not every module fits (rules relaxed)')
  out.plan = cells.map((cell, k) => ({ cell, label: Lb[sol.label[k]] }))
  // perimeter + gate
  const gp = g.gatePt!
  out.shapes.push(fenceWithGap(g.fence, F.wall, `${c.id}_wall`, gp[0], gp[1], 4))
  prop(MOD_PREFABS.barGate, gp[0], gp[1], g.yaw, 7, 0.6, 1.2, 'gate')
  for (const s of [-1, 1]) prop(MOD_PREFABS.sandbagLong, gp[0] + g.frame.ux * s * 5.5 + g.frame.vx * 1.2, gp[1] + g.frame.uz * s * 5.5 + g.frame.vz * 1.2, g.yaw, 2.6, 1, 1)
  drawLanes(g, lane, out, c.id, c.roads)
  let heliDone = false
  cells.forEach((q, k) => {
    const lab = Lb[sol.label[k]], Y = g.yaw
    if (lab === 'tent') {
      // real tent size when known: as many as fit the cell (2x2 small US tents, 1-2 big ones)
      const td = prefabDims(F.tent), tw = td?.w || F.tentW, tdd = td?.dz || F.tentD
      const cols = Math.max(1, Math.min(2, Math.floor((g.size + 1.5) / (tw + 2.5)))), rows = F.tents === 4 && 2 * tdd + 1.5 <= g.size ? 2 : 1
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const lu = (a - (cols - 1) / 2) * (tw + 2.5), lv = rows > 1 ? (b - 0.5) * (tdd + 1.5) : 0
        const [x, z] = L(q, lu, lv)
        prop(F.tent, x, z, Y, F.tentW, F.tentD, 3, 'barracks')
      }
    } else if (lab === 'hq') {
      level(q, 14, 14)
      const [x, z] = L(q, 0, 1.5); prop(F.hq, x, z, Y, 8, 10, 4, 'main')
      const [ax, az] = L(q, -5.8, -6); prop(F.antenna, ax, az, Y, 1, 1, 8, 'tower', false) // bbox = guy wires: keep the mast
      const [fx, fz] = L(q, 5.8, -6); prop(MOD_PREFABS.flag, fx, fz, Y, 0.6, 0.6, 8, 'lamp')
    } else if (lab === 'motor') {
      level(q, 15, 15)
      out.boxes.push({ corners: rectAt(q.x, q.z, Y, 15, 15), role: 'pave', h: 0.05 })
      const [x, z] = L(q, 0, 0.5); prop(F.cover, x, z, Y, 10, 14, 4, 'hangar')
      ent(MOD_PREFABS.oil, ...L(q, -2, -2), rand() * 360)
    } else if (lab === 'ammo') {
      const [x, z] = L(q, 0, 0); ent(F.net, x, z, Y) // camo net over the crates (no collision box: crates go under it)
      out.boxes.push({ corners: rectAt(x, z, Y, 10, 10), role: 'roof', h: 3 })
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 0; b++) { const [px, pz] = L(q, a * 2.6, b * 2.6 + 1.3); prop(F.crates[(a + b + 3) % 3], px, pz, Y + (rand() - 0.5) * 6, 1.6, 1.2, 1.2, 'crate') }
      for (const s of [-1, 1]) { const [px, pz] = L(q, s * 6.5, 0); prop(MOD_PREFABS.sandbagWall, px, pz, Y, 1, 3, 1.2) }
    } else if (lab === 'tower') {
      // outer corner of the cell: the side(s) with no neighbour
      const has = (di: number, dj: number) => cells.some((o) => o.i === q.i + di && o.j === q.j + dj)
      const su = has(-1, 0) ? 1 : -1, sv = has(0, -1) ? 1 : -1
      const td = prefabDims(F.tower), off = td ? Math.max(0, g.size / 2 - 0.5 - (td.w + td.dz) / (2 * Math.SQRT2)) : 4.5 // 45 deg: keep the real bbox in the cell
      const [x, z] = L(q, su * off, sv * off); prop(F.tower, x, z, Y + (su < 0 ? -45 : 45) + (sv < 0 ? 180 : 0), 5, 5, 8, 'tower')
    } else if (lab === 'heli' && !heliDone) {
      heliDone = true
      const hx = heli.reduce((a, h) => a + cells[h].x, 0) / 4, hz = heli.reduce((a, h) => a + cells[h].z, 0) / 4
      const cn = rectAt(hx, hz, Y, 30, 30), hs = c.ground ? [0, 2, 4, 6].map((i) => c.ground!(cn[i], cn[i + 1])) : []
      if (hs.length && Math.max(...hs) - Math.min(...hs) > 0.4) out.plat.push({ kind: 'platform', polygon: cn.map(round), height: round(hs.reduce((a, b) => a + b, 0) / 4), falloff: 8, slope: 0 })
      prop(F.heli, hx, hz, Y, 20, 20, 0.2, 'pave')
    }
  })
  return out
}

// ---- scrapyard ------------------------------------------------------------------------------------
export const YARD_LABELS = ['lane', 'wrecks', 'shed', 'office', 'tyres', 'scrap', 'empty'] as const
export function makeJunkyard(polygon: number[], c: ModuleCtx): ModuleOut {
  const rand = rng(c.seed * 17 + 11)
  const g = cellGrid(polygon, 12, c)
  const { out, prop, L, level, ent } = dresser(polygon, g, c)
  if (g.cells.length < 3 || g.gate < 0) { out.warnings.push('junkyard: zone too small / too steep (needs 3 cells of 12 m)'); return out }
  const cells = g.cells, Lb = YARD_LABELS as readonly string[], I = (s: string) => Lb.indexOf(s)
  const lane = lanes(g, 4), fixed = new Map<number, number>()
  for (const k of lane) fixed.set(k, I('lane'))
  const gc = cells[g.gate], free = cells.length - fixed.size
  const allow = (k: number, l: number) => {
    const q = cells[k]
    switch (Lb[l]) {
      case 'lane': return false
      case 'office': return cheb(q, gc) <= 1
      case 'shed': return adj4(cells, k, lane) && cheb(q, gc) >= 2
      default: return true
    }
  }
  const sol = solveModules(cells, {
    labels: [...Lb], weight: [0, 6, 1, 1, 1.5, 1.5, 0.3], allow,
    apart: [[I('tyres'), I('office'), 1], [I('shed'), I('shed'), 2]],
    min: [0, 1, free >= 5 ? 1 : 0, free >= 3 ? 1 : 0, 0, 0, 0],
    max: [99, 99, free >= 30 ? 2 : 1, 1, Math.max(1, Math.floor(free / 6)), Math.max(1, Math.floor(free / 5)), 99],
    fixed, fallback: I('empty'),
  }, rand)
  if (sol.relaxed) out.warnings.push('junkyard: not every module fits (rules relaxed)')
  out.plan = cells.map((cell, k) => ({ cell, label: Lb[sol.label[k]] }))
  const gp = g.gatePt!
  out.shapes.push(fenceWithGap(g.fence, MOD_PREFABS.metalWall, `${c.id}_wall`, gp[0], gp[1], 4))
  drawLanes(g, lane, out, c.id, c.roads)
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]
  cells.forEach((q, k) => {
    const lab = Lb[sol.label[k]], Y = g.yaw
    if (lab === 'lane') { if (rand() < 0.5) ent(MOD_PREFABS.oil, ...L(q, (rand() - 0.5) * 3, (rand() - 0.5) * 8), rand() * 360) }
    else if (lab === 'wrecks') {
      // two rows of three wrecks, nose to the lane-side; some trucks
      for (const lv of [-3.2, 3.2]) for (const lu of [-4, 0, 4]) {
        if (rand() < 0.15) continue
        const [x, z] = L(q, lu + (rand() - 0.5) * 0.4, lv + (rand() - 0.5) * 0.4)
        prop(pick(MOD_PREFABS.wrecks), x, z, Y + (rand() < 0.5 ? 0 : 180) + (rand() - 0.5) * 10, 2, 4.6, 1.6, 'wreck')
      }
    } else if (lab === 'shed') {
      level(q, 11, 11)
      const [x, z] = L(q, 0, 0); prop(MOD_PREFABS.shed, x, z, Y, 8, 10, 5, 'main')
      ent(MOD_PREFABS.oil, ...L(q, 1, -1), rand() * 360)
    } else if (lab === 'office') {
      level(q, 8, 8)
      const [x, z] = L(q, -2, 1); prop(MOD_PREFABS.office, x, z, Y, 4, 5, 3, 'main')
      const [bx, bz] = L(q, 3.2, -2); prop(MOD_PREFABS.bin, bx, bz, Y, 2, 1.4, 1.4)
    } else if (lab === 'tyres') {
      for (const [lu, lv, p] of [[-3, -3, MOD_PREFABS.tireMed], [3, 2, MOD_PREFABS.tireMed], [3, -3.5, MOD_PREFABS.tireSmall], [-3.5, 3, MOD_PREFABS.tireSmall], [0, 0, MOD_PREFABS.tireTractor]] as const) {
        const [x, z] = L(q, lu, lv); prop(p, x, z, rand() * 360, 2.6, 2.6, 1.2, 'scrap')
      }
    } else if (lab === 'scrap') {
      const [x, z] = L(q, 0, -3); prop(pick(MOD_PREFABS.garbage), x, z, Y + 90, 6, 2.5, 1.5, 'scrap')
      const [x2, z2] = L(q, -2.5, 2.5); prop(pick(MOD_PREFABS.farmWrecks), x2, z2, rand() * 360, 3, 3, 1.5, 'scrap')
      const [x3, z3] = L(q, 3, 2.5); if (rand() < 0.5) prop(MOD_PREFABS.container, x3, z3, Y, 2.6, 6, 1.4, 'scrap'); else prop(MOD_PREFABS.craneCabin, x3, z3, Y, 2.6, 4, 2.4, 'scrap')
    } else if (rand() < 0.6) ent(MOD_PREFABS.dirt, q.x, q.z, rand() * 360)
  })
  return out
}

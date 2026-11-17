// Zone tool, structured "site" zones: pasture, parking, cemetery, hunting stands, orchard, vineyard,
// junkyard, road checkpoint. Each fills the drawn polygon with prefabs in rows / grids (rowgrid.ts),
// a wall-generator fence on the border and base-game decals, and comes back as one ZoneItem (kind
// 'site') so the map, the 3D view, the save and the Workbench export handle it like the other zones.
// Every prefab ref below was resolved against the base game resourceDatabase.rdb (no invented GUID).

import { ZONE_AVOID, type ProjectEntity, type ProjectShape } from '../project'
import type { ZoneItem } from './zones'
import { FENCES, VEG } from '../data/biomes'
import { round } from './gen-common'
import { prefabDims } from '../library/dims.ts'
import { makeCamp, makeJunkyard, type Faction, type ModuleOut } from './modules'
import type { FlattenRequest as Platform } from './industrial'
import { makeBeach, makeCemetery, makeConstruction, type ExtraOut } from './sitesextra'
import { centroid, contourFrame, fencePerimeter, frameOf, inPoly, nearestPoint, polyArea, rectAt, rowGrid, slopeAt, type RoadLine } from './rowgrid'

export type SiteType = 'pasture' | 'parking' | 'cemetery' | 'hunting' | 'orchard' | 'vineyard' | 'junkyard' | 'checkpoint' | 'camp' | 'construction' | 'beach'
export const SITE_TYPES: SiteType[] = ['pasture', 'parking', 'cemetery', 'hunting', 'orchard', 'vineyard', 'junkyard', 'checkpoint', 'camp', 'construction', 'beach']
export const SITE_MAX_SLOPE: Record<SiteType, number> = { pasture: 0.15, parking: 0.08, cemetery: 0.12, hunting: 0.35, orchard: 0.35, vineyard: 0.4, junkyard: 0.15, checkpoint: 0.2, camp: 0.15, construction: 0.15, beach: 0.5 }
/** Zone-tool priority (zonefill.ts ZONE_PRIORITY): fenced sites cut fields / forests like housing; stands and checkpoints cut nothing */
export const SITE_PRIORITY: Record<SiteType, number> = { pasture: 2, parking: 2, cemetery: 2, hunting: 6, orchard: 2, vineyard: 2, junkyard: 2, checkpoint: 6, camp: 2, construction: 2, beach: 2 }

export const SITE_PREFABS = {
  hayBale: '{6A8D0F8B78685E0A}Prefabs/Props/Agriculture/Farm/HayBale_01.et',
  hayBaleSq: '{C959D3CF939EBBB3}Prefabs/Props/Agriculture/Farm/HayBale_01_square_small.et',
  hayPile: '{E537DCDB9B3F2278}Prefabs/Props/Agriculture/Farm/HayPile_01.et',
  cowShed: '{4E0845B85F4535D8}Prefabs/Structures/Agriculture/CowShed/CowShed_E_01/CowShed_E_01_short.et',
  pastureFG: '{1D9EB8BDA97F3A25}Prefabs/WEGenerators/Brushland/FG_Brushland_Pastures_01.et',
  lamp: '{0E3533EE196F01EC}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_01/LampStreet_E_01_6m.et',
  crashBarrier: '{3058725A52981080}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_E_01.et',
  metalWall: '{191C938B76395B29}PrefabLibrary/DefaultLibrary/Generators/Walls/Metal/WG_MetalWall_01.et',
  deerStand: '{D0947E26A8A39ECF}Prefabs/Structures/Forest/DeerStands/DeerStand_01.et',
  // decals
  stripe: '{1D47DB14DEFCF6A0}Prefabs/Decals/Markings/Decal_RoadStripe_Full_01.et',
  crossWalk: '{7F5B851062D38849}Prefabs/Decals/Markings/Decal_CrossWalk_01.et',
  aisleLine: '{64D8305E29E4990B}Prefabs/WEGenerators/Decals/Runway/RG_Runway_Line20_01.et', // native decal-along-spline
  asphaltStripe: '{0F9BCCF948B130C8}Prefabs/WEGenerators/Decals/Asphalt/RG_Asphalt_Patch_Stripe_01.et',
  dirtTracks: '{5AA67DAA2FB46434}Prefabs/WEGenerators/Decals/Dirt/RG_Dirt_Tracks_01.et',
  cracks: ['{0B6336953A280DC2}Prefabs/Decals/Asphalt/Decal_Asphalt_Cracks_01.et', '{77C91FAB81C2F906}Prefabs/Decals/Asphalt/Decal_Asphalt_Cracks_02.et', '{925553528D276E6D}Prefabs/Decals/Asphalt/Decal_Asphalt_Cracks_03.et'],
  oil: ['{E0A677D469189266}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_OilStain_01_small.et', '{A98D90FCA8DFB543}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_OilStain_01_medium.et', '{BD7194E89FF448BA}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_OilStain_01_large.et', '{05376BFA97E95AC4}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_PetrolStain_01_V1.et', '{69635F1A2B2DD5EA}PrefabLibrary/DefaultLibrary/Decals/Stains/Decal_PetrolStain_01_V2.et'],
  dirt: ['{ACAEDB73441F87DB}Prefabs/Decals/Dirt/Decal_Dirt_Patch_04.et', '{4932978A48FA10B0}Prefabs/Decals/Dirt/Decal_Dirt_Patch_05.et', '{2566A36AF43E9F9E}Prefabs/Decals/Dirt/Decal_Dirt_Patch_06.et', '{C0FAEF93F8DB08F5}Prefabs/Decals/Dirt/Decal_Dirt_Patch_07.et'],
  graves: ['{90582DA173C00605}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_01_A.et', '{FC0C1941CF04892B}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_01_B.et', '{199055B8C3E11E40}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_01_C.et', '{24A47080B68D9777}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_01_D.et', '{CEB004E2CC4D880A}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_02_A.et', '{A2E4300270890724}Prefabs/Structures/Cultural/Cemeteries/Tombstones/GraveStone_E_02_B.et'],
  cars: ['{002B8C09F0E7E371}Prefabs/Props/Wrecks/S1203_wreck/S1203_wreck_static.et', '{1A1CE09F7BCA6650}Prefabs/Props/Wrecks/S105_wreck/S105_wreck_static.et', '{3386EAA823BE462E}Prefabs/Props/Wrecks/UAZ469_wreck/UAZ469_wreck_static.et', '{18D107DB09E20A36}Prefabs/Props/Wrecks/UAZ469_wreck/UAZ469_wreck_blue_static.et', '{56FFF0C990358ED2}Prefabs/Props/Wrecks/UAZ452_wreck/UAZ452_wreck_static.et'],
  wrecks: ['{002B8C09F0E7E371}Prefabs/Props/Wrecks/S1203_wreck/S1203_wreck_static.et', '{1A1CE09F7BCA6650}Prefabs/Props/Wrecks/S105_wreck/S105_wreck_static.et', '{44277710A8E45F97}Prefabs/Props/Wrecks/UAZ469_wreck/UAZ469_wreck_rusty_static.et', '{56FFF0C990358ED2}Prefabs/Props/Wrecks/UAZ452_wreck/UAZ452_wreck_static.et', '{AE300E34EA8FF40C}Prefabs/Props/Wrecks/Ural4320_wreck/Ural4320_wreck_static.et', '{6BE5C753730DBFED}Prefabs/Props/Wrecks/M923A1_wreck/M923A1_wreck_static.et', '{F9B96527E16549AB}Prefabs/Props/Wrecks/M998_wreck/M998_wreck_static.et'],
  checkpoint: {
    S: ['{E660DE914A7211EB}Prefabs/Compositions/Slotted/SlotRoadSmall/Checkpoint_S_US_01.et', '{9483333BFD9E2D0F}Prefabs/Compositions/Slotted/SlotRoadSmall/Checkpoint_S_USSR_01.et'],
    M: ['{55D508179EF5E64A}Prefabs/Compositions/Slotted/SlotRoadMedium/Checkpoint_M_US_01.et', '{7C85836D444E3797}Prefabs/Compositions/Slotted/SlotRoadMedium/Checkpoint_M_USSR_01.et'],
    L: ['{E74D2F51CD4F03D0}Prefabs/Compositions/Slotted/SlotRoadLarge/Checkpoint_L_US_01.et', '{9F9924B626C5FA2C}Prefabs/Compositions/Slotted/SlotRoadLarge/Checkpoint_L_USSR_01.et'],
  },
} as const

export interface SiteContext {
  id: string // SITE_1 ...
  seed: number
  roads: RoadLine[]
  ground?: (x: number, z: number) => number
  ok?: (x: number, z: number) => boolean // land, out of water / buildings
  forests?: number[][] // forest rings (hunting stands)
  vine?: boolean // orchard zone in vine mode (kept for the 'vineyard' type)
  faction?: Faction // military camp side (US / USSR / FIA)
  rivers?: number[][] // open water centre lines (module sites keep off them)
  water?: (x: number, z: number) => boolean // sea / lake test (beach)
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

export function makeSiteZone(type: SiteType, polygon: number[], c: SiteContext): ZoneItem {
  const rand = rng(c.seed + SITE_TYPES.indexOf(type) * 977)
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]
  const ents: ProjectEntity[] = [], shapes: ProjectShape[] = [], boxes: { corners: number[]; role: string; h?: number }[] = [], warnings: string[] = []
  const ent = (prefab: string, x: number, z: number, yaw: number) => { ents.push({ id: `${c.id}_${ents.length + 1}`, prefab, x: round(x), z: round(z), yaw: round(((yaw % 360) + 360) % 360) }) }
  const prop = (prefab: string, x: number, z: number, yaw: number, w: number, d: number, h: number, role = 'prop') => {
    const r = prefabDims(prefab) // real bbox when known (catalogue dims), the estimate otherwise
    if (r && r.w > 0 && r.dz > 0 && role !== 'grave') { w = r.w; d = r.dz; h = r.h || h }
    ent(prefab, x, z, yaw); boxes.push({ corners: rectAt(x, z, yaw, w, d), role, h }) }
  const decal = (prefab: string, x: number, z: number, yaw: number) => ent(prefab, x, z, yaw)
  const ok = c.ok ?? (() => true)
  const [cx, cz] = centroid(polygon)
  let yawOut = 0
  const plat: Platform[] = []
  const take = (m: ModuleOut) => { ents.push(...m.entities); shapes.push(...m.shapes); boxes.push(...m.boxes); plat.push(...m.plat); warnings.push(...m.warnings); yawOut = m.yaw }

  if (type === 'pasture') {
    shapes.push(fencePerimeter(polygon, FENCES.wood1, `${c.id}_fence`))
    shapes.push({ id: `${c.id}_grass`, kind: 'polyline', closed: true, points: polygon.map(round), generator: SITE_PREFABS.pastureFG, avoid: ZONE_AVOID })
    boxes.push({ corners: polygon.slice(), role: 'pasture' })
    // a few hay-bale clusters
    const spots = rowGrid(polygon, { dx: 45, dz: 45, margin: 10, jitter: 0.6, rand, roads: c.roads, ok, ground: c.ground, maxSlope: 0.15 })
    for (const s of spots.filter(() => rand() < 0.35).slice(0, 4)) for (let k = 0; k < 3 + Math.floor(rand() * 3); k++) {
      const a = rand() * Math.PI * 2, r = 1.5 + rand() * 3
      prop(rand() < 0.7 ? SITE_PREFABS.hayBale : SITE_PREFABS.hayBaleSq, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, rand() * 360, 1.6, 1.6, 1.4)
    }
    // cow shed on the road side, parallel to the road
    const f = frameOf(polygon, c.roads)
    if (f.road) {
      const sy = (Math.atan2(f.ux, f.uz) * 180) / Math.PI
      const cs = prefabDims(SITE_PREFABS.cowShed), cw = cs?.w || 9, cd = cs?.dz || 18, ch = cs?.h || 5
      for (let d = 4 + cw / 2; d < 30 + cw; d += 4) {
        const n = nearestPoint(polygon.concat(polygon.slice(0, 2)), f.road[0], f.road[1])
        const x = n[0] + f.vx * d, z = n[1] + f.vz * d, cn = rectAt(x, z, sy, cw, cd)
        let fit = true
        for (let i = 0; i < 8; i += 2) if (!inPoly(polygon, cn[i], cn[i + 1]) || !ok(cn[i], cn[i + 1])) fit = false
        if (fit) { ent(SITE_PREFABS.cowShed, x, z, sy); boxes.push({ corners: cn, role: 'main', h: ch }); break }
      }
    }
  } else if (type === 'parking') {
    const f = frameOf(polygon, c.roads, 200)
    yawOut = (Math.atan2(f.vx, f.vz) * 180) / Math.PI
    // modules across V: bays (5 m) | aisle (6 m) | bays (5 m) | 1 m gap
    const MOD = 16, bays: { x: number; z: number; yaw: number }[] = []
    const all = rowGrid(polygon, { dx: 2.5, dz: 1, margin: 2, frame: f, roads: c.roads, ok, ground: c.ground, maxSlope: 0.08 })
    const vOf = (x: number, z: number) => (x - f.ox) * f.vx + (z - f.oz) * f.vz
    const vs = all.map((p) => vOf(p.x, p.z)), v0 = Math.min(...vs)
    for (const p of all) {
      const m = (vOf(p.x, p.z) - v0) % MOD
      if (Math.abs(m - 2) < 0.5) bays.push({ x: p.x, z: p.z, yaw: yawOut + 180 }) // first row faces the aisle (+V)
      else if (Math.abs(m - 13) < 0.5) bays.push({ x: p.x, z: p.z, yaw: yawOut })
    }
    if (!bays.length) warnings.push('parking: no bay fits')
    const uOf = (x: number, z: number) => (x - f.ox) * f.ux + (z - f.oz) * f.uz
    for (const b of bays) {
      boxes.push({ corners: rectAt(b.x, b.z, b.yaw, 2.5, 5), role: 'pave', h: 0.05 })
      // bay separator stripe (decal, 5 m long) on the left side of the bay
      decal(SITE_PREFABS.stripe, b.x - f.ux * 1.25, b.z - f.uz * 1.25, b.yaw)
      const r = rand()
      if (r < 0.35) prop(pick(SITE_PREFABS.cars), b.x, b.z, b.yaw + (rand() - 0.5) * 8, 1.8, 4.2, 1.6)
      else if (r < 0.55) decal(pick(SITE_PREFABS.oil), b.x + (rand() - 0.5), b.z + (rand() - 0.5), rand() * 360)
    }
    // aisles: asphalt stripe + lamps every 25 m, cracks
    const rows = new Map<number, { x: number; z: number }[]>()
    for (const b of bays) { const k = Math.floor((vOf(b.x, b.z) - v0) / MOD); if (!rows.has(k)) rows.set(k, []); rows.get(k)!.push(b) }
    let lamp = 0
    for (const [k, list] of rows) {
      const us = list.map((b) => uOf(b.x, b.z)), u0 = Math.min(...us), u1 = Math.max(...us), v = v0 + k * MOD + 7.5
      const P = (u: number) => [f.ox + f.ux * u + f.vx * v, f.oz + f.uz * u + f.vz * v]
      const a = P(u0 - 1), b = P(u1 + 1)
      if (u1 - u0 > 5) shapes.push({ id: `${c.id}_aisle${k}`, kind: 'spline', closed: false, points: [...a, ...b].map(round), generator: SITE_PREFABS.asphaltStripe })
      boxes.push({ corners: [...P(u0 - 1.25).map((q, i) => q - (i ? f.vz : f.vx) * 8), ...P(u1 + 1.25).map((q, i) => q - (i ? f.vz : f.vx) * 8), ...P(u1 + 1.25).map((q, i) => q + (i ? f.vz : f.vx) * 8), ...P(u0 - 1.25).map((q, i) => q + (i ? f.vz : f.vx) * 8)], role: 'pave', h: 0.05 })
      for (let u = u0; u <= u1; u += 25) { const [x, z] = P(u); if (!inPoly(polygon, x, z)) continue; prop(SITE_PREFABS.lamp, x, z, yawOut, 0.4, 0.4, 6, 'lamp'); lamp++ }
      for (let u = u0; u <= u1; u += 15) if (rand() < 0.5) { const [x, z] = P(u + rand() * 10); if (inPoly(polygon, x, z)) decal(pick(SITE_PREFABS.cracks), x, z, rand() * 360) }
    }
    if (!lamp && bays.length) warnings.push('parking: no lamp')
    shapes.push(fencePerimeter(polygon, SITE_PREFABS.crashBarrier, `${c.id}_barrier`, { openNear: f.road ? [f.road[0], f.road[1]] : undefined }))
  } else if (type === 'cemetery' || type === 'construction' || type === 'beach') {
    // sitesextra.ts: terraced cemetery with gate + chapel, construction site, beach on the shore
    const xc = { id: c.id, rand, roads: c.roads, ground: c.ground, ok, water: c.water }
    const x: ExtraOut = type === 'cemetery' ? makeCemetery(polygon, xc, SITE_PREFABS.graves) : type === 'beach' ? makeBeach(polygon, xc) : makeConstruction(polygon, xc)
    ents.push(...x.entities); shapes.push(...x.shapes); boxes.push(...x.boxes); plat.push(...x.plat); warnings.push(...x.warnings); yawOut = x.yaw
  } else if (type === 'hunting') {
    // deer stands on the forest edges inside the polygon, looking out over the open ground, >= 150 m apart
    const got: number[][] = []
    for (const ring of c.forests ?? []) {
      const n = ring.length / 2
      for (let k = 0; k < n; k++) {
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[((k + 1) % n) * 2], bz = ring[((k + 1) % n) * 2 + 1]
        const L = Math.hypot(bx - ax, bz - az)
        for (let s = 0; s < L; s += 20) {
          const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L
          if (!inPoly(polygon, x, z)) continue
          let nx = -(bz - az) / L, nz = (bx - ax) / L
          if (inPoly(ring, x + nx * 15, z + nz * 15)) { nx = -nx; nz = -nz } // outward = open ground
          if (inPoly(ring, x + nx * 15, z + nz * 15)) continue
          const px = x - nx * 3, pz = z - nz * 3 // 3 m inside the trees
          if (!ok(px, pz) || got.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 150)) continue
          if (c.ground && slopeAt(c.ground, px, pz) > 0.35) continue
          const yaw = (Math.atan2(nx, nz) * 180) / Math.PI
          prop(SITE_PREFABS.deerStand, px, pz, yaw, 2, 2, 5, 'tower')
          got.push([px, pz])
        }
      }
    }
    if (!got.length) warnings.push('hunting: no forest edge in the zone')
  } else if (type === 'orchard' || type === 'vineyard') {
    const fb = frameOf(polygon, c.roads)
    const f = c.ground ? contourFrame(polygon, c.ground, fb) : fb
    if (type === 'orchard') {
      const tree = rand() < 0.5 ? VEG.apple : VEG.plum
      for (const p of rowGrid(polygon, { dx: 6, dz: 6, margin: 3, frame: f, jitter: 0.08, rand, roads: c.roads, ok, ground: c.ground, maxSlope: 0.35 })) if (rand() < 0.93) ent(rand() < 0.8 ? tree : VEG.apple, p.x, p.z, rand() * 360)
      boxes.push({ corners: polygon.slice(), role: 'orchard' })
    } else {
      // no vine prefab in the base game: trellis rows = low rustic wooden fence lines along the contour, 2.5 m apart
      warnings.push('vineyard: no base-game vine prefab, rows use WG_WoodenRural_01 as trellis')
      const g = rowGrid(polygon, { dx: 2, dz: 2.5, margin: 3, frame: f, roads: c.roads, ok, ground: c.ground, maxSlope: 0.4 })
      const byRow = new Map<number, typeof g>()
      for (const p of g) { if (!byRow.has(p.row)) byRow.set(p.row, []); byRow.get(p.row)!.push(p) }
      for (const [r, list] of byRow) {
        list.sort((a, b) => a.col - b.col)
        let run: number[] = [], last = -9
        const flush = () => { if (run.length >= 6) shapes.push({ id: `${c.id}_row${r}_${shapes.length}`, kind: 'polyline', closed: false, points: run.map(round), generator: FENCES.woodRural }); run = [] }
        for (const p of list) { if (p.col !== last + 1) flush(); run.push(p.x, p.z); last = p.col }
        flush()
      }
      boxes.push({ corners: polygon.slice(), role: 'orchard' })
    }
  } else if (type === 'junkyard' || type === 'camp') {
    // module assembly on a cell grid (modules.ts): lanes from the gate, constraint-solved module per cell
    const mc = { id: c.id, seed: c.seed, roads: c.roads, ground: c.ground, ok, maxSlope: SITE_MAX_SLOPE[type], faction: c.faction, avoid: c.rivers }
    take(type === 'camp' ? makeCamp(polygon, mc) : makeJunkyard(polygon, mc))
    boxes.push({ corners: polygon.slice(), role: 'lot' })
  } else if (type === 'checkpoint') {
    // the road crossing the polygon: middle of its longest inside run, composition sized by the road width
    let best: { x: number; z: number; ux: number; uz: number; half: number; len: number } | null = null
    for (const r of c.roads) {
      let run: number[] = []
      const take = () => {
        if (run.length >= 4) {
          let len = 0
          for (let i = 2; i < run.length; i += 2) len += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1])
          if (!best || len > best.len) {
            let acc = 0
            for (let i = 2; i < run.length; i += 2) {
              const sl = Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1])
              if (acc + sl >= len / 2) { const t = (len / 2 - acc) / (sl || 1); best = { x: run[i - 2] + (run[i] - run[i - 2]) * t, z: run[i - 1] + (run[i + 1] - run[i - 1]) * t, ux: (run[i] - run[i - 2]) / (sl || 1), uz: (run[i + 1] - run[i - 1]) / (sl || 1), half: r.half, len }; break }
              acc += sl
            }
          }
        }
        run = []
      }
      // resample at 2 m so a long straight segment through the zone is caught too
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const L = Math.hypot(r.pts[i + 2] - r.pts[i], r.pts[i + 3] - r.pts[i + 1]), n = Math.max(1, Math.ceil(L / 2))
        for (let k = 0; k < n; k++) {
          const x = r.pts[i] + ((r.pts[i + 2] - r.pts[i]) * k) / n, z = r.pts[i + 1] + ((r.pts[i + 3] - r.pts[i + 1]) * k) / n
          if (inPoly(polygon, x, z)) run.push(x, z); else take()
        }
      }
      take()
    }
    if (!best) warnings.push('checkpoint: no road crosses the zone')
    else {
      const b = best as { x: number; z: number; ux: number; uz: number; half: number }
      const w = b.half * 2, size = w < 7 ? 'S' : w < 10 ? 'M' : 'L'
      yawOut = (Math.atan2(b.ux, b.uz) * 180) / Math.PI
      ent(pick(SITE_PREFABS.checkpoint[size]), b.x, b.z, yawOut)
      const len = size === 'S' ? 14 : size === 'M' ? 20 : 28
      boxes.push({ corners: rectAt(b.x, b.z, yawOut, w + 6, len), role: 'area', h: 0.1 })
      for (const s of [-1, 1]) for (const side of [-1, 1]) boxes.push({ corners: rectAt(b.x + b.ux * s * len * 0.3 - b.uz * side * (b.half + 1.5), b.z + b.uz * s * len * 0.3 + b.ux * side * (b.half + 1.5), yawOut, 1.2, 3), role: 'barracks', h: 1.1 })
      decal(SITE_PREFABS.crossWalk, b.x + b.ux * len * 0.5, b.z + b.uz * len * 0.5, yawOut + 90)
    }
  }
  return { id: c.id, kind: 'site', sub: type, x: cx, z: cz, yaw: Math.round(yawOut), seed: c.seed, boxes, shapes, entities: ents, flat: [], plat, roads: [], warnings }
}

/** square metres of a polygon (UI messages) */
export const siteArea = polyArea

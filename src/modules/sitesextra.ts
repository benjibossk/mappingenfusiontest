// Zone tool, extra structured sites: construction site ("Chantier"), beach ("Plage") and the cemetery
// (terraced rows on slopes, chapel / calvary, gate on the road). Called by sitezones.ts makeSiteZone.
// Every prefab ref below comes from library/prefabs-catalogue.json (GUID harvested from the base game).

import type { ProjectEntity, ProjectShape } from '../project'
import { FENCES, VEG } from '../data/biomes'
import { round } from './gen-common'
import { prefabDims } from '../library/dims.ts'
import type { FlattenRequest as Platform } from './industrial'
import { centroid, contourFrame, distLine, fencePosts, frameOf, inPoly, insetRing, rectAt, rowGrid, slopeAt, type Frame, type RoadLine } from './rowgrid'

export const EXTRA_PREFABS = {
  tinWall: '{3BBE8E0E68E0BE9C}Prefabs/WEGenerators/Walls/Metal/WG_TinWall_01.et',
  dirtTracks: '{5AA67DAA2FB46434}Prefabs/WEGenerators/Decals/Dirt/RG_Dirt_Tracks_01.et',
  cabins: ['{E30E1250FD927736}Prefabs/Structures/Industrial/Houses/PortableCabin_E_01/PortableCabin_E_01_beige.et', '{D445D04331B6809E}Prefabs/Structures/Industrial/Houses/PortableCabin_E_01/PortableCabin_E_01_white.et', '{B9F18808252E22C3}Prefabs/Structures/Industrial/Houses/PortableCabin_E_01/PortableCabin_E_01_yellow.et'],
  cabinSmall: '{A42182DF49D50A3B}Prefabs/Structures/Industrial/Houses/PortableCabin_E_02/PortableCabin_E_02.et',
  containers: ['{526D39BE96FE8A08}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_20ft_grey.et', '{88A64A32F78CFB77}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_20ft_blue.et', '{ADB764EA160A1A4E}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_10ft_grey.et'],
  materials: [
    '{BB9DFC7232860128}Prefabs/Props/Construction/BrickPile/BrickPileOld_01_Large.et', '{C089F66C325FC87C}Prefabs/Props/Construction/BrickPile/BrickPile_01_Large.et', '{B808D460E33CDFAF}Prefabs/Props/Construction/BrickPile/BrickPile_01_Medium.et',
    '{CB033C658E372CED}Prefabs/Props/Construction/PlankPile/PlankPile_01_Large.et', '{67B5336A6D63CCA4}Prefabs/Props/Construction/PlankPile/PlankPile_01_Medium.et',
    '{22E2462FA3AE0849}Prefabs/Props/Construction/ConcretePipe/ConcretePipe_01_Long_Pile.et', '{630C2872BB87F44F}Prefabs/Props/Construction/ConcretePipe/ConcretePipe_01_Short_Pile.et', '{5E249786B7A6896D}Prefabs/Props/Construction/ConcretePipe/ConcretePipe_01_Large.et',
    '{B47EB5AC921214EE}Prefabs/Props/Construction/CableReel/CableReelMetal_01.et', '{A419F4547954DA05}Prefabs/Props/Construction/CableReel/CableReelWooden_01.et',
    '{028D9156F90205DE}Prefabs/Props/Military/Camps/ConstructionMaterialPacked_WoodPlanks_01_US.et', '{90C62D3DBDEB0759}Prefabs/Props/Military/Camps/ConstructionMaterialPacked_MetalSheets_01_US.et',
  ],
  heaps: ['{19A3C48FC2665A3F}Prefabs/Props/Construction/GravelPile_01/GravelPile_01_large.et', '{086E85DB687EA38F}Prefabs/Props/Construction/GravelPile_01/GravelPile_01_medium.et', '{DEB57429CD49782D}Prefabs/Props/Construction/GravelPile_01/SandPile_01.et'],
  mixer: '{4A34979DC19CA9ED}Prefabs/Props/Construction/ConcreteMixer_01.et',
  mortar: '{3C44DBCDA1FD917A}Prefabs/Props/Construction/BoxMortar_01.et',
  // beach
  sunshade: '{2F8BA23B88A4FB07}Prefabs/Props/Furniture/Sunshade_01/Sunshade_01.et',
  sunshadeClosed: ['{1368898FEE915552}Prefabs/Props/Recreation/Beach/SunshadeClosed_01/SunshadeClosed_01_standing_redwhite.et', '{64AA69F7469EB347}Prefabs/Props/Recreation/Beach/SunshadeClosed_01/SunshadeClosed_01_standing_RGBY.et'],
  loungers: ['{7E8CF7366D10C7C4}Prefabs/Props/Recreation/Beach/Lounger_01/Lounger_01_blue.et', '{5726FEB3D7266124}Prefabs/Props/Recreation/Beach/Lounger_01/Lounger_01_red.et', '{24D791DCBDAE9148}Prefabs/Props/Recreation/Beach/Lounger_01/Lounger_01_stripes.et'],
  blankets: ['{47AE94F99DF6445F}Prefabs/Props/Recreation/Beach/BlanketBeach_01/BlanketBeach_01_brown.et', '{6EB3EE4FE50E0319}Prefabs/Props/Recreation/Beach/BlanketBeach_01/BlanketBeach_01_red.et'],
  lifeguard: ['{D6A78D76DC948919}Prefabs/Props/Recreation/Beach/LifeGuardTower_01/LifeGuardTower_01_white.et', '{8B56905B6705B929}Prefabs/Props/Recreation/Beach/LifeGuardTower_01/LifeGuardTower_01_darkgreen.et'],
  boats: ['{F513D99A28A5E5E3}Prefabs/Props/Recreation/Beach/PedalBoat_01/PedalBoat_01_blue.et', '{71ADC9C9161F818C}Prefabs/Props/Recreation/Beach/PedalBoat_01/PedalBoat_01_red.et', '{4923E218F59644B9}Prefabs/Props/Wrecks/BoatWreck_01/BoatWreck_01.et'],
  kiosk: ['{B0C7B3A0C937328B}Prefabs/Structures/Commercial/Booth/NewspaperBooth_E_01/NewspaperBooth_E_01_redwhite.et', '{DA33ED8E94FD68DF}Prefabs/Structures/Commercial/Booth/NewspaperBooth_E_01/NewspaperBooth_E_01_redyellow.et'],
  snack: '{2DAC8D663D5F3E2E}Prefabs/Props/Commercial/MarketStand_01_Umbrella.et',
  bench: '{5BAA975FE04E94EF}Prefabs/Props/Civilian/BenchStreet/StreetBench_01/BenchStreet_01_green.et',
  // cemetery
  chapel: ['{6C4146212E67FFD4}Prefabs/Structures/Cultural/Chapels/Chapel_01/Chapel_01_pink.et', '{FC4C6642B6BF5564}Prefabs/Structures/Cultural/Chapels/Chapel_01/Chapel_01_yellow.et'],
  calvary: ['{336BBFB1B29BB1A1}Prefabs/Structures/Cultural/Calvaries/CalvaryLarge_01.et', '{A4AE8CD6CC7878ED}Prefabs/Structures/Cultural/Calvaries/CalvaryLarge_02.et'],
  graveFence: ['{9FD047CA2FF24481}Prefabs/Structures/Cultural/Cemeteries/Graves/GraveFence_E_01.et', '{F384732A9336CBAF}Prefabs/Structures/Cultural/Cemeteries/Graves/GraveFence_E_02.et'],
} as const

export interface ExtraCtx {
  id: string
  rand: () => number
  roads: RoadLine[]
  ground?: (x: number, z: number) => number
  ok: (x: number, z: number) => boolean
  water?: (x: number, z: number) => boolean // open / still water (beach); default: !ok
}
export interface ExtraOut { entities: ProjectEntity[]; shapes: ProjectShape[]; boxes: { corners: number[]; role: string; h?: number }[]; plat: Platform[]; warnings: string[]; yaw: number }

const deg = (x: number, z: number) => (Math.atan2(x, z) * 180) / Math.PI

/** wall round the polygon with a `gap` m opening centred on the ring point nearest `near` (open polyline
 *  from one side of the gate round to the other), plus the two gate-post positions */
export function gateFence(polygon: number[], generator: string, id: string, near: [number, number] | undefined, gap = 4, inset = 0.5): { shape: ProjectShape; gate: [number, number] | null; dir: [number, number] } {
  const ring = insetRing(polygon, inset), n = ring.length / 2
  if (!near) return { shape: { id, kind: 'polyline', closed: true, points: fencePosts(ring, true).map(round), generator }, gate: null, dir: [0, 1] }
  let bk = 0, bt = 0, bd = Infinity
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[((k + 1) % n) * 2], bz = ring[((k + 1) % n) * 2 + 1]
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((near[0] - ax) * (bx - ax) + (near[1] - az) * (bz - az)) / L2))
    const d = Math.hypot(ax + (bx - ax) * t - near[0], az + (bz - az) * t - near[1])
    if (d < bd) { bd = d; bk = k; bt = t }
  }
  const ax = ring[bk * 2], az = ring[bk * 2 + 1], bx = ring[((bk + 1) % n) * 2], bz = ring[((bk + 1) % n) * 2 + 1]
  const L = Math.hypot(bx - ax, bz - az) || 1, half = Math.min(gap / 2, L / 2 - 0.3)
  const s = Math.max(half, Math.min(L - half, bt * L)), ux = (bx - ax) / L, uz = (bz - az) / L
  const gx = ax + ux * s, gz = az + uz * s
  const pts = [gx + ux * half, gz + uz * half]
  for (let q = 1; q <= n; q++) { const k = (bk + q) % n; pts.push(ring[k * 2], ring[k * 2 + 1]) }
  pts.push(gx - ux * half, gz - uz * half)
  // inward normal of the gate edge
  const [cx, cz] = centroid(polygon)
  let nx = -uz, nz = ux
  if ((cx - gx) * nx + (cz - gz) * nz < 0) { nx = -nx; nz = -nz }
  return { shape: { id, kind: 'polyline', closed: false, points: fencePosts(pts, false).map(round), generator }, gate: [gx, gz], dir: [nx, nz] }
}

function builder(c: ExtraCtx) {
  const o: ExtraOut = { entities: [], shapes: [], boxes: [], plat: [], warnings: [], yaw: 0 }
  const taken: { x: number; z: number; r: number }[] = []
  const free = (x: number, z: number, r: number) => !taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r)
  const ent = (prefab: string, x: number, z: number, yaw: number) => { o.entities.push({ id: `${c.id}_${o.entities.length + 1}`, prefab, x: round(x), z: round(z), yaw: round(((yaw % 360) + 360) % 360) }) }
  const dims = (prefab: string, w = 2, d = 2, h = 1) => { const r = prefabDims(prefab); return r && r.w > 0 && r.dz > 0 ? { w: r.w, d: r.dz, h: r.h || h } : { w, d, h } }
  /** placed only if its footprint stays in the polygon, on usable ground and clear of what is already there */
  const put = (poly: number[], prefab: string, x: number, z: number, yaw: number, role = 'prop', pad = 0.5) => {
    const m = dims(prefab), r = Math.hypot(m.w, m.d) / 2, cn = rectAt(x, z, yaw, m.w, m.d)
    for (let i = 0; i < 8; i += 2) if (!inPoly(poly, cn[i], cn[i + 1]) || !c.ok(cn[i], cn[i + 1])) return false
    if (!free(x, z, r + pad)) return false
    ent(prefab, x, z, yaw); o.boxes.push({ corners: cn, role, h: m.h }); taken.push({ x, z, r })
    return true
  }
  return { o, ent, put, taken, free, dims }
}
const pick = <T>(rand: () => number, a: readonly T[]) => a[Math.floor(rand() * a.length)]
const P = (f: Frame, u: number, v: number): [number, number] => [f.ox + f.ux * u + f.vx * v, f.oz + f.uz * u + f.vz * v]
function extent(polygon: number[], f: Frame) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < polygon.length; i += 2) {
    const ax = polygon[i] - f.ox, az = polygon[i + 1] - f.oz, u = ax * f.ux + az * f.uz, v = ax * f.vx + az * f.vz
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  return { u0, u1, v0, v1 }
}

/** "Chantier": tin hoarding with a gate on the road, site cabins and containers by the gate, a concrete slab
 *  (the building to come) in the middle, material piles round it, a mixer, dirt tracks from the gate */
export function makeConstruction(polygon: number[], c: ExtraCtx): ExtraOut {
  const b = builder(c), { o, put } = b, rand = c.rand
  const f = frameOf(polygon, c.roads)
  o.yaw = deg(f.vx, f.vz)
  const gf = gateFence(polygon, EXTRA_PREFABS.tinWall, `${c.id}_hoarding`, f.road ? [f.road[0], f.road[1]] : undefined, 6)
  o.shapes.push(gf.shape)
  if (!gf.gate) o.warnings.push('construction: no road nearby, hoarding left closed')
  const e = extent(polygon, f)
  // gate in frame coordinates (the gate is on the road side = low V)
  const gu = gf.gate ? (gf.gate[0] - f.ox) * f.ux + (gf.gate[1] - f.oz) * f.uz : (e.u0 + e.u1) / 2
  const gv = gf.gate ? (gf.gate[0] - f.ox) * f.vx + (gf.gate[1] - f.oz) * f.vz : e.v0
  b.taken.push({ x: P(f, gu, gv + 5)[0], z: P(f, gu, gv + 5)[1], r: 4.5 }) // keep the gate entry clear
  // site office: a row of cabins on one side of the gate, containers on the other
  const side = rand() < 0.5 ? 1 : -1
  let cabins = 0
  for (let k = 0, u = gu + side * 7; k < 8 && cabins < 3; k++, u += side * 4.3) {
    const [x, z] = P(f, u, gv + 5.5)
    if (put(polygon, cabins === 2 ? EXTRA_PREFABS.cabinSmall : pick(rand, EXTRA_PREFABS.cabins), x, z, o.yaw + 90, 'main', 0.3)) cabins++
  }
  for (let k = 0, u = gu - side * 8, n = 0; k < 6 && n < 2; k++, u -= side * 3.6) {
    const [x, z] = P(f, u, gv + 5)
    if (put(polygon, pick(rand, EXTRA_PREFABS.containers), x, z, o.yaw + 90, 'annex', 0.4)) n++
  }
  if (!cabins) o.warnings.push('construction: no room for the site cabins')
  // slab of the building to come, in the middle of the far part
  const [mx, mz] = P(f, (e.u0 + e.u1) / 2, (gv + 12 + e.v1) / 2)
  const sw = Math.max(8, Math.min(24, (e.u1 - e.u0) * 0.45)), sd = Math.max(8, Math.min(18, (e.v1 - gv - 12) * 0.5))
  const slab = rectAt(mx, mz, o.yaw, sw, sd)
  let slabOk = true
  for (let i = 0; i < 8; i += 2) if (!inPoly(polygon, slab[i], slab[i + 1]) || !c.ok(slab[i], slab[i + 1])) slabOk = false
  if (slabOk) {
    o.boxes.push({ corners: slab, role: 'pave', h: 0.3 })
    b.taken.push({ x: mx, z: mz, r: Math.hypot(sw, sd) / 2 })
    if (c.ground) o.plat.push({ kind: 'platform', polygon: slab.map(round), height: round(c.ground(mx, mz)), falloff: 3, slope: 0 })
    put(polygon, EXTRA_PREFABS.mixer, ...P(f, (e.u0 + e.u1) / 2 + sw / 2 + 2.5, (gv + 12 + e.v1) / 2), o.yaw)
    put(polygon, EXTRA_PREFABS.mortar, ...P(f, (e.u0 + e.u1) / 2 + sw / 2 + 2.5, (gv + 12 + e.v1) / 2 + 2.5), o.yaw)
  }
  o.warnings.push('construction: no vanilla tower crane, scaffolding, unfinished shell or site machinery; a slab + materials stand for the building')
  // material piles on a loose grid
  const spots = rowGrid(polygon, { dx: 7, dz: 7, margin: 3, frame: f, jitter: 0.5, rand, roads: c.roads, ok: c.ok, ground: c.ground, maxSlope: 0.2 })
  let piles = 0
  for (const s of spots) {
    if (rand() > 0.55) continue
    const heap = rand() < 0.2
    if (put(polygon, heap ? pick(rand, EXTRA_PREFABS.heaps) : pick(rand, EXTRA_PREFABS.materials), s.x, s.z, o.yaw + (rand() < 0.5 ? 0 : 90) + (rand() - 0.5) * 20, 'prop', 0.8)) piles++
  }
  if (!piles) o.warnings.push('construction: no room for materials')
  // dirt tracks from the gate to the slab
  if (gf.gate) {
    const a = P(f, gu, gv + 1), m = P(f, gu, (gv + (gv + 12 + e.v1) / 2) / 2), t = slabOk ? [mx, mz] : P(f, gu, (gv + e.v1) / 2)
    o.shapes.push({ id: `${c.id}_tracks`, kind: 'spline', closed: false, points: [...a, ...m, ...t].map(round), generator: EXTRA_PREFABS.dirtTracks })
  }
  o.boxes.push({ corners: polygon.slice(), role: 'lot' })
  return o
}

/** distance-to-water field over the polygon bbox (+ margin): multi-source propagation of the nearest water cell */
function waterField(polygon: number[], ok: (x: number, z: number) => boolean, step = 2, margin = 40) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < polygon.length; i += 2) { x0 = Math.min(x0, polygon[i]); x1 = Math.max(x1, polygon[i]); z0 = Math.min(z0, polygon[i + 1]); z1 = Math.max(z1, polygon[i + 1]) }
  x0 -= margin; z0 -= margin; x1 += margin; z1 += margin
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1
  const src = new Int32Array(nx * nz).fill(-1), queue: number[] = []
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!ok(x0 + i * step, z0 + j * step)) { src[j * nx + i] = j * nx + i; queue.push(j * nx + i) }
  const water = queue.length
  const cx = (k: number) => x0 + (k % nx) * step, cz = (k: number) => z0 + Math.floor(k / nx) * step
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % nx, j = Math.floor(k / nx), s = src[k]
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue
      const kk = b * nx + a, cur = src[kk]
      const d = Math.hypot(cx(kk) - cx(s), cz(kk) - cz(s))
      if (cur < 0) { src[kk] = s; queue.push(kk) }
      else if (cur !== kk && Math.hypot(cx(kk) - cx(cur), cz(kk) - cz(cur)) > d + 1e-6) { src[kk] = s; queue.push(kk) }
    }
  }
  /** [distance, nearest water x, z] or null when the bbox holds no water */
  return (x: number, z: number): [number, number, number] | null => {
    if (!water) return null
    const i = Math.max(0, Math.min(nx - 1, Math.round((x - x0) / step))), j = Math.max(0, Math.min(nz - 1, Math.round((z - z0) / step)))
    const s = src[j * nx + i]
    if (s < 0) return null
    return [Math.hypot(cx(s) - x, cz(s) - z), cx(s), cz(s)]
  }
}

/** "Plage": only along water. Sand strip on the shore, parasols + loungers in rows facing the water,
 *  a lifeguard tower, boats pulled up on the shore, a kiosk at the back and a path from the road */
export function makeBeach(polygon: number[], c: ExtraCtx): ExtraOut {
  const b = builder(c), { o, put } = b, rand = c.rand
  const wf = waterField(polygon, c.water ? (x, z) => !c.water!(x, z) : c.ok)
  const at = (x: number, z: number) => wf(x, z)
  // sand strip: 6 m cells of land inside the zone within 30 m of the water
  const f0 = frameOf(polygon, c.roads)
  const cells = rowGrid(polygon, { dx: 6, dz: 6, margin: 0.5, frame: f0, ok: c.ok, ground: c.ground, maxSlope: 0.5 })
  const strip = cells.filter((p) => { const w = at(p.x, p.z); return w && w[0] <= 30 })
  if (!strip.length) { o.warnings.push('beach: no water along the zone (draw it on the shore)'); return o }
  for (const p of strip) o.boxes.push({ corners: rectAt(p.x, p.z, p.yaw, 6, 6), role: 'sand', h: 0.02 })
  const sea = (x: number, z: number) => { const w = at(x, z)!; return deg(w[1] - x, w[2] - z) }
  o.yaw = Math.round(sea(...centroid(strip.flatMap((p) => [p.x, p.z])) as [number, number]))
  // lifeguard tower: the strip point ~12 m from the water closest to the strip centre
  const [sx, sz] = centroid(strip.flatMap((p) => [p.x, p.z]))
  const fine = rowGrid(polygon, { dx: 3, dz: 3, margin: 1, frame: f0, ok: c.ok, ground: c.ground, maxSlope: 0.4 }).map((p) => ({ ...p, w: at(p.x, p.z) })).filter((p) => p.w && p.w[0] <= 30) as { x: number; z: number; w: [number, number, number] }[]
  const tower = fine.filter((p) => p.w[0] > 9 && p.w[0] < 15).sort((a, q) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(q.x - sx, q.z - sz))
  for (const p of tower.slice(0, 20)) if (put(polygon, pick(rand, EXTRA_PREFABS.lifeguard), p.x, p.z, sea(p.x, p.z), 'tower', 4)) break
  // boats on the shore (3.5..8 m from the water), >= 12 m apart, bow to the water
  let boats = 0
  for (const p of fine.filter((q) => q.w[0] >= 3.5 && q.w[0] <= 8)) {
    if (boats >= 4 || rand() > 0.5) continue
    if (put(polygon, rand() < 0.75 ? pick(rand, EXTRA_PREFABS.boats.slice(0, 2)) : EXTRA_PREFABS.boats[2], p.x, p.z, sea(p.x, p.z) + (rand() - 0.5) * 30, 'prop', 5)) boats++
  }
  // parasol groups: parasol + two loungers facing the water, 8..20 m back, on a 7 m grid
  let groups = 0
  for (const p of rowGrid(polygon, { dx: 7, dz: 7, margin: 2, frame: f0, jitter: 0.15, rand, ok: c.ok, ground: c.ground, maxSlope: 0.3 })) {
    const w = at(p.x, p.z)
    if (!w || w[0] < 8 || w[0] > 20 || rand() > 0.7) continue
    const y = sea(p.x, p.z), r = (y * Math.PI) / 180, tx = Math.cos(r), tz = -Math.sin(r) // tangent to the shore
    if (!put(polygon, rand() < 0.85 ? EXTRA_PREFABS.sunshade : pick(rand, EXTRA_PREFABS.sunshadeClosed), p.x, p.z, rand() * 360, 'prop', 0.3)) continue
    groups++
    const sx2 = Math.sin(r), sz2 = Math.cos(r) // towards the water
    for (const s of [-1, 1]) if (rand() < 0.85) put(polygon, rand() < 0.8 ? pick(rand, EXTRA_PREFABS.loungers) : pick(rand, EXTRA_PREFABS.blankets), p.x + tx * s * 1.3 - sx2 * 0.8, p.z + tz * s * 1.3 - sz2 * 0.8, y + (rand() - 0.5) * 10, 'prop', 0)
  }
  if (!groups) o.warnings.push('beach: strip too narrow for parasols')
  // kiosk + snack stand at the back of the beach (22..32 m), nearest the road
  const back = fine.filter((p) => p.w[0] > 22 && p.w[0] <= 32)
  if (f0.road) back.sort((a, q) => Math.hypot(a.x - f0.road![0], a.z - f0.road![1]) - Math.hypot(q.x - f0.road![0], q.z - f0.road![1]))
  let kiosk: [number, number] | null = null
  for (const p of back.slice(0, 40)) if (put(polygon, pick(rand, EXTRA_PREFABS.kiosk), p.x, p.z, sea(p.x, p.z), 'main', 1)) { kiosk = [p.x, p.z]; break }
  if (kiosk) {
    const y = sea(kiosk[0], kiosk[1]), r = (y * Math.PI) / 180
    for (const s of [-1, 1]) put(polygon, s < 0 ? EXTRA_PREFABS.snack : EXTRA_PREFABS.bench, kiosk[0] + Math.cos(r) * s * 5, kiosk[1] - Math.sin(r) * s * 5, y, 'prop', 0.3)
  } else o.warnings.push('beach: no room for a kiosk')
  // path from the road to the beach
  const tgt = kiosk ?? [sx, sz]
  if (f0.road && f0.road[2] < 150) {
    const [rx, rz] = [f0.road[0], f0.road[1]]
    o.shapes.push({ id: `${c.id}_path`, kind: 'spline', closed: false, points: [rx, rz, (rx + tgt[0]) / 2, (rz + tgt[1]) / 2, tgt[0], tgt[1]].map(round), generator: EXTRA_PREFABS.dirtTracks })
  }
  o.warnings.push('beach: sand shown on the map only; the terrain surface stays as painted (coast BeachGrass on generated islands)')
  return o
}

/** cemetery: wall with a gate on the road, dense regular rows (terraced along the contour on slopes), a central
 *  aisle from the gate to a chapel (or a calvary when it does not fit), grave surrounds, trees along the wall */
export function makeCemetery(polygon: number[], c: ExtraCtx, graves: readonly string[]): ExtraOut {
  const b = builder(c), { o, put } = b, rand = c.rand
  const fb = frameOf(polygon, c.roads)
  const [cx, cz] = centroid(polygon)
  const steep = !!c.ground && slopeAt(c.ground, cx, cz, 12) > 0.04
  const f = steep ? contourFrame(polygon, c.ground!, fb) : fb
  o.yaw = deg(f.vx, f.vz)
  const gf = gateFence(polygon, FENCES.brick1, `${c.id}_wall`, fb.road ? [fb.road[0], fb.road[1]] : undefined, 4)
  o.shapes.push(gf.shape)
  if (gf.gate) {
    const [gx, gz] = gf.gate
    const ux = -gf.dir[1], uz = gf.dir[0] // calvary just inside, beside the gate
    for (const s of [1, -1]) if (put(polygon, EXTRA_PREFABS.calvary[1], gx + ux * s * 3 + gf.dir[0] * 1.5, gz + uz * s * 3 + gf.dir[1] * 1.5, deg(-gf.dir[0], -gf.dir[1]), 'prop', 0.3)) break
  }
  const g = rowGrid(polygon, { dx: 1.6, dz: 2.6, margin: 2.5, frame: f, ok: c.ok, ground: c.ground, maxSlope: steep ? 0.3 : 0.12 })
  if (!g.length) { o.warnings.push('cemetery: no grave fits'); return o }
  const uOf = (x: number, z: number) => (x - f.ox) * f.ux + (z - f.oz) * f.uz, vOf = (x: number, z: number) => (x - f.ox) * f.vx + (z - f.oz) * f.vz
  // aisle: through the gate when the rows face it, else the middle
  const us = g.map((p) => uOf(p.x, p.z)), vs = g.map((p) => vOf(p.x, p.z))
  let um = (Math.min(...us) + Math.max(...us)) / 2
  if (gf.gate && !steep) um = uOf(gf.gate[0], gf.gate[1])
  const vmin = Math.min(...vs), vmax = Math.max(...vs)
  // chapel (or calvary) at the far end of the aisle
  const fx = P(f, um, vmax - 2.5)
  let landmark = put(polygon, pick(rand, EXTRA_PREFABS.chapel), fx[0], fx[1], o.yaw + 180, 'main', 1)
  if (!landmark) { const m = P(f, um, (vmin + vmax) / 2); landmark = put(polygon, EXTRA_PREFABS.calvary[0], m[0], m[1], o.yaw + 180, 'prop', 1.5) }
  const rows = [...new Set(g.map((p) => p.row))].sort((a, q) => a - q), crossEvery = 7
  for (const p of g) {
    const u = uOf(p.x, p.z)
    if (Math.abs(u - um) < 1.7) continue // central aisle
    if (rows.length > 12 && rows.indexOf(p.row) % crossEvery === crossEvery - 1) continue // cross aisle
    if (!b.free(p.x, p.z, 0.6) || rand() > 0.9) continue
    const fence = rand() < 0.1
    b.ent(fence ? pick(rand, EXTRA_PREFABS.graveFence) : pick(rand, graves), p.x, p.z, p.yaw + (rand() - 0.5) * 3)
    o.boxes.push({ corners: rectAt(p.x, p.z, p.yaw, 1, fence ? 2.4 : 2), role: 'grave', h: 0.9 })
  }
  // terraces: one flattened band every 2 rows when on a slope
  if (steep && c.ground) {
    const byBand = new Map<number, typeof g>()
    for (const p of g) { const k = Math.floor(p.row / 2); if (!byBand.has(k)) byBand.set(k, []); byBand.get(k)!.push(p) }
    for (const list of byBand.values()) {
      const lu = list.map((p) => uOf(p.x, p.z)), lv = list.map((p) => vOf(p.x, p.z))
      const a = Math.min(...lu) - 0.8, bb = Math.max(...lu) + 0.8, v0 = Math.min(...lv) - 1.3, v1 = Math.max(...lv) + 1.3
      const h = list.reduce((s, p) => s + c.ground!(p.x, p.z), 0) / list.length
      o.plat.push({ kind: 'platform', polygon: [...P(f, a, v0), ...P(f, bb, v0), ...P(f, bb, v1), ...P(f, a, v1)].map(round), height: round(h), falloff: 1, slope: 0 })
    }
  }
  // gravel aisle (dirt decal spline) from the gate up to the landmark
  const a0 = gf.gate ? [gf.gate[0], gf.gate[1]] : P(f, um, vmin)
  o.shapes.push({ id: `${c.id}_aisle`, kind: 'spline', closed: false, points: [...a0, ...P(f, um, (vmin + vmax) / 2), ...P(f, um, vmax - 5)].map(round), generator: EXTRA_PREFABS.dirtTracks })
  // trees along the wall
  for (const p of rowGrid(polygon, { dx: 12, dz: 12, margin: 1.5, frame: f, jitter: 0.3, rand })) if (distLine(polygon, p.x, p.z, true) < 3 && rand() < 0.5 && b.free(p.x, p.z, 1.5)) b.ent(rand() < 0.5 ? VEG.lime : VEG.spruce, p.x, p.z, rand() * 360)
  if (steep) o.warnings.push('cemetery: on a slope, rows follow the contour on flattened terraces')
  return o
}

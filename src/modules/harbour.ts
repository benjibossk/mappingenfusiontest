// Realistic harbours around a vanilla port template (analyses HARBOURS_EVERON.md, Saint-Philippe measured rules, and
// HARBOUR_GENERATORS.md, 10-step algorithm). The template stays the core; around it, sized by tier:
// a quay line on the coast (seaward normal snapped to 15°), a basin dredged flat at -7.5 m, an apron flat at +2.2 m
// (vertical quay wall between them, <= 10 m blend to the natural ground), breakwater arms closing the basin with an
// 80-100 m pass, wooden jetties, bollards, life buoys, a red / green buoy pair at the pass, mooring buoys offshore,
// pallets / containers / warehouses on the apron and a quay street parallel to the quay linked to the nearest road.
// Pure (no DOM). The terrain pass (applyHarbour) is called by zones.applyZones.

import type { Grid } from './island'
import type { Road } from './roads'
import type { ProjectEntity } from '../project'
import { toWorld, round, heightAt } from './gen-common'

export type HarbourTier = 'fishing' | 'bourg' | 'port'

/** world-space record (JSON-safe) kept on the zone: frame, basin, apron, arms... */
export interface HarbourPlan {
  tier: HarbourTier
  /** frame: origin on the quay line, yaw = seaward direction (local +Z = sea, local +X along the quay) */
  ox: number; oz: number; yaw: number
  quayHalf: number
  /** apron: local u in [-apronHalf, apronHalf], v in [-apronDepth, 0], flat at APRON_H */
  apronHalf: number; apronDepth: number
  /** basin polygon, local [u0, v0, u1, v1, ...], flat at BASIN_H */
  basin: number[]
  /** extra dredged discs (local) around the template's sea parts */
  dredge: { u: number; v: number; r: number; free?: boolean }[] // free: not clipped to the quay line (a sea part beside the apron)
  /** breakwater arms, local [u0, v0, u1, v1] (root on the coast -> head) */
  arms: number[][]
  /** pass (entrance) local [uL, vL, uR, vR] */
  pass: number[]
  /** wooden jetties, local [u, v0, v1] */
  jetties: number[][]
  /** quay street v (local) */
  streetV: number
}

export const BASIN_H = -7.5
export const APRON_H = 2.2
const BLEND = 10

// exact vanilla ResourceNames (data/templates/vanilla_sites.json port templates)
export const HARBOUR_PREFABS = {
  breakwater: '{F281250F8F8E3755}Prefabs/Structures/Infrastructure/Naval/Breakwater/BreakwaterStone_01_stack_wall.et',
  quay: '{DB3F36604A282237}Prefabs/Structures/Infrastructure/Naval/Piers/PierConcrete_01_20m.et',
  jetty: '{FF39390F2D826521}Prefabs/Structures/Infrastructure/Naval/Piers/PierWooden_01_25m.et',
  bollard: '{85CE0F68DA969A31}Prefabs/Structures/Infrastructure/Naval/SeaBollards/SeaBollard_01.et',
  lifebuoy: '{FEC4DAC172001095}Prefabs/Props/Naval/LifeBuoy_01_set.et',
  buoyRed: '{5564DA2B07C100EA}Prefabs/Props/Naval/Buoy_01_red.et',
  buoyGreen: '{1C28D0470C93423F}Prefabs/Props/Naval/Buoy_01_green.et',
  mooring: '{95274C6C9B84E104}Prefabs/Props/Naval/MooringBuoy_01.et',
  pallet: '{1112756E8A13445B}Prefabs/Props/Industrial/Pallets/Pallet_01_Pile.et',
  palletBox: '{51B08BDA20AF8FF7}Prefabs/Props/Industrial/Pallets/WoodenPalletBox_01.et',
  containers: [
    '{1D2F578D059DEF0A}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_20ft_green_rusty.et',
    '{16B3A59B10F83339}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_20ft_red_rusty.et',
    '{24F6E5FFFC6FF4DC}Prefabs/Props/Industrial/CargoContainers/CargoContainer_01/CargoContainer_01_20ft_olive_rusty.et',
  ],
  warehouse: '{12310677867A85D4}Prefabs/Structures/Industrial/Houses/Warehouse_01/Warehouse_01.et',
  warehouseOffice: '{BBCEDBF2C4E3E896}Prefabs/Structures/Industrial/Houses/Warehouse_01/Warehouse_01_Office.et',
}

/** sea parts that must stand in (deep) water: breakwaters, wooden piers, dolphins, channel / mooring buoys */
export const PORT_SEA_RX = /\/Naval\/(Breakwater|Piers\/MooringDolphin|Piers\/Pier_?Wood)|\/Naval\/Buoy_01_(red|green)|MooringBuoy/i

const TIERS: Record<HarbourTier, { quayHalf: number; arms: number; armLen: number; passW: number; jetties: number; apronDepth: number; streetV: number; moorings: number; warehouses: number }> = {
  fishing: { quayHalf: 25, arms: 0, armLen: 0, passW: 0, jetties: 2, apronDepth: 40, streetV: -30, moorings: 2, warehouses: 0 },
  bourg: { quayHalf: 50, arms: 1, armLen: 100, passW: 90, jetties: 4, apronDepth: 60, streetV: -50, moorings: 3, warehouses: 1 },
  port: { quayHalf: 60, arms: 2, armLen: 110, passW: 90, jetties: 6, apronDepth: 80, streetV: -50, moorings: 4, warehouses: 2 },
}
const ARM_ANGLE = 65 * Math.PI / 180 // arm to shoreline

/** seaward unit normal of the coast around (x, z): mean direction of the sea samples on rings 30-210 m */
export function coastNormal(hAt: (x: number, z: number) => number, x: number, z: number): [number, number] | null {
  let sx = 0, sz = 0, n = 0
  for (let r = 30; r <= 210; r += 30) for (let a = 0; a < 32; a++) {
    const q = (a / 32) * Math.PI * 2, cx = Math.sin(q), cz = Math.cos(q)
    if (hAt(x + cx * r, z + cz * r) <= 0) { sx += cx; sz += cz; n++ }
  }
  const L = Math.hypot(sx, sz)
  return n && L > 1e-6 ? [sx / L, sz / L] : null
}

/** world -> local (u along the quay, v seaward) of a plan frame */
export function toLocal(H: { ox: number; oz: number; yaw: number }, x: number, z: number): [number, number] {
  const a = H.yaw * Math.PI / 180, fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a)
  const dx = x - H.ox, dz = z - H.oz
  return [dx * rx + dz * rz, dx * fx + dz * fz]
}
export const localToWorld = (H: { ox: number; oz: number; yaw: number }, u: number, v: number) => toWorld(H.ox, H.oz, H.yaw, u, v)

function inPoly(p: number[], x: number, z: number) {
  let c = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c
  return c
}
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2))
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}
/** signed distance to a polygon (< 0 inside) */
function polyDist(p: number[], x: number, z: number) {
  let d = Infinity
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) d = Math.min(d, segDist(x, z, p[j], p[j + 1], p[i], p[i + 1]))
  return inPoly(p, x, z) ? -d : d
}
/** distance of a local point to the quay segment (v = 0, |u| <= quayHalf) */
export const quayDist = (H: HarbourPlan, u: number, v: number) => Math.hypot(Math.max(0, Math.abs(u) - H.quayHalf), v)

/** distance of a local point to the apron rectangle (0 inside) */
export const apronDist = (H: HarbourPlan, u: number, v: number) => Math.hypot(Math.max(0, Math.abs(u) - H.apronHalf), Math.max(0, -H.apronDepth - v, v))

/** signed distances (local) to the basin (polygon + dredge discs, clipped to v >= 0) and to the apron */
function dists(H: HarbourPlan, u: number, v: number) {
  let dB = polyDist(H.basin, u, v)
  for (const c of H.dredge) dB = Math.min(dB, c.free ? Math.hypot(u - c.u, v - c.v) - c.r : Math.max(Math.hypot(u - c.u, v - c.v) - c.r, -v))
  const du = Math.abs(u) - H.apronHalf, dv = Math.max(-H.apronDepth - v, v)
  const dA = du <= 0 && dv <= 0 ? Math.max(du, dv) : Math.hypot(Math.max(du, 0), Math.max(dv, 0))
  return { dB, dA }
}

/** harbour terrain, in place (same grid layout as the heights): basin flat at -7.5 m, apron flat at +2.2 m,
 *  vertical quay wall between them, <= 10 m linear blend to the natural ground around both */
function harbourBox(H: HarbourPlan) {
  const pts: number[][] = []
  for (let i = 0; i < H.basin.length; i += 2) pts.push([H.basin[i], H.basin[i + 1]])
  for (const c of H.dredge) pts.push([c.u - c.r, c.v - c.r], [c.u + c.r, c.v + c.r])
  pts.push([-H.apronHalf, -H.apronDepth], [H.apronHalf, 0])
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  const ul = Math.min(...pts.map((q) => q[0])) - BLEND, uh = Math.max(...pts.map((q) => q[0])) + BLEND
  const vl = Math.min(...pts.map((q) => q[1])) - BLEND, vh = Math.max(...pts.map((q) => q[1])) + BLEND
  for (const [u, v] of [[ul, vl], [uh, vl], [uh, vh], [ul, vh]]) { const [x, z] = localToWorld(H, u, v); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
  return { x0, z0, x1, z1 }
}
export function applyHarbour(heights: number[], g: Grid, H: HarbourPlan) {
  const { x0, z0, x1, z1 } = harbourBox(H)
  const c0 = Math.max(0, Math.floor((x0 - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((x1 - g.minX) / g.step))
  const r0 = Math.max(0, Math.floor((z0 - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((z1 - g.minZ) / g.step))
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const [u, v] = toLocal(H, g.minX + c * g.step, g.minZ + r * g.step)
    const { dB, dA } = dists(H, u, v), i = r * g.cols + c, h = heights[i]
    if (dB <= 0) heights[i] = BASIN_H
    else if (dA <= 0) heights[i] = APRON_H
    else if (dB < BLEND && dB <= dA) heights[i] = Math.min(h, BASIN_H + ((h - BASIN_H) * dB) / BLEND)
    else if (dA < BLEND) heights[i] = APRON_H + ((h - APRON_H) * dA) / BLEND
  }
}

/** a finer height patch over the harbour (the main grid is 8 m: the quay step becomes a ramp, 5th live send ycm on
 *  every quay piece). Written by the bridge as heightpatch.txt, sampled first by MG_HeightmapApplier. Flats exact,
 *  the rest = the coarse result, so its border matches the main grid. */
export interface HeightPatch { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] }
export function harbourPatch(heights: ArrayLike<number>, g: Grid, H: HarbourPlan, step = 2): HeightPatch {
  const b = harbourBox(H), minX = Math.floor(b.x0 / step) * step, minZ = Math.floor(b.z0 / step) * step
  const cols = Math.ceil((b.x1 - minX) / step) + 1, rows = Math.ceil((b.z1 - minZ) / step) + 1, out: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = minX + c * step, z = minZ + r * step, h = heightAt(heights, g, x, z), [u, v] = toLocal(H, x, z), { dB, dA } = dists(H, u, v)
    // only the two flats are sharpened; the blend is already in the coarse grid (applying it again on top dug the
    // 6th live send 7 m too deep around VAN_PORT_1)
    let y = h
    if (dB <= 0) y = BASIN_H
    else if (dA <= 0) y = APRON_H
    out.push(Math.round(y * 100) / 100)
  }
  return { minX, minZ, step, cols, rows, heights: out }
}

export interface HarbourBuild { plan: HarbourPlan; entities: ProjectEntity[]; roads: Road[]; boxes: { corners: number[]; role: string; h?: number }[] }

/** builds the harbour around a fitted template. `core`: the stamped template entities (world). null = the site does
 *  not suit (no coast crossing, a road within 40 m of the quay, cliff behind the quay) */
export function buildHarbour(o: {
  id: string; tier: HarbourTier; x: number; z: number; seed: number
  hAt: (x: number, z: number) => number
  core: ProjectEntity[]; isSea: (prefab: string) => boolean
  roads: ArrayLike<number>[]
  avoid?: { x: number; z: number; r: number }[] // other zones' discs: the link road goes round them
}): HarbourBuild | null {
  const T = TIERS[o.tier], n = coastNormal(o.hAt, o.x, o.z)
  if (!n) return null
  const yaw = Math.round(((Math.atan2(n[0], n[1]) * 180) / Math.PI) / 15) * 15
  const a = yaw * Math.PI / 180, nx = Math.sin(a), nz = Math.cos(a)
  // coast crossing along the normal, nearest to the template centre
  let s0: number | null = null
  for (let k = 0; k <= 125 && s0 === null; k++) for (const s of k ? [k * 2, -k * 2] : [0]) {
    if (o.hAt(o.x + nx * s, o.z + nz * s) <= 0 && o.hAt(o.x + nx * (s - 2), o.z + nz * (s - 2)) > 0) { s0 = s; break }
  }
  if (s0 === null) return null
  const H: HarbourPlan = { tier: o.tier, ox: o.x + nx * s0, oz: o.z + nz * s0, yaw, quayHalf: T.quayHalf, apronHalf: T.quayHalf + 10, apronDepth: T.apronDepth, basin: [], dredge: [], arms: [], pass: [], jetties: [], streetV: T.streetV }
  // the template's sea parts in front of the quay stay seaward of it (else the apron would bury them)
  // + the template's own quay edges (concrete piers, pier ladders, davits): they need water at their foot, our apron
  // must stay behind them (seed 21 audit: an Arland template's inner basin filled by the apron, 40 parts on dry land)
  const QUAY_RX = /Piers\/PierConcrete|Ladder_Pier|Davits?\//i
  const sea = o.core.filter((e) => o.isSea(e.prefab) || QUAY_RX.test(e.prefab)).map((e) => toLocal(H, e.x, e.z))
  const front = sea.filter(([u]) => Math.abs(u) <= H.apronHalf + 10)
  const vMin = front.length ? Math.min(...front.map((q) => q[1])) : 10
  if (vMin < 6) { const sh = Math.min(100, 6 - vMin); // 100 (was 40): a template with its own inner basin (Arland 1089_3300) kept 40 sea parts under the apron (seed 21 audit)
    H.ox -= nx * sh; H.oz -= nz * sh }
  // roads kept >= 40 m off the quay and >= 25 m off the apron (their carved beds and shoulders stay off the flat)
  for (const l of o.roads) for (let i = 0; i + 3 < l.length; i += 2) {
    const ax = l[i], az = l[i + 1], dx = l[i + 2] - ax, dz = l[i + 3] - az, m = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 4))
    for (let k = 0; k <= m; k++) { const [u, v] = toLocal(H, ax + (dx * k) / m, az + (dz * k) / m); if (quayDist(H, u, v) < 40 || apronDist(H, u, v) < 25) return null }
  }
  // no cliff behind the quay: mean natural height over the apron <= 12 m
  let sum = 0, cnt = 0
  for (let v = -H.apronDepth; v <= -5; v += 10) for (let u = -H.apronHalf; u <= H.apronHalf; u += 10) { const [x, z] = localToWorld(H, u, v); sum += Math.max(0, o.hAt(x, z)); cnt++ }
  if (sum / cnt > 12) return null

  // basin + arms + pass
  const cs = Math.cos(ARM_ANGLE) , sn = Math.sin(ARM_ANGLE)
  if (T.arms === 2) {
    const W = T.passW + 2 * T.armLen * cs, hv = T.armLen * sn
    const hl = [-W / 2 + T.armLen * cs, hv], hr = [W / 2 - T.armLen * cs, hv]
    H.arms = [[-W / 2, 0, hl[0], hl[1]], [W / 2, 0, hr[0], hr[1]]]
    H.basin = [-W / 2, 0, W / 2, 0, hr[0], hr[1], hl[0], hl[1]]
    H.pass = [hl[0], hl[1], hr[0], hr[1]]
  } else if (T.arms === 1) {
    const hv = T.armLen * sn, W = T.passW + T.armLen * cs
    const hl = [-W / 2 + T.armLen * cs, hv]
    H.arms = [[-W / 2, 0, hl[0], hl[1]]]
    H.basin = [-W / 2, 0, W / 2, 0, W / 2, hv, hl[0], hl[1]]
    H.pass = [hl[0], hl[1], W / 2, hv]
  } else {
    const W = H.apronHalf, D = 40
    H.basin = [-W, 0, W, 0, W, D, -W, D]
    H.pass = [-W, D, W, D]
  }
  for (const [u, v] of sea) if (v > 0) H.dredge.push({ u: round(u), v: round(v), r: 14 })
  // sea parts behind the quay line but beside the apron (side quays, ladders, moored buoys of the template): dredged
  // too, else they stand on dry ground (seed 21 live audit: 63 port parts on land, 40 in one Arland port template)
  else if (Math.abs(u) > H.apronHalf + 2) H.dredge.push({ u: round(u), v: round(v), r: 8, free: true })

  // entities
  let seed = (o.seed >>> 0) || 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const coreXZ = o.core.map((e) => [e.x, e.z])
  const clear = (x: number, z: number, r: number) => !coreXZ.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < r)
  const ents: ProjectEntity[] = []
  let k = 0
  const put = (prefab: string, u: number, v: number, dyaw: number, ycm?: number, r = 6) => {
    const [x, z] = localToWorld(H, u, v)
    if (r > 0 && !clear(x, z, r)) return false
    const e: ProjectEntity = { id: `${o.id}-h${k++}`, prefab, x: round(x), z: round(z), yaw: round((((yaw + dyaw) % 360) + 360) % 360) }
    if (ycm !== undefined) e.ycm = ycm
    ents.push(e)
    return true
  }
  const P = HARBOUR_PREFABS
  // breakwater arms: a piece every 9.5 m, yaw = arm azimuth + 90 (+-6° jitter), on the dredged bottom
  for (const [u0, v0, u1, v1] of H.arms) {
    const L = Math.hypot(u1 - u0, v1 - v0), az = (Math.atan2(u1 - u0, v1 - v0) * 180) / Math.PI
    for (let s = 5; s <= L; s += 9.5) put(P.breakwater, u0 + ((u1 - u0) * s) / L, v0 + ((v1 - v0) * s) / L, az + 90 + (rnd() * 12 - 6), undefined, 4)
  }
  // concrete quay along the coast (20 m pieces), bollards every 8 m on the edge, life buoys every 30 m
  for (let u = -H.quayHalf + 10; u <= H.quayHalf - 10 + 1e-6; u += 20) put(P.quay, u, 0, 90, -180, 8)
  for (let u = -H.quayHalf + 4; u <= H.quayHalf - 4; u += 8) put(P.bollard, u, -1, 0, Math.round(APRON_H * 100), 3)
  for (let u = -H.quayHalf + 15; u <= H.quayHalf - 5; u += 30) put(P.lifebuoy, u, -3, 0, Math.round(APRON_H * 100), 3)
  // wooden jetties (25 m) perpendicular to the quay, 30 m apart, centred on the quay
  const nJ = T.jetties, spJ = Math.min(30, (2 * H.quayHalf - 20) / Math.max(1, nJ - 1))
  for (let j = 0; j < nJ; j++) {
    const u = (j - (nJ - 1) / 2) * spJ
    if (put(P.jetty, u, 13.5, 0, undefined, 6)) H.jetties.push([round(u), 1, 26])
  }
  // red / green pair across the pass, 30 m in front of it (symmetric about the channel axis)
  {
    const [uL, vL, uR, vR] = H.pass, mu = (uL + uR) / 2, mv = (vL + vR) / 2, du = uR - uL, dv = vR - vL, L = Math.hypot(du, dv) || 1
    const ex = du / L, ev = dv / L, ox = -ev, ov = ex // seaward normal of the pass (v grows)
    const half = Math.min(L / 2 - 5, 45)
    put(P.buoyRed, mu - ex * half + ox * 30, mv - ev * half + ov * 30, 0, 0, 0)
    put(P.buoyGreen, mu + ex * half + ox * 30, mv + ev * half + ov * 30, 0, 0, 0)
  }
  // mooring buoys offshore, 160-340 m, ~170 m apart, on water deeper than 3 m
  for (let m = 0; m < T.moorings; m++) {
    const u = (m - (T.moorings - 1) / 2) * 170, v = H.pass[1] + 160 + (m % 2) * 120
    const [x, z] = localToWorld(H, u, v)
    if (o.hAt(x, z) < -3) put(P.mooring, u, v, 0, 0, 0)
  }
  // apron: pallets 13-23 m, containers ~40 m, warehouses ~66 m (behind the street)
  const yc = Math.round(APRON_H * 100)
  for (let u = -H.quayHalf + 8; u <= H.quayHalf - 8; u += 14) if (rnd() < 0.7) put(rnd() < 0.6 ? P.pallet : P.palletBox, u + rnd() * 4 - 2, -13 - rnd() * (o.tier === 'fishing' ? 0 : 10), rnd() * 360, yc, 4)
  if (o.tier !== 'fishing') for (let u = -H.quayHalf + 10; u <= H.quayHalf - 10; u += 7) if (rnd() < 0.6) put(P.containers[Math.floor(rnd() * 3)], u, -40, 90, yc, 4)
  for (let w = 0; w < T.warehouses; w++) put(T.warehouses === 1 ? P.warehouseOffice : P.warehouse, (w - (T.warehouses - 1) / 2) * 48, -66, 0, yc, 22) // 22 m: the warehouse footprint (~36 x 18 m) clear of the template core (seed 21 audit: 10 core items inside a warehouse)

  // quay street parallel to the quay + link to the nearest road point
  const roads: Road[] = []
  const a0 = localToWorld(H, -H.apronHalf, H.streetV), a1 = localToWorld(H, H.apronHalf, H.streetV), mid = localToWorld(H, 0, H.streetV)
  roads.push({ id: `${o.id}_quay`, type: 'asphalt', pts: [round(a0[0]), round(a0[1]), round(mid[0]), round(mid[1]), round(a1[0]), round(a1[1])] })
  let best: [number, number] | null = null, bd = 1500
  // the link never runs through another zone (seed 21: a port link through a military base, 11 of its objects on it)
  const backAt = (d: number) => localToWorld(H, 0, H.streetV - Math.min(30, d / 2))
  const crosses = (x: number, z: number, d: number) => {
    const b = backAt(d)
    for (const q of o.avoid ?? []) for (const [ax, az, bx, bz] of [[mid[0], mid[1], b[0], b[1]], [b[0], b[1], x, z]]) {
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.z - az) * dz) / L)) : 0
      if (Math.hypot(q.x - ax - dx * t, q.z - az - dz * t) < q.r) return true
    }
    return false
  }
  for (const l of o.roads) for (let i = 0; i + 1 < l.length; i += 2) {
    const [, v] = toLocal(H, l[i], l[i + 1])
    if (v > H.streetV) continue // only roads inland of the street (never across the apron)
    const d = Math.hypot(l[i] - mid[0], l[i + 1] - mid[1])
    if (d < bd && !crosses(l[i], l[i + 1], d)) { bd = d; best = [l[i], l[i + 1]] }
  }
  if (best && bd > 5) {
    const back = localToWorld(H, 0, H.streetV - Math.min(30, bd / 2))
    roads.push({ id: `${o.id}_link`, type: 'asphalt', pts: [round(mid[0]), round(mid[1]), round(back[0]), round(back[1]), round(best[0]), round(best[1])] })
  }

  // 2D boxes (flat: h 0 keeps them out of the 3D blocks)
  const W = (pp: number[]) => { const out: number[] = []; for (let i = 0; i < pp.length; i += 2) out.push(...localToWorld(H, pp[i], pp[i + 1]).map(round)); return out }
  const strip = (u0: number, v0: number, u1: number, v1: number, hw: number) => {
    const L = Math.hypot(u1 - u0, v1 - v0) || 1, pu = (-(v1 - v0) / L) * hw, pv = ((u1 - u0) / L) * hw
    return W([u0 + pu, v0 + pv, u1 + pu, v1 + pv, u1 - pu, v1 - pv, u0 - pu, v0 - pv])
  }
  const boxes = [
    { corners: W(H.basin), role: 'basin', h: 0 },
    { corners: W([-H.apronHalf, -H.apronDepth, H.apronHalf, -H.apronDepth, H.apronHalf, 0, -H.apronHalf, 0]), role: 'apron', h: 0 },
    { corners: strip(-H.quayHalf, -2, H.quayHalf, -2, 2), role: 'quay', h: 0 },
    ...H.arms.map(([u0, v0, u1, v1]) => ({ corners: strip(u0, v0, u1, v1, 5), role: 'arm', h: 0 })),
    ...H.jetties.map(([u, v0, v1]) => ({ corners: strip(u, v0, u, v1, 2.4), role: 'jetty', h: 0 })),
  ]
  return { plan: H, entities: ents, roads, boxes }
}

/** tier from the nearest place: town -> port, village -> bourg, else fishing village */
export function harbourTier(kind: string | undefined): HarbourTier {
  return kind === 'town' ? 'port' : kind === 'village' ? 'bourg' : 'fishing'
}

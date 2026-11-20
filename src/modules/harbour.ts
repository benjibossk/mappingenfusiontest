// Harbours copied from the vanilla maps (analyses/HARBOUR_VANILLA.md). A whole Bohemia harbour (quay chains, piers,
// breakwaters, bollards, cranes, containers, sheds, boats) is taken from the parcel library (category 'harbour',
// library/parcels-harbour.json, PakTools/harbour_harvest.py) with every object's height and tilt: the quay deck is
// re-based at +2.2 m, sea level stays 0, so pieces keep their exact vanilla chaining and never float or sink.
// The ground is sculpted from the composition's own terrain samples: apron flat at +2.2 m behind the quay pieces,
// basin dredged to -7.5 m in front of them (vertical wall between), breakwater mound at -3 m, <= 12 m blend.
// The old version stamped vanilla_sites.json templates (dx / dz / yaw only, no height, 300 objects max) and added
// procedural quays turned 90° off: slabs across the water, breakwater pieces on the open sea (seed 21 review).
// Pure (no DOM). The terrain pass (applyHarbour) is called by zones.applyZones.

import type { Grid } from './island'
import type { Road } from './roads'
import type { ProjectEntity } from '../project'
import type { Composition } from '../library/schema'
import { toWorld, round, heightAt } from './gen-common'
import HARBOUR_JSON from '../../library/parcels-harbour.json' with { type: 'json' }

export type HarbourTier = 'fishing' | 'bourg' | 'port'

/** vanilla harbours (whole sites, heights included) */
export const HARBOUR_PARCELS = ((HARBOUR_JSON as unknown as { compositions: Composition[] }).compositions) ?? []

/** world-space record (JSON-safe) kept on the zone */
export interface HarbourPlan {
  tier: HarbourTier
  /** frame of the composition: local +Z = sea */
  ox: number; oz: number; yaw: number
  compo: string
  /** local terrain samples [u, v, cls, ...], cls 0 = apron, 1 = basin, 2 = breakwater mound, 3 = under a sea part (basin, wins over apron by 4 m) */
  samples: number[]
}

export const BASIN_H = -7.5
export const APRON_H = 2.2
export const MOUND_H = -3
/** PierConcrete_01_* origin below the deck (376 vanilla pieces: rails / cranes / containers stand at origin + 4.0) */
export const QUAY_DECK = 4.0
const CORE = 9, BLEND = 12
const CLS_H = [APRON_H, BASIN_H, MOUND_H, BASIN_H]
const BIAS = [0, 0, 3, 4]

/** sea parts that must stand in water: breakwaters, wooden / pile piers, dolphins, buoys */
export const PORT_SEA_RX = /\/Naval\/(Breakwater|Piers\/MooringDolphin|Piers\/Pier_?Wood|Piers\/PierWooden)|\/Naval\/Buoy_01_(red|green)|MooringBuoy/i
export const QUAY_RX = /Piers\/PierConcrete_01_(20m|10m_end|corner_\w+|flat)\.et/i
const BREAKWATER_RX = /\/Naval\/Breakwater\//i
/** everything naval or floating: never judged as a land prop */
const WET_RX = /Light(Tower|house|Beacon)|\/Naval\/|MooringBuoy|FishingBuoy|Wreck|Slipway|PierConcrete|Ladder_Pier|Davit|HarborWinch|PedalBoat/i

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

/** world -> local (u = right, v = forward = sea) of a plan frame */
export function toLocal(H: { ox: number; oz: number; yaw: number }, x: number, z: number): [number, number] {
  const a = H.yaw * Math.PI / 180, fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a)
  const dx = x - H.ox, dz = z - H.oz
  return [dx * rx + dz * rz, dx * fx + dz * fz]
}
export const localToWorld = (H: { ox: number; oz: number; yaw: number }, u: number, v: number) => toWorld(H.ox, H.oz, H.yaw, u, v)

/** sample buckets (8 m) for the nearest-sample lookup */
function index(H: HarbourPlan) {
  const m = new Map<string, number[]>()
  for (let i = 0; i < H.samples.length; i += 3) {
    const k = `${Math.floor(H.samples[i] / 8)},${Math.floor(H.samples[i + 1] / 8)}`
    let b = m.get(k); if (!b) m.set(k, (b = [])); b.push(i)
  }
  const R = Math.ceil((CORE + BLEND) / 8)
  return (u: number, v: number) => {
    const cu = Math.floor(u / 8), cv = Math.floor(v / 8)
    let d = Infinity, c = -1
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const i of m.get(`${cu + a},${cv + b}`) ?? []) {
      const q = Math.max(0, Math.hypot(H.samples[i] - u, H.samples[i + 1] - v) - BIAS[H.samples[i + 2]])
      if (q < d) { d = q; c = H.samples[i + 2] }
    }
    return { d, c }
  }
}
function harbourBox(H: HarbourPlan) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < H.samples.length; i += 3) {
    const [x, z] = localToWorld(H, H.samples[i], H.samples[i + 1])
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
  }
  const p = CORE + BLEND
  return { x0: x0 - p, z0: z0 - p, x1: x1 + p, z1: z1 + p }
}
/** target height of a point, or null (natural ground). `h` = natural height there */
function target(near: ReturnType<typeof index>, H: HarbourPlan, x: number, z: number, h: number, sharpOnly = false): number | null {
  const [u, v] = toLocal(H, x, z), { d, c } = near(u, v)
  if (c < 0 || d > CORE + BLEND) return null
  const t = c === 1 || c === 3 ? Math.min(h, BASIN_H) : CLS_H[c]
  if (d <= CORE) return t
  if (sharpOnly) return null
  return t + ((h - t) * (d - CORE)) / BLEND
}

/** harbour terrain, in place: apron +2.2, basin -7.5 (deeper sea kept), breakwater mound -3, blended to nature */
export function applyHarbour(heights: number[], g: Grid, H: HarbourPlan) {
  if (!H.samples?.length) return
  const { x0, z0, x1, z1 } = harbourBox(H), near = index(H)
  const c0 = Math.max(0, Math.floor((x0 - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((x1 - g.minX) / g.step))
  const r0 = Math.max(0, Math.floor((z0 - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((z1 - g.minZ) / g.step))
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const i = r * g.cols + c, t = target(near, H, g.minX + c * g.step, g.minZ + r * g.step, heights[i])
    if (t !== null) heights[i] = t
  }
}

/** a finer height patch over the harbour (the main grid is 8 m: the quay wall becomes a ramp). Written by the
 *  bridge as heightpatch.txt, sampled first by MG_HeightmapApplier. Flats exact, the rest = the coarse result. */
export interface HeightPatch { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] }
export function harbourPatch(heights: ArrayLike<number>, g: Grid, H: HarbourPlan, step = 2): HeightPatch {
  const b = harbourBox(H), minX = Math.floor(b.x0 / step) * step, minZ = Math.floor(b.z0 / step) * step
  const cols = Math.ceil((b.x1 - minX) / step) + 1, rows = Math.ceil((b.z1 - minZ) / step) + 1, out: number[] = []
  const near = index(H)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = minX + c * step, z = minZ + r * step, h = heightAt(heights, g, x, z)
    const t = target(near, H, x, z, h, true)
    out.push(Math.round((t ?? h) * 100) / 100)
  }
  return { minX, minZ, step, cols, rows, heights: out }
}

/** harbour composition for a tier (fishing: small wooden sites; bourg / port: concrete quays). `maxR`: footprint */
export function pickHarbour(tier: HarbourTier, seed: number, maxR = 200): Composition | null {
  const r = (c: Composition) => Math.hypot(c.size.w, c.size.d) / 2
  // deck 1.5-3 m: a real concrete quay (Arland 3205 / 1089 sit at -0.2 / 1.2, re-basing them floats their breakwaters)
  const ok = HARBOUR_PARCELS.filter((c) => r(c) <= maxR && Math.abs(((c as { deck?: number }).deck ?? 2.2) - 2.2) <= 0.8)
  const quay = ok.filter((c) => c.tags.includes('quay') && c.items.filter((i) => QUAY_RX.test(i.prefab)).length >= (tier === 'fishing' ? 0 : 20))
  const list = (tier === 'fishing' ? ok : quay).length ? (tier === 'fishing' ? ok : quay) : ok
  return list.length ? list[Math.abs(Math.floor(seed)) % list.length] : null
}

export interface HarbourBuild { plan: HarbourPlan; entities: ProjectEntity[]; roads: Road[]; boxes: { corners: number[]; role: string; h?: number }[] }

/** stamps a vanilla harbour composition at (x, z), its sea side (+Z) turned to `yaw`: every object at its vanilla
 *  height (ycm, deck +2.2) and tilt, the terrain samples kept on the plan, an access road from the inland edge of
 *  the apron to the nearest road that does not cross another zone. */
export function buildHarbour(o: {
  id: string; tier: HarbourTier; x: number; z: number; yaw: number; compo: Composition
  roads: ArrayLike<number>[]
  avoid?: { x: number; z: number; r: number }[]
}): HarbourBuild {
  const C = o.compo as Composition & { terrain?: (number | string)[][] }
  const H: HarbourPlan = { tier: o.tier, ox: o.x, oz: o.z, yaw: o.yaw, compo: C.id, samples: [] }
  for (const [u, v, c] of C.terrain ?? []) H.samples.push(Number(u), Number(v), c === 'L' ? 0 : c === 'B' ? 2 : c === 'W' ? 3 : 1)
  const ents: ProjectEntity[] = C.items.map((it, k) => {
    const [x, z] = localToWorld(H, it.x, it.z)
    const e: ProjectEntity = { id: `${o.id}-h${k}`, prefab: it.prefab, x: round(x), z: round(z), yaw: round((((o.yaw + it.yaw) % 360) + 360) % 360), ycm: Math.round(it.y * 100) || 1 } // 0 would read as "on the terrain" (floating buoys on the seabed)
    const t = it as { pitch?: number; roll?: number }
    if (t.pitch) e.pitch = t.pitch
    if (t.roll) e.roll = t.roll
    return e
  })
  // access: from the most inland apron sample near the middle to the nearest road point inland of it
  const roads: Road[] = []
  let st: [number, number] | null = null, sv = Infinity
  for (let i = 0; i < H.samples.length; i += 3) if (H.samples[i + 2] === 0) {
    const s = H.samples[i + 1] + Math.abs(H.samples[i]) * 0.5
    if (s < sv) { sv = s; st = [H.samples[i], H.samples[i + 1]] }
  }
  if (st) {
    const a = localToWorld(H, st[0], st[1]), b0 = localToWorld(H, st[0], st[1] - 20)
    const crosses = (x: number, z: number) => (o.avoid ?? []).some((q) => {
      const dx = x - b0[0], dz = z - b0[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((q.x - b0[0]) * dx + (q.z - b0[1]) * dz) / L)) : 0
      return Math.hypot(q.x - b0[0] - dx * t, q.z - b0[1] - dz * t) < q.r
    })
    let best: [number, number] | null = null, bd = 1500
    for (const l of o.roads) for (let i = 0; i + 1 < l.length; i += 2) {
      if (toLocal(H, l[i], l[i + 1])[1] > st[1] - 20) continue
      const d = Math.hypot(l[i] - a[0], l[i + 1] - a[1])
      if (d < bd && !crosses(l[i], l[i + 1])) { bd = d; best = [l[i], l[i + 1]] }
    }
    if (best && bd > 25) roads.push({ id: `${o.id}_link`, type: 'dirt', pts: [round(b0[0]), round(b0[1]), round(best[0]), round(best[1])] })
  }
  const w = C.size.w / 2, d = C.size.d / 2
  const boxes = [{ corners: [[-w, -d], [w, -d], [w, d], [-w, d]].flatMap(([u, v]) => localToWorld(H, u, v).map(round)), role: 'harbour', h: 0 }]
  return { plan: H, entities: ents, roads, boxes }
}

/** tier from the nearest place: town -> port, village -> bourg, else fishing village */
export function harbourTier(kind: string | undefined): HarbourTier {
  return kind === 'town' ? 'port' : kind === 'village' ? 'bourg' : 'fishing'
}

export interface HarbourIssue { kind: 'floating' | 'sunk' | 'pierMisaligned' | 'breakwaterIsolated' | 'inWater' | 'seaDry'; id: string; x: number; z: number; value?: number }
/** pre-send harbour checks on the entities of a harbour zone, `hAt` = final terrain:
 *  floating / sunk: quay pieces outside deck - 4.0 -1.5..+3.5 m (vanilla raised heads +3.1), breakwaters outside -10..-1.5 m, land props > 0.8 m off
 *  the ground; pierMisaligned: a concrete quay piece without a neighbour (<= 22 m) at a multiple of 30° (±3°);
 *  breakwaterIsolated: a breakwater piece with nothing (breakwater / quay) within 26 m; inWater: a land prop over
 *  the sea; seaDry: a sea part on dry ground. */
export function harbourIssues(ents: ProjectEntity[], hAt: (x: number, z: number) => number): HarbourIssue[] {
  const out: HarbourIssue[] = []
  const quay = ents.filter((e) => QUAY_RX.test(e.prefab)), bw = ents.filter((e) => BREAKWATER_RX.test(e.prefab))
  const y = (e: ProjectEntity) => (e.ycm ?? hAt(e.x, e.z) * 100) / 100
  const near = (e: ProjectEntity, L: ProjectEntity[], r: number) => L.filter((q) => q !== e && Math.hypot(q.x - e.x, q.z - e.z) <= r)
  for (const e of quay) {
    const dy = y(e) - (APRON_H - QUAY_DECK)
    if (dy < -1.5 || dy > 3.5) out.push({ kind: dy > 0 ? 'floating' : 'sunk', id: e.id, x: e.x, z: e.z, value: round(dy) })
    const nb = near(e, quay, 22)
    if (!nb.some((q) => { const a = ((((q.yaw - e.yaw) % 30) + 30) % 30); return a < 3 || a > 27 })) out.push({ kind: 'pierMisaligned', id: e.id, x: e.x, z: e.z })
  }
  for (const e of bw) {
    const b = y(e)
    if (b > -1.5 || b < -10) out.push({ kind: b > -1.5 ? 'floating' : 'sunk', id: e.id, x: e.x, z: e.z, value: round(b) })
    if (!near(e, [...bw, ...quay], 26).length) out.push({ kind: 'breakwaterIsolated', id: e.id, x: e.x, z: e.z })
  }
  for (const e of ents) {
    // breakwaters are exempt: vanilla revetments line the apron edge (Everon: terrain p90 +2.2 under their origin)
    if (PORT_SEA_RX.test(e.prefab)) { if (!BREAKWATER_RX.test(e.prefab) && hAt(e.x, e.z) > 0.3) out.push({ kind: 'seaDry', id: e.id, x: e.x, z: e.z, value: round(hAt(e.x, e.z)) }); continue }
    if (WET_RX.test(e.prefab)) continue
    const g = hAt(e.x, e.z)
    if (g <= 0) { out.push({ kind: 'inWater', id: e.id, x: e.x, z: e.z, value: round(g) }); continue }
    const dy = y(e) - g
    if (dy < -0.8) out.push({ kind: 'sunk', id: e.id, x: e.x, z: e.z, value: round(dy) })
    else if (dy > 0.8 && !/Container|Crate|Pallet|Shell|MetalSheet|Plank|Stack/i.test(e.prefab)) out.push({ kind: 'floating', id: e.id, x: e.x, z: e.z, value: round(dy) })
  }
  return out
}

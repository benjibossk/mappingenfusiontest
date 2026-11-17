// Trees of the open countryside (#8, AgriFieldGenerator): isolated trees standing in the plots, small
// clumps (2-4 trees) at some plot corners and trees along the hedgerows. Single vanilla tree prefabs
// (src/data/biomes.ts VEG) picked from the biome's tree list, so the fields read like a real bocage.

import { biome, VEG, type Weighted } from '../data/biomes'
import type { ProjectEntity } from '../project'

export interface FieldTreeOptions {
  /** plots (rings of [x, z]) and hedges (polylines of [x, z]) from fillFieldZone */
  fields: number[][][]
  hedges: number[][][]
  seed: number
  /** 0 = none, 1 = default, 2 = twice as many */
  density: number
  biome?: string
  /** free ground (land, no road, no building...) */
  ok: (x: number, z: number) => boolean
  prefix?: string
}

/** field / hedgerow species of a biome: its broadleaves first (conifers rarely stand alone in a field) */
export function fieldSpecies(id?: string): Weighted[] {
  const b = (id && biome(id)) || biome('temperate_everon')
  const conifer = /pinus|picea|larix/i
  const all = b?.vegetation.trees ?? []
  const broad = all.filter((q) => !conifer.test(q.p))
  return broad.length ? broad : all.length ? all : [{ p: VEG.lime, w: 1 }, { p: VEG.hornbeam, w: 1 }]
}

function inRing(f: number[][], x: number, z: number) {
  let c = false
  for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
    const [xi, zi] = f[i], [xj, zj] = f[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

export function fieldTrees(o: FieldTreeOptions): ProjectEntity[] {
  const out: ProjectEntity[] = []
  if (!(o.density > 0)) return out
  let s = (o.seed >>> 0) % 2147483646 || 1
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const sp = fieldSpecies(o.biome), tot = sp.reduce((a, q) => a + q.w, 0)
  const pick = () => { let r = rnd() * tot; for (const q of sp) if ((r -= q.w) <= 0) return q.p; return sp[0].p }
  const pre = o.prefix ?? 'TREE_FIELD_'
  const taken: number[] = [] // flat x z of placed trees
  const free = (x: number, z: number, gap: number) => {
    for (let i = 0; i < taken.length; i += 2) if (Math.hypot(taken[i] - x, taken[i + 1] - z) < gap) return false
    return o.ok(x, z)
  }
  const put = (x: number, z: number, gap: number) => {
    if (!free(x, z, gap)) return false
    taken.push(x, z)
    out.push({ id: `${pre}${out.length + 1}`, prefab: pick(), x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(rnd() * 360) - 180 })
    return true
  }
  const d = Math.min(3, o.density)
  // 1. isolated trees: one in about a plot out of six, well inside it (the plough turns around it)
  for (const f of o.fields) {
    if (rnd() > 0.16 * d || f.length < 3) continue
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const [x, z] of f) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z) }
    for (let k = 0; k < 12; k++) {
      const x = minX + (maxX - minX) * (0.2 + rnd() * 0.6), z = minZ + (maxZ - minZ) * (0.2 + rnd() * 0.6)
      if (inRing(f, x, z) && put(x, z, 25)) break
    }
  }
  // 2. clumps of 2-4 trees at some plot corners (outside the plot)
  for (const f of o.fields) {
    if (rnd() > 0.08 * d || f.length < 3) continue
    let cx = 0, cz = 0
    for (const q of f) { cx += q[0]; cz += q[1] }
    cx /= f.length; cz /= f.length
    const q = f[Math.floor(rnd() * f.length)], L = Math.hypot(q[0] - cx, q[1] - cz) || 1
    const bx = q[0] + ((q[0] - cx) / L) * 6, bz = q[1] + ((q[1] - cz) / L) * 6
    const n = 2 + Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, r = 3 + rnd() * 5; put(bx + Math.cos(a) * r, bz + Math.sin(a) * r, 5) }
  }
  // 3. hedgerow trees: on the hedge line every ~45 m / density, a gap in about a third of the slots
  const step = 45 / d
  for (const h of o.hedges) {
    let carry = step * (0.3 + rnd() * 0.7)
    for (let i = 0; i + 1 < h.length; i++) {
      const [ax, az] = h[i], [bx, bz] = h[i + 1], L = Math.hypot(bx - ax, bz - az)
      let t = carry
      while (t < L) {
        if (rnd() > 0.35) put(ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L, 12)
        t += step * (0.7 + rnd() * 0.6)
      }
      carry = t - L
    }
  }
  return out
}

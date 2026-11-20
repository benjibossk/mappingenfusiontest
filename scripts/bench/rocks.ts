// Rocks bench (ROCKS_VANILLA.md): cliffRocks on the vanilla relief vs the vanilla rocks.
// Score = mean of (a) overlap of the slope histograms (5 deg bins) of the big pieces (GraniteRock + GraniteCliff)
// and (b) min/max ratio of their density per km2 of land. Also reports the land slope histogram (ours on the
// 8 m ref grid vs vanilla 2 m) so a threshold drift shows.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliffRocks, rockKind } from '../../src/modules/cliffRocks'

interface VRocks { landKm2: number; perKm2: Record<string, number>; bigSlopeHist: number[]; landSlopeHist: number[] }
const V: Record<string, VRocks> = JSON.parse(readFileSync(join(import.meta.dirname, 'vanilla-rocks.json'), 'utf8'))

const hist = (v: number[]) => { const c = new Array(10).fill(0); for (const s of v) c[Math.min(9, Math.floor(s / 5))]++; return c.map((n) => +((100 * n) / Math.max(1, v.length)).toFixed(1)) }
const deg = (t: number) => (Math.atan(t) * 180) / Math.PI

export function rocksBench(mapId: string, box: { minX: number; minZ: number; maxX: number; maxZ: number }, hAt: (x: number, z: number) => number, ok: (x: number, z: number) => boolean) {
  const v = V[mapId]
  if (!v) return null
  const sl = (x: number, z: number) => Math.hypot(hAt(x + 4, z) - hAt(x - 4, z), hAt(x, z + 4) - hAt(x, z - 4)) / 8
  const land: number[] = []
  for (let z = box.minZ + 8; z < box.maxZ; z += 16) for (let x = box.minX + 8; x < box.maxX; x += 16) if (hAt(x, z) > 0.5) land.push(deg(sl(x, z)))
  const landKm2 = (land.length * 256) / 1e6
  const es = cliffRocks({ box, heightAt: hAt, ok, seed: 1, max: Math.round(400 * landKm2) })
  const big = es.filter((e) => { const k = rockKind(e.prefab); return k === 'rock' || k === 'cliff' })
  const bh = hist(big.map((e) => deg(sl(e.x, e.z))))
  const overlap = bh.reduce((a, p, i) => a + Math.min(p, v.bigSlopeHist[i]), 0)
  const ours = big.length / landKm2, van = (v.perKm2.rock ?? 0) + (v.perKm2.cliff ?? 0)
  const ratio = ours && van ? Math.min(ours, van) / Math.max(ours, van) : 0
  const byKind: Record<string, number> = {}
  for (const e of es) { const k = rockKind(e.prefab) ?? 'other'; byKind[k] = (byKind[k] ?? 0) + 1 }
  for (const k of Object.keys(byKind)) byKind[k] = +(byKind[k] / landKm2).toFixed(1)
  return {
    score: +((overlap + 100 * ratio) / 2).toFixed(1),
    perKm2: { ours: +ours.toFixed(1), vanilla: van, byKind },
    bigSlopeHist: { ours: bh, vanilla: v.bigSlopeHist },
    landSlopeHist: { ours: hist(land), vanilla: v.landSlopeHist },
    count: es.length,
  }
}

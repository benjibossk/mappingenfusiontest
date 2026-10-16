// Tree height from a LiDAR canopy height model (CHM: height of the vegetation above the ground, metres).
// Reforger cannot set a tree height: it only picks between vanilla forest generators, young / normal /
// mature. So each forest area gets a height class from the median canopy height inside it.

import { sample, type Dem } from './dem'

export type Tall = 'low' | 'mid' | 'high'
export const TALL_LOW = 8 // m, below: young forest / nursery
export const TALL_HIGH = 18 // m, above: mature forest

export function tallOf(h: number): Tall {
  if (h < TALL_LOW) return 'low'
  if (h < TALL_HIGH) return 'mid'
  return 'high'
}

/** sets `tall` on each forest (local metres, open ring); toSrc turns a local point into CHM coordinates */
export function canopyClasses(forests: { pts: number[]; tall?: Tall }[], chm: Dem, toSrc: (x: number, z: number) => [number, number]) {
  for (const f of forests) {
    const p = f.pts
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]) }
    // about 400 samples per forest, never closer than 5 m
    const step = Math.max(5, Math.sqrt(((x1 - x0) * (z1 - z0)) / 400))
    const hs: number[] = []
    for (let z = z0 + step / 2; z < z1; z += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (!inside(p, x, z)) continue
        const [sx, sy] = toSrc(x, z)
        const h = sample(chm, sx, sy)
        if (h > 2) hs.push(h) // under 2 m: gaps, paths, clearings
      }
    }
    if (hs.length < 5) continue
    hs.sort((a, b) => a - b)
    f.tall = tallOf(hs[hs.length >> 1])
  }
}

function inside(p: number[], x: number, z: number) {
  let r = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > z !== p[j + 1] > z && x < p[i] + ((z - p[i + 1]) * (p[j] - p[i])) / (p[j + 1] - p[i + 1])) r = !r
  }
  return r
}

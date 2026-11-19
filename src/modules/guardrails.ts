// PLAN_RESTANT #17: crash barriers the embankment rule of roads.ts roadFurniture does not cover.
// roadFurniture already rails a side where the ground drops > `drop` (1.8 m default) next to a paved road.
// This adds, on paved roads:
// - bridge approaches: both sides, APPROACH m on the land side of each abutment (valley spans `road.spans`
//   and the water gaps of the export), the rail meeting the deck railing as on Everon's bridges;
// - the outer side of a sharp bend (> 25 deg over +-30 m) on a slope, where the outer side falls more
//   than `bendDrop` (1 m) but less than the embankment threshold (posts used to stand there).
// Same vanilla generators and lateral offset as roadFurniture (WG_CrashBarrier_*, edge + 1.5 m, measured on
// Everon / Kolguyev in sites_analysis.py); the generator spaces the 3 m segments itself (CrashBarrier_E_01_3m).
// Ids carry _BAR_ so the 2D furniture layer and the info line count them.
import { barrierFor, BARRIERS, centreLine, isPaved, offsetLine, roadHalf, type Road } from './roads'
import { arcLength } from './roadgeom'
import type { ProjectShape } from '../project'

export const GUARDRAIL = { approach: 24, bendDrop: 1.0, sharpDeg: 25, offset: 1.5, minLen: 12 }

export interface Gap { id: string; from: [number, number]; to: [number, number] }

const round = (a: number[]) => a.map((v) => Math.round(v * 100) / 100)
const reverse = (p: number[]) => { const o: number[] = []; for (let k = p.length - 2; k >= 0; k -= 2) o.push(p[k], p[k + 1]); return o }

//! polylines of `line` over the index runs where keep(i) holds, at least minLen metres
function pieces(line: number[], keep: (i: number) => boolean, minLen: number): number[][] {
  const out: number[][] = []
  let cur: number[] = [], len = 0
  const flush = () => { if (cur.length >= 4 && len >= minLen) out.push(cur); cur = []; len = 0 }
  for (let i = 0; i < line.length / 2; i++) {
    if (!keep(i)) { flush(); continue }
    if (cur.length) len += Math.hypot(line[i * 2] - cur[cur.length - 2], line[i * 2 + 1] - cur[cur.length - 1])
    cur.push(line[i * 2], line[i * 2 + 1])
  }
  flush()
  return out
}

export function extraGuardrails(roads: Road[], heightAt: (x: number, z: number) => number, gaps: Gap[] = [], o: { drop?: number; bendDrop?: number } = {}): ProjectShape[] {
  const drop = o.drop ?? 1.8, bendDrop = o.bendDrop ?? GUARDRAIL.bendDrop
  const shapes: ProjectShape[] = []
  for (const road of roads) {
    if (!isPaved(road.type) || road.pts.length < 4 || road.bridge) continue
    const line = centreLine(road.pts, 5), n = line.length / 2
    if (n < 3) continue
    const arc = arcLength(line)
    const gen = barrierFor(road)
    const orient = (p: number[]) => (gen === BARRIERS.rusty ? reverse(p) : p)
    // abutments: valley spans (arc length along centreLine(pts, 5)) and export water gaps of this road
    const ends: { s: number; away: 1 | -1 }[] = []
    for (const sp of road.spans ?? []) ends.push({ s: sp.from, away: -1 }, { s: sp.to, away: 1 })
    const near = (x: number, z: number) => {
      let bi = 0, bd = Infinity
      for (let i = 0; i < n; i++) { const d = Math.hypot(line[i * 2] - x, line[i * 2 + 1] - z); if (d < bd) { bd = d; bi = i } }
      return { s: arc[bi], d: bd }
    }
    for (const g of gaps) {
      if (g.id !== road.id) continue
      const a = near(g.from[0], g.from[1]), b = near(g.to[0], g.to[1])
      if (a.d > 15 || b.d > 15) continue
      const lo = Math.min(a.s, b.s), hi = Math.max(a.s, b.s)
      ends.push({ s: lo, away: -1 }, { s: hi, away: 1 })
    }
    const total = arc[n - 1]
    const approach = (i: number) => ends.some((e) => {
      const d = (arc[i] - e.s) * e.away
      return d >= -1 && d <= GUARDRAIL.approach && arc[i] > 0 && arc[i] < total
    })
    // signed turn over +-30 m (> 0 = right turn), spread over +-3 points like roadFurniture
    const head = (k: number) => { const a = Math.min(Math.max(k, 0), n - 2); return Math.atan2(line[a * 2 + 2] - line[a * 2], line[a * 2 + 3] - line[a * 2 + 1]) }
    const turn = Array.from({ length: n }, (_, k) => { const t = head(k + 3) - head(k - 3); return Math.atan2(Math.sin(t), Math.cos(t)) })
    const bend = turn.map((_, k) => { let best = 0; for (let j = Math.max(0, k - 3); j <= Math.min(n - 1, k + 3); j++) if (Math.abs(turn[j]) > Math.abs(best)) best = turn[j]; return best })
    const sharp = (GUARDRAIL.sharpDeg * Math.PI) / 180
    const half = roadHalf(road)
    for (const side of [1, -1] as const) {
      const rail = offsetLine(line, side * (half + GUARDRAIL.offset))
      const n6 = offsetLine(line, side * (half + 6)), n15 = offsetLine(line, side * (half + 15))
      const fall = (i: number) => {
        const h = heightAt(line[i * 2], line[i * 2 + 1])
        return Math.max(h - heightAt(n6[i * 2], n6[i * 2 + 1]), (h - heightAt(n15[i * 2], n15[i * 2 + 1])) * 0.5)
      }
      const tag = side > 0 ? 'L' : 'R'
      pieces(rail, approach, GUARDRAIL.minLen).forEach((p, k) =>
        shapes.push({ id: `${road.id}_BAR_A${tag}${k}`, kind: 'polyline', closed: false, points: round(orient(p)), generator: gen }))
      // the embankment rail of roadFurniture already covers fall > drop
      const bendRail = (i: number) => !approach(i) && Math.abs(bend[i]) > sharp && Math.sign(bend[i]) === side && fall(i) > bendDrop && fall(i) <= drop
      pieces(rail, bendRail, GUARDRAIL.minLen + 8).forEach((p, k) =>
        shapes.push({ id: `${road.id}_BAR_B${tag}${k}`, kind: 'polyline', closed: false, points: round(orient(p)), generator: gen }))
    }
  }
  return shapes
}

//! verge-post runs (`_POST_`) where an extra rail now stands are cut out (a post line behind a rail looks wrong)
export function dropCoveredPosts(shapes: ProjectShape[], rails: ProjectShape[], r = 2.5): ProjectShape[] {
  const pts = rails.flatMap((s) => { const o: [number, number][] = []; for (let i = 0; i + 1 < s.points.length; i += 2) o.push([s.points[i], s.points[i + 1]]); return o })
  if (!pts.length) return shapes
  const covered = (x: number, z: number) => pts.some(([px, pz]) => Math.abs(px - x) < r + 3 && Math.abs(pz - z) < r + 3 && Math.hypot(px - x, pz - z) < r + 2.5)
  const out: ProjectShape[] = []
  for (const s of shapes) {
    if (!s.id.includes('_POST_')) { out.push(s); continue }
    let cur: number[] = [], k = 0
    const flush = () => { if (cur.length >= 4) out.push({ ...s, id: k ? `${s.id}_${k}` : s.id, points: cur }); if (cur.length >= 4) k++; cur = [] }
    for (let i = 0; i + 1 < s.points.length; i += 2) {
      if (covered(s.points[i], s.points[i + 1])) flush()
      else cur.push(s.points[i], s.points[i + 1])
    }
    flush()
  }
  return out
}

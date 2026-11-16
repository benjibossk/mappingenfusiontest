// Road network V2, stage 7: bridges over rivers and valleys, with the real vanilla prefabs.
// - findCrossings: where a road profile runs high over the ground (valley) or over water (river) -> spans
// - splitAtBridges: the road is cut at the abutments (the terrain under the deck is never carved: no road there)
// - planBridge: deck pieces end to end (ConcreteBridge_01 Narrow 13 m / Narrow_Long 26 m / Wide 26 m,
//   BridgeConcrete_E_01_small 13 m, PierWooden_02_bridge 50 m for dirt), span rounded to whole pieces by moving
//   the abutments, a pier under every joint where the deck is > 1.5 m above the ground, stacked when needed.
// Measures: docs/FINDINGS.md §2 (pivot at one end along +X, deck top +0.13, bottom -1.3, pillar Y -4.3..7.05).
// Same prefabs and placement convention as water.ts bridges() (gaps over water at export).
import { centreLine, type Road } from './roads'
import { arcLength } from './roadgeom'
import type { ProjectEntity } from '../project'

export const BRIDGE_PREFABS = {
  narrow: '{9B69E8736502C4B2}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Narrow_PillarSmall.et',
  narrowLong: '{D97095FEEDBD5613}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Narrow_Long_PillarSmall.et',
  wide: '{D15C35F865541979}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Wide_PillarBig.et',
  pillar: '{FF4D386515F942C0}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Pillar.et',
  pillarNarrow: '{93575223CBE0E68D}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Pillar_narrow.et',
  small: '{6DF062B77D4F27B5}Prefabs/Structures/Infrastructure/Bridges/BridgeConcrete_E_01_small/BridgeConcrete_E_01_small.et',
  wooden: '{2D0A93C80A6A5C5D}Prefabs/Structures/Infrastructure/Naval/Piers/PierWooden_02/PierWooden_02_bridge.et',
}
const DECK_TOP = 0.13, DECK_BOTTOM = 1.3
const PILLAR_TOP = 7.05, PILLAR_BOTTOM = 4.3, PILLAR_H = PILLAR_TOP + PILLAR_BOTTOM // 11.35 m
const WOOD_LEN = 50.3, WOOD_LEGS = 14.4

export interface Crossing { from: number; to: number; kind: 'water' | 'valley'; i0: number; i1: number }

//! Spans of a centre line where the road needs a bridge: over water (wet), or where the road profile y
//! stands more than `clear` metres above the ground for at least `minLen` metres. Each span is widened to the
//! last points where the road is back near the ground (the abutments sit on the banks).
export function findCrossings(line: number[], y: number[], ground: number[], o: { wet?: (x: number, z: number) => boolean; clear?: number; minLen?: number; bank?: number } = {}): Crossing[] {
  const s = arcLength(line), m = s.length
  const clear = o.clear ?? 4, minLen = o.minLen ?? 10, bank = o.bank ?? 0.5
  const wet = (i: number) => !!o.wet?.(line[i * 2], line[i * 2 + 1])
  const high = (i: number) => y[i] - ground[i] > clear
  const out: Crossing[] = []
  let i = 0
  while (i < m) {
    if (!wet(i) && !high(i)) { i++; continue }
    let j = i
    let anyWet = false
    while (j < m && (wet(j) || high(j) || y[j] - ground[j] > bank)) { anyWet ||= wet(j); j++ }
    let a = i
    while (a > 0 && y[a - 1] - ground[a - 1] > bank) a--
    const i0 = Math.max(0, a - 1), i1 = Math.min(m - 1, j)
    if (anyWet || s[i1] - s[i0] >= minLen) {
      const last = out[out.length - 1]
      if (last && i0 <= last.i1) { last.i1 = i1; last.to = s[i1]; if (anyWet) last.kind = 'water' } // touching spans: one bridge
      else out.push({ from: s[i0], to: s[i1], i0, i1, kind: anyWet ? 'water' : 'valley' })
    }
    i = j + 1
  }
  return out
}

//! Cuts a road at its bridge spans (arc length along centreLine(pts, spacing)). The pieces are plain roads (same
//! style, ids suffixed _A, _B...), the gaps come back as abutment pairs for planBridge.
export function splitAtBridges(road: Road, spans: { from: number; to: number }[], spacing = 5): { roads: Road[]; gaps: { id: string; from: [number, number]; to: [number, number] }[] } {
  if (!spans.length) return { roads: [road], gaps: [] }
  const line = centreLine(road.pts, spacing), s = arcLength(line)
  const at = (d: number): [number, number] => {
    let k = 1
    while (k < s.length - 1 && s[k] < d) k++
    const t = (d - s[k - 1]) / Math.max(1e-9, s[k] - s[k - 1])
    return [line[k * 2 - 2] + (line[k * 2] - line[k * 2 - 2]) * t, line[k * 2 - 1] + (line[k * 2 + 1] - line[k * 2 - 1]) * t]
  }
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const roads: Road[] = [], gaps: { id: string; from: [number, number]; to: [number, number] }[] = []
  let start = 0, part = 0
  const piece = (d0: number, d1: number) => {
    if (d1 - d0 < 1) return
    const pts = [...at(d0)]
    for (let k = 0; k < s.length; k++) if (s[k] > d0 + 0.5 && s[k] < d1 - 0.5) pts.push(line[k * 2], line[k * 2 + 1])
    pts.push(...at(d1))
    roads.push({ ...road, id: `${road.id}_${String.fromCharCode(65 + part++)}`, pts })
  }
  sorted.forEach((sp, k) => {
    piece(start, sp.from)
    gaps.push({ id: `${road.id}_GAP${k}`, from: at(sp.from), to: at(sp.to) })
    start = sp.to
  })
  piece(start, s[s.length - 1])
  return { roads, gaps }
}

export interface BridgePlan {
  entities: ProjectEntity[]
  pieces: string[] // prefab per deck piece
  length: number // total deck length (m)
  from: [number, number] // abutments after rounding the span to whole pieces
  to: [number, number]
  piers: number
  tooHigh: boolean // a joint needs more than two stacked piers: flag it (checker)
}

//! Bridge between two abutments, deck top at `top` metres. half: road half width; dirt: wooden bridge.
//! `over`: metres of deck resting on each bank. Pieces are laid along the yaw rounded to the degree
//! (the yaw sent is whole degrees, FINDINGS §2).
export function planBridge(id: string, a: [number, number], b: [number, number], top: number, half: number, heightAt: (x: number, z: number) => number, o: { dirt?: boolean; over?: number } = {}): BridgePlan {
  const over = o.over ?? 4
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1
  const r2 = (v: number) => Math.round(v * 100) / 100
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2
  const entities: ProjectEntity[] = []
  if (o.dirt) {
    const wy = Math.round((Math.atan2(dx, dz) * 180) / Math.PI)
    const wx = Math.sin((wy * Math.PI) / 180), wz = Math.cos((wy * Math.PI) / 180)
    const n = Math.max(1, Math.ceil((L + 2 * over) / WOOD_LEN)), total = n * WOOD_LEN
    let tooHigh = false
    for (let j = 0; j < n; j++) {
      const off = (j - (n - 1) / 2) * WOOD_LEN, x = cx + wx * off, z = cz + wz * off
      if (top - heightAt(x, z) > WOOD_LEGS) tooHigh = true
      entities.push({ id: `${id}_BRIDGE_WOOD_${j}`, prefab: BRIDGE_PREFABS.wooden, x: r2(x), z: r2(z), yaw: wy, ycm: Math.round(top * 100) })
    }
    return { entities, pieces: entities.map((e) => e.prefab), length: total, from: [cx - (wx * total) / 2, cz - (wz * total) / 2], to: [cx + (wx * total) / 2, cz + (wz * total) / 2], piers: 0, tooHigh }
  }
  const need = L + 2 * over
  let pieces: { prefab: string; len: number }[]
  if (half <= 2.4 && need <= 13) pieces = [{ prefab: BRIDGE_PREFABS.small, len: 13 }]
  else if (half > 4.5) pieces = Array.from({ length: Math.ceil(need / 26) }, () => ({ prefab: BRIDGE_PREFABS.wide, len: 26 }))
  else {
    pieces = Array.from({ length: Math.floor(need / 26) }, () => ({ prefab: BRIDGE_PREFABS.narrowLong, len: 26 }))
    const rest = need - pieces.length * 26
    if (rest > 13) pieces.push({ prefab: BRIDGE_PREFABS.narrowLong, len: 26 })
    else if (rest > 0) pieces.push({ prefab: BRIDGE_PREFABS.narrow, len: 13 })
  }
  const yaw = Math.round((Math.atan2(-dz, dx) * 180) / Math.PI)
  const ux = Math.cos((yaw * Math.PI) / 180), uz = -Math.sin((yaw * Math.PI) / 180)
  const total = pieces.reduce((t, p) => t + p.len, 0)
  const ycm = Math.round((top - DECK_TOP) * 100)
  let s = -total / 2, piers = 0, tooHigh = false
  pieces.forEach((p, j) => {
    const x = cx + ux * s, z = cz + uz * s
    entities.push({ id: `${id}_BRIDGE_DECK_${j}`, prefab: p.prefab, x: r2(x), z: r2(z), yaw, ycm })
    if (j > 0 && p.prefab !== BRIDGE_PREFABS.small) {
      const bottom = top - DECK_TOP - DECK_BOTTOM // underside of the deck
      const g = heightAt(x, z)
      if (bottom - g > 1.5) {
        const pillar = p.prefab === BRIDGE_PREFABS.wide ? BRIDGE_PREFABS.pillar : BRIDGE_PREFABS.pillarNarrow
        // pillar origin so its top meets the deck underside; stacked downwards until its foot reaches the ground
        let origin = bottom - PILLAR_TOP, k = 0
        for (; k < 2; k++) {
          entities.push({ id: `${id}_BRIDGE_PILLAR_${j}${k ? '_' + k : ''}`, prefab: pillar, x: r2(x), z: r2(z), yaw, ycm: Math.round(origin * 100) })
          piers++
          if (origin - PILLAR_BOTTOM <= g) break
          origin -= PILLAR_H
        }
        if (k === 2) tooHigh = true
      }
    }
    s += p.len
  })
  return { entities, pieces: pieces.map((p) => p.prefab), length: total, from: [cx - (ux * total) / 2, cz - (uz * total) / 2], to: [cx + (ux * total) / 2, cz + (uz * total) / 2], piers, tooHigh }
}

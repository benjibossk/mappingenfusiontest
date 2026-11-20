// Gameplay cover rules (PakTools/analyses/GAMEPLAY_MAPPING.md, permanent generator rules):
//  1. village belt: orchards / hedge copses in the 150-450 m ring of each village / town, one side left open
//     (the sector the roads come in by: the armour approach);
//  2. wooded strips from the nearest forest massif to a village whose approaches stay bare (infantry corridor);
//  3. copses wherever the open ground lies > 200 m from any cover, except 1-2 deliberate armour plains.
// Measured by src/modules/gameplay.ts (vanilla: < 9 % of the land > 150 m from cover, approach cover med 22-45 %).
import { coarsen, coverMap, distanceToCover, fillPolygon, type CoverMap, type Raster } from './gameplay'

export interface GameplayCoverInput {
  heights: ArrayLike<number>; grid: Raster
  forests: number[][]; houses: { x: number; z: number }[]
  sites: { x: number; z: number; kind: string; r: number }[]
  roads: { pts: number[]; half: number }[]
  /** water, zones, other areas, houses: nothing planted there */
  blocked: (x: number, z: number) => boolean
  /** points no planted ring may contain (field plot centres: a plot is never inside a forest) */
  avoid?: { x: number; z: number }[]
  seed: number
}
export interface GameplayCoverResult { belts: number[][]; strips: number[][]; copses: number[][] }

export const GAMEPLAY_COVER = {
  step: 16, ringIn: 150, ringOut: 450, sectors: 8, beltBelow: 0.15, beltHamlet: 0.06, beltMax: 5, stripBelow: 0.22, stripReach: 900,
  exposed: 320, plainKeep: 520, plainMinHa: 20, plains: 2, maxCopses: 260,
} as const

function rng(seed: number) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }

/** irregular blob ring around (x, z) */
function blob(x: number, z: number, r: number, R: () => number): number[] {
  const n = 10, out: number[] = [], a0 = R() * Math.PI * 2
  for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI * 2, rr = r * (0.75 + 0.4 * R()); out.push(+(x + Math.cos(a) * rr).toFixed(2), +(z + Math.sin(a) * rr).toFixed(2)) }
  return out
}
/** closed ring around a polyline [x,z,...] (half width w) */
function stripRing(line: number[], w: number): number[] {
  const L: number[] = [], Rr: number[] = [], n = line.length / 2
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = line[2 * b] - line[2 * a], dz = line[2 * b + 1] - line[2 * a + 1], l = Math.hypot(dx, dz) || 1
    const nx = -dz / l * w, nz = dx / l * w
    L.push(+(line[2 * i] + nx).toFixed(2), +(line[2 * i + 1] + nz).toFixed(2)); Rr.unshift(+(line[2 * i + 1] - nz).toFixed(2)); Rr.unshift(+(line[2 * i] - nx).toFixed(2))
  }
  return [...L, ...Rr]
}
/** keeps the runs of a sampled polyline whose points are all free, >= minLen m long */
function freeRuns(pts: [number, number][], free: (x: number, z: number) => boolean, minLen: number): number[][] {
  const out: number[][] = []; let run: [number, number][] = []
  const flush = () => { if (run.length >= 2 && Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1]) >= minLen) out.push(run.flat()); run = [] }
  // runs cut every ~200 m: hedge woods / groves (< 0.5 ha), not new massifs (landcover bench counts massifs >= 0.5 ha)
  for (const p of pts) { if (free(p[0], p[1])) { run.push(p); if (run.length > 1 && Math.hypot(p[0] - run[0][0], p[1] - run[0][1]) >= 200) { flush() } } else flush() }
  flush()
  return out
}

export function gameplayCover(inp: GameplayCoverInput): GameplayCoverResult {
  const C = GAMEPLAY_COVER, R = rng(inp.seed)
  const gi = coarsen({ heights: inp.heights, grid: inp.grid, forests: [], houses: [] }, C.step)
  const m: CoverMap = coverMap({ ...gi, forests: inp.forests.map((pts) => ({ pts })), houses: inp.houses })
  const forestOnly = coverMap({ ...gi, forests: inp.forests.map((pts) => ({ pts })), houses: [] }).cover
  // road cells (centre line + half + 6 m) on a 4 m hash: nothing planted on a road
  const RC = 4, road = new Set<number>(), rk = (cx: number, cz: number) => cx * 100003 + cz
  for (const rd of inp.roads) for (let i = 0; i + 3 < rd.pts.length; i += 2) {
    const ax = rd.pts[i], az = rd.pts[i + 1], bx = rd.pts[i + 2], bz = rd.pts[i + 3], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 2)), k = Math.ceil((rd.half + 6) / RC)
    for (let s = 0; s <= n; s++) {
      const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n, cx = Math.floor(x / RC), cz = Math.floor(z / RC)
      for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) road.add(rk(cx + dx, cz + dz))
    }
  }
  const onRoad = (x: number, z: number) => road.has(rk(Math.floor(x / RC), Math.floor(z / RC)))
  const cellOf = (x: number, z: number) => { const c = Math.floor((x - m.minX) / m.step), r = Math.floor((z - m.minZ) / m.step); return c < 0 || r < 0 || c >= m.cols || r >= m.rows ? -1 : r * m.cols + c }
  const free = (x: number, z: number) => { const i = cellOf(x, z); return i >= 0 && !!m.land[i] && !onRoad(x, z) && !inp.blocked(x, z) }
  // a vertex keeps one cell clear of any cover: no planted ring overlaps a forest, another ring or a yard
  const clear = (x: number, z: number) => { for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = cellOf(x + dx * m.step, z + dz * m.step); if (i >= 0 && m.cover[i]) return false } return true }
  const inRing = (ring: number[], x: number, z: number) => { let o = false; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) { const zi = ring[i + 1], zj = ring[j + 1]; if ((zi > z) !== (zj > z) && x < ring[i] + (z - zi) / (zj - zi) * (ring[j] - ring[i])) o = !o } return o }
  const ringFree = (ring: number[]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < ring.length; i += 2) { if (!free(ring[i], ring[i + 1]) || !clear(ring[i], ring[i + 1])) return false; x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]) }
    for (const a of inp.avoid ?? []) if (a.x >= x0 && a.x <= x1 && a.z >= z0 && a.z <= z1 && inRing(ring, a.x, a.z)) return false
    return true
  }
  const out: GameplayCoverResult = { belts: [], strips: [], copses: [] }
  const add = (list: number[][], ring: number[]) => { list.push(ring); fillPolygon(m, m.cover, ring, 1); for (let i = 0; i < m.cover.length; i++) if (!m.land[i]) m.cover[i] = 0 }

  // per objective: sector cover in the ring, the open (road) sector
  const objs = inp.sites.filter((s) => s.kind === 'village' || s.kind === 'town' || s.kind === 'hamlet')
  const S = C.sectors, sectorOf = (s: { x: number; z: number }, x: number, z: number) => ((Math.floor((Math.atan2(z - s.z, x - s.x) + Math.PI) / (2 * Math.PI) * S) % S) + S) % S
  const ringIn = (s: { r: number }) => Math.max(C.ringIn, s.r + 30)
  function sectorStats(s: (typeof objs)[number]) {
    const n = new Array(S).fill(0), cv = new Array(S).fill(0), k = Math.ceil(C.ringOut / m.step)
    const cc = Math.floor((s.x - m.minX) / m.step), cr = Math.floor((s.z - m.minZ) / m.step)
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const c = cc + dc, r = cr + dr, d = Math.hypot(dc, dr) * m.step
      if (c < 0 || r < 0 || c >= m.cols || r >= m.rows || d < ringIn(s) || d > C.ringOut) continue
      const i = r * m.cols + c; if (!m.land[i]) continue
      const q = sectorOf(s, m.minX + (c + 0.5) * m.step, m.minZ + (r + 0.5) * m.step); n[q]++; if (m.cover[i]) cv[q]++
    }
    return { n, share: n.map((v, q) => (v ? cv[q] / v : 1)) }
  }
  const openSector = objs.map((s) => {
    const len = new Array(S).fill(0)
    for (const rd of inp.roads) for (let i = 0; i + 1 < rd.pts.length; i += 2) { const d = Math.hypot(rd.pts[i] - s.x, rd.pts[i + 1] - s.z); if (d > ringIn(s) && d < C.ringOut) len[sectorOf(s, rd.pts[i], rd.pts[i + 1])] += rd.half }
    let b = 0; for (let q = 1; q < S; q++) if (len[q] > len[b]) b = q
    return b
  })

  // 1. belts: an orchard / hedge copse in every bare sector but the open one
  objs.forEach((s, k) => {
    let st = sectorStats(s)
    for (let q = 0; q < S; q++) {
      if (q === openSector[k] || st.n[q] < 10) continue
      const mid = (q + 0.5) / S * 2 * Math.PI - Math.PI
      for (let tries = 0, placed = 0; tries < 16 && placed < C.beltMax && st.share[q] < (s.kind === 'hamlet' ? C.beltHamlet : C.beltBelow); tries++) {
        const rr = ringIn(s) + 20 + R() * (C.ringOut - ringIn(s) - 60), a = mid + (R() - 0.5) * (2 * Math.PI / S) * 0.8, len = 90 + R() * 60, w = 9 + R() * 4
        const pts: [number, number][] = []
        for (let t = -len / 2; t <= len / 2; t += 8) { const b = a + t / rr; pts.push([s.x + Math.cos(b) * rr, s.z + Math.sin(b) * rr]) }
        let runs = freeRuns(pts, free, 40).map((l) => stripRing(l, w)).filter(ringFree)
        // no room for a hedge row (tracks, plots of houses): a round orchard / copse
        if (!runs.length) { const cx = s.x + Math.cos(a) * rr, cz = s.z + Math.sin(a) * rr, c = blob(cx, cz, 22 + R() * 12, R); if (free(cx, cz) && ringFree(c)) runs = [c] }
        if (!runs.length) continue
        for (const ring of runs) add(out.belts, ring)
        placed++; st = sectorStats(s)
      }
    }
  })

  // 2. strips: a wooded corridor from the nearest massif to a village whose approaches stay bare
  objs.forEach((s, k) => {
    const st = sectorStats(s), tot = st.n.reduce((a, b) => a + b, 0)
    const share = tot ? st.share.reduce((a, v, q) => a + v * st.n[q], 0) / tot : 1
    if (share >= C.stripBelow) return
    let best = -1, bd = Infinity; const kk = Math.ceil(C.stripReach / m.step), cc = Math.floor((s.x - m.minX) / m.step), cr = Math.floor((s.z - m.minZ) / m.step)
    for (let dr = -kk; dr <= kk; dr++) for (let dc = -kk; dc <= kk; dc++) {
      const c = cc + dc, r = cr + dr, d = Math.hypot(dc, dr) * m.step
      if (c < 0 || r < 0 || c >= m.cols || r >= m.rows || d > C.stripReach || d < s.r + 120 || d >= bd) continue
      const i = r * m.cols + c; if (!forestOnly[i]) continue
      if (sectorOf(s, m.minX + (c + 0.5) * m.step, m.minZ + (r + 0.5) * m.step) === openSector[k]) continue
      best = i; bd = d
    }
    if (best < 0) return
    const fx = m.minX + (best % m.cols + 0.5) * m.step, fz = m.minZ + (((best / m.cols) | 0) + 0.5) * m.step
    const a = Math.atan2(fz - s.z, fx - s.x), x0 = s.x + Math.cos(a) * (s.r + 40), z0 = s.z + Math.sin(a) * (s.r + 40)
    const L = Math.hypot(fx - x0, fz - z0), ph = R() * 6.28, amp = 12 + R() * 10, pts: [number, number][] = []
    for (let t = 0; t <= L; t += 8) { const f = t / L, off = Math.sin(f * Math.PI * 2 + ph) * amp * Math.sin(f * Math.PI); pts.push([x0 + (fx - x0) * f - Math.sin(a) * off, z0 + (fz - z0) * f + Math.cos(a) * off]) }
    for (const ring of freeRuns(pts, free, 50).map((l) => stripRing(l, 8 + R() * 3)).filter(ringFree)) add(out.strips, ring)
  })

  // 3. copses: the farthest point from cover until no non-plain cell is > `exposed` m away
  let d = distanceToCover(m)
  const exempt = new Uint8Array(d.length)
  {
    const lab = new Int32Array(d.length).fill(-1), regions: { cells: number[]; top: number }[] = []
    for (let i = 0; i < d.length; i++) {
      if (lab[i] >= 0 || !m.land[i] || d[i] <= C.exposed) continue
      const cells = [i]; lab[i] = regions.length; let top = i
      for (let t = 0; t < cells.length; t++) {
        const j = cells[t], c = j % m.cols, r = (j / m.cols) | 0
        if (d[j] > d[top]) top = j
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows) continue
          const q = rr * m.cols + cc; if (lab[q] < 0 && m.land[q] && d[q] > C.exposed) { lab[q] = regions.length; cells.push(q) }
        }
      }
      regions.push({ cells, top })
    }
    regions.sort((a, b) => b.cells.length - a.cells.length)
    for (const rg of regions.slice(0, C.plains)) {
      if (rg.cells.length * m.step * m.step / 1e4 < C.plainMinHa) continue
      const tc = rg.top % m.cols, tr = (rg.top / m.cols) | 0
      for (const j of rg.cells) if (Math.hypot(j % m.cols - tc, ((j / m.cols) | 0) - tr) * m.step <= C.plainKeep) exempt[j] = 1
    }
  }
  const tried = new Uint8Array(d.length)
  for (let it = 0; it < C.maxCopses * 4 && out.copses.length < C.maxCopses; it++) {
    let b = -1
    for (let i = 0; i < d.length; i++) if (m.land[i] && !exempt[i] && !tried[i] && d[i] > C.exposed && (b < 0 || d[i] > d[b])) b = i
    if (b < 0) break
    tried[b] = 1
    const x = m.minX + (b % m.cols + 0.5) * m.step, z = m.minZ + (((b / m.cols) | 0) + 0.5) * m.step
    let ring: number[] | null = null
    for (let t = 0; t < 6 && !ring; t++) {
      const jx = x + (R() - 0.5) * 60, jz = z + (R() - 0.5) * 60, c = blob(jx, jz, 20 + R() * 12, R)
      if (free(jx, jz) && ringFree(c)) ring = c
    }
    if (!ring) continue
    add(out.copses, ring)
    d = distanceToCover(m)
  }
  return out
}

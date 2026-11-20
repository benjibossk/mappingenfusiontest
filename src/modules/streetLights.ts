// Street lamps along the streets of towns, villages and hamlets, measured on the vanilla maps
// (C:\Users\benbo\tools\PakTools\analyses\STREETLIGHTS.md, lamps_stats.py):
//  - only inside the settlements: 97 % of the Everon lamps have >= 3 houses within 150 m; the country roads,
//    motorway / main road exits and junctions outside a village are NOT lit in vanilla (<= 1 % near a junction)
//  - ~0.35 lamp per house of a settlement cluster (Everon 0.353, Kolguyev 0.347, Arland 0.341)
//  - nearest lamp 26 m (median, Everon; q25-q75 20-36 m), mostly on the paved through road (Everon 70 % asphalt,
//    9 % cobblestone, 12 % dirt lanes)
//  - 1-3 m off the carriageway edge (median 2.2 m), ~80 % of the neighbours on the same side of the road
//  - arm lamps (E_02 / E_03 / Industrial_05) face the road: yaw = bearing lamp -> road axis
//  - standalone poles: no lamp shares a power pole (the few E_0x_addon lamps hang on LV end poles / buildings)
// Every lamp keeps its site id: a future power topology (POWERGRID_LOGIC.md "consumers[].lamps") can list them.
import { centreLine, roadHalf, type Road, type RoadType } from './roads'

export interface LampSite { id: string; kind: string; x: number; z: number }
export interface StreetLamp { id: string; prefab: string; family: LampFamily; x: number; z: number; yaw: number; site: string; road: string }
export type LampFamily = 'E01_4m' | 'E01_6m' | 'E02' | 'E03' | 'IND05'

export const LAMP_PREFABS: Record<LampFamily, string> = {
  E01_4m: '{E021E2FFF02ADF0C}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_01/LampStreet_E_01_4m.et',
  E01_6m: '{0E3533EE196F01EC}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_01/LampStreet_E_01_6m.et',
  E02: '{B9003EF716A534D4}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_02/LampStreet_E_02_single.et',
  E03: '{614C7CCF23A6FB40}Prefabs/Structures/Infrastructure/Lamps/LampStreet_E_03/LampStreet_E_03_single.et',
  IND05: '{EC9EC10F9D401E7A}Prefabs/Structures/BuildingParts/Lights/LampIndustrial_05/LampIndustrial_05.et',
}
/** arm lamps: the arm points along +Z, turned towards the road (the E_01 lanterns are round) */
const ARM: Record<LampFamily, boolean> = { E01_4m: false, E01_6m: false, E02: true, E03: true, IND05: true }

/** vanilla family shares per settlement kind (Everon / Kolguyev counts of the standalone street lamps) */
const MIX: Record<string, [LampFamily, number][]> = {
  town: [['E02', 0.45], ['E01_6m', 0.25], ['E03', 0.3]],
  village: [['E03', 0.4], ['E01_4m', 0.35], ['E02', 0.25]],
  hamlet: [['E01_4m', 0.6], ['E03', 0.4]],
  nordic: [['IND05', 0.4], ['E01_6m', 0.3], ['E03', 0.3]],
}
export const LAMP_RULES = {
  /** lamp spacing along a street (m), vanilla nearest-lamp median 26 m */
  spacing: { town: 24, village: 27, hamlet: 30 } as Record<string, number>,
  jitter: 3,
  /** settlement reach (m) a lamp may stand in, same discs as the pastures / bench */
  reach: { town: 300, village: 170, hamlet: 90 } as Record<string, number>,
  /** houses within `houseR` of the lamp needed to light a street point */
  houses: { town: 2, village: 2, hamlet: 2 } as Record<string, number>,
  houseR: 50,
  /** offset from the carriageway edge (m): 0.8 .. 3.6 (vanilla q25-q75) */
  edge: [0.8, 3.6] as [number, number],
  /** share of lamps that switch to the other side of the street */
  flip: 0.2,
  /** lamps per house of the site at most (vanilla 0.35) */
  perHouse: 0.3,
  /** min distance to another lamp, a power pole, a footprint */
  minLamp: 12, minPole: 2.5, minFoot: 1,
}
// streets that get lamps: paved through roads and the village lanes; never motorways, trails, forest tracks
const LIT: Partial<Record<RoadType, 'main' | 'lane'>> = {
  asphalt: 'main', asphaltLine: 'main', asphalt2: 'main', asphalt3: 'main', asphaltNarrow: 'main', cobble: 'main', cobbleRough: 'lane',
  concrete: 'main', concreteLine: 'main', concreteNarrow: 'lane', concretePanel: 'lane', dirt: 'lane', dirt2: 'lane', coal: 'lane',
}
export const isLitRoad = (t: RoadType) => LIT[t] !== undefined

function hash(s: string, seed: number) { let h = seed >>> 0 || 1; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b1) >>> 0; return h }
function rng(seed: number) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function inPoly(p: number[], x: number, z: number) { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins; return ins }
function segD(ax: number, az: number, bx: number, bz: number, x: number, z: number) { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; return Math.hypot(x - ax - t * dx, z - az - t * dz) }
/** distance from a point to a footprint (0 inside) */
function footD(c: number[], x: number, z: number) { if (inPoly(c, x, z)) return 0; let b = Infinity; for (let i = 0; i < c.length; i += 2) { const j = (i + 2) % c.length; b = Math.min(b, segD(c[i], c[i + 1], c[j], c[j + 1], x, z)) } return b }

class Grid<T> {
  m = new Map<string, T[]>()
  C: number
  constructor(C: number) { this.C = C }
  add(x0: number, z0: number, x1: number, z1: number, v: T) { for (let i = Math.floor(x0 / this.C); i <= Math.floor(x1 / this.C); i++) for (let j = Math.floor(z0 / this.C); j <= Math.floor(z1 / this.C); j++) { const k = i + ',' + j; let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(v) } }
  near(x: number, z: number, r: number): T[] { const out = new Set<T>(); for (let i = Math.floor((x - r) / this.C); i <= Math.floor((x + r) / this.C); i++) for (let j = Math.floor((z - r) / this.C); j <= Math.floor((z + r) / this.C); j++) for (const v of this.m.get(i + ',' + j) ?? []) out.add(v); return [...out] }
}

export interface LampInput {
  /** through roads and settlement lanes (centre control points, splines resolved with centreLine) */
  roads: Pick<Road, 'id' | 'type' | 'pts' | 'width'>[]
  sites: LampSite[]
  /** house / building footprints (4 corners), `site` = owning settlement */
  buildings: { corners: number[]; x: number; z: number; site?: string }[]
  /** other footprints to keep clear of (zone buildings, props): not counted as houses */
  footprints?: number[][]
  /** power pole positions, flat x/z (lamps keep clear of them) */
  poles?: number[]
  /** extra obstacle (fences, zone objects, water...) */
  blocked?: (x: number, z: number) => boolean
  seed: number
  biome?: string
}

/** lamps of every settlement, deterministic per seed */
// Kolguyev: longer lamp spacing (bench: 1.3 -> 319, 1.6 -> 269 lamps vs vanilla 257)
const NORDIC_STEP = 1.5
export function streetLights(o: LampInput): StreetLamp[] {
  const R = LAMP_RULES
  const lines = o.roads.filter((r) => r.pts.length >= 4).map((r) => ({ r, l: r.pts.length >= 6 ? centreLine(r.pts, 4) : r.pts, h: roadHalf(r as Road) }))
  const segs = new Grid<{ ax: number; az: number; bx: number; bz: number; h: number }>(32)
  for (const q of lines) for (let i = 0; i + 3 < q.l.length; i += 2) {
    const ax = q.l[i], az = q.l[i + 1], bx = q.l[i + 2], bz = q.l[i + 3]
    segs.add(Math.min(ax, bx) - q.h, Math.min(az, bz) - q.h, Math.max(ax, bx) + q.h, Math.max(az, bz) + q.h, { ax, az, bx, bz, h: q.h })
  }
  const onRoad = (x: number, z: number, m: number) => segs.near(x, z, 0).some((s) => segD(s.ax, s.az, s.bx, s.bz, x, z) < s.h + m)
  const feet = new Grid<number[]>(32), houses = new Grid<{ x: number; z: number }>(50)
  const perSite = new Map<string, number>()
  for (const b of o.buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < b.corners.length; i += 2) { x0 = Math.min(x0, b.corners[i]); x1 = Math.max(x1, b.corners[i]); z0 = Math.min(z0, b.corners[i + 1]); z1 = Math.max(z1, b.corners[i + 1]) }
    if (b.corners.length >= 6) feet.add(x0, z0, x1, z1, b.corners)
    houses.add(b.x, b.z, b.x, b.z, { x: b.x, z: b.z })
    if (b.site) perSite.set(b.site, (perSite.get(b.site) ?? 0) + 1)
  }
  for (const c of o.footprints ?? []) {
    if (c.length < 6) continue
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); z0 = Math.min(z0, c[i + 1]); z1 = Math.max(z1, c[i + 1]) }
    feet.add(x0, z0, x1, z1, c)
  }
  const poleG = new Grid<[number, number]>(16)
  for (let i = 0; o.poles && i + 1 < o.poles.length; i += 2) poleG.add(o.poles[i], o.poles[i + 1], o.poles[i], o.poles[i + 1], [o.poles[i], o.poles[i + 1]])
  const lampG = new Grid<StreetLamp>(16)
  const houseCount = (x: number, z: number, r: number) => houses.near(x, z, r).filter((h) => Math.hypot(h.x - x, h.z - z) < r).length
  const siteAt = (x: number, z: number) => {
    let best: LampSite | undefined, bd = Infinity
    for (const s of o.sites) { const r = R.reach[s.kind]; if (!r) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < r && d / r < bd) { bd = d / r; best = s } }
    return best
  }
  const nordic = o.biome === 'nordic_kolguyev'
  const out: StreetLamp[] = []
  const used = new Map<string, number>()
  // the through roads first (vanilla: 70 % of the lamps on the paved main road), then the lanes
  const order = [...lines].sort((a, b) => (LIT[a.r.type] === 'main' ? 0 : 1) - (LIT[b.r.type] === 'main' ? 0 : 1))
  for (const q of order) {
    const kindOf = LIT[q.r.type]
    if (!kindOf) continue
    if (nordic && kindOf !== 'main') continue // Kolguyev road-driven: the through roads only
    const L = q.l, rnd = rng(hash(q.r.id, o.seed))
    // cumulative length
    const acc: number[] = [0]
    for (let i = 2; i < L.length; i += 2) acc.push(acc[acc.length - 1] + Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]))
    const tot = acc[acc.length - 1]
    if (tot < 15) continue
    let side = 0, famSite = '', fam: LampFamily = 'E03'
    for (let t = 6 + rnd() * 6; t < tot - 4;) {
      let k = 1
      while (k < acc.length - 1 && acc[k] < t) k++
      const f = (t - acc[k - 1]) / Math.max(1e-6, acc[k] - acc[k - 1])
      const ax = L[k * 2 - 2], az = L[k * 2 - 1], bx = L[k * 2], bz = L[k * 2 + 1]
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f
      const len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len
      const s = siteAt(cx, cz)
      const step = ((s ? R.spacing[s.kind] ?? 27 : 27) + (rnd() * 2 - 1) * R.jitter) * (nordic ? NORDIC_STEP : 1)
      t += s ? step : 20
      if (!s) continue
      // Kolguyev: lamps follow the village road, not the house count (farmstead rows: few houses, long frontage;
      // vanilla 257 lamps on the bench sites). Everon / Arland unchanged
      if (!nordic && houseCount(cx, cz, R.houseR) < (R.houses[s.kind] ?? 2)) continue
      const cap = nordic ? Infinity : Math.round(R.perHouse * (perSite.get(s.id) ?? houseCount(s.x, s.z, R.reach[s.kind]))) + 1
      if ((used.get(s.id) ?? 0) >= cap) continue
      if (famSite !== s.id) {
        famSite = s.id
        const mix = MIX[nordic ? 'nordic' : s.kind] ?? MIX.village
        let p = rng(hash(s.id + q.r.id, o.seed))(), pick = mix[0][0]
        for (const [fm, w] of mix) { if (p < w) { pick = fm; break } p -= w }
        fam = pick
        // the side with more houses
        let l = 0, r = 0
        for (const h of houses.near(cx, cz, 40)) { const c = ux * (h.z - cz) - uz * (h.x - cx); if (c > 0) l++; else r++ }
        side = l >= r ? 1 : -1
      }
      const sd = rnd() < R.flip ? -side : side
      // try the chosen side, then the other one; 3 offsets each
      let placed: StreetLamp | null = null
      for (const sgn of [sd, -sd]) {
        for (let tryi = 0; tryi < 3 && !placed; tryi++) {
          const off = q.h + R.edge[0] + (R.edge[1] - R.edge[0]) * ((rnd() + tryi) / 3)
          const nx = -uz * sgn, nz = ux * sgn
          const x = cx + nx * off, z = cz + nz * off
          if (onRoad(x, z, 0.8)) continue
          if (feet.near(x, z, R.minFoot + 1).some((c) => footD(c, x, z) < R.minFoot)) continue
          if (poleG.near(x, z, R.minPole).some((p) => Math.hypot(p[0] - x, p[1] - z) < R.minPole)) continue
          if (lampG.near(x, z, R.minLamp).some((m) => Math.hypot(m.x - x, m.z - z) < R.minLamp)) continue
          if (o.blocked?.(x, z)) continue
          const yaw = ARM[fam] ? Math.round((Math.atan2(cx - x, cz - z) * 180) / Math.PI + 360) % 360 : Math.floor(rnd() * 4) * 90
          placed = { id: '', prefab: LAMP_PREFABS[fam], family: fam, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw, site: s.id, road: q.r.id }
        }
        if (placed) break
      }
      if (!placed) continue
      used.set(s.id, (used.get(s.id) ?? 0) + 1)
      placed.id = `LAMP_${s.id}_${used.get(s.id)}`
      lampG.add(placed.x, placed.z, placed.x, placed.z, placed)
      out.push(placed)
    }
  }
  return out
}

/** lamps grouped by settlement: the `lamps` list of a power topology consumer (POWERGRID_LOGIC.md) */
export function lampConsumers(lamps: StreetLamp[]): { siteId: string; lamps: string[] }[] {
  const m = new Map<string, string[]>()
  for (const l of lamps) { let a = m.get(l.site); if (!a) m.set(l.site, (a = [])); a.push(l.id) }
  return [...m].map(([siteId, ids]) => ({ siteId, lamps: ids }))
}

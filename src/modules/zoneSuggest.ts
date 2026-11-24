// Zone suggestions: the mapper draws a polygon (or picks an empty area found by findGaps) and the tool proposes
// what to build there, ranked, with a reason a mapper understands. Each suggestion is a Zone-tool generator
// (zonefill.ts ZONE_FILL_TYPES) plus its params, so a click just selects it.
// Thresholds grounded in measured vanilla numbers (src/data/worldParams.ts, [M] = measured on Everon):
//   place spacing: village-village nearest neighbour median 660 m (min 312), bourg-bourg 1 320 m, floors
//     town 1 000 / village 470 / hamlet 250 m, any two places >= 260 m;
//   slopes: town <= 8 %, village <= 10 %, hamlet <= 16 %; altitude <= 60 % of the relief (KB §4);
//   Conflict HQs >= 2 000 m apart, radio relay reach 1 000 m (scenarioFit.ts); flat HQ spot = slope < 5 deg;
//   site slopes from sitezones.ts SITE_MAX_SLOPE.
// Every other number (scores, "rhythm" 600-900 m, distances to roads / water for the rural sites) is a proposal.
import { WORLD } from '../data/worldParams.ts'
import { SITE_MAX_SLOPE } from './sitezones.ts'
import type { ZoneFillType } from './zonefill.ts'
import type { ScenarioId } from './scenarioFit.ts'

export interface SuggestWorld {
  heights: ArrayLike<number>
  grid: { cols: number; rows: number; cell: number; minX?: number; minZ?: number }
  sea?: number
  places: { x: number; z: number; kind: string }[] // town / village / hamlet / military / industrial...
  houses: { x: number; z: number }[]
  roads: { type: string; pts: number[] }[]
  waters?: { type: string; pts: number[] }[] // lake rings, river polylines
  forests?: number[][] // forest outlines (flat X/Z)
  zones?: { x: number; z: number; kind: string }[] // zones already filled (industrial, military, sites...)
  scenario?: ScenarioId
}
export interface ZoneFeatures {
  areaHa: number; meanSlope: number; maxSlope: number; flatShare: number // flatShare: samples under 5 %
  alt: number; altFrac: number // mean altitude, its share of the highest land
  landShare: number; forestShare: number; housesInside: number
  waterM: number; riverM: number; coastM: number // distances from the centroid (Infinity if none)
  roadM: number; pavedM: number; roadInside: boolean
  townM: number; villageM: number; placeM: number; militaryM: number
  between: { a: number; b: number; d: number } | null // two settlements on both sides (gap d m between them)
  southFacing: number // -1..1, mean slope aspect towards the south (sun side)
  cx: number; cz: number
}
export interface Suggestion { id: ZoneFillType; score: number; key: string; vars: Record<string, string | number>; params: Record<string, string> }

const PAVED = /asphalt|motorway|concrete|cobble/i
const TAN5 = Math.tan(5 * Math.PI / 180)
const SP = WORLD.sites

export function polyAreaM2(p: number[]): number {
  let a = 0
  for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1] }
  return Math.abs(a) / 2
}
export function inPoly(p: number[], x: number, z: number): boolean {
  let ins = false
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], zi = p[2 * i + 1], xj = p[2 * j], zj = p[2 * j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins
  }
  return ins
}
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}
function lineDist(pts: number[], x: number, z: number, closed = false) {
  let d = Infinity
  const n = pts.length / 2
  for (let i = 0; i + 1 < n; i++) d = Math.min(d, segDist(x, z, pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]))
  if (closed && n > 2) d = Math.min(d, segDist(x, z, pts[2 * n - 2], pts[2 * n - 1], pts[0], pts[1]))
  if (n === 1) d = Math.hypot(pts[0] - x, pts[1] - z)
  return d
}

function sampler(w: SuggestWorld) {
  const { cols, rows, cell } = w.grid, x0 = w.grid.minX ?? 0, z0 = w.grid.minZ ?? 0
  const at = (c: number, r: number) => w.heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]
  const h = (x: number, z: number) => {
    const fc = (x - x0) / cell, fr = (z - z0) / cell, c = Math.floor(fc), r = Math.floor(fr), u = fc - c, v = fr - r
    return (at(c, r) * (1 - u) + at(c + 1, r) * u) * (1 - v) + (at(c, r + 1) * (1 - u) + at(c + 1, r + 1) * u) * v
  }
  const grad = (x: number, z: number): [number, number] => { const e = Math.max(4, cell); return [(h(x + e, z) - h(x - e, z)) / (2 * e), (h(x, z + e) - h(x, z - e)) / (2 * e)] }
  let top = -Infinity
  for (let i = 0; i < cols * rows; i++) if (w.heights[i] > top) top = w.heights[i]
  return { h, grad, top, inside: (x: number, z: number) => x >= x0 && z >= z0 && x <= x0 + (cols - 1) * cell && z <= z0 + (rows - 1) * cell, x0, z0, x1: x0 + (cols - 1) * cell, z1: z0 + (rows - 1) * cell }
}

const isTown = (k: string) => k === 'town' || k === 'city' || k === 'bourg'
const isVillage = (k: string) => k === 'village' || k === 'hamlet' || isTown(k)
const isMil = (k: string) => /mil|base|camp|airfield|hq/i.test(k)

export function zoneFeatures(poly: number[], w: SuggestWorld): ZoneFeatures {
  const s = sampler(w), sea = w.sea ?? 0
  let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity
  for (let i = 0; i + 1 < poly.length; i += 2) { mnx = Math.min(mnx, poly[i]); mxx = Math.max(mxx, poly[i]); mnz = Math.min(mnz, poly[i + 1]); mxz = Math.max(mxz, poly[i + 1]) }
  const areaM2 = polyAreaM2(poly), step = Math.max(8, Math.sqrt(areaM2 / 400))
  let n = 0, land = 0, slopeSum = 0, maxSlope = 0, flat = 0, altSum = 0, forest = 0, south = 0, sx = 0, sz = 0
  for (let z = mnz + step / 2; z < mxz; z += step) for (let x = mnx + step / 2; x < mxx; x += step) {
    if (!inPoly(poly, x, z)) continue
    n++; sx += x; sz += z
    const y = s.h(x, z)
    if (y <= sea + 0.5) continue
    land++; altSum += y
    const [gx, gz] = s.grad(x, z), g = Math.hypot(gx, gz)
    slopeSum += g; maxSlope = Math.max(maxSlope, g); if (g < TAN5) flat++
    if (g > 0.03) south += gz / g // ground rising northwards (+z) = slope facing south
    if (w.forests?.some((f) => inPoly(f, x, z))) forest++
  }
  if (!n) { n = 1; sx = (mnx + mxx) / 2; sz = (mnz + mxz) / 2 }
  const cx = sx / n, cz = sz / n
  const L = Math.max(1, land)
  let waterM = Infinity, riverM = Infinity
  for (const wt of w.waters ?? []) {
    const lake = wt.type !== 'river'
    const d = lake && inPoly(wt.pts, cx, cz) ? 0 : lineDist(wt.pts, cx, cz, lake)
    waterM = Math.min(waterM, d); if (!lake) riverM = Math.min(riverM, d)
  }
  // coast: first sea cell on 16 rays, 50 m steps out to 3 km
  let coastM = Infinity
  for (let a = 0; a < 16 && coastM > 50; a++) for (let d = 0; d <= 3000 && d < coastM; d += 50) {
    const x = cx + d * Math.cos(a * Math.PI / 8), z = cz + d * Math.sin(a * Math.PI / 8)
    if (!s.inside(x, z)) break
    if (s.h(x, z) <= sea) { coastM = d; break }
  }
  let roadM = Infinity, pavedM = Infinity, roadInside = false
  for (const r of w.roads) {
    const d = lineDist(r.pts, cx, cz)
    roadM = Math.min(roadM, d); if (PAVED.test(r.type)) pavedM = Math.min(pavedM, d)
    if (!roadInside && d < Math.hypot(mxx - mnx, mxz - mnz)) for (let k = 0; k + 3 < r.pts.length && !roadInside; k += 2) {
      const L = Math.hypot(r.pts[k + 2] - r.pts[k], r.pts[k + 3] - r.pts[k + 1]), m = Math.max(1, Math.ceil(L / 20))
      for (let t = 0; t <= m; t++) if (inPoly(poly, r.pts[k] + ((r.pts[k + 2] - r.pts[k]) * t) / m, r.pts[k + 1] + ((r.pts[k + 3] - r.pts[k + 1]) * t) / m)) { roadInside = true; break }
    }
  }
  // distances measured from the zone edge side: from the centroid minus a typical radius (proposal)
  const rad = Math.sqrt(areaM2 / Math.PI)
  const dist = (ok: (k: string) => boolean) => w.places.reduce((m, p) => (ok(p.kind) ? Math.min(m, Math.max(0, Math.hypot(p.x - cx, p.z - cz) - rad)) : m), Infinity)
  const placeM = Math.min(dist(() => true), ...(w.zones ?? []).map((q) => Math.max(0, Math.hypot(q.x - cx, q.z - cz) - rad)))
  const militaryM = Math.min(dist(isMil), ...(w.zones ?? []).filter((q) => isMil(q.kind)).map((q) => Math.hypot(q.x - cx, q.z - cz)))
  // "between": two settlements on opposite sides (angle > 120 deg), both within 1.5 km
  const near = w.places.filter((p) => isVillage(p.kind)).map((p) => ({ p, d: Math.hypot(p.x - cx, p.z - cz), a: Math.atan2(p.z - cz, p.x - cx) })).filter((q) => q.d < 1500).sort((a, b) => a.d - b.d)
  let between: ZoneFeatures['between'] = null
  for (let i = 0; i < near.length && !between; i++) for (let j = i + 1; j < near.length; j++) {
    let da = Math.abs(near[i].a - near[j].a); if (da > Math.PI) da = 2 * Math.PI - da
    if (da > (2 * Math.PI) / 3) { between = { a: Math.round(near[i].d), b: Math.round(near[j].d), d: Math.round(Math.hypot(near[i].p.x - near[j].p.x, near[i].p.z - near[j].p.z)) }; break }
  }
  const housesInside = w.houses.filter((p) => p.x >= mnx && p.x <= mxx && p.z >= mnz && p.z <= mxz && inPoly(poly, p.x, p.z)).length
  return {
    areaHa: areaM2 / 1e4, meanSlope: slopeSum / L, maxSlope, flatShare: flat / L, alt: altSum / L,
    altFrac: s.top - sea > 60 ? (altSum / L - sea) / (s.top - sea) : 0, landShare: land / n, forestShare: forest / L, housesInside,
    waterM, riverM, coastM, roadM, pavedM, roadInside,
    townM: dist(isTown), villageM: dist(isVillage), placeM, militaryM, between, southFacing: south / L, cx, cz,
  }
}

const km = (m: number) => (m < 50 ? "< 50 m" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
const lin = (v: number, a: number, b: number) => Math.max(0, Math.min(1, (v - a) / (b - a))) // 0 at a, 1 at b
const fin = (m: number) => (Number.isFinite(m) ? m : 1e5)

/** 3-5 ranked suggestions for the polygon. Each score 0..100. */
export function suggestZone(poly: number[], w: SuggestWorld, max = 5): Suggestion[] {
  const f = zoneFeatures(poly, w)
  if (f.landShare < 0.3) return []
  const out: Suggestion[] = []
  const add = (id: ZoneFillType, s: number, key: string, vars: Suggestion['vars'] = {}, params: Suggestion['params'] = {}) => { if (s > 0.05) out.push({ id, score: Math.round(s * 100), key, vars, params }) }
  const town = fin(f.townM), vil = fin(f.villageM), place = fin(f.placeM), road = fin(f.roadM), paved = fin(f.pavedM)
  const slopePct = Math.round(f.meanSlope * 100)
  const flatOk = (lim: number) => lin(lim * 1.6 - f.meanSlope, 0, lim * 0.6) // 1 under the limit, 0 at 1.6x
  const sc = w.scenario
  // military base / Conflict HQ: flat, far from towns (HQ spacing 2 km), road access
  {
    const s = flatOk(SITE_MAX_SLOPE.camp) * lin(f.flatShare, 0.2, 0.6) * lin(town, 300, 1000) * (road < 400 ? 1 : 0.5) * lin(vil, 300, 900) * lin(fin(f.militaryM), 500, 2000) * (sc === 'conflict' || sc === 'combatops' ? 1.2 : 1) * lin(f.areaHa, 0.5, 3)
    add('camp', Math.min(1, s), paved < 400 ? 'zs.camp.paved' : 'zs.camp', { slope: slopePct, town: km(town) }, { faction: 'US' })
  }
  // town: >= 1 000 m from another town ([M] bourg-bourg 1 320 m), flat, paved road, not too high
  {
    const s = flatOk(SP.maxSlope.town) * lin(f.areaHa, 8, 25) * lin(town, SP.minDist.town * 0.7, SP.minDist.town * 1.3) * (paved < 300 ? 1 : road < 300 ? 0.6 : 0.3) * (f.altFrac <= SP.maxAltFrac ? 1 : 0.4) * (sc === 'ff' || sc === 'overthrow' ? 1.15 : 1)
    add('town', Math.min(1, s), 'zs.town', { town: km(town), slope: slopePct }, {})
  }
  // village / hamlet: keep the vanilla rhythm (village nearest neighbour median 660 m, floor 470 m)
  {
    const rhythm = vil < SP.minDist.village ? lin(vil, SP.minAny, SP.minDist.village) * 0.4 : vil <= 1100 ? 1 : lin(2500 - vil, 0, 1400) * 0.7 + 0.3
    const s = flatOk(SP.maxSlope.village) * lin(f.areaHa, 1, 4) * rhythm * (road < 250 ? 1 : 0.55) * (f.housesInside > 10 ? 0.3 : 1)
    if (f.between && f.between.d >= 900 && f.between.d <= 2600) add('habitation', Math.min(1, s * 1.1), 'zs.between', { d: km(f.between.d) }, { dens: '1' })
    else add('habitation', s, 'zs.village', { vil: km(vil), slope: slopePct }, { dens: '1' })
    const sh = flatOk(SP.maxSlope.hamlet) * lin(place, SP.minAny, SP.minDist.hamlet + 200) * (road < 600 ? 1 : 0.6) * (1 - lin(f.areaHa, 30, 80) * 0.5)
    add('scattered', sh * 0.7, 'zs.farm', { place: km(place) }, { ha: String(Math.max(2, Math.min(200, Math.round(f.areaHa)))) })
  }
  // industry: flat, on asphalt, near a town (300-1 500 m: outskirts) [proposal]
  add('industrial', flatOk(0.08) * (paved < 150 ? 1 : paved < 400 ? 0.5 : 0.15) * (town < 1500 ? 1 : 0.5) * lin(f.areaHa, 1, 4), 'zs.industrial', { road: km(paved), town: km(town) })
  // construction site: settlement expansion, flat, by a road, next to a village [proposal]
  add('construction', flatOk(SITE_MAX_SLOPE.construction) * (road < 150 ? 1 : 0.4) * (vil < 600 ? 1 : vil < 1200 ? 0.6 : 0.3) * (f.areaHa < 6 ? 1 : 0.6) * 0.8, 'zs.construction', { vil: km(vil) })
  // production forest / logging: wooded or moderately steep, a track within reach, river = log transport
  {
    const steep = lin(f.meanSlope, 0.1, 0.25), wood = f.forestShare
    const s = Math.max(steep, wood) * (road < 800 ? 1 : 0.6) * lin(f.areaHa, 3, 15) * (f.meanSlope > 0.6 ? 0.4 : 1)
    add('production', Math.min(1, s * (f.riverM < 400 ? 1.1 : 1)), f.riverM < 400 ? 'zs.logging.river' : 'zs.logging', { slope: slopePct, river: km(fin(f.riverM)) }, { leaf: 'auto' })
  }
  // natural forest: steep, high or far from everything
  add('forest', Math.max(lin(f.meanSlope, 0.2, 0.45), lin(place, 1200, 2500) * 0.7, lin(f.altFrac, 0.55, 0.8)) * (f.forestShare > 0.7 ? 0.5 : 1), f.meanSlope > 0.2 ? 'zs.forest.steep' : 'zs.forest.far', { slope: slopePct, place: km(place) }, { leaf: 'auto' })
  // fields / pasture: gentle ground within a village's reach
  add('fields', flatOk(0.1) * lin(f.areaHa, 3, 12) * (vil < 1500 ? 1 : 0.5) * (1 - f.forestShare), 'zs.fields', { vil: km(vil) })
  add('pasture', flatOk(SITE_MAX_SLOPE.pasture) * lin(f.areaHa, 1, 4) * (vil < 1000 ? 0.8 : 0.4) * (f.waterM < 500 ? 1.1 : 1) * (1 - f.forestShare), 'zs.pasture', { vil: km(vil) })
  // orchard / vineyard: sunny gentle slopes near a village
  add('vineyard', lin(f.meanSlope, 0.04, 0.12) * (f.meanSlope < SITE_MAX_SLOPE.vineyard ? 1 : 0.2) * lin(f.southFacing, 0, 0.5) * (vil < 1200 ? 0.9 : 0.4) * (f.areaHa < 15 ? 1 : 0.6), 'zs.vineyard', { slope: slopePct })
  add('orchard', flatOk(SITE_MAX_SLOPE.orchard * 0.5) * (vil < 500 ? 0.7 : 0.3) * (f.areaHa < 8 ? 1 : 0.5), 'zs.orchard', { vil: km(vil) })
  // small sites next to a village
  if (f.areaHa < 3) {
    add('cemetery', flatOk(SITE_MAX_SLOPE.cemetery) * (vil < 400 ? 0.75 : 0.2), 'zs.cemetery', { vil: km(vil) })
    add('parking', flatOk(SITE_MAX_SLOPE.parking) * (road < 40 ? 0.7 : 0.1) * (town < 400 ? 1 : 0.4), 'zs.parking', { town: km(town) })
    add('junkyard', flatOk(SITE_MAX_SLOPE.junkyard) * (road < 100 ? 0.6 : 0.2) * lin(vil, 100, 400) * (vil < 1500 ? 1 : 0.5), 'zs.junkyard', { vil: km(vil) })
  }
  if (f.roadInside && f.areaHa < 5) add('checkpoint', 0.55 * (town > 600 ? 1 : 0.5) * (sc === 'ff' || sc === 'conflict' ? 1.2 : 1), 'zs.checkpoint', {})
  add('hunting', (f.forestShare > 0.2 ? 0.6 : 0.2) * lin(place, 500, 1500), 'zs.hunting', { place: km(place) })
  if (f.coastM < 150 && f.alt < 6) add('beach', 0.8, 'zs.beach', { coast: km(f.coastM) })
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, max)
}

// ---------------------------------------------------------------------------------------------------------
// Empty areas ("gaps"): land cells far from any house / place / zone, reachable, grouped into outlines.
export interface Gap { poly: number[]; areaKm2: number; cx: number; cz: number; best: Suggestion | null; stage: number }
export interface GapOpts { cellM?: number; emptyM?: number; minKm2?: number; maxKm2?: number; reachM?: number; max?: number; seed?: number
  /** gaps the mapper marked "not an empty area": a gap containing (or centred within 400 m of) one of these points is skipped */
  dismissed?: { x: number; z: number }[] }

export function findGaps(w: SuggestWorld, o: GapOpts = {}): Gap[] {
  const cell = o.cellM ?? 250, emptyM = o.emptyM ?? 300, minKm2 = o.minKm2 ?? 0.4, maxKm2 = o.maxKm2 ?? 3, reachM = o.reachM ?? 1500
  const s = sampler(w), sea = w.sea ?? 0
  const nc = Math.max(1, Math.floor((s.x1 - s.x0) / cell)), nr = Math.max(1, Math.floor((s.z1 - s.z0) / cell))
  // occupied: distance field by spatial hash (coarse: any object within emptyM of the cell centre)
  const occ = new Uint8Array(nc * nr), k = Math.ceil((emptyM + 450) / cell)
  const mark = (x: number, z: number, r = emptyM) => {
    const c0 = Math.floor((x - s.x0) / cell), r0 = Math.floor((z - s.z0) / cell)
    for (let j = -k - 1; j <= k + 1; j++) for (let i = -k - 1; i <= k + 1; i++) {
      const c = c0 + i, rr = r0 + j
      if (c < 0 || rr < 0 || c >= nc || rr >= nr) continue
      if (Math.hypot(s.x0 + (c + 0.5) * cell - x, s.z0 + (rr + 0.5) * cell - z) < r) occ[rr * nc + c] = 1
    }
  }
  for (const p of w.houses) mark(p.x, p.z)
  for (const p of w.places) mark(p.x, p.z, emptyM + (isTown(p.kind) ? 250 : 100))
  for (const q of w.zones ?? []) mark(q.x, q.z)
  // reachable: within reachM of a road (sampled every ~cell along the roads) when the map has roads
  const reach = new Uint8Array(nc * nr)
  if (w.roads.length) {
    const kr = Math.ceil(reachM / cell)
    const seen = new Set<number>()
    for (const r of w.roads) for (let i = 0; i + 1 < r.pts.length; i += 2) {
      const c0 = Math.floor((r.pts[i] - s.x0) / cell), r0 = Math.floor((r.pts[i + 1] - s.z0) / cell), key = r0 * 100000 + c0
      if (seen.has(key)) continue
      seen.add(key)
      for (let j = -kr; j <= kr; j++) for (let ii = -kr; ii <= kr; ii++) {
        const c = c0 + ii, rr = r0 + j
        if (c >= 0 && rr >= 0 && c < nc && rr < nr && Math.hypot(ii, j) * cell <= reachM) reach[rr * nc + c] = 1
      }
    }
  } else reach.fill(1)
  const free = new Uint8Array(nc * nr)
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const x = s.x0 + (c + 0.5) * cell, z = s.z0 + (r + 0.5) * cell, i = r * nc + c
    if (occ[i] || !reach[i]) continue
    // land on the 4 corners + centre, not a cliff
    let ok = true
    for (const [dx, dz] of [[0, 0], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) if (s.h(x + dx * cell, z + dz * cell) <= sea + 1) ok = false
    if (ok && Math.hypot(...s.grad(x, z)) > 0.6) ok = false
    if (ok && (w.waters ?? []).some((wt) => wt.type !== 'river' && inPoly(wt.pts, x, z))) ok = false
    free[i] = ok ? 1 : 0
  }
  // connected groups, cut into blocks of at most maxKm2 (square tiles) so the outlines stay workable
  const tile = Math.max(1, Math.round(Math.sqrt(maxKm2 * 1e6) / cell))
  const lab = new Int32Array(nc * nr).fill(-1), groups: number[][] = []
  for (let i = 0; i < nc * nr; i++) {
    if (!free[i] || lab[i] >= 0) continue
    const g: number[] = [], st = [i], tc = Math.floor((i % nc) / tile), tr = Math.floor(Math.floor(i / nc) / tile)
    lab[i] = groups.length
    while (st.length) {
      const q = st.pop()!; g.push(q)
      const c = q % nc, r = Math.floor(q / nc)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr, j = rr * nc + cc
        if (cc < 0 || rr < 0 || cc >= nc || rr >= nr || !free[j] || lab[j] >= 0) continue
        if (Math.floor(cc / tile) !== tc || Math.floor(rr / tile) !== tr) continue
        lab[j] = groups.length; st.push(j)
      }
    }
    groups.push(g)
  }
  const out: Gap[] = []
  for (const g of groups) {
    const areaKm2 = (g.length * cell * cell) / 1e6
    if (areaKm2 < minKm2) continue
    const poly = cellOutline(g, nc, cell, s.x0, s.z0)
    let cx = 0, cz = 0
    for (const q of g) { cx += s.x0 + ((q % nc) + 0.5) * cell; cz += s.z0 + (Math.floor(q / nc) + 0.5) * cell }
    cx /= g.length; cz /= g.length
    if ((o.dismissed ?? []).some((d) => Math.hypot(d.x - cx, d.z - cz) < 400 || inPoly(poly, d.x, d.z))) continue
    out.push({ poly, areaKm2: Math.round(areaKm2 * 100) / 100, cx: Math.round(cx), cz: Math.round(cz), best: null, stage: gapStage(o.seed ?? 1, cx, cz) })
  }
  out.sort((a, b) => b.areaKm2 - a.areaKm2)
  const top = out.slice(0, o.max ?? 24)
  for (const gp of top) gp.best = suggestZone(gp.poly, w, 1)[0] ?? null
  return top
}

/** outline of a 4-connected cell group: convex hull of its cell corners, shrunk by 15 % of a cell (stays inside the free cells
 *  for compact groups; a gap is a hint, the mapper redraws it) */
function cellOutline(g: number[], nc: number, cell: number, x0: number, z0: number): number[] {
  const pts: [number, number][] = []
  for (const q of g) {
    const c = q % nc, r = Math.floor(q / nc)
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([x0 + (c + a) * cell, z0 + (r + b) * cell])
  }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], hi: [number, number][] = []
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
  const hull = [...lo.slice(0, -1), ...hi.slice(0, -1)]
  let mx = 0, mz = 0
  for (const p of hull) { mx += p[0]; mz += p[1] }
  mx /= hull.length; mz /= hull.length
  return hull.flatMap(([x, z]) => { const d = Math.hypot(x - mx, z - mz) || 1, k = Math.max(0, 1 - (0.15 * cell) / d); return [Math.round(mx + (x - mx) * k), Math.round(mz + (z - mz) * k)] })
}

// ---------------------------------------------------------------------------------------------------------
// Evolving fill: a place that grows with the map. Stage 0 forest -> 1 logged forest (clear-cuts, log piles)
// -> 2 construction site -> 3 village. Each stage is one existing Zone-tool generator.
export const STAGES: { id: ZoneFillType; key: string; params: Record<string, string> }[] = [
  { id: 'forest', key: 'stage.0', params: { leaf: 'auto' } },
  { id: 'production', key: 'stage.1', params: { leaf: 'auto' } },
  { id: 'construction', key: 'stage.2', params: {} },
  { id: 'habitation', key: 'stage.3', params: { dens: '0.6' } },
]
export function stagePlan(stage: number) { return STAGES[Math.max(0, Math.min(3, Math.round(stage)))] }
/** deterministic per-place stage (0..3) from a seed and the place: the same map always evolves the same way */
export function gapStage(seed: number, x: number, z: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(Math.round(x / 50), 0x85ebca6b) ^ Math.imul(Math.round(z / 50), 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) % 4
}

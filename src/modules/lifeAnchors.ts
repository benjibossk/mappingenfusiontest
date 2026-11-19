// Optional "Life Framework" layer (docs: tools/ai-tooling-survey/LIFE_FRAMEWORK_MAP_COMPAT.md).
// Pure: from a generated world, the list of neutral anchors {kind, id, pos, yaw, size?, meta} that the Life
// exporter (lifeExport.ts) turns into a separate <Map>_Life sub-addon. Nothing here touches the vanilla map.
// Ids are `<map>.<kind>.<n>`: n counts per kind in a fixed order (sources sorted by their own generator ids),
// no randomness beyond a hash of those ids, so the same seed always yields the same ids (LF persistence keys).

export type LifeKind =
  | 'wheatField' | 'farmPlot' | 'seedCrate' | 'beehive' | 'workplace' | 'house' | 'houseSign'
  | 'fishingSpot' | 'fishCounter' | 'miningArea' | 'processor' | 'spawnBed' | 'fuelTill' | 'townArea' | 'safeArea'

export interface LifeAnchor {
  kind: LifeKind
  id: string
  x: number
  y: number
  z: number
  yaw: number // degrees, Enfusion angleY
  size?: [number, number] // wheatField: X × Z metres (world axes); miningArea: X × Z
  meta: Record<string, string | number | number[]>
  family: 'Farms' | 'Homes' | 'Fishing' | 'Industry' | 'Shops' | 'Spawns' | 'Zones'
  group?: string // Homes: the village (one .layer per village)
}

// structural input: WorldResult satisfies it
export interface LifeWorldInput {
  grid: { minX: number; minZ: number; step: number; cols: number; rows: number }
  heights: ArrayLike<number>
  sites: { id: string; x: number; z: number; kind: 'town' | 'village' | 'hamlet' }[]
  roads: { id: string; pts: number[]; width?: number }[]
  waters: { id: string; type: string; pts: number[]; width: number }[]
  zones: { id: string; kind: string; sub: string; x: number; z: number; yaw: number; roads?: { pts: number[]; width?: number }[] }[]
  settlement: { placed: { id: string; site: string; x: number; z: number; yaw: number; corners: number[]; role?: string; cat?: string }[] }
  areas: { id: string; kind: string; pts: number[] }[]
  countryside?: number[][] // random world: the field parcels' countryside polygons (used when no 'field' area)
}

export interface LifeOptions { mapId: string; maxWheatFields?: number }

const SITE_R: Record<string, number> = { town: 250, village: 120, hamlet: 50 }
const HOUSE_ROLES = new Set(['house', 'farmhouse'])
const HOUSE_CATS = new Set(['houseS', 'houseM', 'houseL', 'farm', 'block'])
const LAKE = /^(lake|pool)/

export function mapIdOf(world: string): string {
  const base = world.split(/[\\/]/).filter(Boolean).pop() ?? 'map'
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'
}

/** FNV-1a: the only "random" source, keyed by stable generator ids */
export function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

export function heightAt(heights: ArrayLike<number>, g: LifeWorldInput['grid'], x: number, z: number): number {
  const gx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
  const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * g.cols + c
  const a = heights[i] + (heights[i + 1] - heights[i]) * fx
  const b = heights[i + g.cols] + (heights[i + g.cols + 1] - heights[i + g.cols]) * fx
  return a + (b - a) * fz
}

export function pointInPoly(pts: number[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}

export function lineDist(pts: number[], x: number, z: number, closed = false): number {
  let d = Infinity
  const n = pts.length
  for (let i = 0; i + 3 < n; i += 2) d = Math.min(d, segDist(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]))
  if (closed && n >= 6) d = Math.min(d, segDist(x, z, pts[n - 2], pts[n - 1], pts[0], pts[1]))
  if (n === 2) d = Math.hypot(x - pts[0], z - pts[1])
  return d
}

/** the probes the validation shares: on a road, in water, inside a building */
export function worldProbes(w: LifeWorldInput) {
  const roadLines = [...w.roads, ...w.zones.flatMap((z) => z.roads ?? [])]
  const onRoad = (x: number, z: number, margin = 0.5) => roadLines.some((r) => lineDist(r.pts, x, z) < (r.width && r.width > 0 ? r.width / 2 : 3) + margin)
  const inWater = (x: number, z: number) => {
    if (heightAt(w.heights, w.grid, x, z) <= 0) return true // sea
    return w.waters.some((wt) => (LAKE.test(wt.type) ? pointInPoly(wt.pts, x, z) : lineDist(wt.pts, x, z) < Math.max(1, wt.width / 2)))
  }
  const inBuilding = (x: number, z: number) => w.settlement.placed.some((b) => pointInPoly(b.corners, x, z))
  return { onRoad, inWater, inBuilding }
}

/** largest world-axis-aligned rectangle inscribed in the polygon with `margin` metres, capped at `cap` per side */
export function inscribedRect(pts: number[], margin = 3, cap = 120): { cx: number; cz: number; sx: number; sz: number } | null {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]) }
  const fits = (cx: number, cz: number, hx: number, hz: number) => {
    const ax = cx - hx, bx = cx + hx, az = cz - hz, bz = cz + hz
    for (let i = 0; i < pts.length; i += 2) if (pts[i] > ax - margin && pts[i] < bx + margin && pts[i + 1] > az - margin && pts[i + 1] < bz + margin) return false
    const stepX = Math.max(2, (2 * hx) / 12), stepZ = Math.max(2, (2 * hz) / 12)
    for (let x = ax; x <= bx + 1e-6; x += stepX) for (const z of [az, bz]) if (!pointInPoly(pts, x, z) || lineDist(pts, x, z, true) < margin) return false
    for (let z = az; z <= bz + 1e-6; z += stepZ) for (const x of [ax, bx]) if (!pointInPoly(pts, x, z) || lineDist(pts, x, z, true) < margin) return false
    return true
  }
  let best: { cx: number; cz: number; sx: number; sz: number } | null = null
  const n = 8
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const cx = x0 + ((x1 - x0) * i) / n, cz = z0 + ((z1 - z0) * j) / n
    if (!pointInPoly(pts, cx, cz)) continue
    for (const ratio of [1, 1.5, 1 / 1.5]) {
      let lo = 0, hi = cap / 2
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2, hx = ratio >= 1 ? m : m * ratio, hz = ratio >= 1 ? m / ratio : m
        if (fits(cx, cz, hx, hz)) lo = m; else hi = m
      }
      const hx = ratio >= 1 ? lo : lo * ratio, hz = ratio >= 1 ? lo / ratio : lo
      if (hx * 2 >= 12 && hz * 2 >= 12 && (!best || 4 * hx * hz > best.sx * best.sz)) best = { cx: Math.round(cx * 10) / 10, cz: Math.round(cz * 10) / 10, sx: Math.floor(hx * 2), sz: Math.floor(hz * 2) }
    }
  }
  return best
}

const centroid = (pts: number[]) => { let x = 0, z = 0; const n = pts.length / 2; for (let i = 0; i < pts.length; i += 2) { x += pts[i]; z += pts[i + 1] } return [x / n, z / n] }
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.round((Math.atan2(tx - fx, tz - fz) * 180) / Math.PI) // +Z = 0°, +X = 90°
const r2 = (v: number) => Math.round(v * 100) / 100

function convexHull(p: number[][]): number[][] {
  const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (s.length < 3) return s
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: number[][] = [], up: number[][] = []
  for (const q of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of s.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

export function buildLifeAnchors(w: LifeWorldInput, o: LifeOptions): LifeAnchor[] {
  const out: LifeAnchor[] = []
  const counters = new Map<string, number>()
  const { onRoad, inWater, inBuilding } = worldProbes(w)
  const ok = (x: number, z: number) => !onRoad(x, z, 1) && !inWater(x, z) && !inBuilding(x, z)
  const nextId = (kind: string) => { const n = (counters.get(kind) ?? 0) + 1; counters.set(kind, n); return `${o.mapId}.${kind}.${n}` }
  const add = (a: Omit<LifeAnchor, 'y' | 'id'> & { id?: string }) => {
    const full = { ...a, id: a.id ?? nextId(a.kind), x: r2(a.x), z: r2(a.z), y: r2(heightAt(w.heights, w.grid, a.x, a.z)) }
    out.push(full)
    return full
  }
  /** first free spot on rings around (x, z), angles in a hashed but fixed order */
  const spotNear = (key: string, x: number, z: number, radii: number[], test = ok): [number, number] | null => {
    const a0 = (hash(key) % 360) * (Math.PI / 180)
    for (const r of radii) for (let k = 0; k < 16; k++) {
      const a = a0 + (k * Math.PI * 2) / 16, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r
      if (test(px, pz)) return [px, pz]
    }
    return null
  }
  const nearestRoad = (x: number, z: number): [number, number] | null => {
    let best: [number, number] | null = null, bd = Infinity
    for (const r of w.roads) for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], dx = r.pts[i + 2] - ax, dz = r.pts[i + 3] - az, l = dx * dx + dz * dz
      const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0, qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(x - qx, z - qz)
      if (d < bd) { bd = d; best = [qx, qz] }
    }
    return best
  }
  const placed = w.settlement.placed.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const sites = w.sites.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const zones = w.zones.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // 1. farms (FARM_* sites): workplace, plot row + seed crate, hives, 1-2 wheat fields in the nearest field parcels
  const fields = w.areas.filter((a) => a.kind === 'field' && a.pts.length >= 6).sort((a, b) => (a.id < b.id ? -1 : 1))
  ;(w.countryside ?? []).forEach((pts, i) => { if (pts.length >= 6) fields.push({ id: `CS_${i + 1}`, kind: 'field', pts }) })
  const usedFields = new Set<string>()
  const maxWheat = o.maxWheatFields ?? 24
  let wheat = 0
  for (const f of sites.filter((s) => s.id.startsWith('FARM_'))) {
    const fk = `${o.mapId}.farm${f.id}`
    const wp = spotNear(fk + 'wp', f.x, f.z, [6, 10, 14, 20])
    if (wp) add({ kind: 'workplace', family: 'Farms', x: wp[0], z: wp[1], yaw: yawTo(wp[0], wp[1], f.x, f.z), meta: { job: 'FARMER', placeId: `${o.mapId}.farm.${f.id.toLowerCase()}` } })
    // plot row: 3-6 plots 3.5 m apart, the whole row clear of roads, water and buildings
    const nPlots = 3 + (hash(fk + 'plots') % 4)
    let row: number[][] | null = null
    const a0 = (hash(fk + 'row') % 8) * (Math.PI / 4)
    for (let k = 0; k < 8 && !row; k++) for (const r of [18, 26, 34]) {
      const a = a0 + (k * Math.PI) / 4, cx = f.x + Math.sin(a) * r, cz = f.z + Math.cos(a) * r, tx = Math.cos(a), tz = -Math.sin(a)
      const pts = Array.from({ length: nPlots + 1 }, (_, i) => [cx + tx * (i - nPlots / 2) * 3.5, cz + tz * (i - nPlots / 2) * 3.5])
      if (pts.every(([x, z]) => ok(x, z))) { row = pts; break }
    }
    if (row) {
      const yaw = yawTo(row[0][0], row[0][1], row[1][0], row[1][1])
      row.slice(0, nPlots).forEach(([x, z]) => add({ kind: 'farmPlot', family: 'Farms', x, z, yaw, meta: { crop: 'Cabbage' } }))
      const [sx, sz] = row[nPlots]
      add({ kind: 'seedCrate', family: 'Farms', x: sx, z: sz, yaw, meta: { crop: 'Cabbage' } })
    }
    const nHives = 2 + (hash(fk + 'hives') % 2)
    for (let i = 0; i < nHives; i++) {
      const p = spotNear(`${fk}hive${i}`, f.x, f.z, [40 + i * 4, 50 + i * 4, 60], (x, z) => ok(x, z) && !out.some((q) => q.kind === 'beehive' && Math.hypot(q.x - x, q.z - z) < 4))
      if (p) add({ kind: 'beehive', family: 'Farms', x: p[0], z: p[1], yaw: hash(`${fk}hy${i}`) % 360, meta: {} })
    }
    const cand = fields.filter((a) => !usedFields.has(a.id)).map((a) => { const [cx, cz] = centroid(a.pts); return { a, d: Math.hypot(cx - f.x, cz - f.z) } }).filter((c) => c.d < 600).sort((p, q) => p.d - q.d || (p.a.id < q.a.id ? -1 : 1))
    const want = 1 + (hash(fk + 'wheat') % 2)
    let got = 0
    for (const c of cand) {
      if (got >= want || wheat >= maxWheat) break
      const rect = inscribedRect(c.a.pts, 3, 80)
      if (!rect || onRoad(rect.cx, rect.cz, 3) || inWater(rect.cx, rect.cz)) continue
      usedFields.add(c.a.id); got++; wheat++
      add({ kind: 'wheatField', family: 'Farms', x: rect.cx, z: rect.cz, yaw: 0, size: [rect.sx, rect.sz], meta: { parcel: c.a.id } })
    }
  }

  // 2. villages: one marker + sale sign per dwelling (same id), TOWN polygon + SAFE circle, >= 1 first spawn bed per town
  for (const s of sites.filter((q) => !q.id.startsWith('FARM_'))) {
    const homes = placed.filter((b) => b.site === s.id && (b.role ? HOUSE_ROLES.has(b.role) : HOUSE_CATS.has(b.cat ?? '')))
    const vid = s.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    homes.forEach((b, i) => {
      const id = `${o.mapId}.home.${vid}-b${String(i + 1).padStart(2, '0')}`
      add({ kind: 'house', id, family: 'Homes', group: vid, x: b.x, z: b.z, yaw: b.yaw, meta: { building: b.id } })
      const rd = nearestRoad(b.x, b.z)
      let px = b.x, pz = b.z
      if (rd) {
        const d = Math.hypot(rd[0] - b.x, rd[1] - b.z) || 1, dist = Math.min(9, Math.max(2, d - 4))
        px = b.x + ((rd[0] - b.x) / d) * dist; pz = b.z + ((rd[1] - b.z) / d) * dist
      }
      if (inBuilding(px, pz) || onRoad(px, pz, 0.5)) { const p = spotNear(id + 'sign', b.x, b.z, [8, 10, 12]); if (p) { px = p[0]; pz = p[1] } }
      add({ kind: 'houseSign', id, family: 'Homes', group: vid, x: px, z: pz, yaw: rd ? yawTo(px, pz, rd[0], rd[1]) : b.yaw, meta: { houseId: id } })
    })
    const R = SITE_R[s.kind] ?? 100
    const own = placed.filter((b) => b.site === s.id)
    const hullPts = own.length >= 3 ? convexHull(own.flatMap((b) => { const c: number[][] = []; for (let i = 0; i < b.corners.length; i += 2) c.push([b.corners[i], b.corners[i + 1]]); return c })) : []
    const poly = hullPts.length >= 3 ? hullPts.flatMap((p) => [r2(p[0]), r2(p[1])]) : Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [r2(s.x + Math.sin(a) * R), r2(s.z + Math.cos(a) * R)] }).flat()
    add({ kind: 'townArea', family: 'Zones', x: s.x, z: s.z, yaw: 0, meta: { style: 'TOWN', points: poly, site: s.id } })
    add({ kind: 'safeArea', family: 'Zones', x: s.x, z: s.z, yaw: 0, meta: { style: 'SAFE', radius: s.kind === 'town' ? 40 : 25, site: s.id } })
    if (s.kind === 'town' || s.kind === 'village') {
      const p = spotNear(`${o.mapId}.${s.id}.bed`, s.x, s.z, [6, 12, 20, 30, 45, 60])
      if (p) add({ kind: 'spawnBed', family: 'Spawns', x: p[0], z: p[1], yaw: hash(s.id) % 360, meta: { site: s.id } })
    }
  }
  // a map without town/village still needs one spawn: at the first site or the map centre
  if (!out.some((a) => a.kind === 'spawnBed')) {
    const s = sites[0], cx = s?.x ?? w.grid.minX + ((w.grid.cols - 1) * w.grid.step) / 2, cz = s?.z ?? w.grid.minZ + ((w.grid.rows - 1) * w.grid.step) / 2
    const p = spotNear(`${o.mapId}.bed.fallback`, cx, cz, [0, 10, 25, 50, 100, 200, 400]) ?? [cx, cz]
    add({ kind: 'spawnBed', family: 'Spawns', x: p[0], z: p[1], yaw: 0, meta: { site: s?.id ?? '' } })
  }

  // 3. sites in zones: port (fishing), industry (mining / furnace / sawmill), fuel stations
  for (const zn of zones) {
    const sub = zn.sub ?? ''
    const zk = `${o.mapId}.${zn.id}`
    if (sub.startsWith('vanilla:port')) {
      const shore = spotNear(zk + 'shore', zn.x, zn.z, [20, 35, 50, 70, 90], (x, z) => !inWater(x, z) && !onRoad(x, z, 1) && !inBuilding(x, z) && [0, 1, 2, 3, 4, 5, 6, 7].some((k) => inWater(x + Math.sin((k * Math.PI) / 4) * 25, z + Math.cos((k * Math.PI) / 4) * 25)))
      if (shore) {
        const id = nextId('fishingSpot')
        add({ kind: 'fishingSpot', id, family: 'Fishing', x: shore[0], z: shore[1], yaw: 0, meta: { spotId: id, table: 'harbour', radius: 45, stock: 14, regrow: 90 } })
        const c = spotNear(zk + 'counter', shore[0], shore[1], [6, 10, 15])
        if (c) add({ kind: 'fishCounter', family: 'Fishing', x: c[0], z: c[1], yaw: yawTo(c[0], c[1], shore[0], shore[1]), meta: {} })
        const j = spotNear(zk + 'fisher', shore[0], shore[1], [10, 16, 22])
        if (j) add({ kind: 'workplace', family: 'Fishing', x: j[0], z: j[1], yaw: yawTo(j[0], j[1], shore[0], shore[1]), meta: { job: 'FISHER', placeId: `${o.mapId}.port.${zn.id.toLowerCase()}` } })
      }
    } else if (sub.startsWith('vanilla:gas_station') || (zn.kind === 'industrial' && sub === 'fuel')) {
      const p = spotNear(zk + 'till', zn.x, zn.z, [4, 8, 12, 18])
      if (p) add({ kind: 'fuelTill', family: 'Shops', x: p[0], z: p[1], yaw: zn.yaw, meta: { station: zn.id } })
    } else if (zn.kind === 'industrial' && (sub === 'quarry' || sub === 'factory' || sub === 'depot')) {
      const p = spotNear(zk + 'ind', zn.x, zn.z, [0, 10, 20, 30, 45])
      if (!p) continue
      if (sub === 'quarry') {
        add({ kind: 'miningArea', family: 'Industry', x: p[0], z: p[1], yaw: 0, size: [10, 10], meta: { zone: zn.id } })
        const j = spotNear(zk + 'miner', p[0], p[1], [8, 14, 20])
        if (j) add({ kind: 'workplace', family: 'Industry', x: j[0], z: j[1], yaw: yawTo(j[0], j[1], p[0], p[1]), meta: { job: 'MINER', placeId: `${o.mapId}.ind.${zn.id.toLowerCase()}` } })
      } else if (sub === 'factory') {
        add({ kind: 'processor', family: 'Industry', x: p[0], z: p[1], yaw: zn.yaw, meta: { type: 'Furnace', zone: zn.id } })
      } else {
        add({ kind: 'processor', family: 'Industry', x: p[0], z: p[1], yaw: zn.yaw, meta: { type: 'Sawmill', zone: zn.id } })
        const j = spotNear(zk + 'lumber', p[0], p[1], [8, 14, 20])
        if (j) add({ kind: 'workplace', family: 'Industry', x: j[0], z: j[1], yaw: yawTo(j[0], j[1], p[0], p[1]), meta: { job: 'LUMBERJACK', placeId: `${o.mapId}.ind.${zn.id.toLowerCase()}` } })
      }
    }
  }
  return out
}

export interface LifeIssue { level: 'error' | 'warn'; id: string; msg: string }

/** pre-export checks: unique ids (house + sign share theirs on purpose), nothing on a road or in water
 *  (fishing spots excepted), at least one spawn bed */
export function validateLifeAnchors(anchors: LifeAnchor[], w: LifeWorldInput): LifeIssue[] {
  const issues: LifeIssue[] = []
  const { onRoad, inWater } = worldProbes(w)
  const seen = new Set<string>()
  for (const a of anchors) {
    const key = `${a.kind}|${a.id}`
    if (seen.has(key)) issues.push({ level: 'error', id: a.id, msg: 'duplicate id' })
    seen.add(key)
    if (a.kind === 'townArea' || a.kind === 'safeArea') continue
    if (a.kind !== 'fishingSpot' && inWater(a.x, a.z)) issues.push({ level: 'error', id: a.id, msg: 'in water' })
    if (a.kind !== 'house' && onRoad(a.x, a.z, 0)) issues.push({ level: 'error', id: a.id, msg: 'on a road' })
  }
  if (!anchors.some((a) => a.kind === 'spawnBed')) issues.push({ level: 'error', id: '-', msg: 'no FirstSpawnBed' })
  return issues
}

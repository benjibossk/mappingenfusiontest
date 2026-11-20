// Road-anchored field layout (fieldlayout.ts, FTG look within the Everon ranges of FIELDS_SURFACES_VANILLA.md)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS, type World } from '../../src/modules/worldgen.ts'
import { SITE_RADIUS } from '../../src/modules/network.ts'
import { boundarySamples, nearestRoad, plotAdjacency, ringArea, ringCentroid, roadFieldLayout } from '../../src/modules/fieldlayout.ts'

let world: World | undefined
const seed21 = async () => (world ??= await generateWorld({ ...WORLD_DEFAULTS, seed: 21 }))
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] }
const mod90 = (a: number) => { let d = Math.abs(a) % (Math.PI / 2); if (d > Math.PI / 4) d = Math.PI / 2 - d; return d }

test('roadFieldLayout tiles the zone: pieces cover it, none overlaps', () => {
  const zone = [0, 0, 800, 0, 800, 600, 0, 600]
  const f = roadFieldLayout({ zone, seed: 3, fieldSize: 110, aspect: 1.5, roads: [[-50, 300, 900, 320]], centre: [-300, 300], fringe: 100, reach: 1200 })
  const total = f.reduce((s, r) => s + ringArea(r), 0)
  assert.ok(Math.abs(total - 800 * 600) < 50, `area ${total}`)
  assert.ok(f.length > 15)
})

test('seed 21 fields: road / radial orientation, vanilla sizes, size gradient, crop mosaic, hedgerows', async () => {
  const w = await seed21()
  const c = w.campaign!
  assert.ok(c && c.fields.length > 40, 'fields')
  const roads = w.roads.map((r) => r.pts)
  const site = (x: number, z: number) => {
    let b = w.sites[0], bd = Infinity
    for (const s of w.sites) { const d = Math.hypot(x - s.x, z - s.z) - SITE_RADIUS[s.kind]; if (d < bd) { bd = d; b = s } }
    // same normalisation as worldgen's countryside ring: 0 at the fringe (R x 1.1), 1 at the outer reach
    const R = SITE_RADIUS[b.kind], ring = R * (b.kind === 'town' ? 2.6 : 2.4) + (b.kind === 'hamlet' ? 420 : 260)
    return { s: b, d: (Math.hypot(x - b.x, z - b.z) - R * 1.1) / (ring - R * 1.1) }
  }
  // 1. one edge (>= 15 m) within 15 deg of the nearest road direction or of the radial to the town
  let aligned = 0
  for (const f of c.fields) {
    const [cx, cz] = ringCentroid(f), rd = nearestRoad(roads, cx, cz), { s } = site(cx, cz), rad = Math.atan2(cz - s.z, cx - s.x)
    let ok = false
    for (let i = 0; i + 1 < f.length && !ok; i++) {
      const dx = f[i + 1][0] - f[i][0], dz = f[i + 1][1] - f[i][1]
      if (Math.hypot(dx, dz) < 15) continue
      const a = Math.atan2(dz, dx)
      ok = (!!rd && mod90(a - rd.dir) < Math.PI / 12) || mod90(a - rad) < Math.PI / 12
    }
    if (ok) aligned++
  }
  assert.ok(aligned >= c.fields.length * 0.8, `aligned ${aligned}/${c.fields.length}`)
  // 2. median size inside the Everon crop-field range (p10 0.6 / med 1.6 / p90 5.7 ha), ~110 m side
  const areas = c.fields.map(ringArea), med = median(areas)
  assert.ok(med > 6000 && med < 25000, `median ${med} m2`)
  assert.ok(Math.sqrt(med) > 80 && Math.sqrt(med) < 160, `median side ${Math.sqrt(med)}`)
  // 3. mean size grows with the distance from the town (no fixed ratio: roads and houses cut the big outer plots,
  //    and the p90 does not follow, the largest plots sit between two villages; landcover bench checks the sizes)
  const byD = c.fields.map((f, i) => ({ a: areas[i], d: site(...ringCentroid(f)).d })).sort((p, q) => p.d - q.d)
  const h = Math.floor(byD.length / 2), mean = (q: { a: number }[]) => q.reduce((s, v) => s + v.a, 0) / q.length
  const near = byD.slice(0, h), far = byD.slice(h)
  assert.ok(mean(far) > mean(near), `near ${mean(near)} far ${mean(far)}`)
  // 4. neighbours never share a crop
  assert.equal(c.crops?.length, c.fields.length)
  const adj = plotAdjacency(c.fields)
  let pairs = 0
  adj.forEach((n, i) => n.forEach((j) => { if (j > i) { pairs++; assert.notEqual(c.crops![i], c.crops![j], `plots ${i}/${j}`) } }))
  assert.ok(pairs > 20, `pairs ${pairs}`)
  assert.ok(new Set(c.crops).size >= 3)
  // 5. hedgerows on >= 70 % of the shared borders
  const segs = c.hedges.map((p) => [p[0][0], p[0][1], p[p.length - 1][0], p[p.length - 1][1]])
  const hedged = (x: number, z: number) => segs.some((s) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L))
    return Math.hypot(s[0] + u * dx - x, s[1] + u * dz - z) < 3
  })
  let shared = 0, withHedge = 0
  adj.forEach((n, i) => n.forEach((j) => {
    if (j < i) return
    const g = c.fields[j], on = boundarySamples(c.fields[i], 6).filter((p) => g.some((_, k) => {
      if (k + 1 >= g.length) return false
      const a = g[k], b = g[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L))
      return Math.hypot(a[0] + u * dx - p[0], a[1] + u * dz - p[1]) < 2
    }))
    if (!on.length) return
    shared++
    if (on.filter((p) => hedged(p[0], p[1])).length >= on.length * 0.5) withHedge++
  }))
  assert.ok(withHedge >= shared * 0.7, `hedged borders ${withHedge}/${shared}`)
})

// Power distribution inside settlements (powergrid.ts step 3): entrance pole / transformer per settlement,
// underground past it in towns, one short overhead street run in small villages, never one drop per house
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGrid, type GridSite, type PowerDistrib } from '../../src/modules/powergrid.ts'

function world(size = 6000) {
  const step = 20, cols = Math.round(size / step) + 1
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols).fill(40)
  const sites: GridSite[] = [
    { id: 'T1', x: 1200, z: 1200, kind: 'town', r: 250 },
    { id: 'T2', x: 4800, z: 4800, kind: 'town', r: 250 },
    { id: 'V1', x: 3000, z: 1500, kind: 'village', r: 120 }, // small (12 houses)
    { id: 'V2', x: 1500, z: 4000, kind: 'village', r: 120 }, // big (40 houses)
    { id: 'H1', x: 3000 + 600, z: 1500 + 150, kind: 'hamlet', r: 50 },
  ]
  const ring = [...sites.flatMap((s) => [s.x, s.z]), sites[0].x, sites[0].z]
  const roads = [ring, ...sites.map((s) => [s.x - s.r * 1.4, s.z, s.x + s.r * 1.4, s.z]), ...sites.map((s) => [s.x, s.z - s.r * 1.4, s.x, s.z + s.r * 1.4])]
  // houses: blocks set back from the cross streets
  const buildings: number[][] = []
  const house = (x: number, z: number) => buildings.push([x - 5, z - 5, x + 5, z - 5, x + 5, z + 5, x - 5, z + 5])
  const fill = (s: GridSite, n: number) => { for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + 0.4, d = s.r * (0.3 + 0.5 * ((k * 7) % 10) / 10); house(s.x + Math.sin(a) * d, s.z + Math.cos(a) * d) } }
  fill(sites[0], 60); fill(sites[1], 60); fill(sites[2], 12); fill(sites[3], 40); fill(sites[4], 5)
  const world = { roads: roads.map((pts) => ({ pts, half: 3 })), buildings }
  return { input: { heights, grid, sites, roads, isWater: () => false, size, world }, sites }
}
const plan = (distrib: PowerDistrib) => { const w = world(); return { p: planGrid(w.input, { style: 'eden', plants: 0, ehv: false, distrib }), sites: w.sites } }
const lvIn = (p: ReturnType<typeof planGrid>, s: GridSite, f = 0.7) => {
  let n = 0
  for (const l of p.lines) if (l.kind === 'lv') for (let i = 0; i + 1 < l.poles.length; i += 2) if (Math.hypot(l.poles[i] - s.x, l.poles[i + 1] - s.z) < s.r * f) n++
  return n
}

test('distribution: one entrance per served settlement, on its edge', () => {
  for (const d of ['auto', 'overhead', 'underground'] as const) {
    const { p, sites } = plan(d)
    for (const s of sites) {
      if (p.unfed.includes(s.id)) continue
      const e = p.entrances.filter((q) => q.site === s.id)
      assert.equal(e.length, 1, `${d}: ${s.id} entrances`)
      const dc = Math.hypot(e[0].x - s.x, e[0].z - s.z)
      assert.ok(dc > s.r * 0.5 && dc < s.r * 1.6, `${d}: ${s.id} entrance at ${dc.toFixed(0)} m from centre`)
    }
  }
})

test('distribution: underground = zero LV poles inside towns and villages', () => {
  const { p, sites } = plan('underground')
  for (const s of sites) assert.equal(lvIn(p, s), 0, s.id)
  assert.ok(p.entrances.every((e) => e.ug))
})

test('distribution: auto = towns + big villages underground, small villages one short run, fewer poles than overhead', () => {
  const a = plan('auto'), o = plan('overhead')
  const [T1, T2, V1, V2, H1] = a.sites
  assert.equal(lvIn(a.p, T1), 0); assert.equal(lvIn(a.p, T2), 0); assert.equal(lvIn(a.p, V2), 0)
  const ent = (id: string) => a.p.entrances.find((e) => e.site === id)!
  assert.ok(ent('T1').ug && ent('V2').ug && !ent('V1').ug && !ent('H1').ug)
  assert.ok(a.p.lines.filter((l) => l.kind === 'lv' && l.to === 'V1').length <= 1, 'one street run in a small village')
  const tot = (p: ReturnType<typeof planGrid>) => a.sites.reduce((n, s) => n + lvIn(p, s, 1), 0)
  assert.ok(tot(a.p) < tot(o.p), `auto ${tot(a.p)} < overhead ${tot(o.p)}`)
  assert.ok(lvIn(o.p, T1) > 0, 'overhead mode still runs street poles in towns')
})

test('distribution: no per-building drops in overhead mode (LV lines per settlement <= 2)', () => {
  const { p, sites } = plan('overhead')
  for (const s of sites) assert.ok(p.lines.filter((l) => l.kind === 'lv' && l.to === s.id).length <= 2, s.id)
  const houses = world().input.world.buildings.length
  const lvPoles = p.lines.filter((l) => l.kind === 'lv').reduce((n, l) => n + l.poles.length / 2, 0)
  assert.ok(lvPoles < houses, `${lvPoles} LV poles for ${houses} houses`)
})

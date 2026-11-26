// Airfield integration (airClear.ts): an airfield placed on a generated world clears / reroutes every layer
// out of its footprint; villages, lakes and big rivers are refused; the clearing geometry helpers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, appWorldParams, type WorldResult } from '../src/modules/worldgen'
import { makeAirfield } from '../src/modules/zones'
import { airFootprint, airfieldConflicts, clearAirfield, detour, inFoot, snapAirfield, splitAtBox, type ClearWorld } from '../src/modules/airClear'
import { applyFlatten, type Box } from '../src/modules/gen-common'
import { flattenAirfield, generateAirfield } from '../src/modules/airfield'
import { centreLine, roadHalf } from '../src/modules/roads'

const PAD = -1 // a cut line may end ON the border (the fence): only what goes past it counts
const crosses = (pts: number[], b: Box) => splitAtBox(pts, { ...b, hw: b.hw + PAD, hd: b.hd + PAD }).some((r) => r.inside)
const anyIn = (flat: number[], b: Box) => { for (let i = 0; i + 1 < flat.length; i += 2) if (inFoot(b, flat[i], flat[i + 1], PAD)) return true; return false }

const box: Box = { x: 0, z: 0, hw: 100, hd: 400, yaw: 30 }

test('splitAtBox / detour: a road through the box goes around it, never inside', () => {
  const runs = splitAtBox([-1000, 0, 1000, 0], box)
  assert.deepEqual(runs.map((r) => r.inside), [false, true, false])
  const a = runs[0].pts.slice(-2), e = runs[2].pts.slice(0, 2)
  const d = detour(box, a[0], a[1], e[0], e[1], 25)
  assert.ok(!crosses(d, box), 'detour stays outside')
  assert.ok(Math.hypot(d[0] - a[0], d[1] - a[1]) < 40 && Math.hypot(d[d.length - 2] - e[0], d[d.length - 1] - e[1]) < 40, 'detour joins both ends')
})

let world: WorldResult | null = null
const getWorld = async () => (world ??= await generateWorld(appWorldParams(3)))

function layersOf(w: WorldResult): ClearWorld {
  return { roads: w.roads, lanes: w.settlement.lanes, paths: w.settlement.paths, squares: w.settlement.squares, settled: w.settlement.placed, parcels: w.settlement.parcels, fences: w.settlement.fences, sites: w.sites, power: w.power, stations: w.powerStations, access: w.powerAccess, areas: w.areas, campaign: w.campaign ?? null, countryside: w.countryside, riparian: w.riparian, zones: w.zones, waters: w.waters }
}

function assertClear(L: ClearWorld, zid: string, b: Box, emb?: number) {
  const own = (id: string) => id.startsWith(zid + '_')
  for (const r of [...L.roads, ...(L.lanes ?? []), ...(L.paths ?? [])]) {
    if (r.id === `${zid}_ACCESS`) continue
    assert.ok(own(r.id) || !crosses(r.pts, b), `road ${r.id} crosses the airfield`)
  }
  for (const p of L.settled ?? []) assert.ok(!inFoot(b, p.x, p.z, PAD) && !anyIn(p.corners, b), `house ${p.id} on the airfield`)
  for (const s of L.sites ?? []) assert.ok(!inFoot(b, s.x, s.z, PAD), `place ${s.id} on the airfield`)
  for (const p of [...(L.parcels ?? []), ...(L.fences ?? [])]) {
    for (const it of p.items) assert.ok(!inFoot(b, it.x, it.z, PAD), `parcel prop of ${p.site} on the airfield`)
    for (const f of p.fences) assert.ok(!crosses(f.pts, b), `fence of ${p.site} crosses the airfield`)
  }
  const bw = { ...b, hw: b.hw - Math.max(0, (emb ?? 0) - 30), hd: b.hd - Math.max(0, (emb ?? 0) - 30) } // woods may keep the outer embankment
  for (const a of L.areas ?? []) assert.ok(!anyIn(a.pts, a.kind === 'forest' ? bw : b), `${a.kind} ${a.id} inside the airfield`)
  for (const f of L.campaign?.fields ?? []) assert.ok(!anyIn(f.flat(), b), 'field plot inside the airfield')
  for (const h of L.campaign?.hedges ?? []) assert.ok(!crosses(h.flat(), b), 'hedge crosses the airfield')
  for (const l of L.power ?? []) {
    if (own(l.id)) continue
    assert.ok(!crosses(l.path, b), `power line ${l.id} crosses the airfield`)
    for (let i = 0; i + 1 < l.poles.length; i += 2) assert.ok(!inFoot(b, l.poles[i], l.poles[i + 1], PAD), `pole of ${l.id} on the airfield`)
  }
  for (const s of L.stations ?? []) assert.ok(!inFoot(b, s.x, s.z, PAD), `station ${s.id} on the airfield`)
  for (const w of L.waters ?? []) if (w.type === 'river' || w.type === 'stream' as string) assert.ok(!crosses(w.pts, b), `stream ${w.id} crosses the airfield`)
  for (const z of L.zones ?? []) {
    if (z.id === zid || z.kind !== 'site') continue
    for (const e of z.entities) assert.ok(!inFoot(b, e.x, e.z, PAD), `${z.id} object ${e.id} on the airfield`)
  }
}

test('random world seed 3: the generated airfield is already clear', { timeout: 600_000 }, async () => {
  const w = await getWorld()
  for (const zn of w.zones.filter((z) => z.kind === 'airfield')) assertClear(layersOf(w), zn.id, airFootprint(zn)!, zn.embank)
})

test('random world seed 3: a large military airfield clicked at the centre clears every layer', { timeout: 600_000 }, async () => {
  const w = await getWorld()
  const L = layersOf(w)
  const cx = w.grid.minX + ((w.grid.cols - 1) * w.grid.step) / 2, cz = w.grid.minZ + ((w.grid.rows - 1) * w.grid.step) / 2
  const heights = Array.from(w.heights)
  // the app: a forbidden spot (village, lake, big river) is moved to the nearest free ground
  const fp = (x: number, z: number) => airFootprint({ boxes: [], site: generateAirfield({ kind: 'military', size: 'large', x, z, yaw: 0, seed: 5 }).site })!
  const spot = snapAirfield(cx, cz, (x, z) => (airfieldConflicts(fp(x, z), L).length ? null : { yaw: 0 }))
  assert.ok(spot, 'a free spot near the centre')
  const zn = makeAirfield(heights, w.grid, { id: 'AIR_9', size: 'large', kind: 'military', x: spot.x, z: spot.z, yaw: 0, seed: 5 })
  const b = airFootprint(zn)!
  // the scenario of the bug report had things on the footprint
  const before = w.settlement.placed.filter((p) => inFoot(b, p.x, p.z)).length + w.roads.filter((r) => crosses(r.pts, b)).length + (w.areas ?? []).filter((a) => anyIn(a.pts, b)).length
  assert.ok(before > 0, 'test scene: something to clear')
  L.zones!.push(zn)
  const was = new Map(L.roads.map((r) => [r.id, JSON.stringify(r.pts)]))
  const rep = clearAirfield(L, zn)
  assertClear(L, zn.id, b, zn.embank)
  assert.ok(rep.accessRoad || L.roads.some((r) => { for (let i = 0; i + 1 < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - zn.access![0], r.pts[i + 1] - zn.access![1]) < 40) return true; return false }), 'a road reaches the gate')
  // nothing stands on the access road laid over the world (seed 3 live: TREE_FIELD_2 on AIR_1_ACCESS)
  // ... nor on a through road rerouted round the footprint (seed 3 live: BELT_2 hazels on the ROAD_ASPHALTE_1 detour)
  const laid = L.roads.filter((r) => r.id === 'AIR_9_ACCESS' || (!r.id.startsWith('AIR_9_') && was.has(r.id) && was.get(r.id) !== JSON.stringify(r.pts)))
  assert.ok(laid.length > 1, 'test scene: a detour besides the access')
  for (const acc of laid) for (const z of L.zones!) if (z.id !== zn.id) for (const e of z.entities) {
    let d = Infinity
    for (let i = 0; i + 3 < acc.pts.length; i += 2) {
      const ax = acc.pts[i], az = acc.pts[i + 1], dx = acc.pts[i + 2] - ax, dz = acc.pts[i + 3] - az, t = Math.max(0, Math.min(1, ((e.x - ax) * dx + (e.z - az) * dz) / (dx * dx + dz * dz || 1)))
      d = Math.min(d, Math.hypot(ax + dx * t - e.x, az + dz * t - e.z))
    }
    assert.ok(d >= roadHalf(acc), `${e.id} on ${acc.id} (${d.toFixed(1)} m)`)
  }
  // idempotent: a second pass finds nothing more
  const again = clearAirfield(L, zn)
  assert.equal(again.houses + again.roadsCut + again.roadsRerouted + again.forests + again.fields, 0, JSON.stringify(again))
})

test('conflicts: a village, a lake or a big river on the footprint refuses the spot; a farm does not', () => {
  const b = { ...box }
  assert.deepEqual(airfieldConflicts(b, { sites: [{ id: 'VILLAGE_1', kind: 'village', x: 50, z: 50 }] }).map((c) => c.kind), ['village'])
  assert.equal(airfieldConflicts(b, { sites: [{ id: 'FARM_1', kind: 'hamlet', x: 50, z: 50 }] }).length, 0)
  assert.deepEqual(airfieldConflicts(b, { waters: [{ id: 'L', type: 'lake', pts: [-20, -20, 20, -20, 20, 20, -20, 20], width: 0, depth: 2 }] }).map((c) => c.kind), ['lake'])
  assert.deepEqual(airfieldConflicts(b, { waters: [{ id: 'R', type: 'river', pts: [-900, 0, 900, 0], width: 20, depth: 2 }] }).map((c) => c.kind), ['river'])
  assert.equal(airfieldConflicts(b, { waters: [{ id: 'S', type: 'river', pts: [-900, 0, 900, 0], width: 3, depth: 1 }] }).length, 0)
})

test('embankments: the flatten blend never exceeds 1:3 on a hillside', () => {
  const g = { cols: 401, rows: 401, step: 10, minX: 0, minZ: 0 }
  const h = Array.from({ length: g.cols * g.rows }, (_, k) => (k % g.cols) * 10 * 0.08) // 8 % slope across X
  const a = generateAirfield({ kind: 'military', size: 'medium', x: 2000, z: 2000, yaw: 0, seed: 1 })
  flattenAirfield(a, h, g as never)
  const out = h.slice()
  applyFlatten(out, g as never, a.flatten)
  let worst = 0
  for (let r = 1; r < g.rows - 1; r++) for (let c = 1; c < g.cols - 1; c++) {
    const k = r * g.cols + c
    worst = Math.max(worst, Math.abs(out[k + 1] - out[k - 1]) / 20 - 0.08 * 0, Math.abs(out[k + g.cols] - out[k - g.cols]) / 20)
  }
  assert.ok(worst < 0.4, `steepest blend ${worst.toFixed(2)} (cliff edge)`)
})

test('clearAirfield: nothing of another zone stays on a through road rerouted round the footprint', () => {
  const site: Box = { x: 0, z: 0, hw: 100, hd: 300, yaw: 0 }
  const air = { id: 'AIR_7', kind: 'airfield', site, boxes: [], entities: [], shapes: [], roads: [], x: 0, z: 0, yaw: 0 } as unknown as Parameters<typeof clearAirfield>[1]
  const world = (ents: { id: string; prefab: string; x: number; z: number; yaw: number }[]): ClearWorld => ({
    roads: [{ id: 'ROAD_X', type: 'asphalt', pts: [-1000, 0, -500, 0, 500, 0, 1000, 0] }],
    zones: [{ id: 'VEG_SCATTER', kind: 'site', x: 0, z: 0, yaw: 0, shapes: [], roads: [], boxes: [], entities: ents } as unknown as NonNullable<ClearWorld['zones']>[number]],
  })
  // where the detour runs: lay it once on an empty world, then put a bush on one of its vertices
  const probe = world([]); clearAirfield(probe, air)
  const r = probe.roads.find((q) => q.id === 'ROAD_X')!
  let k = 0
  for (let i = 0; i + 1 < r.pts.length; i += 2) if (Math.abs(r.pts[i]) < 200 && Math.abs(r.pts[i + 1]) > 300) { k = i; break }
  assert.ok(k > 0, 'the road goes round the box')
  // + one on the laid spline where it bows furthest off the raw detour (BELT_2_B75: 4.6 m off the raw line, 0.2 m off the spline)
  const seg = (q: number[], x: number, z: number) => { let m = Infinity; for (let i = 0; i + 3 < q.length; i += 2) { const ax = q[i], az = q[i + 1], dx = q[i + 2] - ax, dz = q[i + 3] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); m = Math.min(m, Math.hypot(ax + dx * t - x, az + dz * t - z)) } return m }
  const cl = centreLine(r.pts, 4)
  let bow = 0
  for (let i = 0; i + 1 < cl.length; i += 2) if (seg(r.pts, cl[i], cl[i + 1]) > seg(r.pts, cl[bow], cl[bow + 1])) bow = i
  const w = world([{ id: 'BELT_2_B38', prefab: 'hazel.et', x: r.pts[k] + 0.5, z: r.pts[k + 1], yaw: 0 }, { id: 'BELT_2_B75', prefab: 'hazel.et', x: cl[bow], z: cl[bow + 1], yaw: 0 }, { id: 'FAR', prefab: 'hazel.et', x: 0, z: 900, yaw: 0 }])
  clearAirfield(w, air)
  assert.deepEqual(w.zones![0].entities.map((e) => e.id), ['FAR'])
})

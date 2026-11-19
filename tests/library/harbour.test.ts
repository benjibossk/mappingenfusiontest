// Realistic harbours (harbour.ts, HARBOURS_EVERON.md): seed 21 world with the vanilla sites on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { PORT_SEA_RX, toLocal, localToWorld, quayDist, HARBOUR_PREFABS } from '../../src/modules/harbour.ts'

test('seed 21: harbour basin, apron, sea parts, roads, buoy pair', async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 21, vanillaSites: true, villageTemplates: true })
  const g = w.grid, h = (x: number, z: number) => w.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)]
  const ports = w.zones.filter((z) => /^VAN_PORT_/.test(z.id) && z.harbour)
  assert.ok(ports.length >= 1, 'at least one harbour')
  for (const p of ports) {
    const H = p.harbour!
    // sea parts all in the water; heads of the added jetties and quay foot >= 5 m deep
    const sea = p.entities.filter((e) => PORT_SEA_RX.test(e.prefab))
    const dry = sea.filter((e) => h(e.x, e.z) > 0)
    assert.equal(dry.length, 0, `${p.id}: sea parts out of the water ${dry.slice(0, 3).map((e) => e.prefab.split('/').pop() + '@' + h(e.x, e.z).toFixed(1))}`)
    for (const [u, , v1] of H.jetties) { const [x, z] = localToWorld(H, u, v1); assert.ok(h(x, z) <= -5, `${p.id}: jetty head ${h(x, z)}`) }
    for (let u = -H.quayHalf + 5; u <= H.quayHalf - 5; u += 10) { const [x, z] = localToWorld(H, u, g.step + 1); assert.ok(h(x, z) <= -5, `${p.id}: quay foot (one cell off the wall) ${h(x, z)}`) }
    // basin interior at -7.5 +- 0.5 (sampled 10 m inside the polygon)
    const bu = H.basin.filter((_, i) => i % 2 === 0), bv = H.basin.filter((_, i) => i % 2 === 1)
    let nb = 0
    for (let u = Math.min(...bu) + 10; u <= Math.max(...bu) - 10; u += 6) for (let v = 8; v <= Math.max(...bv) - 10; v += 6) {
      const [x, z] = localToWorld(H, u, v)
      // inside the polygon by >= 10 m: check against the arm lines too
      const inside = (() => { for (let i = 0, j = H.basin.length - 2; i < H.basin.length; j = i, i += 2) { const ax = H.basin[j], az = H.basin[j + 1], dx = H.basin[i] - ax, dz = H.basin[i + 1] - az, L = Math.hypot(dx, dz) || 1; if ((dx * (v - az) - dz * (u - ax)) / L < 10) return false } return true })()
      if (!inside) continue
      nb++
      assert.ok(Math.abs(h(x, z) + 7.5) <= 0.5, `${p.id}: basin ${h(x, z).toFixed(2)} at ${u},${v}`)
    }
    assert.ok(nb > 5, `${p.id}: basin samples ${nb}`)
    // apron flat: spread < 0.3 m (5-30 m behind the quay, along it)
    let lo = Infinity, hi = -Infinity
    for (let u = -H.quayHalf + 5; u <= H.quayHalf - 5; u += 4) for (let v = -30; v <= -5; v += 4) { const [x, z] = localToWorld(H, u, v); const q = h(x, z); lo = Math.min(lo, q); hi = Math.max(hi, q) }
    assert.ok(hi - lo < 0.3, `${p.id}: apron spread ${(hi - lo).toFixed(2)} (${lo.toFixed(2)}..${hi.toFixed(2)})`)
    // no road within 40 m of the quay except the harbour's own (quay street + link)
    const lines = [...w.roads.map((r) => r.pts), ...w.zones.flatMap((z) => z.roads.filter((r) => !r.id.startsWith(p.id + '_')).map((r) => r.pts))]
    for (const l of lines) for (let i = 0; i + 1 < l.length; i += 2) { const [u, v] = toLocal(H, l[i], l[i + 1]); assert.ok(quayDist(H, u, v) >= 40, `${p.id}: road ${quayDist(H, u, v).toFixed(1)} m from the quay`) }
    assert.ok(p.roads.some((r) => r.id === `${p.id}_quay`), 'quay street')
    // red / green pair across the pass, in the water, ~ the pass width apart
    const red = p.entities.find((e) => e.prefab === HARBOUR_PREFABS.buoyRed), green = p.entities.find((e) => e.prefab === HARBOUR_PREFABS.buoyGreen)
    assert.ok(red && green, `${p.id}: buoy pair`)
    const [pl, pv0, pr, pv1] = H.pass, pw = Math.hypot(pr - pl, pv1 - pv0), d = Math.hypot(red!.x - green!.x, red!.z - green!.z)
    assert.ok(d > 20 && d <= pw + 1, `${p.id}: buoys ${d.toFixed(0)} m apart, pass ${pw.toFixed(0)}`)
    for (const b of [red!, green!]) { const [, v] = toLocal(H, b.x, b.z); assert.ok(v > Math.min(pv0, pv1), `${p.id}: buoy in front of the pass`) }
  }
})

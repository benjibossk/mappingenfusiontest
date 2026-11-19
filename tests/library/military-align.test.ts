import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignToRoad, generateMilitary, MIL_ROAD_CLEAR } from '../../src/modules/military'

test('military base aligns parallel to the nearest road segment, clear of it, one perpendicular access', () => {
  // slanted public road (30° off X), polyline with coarse vertices
  const a = 30 * Math.PI / 180, road = [0, 0, 400 * Math.cos(a), 400 * Math.sin(a), 800 * Math.cos(a), 800 * Math.sin(a)]
  const al = alignToRoad(380, 300, [road], 70)!
  const site = generateMilitary({ kind: 'main', x: al.x, z: al.z, yaw: al.yaw, seed: 1 })
  const tx = Math.cos(a), tz = Math.sin(a), nx = -tz, nz = tx
  const distTo = (x: number, z: number) => Math.abs(x * nx + z * nz)
  const flat = site.shapes.find((s) => s.id.endsWith('-x'))!.points
  // cross street parallel: both ends at the same distance from the road line
  const e0 = distTo(flat[0], flat[1]), e1 = distTo(flat[flat.length - 2], flat[flat.length - 1])
  assert.ok(Math.abs(e0 - e1) < 0.5, `cross street not parallel: ${e0} vs ${e1}`)
  // whole fenced area clear of the road corridor (8 m)
  const S = site.area, [gx, gz] = site.gate
  assert.ok(Math.abs(distTo(gx, gz) - MIL_ROAD_CLEAR) < 0.5)
  assert.ok(distTo(S.x, S.z) - S.hd >= MIL_ROAD_CLEAR - 0.5)
  // access street: from the road axis, perpendicular
  const f = site.shapes.find((s) => s.id.endsWith('-st'))!.points
  assert.ok(distTo(f[0], f[1]) < 0.5, 'access stub does not reach the road')
  const vx = f[f.length - 2] - f[0], vz = f[f.length - 1] - f[1]
  assert.ok(Math.abs(vx * tx + vz * tz) / Math.hypot(vx, vz) < 0.01, 'access not perpendicular')
})

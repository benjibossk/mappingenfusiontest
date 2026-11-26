import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractWater } from '../src/modules/imageMap'

// picture 119: a lake ~200 m across swelling a 100 m river east of the town came out as the river ribbon only
function mask(bulge: boolean) {
  const w = 400, h = 400, m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inRiver = Math.abs(x - 200) <= 12
    const inLake = bulge && ((x - 200) / 45) ** 2 + ((y - 200) / 80) ** 2 <= 1
    if (inRiver || inLake) m[y * w + x] = 1
  }
  return m
}
test('a lake swelling a river is traced as a lake beside the river; a plain river gives none', () => {
  const plain = extractWater(mask(false), 400, 400, 2)
  assert.equal(plain.filter((x) => x.kind === 'lake').length, 0)
  const sw = extractWater(mask(true), 400, 400, 2)
  const lakes = sw.filter((x) => x.kind === 'lake')
  assert.equal(lakes.length, 1)
  assert.ok(lakes[0].onRiver)
  assert.ok(sw.some((x) => x.kind === 'river'))
})

test('a river swelling lake takes the river level, not the lowest ground of its shore', async () => {
  const { carveWater } = await import('../src/modules/water')
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = Array.from({ length: 200 * 200 }, (_, k) => 6 - Math.floor(k / 200) * 0.005) // slopes down along z
  const river = { id: 'R', type: 'river' as const, pts: [400, 0, 400, 400, 400, 796], width: 40, depth: 2.5, carve: false, wetEdge: true }
  const lake = { id: 'L', type: 'lake' as const, pts: [360, 300, 440, 300, 470, 400, 440, 500, 360, 500, 330, 400], width: 0, depth: 2, onRiver: true }
  carveWater(hs, g, [river, lake])
  assert.ok(lake.level !== undefined)
  // the river level at the lake (z 300..500): the ground there minus about RIVER_BANK, never far under it
  assert.ok(lake.level! > 3 && lake.level! < 6, String(lake.level))
})

test('a river swelling lake is dug as deep as the wide river middle (picture 120: bed showing at 2 m)', async () => {
  const { carveWater, PICTURE_SWELL_LAKE_DEPTH } = await import('../src/modules/water')
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = Array.from({ length: 200 * 200 }, () => 6)
  const river = { id: 'R', type: 'river' as const, pts: [400, 0, 400, 400, 400, 796], width: 40, depth: 2.5, carve: false, wetEdge: true }
  const lake = { id: 'L', type: 'lake' as const, pts: [300, 300, 500, 300, 540, 400, 500, 500, 300, 500, 260, 400], width: 0, depth: PICTURE_SWELL_LAKE_DEPTH, onRiver: true }
  carveWater(hs, g, [river, lake])
  // a cell inside the lake, 40 m from the river centre, 60 m from the shore
  const h = hs[(400 / 4) * 200 + 340 / 4]
  assert.ok(h <= lake.level! - 3.5, `${h} vs level ${lake.level}`)
})

test('the river ribbon stops just inside a swelling lake instead of running on under it (round 11)', () => {
  const sw = extractWater(mask(true), 400, 400, 2)
  const lake = sw.find((x) => x.kind === 'lake')!
  const rivers = sw.filter((x) => x.kind === 'river')
  assert.equal(rivers.length, 2)
  const inP = (p: number[], x: number, z: number) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; return c }
  for (const r of rivers) {
    const inside = r.pts.filter((_, i) => i % 2 === 0).filter((x, k) => inP(lake.pts, x, r.pts[k * 2 + 1])).length
    assert.ok(inside <= 1, `${inside} river points inside the lake`)
  }
})

test('ribbon levels are pinned to the swelling lake level at the lake', async () => {
  const { pinToLakes } = await import('../src/modules/water')
  const line = [0, 0, 0, 50, 0, 100, 0, 150, 0, 200], level = [3, 2.5, 2, 1.5, 1]
  pinToLakes(line, level, [{ id: 'L', type: 'lake', pts: [-50, 80, 50, 80, 50, 120, -50, 120], width: 0, depth: 4, onRiver: true, level: 1.8 }])
  assert.deepEqual(level, [3, 2.5, 1.8, 1.5, 1])
})

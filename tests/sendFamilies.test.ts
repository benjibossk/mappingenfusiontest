import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error plain JS bridge module
import { APP_FAMILIES, familiesPlan, familyOf } from '../bridge/families.mjs'

const proj = (ids: string[], extra = {}) => ({ shapes: ids.filter((i) => !i.startsWith('E:')).map((id) => ({ id })), entities: ids.filter((i) => i.startsWith('E:')).map((i) => ({ id: i.slice(2) })), ...extra })

test('familyOf: prefix up to the first "_", as MG_ApplyProjectPlugin AddFamily', () => {
  assert.equal(familyOf('CLIFF_G12'), 'CLIFF_')
  assert.equal(familyOf('FOREST_B2_IMG_3'), 'FOREST_')
  assert.equal(familyOf('NOPREFIX'), null)
})

test('familiesPlan: a full send clears the families of an earlier send it no longer has (rocks of the old map)', () => {
  // earlier: a random world with cliff / scatter rocks; now: a picture map without rocks
  const p = familiesPlan(['ROAD_', 'FOREST_', 'CLIFF_', 'SCAT_'], proj(['ROAD_1', 'FOREST_IMG_1', 'E:IMG_BLD_1'], { replaceAll: true }))
  assert.deepEqual(p.clear.sort(), ['CLIFF_', 'SCAT_'])
  assert.deepEqual(p.after.sort(), ['FOREST_', 'IMG_', 'ROAD_'])
})

test('familiesPlan: forests sent later are kept by the full send; a partial send clears nothing', () => {
  const p = familiesPlan(['ROAD_', 'FOREST_', 'CLIFF_'], proj(['ROAD_1'], { replaceAll: true, keep: ['FOREST_'] }))
  assert.deepEqual(p.clear, ['CLIFF_'])
  assert.ok(p.after.includes('FOREST_'))
  const q = familiesPlan(['ROAD_'], proj(['FOREST_B1_X']))
  assert.deepEqual(q.clear, [])
  assert.deepEqual(q.after.sort(), ['FOREST_', 'ROAD_'])
})

test('familiesPlan: no record yet (sends before the fix): every app family is assumed in the world', () => {
  const p = familiesPlan(null, proj(['ROAD_1'], { replaceAll: true }))
  assert.ok(p.clear.includes('CLIFF_') && p.clear.includes('SCAT_') && !p.clear.includes('ROAD_'))
  assert.equal(p.clear.length, APP_FAMILIES.length - 1)
})

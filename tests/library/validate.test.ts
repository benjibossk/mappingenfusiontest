// Pre-send checks (src/modules/validate.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, polyOverlap, inPoly, overfullBlockList } from '../../src/modules/validate.ts'

const grid = { cols: 11, rows: 11, step: 10 } as any // 100 m map
const heights = new Array(121).fill(10)
const sq = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s]
const base = { roads: [], sites: [], settled: [], refusedGaps: [], heights, grid }
const kinds = (o: any) => validate({ ...base, ...o }).map((i) => i.kind)

test('polygon helpers', () => {
  assert.ok(inPoly(5, 5, sq(0, 0, 10)))
  assert.ok(!inPoly(15, 5, sq(0, 0, 10)))
  assert.ok(polyOverlap(sq(0, 0, 10), sq(5, 5, 10)))
  assert.ok(polyOverlap(sq(0, 0, 30), sq(5, 5, 5))) // contained
  assert.equal(polyOverlap(sq(0, 0, 10), sq(20, 20, 10)), null)
})

test('overlapping areas and zones', () => {
  const areas = [{ id: 'F1', kind: 'forest', pts: sq(10, 10, 30) }, { id: 'C1', kind: 'field', pts: sq(30, 30, 30) }]
  assert.deepEqual(kinds({ areas }), ['overlap'])
  const zones = [{ id: 'IND_1', x: 80, z: 80, boxes: [{ corners: sq(75, 75, 10) }, { corners: sq(78, 78, 10) }] }]
  assert.deepEqual(kinds({ zones }), []) // boxes of the same zone may overlap
})

test('outside the map', () => {
  const settled = [{ id: 'B1', x: 150, z: 50 }] as any
  assert.deepEqual(kinds({ settled }), ['outside'])
})

test('building in a field and road through a field', () => {
  const areas = [{ id: 'C1', kind: 'field', pts: sq(20, 20, 40) }]
  const settled = [{ id: 'B1', x: 40, z: 40 }] as any
  assert.deepEqual(kinds({ areas, settled }), ['buildingField'])
  const roads = [{ id: 'R1', type: 'dirt', pts: [5, 40, 30, 40] }] as any
  assert.deepEqual(kinds({ areas, roads }), ['roadField'])
})

test('more than 5 surfaces per block', () => {
  const g = { cols: 9, rows: 9, step: 8 }
  const surf = (n: number) => Array.from({ length: n }, (_, i) => ({ ...g, name: 's' + i, weights: new Array(81).fill(1) }))
  assert.equal(overfullBlockList(surf(5)).length, 0)
  const l = overfullBlockList(surf(6))
  assert.equal(l.length, 1)
  assert.equal(l[0].used, 6)
})

// P2 #16: OSM road tags on import (lanes / width / surface / bridge / tunnel), src/modules/osm.ts + osmWidth.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { osmToMap } from '../../src/modules/osm.ts'
import { isBridge, isTunnel, osmRoadType } from '../../src/modules/osmWidth.ts'

const data = JSON.parse(readFileSync('tests/fixtures/osm-roads.fixture.json', 'utf8'))
const opts = { mainRoads: true, minorRoads: true, tracks: true, paths: true, water: false, forests: false, fields: false, places: false, minForest: 1e9 } as never
// 1° = 1000 m, map 1000 m centred on (0.5, 0.5)
const res = osmToMap(data, (lon, lat) => [(lon - 0.5) * 1000, (lat - 0.5) * 1000], 1000, opts)
const at = (z: number) => res.roads.filter((r) => Math.abs(r.pts[1] - z) < 2)

test('osm roads: tunnels left out, bridges marked, building passages kept', () => {
  assert.equal(at(300).length, 0, 'tunnel imported')
  assert.ok(at(200).length && at(200).every((r) => r.bridge), 'bridge not marked')
  assert.ok(at(100).every((r) => !r.bridge))
  assert.equal(at(700).length, 1, 'building passage dropped')
})

test('osm roads: width from width / lanes tags', () => {
  assert.equal(at(200)[0].width, 9)
  assert.ok(Math.abs(at(100)[0].width! - 6.3) < 0.01, 'lanes x 3.15')
})

test('osm roads: surface picks the vanilla road type', () => {
  assert.equal(at(400)[0].type, 'dirt')
  assert.equal(at(500)[0].type, 'cobble')
  assert.equal(at(600)[0].type, 'asphaltNarrow')
  assert.equal(at(100)[0].type, 'asphalt')
  assert.equal(osmRoadType({ surface: 'gravel' }, 'trailDirt'), 'trailGravel')
  assert.equal(osmRoadType({}, 'asphalt'), 'asphalt')
  assert.ok(isBridge({ man_made: 'bridge' }) && !isBridge({ bridge: 'no' }))
  assert.ok(isTunnel({ tunnel: 'culvert' }) && !isTunnel({ tunnel: 'no' }))
})

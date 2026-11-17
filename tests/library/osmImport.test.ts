import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_SCHEMA, importOsm, parseOsmFile, parseSchema, powerKindOf, ruleFor } from '../../src/modules/osmImport'
import type { OsmOptions } from '../../src/modules/osm'

const fx = (n: string) => readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8')
// equirectangular around (5.0025, 45.0025): map of ~400 m, centred
const toLocal = (lon: number, lat: number): [number, number] => [(lon - 5.0025) * 111320 * Math.cos(45 * Math.PI / 180), (45.0025 - lat) * 110540]
const O: OsmOptions = { mainRoads: true, minorRoads: true, tracks: true, paths: true, water: true, forests: true, fields: true, places: true, buildings: true, minForest: 0 }

test('osm xml: roads, zones, power, places, clipped to the map', () => {
  const d = parseOsmFile('a.osm', fx('import-small.osm'))
  assert.equal(d.elements.length, 7)
  const r = importOsm(d, DEFAULT_SCHEMA, toLocal, 400, O)
  assert.equal(r.roads.length, 1)
  assert.equal(r.roads[0].type, 'asphaltLine')
  assert.equal(r.roads[0].width, 7.3) // lanes 2 x 3.65 (ARTE)
  assert.equal(r.forests.length, 1)
  assert.equal(r.rivers.length, 1)
  assert.equal(r.sites[0].name, 'Saint-Test & Co')
  assert.equal(r.extras.zones[0].kind, 'residential')
  assert.equal(r.extras.power.length, 1)
  assert.equal(r.extras.power[0].voltage, 63000)
  assert.equal(r.extras.substations.length, 1)
  // the power line runs past both corners: clipped inside
  const p = r.extras.power[0].pts
  for (const v of p) assert.ok(v >= 0 && v <= 400)
})

test('geojson: track, industrial, building, nested overpass-turbo tags, unknown dropped', () => {
  const d = parseOsmFile('b.geojson', fx('import-small.geojson'))
  const r = importOsm(d, DEFAULT_SCHEMA, toLocal, 400, O)
  assert.equal(r.roads.length, 1)
  assert.equal(r.roads[0].width, 4.5) // track grade1 -> paved 4.5 m
  assert.equal(r.extras.zones[0].kind, 'industrial')
  assert.equal(r.buildings.length, 1)
  assert.equal(r.fields.length, 1)
  assert.equal(r.counts.ignore, undefined)
})

test('custom schema renames and ignores', () => {
  const s = parseSchema(JSON.stringify({ rules: [{ key: 'landuse', values: ['residential'], layer: 'forest' }, { key: 'highway', layer: 'ignore' }] }))
  const r = importOsm(parseOsmFile('a.osm', fx('import-small.osm')), s, toLocal, 400, O)
  assert.equal(r.roads.length, 0)
  assert.equal(r.forests.length, 1)
  assert.equal(ruleFor({ highway: 'no' }, DEFAULT_SCHEMA), null)
  assert.throws(() => parseSchema('{"x":1}'))
})

test('voltage classes', () => {
  assert.equal(powerKindOf(400000), 'ehv'); assert.equal(powerKindOf(63000), 'hv'); assert.equal(powerKindOf(20000), 'mv'); assert.equal(powerKindOf(400), 'lv')
})

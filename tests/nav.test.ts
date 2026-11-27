import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SECTIONS, SECTION_STEPS, SECTION_TILES, followStep, sectionOfStep, startState } from '../src/nav'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const STEP_TABS = ['island', 'brush', 'water', 'roads', 'villages', 'camp', 'wb']

test('every generator step belongs to a section', () => {
  for (const s of STEP_TABS) assert.ok(SECTIONS.some((k) => SECTION_STEPS[k].includes(s)), s)
  assert.equal(sectionOfStep('brush'), 'terrain')
  assert.equal(sectionOfStep('roads'), 'atelier')
})

test('every tile points at something that exists', () => {
  for (const k of SECTIONS) {
    assert.ok(SECTION_TILES[k].length > 0, k)
    for (const tl of SECTION_TILES[k]) {
      const [kind, arg] = tl.act.split(':')
      if (kind === 'click' || kind === 'focus') assert.ok(main.includes(`id="${arg}"`), `${k}.${tl.id} -> #${arg}`)
      else if (kind === 'step') assert.ok(STEP_TABS.includes(arg), tl.act)
      else if (kind === 'atelier') assert.match(arg, /^(s[0-6]|net|tex|zone)$/)
      else if (kind === 'level') assert.ok(['home', 'projects'].includes(arg))
      else assert.equal(kind, 'soon')
      if (tl.step) assert.ok(STEP_TABS.includes(tl.step))
      if (tl.focus) assert.ok(main.includes(`id="${tl.focus}"`), tl.focus)
    }
  }
})

test('terrain offers island, random, image, heightmap and a GIS placeholder', () => {
  const ids = SECTION_TILES.terrain.map((x) => x.id)
  for (const id of ['island', 'random', 'image', 'heightmap', 'gis']) assert.ok(ids.includes(id), id)
  assert.equal(SECTION_TILES.terrain.find((x) => x.id === 'gis')!.act, 'soon')
})

test('start: an autosaved terrain opens its dashboard, otherwise home', () => {
  assert.deepEqual(startState(true, 'masks'), { level: 'dashboard', section: 'masks' })
  assert.deepEqual(startState(true, 'bogus'), { level: 'dashboard', section: 'terrain' })
  assert.deepEqual(startState(true, null), { level: 'dashboard', section: 'terrain' })
  assert.equal(startState(false, 'masks').level, 'home')
})

test('opening a step outside the section follows it', () => {
  const st = { level: 'dashboard' as const, section: 'terrain' as const }
  assert.equal(followStep(st, 'brush'), st)
  assert.equal(followStep(st, 'roads').section, 'atelier')
})

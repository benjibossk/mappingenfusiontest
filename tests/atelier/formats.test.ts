// Mode Atelier parsers on real files (READ-ONLY): run with `node --test tests/atelier/`
// Uses a local Workbench project when present (Normandy_Edit / Mapgenerator), skips otherwise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { parseTerr } from '../../src/atelier/formats/terr.ts'
import { parseTtile } from '../../src/atelier/formats/ttile.ts'
import { balanced, buildingType, layerObjects, roadType, splitLines, treeType, waterBodies, wallType, portType } from '../../src/atelier/formats/layer.ts'
import { assembleHeights } from '../../src/atelier/heights.ts'
import { diagnose, diagCsv } from '../../src/atelier/diag.ts'
import { analyseBody, rewriteLayer, MAX_POINTS } from '../../src/atelier/water.ts'
import { contourConf, CONTOUR_DEFAULTS, mapSize } from '../../src/atelier/contours.ts'
import { simplify, fillPoly, distTo, largestContour } from '../../src/atelier/raster.ts'
import { zip, unzip } from '../../src/atelier/zip.ts'

const ADDONS = process.env.RM_ADDONS ?? 'C:/Users/benbo/Documents/My Games/ArmaReforgerWorkbench/addons'
const NORM = ADDONS + '/Normandy_Edit/Worlds/'
const MG = ADDONS + '/Mapgenerator/Worlds/MG_Test/'
const BASE = 'C:/Users/benbo/tools/third_party/basegame_extract'
const has = (p: string) => existsSync(p)

function loadTiles(dir: string, prefix: string, terr: ReturnType<typeof parseTerr>) {
  return readdirSync(dir).filter((f) => f.startsWith(prefix) && /^\d+\.ttile$/.test(f.slice(prefix.length)))
    .map((f) => parseTtile(readFileSync(dir + f), terr.tilesX * terr.blocksPerTile, terr.blocksPerTile, true))
}

test('terr + ttile: 16x16 power-of-two grid (MG_Test)', { skip: !has(MG + 'MG_Test.terr') }, () => {
  const t = parseTerr(readFileSync(MG + 'MG_Test.terr'))
  assert.equal(t.vertsX, 2049); assert.equal(t.cellsPerBlock, 32); assert.equal(t.blocksPerTile, 4); assert.equal(t.cellSize, 2)
  assert.equal(t.tilesX, 16); assert.equal(t.sizeX, 4096)
  assert.ok(t.materials.length > 10 && t.materials.every((m) => /^[0-9A-F]{16}$/.test(m.guid)))
  const tiles = loadTiles(MG + '.Data/', 'MG_Test_', t)
  assert.equal(new Set(tiles.map((x) => x.tx + ',' + x.ty)).size, 256)
  const H = assembleHeights(t, tiles)
  assert.equal(H.missing, 0); assert.ok(H.min < 0 && H.max > 0)
})

test('ttile: 19x19 grid (76 blocks per side, not a power of two) decodes with the linear index', { skip: !has(NORM + 'TESTIsland/TESTIsland.terr') }, () => {
  const t = parseTerr(readFileSync(NORM + 'TESTIsland/TESTIsland.terr'))
  assert.equal(t.tilesX, 19)
  const tiles = loadTiles(NORM + 'TESTIsland/.Data/', 'TESTIsland_', t)
  const keys = new Set(tiles.map((x) => x.tx + ',' + x.ty))
  assert.equal(keys.size, 361)
  for (const x of tiles) assert.ok(x.tx >= 0 && x.tx < 19 && x.ty >= 0 && x.ty < 19)
  // file N is tile (N mod 19, N div 19)
  const t100 = parseTtile(readFileSync(NORM + 'TESTIsland/.Data/TESTIsland_100.ttile'), 76, 4)
  assert.deepEqual([t100.tx, t100.ty], [5, 5])
  const d = diagnose(t, tiles, 5)
  assert.equal(d.blocks.length, 361 * 16)
  assert.ok(d.maxPerBlock <= 7)
  assert.match(diagCsv(t, d, 5).split('\n')[1], /^\d+;\d+;\d+;\d+;\d+;5;[01];/)
})

test('layer: water bodies, objects, rewrite keeps braces balanced and lakes <= 60 points', { skip: !has(NORM + 'TESTIsland_Layers/Trees.layer') }, () => {
  const t = parseTerr(readFileSync(NORM + 'TESTIsland/TESTIsland.terr'))
  const H = assembleHeights(t, loadTiles(NORM + 'TESTIsland/.Data/', 'TESTIsland_', t))
  const text = readFileSync(NORM + 'TESTIsland_Layers/Trees.layer', 'utf-8')
  const { lines } = splitLines(text)
  assert.ok(balanced(lines))
  const o = layerObjects(lines)
  assert.ok(o.trees.length > 1000 && o.roads.length > 0 && o.walls.length > 0)
  for (const tr of o.trees.slice(0, 500)) assert.ok(tr.x > -100 && tr.x < t.sizeX + 100 && tr.z > -100 && tr.z < t.sizeZ + 100)
  const bodies = waterBodies(lines, 'Trees.layer')
  assert.ok(bodies.some((b) => b.kind === 'lake') && bodies.some((b) => b.kind === 'river'))
  const props = bodies.map((b) => analyseBody(b, H))
  const mod = props.filter((p) => p.status === 'modified')
  assert.ok(mod.length > 0)
  for (const p of mod) if (p.kind === 'lake') { assert.ok(p.nptsNew! <= MAX_POINTS); assert.ok(p.lostM2! <= Math.max(20, 0.01 * p.waterM2!)) }
  for (const p of mod) if (p.kind === 'river') { assert.ok(p.segments!.length >= 1); for (const s of p.segments!) assert.ok(s.Width <= p.width!) }
  const r = rewriteLayer(text, 'Trees.layer', props)
  assert.equal(r.changed, mod.length)
  const after = splitLines(r.text).lines
  assert.ok(balanced(after))
  const b2 = waterBodies(after, 'Trees.layer')
  const segs = mod.filter((p) => p.kind === 'river').reduce((s, p) => s + p.segments!.length - 1, 0)
  assert.equal(b2.length, bodies.length + segs)
  for (const p of mod.filter((q) => q.kind === 'lake')) assert.ok(b2.some((b) => b.kind === 'lake' && b.x.length === p.nptsNew))
  // untouched text outside the edited blocks: same line count difference only from the edits
  assert.ok(Math.abs(after.length - lines.length) < 5000)
})

test('layer: classification of prefabs', () => {
  assert.equal(roadType('PrefabLibrary/WEGenerators/Roads/Asphalt/RG_Road_Asphalt.et'), 'asphalt')
  assert.equal(roadType('x/Roads/Cobblestone/a.et'), 'concrete')
  assert.equal(roadType('x/Roads/Dirt/a.et'), 'dirt')
  assert.equal(buildingType('Prefabs/Structures/Houses/Village/House_01.et'), 'house')
  assert.equal(buildingType('Prefabs/Structures/Industrial/Containers/C.et'), null)
  assert.equal(treeType('Prefabs/Vegetation/Trees/PinusSylvestris_01.et'), 'conifer')
  assert.equal(treeType('Prefabs/Vegetation/Trees/BetulaPendula_01.et'), 'deciduous')
  assert.equal(wallType('Prefabs/Structures/Walls/Stone/StoneWall_01.et'), 'wall')
  assert.equal(wallType('Prefabs/Structures/Walls/Kerb_01.et'), null)
  assert.equal(portType('Prefabs/Structures/Infrastructure/Harbour/PierConcrete_01.et'), 'slab')
  assert.equal(portType('Prefabs/x/Breakwater_01.et'), 'breakwater')
})

test('layer: base game prefab files (extract, text .et) parse as balanced trees', { skip: !has(BASE + '/Prefabs') }, () => {
  const walk = (d: string, out: string[] = []): string[] => { for (const n of readdirSync(d, { withFileTypes: true })) { if (out.length > 4000) break; if (n.isDirectory()) walk(d + '/' + n.name, out); else if (n.name.endsWith('.et')) out.push((d + '/' + n.name).slice(BASE.length + 1)) } return out }
  const all = walk(BASE + '/Prefabs')
  assert.ok(all.length > 0)
  for (const p of all) { const { lines } = splitLines(readFileSync(BASE + '/' + p, 'utf-8')); assert.ok(balanced(lines), p); layerObjects(lines) }
})

test('contours: .conf template', () => {
  const c = contourConf(CONTOUR_DEFAULTS)
  assert.match(c, /^SCR_MapConfig : "\{1B8AC767E06A0ACD\}Configs\/Map\/MapFullscreen.conf" \{/)
  assert.equal((c.match(/SCR_LayerConfiguration/g) ?? []).length, 4)
  assert.match(c, /m_CoastalColor 0\.202 0\.064 0\.031 0\n/)
  assert.ok(!c.includes('SCR_BuildingPropsConfig'))
  assert.ok(contourConf({ ...CONTOUR_DEFAULTS, hideWalls: true }).includes('SCR_BuildingTypeProps "{5A16C2F7EB6E9ECF}"'))
  let d = 0; for (const ch of c) { if (ch === '{') d++; if (ch === '}') d-- } assert.equal(d, 0)
  assert.equal(mapSize(4097), 4096); assert.equal(mapSize(8190), 8188)
})

test('raster: fill, distance, contour, simplify', () => {
  const W = 40, H = 30, sq = fillPoly(W, H, [[5, 5], [25, 5], [25, 20], [5, 20]])
  assert.equal(sq.reduce((s, v) => s + v, 0), 20 * 15)
  const d = distTo(sq, W, H)
  assert.equal(d[10 * W + 10], 0); assert.ok(Math.abs(d[10 * W + 30] - 6) < 1e-6)
  const c = largestContour(sq, W, H)!
  assert.ok(c.length >= 60)
  assert.equal(simplify(c, 1, true).length, 4)
})

test('zip: round trip', async () => {
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) }]
  const z = await unzip(zip(files))
  assert.equal(new TextDecoder().decode(z.get('a.txt')), 'hello')
  assert.deepEqual([...z.get('dir/b.bin')!], [0, 1, 2, 255])
})

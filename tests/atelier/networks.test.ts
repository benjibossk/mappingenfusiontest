// Atelier network viewers: layer extraction (groups, nested transforms, splines), rail graph (snapped ends,
// gaps, overlaps, duplicates, axis calibration), power graph (T junctions, isolated poles).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extract, removeBlocks } from '../../src/atelier/networks/extract.ts'
import { clusterEnds, components, toCsv, toJson, shareText } from '../../src/atelier/networks/graph.ts'
import { chains, isRailPiece, pieceLength, railFeature, railNetwork, removableDuplicates } from '../../src/atelier/networks/rails.ts'
import { isPole, powerNetwork } from '../../src/atelier/networks/power.ts'

const R = '{8E11620964565875}Prefabs/Structures/Rails/RailDRoit19m01.et'
/** n straight pieces of 19 m along +Z (yaw 0) starting at z0, as one $grp */
function track(x: number, z0: number, n: number, step = 19, extra = ''): string {
  let s = `$grp GenericEntity : "${R}" {\n`
  for (let i = 0; i < n; i++) s += ` {\n  coords ${x} 10 ${z0 + step / 2 + i * step}\n  angles 0 0 0\n }\n`
  return s + extra + '}\n'
}

test('names: rail pieces, features, lengths', () => {
  assert.ok(isRailPiece(R))
  assert.ok(isRailPiece('Prefabs/Structures/Infrastructure/Railways/HarborRail_01/HarborRail_01_8m.et'))
  assert.ok(!isRailPiece('Prefabs/Structures/Walls/Pipe/PipeRailing_03/PipeRailing_03_V2_3m.et'))
  assert.ok(!isRailPiece('Prefabs/Infrastructure/Platforms/Railway Platform.et'))
  assert.equal(railFeature('Prefabs/Infrastructure/Platforms/Railway Platform.et'), 'station')
  assert.equal(railFeature('Prefabs/Infrastructure/Railways/Concrete stop.et'), 'stop')
  assert.equal(pieceLength(R), 19)
  assert.equal(pieceLength('x/HarborRail_01_4m.et'), 4)
  assert.equal(pieceLength('x/RailwayTrackRuin_01_10m_V1.et'), 10)
  assert.equal(pieceLength('x/RailCurve.et'), null)
  assert.ok(isPole('Prefabs/Structures/Infrastructure/Power/Powerlines/PowerLine_01/PowerLine_01_pole_small_hook.et'))
  assert.ok(!isPole('Prefabs/Structures/Walls/Pipe/PipeRailing_01/PipeRailing_01_Pole.et'))
})

test('extract: $grp children, nested parent yaw, spline points in world coordinates, line ranges', () => {
  const text = [
    'GenericEntity : "{0000000000000001}Prefabs/Parent.et" {', ' coords 100 0 200', ' angles 0 90 0', ' {',
    '  GenericEntity : "{0000000000000002}Prefabs/Structures/Rails/Rail04m.et" {', '   coords 10 0 0', '  }', ' }', '}',
    'SplineShapeEntity {', ' coords 1000 5 1000', ' Points {', '  ShapePoint "{A}" {', '   Position 0 0 0', '  }', '  ShapePoint "{B}" {', '   Position 0 2 50', '   Data {', '    SCR_PowerlineGeneratorPointData "{C}" {', '    }', '   }', '  }', ' }',
    ' {', '  SCR_PowerlineGeneratorEntity : "{15D9F0EBA2E2DDFF}Prefabs/PG_PowerLine_01.et" {', '   Distance 30', '   {', '    $grp SCR_PowerPole : "{17F4D13D8E2E43C1}Prefabs/Power/PowerLine_01_pole.et" {', '     {', '      coords 0 0 0', '     }', '     {', '      coords 0 2 50', '     }', '    }', '   }', '  }', ' }', '}',
  ].join('\n')
  const ex = extract(text, 'a.layer', { inst: (p) => isRailPiece(p) || isPole(p), spline: (c) => /Powerline/.test(c) })
  const rail = ex.insts.find((i) => i.prefab.endsWith('Rail04m.et'))!
  // child at local (10, 0) of a parent rotated 90°: x' = 10·cos90 = 0, z' = -10·sin90 = -10
  assert.ok(Math.abs(rail.x - 100) < 1e-6 && Math.abs(rail.z - 190) < 1e-6, `${rail.x},${rail.z}`)
  assert.equal(rail.a, 4); assert.equal(rail.b, 6)
  assert.equal(ex.splines.length, 1)
  assert.deepEqual(ex.splines[0].pts.map((p) => p.map((v) => Math.round(v))), [[1000, 5, 1000], [1000, 7, 1050]])
  assert.equal(ex.splines[0].props.Distance, '30')
  const poles = ex.insts.filter((i) => isPole(i.prefab))
  assert.equal(poles.length, 2); assert.ok(poles.every((p) => p.gen === 'SCR_PowerlineGeneratorEntity' && p.grpA >= 0))
  assert.equal(ex.grpCount.get('a.layer:' + poles[0].grpA), 2)
})

test('rail graph: snapped joints, gap, overlap, duplicate, ends, chains', () => {
  // line A: 6 pieces 0..114 m; a 3 m gap; line B: 3 pieces from 117 m; a duplicate piece; an overlapping piece beside nothing
  const dupPiece = ` {\n  coords 0 10 ${19 / 2}\n  angles 0 0 0\n }\n`
  const text = track(0, 0, 6, 19, dupPiece) + track(0, 117, 3) + track(500, 0, 1) + track(500, 9.5, 1)
  const ex = extract(text, 'r.layer', { inst: isRailPiece })
  const { net, duplicates, hyps } = railNetwork(ex.insts, 'en')
  assert.equal(hyps.RailDRoit19m01, 'zc')
  assert.equal(duplicates.length, 1)
  assert.equal(net.edges.length, 11)
  const gaps = net.issues.filter((i) => i.kind === 'gap')
  assert.equal(gaps.length, 1); assert.ok(Math.abs(gaps[0].d! - 3) < 0.01)
  assert.ok(net.issues.some((i) => i.kind === 'overlap'))
  const big = net.comps[0]
  assert.equal(big.edges, 6); assert.ok(Math.abs(big.len - 114) < 0.01); assert.equal(big.ends, 2)
  assert.ok(chains(net).some((c) => c.length === 7))
  const rm = removableDuplicates(duplicates, ex.grpCount)
  assert.equal(rm.length, 1)
  const out = removeBlocks(text, rm.map((d) => [d.a, d.b]))
  assert.equal(extract(out, 'r.layer', { inst: isRailPiece }).insts.length, ex.insts.length - 1)
  assert.match(toCsv(net), /RailDRoit19m01/); JSON.parse(toJson(net)); assert.match(shareText(net, 'Rails', 'fr'), /Longueur|Length/)
})

test('rail graph: long axis along X detected from the data', () => {
  const H = '{E40465CA8539A1F4}Prefabs/Structures/Infrastructure/Railways/HarborRail_01/HarborRail_01_8m.et'
  let s = `$grp GenericEntity : "${H}" {\n`
  for (let i = 0; i < 5; i++) s += ` {\n  coords ${4 + 8 * i} 0 0\n  angles 0 0 0\n }\n`
  const { net, hyps } = railNetwork(extract(s + '}\n', 'h', { inst: isRailPiece }).insts, 'en')
  assert.equal(hyps.HarborRail_01_8m[0], 'x')
  assert.equal(net.comps.length, 1); assert.equal(net.comps[0].ends, 2)
})

test('generic graph: clustering and components', () => {
  const { nodes, of } = clusterEnds([[0, 0], [0.5, 0], [10, 0], [10.2, 0.1], [50, 50]], 1)
  assert.equal(nodes.length, 3); assert.equal(of[0], of[1]); assert.equal(of[2], of[3])
  const edges = [{ id: 0, a: of[0], b: of[2], pts: [[0, 0], [10, 0]] as [number, number][], len: 10, cls: 'a', file: '', line: 0, comp: -1 }]
  const comps = components(nodes, edges, 'N')
  assert.equal(comps.length, 1); assert.equal(comps[0].ends, 2)
})

test('power graph: T junction joins networks, isolated hand-placed pole', () => {
  const spl = (a: [number, number], b: [number, number]) => ({ cls: 'SCR_PowerlineGeneratorEntity', prefab: 'x/PG_PowerLine_01.et', file: 'p', a: 0, b: 0, props: {}, pts: [[a[0], 0, a[1]], [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2], [b[0], 0, b[1]]] as [number, number, number][] })
  const pole = (x: number, z: number, gen: string | null) => ({ cls: 'SCR_PowerPole', prefab: 'Prefabs/Power/PowerLine_01_pole.et', x, y: 0, z, yaw: 0, file: 'p', a: 0, b: 0, grpA: -1, gen })
  const net = powerNetwork([spl([0, 0], [1000, 0]), spl([500, 2], [500, 600]), spl([3000, 0], [3100, 0])], [pole(0, 0, 'SCR_PowerlineGeneratorEntity'), pole(2000, 2000, null), pole(300, 3, null)], 'en')
  assert.equal(net.edges.length, 3)
  assert.equal(net.comps.length, 2) // the T line joins the first one
  assert.equal(net.issues.filter((i) => i.kind === 'isolated' && /pole/i.test(i.msg)).length, 1)
  assert.ok(net.issues.some((i) => i.kind === 'junction'))
})

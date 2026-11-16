// Road network viewer for an existing project: RoadGeneratorEntity splines → graph (ends snapped, T on a
// vertex of another road), km per class, junctions, dead ends, disconnected islands (roadgraph.ts
// roadIslands, read-only reuse) and steep segments sampled on the terrain heights.
import type { Spline } from './extract.ts'
import { clusterEnds, components, dist, DSU, Grid, polyLen, type Issue, type NEdge, type Network } from './graph.ts'
import { kindOf } from '../../modules/roadgraph'
import type { RoadType } from '../../modules/roads'

const base = (p: string) => (p.split('/').pop() ?? p).replace(/\.et$/i, '')
function segD(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L)) : 0
  return dist(px, pz, a[0] + t * dx, a[1] + t * dz)
}
export const isRoadGen = (cls: string) => /RoadGeneratorEntity$/.test(cls)
/** road generators used for decals / markings (flower beds, runway lines, panel rows…): not part of the network */
export const isDecorRoad = (prefab: string) => /flowerbed|runway_?line|_line\d|decal|panelrow|coal|tracks|marking|curb|sidewalk|pavement|stripe|parking|grass|moss|leaves|puddle/i.test(base(prefab))
export function roadTypeOf(prefab: string): RoadType {
  const b = base(prefab).toLowerCase()
  if (/trail.*gravel|gravel/.test(b)) return 'trailGravel'
  if (/trail.*forest|forest/.test(b)) return 'trailForest'
  if (/trail/.test(b)) return 'trailDirt'
  if (/dirt|mud|field/.test(b)) return 'dirt'
  if (/cobble/.test(b)) return 'cobble'
  if (/concrete|panel/.test(b)) return 'concrete'
  return 'asphalt'
}

export function roadNetwork(splines: Spline[], height: ((x: number, z: number) => number) | null, lang: 'fr' | 'en' = 'fr', o: { snap?: number; steep?: number } = {}): Network {
  const F = lang === 'fr', snap = o.snap ?? 2, steep = o.steep ?? 15
  const gens = splines.filter((s) => isRoadGen(s.cls) && s.pts.length >= 2), rs = gens.filter((s) => !isDecorRoad(s.prefab)), decor = gens.length - rs.length
  const E: [number, number][] = rs.flatMap((s) => [[s.pts[0][0], s.pts[0][2]], [s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][2]]] as [number, number][])
  const { nodes, of } = clusterEnds(E, snap)
  const edges: NEdge[] = rs.map((s, k) => { const pts = s.pts.map((p) => [p[0], p[2]] as [number, number]); const w = Number(s.props.RoadWidth ?? s.props.Width); return { id: k, a: of[2 * k], b: of[2 * k + 1], pts, len: polyLen(pts), cls: base(s.prefab) || s.cls, file: s.file, line: s.a, comp: -1, info: { type: roadTypeOf(s.prefab), ...(Number.isFinite(w) ? { width: w } : {}) } } })
  const comps = components(nodes, edges, F ? 'Réseau' : 'Network')
  const issues: Issue[] = []
  // T junctions: an end on a segment of another road counts as connected
  const C = 30, gV = new Grid<[number, number]>(C)
  edges.forEach((e) => { for (let i = 1; i < e.pts.length; i++) { const [ax, az] = e.pts[i - 1], [bx, bz] = e.pts[i], n = Math.max(1, Math.ceil(dist(ax, az, bx, bz) / C)); for (let k = 0; k <= n; k++) gV.add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, [e.id, i]) } })
  const tee = new Set<number>(), dsu = new DSU(nodes.length), edgeOf = new Map<number, number>()
  edges.forEach((e) => { edgeOf.set(e.a, e.id); edgeOf.set(e.b, e.id); dsu.union(e.a, e.b) })
  for (const n of nodes) if (n.deg === 1) {
    const mine = edgeOf.get(n.id)!
    const hit = gV.near(n.x, n.z, C).find(([j, i]) => j !== mine && segD(n.x, n.z, edges[j].pts[i - 1], edges[j].pts[i]) <= snap)
    if (hit) { tee.add(n.id); dsu.union(n.id, edges[hit[0]].a); issues.push({ kind: 'junction', x: n.x, z: n.z, msg: (F ? 'Raccord en T sur ' : 'T junction on ') + edges[hit[0]].cls }) }
  }
  for (const n of nodes) {
    if (n.deg >= 3) issues.push({ kind: 'junction', x: n.x, z: n.z, msg: (F ? 'Carrefour (' : 'Junction (') + kindOf(n.deg) + ')' })
    else if (n.deg === 1 && !tee.has(n.id)) {
      const mine = edgeOf.get(n.id)!
      let d = Infinity
      for (const [j, i] of gV.near(n.x, n.z, C)) if (j !== mine) d = Math.min(d, segD(n.x, n.z, edges[j].pts[i - 1], edges[j].pts[i]))
      issues.push({ kind: 'deadEnd', x: n.x, z: n.z, edge: mine, ...(d < C ? { d } : {}), msg: d < C ? (F ? `Raccord manqué : à ${d.toFixed(1)} m d'une autre route` : `Near miss: ${d.toFixed(1)} m from another road`) : (F ? 'Cul-de-sac / route non raccordée' : 'Dead end / unconnected road') })
    }
  }
  const im = new Map<number, { x: number; z: number; len: number; n: number }>()
  for (const e of edges) { const r = dsu.find(e.a), v = im.get(r) ?? { x: e.pts[0][0], z: e.pts[0][1], len: 0, n: 0 }; v.len += e.len; v.n++; im.set(r, v) }
  const isl = [...im.values()].sort((a, b) => b.len - a.len)
  isl.slice(1).forEach((i, k) => issues.push({ kind: 'island', x: i.x, z: i.z, msg: (F ? `Îlot déconnecté ${k + 2} : ` : `Disconnected island ${k + 2}: `) + (i.len / 1000).toFixed(2) + ' km, ' + i.n + (F ? ' routes' : ' roads') }))
  let steepN = 0
  if (height) for (const e of edges) {
    let worst = 0, wx = 0, wz = 0
    for (let i = 1; i < e.pts.length; i++) {
      const [ax, az] = e.pts[i - 1], [bx, bz] = e.pts[i], L = dist(ax, az, bx, bz), n = Math.max(1, Math.ceil(L / 10))
      let h0 = height(ax, az)
      for (let k = 1; k <= n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, h = height(x, z), g = 100 * Math.abs(h - h0) / (L / n); if (g > worst && L / n > 2) { worst = g; wx = x; wz = z } h0 = h }
    }
    if (e.info) e.info.maxGrade = +worst.toFixed(1)
    if (worst > steep) { steepN++; issues.push({ kind: 'steep', x: wx, z: wz, edge: e.id, d: worst, msg: (F ? `Pente ${worst.toFixed(0)} % sur ` : `Grade ${worst.toFixed(0)} % on `) + e.cls }) }
  }
  const byC = new Map<string, { n: number; km: number }>()
  for (const e of edges) { const c = byC.get(e.cls) ?? { n: 0, km: 0 }; c.n++; c.km += e.len / 1000; byC.set(e.cls, c) }
  const cnt = (k: string) => issues.filter((i) => i.kind === k).length
  const km = (edges.reduce((s, e) => s + e.len, 0) / 1000).toFixed(2) + ' km'
  return {
    kind: 'road', nodes, edges, comps, issues,
    byClass: [...byC].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.km - a.km),
    stats: F
      ? [['Routes (générateurs)', edges.length], ['Longueur', km], ['Carrefours / raccords', cnt('junction')], ['Culs-de-sac', cnt('deadEnd')], ['Îlots déconnectés', isl.length], [`Tronçons > ${steep} %`, height ? steepN : '—'], ['Générateurs décor ignorés (marquages, massifs…)', decor]]
      : [['Roads (generators)', edges.length], ['Length', km], ['Junctions / T', cnt('junction')], ['Dead ends', cnt('deadEnd')], ['Disconnected islands', isl.length], [`Segments > ${steep} %`, height ? steepN : '—'], ['Decor generators ignored (markings, beds…)', decor]],
  }
}

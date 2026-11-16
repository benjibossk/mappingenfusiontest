// Power network viewer: SCR_PowerlineGeneratorEntity splines → lines; generated poles (children of a
// generator) vs hand-placed poles; ends snapped to ends or vertices of other lines; isolated manual poles.
import type { Inst, Spline } from './extract.ts'
import { DSU, Grid, clusterEnds, components, dist, polyLen, type Issue, type NEdge, type Network } from './graph.ts'

const base = (p: string) => (p.split('/').pop() ?? p).replace(/\.et$/i, '')
export const isPowerGen = (cls: string) => /PowerlineGenerator/i.test(cls)
export const isPole = (prefab: string) => /power/i.test(prefab) && /pole|^powerline_/i.test(base(prefab)) && !/wire|cable|ladder|lightningrod|_base$/i.test(base(prefab))
export const isSubstation = (prefab: string) => /transformer|substation/i.test(base(prefab))

function segDist(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz
  const t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L)) : 0
  return dist(px, pz, a[0] + t * dx, a[1] + t * dz)
}

export function powerNetwork(splines: Spline[], insts: Inst[], lang: 'fr' | 'en' = 'fr', snap = 5): Network {
  const F = lang === 'fr', lines = splines.filter((s) => isPowerGen(s.cls) && s.pts.length >= 2)
  const E: [number, number][] = lines.flatMap((s) => [[s.pts[0][0], s.pts[0][2]], [s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][2]]] as [number, number][])
  const { nodes, of } = clusterEnds(E, snap)
  const edges: NEdge[] = lines.map((s, k) => { const pts = s.pts.map((p) => [p[0], p[2]] as [number, number]); return { id: k, a: of[2 * k], b: of[2 * k + 1], pts, len: polyLen(pts), cls: base(s.prefab) || s.cls, file: s.file, line: s.a, comp: -1, info: { points: s.pts.length, ...(s.props.Distance ? { distance: s.props.Distance } : {}) } } })
  // an end landing on the middle of another line is a junction (T): join the two components
  const gV = new Grid<[number, number]>(20)
  edges.forEach((e) => { for (let i = 1; i < e.pts.length; i++) { const [ax, az] = e.pts[i - 1], [bx, bz] = e.pts[i], n = Math.max(1, Math.ceil(dist(ax, az, bx, bz) / 20)); for (let k = 0; k <= n; k++) gV.add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, [e.id, i]) } })
  const tee = new DSU(edges.length), issues: Issue[] = []
  edges.forEach((e) => {
    for (const [px, pz] of [e.pts[0], e.pts[e.pts.length - 1]]) for (const [j, i] of gV.near(px, pz, 20)) {
      if (j === e.id) continue
      const o = edges[j]; if (segDist(px, pz, o.pts[i - 1], o.pts[i]) <= snap) { tee.union(e.id, j); issues.push({ kind: 'junction', x: px, z: pz, edge: e.id, msg: (F ? 'Raccord en T sur ' : 'T junction on ') + o.cls }); break }
    }
  })
  const comps = components(nodes, edges, F ? 'Réseau' : 'Network')
  // merge components joined by a T (relabel, keep the largest name)
  const root = new Map<number, number>()
  for (const e of edges) { const r = tee.find(e.id), c = root.get(r); if (c === undefined || comps[e.comp].len > comps[c].len) root.set(r, e.comp) }
  for (const e of edges) e.comp = root.get(tee.find(e.id))!
  const keep = new Set(edges.map((e) => e.comp)), merged = comps.filter((c) => keep.has(c.id))
  for (const c of merged) { c.len = 0; c.edges = 0 }
  for (const e of edges) { merged.find((c) => c.id === e.comp)!.len += e.len; merged.find((c) => c.id === e.comp)!.edges++ }
  merged.sort((a, b) => b.len - a.len)
  const ix = new Map(merged.map((c, i) => [c.id, i]))
  merged.forEach((c, i) => { c.id = i; c.name = `${F ? 'Réseau' : 'Network'} ${i + 1}` })
  for (const e of edges) e.comp = ix.get(e.comp)!
  const poles = insts.filter((i) => isPole(i.prefab) && !isPowerGen(i.cls)), gen = poles.filter((p) => p.gen && isPowerGen(p.gen)), manual = poles.filter((p) => !(p.gen && isPowerGen(p.gen)))
  let isolated = 0
  for (const p of manual) {
    const near = gV.near(p.x, p.z, 20).some(([j, i]) => segDist(p.x, p.z, edges[j].pts[i - 1], edges[j].pts[i]) < 10)
    if (!near) { isolated++; issues.push({ kind: 'isolated', x: p.x, z: p.z, msg: (F ? 'Poteau isolé (hors ligne) : ' : 'Isolated pole (no line): ') + base(p.prefab) }) }
  }
  for (const n of nodes) if (n.deg === 1 && !issues.some((i) => i.kind === 'junction' && dist(i.x, i.z, n.x, n.z) < snap)) issues.push({ kind: 'end', x: n.x, z: n.z, msg: F ? 'Extrémité de ligne' : 'Line end' })
  const subs = insts.filter((i) => isSubstation(i.prefab))
  for (const s of subs) issues.push({ kind: 'station', x: s.x, z: s.z, msg: base(s.prefab) })
  for (const e of edges) if (e.len < 15) issues.push({ kind: 'isolated', x: e.pts[0][0], z: e.pts[0][1], edge: e.id, msg: (F ? 'Ligne très courte : ' : 'Very short line: ') + e.len.toFixed(1) + ' m' })
  const byC = new Map<string, { n: number; km: number }>()
  for (const e of edges) { const c = byC.get(e.cls) ?? { n: 0, km: 0 }; c.n++; c.km += e.len / 1000; byC.set(e.cls, c) }
  const km = (edges.reduce((s, e) => s + e.len, 0) / 1000).toFixed(2) + ' km'
  return {
    kind: 'power', nodes, edges, comps: merged, issues,
    byClass: [...byC].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.km - a.km),
    stats: F
      ? [['Lignes (générateurs)', edges.length], ['Longueur', km], ['Réseaux connexes', merged.length], ['Poteaux générés', gen.length], ['Poteaux posés à la main', manual.length], ['Poteaux isolés', isolated], ['Transformateurs / postes', subs.length]]
      : [['Lines (generators)', edges.length], ['Length', km], ['Connected networks', merged.length], ['Generated poles', gen.length], ['Hand-placed poles', manual.length], ['Isolated poles', isolated], ['Transformers / substations', subs.length]],
  }
}

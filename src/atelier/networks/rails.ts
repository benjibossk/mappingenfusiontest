// Rail network detector: hand-placed track pieces (no rail-laying generator exists in the base game:
// SCR_TrackGeneratorEntity only reserves a clearance corridor for the other generators, it places nothing),
// chained into a graph by snapping the piece ends. Piece geometry comes from the prefab name (19m, 09m, 4m…)
// and the yaw; the long axis (local Z or X) and the pivot (centre or start) are auto-detected per prefab as
// the hypothesis that joins the most ends. Curves are approximated by their chord.
import type { Inst } from './extract.ts'
import { DSU, Grid, clusterEnds, components, dist, type Issue, type NEdge, type Network } from './graph.ts'

export const RAIL_GENERATOR_AVAILABLE = false
const base = (p: string) => (p.split('/').pop() ?? p).replace(/\.et$/i, '')

export function isRailPiece(prefab: string): boolean {
  const b = base(prefab)
  if (/_base$/i.test(b) || /(platform|station|tower|sign|powerline|bridge|cover|railing|pierrail|slipway|carrier)/i.test(b)) return false
  return /^(rail(?!ing)|railwaytrack|harborrail|sawmillrail|track_?\d|railroad)/i.test(b)
}
export type RailFeature = 'station' | 'crossing' | 'stop'
export function railFeature(prefab: string): RailFeature | null {
  const p = prefab.toLowerCase(), b = base(p)
  const railish = /\/rails?\/|\/railways?\/|railway|\/platforms\//.test(p)
  if (!railish) return null
  if (/station|platform/.test(b)) return 'station'
  if (/stop|buffer/.test(b)) return 'stop'
  if (/cross/.test(b)) return 'crossing'
  return null
}
/** nominal length from the name (RailDRoit19m01 → 19, HarborRail_01_4m → 4); null when the name has none */
export function pieceLength(prefab: string): number | null {
  const m = /(\d+(?:\.\d+)?)m(?![a-z]{2})/i.exec(base(prefab).replace(/^[a-z]+_?\d{2}_/i, (s) => s.replace(/\d/g, 'x')))
  const v = m ? Number(m[1]) : NaN
  return v > 0.5 && v < 200 ? v : null
}

type Hyp = 'zc' | 'xc' | 'zs' | 'xs'
const HYPS: Hyp[] = ['zc', 'xc', 'zs', 'xs']
export interface Piece { i: number; inst: Inst; L: number; est: boolean; hyp: Hyp }
export function ends(p: { inst: Inst; L: number; hyp: Hyp }): [[number, number], [number, number]] {
  const r = p.inst.yaw * Math.PI / 180, s = Math.sin(r), c = Math.cos(r)
  const [dx, dz] = p.hyp[0] === 'z' ? [s, c] : [c, -s]
  const { x, z } = p.inst
  return p.hyp[1] === 'c' ? [[x - dx * p.L / 2, z - dz * p.L / 2], [x + dx * p.L / 2, z + dz * p.L / 2]] : [[x, z], [x + dx * p.L, z + dz * p.L]]
}

export interface RailOpts { snap?: number; gapMax?: number }
export interface RailResult { net: Network; pieces: Piece[]; duplicates: Inst[]; features: { f: RailFeature; inst: Inst }[]; hyps: Record<string, Hyp>; estimated: string[] }

export function railNetwork(all: Inst[], lang: 'fr' | 'en' = 'fr', o: RailOpts = {}): RailResult {
  const snap = o.snap ?? 1.5, gapMax = o.gapMax ?? 8, F = lang === 'fr'
  const raw = all.filter((x) => isRailPiece(x.prefab))
  const features = all.map((inst) => ({ f: railFeature(inst.prefab), inst })).filter((x): x is { f: RailFeature; inst: Inst } => !!x.f && !isRailPiece(x.inst.prefab))
  // exact duplicates (same prefab, same place, same yaw): removable, kept out of the graph
  const g0 = new Grid<number>(2), dup = new Set<number>(), duplicates: Inst[] = []
  raw.forEach((p, i) => {
    for (const j of g0.near(p.x, p.z, 0.1)) {
      const q = raw[j], dy = Math.abs((((p.yaw - q.yaw) % 360) + 540) % 360 - 180)
      if (q.prefab === p.prefab && dist(p.x, p.z, q.x, q.z) < 0.1 && Math.abs(p.y - q.y) < 0.1 && dy < 1) { dup.add(i); duplicates.push(p); return }
    }
    g0.add(p.x, p.z, i)
  })
  const ins = raw.filter((_, i) => !dup.has(i))
  // lengths: from the name, else estimated from the spacing to the nearest neighbour
  const gC = new Grid<number>(10); ins.forEach((p, i) => gC.add(p.x, p.z, i))
  const named = ins.map((p) => pieceLength(p.prefab)), estimated: string[] = [], estL = new Map<string, number>()
  for (const pf of new Set(ins.filter((_, i) => named[i] === null).map((p) => p.prefab))) {
    const ds: number[] = []
    ins.forEach((p, i) => {
      if (p.prefab !== pf) return
      let best = Infinity, bl = 0
      for (const j of gC.near(p.x, p.z, 40)) { if (j === i) continue; const d = dist(p.x, p.z, ins[j].x, ins[j].z); if (d > 0.3 && d < best) { best = d; bl = named[j] ?? d } }
      if (best < Infinity) ds.push(2 * best - bl)
    })
    ds.sort((a, b) => a - b)
    estL.set(pf, Math.min(50, Math.max(2, ds.length ? ds[ds.length >> 1] : 10))); estimated.push(base(pf))
  }
  // calibration on the data: real spacing of aligned pieces of the same prefab gives the long axis and the
  // true length (RailDRoit19m01 = 18.9 m along Z, HarborRail_01_8m = 8 m along X on Zimnitrita)
  const cal = new Map<string, { axis: 'z' | 'x'; L: number }>()
  for (const pf of new Set(ins.map((p) => p.prefab))) {
    const P = ins.filter((p) => p.prefab === pf); if (P.length < 3) continue
    const g = new Grid<Inst>(25); P.forEach((p) => g.add(p.x, p.z, p))
    const res = (['z', 'x'] as const).map((ax) => {
      const ds: number[] = []
      for (const p of P) {
        const r = p.yaw * Math.PI / 180, [dx, dz] = ax === 'z' ? [Math.sin(r), Math.cos(r)] : [Math.cos(r), -Math.sin(r)]
        let best = Infinity
        for (const q of g.near(p.x, p.z, 50)) { if (q === p) continue; const vx = q.x - p.x, vz = q.z - p.z, al = vx * dx + vz * dz; if (al > 0.5 && Math.abs(vx * dz - vz * dx) < 0.3 && al < best) best = al }
        if (best < 50) ds.push(best)
      }
      ds.sort((a, b) => a - b)
      return { ax, n: ds.length, L: ds.length ? ds[ds.length >> 1] : 0 }
    })
    const b = res[0].n >= res[1].n ? res[0] : res[1], nom = pieceLength(pf)
    if (b.n >= 3 && (!nom || (b.L > nom * 0.7 && b.L < nom * 1.3))) cal.set(pf, { axis: b.ax, L: b.L })
  }
  const pieces: Piece[] = ins.map((inst, i) => { const c = cal.get(inst.prefab); return { i, inst, L: c?.L ?? named[i] ?? estL.get(inst.prefab)!, est: !c && named[i] === null, hyp: (c?.axis === 'x' ? 'xc' : 'zc') as Hyp } })
  // pivot (and axis when not calibrated) per prefab: the hypothesis that joins the most ends (2 passes)
  const hyps: Record<string, Hyp> = {}
  const prefabs = [...new Set(pieces.map((p) => p.inst.prefab))]
  for (let pass = 0; pass < 2; pass++) {
    const gE = new Grid<[number, number, number]>(4)
    for (const p of pieces) for (const e of ends(p)) gE.add(e[0], e[1], [e[0], e[1], p.i])
    for (const pf of prefabs) {
      const mine = pieces.filter((p) => p.inst.prefab === pf)
      let best: Hyp = mine[0].hyp, bs = -1
      const ca = cal.get(pf)?.axis
      for (const h of HYPS.filter((x) => !ca || x[0] === ca)) {
        let s = 0
        for (const p of mine) for (const e of ends({ ...p, hyp: h })) if (gE.near(e[0], e[1], snap).some(([x, z, k]) => k !== p.i && dist(x, z, e[0], e[1]) <= snap)) s++
        if (s > bs + (h[1] === 'c' ? 0 : 0.5)) { bs = s; best = h }
      }
      for (const p of mine) p.hyp = best
      hyps[base(pf)] = best
    }
  }
  // graph
  const E = pieces.flatMap((p) => ends(p))
  const { nodes, of } = clusterEnds(E, snap)
  const edges: NEdge[] = pieces.map((p, k) => ({ id: k, a: of[2 * k], b: of[2 * k + 1], pts: [E[2 * k], E[2 * k + 1]], len: p.L, cls: base(p.inst.prefab), file: p.inst.file, line: p.inst.a, comp: -1, info: { yaw: +p.inst.yaw.toFixed(2), ...(p.est ? { estimated: 1 } : {}) } }))
  const comps = components(nodes, edges, F ? 'Ligne' : 'Line')
  const issues: Issue[] = []
  // gaps: two dead ends close to each other but not joined
  const deadNodes = nodes.filter((n) => n.deg === 1), gD = new Grid<number>(gapMax), used = new Set<number>()
  deadNodes.forEach((n) => gD.add(n.x, n.z, n.id))
  const edgeAt = new Map<number, number>(); edges.forEach((e) => { edgeAt.set(e.a, e.id); edgeAt.set(e.b, e.id) })
  for (const n of deadNodes) {
    if (used.has(n.id)) continue
    let best = -1, bd = Infinity
    for (const m of gD.near(n.x, n.z, gapMax)) { if (m === n.id || used.has(m) || edgeAt.get(m) === edgeAt.get(n.id)) continue; const d = dist(n.x, n.z, nodes[m].x, nodes[m].z); if (d < bd) { bd = d; best = m } }
    if (best >= 0 && bd <= gapMax) { used.add(n.id); used.add(best); issues.push({ kind: 'gap', x: (n.x + nodes[best].x) / 2, z: (n.z + nodes[best].z) / 2, d: bd, edge: edgeAt.get(n.id), msg: F ? `Joint ouvert de ${bd.toFixed(2)} m` : `Open joint, ${bd.toFixed(2)} m` }) }
  }
  // overlaps: near-parallel pieces lying on each other (not exact duplicates)
  const gP = new Grid<number>(20); pieces.forEach((p) => gP.add(p.inst.x, p.inst.z, p.i))
  for (const p of pieces) for (const j of gP.near(p.inst.x, p.inst.z, 25)) {
    if (j <= p.i) continue
    const q = pieces[j], dy = Math.abs((((p.inst.yaw - q.inst.yaw) % 180) + 270) % 180 - 90)
    if (dy > 2) continue
    if (p.hyp[0] !== q.hyp[0]) continue
    const [e0, e1] = ends(p), ax = (e1[0] - e0[0]) / p.L, az = (e1[1] - e0[1]) / p.L, vx = q.inst.x - p.inst.x, vz = q.inst.z - p.inst.z
    const along = Math.abs(vx * ax + vz * az), lat = Math.abs(vx * az - vz * ax)
    const over = (p.L + q.L) / 2 - along
    if (lat < 0.6 && over > 1) issues.push({ kind: 'overlap', x: (p.inst.x + q.inst.x) / 2, z: (p.inst.z + q.inst.z) / 2, d: over, edge: p.i, msg: F ? `Chevauchement de ${over.toFixed(1)} m (${base(p.inst.prefab)} / ${base(q.inst.prefab)})` : `Overlap ${over.toFixed(1)} m (${base(p.inst.prefab)} / ${base(q.inst.prefab)})` })
  }
  for (const d of duplicates) issues.push({ kind: 'duplicate', x: d.x, z: d.z, msg: (F ? 'Pièce en double : ' : 'Duplicate piece: ') + base(d.prefab) })
  const stops = features.filter((f) => f.f === 'stop')
  for (const n of deadNodes) if (!used.has(n.id)) {
    const s = stops.some((f) => dist(f.inst.x, f.inst.z, n.x, n.z) < 12)
    issues.push({ kind: 'end', x: n.x, z: n.z, edge: edgeAt.get(n.id), msg: s ? (F ? 'Terminus (heurtoir)' : 'Terminus (buffer stop)') : (F ? 'Extrémité libre' : 'Open end') })
  }
  for (const n of nodes) if (n.deg >= 3) issues.push({ kind: 'switch', x: n.x, z: n.z, msg: (F ? 'Aiguillage / jonction, degré ' : 'Switch / junction, degree ') + n.deg })
  // stations: platform / building pieces grouped into sites (150 m)
  const st = features.filter((f) => f.f === 'station'), dS = new DSU(st.length), gS = new Grid<number>(150)
  st.forEach((f, i) => { for (const j of gS.near(f.inst.x, f.inst.z, 150)) if (dist(f.inst.x, f.inst.z, st[j].inst.x, st[j].inst.z) < 150) dS.union(i, j); gS.add(f.inst.x, f.inst.z, i) })
  const sites = new Map<number, { x: number; z: number; n: number }>()
  st.forEach((f, i) => { const r = dS.find(i), s = sites.get(r) ?? { x: 0, z: 0, n: 0 }; s.x += f.inst.x; s.z += f.inst.z; s.n++; sites.set(r, s) })
  for (const s of sites.values()) issues.push({ kind: 'station', x: s.x / s.n, z: s.z / s.n, msg: (F ? `Gare / quai (${s.n} éléments)` : `Station / platform (${s.n} pieces)`) })
  const byC = new Map<string, { n: number; km: number }>()
  for (const e of edges) { const c = byC.get(e.cls) ?? { n: 0, km: 0 }; c.n++; c.km += e.len / 1000; byC.set(e.cls, c) }
  const total = edges.reduce((s, e) => s + e.len, 0), cnt = (k: string) => issues.filter((i) => i.kind === k).length
  const net: Network = {
    kind: 'rail', nodes, edges, comps, issues,
    byClass: [...byC].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.km - a.km),
    stats: F
      ? [['Pièces de voie', edges.length], ['Longueur', (total / 1000).toFixed(2) + ' km'], ['Lignes (réseaux)', comps.length], ['Extrémités', cnt('end')], ['Aiguillages', cnt('switch')], ['Joints ouverts', cnt('gap')], ['Chevauchements', cnt('overlap')], ['Doublons', duplicates.length], ['Gares / quais (sites)', sites.size], ['Passages à niveau', features.filter((f) => f.f === 'crossing').length]]
      : [['Track pieces', edges.length], ['Length', (total / 1000).toFixed(2) + ' km'], ['Lines (networks)', comps.length], ['Ends', cnt('end')], ['Switches', cnt('switch')], ['Open joints', cnt('gap')], ['Overlaps', cnt('overlap')], ['Duplicates', duplicates.length], ['Stations / platforms (sites)', sites.size], ['Level crossings', features.filter((f) => f.f === 'crossing').length]],
  }
  return { net, pieces, duplicates, features, hyps, estimated }
}

/** ordered polylines (chains between ends / switches) of a rail network, e.g. to draw a spline by hand */
export function chains(net: Network): [number, number][][] {
  const adj = new Map<number, number[]>()
  for (const e of net.edges) { (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.id); (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.id) }
  const seen = new Uint8Array(net.edges.length), out: [number, number][][] = []
  const walk = (start: number, eid: number) => {
    const line: [number, number][] = [[net.nodes[start].x, net.nodes[start].z]]
    let n = start, e = eid
    for (;;) {
      seen[e] = 1; const E = net.edges[e], m = E.a === n ? E.b : E.a
      line.push([net.nodes[m].x, net.nodes[m].z]); n = m
      const nx = (adj.get(n) ?? []).filter((k) => !seen[k])
      if (net.nodes[n].deg !== 2 || !nx.length) break
      e = nx[0]
    }
    out.push(line)
  }
  for (const n of net.nodes) if (n.deg !== 2) for (const e of adj.get(n.id) ?? []) if (!seen[e]) walk(n.id, e)
  for (const e of net.edges) if (!seen[e.id]) walk(e.a, e.id) // pure loops
  return out
}

/** duplicate blocks that can be removed safely: a $grp keeps at least one child */
export function removableDuplicates(dups: Inst[], grpCount: Map<string, number>): Inst[] {
  const left = new Map(grpCount), out: Inst[] = []
  for (const d of dups) {
    if (d.grpA < 0) { out.push(d); continue }
    const k = d.file + ':' + d.grpA, n = left.get(k) ?? 0
    if (n > 1) { left.set(k, n - 1); out.push(d) }
  }
  return out
}
export { DSU }

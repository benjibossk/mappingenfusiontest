// Common network model of the Atelier viewers (rails, roads, power): nodes, edges (polylines), components,
// issues, plus CSV / JSON / share-text exports. Pure functions, no DOM.

export type NetKind = 'rail' | 'road' | 'power'
export interface NNode { id: number; x: number; z: number; deg: number }
export interface NEdge {
  id: number; a: number; b: number; pts: [number, number][]; len: number; cls: string
  file: string; line: number; comp: number; info?: Record<string, string | number>
}
export type IssueKind = 'gap' | 'overlap' | 'duplicate' | 'end' | 'switch' | 'deadEnd' | 'junction' | 'steep' | 'island' | 'isolated' | 'station'
export interface Issue { kind: IssueKind; x: number; z: number; msg: string; edge?: number; d?: number }
export interface Comp { id: number; name: string; len: number; edges: number; ends: number; branches: number; x: number; z: number }
export interface Network {
  kind: NetKind; nodes: NNode[]; edges: NEdge[]; comps: Comp[]; issues: Issue[]
  stats: [string, string | number][]; byClass: { cls: string; n: number; km: number }[]
}

export const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)
export const polyLen = (p: [number, number][]) => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]); return s }

/** spatial hash for "points within r" queries */
export class Grid<T> {
  private m = new Map<string, T[]>()
  private cell: number
  constructor(cell: number) { this.cell = cell }
  private k(x: number, z: number) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell) }
  add(x: number, z: number, v: T) { const k = this.k(x, z); const a = this.m.get(k); if (a) a.push(v); else this.m.set(k, [v]) }
  near(x: number, z: number, r: number): T[] {
    const out: T[] = [], c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c)
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const a = this.m.get(i + ',' + j); if (a) for (const v of a) out.push(v) }
    return out
  }
}

/** union-find */
export class DSU {
  p: Int32Array
  constructor(n: number) { this.p = new Int32Array(n).map((_, i) => i) }
  find(i: number): number { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i] } return i }
  union(a: number, b: number) { const x = this.find(a), y = this.find(b); if (x !== y) this.p[x] = y }
}

/** cluster end points closer than tol into nodes; returns node index for each input point */
export function clusterEnds(P: [number, number][], tol: number): { nodes: NNode[]; of: Int32Array } {
  const g = new Grid<number>(Math.max(tol, 1) * 2), d = new DSU(P.length)
  P.forEach(([x, z], i) => { for (const j of g.near(x, z, tol)) if (dist(x, z, P[j][0], P[j][1]) <= tol) d.union(i, j); g.add(x, z, i) })
  const map = new Map<number, number>(), nodes: NNode[] = [], of = new Int32Array(P.length), sum: [number, number, number][] = []
  P.forEach((_, i) => { const r = d.find(i); let n = map.get(r); if (n === undefined) { n = nodes.length; map.set(r, n); nodes.push({ id: n, x: 0, z: 0, deg: 0 }); sum.push([0, 0, 0]) } of[i] = n; sum[n][0] += P[i][0]; sum[n][1] += P[i][1]; sum[n][2]++ })
  nodes.forEach((n, i) => { n.x = sum[i][0] / sum[i][2]; n.z = sum[i][1] / sum[i][2] })
  return { nodes, of }
}

/** degrees + connected components (sorted by length, named "<prefix> 1..n") */
export function components(nodes: NNode[], edges: NEdge[], prefix: string): Comp[] {
  for (const n of nodes) n.deg = 0
  const d = new DSU(nodes.length)
  for (const e of edges) { nodes[e.a].deg++; nodes[e.b].deg++; d.union(e.a, e.b) }
  const acc = new Map<number, Comp>()
  for (const e of edges) {
    const r = d.find(e.a); let c = acc.get(r)
    if (!c) { c = { id: 0, name: '', len: 0, edges: 0, ends: 0, branches: 0, x: e.pts[0][0], z: e.pts[0][1] }; acc.set(r, c) }
    c.len += e.len; c.edges++
  }
  for (const n of nodes) { const c = acc.get(d.find(n.id)); if (!c) continue; if (n.deg === 1) c.ends++; else if (n.deg >= 3) c.branches++ }
  const list = [...acc.entries()].sort((a, b) => b[1].len - a[1].len)
  const idOf = new Map<number, number>()
  list.forEach(([r, c], i) => { c.id = i; c.name = `${prefix} ${i + 1}`; idOf.set(r, i) })
  for (const e of edges) e.comp = idOf.get(d.find(e.a)) ?? -1
  return list.map(([, c]) => c)
}

const q = (s: string | number) => { const v = String(s); return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }
export function toCsv(n: Network): string {
  const keys = [...new Set(n.edges.flatMap((e) => Object.keys(e.info ?? {})))]
  const head = ['id', 'network', 'class', 'length_m', 'x0', 'z0', 'x1', 'z1', 'file', 'line', ...keys]
  const rows = n.edges.map((e) => { const a = e.pts[0], b = e.pts[e.pts.length - 1]; return [e.id, n.comps[e.comp]?.name ?? '', e.cls, e.len.toFixed(1), a[0].toFixed(1), a[1].toFixed(1), b[0].toFixed(1), b[1].toFixed(1), e.file, e.line + 1, ...keys.map((k) => e.info?.[k] ?? '')] })
  const iss = n.issues.map((i) => ['issue', i.kind, i.msg, i.d?.toFixed(1) ?? '', i.x.toFixed(1), i.z.toFixed(1)])
  return [head, ...rows].map((r) => r.map(q).join(';')).join('\n') + '\n\n' + [['type', 'kind', 'message', 'value', 'x', 'z'], ...iss].map((r) => r.map(q).join(';')).join('\n') + '\n'
}
export function toJson(n: Network): string {
  return JSON.stringify({ kind: n.kind, stats: Object.fromEntries(n.stats), byClass: n.byClass, networks: n.comps,
    nodes: n.nodes.map((x) => ({ id: x.id, x: +x.x.toFixed(2), z: +x.z.toFixed(2), deg: x.deg })),
    edges: n.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, cls: e.cls, len: +e.len.toFixed(1), network: e.comp, file: e.file, line: e.line + 1, pts: e.pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]), ...(e.info ? { info: e.info } : {}) })),
    issues: n.issues }, null, 1)
}
/** short text for a game-design discussion (Discord / call notes) */
export function shareText(n: Network, title: string, lang: 'fr' | 'en'): string {
  const L = lang === 'fr'
  const lines = [`## ${title}`, ...n.stats.map(([k, v]) => `- ${k} : ${v}`)]
  if (n.byClass.length) lines.push(L ? '- Par classe :' : '- By class:', ...n.byClass.slice(0, 12).map((c) => `  - ${c.cls} : ${c.km.toFixed(2)} km (${c.n})`))
  if (n.comps.length) lines.push(L ? '- Plus grands réseaux :' : '- Largest networks:', ...n.comps.slice(0, 5).map((c) => `  - ${c.name} : ${(c.len / 1000).toFixed(2)} km, ${c.ends} ${L ? 'extrémités' : 'ends'}, ${c.branches} ${L ? 'embranchements' : 'branches'} (≈ ${Math.round(c.x)}, ${Math.round(c.z)})`))
  const byK = new Map<string, number>(); for (const i of n.issues) byK.set(i.kind, (byK.get(i.kind) ?? 0) + 1)
  if (byK.size) lines.push((L ? '- Points à discuter : ' : '- Points to discuss: ') + [...byK].map(([k, v]) => `${v} ${k}`).join(', '))
  return lines.join('\n')
}

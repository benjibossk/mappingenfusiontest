// Field tracks that follow the plot edges (the hedge lines) instead of cutting straight across:
// the plot borders form a graph (vertices merged on a small snap grid), a multi-source Dijkstra from the
// vertices close to a road gives every plot its cheapest way out along the borders, then a Chaikin pass
// rounds the corners into gentle bends. Each track ends on the road centre line (connected network);
// plots already touching a road or a track get none. Used by zonefill.ts fillFieldZone.

const SNAP = 3 // m: plot corners closer than this are one graph vertex (clipped plots rarely share exact points)

function nearestOnLines(x: number, z: number, lines: number[][]) {
  let d = Infinity, px = 0, pz = 0
  for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) {
    const ax = l[i], az = l[i + 1], dx = l[i + 2] - ax, dz = l[i + 3] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    const qx = ax + dx * t, qz = az + dz * t, e = Math.hypot(x - qx, z - qz)
    if (e < d) { d = e; px = qx; pz = qz }
  }
  return { d, x: px, z: pz }
}

function inRing(r: number[][], x: number, z: number): boolean {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

/** true when the segment runs through the inside of a plot (samples every ~4 m, ends excluded) */
function crosses(plots: number[][][], ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(3, Math.ceil(Math.hypot(bx - ax, bz - az) / 4))
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n
    if (plots.some((p) => inRing(p, x, z))) return true
  }
  return false
}

/** one Chaikin pass (ends kept): corners become two points at 1/4 and 3/4, a gentle bend */
export function chaikin(pts: number[][], passes = 1): number[][] {
  let p = pts
  for (let k = 0; k < passes && p.length > 2; k++) {
    const out = [p[0]]
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1]
      if (i > 0) out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25])
      if (i + 2 < p.length) out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75])
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

/** dirt tracks along the plot borders to the road network. `kept` = closed plot rings ([x, z][]),
 *  `roads` = flat X/Z centre lines. Returns flat X/Z polylines, the last point on a road. */
export function edgeTracks(kept: number[][][], roads: number[][], o: { maxLen?: number; touch?: number; reach?: number; ok?: (x: number, z: number) => boolean } = {}): number[][] {
  const maxLen = o.maxLen ?? 450, touch = o.touch ?? 10, reach = o.reach ?? 60
  if (!kept.length || !roads.length) return []
  // graph of the plot borders
  const key = (x: number, z: number) => `${Math.round(x / SNAP)},${Math.round(z / SNAP)}`
  const ids = new Map<string, number>(), vx: number[] = [], vz: number[] = [], adj: number[][] = []
  const vid = (x: number, z: number) => {
    const k = key(x, z)
    let i = ids.get(k)
    if (i === undefined) { i = vx.length; ids.set(k, i); vx.push(x); vz.push(z); adj.push([]) }
    return i
  }
  const plotV = kept.map((f) => {
    const vs: number[] = []
    for (let i = 0; i + 1 < f.length; i++) vs.push(vid(f[i][0], f[i][1]))
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length]
      if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a) }
    }
    return vs
  })
  // a vertex sitting on another plot's edge but not on its corners: join it to that edge's ends, so
  // T-junctions of the clipped Voronoi cells stay connected
  for (const [pi, f] of kept.entries()) for (let i = 0; i + 1 < f.length; i++) {
    const [ax, az] = f[i], [bx, bz] = f[i + 1], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz
    if (L < 1) continue
    const a = vid(ax, az), b = vid(bx, bz)
    for (const [pj, vs] of plotV.entries()) {
      if (pj === pi) continue
      for (const v of vs) {
        if (v === a || v === b) continue
        const t = ((vx[v] - ax) * dx + (vz[v] - az) * dz) / L
        if (t <= 0.02 || t >= 0.98) continue
        if (Math.hypot(ax + dx * t - vx[v], az + dz * t - vz[v]) > SNAP) continue
        for (const w of [a, b]) if (!adj[v].includes(w)) { adj[v].push(w); adj[w].push(v) }
      }
    }
  }
  const n = vx.length, ok = o.ok
  const road = vx.map((x, i) => nearestOnLines(x, vz[i], roads))
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = road[i]
    if (r.d > reach) continue
    if (r.d > touch && (crosses(kept, vx[i], vz[i], r.x, r.z) || (ok && !ok((vx[i] + r.x) / 2, (vz[i] + r.z) / 2)))) continue
    dist[i] = r.d * 1.5 // a fresh connector costs more than following a border
  }
  for (;;) { // plain O(n²) Dijkstra: a zone holds a few hundred vertices
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0) break
    done[u] = 1
    for (const v of adj[u]) {
      const c = dist[u] + Math.hypot(vx[u] - vx[v], vz[u] - vz[v])
      if (c < dist[v]) { dist[v] = c; prev[v] = u }
    }
  }
  const onTrack = new Uint8Array(n), out: number[][] = []
  const far = (i: number) => { const m = Math.min(...plotV[i].map((v) => dist[v])); return m < Infinity ? m : -1 }
  const order = kept.map((_, i) => i).sort((a, b) => far(b) - far(a)) // farthest first: one long track, the nearer plots sit on it
  for (const pi of order) {
    const vs = plotV[pi]
    if (vs.some((v) => road[v].d <= touch || onTrack[v])) continue
    let s = vs[0]
    for (const v of vs) if (dist[v] < dist[s]) s = v
    if (!(dist[s] <= maxLen)) continue
    const path: number[][] = []
    let u = s, joined = false
    for (;;) {
      path.push([vx[u], vz[u]])
      if (onTrack[u] && u !== s) { joined = true; break }
      onTrack[u] = 1
      if (prev[u] < 0) break
      u = prev[u]
    }
    if (!joined) { const r = road[u]; if (r.d > 0.5) path.push([r.x, r.z]) }
    if (path.length < 2) continue
    const smooth = path.length > 2 ? chaikin(path, 2) : path
    if (joined) { const r = nearestOnLines(path[path.length - 1][0], path[path.length - 1][1], out); if (r.d > 0.5 && r.d < 40) smooth.push([r.x, r.z]) } // end on the smoothed track
    out.push(smooth.flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]))
  }
  return out
}

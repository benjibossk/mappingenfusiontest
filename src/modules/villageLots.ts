// Village lots (ROADMAP_NEXT §3.2, CITIES.md §3.5): the buildable strip along each side of a street
// is cut into blocks (oriented boxes), then each block is split recursively across the frontage
// (OBB split) into lots. A lot keeps its street frame: u along the street, n away from it, the
// front edge on the street side. Pure functions.

export interface Lot {
  cx: number; cz: number // centre
  ux: number; uz: number // unit, along the street
  nx: number; nz: number // unit, away from the street
  w: number // frontage (along u)
  d: number // depth (along n)
  s: number // arc distance of the lot along its street (ordering)
}

//! world corners (front-left, front-right, back-right, back-left)
export function lotCorners(l: Lot): number[] {
  const out: number[] = []
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) out.push(l.cx + l.ux * a * l.w + l.nx * b * l.d, l.cz + l.uz * a * l.w + l.nz * b * l.d)
  return out
}
//! point of the lot frame (a along u from the centre line, b from the front edge) in world
export const lotPoint = (l: Lot, a: number, b: number): [number, number] => [l.cx + l.ux * a + l.nx * (b - l.d / 2), l.cz + l.uz * a + l.nz * (b - l.d / 2)]

/** recursive OBB split across the frontage until every lot is in [minF, maxF] */
export function splitLot(l: Lot, rand: () => number, minF: number, maxF: number, out: Lot[] = []): Lot[] {
  if (l.w <= maxF || l.w < 2 * minF) { if (l.w >= minF * 0.8) out.push(l); return out }
  let r = 0.35 + rand() * 0.3
  r = Math.min(Math.max(r, minF / l.w), 1 - minF / l.w)
  const w1 = l.w * r, w2 = l.w - w1
  const a: Lot = { ...l, w: w1, cx: l.cx - l.ux * (l.w / 2 - w1 / 2), cz: l.cz - l.uz * (l.w / 2 - w1 / 2), s: l.s - l.w / 2 + w1 / 2 }
  const b: Lot = { ...l, w: w2, cx: l.cx + l.ux * (l.w / 2 - w2 / 2), cz: l.cz + l.uz * (l.w / 2 - w2 / 2), s: l.s + l.w / 2 - w2 / 2 }
  splitLot(a, rand, minF, maxF, out)
  splitLot(b, rand, minF, maxF, out)
  return out
}

/** blocks along one side of a street polyline: chords of `chunk` metres (straight enough to be a
 *  box), starting `front` metres from the centre line, `depth` deep. side = +1 left, -1 right. */
export function streetBlocks(pts: number[], side: number, front: number, depth: number, chunk: number): Lot[] {
  const out: Lot[] = []
  const n = pts.length / 2
  // arc lengths
  const acc = [0]
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]))
  const total = acc[n - 1]
  const P = (s: number): [number, number] => {
    let i = 1
    while (i < n - 1 && acc[i] < s) i++
    const seg = acc[i] - acc[i - 1] || 1, u = Math.min(Math.max((s - acc[i - 1]) / seg, 0), 1)
    return [pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * u, pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * u]
  }
  for (let s0 = 0; s0 + chunk * 0.5 <= total; s0 += chunk) {
    const s1 = Math.min(total, s0 + chunk)
    const a = P(s0), b = P(s1)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 6) continue
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L
    const nx = -uz * side, nz = ux * side
    // a curved chunk bulges: push the block out so the whole street stays in front of it
    let bulge = 0
    for (let s = s0; s <= s1; s += 4) {
      const p = P(s)
      bulge = Math.max(bulge, (p[0] - a[0]) * nx + (p[1] - a[1]) * nz)
    }
    const f = front + Math.max(0, bulge)
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
    out.push({ cx: mx + nx * (f + depth / 2), cz: mz + nz * (f + depth / 2), ux: ux * side, uz: uz * side, nx, nz, w: L, d: depth, s: (s0 + s1) / 2 })
  }
  return out
}

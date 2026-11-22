// Neighbouring garden parcels each fence their own outline, so a shared boundary got two fences
// side by side (seen in the Workbench, 2026-11-18: 11 % of the fence length doubled).
// Lines are kept in order; the parts of a line that run along an already kept one are dropped.

type Seg = [number, number, number, number]

function segDist(x: number, z: number, [ax, az, bx, bz]: Seg): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
  return Math.hypot(ax + t * dx - x, az + t * dz - z)
}

/** drops the collinear middle points of a flat X/Z list */
function simplify(p: number[]): number[] {
  if (p.length <= 4) return p
  const o = [p[0], p[1]]
  for (let i = 2; i + 3 < p.length; i += 2) {
    const ax = o[o.length - 2], az = o[o.length - 1], bx = p[i], bz = p[i + 1], cx = p[i + 2], cz = p[i + 3]
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    if (Math.abs(cross) > 0.05 * Math.hypot(cx - ax, cz - az)) o.push(bx, bz)
  }
  o.push(p[p.length - 2], p[p.length - 1])
  return o
}

/**
 * Removes the doubled parts of open polylines (flat X/Z lists).
 * @param lines polylines in priority order (earlier ones are kept whole)
 * @param tol distance under which two fences count as the same one, metres
 * @param step sampling step along the lines, metres
 * @returns for each input line, the pieces to keep (possibly none)
 */
export function dedupeLines(lines: number[][], tol = 1.5, step = 1): number[][][] {
  const kept: Seg[] = []
  const out: number[][][] = []
  for (const p of lines) {
    // sample the line, flag the samples that lie on a kept fence
    const pts: number[] = [], on: boolean[] = []
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n
        pts.push(x, z)
        on.push(kept.some((s) => segDist(x, z, s) < tol))
      }
    }
    const pieces: number[][] = []
    let cur: number[] = []
    for (let j = 0; j < on.length; j++) {
      if (on[j]) {
        if (cur.length >= 4) pieces.push(simplify(cur))
        cur = []
      } else cur.push(pts[2 * j], pts[2 * j + 1])
    }
    if (cur.length >= 4) pieces.push(simplify(cur))
    // a piece shorter than 2 m is a stub at a corner: not worth a fence
    const long = pieces.filter((q) => {
      let l = 0
      for (let i = 0; i + 3 < q.length; i += 2) l += Math.hypot(q[i + 2] - q[i], q[i + 3] - q[i + 1])
      return l >= 2
    })
    out.push(long)
    for (const q of long) for (let i = 0; i + 3 < q.length; i += 2) kept.push([q[i], q[i + 1], q[i + 2], q[i + 3]])
  }
  return out
}

/**
 * Adds points so no leg is longer than `max` metres. The Workbench snaps each point to the ground,
 * so a long leg over a bump or a hollow left the fence floating or buried between its two ends.
 */
export function densify(p: number[], max = 4): number[] {
  if (p.length < 4) return p
  const o = [p[0], p[1]]
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / max))
    for (let k = 1; k <= n; k++) o.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)
  }
  return o
}

/** segment crossing point of a-b and c-d (strictly inside both), or null */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number, number] | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? [ax + rx * t, az + rz * t, t] : null
}

/**
 * Fences of overlapping parcels cut through each other (seed 21 live: PARCEL_FENCE_10 across 13 and 1). In order,
 * each line is split where it crosses an earlier kept one: it stops ON that fence (a T, like a real field corner).
 * The overhang past the crossing goes when shorter than `stub` m; a long run on the other side stays (its own field edge).
 * Pieces shorter than `minLen` are dropped. Input: flat X/Z polylines; output: for each input line, its kept pieces.
 */
export function trimCrossings(lines: number[][], stub = 30, minLen = 4): number[][][] {
  const kept: number[][] = [], out: number[][][] = []
  const len = (p: number[]) => { let L = 0; for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return L }
  for (const p of lines) {
    // split p at every crossing with a kept line
    const pieces: { pts: number[]; a: boolean; b: boolean }[] = []
    let cur: number[] = [p[0], p[1]], startCut = false
    for (let i = 0; i + 3 < p.length; i += 2) {
      const hits: [number, number, number][] = []
      for (const q of kept) for (let j = 0; j + 3 < q.length; j += 2) {
        const h = cross(p[i], p[i + 1], p[i + 2], p[i + 3], q[j], q[j + 1], q[j + 2], q[j + 3])
        if (h) hits.push(h)
      }
      hits.sort((m, n) => m[2] - n[2])
      for (const h of hits) { cur.push(h[0], h[1]); pieces.push({ pts: cur, a: startCut, b: true }); cur = [h[0], h[1]]; startCut = true }
      cur.push(p[i + 2], p[i + 3])
    }
    pieces.push({ pts: cur, a: startCut, b: false })
    const mine: number[][] = []
    for (const pc of pieces) {
      const L = len(pc.pts)
      if (L < minLen) continue
      if (pieces.length > 1 && (pc.a !== pc.b) && L < stub) continue // overhang stub past a crossing
      mine.push(pc.pts)
    }
    kept.push(...mine); out.push(mine)
  }
  return out
}

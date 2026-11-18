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

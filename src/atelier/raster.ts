// Small raster toolkit replacing the OpenCV / SciPy calls of giorbev's eau_layers.py (MIT, Copyright (c) giorbev):
// polygon fill, connected components, Euclidean distance transform, dilation / closing, contour tracing,
// Douglas-Peucker. Masks are Uint8Array (0/1), row-major, W x H.

export type Pt = [number, number]

/** even-odd fill, pixel (i, j) is inside when its centre (i + .5, j + .5) is */
export function fillPoly(W: number, H: number, P: Pt[]): Uint8Array {
  const m = new Uint8Array(W * H), n = P.length, xs: number[] = []
  for (let j = 0; j < H; j++) {
    const y = j + 0.5
    xs.length = 0
    for (let k = 0; k < n; k++) {
      const [x1, y1] = P[k], [x2, y2] = P[(k + 1) % n]
      if ((y1 <= y) !== (y2 <= y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5))
      for (let i = a; i <= b; i++) m[j * W + i] = 1
    }
  }
  return m
}

/** 8-connected components: labels (0 = background) and sizes[label] */
export function components(m: Uint8Array, W: number, H: number): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(W * H), sizes = [0], stack: number[] = []
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue
    const L = sizes.length; let cnt = 0
    lab[s] = L; stack.push(s)
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W
      cnt++
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (m[q] && !lab[q]) { lab[q] = L; stack.push(q) }
      }
    }
    sizes.push(cnt)
  }
  return { lab, sizes }
}

function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
}
/** exact distance (pixels) from every pixel to the nearest pixel where m == 1 (Felzenszwalb-Huttenlocher) */
export function distTo(m: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e20, N = Math.max(W, H), f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1)
  const g = new Float64Array(W * H)
  for (let i = 0; i < W * H; i++) g[i] = m[i] ? 0 : INF
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; edt1(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y] }
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1(f, W, d, v, z); for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]) }
  return out
}
export function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const d = distTo(m, W, H), o = new Uint8Array(W * H)
  for (let i = 0; i < o.length; i++) o[i] = d[i] <= r ? 1 : 0
  return o
}
export function erode(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const inv = new Uint8Array(W * H)
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1
  const d = distTo(inv, W, H), o = new Uint8Array(W * H)
  for (let i = 0; i < o.length; i++) o[i] = m[i] && d[i] > r ? 1 : 0
  return o
}
export const close = (m: Uint8Array, W: number, H: number, r: number) => erode(dilate(m, W, H, r), W, H, r)

/** outer boundary of the component containing pixel `start` (Moore tracing), pixel-centre coordinates */
export function traceOuter(m: Uint8Array, W: number, H: number, start: number): Pt[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const sx = start % W, sy = (start - sx) / W
  const out: Pt[] = [[sx + 0.5, sy + 0.5]]
  let x = sx, y = sy, dir = 7, guard = 0
  while (guard++ < 4 * W * H) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8, nx = x + dirs[d][0], ny = y + dirs[d][1]
      if (at(nx, ny)) { x = nx; y = ny; dir = d; found = true; break }
    }
    if (!found || (x === sx && y === sy)) break
    out.push([x + 0.5, y + 0.5])
  }
  return out
}
/** largest component's outer contour (scan order start = top-left-most pixel) */
export function largestContour(m: Uint8Array, W: number, H: number): Pt[] | null {
  const { lab, sizes } = components(m, W, H)
  if (sizes.length < 2) return null
  let best = 1
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i
  for (let s = 0; s < lab.length; s++) if (lab[s] === best) return traceOuter(m, W, H, s)
  return null
}

function dpRec(P: Pt[], a: number, b: number, eps: number, keep: Uint8Array) {
  let dmax = 0, idx = -1
  const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy)
  for (let i = a + 1; i < b; i++) {
    const d = L < 1e-9 ? Math.hypot(P[i][0] - ax, P[i][1] - ay) : Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L
    if (d > dmax) { dmax = d; idx = i }
  }
  if (dmax > eps && idx > 0) { keep[idx] = 1; dpRec(P, a, idx, eps, keep); dpRec(P, idx, b, eps, keep) }
}
/** Douglas-Peucker; closed: the ring is split at the point farthest from P[0] */
export function simplify(P: Pt[], eps: number, closed: boolean): Pt[] {
  if (P.length < 3) return P.slice()
  if (closed) {
    let far = 0, dm = -1
    for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > dm) { dm = d; far = i } }
    const A = simplify(P.slice(0, far + 1), eps, false), B = simplify([...P.slice(far), P[0]], eps, false)
    return [...A, ...B.slice(1, -1)]
  }
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1
  dpRec(P, 0, P.length - 1, eps, keep)
  return P.filter((_, i) => keep[i])
}

export function area(P: Pt[]): number {
  let s = 0
  for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; s += x1 * y2 - x2 * y1 }
  return s / 2
}
/** crossings between non-adjacent sides of a closed polygon */
export function crossings(P: Pt[]): number {
  const n = P.length; let k = 0
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue
    const A = P[i], B = P[(i + 1) % n], C = P[j], D = P[(j + 1) % n]
    const d1x = B[0] - A[0], d1y = B[1] - A[1], d2x = D[0] - C[0], d2y = D[1] - C[1], den = d1x * d2y - d1y * d2x
    if (Math.abs(den) < 1e-12) continue
    const wx = C[0] - A[0], wy = C[1] - A[1], t = (wx * d2y - wy * d2x) / den, u = (wx * d1y - wy * d1x) / den
    if (t > 0 && t < 1 && u > 0 && u < 1) k++
  }
  return k
}

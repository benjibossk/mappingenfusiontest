// Stream power fluvial erosion (Braun & Willett 2013, Cordonnier et al. 2016).
// Original implementation. Per iteration:
//   1. priority-flood fill of depressions (with a tiny epsilon so every cell drains),
//   2. D8 steepest-descent receivers on the filled surface,
//   3. drained area accumulated downstream -> upstream order reversed,
//   4. implicit incision dh = -K A^m S^n dt (n = 1), solved from outlet upstream.
// Outlets: grid border and every cell at or below sea level.

export interface Grid { cols: number; rows: number; step: number }

export interface StreamPowerOptions {
  /** Sea level; nothing is lowered below it. Default 0. */
  sea?: number
  /** Erodibility K (1/yr-ish units, scaled by dt). Default 2e-5. */
  k?: number
  /** Area exponent m. Default 0.5. */
  m?: number
  /** Time step per iteration. Default 2000. */
  dt?: number
  /** Number of iterations. Default 10. */
  iterations?: number
  /** Optional uniform uplift per unit time (added before incision, land only). Default 0. */
  uplift?: number
}

export interface StreamPowerResult {
  flow: Float32Array
  wear: Float32Array
  deposits: Float32Array
}

const SQRT2 = Math.SQRT2
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]
const DL = [1, SQRT2, 1, SQRT2, 1, SQRT2, 1, SQRT2]

/** Min-heap over cell indices keyed by a Float64Array, ties broken by index (deterministic). */
class Heap {
  idx: Int32Array
  key: Float64Array
  n = 0
  constructor(cap: number) { this.idx = new Int32Array(cap); this.key = new Float64Array(cap) }
  private less(a: number, b: number): boolean {
    const ka = this.key[a], kb = this.key[b]
    return ka < kb || (ka === kb && this.idx[a] < this.idx[b])
  }
  private swap(a: number, b: number) {
    const i = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = i
    const k = this.key[a]; this.key[a] = this.key[b]; this.key[b] = k
  }
  push(i: number, k: number) {
    let c = this.n++
    this.idx[c] = i; this.key[c] = k
    while (c > 0) {
      const p = (c - 1) >> 1
      if (!this.less(c, p)) break
      this.swap(c, p); c = p
    }
  }
  pop(): number {
    const top = this.idx[0]
    this.n--
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n]; this.key[0] = this.key[this.n]
      let c = 0
      for (;;) {
        const l = 2 * c + 1, r = l + 1
        let s = c
        if (l < this.n && this.less(l, s)) s = l
        if (r < this.n && this.less(r, s)) s = r
        if (s === c) break
        this.swap(c, s); c = s
      }
    }
    return top
  }
}

function normalize(a: Float32Array): Float32Array {
  let max = 0
  for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i]
  if (max > 0) for (let i = 0; i < a.length; i++) a[i] /= max
  return a
}

export function streamPowerErode(heights: number[], grid: Grid, opts: StreamPowerOptions = {}): StreamPowerResult {
  const { cols, rows, step } = grid
  const N = cols * rows
  if (heights.length !== N) throw new Error(`streamPowerErode: ${heights.length} heights for ${cols}x${rows}`)
  const sea = opts.sea ?? 0
  const K = opts.k ?? 2e-5
  const m = opts.m ?? 0.5
  const dt = opts.dt ?? 2000
  const iters = Math.max(0, Math.floor(opts.iterations ?? 10))
  const uplift = opts.uplift ?? 0
  const cellArea = step * step
  const eps = 1e-4 * step

  const h = Float64Array.from(heights)
  const original = Float64Array.from(heights)
  const order = new Int32Array(N) // pop order of priority-flood = upstream after downstream
  const recv = new Int32Array(N)
  const rlen = new Float64Array(N)
  const area = new Float64Array(N)
  const closed = new Uint8Array(N)
  const heap = new Heap(N)
  const wear = new Float32Array(N)
  const deposits = new Float32Array(N)

  for (let it = 0; it < iters; it++) {
    if (uplift !== 0) for (let i = 0; i < N; i++) if (h[i] > sea) h[i] += uplift * dt

    // 1. Priority-flood (seeded by border and sea cells).
    closed.fill(0)
    heap.n = 0
    let cnt = 0
    for (let i = 0; i < N; i++) {
      const x = i % cols, y = (i / cols) | 0
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || h[i] <= sea) {
        closed[i] = 1; recv[i] = i; heap.push(i, h[i])
      }
    }
    while (heap.n > 0) {
      const c = heap.pop()
      order[cnt++] = c
      const cx = c % cols, cy = (c / cols) | 0
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d]
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const n = ny * cols + nx
        if (closed[n]) continue
        closed[n] = 1
        const floor = h[c] + eps * DL[d]
        if (h[n] < floor) { deposits[n] += floor - h[n]; h[n] = floor }
        heap.push(n, h[n])
      }
    }

    // 2. D8 receivers: steepest descent towards a lower neighbour (always exists after fill).
    for (let i = 0; i < N; i++) {
      const x = i % cols, y = (i / cols) | 0
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || h[i] <= sea) { recv[i] = i; rlen[i] = step; continue }
      let best = i, bestS = 0, bestL = step
      for (let d = 0; d < 8; d++) {
        const n = (y + DY[d]) * cols + (x + DX[d])
        const L = DL[d] * step
        const s = (h[i] - h[n]) / L
        if (s > bestS) { bestS = s; best = n; bestL = L }
      }
      recv[i] = best; rlen[i] = bestL
    }

    // 3. Drained area: traverse upstream -> downstream (reverse pop order).
    area.fill(cellArea)
    for (let k = N - 1; k >= 0; k--) {
      const i = order[k], r = recv[i]
      if (r !== i) area[r] += area[i]
    }

    // 4. Implicit incision (n = 1), downstream -> upstream so receivers are already updated.
    for (let k = 0; k < N; k++) {
      const i = order[k], r = recv[i]
      if (r === i) continue
      const F = K * Math.pow(area[i], m) * dt / rlen[i]
      const old = h[i]
      let nh = (old + F * h[r]) / (1 + F)
      if (nh < sea) nh = sea
      if (nh < old) { wear[i] += old - nh; h[i] = nh }
    }
  }

  for (let i = 0; i < N; i++) heights[i] = h[i]
  // Net deposits only where the final surface sits above the original one.
  for (let i = 0; i < N; i++) deposits[i] = Math.max(0, h[i] - original[i])
  const flow = new Float32Array(N)
  for (let i = 0; i < N; i++) flow[i] = iters > 0 ? Math.log1p(area[i] / cellArea) : 0
  return { flow: normalize(flow), wear: normalize(wear), deposits: normalize(deposits) }
}

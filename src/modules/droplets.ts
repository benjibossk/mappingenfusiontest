// Droplet (particle) hydraulic erosion: fine gullies carved down the flanks.
// Original implementation, after the general principle described by Lague (MIT): a water drop rolls
// downhill with some inertia, picks up sediment while its capacity (speed x water x slope) exceeds its
// load, drops it where it slows down, and evaporates. Many drops on the same flanks cut parallel gullies.
// Cells at or below sea level are never touched: a drop that reaches the sea stops and its load is lost
// (counted in `lost`), so eroded = deposited + lost.

export interface DropletOptions {
  seed?: number
  /** drops per land cell. Default 0.6. */
  density?: number
  /** max steps per drop. Default 48. */
  maxSteps?: number
  /** 0..1, how much the drop keeps its direction. Default 0.3. */
  inertia?: number
  /** sediment capacity factor. Default 6. */
  capacity?: number
  /** share of the excess load dropped per step. Default 0.25. */
  deposition?: number
  /** share of the free capacity picked per step. Default 0.35. */
  erosion?: number
  /** water lost per step. Default 0.03. */
  evaporation?: number
  /** erosion brush radius in cells. Default 1.5. */
  radius?: number
  /** slope floor for the capacity. Default 0.02. */
  minSlope?: number
  /** max metres a single step may remove at the brush centre. Default 0.6. */
  maxCut?: number
  /** drops start only where the slope is above this (rise / run). Default 0.08. */
  startSlope?: number
  sea?: number
}

export interface DropletResult {
  wear: Float32Array
  deposits: Float32Array
  eroded: number
  deposited: number
  lost: number
}

function rng(seed: number) {
  let a = (seed | 0) ^ 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function dropletErode(h: number[] | Float32Array, cols: number, rows: number, step: number, o: DropletOptions = {}): DropletResult {
  const N = cols * rows
  const sea = o.sea ?? 0
  const inertia = o.inertia ?? 0.3, capF = o.capacity ?? 6, dep = o.deposition ?? 0.25, ero = o.erosion ?? 0.35
  const evap = o.evaporation ?? 0.03, minSlope = o.minSlope ?? 0.02, maxSteps = o.maxSteps ?? 48, maxCut = o.maxCut ?? 0.6
  const R = o.radius ?? 1.5
  const rand = rng(o.seed ?? 1)
  const wear = new Float32Array(N), deposits = new Float32Array(N)
  // brush offsets and weights (sum 1)
  const ri = Math.ceil(R), bo: number[] = [], bw: number[] = []
  let ws = 0
  for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
    const d = Math.hypot(dx, dz)
    if (d > R) continue
    bo.push(dz * cols + dx); bw.push(R - d); ws += R - d
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= ws
  const land: number[] = []
  // drops start on the flanks only: on flat ground they would just pit the plains
  const startSlope = (o.startSlope ?? 0.08) * 2 * step
  for (let r = ri + 1; r < rows - ri - 1; r++) for (let c = ri + 1; c < cols - ri - 1; c++) {
    const i = r * cols + c
    if (h[i] <= sea + 1) continue
    if (Math.hypot(h[i + 1] - h[i - 1], h[i + cols] - h[i - cols]) < startSlope) continue
    land.push(i)
  }
  const drops = Math.round(land.length * (o.density ?? 0.6))
  let eroded = 0, deposited = 0, lost = 0
  // bilinear height + gradient in cell units
  let gx = 0, gz = 0
  const sample = (x: number, z: number) => {
    const c = Math.floor(x), r = Math.floor(z), u = x - c, v = z - r, i = r * cols + c
    const a = h[i], b = h[i + 1], cc = h[i + cols], d = h[i + cols + 1]
    gx = (b - a) * (1 - v) + (d - cc) * v
    gz = (cc - a) * (1 - u) + (d - b) * u
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v
  }
  const lo = ri + 1, hiX = cols - ri - 2, hiZ = rows - ri - 2
  for (let n = 0; n < drops; n++) {
    const s = land[Math.floor(rand() * land.length)]
    let x = (s % cols) + rand(), z = Math.floor(s / cols) + rand()
    let dx = 0, dz = 0, speed = 1, water = 1, load = 0
    for (let st = 0; st < maxSteps; st++) {
      const c = Math.floor(x), r = Math.floor(z), u = x - c, v = z - r, i = r * cols + c
      const hOld = sample(x, z)
      dx = dx * inertia - gx * (1 - inertia)
      dz = dz * inertia - gz * (1 - inertia)
      const L = Math.hypot(dx, dz)
      if (L < 1e-9) break
      dx /= L; dz /= L
      const nx = x + dx, nz = z + dz
      if (nx < lo || nz < lo || nx >= hiX || nz >= hiZ) { lost += load; load = 0; break }
      const hNew = sample(nx, nz)
      if (hNew <= sea) { lost += load; load = 0; break }
      const dh = hNew - hOld
      const cap = Math.max(-dh / step, minSlope) * speed * water * capF
      if (dh > 0 || load > cap) {
        // drop: fill the pit (uphill step) or the excess, on the 4 corners, never below sea cells
        let amt = dh > 0 ? Math.min(dh, load) : (load - cap) * dep
        const wq = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v], ix = [i, i + 1, i + cols, i + cols + 1]
        let put = 0
        for (let k = 0; k < 4; k++) if (h[ix[k]] > sea) { const a = amt * wq[k]; h[ix[k]] += a; deposits[ix[k]] += a; put += a }
        amt = put
        load -= amt; deposited += amt
      } else {
        // pick up, spread with the brush, never cut deeper than the step drop nor down to the sea
        const want = Math.min((cap - load) * ero, -dh, maxCut)
        let took = 0
        for (let k = 0; k < bo.length; k++) {
          const j = i + bo[k], hj = h[j]
          if (hj <= sea + 0.5) continue
          const a = Math.min(want * bw[k], hj - sea - 0.5)
          h[j] = hj - a; wear[j] += a; took += a
        }
        load += took; eroded += took
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * 0.8))
      if (speed < 0.05) speed = 0.05
      water *= 1 - evap
      x = nx; z = nz
    }
    // the drop dries out: what it still carries settles where it stops
    if (load > 0) {
      const i = Math.floor(z) * cols + Math.floor(x)
      for (let k = 0; k < bo.length; k++) {
        const j = i + bo[k], a = load * bw[k]
        if (h[j] > sea) { h[j] += a; deposits[j] += a; deposited += a } else lost += a
      }
    }
  }
  return { wear, deposits, eroded, deposited, lost }
}

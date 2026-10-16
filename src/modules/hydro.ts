// Rivers on a height grid, after mapgen4's approach (Amit Patel, Apache-2.0: rain falls on land,
// flows downhill to the sea, rivers where enough water gathers), redone on a regular grid:
// priority-flood (lakes and pits drain out), D8 flow directions, flow accumulation, bed carving.

export interface RiverParams {
  rain: number // water per cell, relative (1 = uniform)
  windAngle: number // degrees, wind direction: windward slopes get more rain (mapgen4 idea)
  threshold: number // accumulated flow (cells) above which a cell is a river
  depth: number // max bed depth in metres
  sink?: Uint8Array // 1 = no rain here and water stops here (river erased from this point downstream)
}

export interface Rivers {
  flow: Float32Array // accumulated water per cell
  river: Float32Array // 0..1 river strength per cell
  down: Int32Array // index of the cell each cell drains into (-1: sea / border)
  filled: Float32Array // heights with every pit filled to its spill level (filled - height = lake depth)
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DZ = [0, 1, 1, 1, 0, -1, -1, -1]

class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.k, v = this.v
    const top = v[0]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= k.length) break
        if (c + 1 < k.length && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

//! Computes rivers and carves their beds into heights (in place). Sea = height <= 0.
export function computeRivers(heights: number[], cols: number, rows: number, step: number, p: RiverParams): Rivers {
  const n = cols * rows
  const filled = Float32Array.from(heights)
  const down = new Int32Array(n).fill(-1)
  const order: number[] = []
  const done = new Uint8Array(n)
  const heap = new MinHeap()

  // seeds: sea cells and the border
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = (i - c) / cols
    if (heights[i] <= 0 || c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
      done[i] = 1
      heap.push(filled[i], i)
    }
  }
  // priority flood: every land cell gets a downstream neighbour on a strictly descending path
  while (heap.size) {
    const i = heap.pop()
    order.push(i)
    const c = i % cols, r = (i - c) / cols
    for (let d = 0; d < 8; d++) {
      const cc = c + DX[d], rr = r + DZ[d]
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
      const j = rr * cols + cc
      if (done[j]) continue
      done[j] = 1
      filled[j] = Math.max(filled[j], filled[i] + 1e-3)
      down[j] = i
      heap.push(filled[j], j)
    }
  }

  // rain: more on slopes facing the wind
  const wa = (p.windAngle * Math.PI) / 180
  const wx = Math.cos(wa), wz = Math.sin(wa)
  const flow = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i] <= 0 || p.sink?.[i]) continue
    const c = i % cols, r = (i - c) / cols
    const h = (cc: number, rr: number) => heights[Math.min(Math.max(rr, 0), rows - 1) * cols + Math.min(Math.max(cc, 0), cols - 1)]
    const gx = (h(c + 1, r) - h(c - 1, r)) / (2 * step)
    const gz = (h(c, r + 1) - h(c, r - 1)) / (2 * step)
    const windward = Math.max(0, -(gx * wx + gz * wz)) // rising against the wind
    flow[i] = p.rain * (1 + 4 * windward)
  }
  // accumulate from the highest cells down (reverse flood order)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    if (p.sink?.[i]) flow[i] = 0
    else if (down[i] >= 0 && heights[i] > 0) flow[down[i]] += flow[i]
  }

  const river = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i] <= 0 || flow[i] < p.threshold) continue
    const s = Math.min(1, Math.sqrt(flow[i] / p.threshold - 1) / 4)
    river[i] = Math.max(0.3, s)
  }
  // widen big rivers by one cell, carve beds, keep beds above sea level
  const wide = Float32Array.from(river)
  for (let i = 0; i < n; i++) {
    if (river[i] < 0.6) continue
    const c = i % cols, r = (i - c) / cols
    for (let d = 0; d < 8; d += 2) {
      const cc = c + DX[d], rr = r + DZ[d]
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) wide[rr * cols + cc] = Math.max(wide[rr * cols + cc], river[i] * 0.6)
    }
  }
  for (let i = 0; i < n; i++) {
    if (!wide[i] || heights[i] <= 0) continue
    heights[i] = Math.max(0.3, heights[i] - p.depth * wide[i])
  }
  return { flow, river: wide, down, filled }
}

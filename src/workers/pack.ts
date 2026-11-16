// Structured-clone helpers for the generator worker: big number[] (height grids) travel as Float64Array
// (exact: same doubles, so results stay bit-identical) and every typed array buffer is transferred, not copied.
const BIG = 16384
type Tag = { __f64: Float64Array }

export function pack(v: unknown, out: Transferable[], depth = 0): unknown {
  if (depth > 6 || v === null || typeof v !== 'object') return v
  if (ArrayBuffer.isView(v)) { const b = (v as Float32Array).buffer as ArrayBuffer; if (!out.includes(b)) out.push(b); return v }
  if (Array.isArray(v)) {
    if (v.length >= BIG && typeof v[0] === 'number') { const f = Float64Array.from(v as number[]); out.push(f.buffer); return { __f64: f } as Tag }
    return v.map((x) => pack(x, out, depth + 1))
  }
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = pack(x, out, depth + 1)
  return o
}

export function unpack(v: unknown, depth = 0): unknown {
  if (depth > 6 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v
  if (Array.isArray(v)) return v.map((x) => unpack(x, depth + 1))
  if ((v as Tag).__f64 instanceof Float64Array) return Array.from((v as Tag).__f64)
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) o[k] = unpack(o[k], depth + 1)
  return o
}

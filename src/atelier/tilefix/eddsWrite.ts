// Re-encode a tile's _layer.edds after a weight correction. Keeps the original header byte for byte and
// rewrites the Enfusion mip table with uncompressed "COPY" mips (a kind the engine's reader accepts, see
// formats/edds.ts); smaller mips are rebuilt from the corrected main mip by point sampling (packed weights
// must not be averaged). No change → the original bytes are returned untouched.
import { ddsInfo, lz4Chained } from '../formats/edds.ts'

const FOURCCS = new Set(['COPY', 'LZ4 ', 'LZB4', 'LZ4B'])
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

export function mipTable(b: Uint8Array): number {
  const info = ddsInfo(b), d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (const c of [148, 128, 136, 140, 144, 152]) {
    if (b.length < c + info.mips * 8) continue
    let ok = true
    for (let i = 0; i < info.mips && ok; i++) ok = FOURCCS.has(tag(b, c + i * 8)) && d.getUint32(c + i * 8 + 4, true) <= b.length
    if (ok) return c
  }
  return -1
}

const level = (px: Uint32Array, W: number, H: number, l: number): Uint8Array => {
  const w = Math.max(1, W >> l), h = Math.max(1, H >> l), out = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px[Math.min(H - 1, y << l) * W + Math.min(W - 1, x << l)]
  return new Uint8Array(out.buffer)
}

export function encodeLayer(orig: Uint8Array, px: Uint32Array, origPx?: Uint32Array): Uint8Array {
  if (origPx && origPx.length === px.length && origPx.every((v, i) => v === px[i])) return orig
  const info = ddsInfo(orig)
  if (info.bitCount && info.bitCount !== 32 && info.dxgi !== 0 && info.dxgi !== 42) throw new Error('layer EDDS: not R32')
  const mips = info.mips, parts: Uint8Array[] = []
  if (!info.enf) {
    parts.push(orig.subarray(0, info.headerEnd))
    for (let l = 0; l < mips; l++) parts.push(level(px, info.width, info.height, l))
  } else {
    const table = mipTable(orig)
    if (table < 0) throw new Error('layer EDDS: mip table not found')
    const head = new Uint8Array(orig.subarray(0, table + mips * 8)), d = new DataView(head.buffer) // a copy (Buffer.slice is a view)
    const data: Uint8Array[] = []
    for (let i = 0; i < mips; i++) { // table order: smallest first, main mip last
      const m = level(px, info.width, info.height, mips - 1 - i)
      head.set([67, 79, 80, 89], table + i * 8) // "COPY"
      d.setUint32(table + i * 8 + 4, m.length, true)
      data.push(m)
    }
    parts.push(head, ...data)
  }
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n)
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
export { lz4Chained }

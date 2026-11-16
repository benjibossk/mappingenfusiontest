// Enfusion IFF-like containers (.terr, .ttile, .bterr): "FORM" + u32 BE size + 4-char type, then chunks
// (4-char id + u32 BE size + body, no padding). Read-only.
// Layout cross-checked with giorbev's lrs2_parser.py / bterr_reader.py (MIT, Copyright (c) giorbev).

export interface IffChunk { id: string; off: number; size: number }
export interface Iff { type: string; chunks: IffChunk[]; get(id: string): Uint8Array | undefined }

const ascii = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

export function readIff(b: Uint8Array): Iff {
  if (b.length < 12 || ascii(b, 0) !== 'FORM') throw new Error('not an IFF file (FORM)')
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const chunks: IffChunk[] = []
  for (let o = 12; o + 8 <= b.length; ) {
    const size = dv.getUint32(o + 4, false)
    if (o + 8 + size > b.length) break
    chunks.push({ id: ascii(b, o), off: o + 8, size })
    o += 8 + size
  }
  return {
    type: ascii(b, 8),
    chunks,
    get(id) { const c = chunks.find((k) => k.id === id); return c ? b.subarray(c.off, c.off + c.size) : undefined },
  }
}

export const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

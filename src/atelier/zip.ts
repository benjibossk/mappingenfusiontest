// Minimal ZIP writer (stored entries) and reader (stored + deflate via DecompressionStream).
// Used for the Atelier project archive (.rmatelier.zip) and to import giorbev's .mgp.zip archives.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []
  let off = 0
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), h = new Uint8Array(30 + nm.length), d = new DataView(h.buffer)
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x0800, true); d.setUint32(14, crc, true)
    d.setUint32(18, f.data.length, true); d.setUint32(22, f.data.length, true); d.setUint16(26, nm.length, true); h.set(nm, 30)
    const c = new Uint8Array(46 + nm.length), e = new DataView(c.buffer)
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint32(16, crc, true)
    e.setUint32(20, f.data.length, true); e.setUint32(24, f.data.length, true); e.setUint16(28, nm.length, true); e.setUint32(42, off, true); c.set(nm, 46)
    parts.push(h, f.data); central.push(c); off += h.length + f.data.length
  }
  const cs = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), g = new DataView(end.buffer)
  g.setUint32(0, 0x06054b50, true); g.setUint16(8, files.length, true); g.setUint16(10, files.length, true); g.setUint32(12, cs, true); g.setUint32(16, off, true)
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let o = 0; for (const p of all) { out.set(p, o); o += p.length }
  return out
}

async function inflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

export async function unzip(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map<string, Uint8Array>(), dec = new TextDecoder()
  let e = b.length - 22
  while (e >= 0 && d.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip file')
  const n = d.getUint16(e + 10, true)
  let o = d.getUint32(e + 16, true)
  for (let i = 0; i < n; i++) {
    const method = d.getUint16(o + 10, true), csize = d.getUint32(o + 20, true), nl = d.getUint16(o + 28, true), xl = d.getUint16(o + 30, true), cl = d.getUint16(o + 32, true), lo = d.getUint32(o + 42, true)
    const name = dec.decode(b.subarray(o + 46, o + 46 + nl))
    const start = lo + 30 + d.getUint16(lo + 26, true) + d.getUint16(lo + 28, true), raw = b.subarray(start, start + csize)
    if (!name.endsWith('/')) out.set(name, method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : new Uint8Array())
    o += 46 + nl + xl + cl
  }
  return out
}

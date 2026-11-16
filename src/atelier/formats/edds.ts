// DDS / Enfusion EDDS reader: DDS header (+ DX10), Enfusion "ENF1" mip table (COPY / LZ4 chained 64 KB blocks),
// R32 layer weights (6 × 5-bit painted slots), BC1/BC2/BC3/BC4/BC5/BC7 and RGBA8/BGRA8 colour decode.
// Ported from giorbev's edds_decoder.py (MIT, Copyright (c) giorbev): mip table detection, chained LZ4,
// slot weight packing. BCn decoders written from the public D3D block-compression specification.

const FOURCCS = new Set(['COPY', 'LZ4 ', 'LZB4', 'LZ4B'])
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

export interface DdsInfo { width: number; height: number; mips: number; fourcc: string; dxgi: number; enf: boolean; bitCount: number; headerEnd: number }

export function ddsInfo(b: Uint8Array): DdsInfo {
  if (b.length < 128 || tag(b, 0) !== 'DDS ') throw new Error('not a DDS file')
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const height = d.getUint32(12, true), width = d.getUint32(16, true), mips = Math.max(1, d.getUint32(28, true))
  const fourcc = tag(b, 84), bitCount = d.getUint32(88, true)
  let enf = false
  for (let o = 32; o < 52; o++) if (tag(b, o) === 'ENF1') enf = true
  const FCC: Record<string, number> = { DXT1: 71, DXT3: 74, DXT5: 77, ATI1: 80, BC4U: 80, ATI2: 83, BC5U: 83 }
  const dxgi = fourcc === 'DX10' ? d.getUint32(128, true) : FCC[fourcc] ?? 0
  return { width, height, mips, fourcc, dxgi, enf, bitCount, headerEnd: fourcc === 'DX10' ? 148 : 128 }
}

/** LZ4 block stream as Enfusion writes it: u32 total, then [u32 size|flag][block] × n; each block may
 *  reference the previous 64 KB, which a single contiguous output buffer gives for free */
export function lz4Chained(src: Uint8Array): Uint8Array {
  const d = new DataView(src.buffer, src.byteOffset, src.byteLength)
  const total = d.getUint32(0, true), out = new Uint8Array(total)
  let p = 4, o = 0
  while (p + 4 <= src.length && o < total) {
    const n = d.getUint32(p, true) & 0x7fffffff; p += 4
    if (!n || p + n > src.length) break
    const end = p + n, stop = Math.min(total, o + 65536)
    while (p < end && o < stop) {
      const tok = src[p++]
      let lit = tok >> 4
      if (lit === 15) { let s; do { s = src[p++]; lit += s } while (s === 255) }
      out.set(src.subarray(p, p + lit), o); p += lit; o += lit
      if (p >= end) break
      const off = src[p] | (src[p + 1] << 8); p += 2
      let ml = tok & 15
      if (ml === 15) { let s; do { s = src[p++]; ml += s } while (s === 255) }
      ml += 4
      if (off === 0 || off > o) throw new Error('LZ4: bad offset')
      for (let i = 0; i < ml && o < total; i++, o++) out[o] = out[o - off]
    }
    p = end
  }
  return out
}

/** bytes of the main (largest) mip */
export function mainMip(b: Uint8Array, info = ddsInfo(b)): Uint8Array {
  if (!info.enf) return b.subarray(info.headerEnd)
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let table = -1
  for (const c of [148, 128, 136, 140, 144, 152]) {
    if (b.length < c + info.mips * 8) continue
    let ok = true
    for (let i = 0; i < info.mips && ok; i++) ok = FOURCCS.has(tag(b, c + i * 8)) && d.getUint32(c + i * 8 + 4, true) <= b.length
    if (ok) { table = c; break }
  }
  if (table < 0) table = info.headerEnd
  let off = table + info.mips * 8
  for (let i = 0; i < info.mips - 1; i++) off += d.getUint32(table + i * 8 + 4, true)
  const last = table + (info.mips - 1) * 8, kind = tag(b, last), size = d.getUint32(last + 4, true)
  const raw = b.subarray(off, off + size)
  if (kind === 'COPY') return raw
  if (kind.startsWith('LZ4') || kind.startsWith('LZB')) return lz4Chained(raw)
  throw new Error('EDDS: unsupported mip ' + kind)
}

// ---------------------------------------------------------------- layer weights (R32: 6 × 5 bits)
export interface LayerWeights { width: number; height: number; px: Uint32Array }
export function decodeLayer(b: Uint8Array): LayerWeights {
  const info = ddsInfo(b), m = mainMip(b, info), n = info.width * info.height
  const px = new Uint32Array(n)
  const d = new DataView(m.buffer, m.byteOffset, m.byteLength)
  for (let i = 0; i < n && i * 4 + 3 < m.length; i++) px[i] = d.getUint32(i * 4, true)
  return { width: info.width, height: info.height, px }
}
/** weight 0..31 of slot s (0 = implicit base = 31 - sum of the 6 painted slots) */
export function slotWeight(p: number, s: number): number {
  if (s > 0) return (p >>> ((s - 1) * 5)) & 31
  let t = 0
  for (let k = 0; k < 30; k += 5) t += (p >>> k) & 31
  return Math.max(0, 31 - t)
}
/** pixels with a non-zero weight for each slot of block (bx, by) of a tile split in nb × nb blocks */
export function blockCoverage(L: LayerWeights, nb: number, bx: number, by: number, slots: number): { px: number; cover: number[] } {
  const bs = Math.floor(L.width / nb), cover = new Array(slots).fill(0)
  for (let y = by * bs; y < (by + 1) * bs; y++) for (let x = bx * bs; x < (bx + 1) * bs; x++) {
    const p = L.px[y * L.width + x]
    for (let s = 0; s < slots; s++) if (slotWeight(p, s) > 0) cover[s]++
  }
  return { px: bs * bs, cover }
}

// ---------------------------------------------------------------- colour
export interface Rgba { width: number; height: number; data: Uint8ClampedArray }

function rgb565(c: number, out: number[], o: number) { out[o] = ((c >> 11) & 31) * 255 / 31 | 0; out[o + 1] = ((c >> 5) & 63) * 255 / 63 | 0; out[o + 2] = (c & 31) * 255 / 31 | 0 }
function colourBlock(s: Uint8Array, p: number, px: Uint8ClampedArray, w: number, x0: number, y0: number, h: number, alpha1: boolean) {
  const c0 = s[p] | (s[p + 1] << 8), c1 = s[p + 2] | (s[p + 3] << 8), c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  rgb565(c0, c, 0); rgb565(c1, c, 3)
  const four = !alpha1 || c0 > c1
  for (let k = 0; k < 3; k++) {
    c[6 + k] = four ? (2 * c[k] + c[3 + k]) / 3 | 0 : (c[k] + c[3 + k]) >> 1
    c[9 + k] = four ? (c[k] + 2 * c[3 + k]) / 3 | 0 : 0
  }
  const bits = s[p + 4] | (s[p + 5] << 8) | (s[p + 6] << 16) | (s[p + 7] << 24)
  for (let i = 0; i < 16; i++) {
    const x = x0 + (i & 3), y = y0 + (i >> 2); if (x >= w || y >= h) continue
    const idx = (bits >>> (2 * i)) & 3, o = (y * w + x) * 4
    px[o] = c[idx * 3]; px[o + 1] = c[idx * 3 + 1]; px[o + 2] = c[idx * 3 + 2]
    px[o + 3] = alpha1 && !four && idx === 3 ? 0 : 255
  }
}
/** BC4-style 8-byte channel block into channel ch */
function channelBlock(s: Uint8Array, p: number, px: Uint8ClampedArray, w: number, x0: number, y0: number, h: number, ch: number) {
  const a0 = s[p], a1 = s[p + 1], a = [a0, a1, 0, 0, 0, 0, 0, 0]
  if (a0 > a1) for (let i = 1; i < 7; i++) a[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0
  else { for (let i = 1; i < 5; i++) a[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0; a[6] = 0; a[7] = 255 }
  let lo = s[p + 2] | (s[p + 3] << 8) | (s[p + 4] << 16), hi = s[p + 5] | (s[p + 6] << 8) | (s[p + 7] << 16)
  for (let i = 0; i < 16; i++) {
    const idx = i < 8 ? lo & 7 : hi & 7
    if (i < 8) lo >>= 3; else hi >>= 3
    const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) px[(y * w + x) * 4 + ch] = a[idx]
  }
}

// BC7 tables (D3D11 spec)
const P2 = [0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000, 0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c, 0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660, 0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22]
const P3 = '0011001102210222 0001001102210222 0000200122112211 0222002200110111 0000000011221122 0011001100220022 0022002211111111 0011001111221122 0000000011112222 0000111111112222 0000111122222222 0012001200120012 0112011201120112 0122012201220122 0011011211221222 0011200122002220 0001001101120122 0111001200220000 0000112211221122 0222002200220222 0001002200220222 0111001100220000 0000110011221122 0000000011221122 0000001101121122 0111022002200220 0000200020002110 0000002200111122 0022011201120222 0112011201120111 0112011201120122 0000111222222222 0000120011201220 0210012002100120 0112021020102012 0102010222122212 0000222111121112 0000212200001111 0000222111202111 0011220010012002 0021012100210121 0101222201012222 0000111122221111 0022111100221111 0101010122221222 0000212101012222 0022110011220022 0022122100220221 0000000021212121 0000000021212112 0202111102021212 0222011102220111 0002000200021112 0000212101012222 0000110011001000 0111022202220111 0000000021212121 0000000021212112 0220011102200111 0000000000002121 0101010111112121 0000220022002000 0000200010202122 0000220011011101 0022000000110111 0002000200001111'.split(' ').map((s) => [...s].map(Number))
const A2 = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15]
const A3a = [3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15, 8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3]
const A3b = [15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8]
const W2 = [0, 21, 43, 64], W3 = [0, 9, 18, 27, 37, 46, 55, 64], W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]
const WT = [[], [], W2, W3, W4]
// mode: subsets, partition bits, rotation bits, idx-sel bits, colour bits, alpha bits, pbits (0 none, 1 per endpoint, 2 shared), idx bits, idx2 bits
const MODES = [[3, 4, 0, 0, 4, 0, 1, 3, 0], [2, 6, 0, 0, 6, 0, 2, 3, 0], [3, 6, 0, 0, 5, 0, 0, 2, 0], [2, 6, 0, 0, 7, 0, 1, 2, 0], [1, 0, 2, 1, 5, 6, 0, 2, 3], [1, 0, 2, 0, 7, 8, 0, 2, 2], [1, 0, 0, 0, 7, 7, 1, 4, 0], [2, 6, 0, 0, 5, 5, 1, 2, 0]]

function bc7Block(s: Uint8Array, p: number, px: Uint8ClampedArray, w: number, x0: number, y0: number, h: number) {
  let bit = 0
  const rd = (n: number) => { let v = 0; for (let i = 0; i < n; i++, bit++) v |= ((s[p + (bit >> 3)] >> (bit & 7)) & 1) << i; return v }
  let mode = 0
  while (mode < 8 && !rd(1)) mode++
  const put = (i: number, r: number, g: number, b: number, a: number) => { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const o = (y * w + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a } }
  if (mode === 8) { for (let i = 0; i < 16; i++) put(i, 0, 0, 0, 0); return }
  const [ns, pb, rb, isb, cb, ab, pbits, ib, ib2] = MODES[mode]
  const part = rd(pb), rot = rd(rb), isel = rd(isb), ne = ns * 2
  const E: number[][] = Array.from({ length: ne }, () => [0, 0, 0, 255])
  for (let c = 0; c < 3; c++) for (let e = 0; e < ne; e++) E[e][c] = rd(cb)
  if (ab) for (let e = 0; e < ne; e++) E[e][3] = rd(ab)
  const P: number[] = []
  if (pbits === 1) for (let e = 0; e < ne; e++) P.push(rd(1))
  else if (pbits === 2) for (let sub = 0; sub < ns; sub++) { const v = rd(1); P.push(v, v) }
  const prec = [cb + (pbits ? 1 : 0), ab ? ab + (pbits ? 1 : 0) : 0]
  for (let e = 0; e < ne; e++) for (let c = 0; c < 4; c++) {
    if (c === 3 && !ab) { E[e][3] = 255; continue }
    let v = E[e][c], n = c === 3 ? prec[1] : prec[0]
    if (pbits) v = (v << 1) | P[e]
    v <<= 8 - n
    E[e][c] = v | (v >> n)
  }
  const subset = (i: number) => ns === 1 ? 0 : ns === 2 ? (P2[part] >> i) & 1 : P3[part][i]
  const anchor = (sub: number) => sub === 0 ? 0 : ns === 2 ? A2[part] : sub === 1 ? A3a[part] : A3b[part]
  const idx: number[] = [], idx2: number[] = []
  for (let i = 0; i < 16; i++) { const sb = subset(i), anc = anchor(sb) === i; idx.push(rd(anc ? ib - 1 : ib)) }
  if (ib2) for (let i = 0; i < 16; i++) idx2.push(rd(i === 0 ? ib2 - 1 : ib2))
  const lerp = (a: number, b: number, wgt: number) => ((64 - wgt) * a + wgt * b + 32) >> 6
  for (let i = 0; i < 16; i++) {
    const sb = subset(i), e0 = E[sb * 2], e1 = E[sb * 2 + 1]
    let cw: number, aw: number
    if (ib2) { const a = WT[ib][idx[i]], b = WT[ib2][idx2[i]]; if (isel) { cw = b; aw = a } else { cw = a; aw = b } }
    else cw = aw = WT[ib][idx[i]]
    const c = [lerp(e0[0], e1[0], cw), lerp(e0[1], e1[1], cw), lerp(e0[2], e1[2], cw), lerp(e0[3], e1[3], aw)]
    if (rot) { const t = c[3]; c[3] = c[rot - 1]; c[rot - 1] = t }
    put(i, c[0], c[1], c[2], c[3])
  }
}

/** decode the main mip of a colour texture (.edds / .dds) to RGBA */
export function decodeColor(b: Uint8Array): Rgba {
  const info = ddsInfo(b), { width: w, height: h, dxgi } = info, m = mainMip(b, info)
  const px = new Uint8ClampedArray(w * h * 4), bw = Math.ceil(w / 4), bh = Math.ceil(h / 4)
  const bc = dxgi >= 70 && dxgi <= 72 ? 1 : dxgi >= 73 && dxgi <= 75 ? 2 : dxgi >= 76 && dxgi <= 78 ? 3 : dxgi >= 79 && dxgi <= 81 ? 4 : dxgi >= 82 && dxgi <= 84 ? 5 : dxgi >= 97 && dxgi <= 99 ? 7 : 0
  if (bc) {
    const size = bc === 1 || bc === 4 ? 8 : 16
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const p = (by * bw + bx) * size, x0 = bx * 4, y0 = by * 4
      if (p + size > m.length) continue
      if (bc === 1) colourBlock(m, p, px, w, x0, y0, h, true)
      else if (bc === 2) { colourBlock(m, p + 8, px, w, x0, y0, h, false); for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) px[(y * w + x) * 4 + 3] = ((m[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17 } }
      else if (bc === 3) { colourBlock(m, p + 8, px, w, x0, y0, h, false); channelBlock(m, p, px, w, x0, y0, h, 3) }
      else if (bc === 4) { channelBlock(m, p, px, w, x0, y0, h, 0); for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const o = (y * w + x) * 4; px[o + 1] = px[o + 2] = px[o]; px[o + 3] = 255 } } }
      else if (bc === 5) { channelBlock(m, p, px, w, x0, y0, h, 0); channelBlock(m, p + 8, px, w, x0, y0, h, 1); for (let i = 0; i < 16; i++) { const x = x0 + (i & 3), y = y0 + (i >> 2); if (x < w && y < h) { const o = (y * w + x) * 4; px[o + 2] = 128; px[o + 3] = 255 } } }
      else bc7Block(m, p, px, w, x0, y0, h)
    }
  } else if (dxgi === 28 || dxgi === 29 || dxgi === 87 || dxgi === 91 || (!dxgi && info.bitCount === 32)) {
    const bgra = dxgi === 87 || dxgi === 91 || (!dxgi && new DataView(b.buffer, b.byteOffset).getUint32(92, true) === 0xff0000)
    for (let i = 0; i < w * h && i * 4 + 3 < m.length; i++) {
      px[i * 4] = m[i * 4 + (bgra ? 2 : 0)]; px[i * 4 + 1] = m[i * 4 + 1]; px[i * 4 + 2] = m[i * 4 + (bgra ? 0 : 2)]; px[i * 4 + 3] = m[i * 4 + 3]
    }
  } else throw new Error(`DDS: unsupported format (${info.fourcc}, DXGI ${dxgi})`)
  return { width: w, height: h, data: px }
}

/** average colour of a texture (for flat tints / map colours) */
export function meanColor(img: Rgba): [number, number, number] {
  let r = 0, g = 0, b = 0
  const n = img.width * img.height
  for (let i = 0; i < n; i++) { r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2] }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

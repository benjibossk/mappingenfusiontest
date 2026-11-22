// harvest-terrain-middles.ts - vanilla terrain textures for the textured satellite map (port of the idea of
// MapGeneratorPro satmap_v2_textured: tile each surface's BCR "middle" texture, MIT (c) Giorbev; no code copied).
//
//   npx tsx scripts/harvest-terrain-middles.ts [<game dir>]  -> library/terrain-middles.json
//
// Reads the game's .pak files (FORM / FILE index, zlib entries), every "TerrainMaterial" .emat, its
// BCRMiddleMap (else BCRMap) texture, decodes it with src/atelier/formats/edds.ts and keeps a 32 x 32 RGB
// tile (box filter, sRGB as stored) + the mean colour + the metres one tile repeat covers on the ground.
import { closeSync, openSync, readSync, readdirSync, writeFileSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { decodeColor } from '../src/atelier/formats/edds.ts'

const GAME = process.argv[2] ?? 'D:/SteamLibrary/steamapps/common/Arma Reforger'
const OUT = join(import.meta.dirname, '..', 'library', 'terrain-middles.json')
const SIDE = 32

interface Entry { name: string; pak: string; off: number; cs: number; us: number; z: boolean }
function readAt(fd: number, off: number, n: number): Buffer { const b = Buffer.alloc(n); readSync(fd, b, 0, n, off); return b }
function pakIndex(pak: string, into: Map<string, Entry>) {
  const fd = openSync(pak, 'r'), size = fstatSync(fd).size
  let p = 12
  while (p + 8 <= size) {
    const h = readAt(fd, p, 8), tag = h.toString('latin1', 0, 4), len = h.readUInt32BE(4)
    if (tag === 'FILE') {
      const b = readAt(fd, p + 8, len); let q = 0
      const ent = (path: string) => {
        const t = b[q], l = b[q + 1], n = b.toString('utf8', q + 2, q + 2 + l); q += 2 + l
        if (t === 0) { const k = b.readUInt32LE(q); q += 4; for (let i = 0; i < k; i++) ent(path + n + '/') }
        else { into.set((path + n).replace(/^\/+/, '').toLowerCase(), { name: path + n, pak, off: b.readUInt32LE(q), cs: b.readUInt32LE(q + 4), us: b.readUInt32LE(q + 8), z: b[q + 18] !== 0 }); q += 24 }
      }
      ent('')
    }
    p += 8 + len
  }
  closeSync(fd)
}
function read(e: Entry): Uint8Array {
  const fd = openSync(e.pak, 'r'), b = readAt(fd, e.off, e.cs); closeSync(fd)
  return e.z ? inflateSync(b) : b
}

const idx = new Map<string, Entry>()
const dataDir = join(GAME, 'addons', 'data')
for (const f of readdirSync(dataDir).filter((n) => n.endsWith('.pak')).sort()) pakIndex(join(dataDir, f), idx)
console.log('pak entries', idx.size)

const param = (txt: string, k: string) => txt.match(new RegExp(`^\\s*${k}\\s+(.+)$`, 'm'))?.[1].trim()
const resPath = (v?: string) => v?.replace(/^"?\{[0-9A-F]+\}/i, '').replace(/"$/, '').toLowerCase()
const out: Record<string, { mean: number[]; repeat: number; tile: string; src: string }> = {}
let miss = 0
for (const [path, e] of idx) {
  if (!path.endsWith('.emat') || !path.includes('surfaces/')) continue
  const txt = Buffer.from(read(e)).toString('utf8')
  if (!/^\s*TerrainMaterial\s*\{/.test(txt)) continue
  const tex = resPath(param(txt, 'BCRMiddleMap')) ?? resPath(param(txt, 'BCRMap'))
  const te = tex ? idx.get(tex) : undefined
  const name = e.name.split('/').pop()!.replace(/\.emat$/, '')
  if (!te) { miss++; continue }
  let img
  try { img = decodeColor(read(te)) } catch (err) { console.log('skip', name, (err as Error).message); miss++; continue }
  const tile = Buffer.alloc(SIDE * SIDE * 3), sx = img.width / SIDE, sy = img.height / SIDE
  const mean = [0, 0, 0]
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const acc = [0, 0, 0]; let n = 0
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
      const o = (yy * img.width + xx) * 4; acc[0] += img.data[o]; acc[1] += img.data[o + 1]; acc[2] += img.data[o + 2]; n++
    }
    for (let k = 0; k < 3; k++) { const v = Math.round(acc[k] / Math.max(1, n)); tile[(y * SIDE + x) * 3 + k] = v; mean[k] += v }
  }
  // middle textures repeat over large distances: MiddleScaleUV (or 1 / ScaleUV for the detail map) in metres per repeat
  const middle = !!param(txt, 'BCRMiddleMap')
  const repeat = Number(param(txt, middle ? 'MiddleScaleUV' : 'ScaleUV')) || (middle ? 32 : 2)
  out[name] = { mean: mean.map((v) => Math.round(v / (SIDE * SIDE))), repeat: middle ? repeat : 1 / repeat * 8, tile: tile.toString('base64'), src: tex! }
}
writeFileSync(OUT, JSON.stringify({ source: 'harvest-terrain-middles.ts', side: SIDE, surfaces: out }))
console.log('wrote', Object.keys(out).length, 'surfaces, missing', miss, '->', OUT)

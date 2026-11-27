// Heights of a "map from an image" (headless): min / max / mean, and the roles the picture got.
// npx tsx scripts/bench/image-relief.ts <raw RGBA> <width> <height> <size m>
import { readFileSync } from 'node:fs'
import { clusterImage, guessRoles, imageToMap } from '../../src/modules/imageMap.ts'

const [file, W, H, S] = process.argv.slice(2)
const q = clusterImage({ width: +W, height: +H, data: new Uint8Array(readFileSync(file)) })
const roles = guessRoles(q)
console.log('roles:', roles.map((r, i) => `${r.role}${r.height != null ? '@' + r.height : ''} ${(q.share[i] * 100).toFixed(0)}%`).join(', '))
const r = imageToMap(q, roles, { size: +S })
let lo = Infinity, hi = -Infinity, s = 0
for (const v of r.heights.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); s += v }
console.log(`heights ${lo.toFixed(1)} .. ${hi.toFixed(1)} m, mean ${(s / r.heights.data.length).toFixed(1)} m; waters ${r.waters.length}, forests ${r.areas.filter((a) => a.kind === 'forest').length}`)

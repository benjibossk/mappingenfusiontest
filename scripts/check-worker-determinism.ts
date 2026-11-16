// npx tsx scripts/check-worker-determinism.ts [size] [seed]
// The worker path = pack -> structured clone -> unpack around the same pure op. Its result must hash
// exactly like the direct (main-thread) call: same doubles, same order.
import '../src/workers/shim'
import { createHash } from 'node:crypto'
import { OPS } from '../src/workers/ops'
import { pack, unpack } from '../src/workers/pack'

const size = Number(process.argv[2] ?? 2048), seed = Number(process.argv[3] ?? 7)
const params = { seed, size, towns: 1, villages: 1, hamlets: 1, industry: 1, military: 1, airfield: true, power: true, forests: 1 }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x as Float32Array) : x))).digest('hex').slice(0, 16)
async function main() {
  const direct = await OPS.world([params], () => {})
  const tr: Transferable[] = []
  const viaArgs = unpack(structuredClone(pack([params], []))) as unknown[]
  const res = await OPS.world(viaArgs, () => {})
  const back = unpack(structuredClone(pack(res, tr), { transfer: tr }))
  const a = hash(direct), b = hash(back)
  console.log(`world ${size} seed ${seed}: direct ${a} worker-path ${b} ${a === b ? 'IDENTICAL' : 'DIFFERENT'}`)
  const isl = { size, step: Math.max(4, size / 512), maxHeight: 300, seaDepth: 40, landRatio: 0.5, roughness: 0.5, seed, islands: 1 }
  const i1 = hash(await OPS.island([isl], () => {})), i2 = hash(unpack(structuredClone(pack(await OPS.island(unpack(structuredClone(pack([isl], []))) as unknown[], () => {}), []))))
  console.log(`island: ${i1} ${i2} ${i1 === i2 ? 'IDENTICAL' : 'DIFFERENT'}`)
  if (a !== b || i1 !== i2) process.exit(1)
}
main()

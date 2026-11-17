// Generator worker: runs one heavy pure op off the main thread, so the busy panel keeps painting.
// in:  { id, op, args }   out: { id, progress: {stage, i, n, f} } ... then { id, ok: result } or { id, err }
import './shim'
import { OPS, type Op } from './ops'
import { pack, unpack } from './pack'
import { enabledMods, setEnabledMods } from '../library/mods'
import '../data/modBuildings' // ticked mods' buildings join BUILDINGS / INDUSTRIAL (off by default)

self.onmessage = async (e: MessageEvent<{ id: number; op: Op; args: unknown[]; mods?: string[] }>) => {
  const { id, op, args } = e.data
  const mods = e.data.mods ?? []
  if (mods.join() !== enabledMods().join()) setEnabledMods(mods)
  try {
    let last = 0
    const res = await OPS[op](unpack(args) as unknown[], (stage, i, n, f) => {
      const now = performance.now()
      if (f !== undefined && f > 0 && now - last < 100) return // sub-stage ticks: at most 10 a second
      last = now
      self.postMessage({ id, progress: { stage, i, n, f } })
    })
    const tr: Transferable[] = []
    const ok = pack(res, tr)
    ;(self as unknown as Worker).postMessage({ id, ok }, tr)
  } catch (err) {
    self.postMessage({ id, err: (err as Error)?.message ?? String(err) })
  }
}

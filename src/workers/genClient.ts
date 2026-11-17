// Main-thread side of the generator worker. runGen(op, args, {progress}) -> Promise of the result.
// One worker per job (terminate() is the only real way to stop a busy one); cancel() rejects with Cancelled
// and nothing is applied. When a worker cannot be made (old browser, file://), the op runs here instead.
import { OPS, type Op, type Progress } from './ops'
import { enabledMods } from '../library/mods'
import { pack, unpack } from './pack'
import { Cancelled } from '../modules/worldgen'

export interface GenJob<T> { promise: Promise<T>; cancel: () => void; inWorker: boolean }
let noWorker = false
let nextId = 1

export function runGen<T = unknown>(op: Op, args: unknown[], o: { progress?: Progress } = {}): GenJob<T> {
  let w: Worker | null = null
  if (!noWorker && typeof Worker !== 'undefined') {
    try { w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' }) } catch { noWorker = true; w = null }
  }
  if (!w) {
    // fallback: same function on the main thread (cancel only takes effect between world stages)
    let stop = false
    const promise = (async () => {
      const r = await OPS[op](args, (s, i, n, f) => { if (stop) throw new Cancelled(); o.progress?.(s, i, n, f) })
      if (stop) throw new Cancelled()
      return r as T
    })()
    return { promise, cancel: () => { stop = true }, inWorker: false }
  }
  const worker = w, id = nextId++
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    reject = rej
    worker.onmessage = (e) => {
      const d = e.data
      if (d.id !== id) return
      if (d.progress) return void o.progress?.(d.progress.stage, d.progress.i, d.progress.n, d.progress.f)
      worker.terminate()
      if ('ok' in d) res(unpack(d.ok) as T)
      else rej(new Error(d.err))
    }
    worker.onerror = (e) => {
      worker.terminate()
      e.preventDefault()
      // a worker that fails to load (module error, CSP): run it here from now on
      noWorker = true
      const j = runGen<T>(op, args, o)
      j.promise.then(res, rej)
    }
    // the arguments are copied (not transferred): the page keeps using its own heights
    worker.postMessage({ id, op, args: pack(args, []), mods: enabledMods() })
  })
  return { promise, cancel: () => { worker.terminate(); reject(new Cancelled()) }, inWorker: true }
}

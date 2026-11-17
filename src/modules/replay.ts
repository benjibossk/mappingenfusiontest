// Replayable pipeline (P5): every generation step of a project is recorded (step id, parameters, seed,
// inputs, timings, output hashes) in the project file; "Replay all" re-runs them in order from scratch.
// Steps are deterministic (seeded), so a replay must give the same output hashes.
import type { WorldResult } from './worldgen'

export interface PipelineStep {
  /** step kind: 'world' = full world pipeline (relief -> water -> sites -> roads -> villages -> power -> forests -> fields) */
  id: string
  params: Record<string, unknown>
  seed: number
  /** ids of the steps (or imported data) this one reads; [] = from scratch */
  inputs: string[]
  /** total run time (ms) of the last run */
  ms?: number
  /** run time (ms) of each stage of the last run */
  stages?: Record<string, number>
  /** output hashes of the last run (hashWorld) */
  hash?: Record<string, string>
}
export interface Pipeline { version: 1; steps: PipelineStep[] }

export const emptyPipeline = (): Pipeline => ({ version: 1, steps: [] })

/** a pipeline read back from a project file (anything malformed is dropped) */
export function readPipeline(v: unknown): Pipeline {
  const p = emptyPipeline()
  const steps = (v as { steps?: unknown })?.steps
  if (!Array.isArray(steps)) return p
  for (const s of steps) {
    if (!s || typeof s.id !== 'string' || typeof s.params !== 'object' || !s.params) continue
    p.steps.push({ id: s.id, params: { ...s.params }, seed: Math.floor(Number(s.seed)) || 1, inputs: Array.isArray(s.inputs) ? s.inputs.map(String) : [], ms: s.ms, stages: s.stages, hash: s.hash })
  }
  return p
}

/** append a step; a step with no inputs rebuilds the map from scratch, so it replaces everything before it */
export function recordStep(p: Pipeline, s: PipelineStep): Pipeline {
  return { version: 1, steps: s.inputs.length ? [...p.steps, s] : [s] }
}

/** stable 32-bit FNV-1a hash of a value (keys sorted, numbers rounded to 1 mm so float noise in printing never counts) */
export function hashOf(v: unknown): string {
  let h = 0x811c9dc5
  const put = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } }
  const walk = (x: unknown): void => {
    if (x === null || x === undefined) { put('~'); return }
    if (typeof x === 'number') { put(Number.isFinite(x) ? String(Math.round(x * 1000)) : String(x)); put(','); return }
    if (typeof x === 'string') { put(JSON.stringify(x)); return }
    if (typeof x === 'boolean') { put(x ? 'T' : 'F'); return }
    if (ArrayBuffer.isView(x)) { walk(Array.from(x as unknown as ArrayLike<number>)); return }
    if (Array.isArray(x)) { put('['); for (const y of x) walk(y); put(']'); return }
    if (typeof x === 'object') {
      put('{')
      for (const k of Object.keys(x as object).sort()) { put(k); put(':'); walk((x as Record<string, unknown>)[k]) }
      put('}')
      return
    }
    put(String(x))
  }
  walk(v)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** one hash per output layer of a world run */
export function hashWorld(w: WorldResult): Record<string, string> {
  return {
    relief: hashOf(w.heights), water: hashOf(w.waters), sites: hashOf(w.sites), roads: hashOf(w.roads),
    zones: hashOf(w.zones), villages: hashOf(w.settlement), power: hashOf(w.power), forests: hashOf(w.areas),
    fields: hashOf(w.campaign ?? null), surfaces: hashOf(w.surfaces),
  }
}
export const sameHash = (a?: Record<string, string>, b?: Record<string, string>) => !!a && !!b && hashOf(a) === hashOf(b)

/** per-stage timings from the progress callback: call tick(stage) on each event, end() once finished */
export function stageTimer(now: () => number = () => performance.now()) {
  const ms: Record<string, number> = {}
  let cur: string | undefined, since = now()
  const close = () => { if (cur) ms[cur] = (ms[cur] ?? 0) + (now() - since) }
  return {
    tick(s: string) { if (s === cur) return; close(); cur = s; since = now() },
    end() { close(); cur = undefined; for (const k in ms) ms[k] = Math.round(ms[k]); return ms },
    get ms() { return ms },
  }
}

export interface ReplayReport { id: string; ms: number; same: boolean | undefined; hash: Record<string, string> }
/** re-run every step in order; run() executes one step and returns its fresh output hashes */
export async function replayPipeline(p: Pipeline, run: (s: PipelineStep, i: number, n: number) => Promise<Record<string, string> | undefined>, now: () => number = () => performance.now()): Promise<ReplayReport[] | undefined> {
  const out: ReplayReport[] = []
  for (let i = 0; i < p.steps.length; i++) {
    const s = p.steps[i], t0 = now()
    const hash = await run(s, i, p.steps.length)
    if (!hash) return undefined // cancelled
    out.push({ id: s.id, ms: Math.round(now() - t0), same: s.hash ? sameHash(s.hash, hash) : undefined, hash })
  }
  return out
}

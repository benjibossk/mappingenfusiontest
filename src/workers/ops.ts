// The pure generators the worker can run (also run on the main thread when no worker can be made).
// Each op takes plain (cloneable) arguments and may report progress(stage, i, n, f).
import { generateWorld, type WorldParams } from '../modules/worldgen'
import { generateIsland } from '../modules/island'
import { computeRivers } from '../modules/hydro'
import { buildNetwork } from '../modules/network'
import { settleVillages } from '../modules/village'
import { routePowerLine } from '../modules/power'
import { generateForests } from '../modules/forestgen'
import { quantise } from '../modules/satmask'

export type Progress = (stage: string, i: number, n: number, f?: number) => void
type Fn = (args: any[], progress: Progress) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any

export const OPS = {
  world: ((a, progress) => generateWorld(a[0] as WorldParams, { progress })) as Fn,
  island: ((a) => generateIsland(a[0])) as Fn,
  rivers: ((a) => computeRivers(a[0], a[1], a[2], a[3], a[4])) as Fn,
  network: ((a, progress) => buildNetwork(a[0], a[1], a[2], a[3], { ...a[4], progress: (f: number) => progress('roads', 0, 1, f) }, a[5])) as Fn,
  villages: ((a) => settleVillages(a[0], a[1], a[2], a[3], a[4], a[5], a[6])) as Fn,
  power: ((a) => routePowerLine(...(a as Parameters<typeof routePowerLine>))) as Fn,
  forests: ((a) => generateForests(a[0], a[1], a[2])) as Fn,
  quantise: ((a) => quantise(a[0], a[1])) as Fn,
}
export type Op = keyof typeof OPS

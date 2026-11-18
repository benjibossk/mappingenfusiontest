// Versioned JSON contract of the soil engine (PLAN_GIORBEV Phase 3).
// Shared by the app and the bridge: plain data + a dependency-free validator.
import type { Project } from '../project.ts'

export const CONTRACT_VERSION = 1 as const

/** regular grid, same layout as a /masks surface (row-major, row = Z, col = X) */
export interface Grid { minX: number; minZ: number; step: number; cols: number; rows: number }
export interface Heightmap extends Grid { heights: number[] }
/** flat world X/Z pairs [x0, z0, x1, z1, ...] (same as ProjectShape.points) */
export type Points = number[]

export interface Lake { points: Points; level: number }
export interface River { points: Points; width: number; depth?: number }
export interface Water { seaLevel: number | null; lakes: Lake[]; rivers: River[] }
export interface Road { points: Points; type: string; width: number }
export interface Zone { id: string; kind: string; points: Points }
export interface MaterialBudget { maxMaterials: number; maxPerBlock: number }

export interface ContractInput {
  version: typeof CONTRACT_VERSION
  heightmap: Heightmap
  water: Water
  roads: Road[]
  zones: Zone[]
  biome: string
  budget: MaterialBudget
}

/** one material mask = one /masks surface entry */
export interface MaterialMask extends Grid { name: string; weights: number[] }
export type GeneratorKind = 'forest' | 'hedge' | 'meadow' | 'scrub' | 'riparian' | string
export interface VegetationZone { points: Points; generator: GeneratorKind; prefab?: string }
export interface BudgetReport {
  materialsUsed: number
  maxPerBlockSeen: number
  /** blocks (by index) exceeding budget.maxPerBlock */
  overBlocks: number[]
  ok: boolean
}
export interface ContractOutput {
  version: typeof CONTRACT_VERSION
  masks: MaterialMask[]
  vegetation: VegetationZone[]
  budget: BudgetReport
}

// ---------- validator ----------
export interface ValidationResult { ok: boolean; errors: string[] }
type Err = string[]
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(o: Record<string, unknown>, k: string, p: string, e: Err, min?: number) {
  const v = o[k]
  if (!isNum(v)) e.push(`${p}.${k}: number expected`)
  else if (min !== undefined && v < min) e.push(`${p}.${k}: must be >= ${min}`)
}
function int(o: Record<string, unknown>, k: string, p: string, e: Err, min: number) {
  const v = o[k]
  if (!Number.isInteger(v) || (v as number) < min) e.push(`${p}.${k}: integer >= ${min} expected`)
}
function points(v: unknown, p: string, e: Err, minPts = 2) {
  if (!Array.isArray(v) || v.length % 2 !== 0 || !v.every(isNum)) { e.push(`${p}: flat X/Z number pairs expected`); return }
  if (v.length / 2 < minPts) e.push(`${p}: at least ${minPts} points expected`)
}
function grid(o: Record<string, unknown>, p: string, e: Err, arrKey: string) {
  num(o, 'minX', p, e); num(o, 'minZ', p, e)
  const s = o.step
  if (!isNum(s) || s <= 0) e.push(`${p}.step: number > 0 expected`)
  int(o, 'cols', p, e, 1); int(o, 'rows', p, e, 1)
  const a = o[arrKey]
  if (!Array.isArray(a) || !a.every(isNum)) { e.push(`${p}.${arrKey}: number array expected`); return }
  if (Number.isInteger(o.cols) && Number.isInteger(o.rows) && a.length !== (o.cols as number) * (o.rows as number))
    e.push(`${p}.${arrKey}: length ${a.length} != cols*rows`)
}
function version(o: Record<string, unknown>, e: Err) {
  if (o.version !== CONTRACT_VERSION) e.push(`version: ${CONTRACT_VERSION} expected, got ${String(o.version)}`)
}
function list(v: unknown, p: string, e: Err, each: (x: Record<string, unknown>, p: string) => void) {
  if (!Array.isArray(v)) { e.push(`${p}: array expected`); return }
  v.forEach((x, i) => (isObj(x) ? each(x, `${p}[${i}]`) : e.push(`${p}[${i}]: object expected`)))
}

export function validateInput(v: unknown): ValidationResult {
  const e: Err = []
  if (!isObj(v)) return { ok: false, errors: ['input: object expected'] }
  version(v, e)
  if (isObj(v.heightmap)) grid(v.heightmap, 'heightmap', e, 'heights'); else e.push('heightmap: object expected')
  const w = v.water
  if (!isObj(w)) e.push('water: object expected')
  else {
    if (w.seaLevel !== null && !isNum(w.seaLevel)) e.push('water.seaLevel: number or null expected')
    list(w.lakes, 'water.lakes', e, (l, p) => { points(l.points, `${p}.points`, e, 3); num(l, 'level', p, e) })
    list(w.rivers, 'water.rivers', e, (r, p) => {
      points(r.points, `${p}.points`, e); num(r, 'width', p, e, 0)
      if (r.depth !== undefined) num(r, 'depth', p, e, 0)
    })
  }
  list(v.roads, 'roads', e, (r, p) => {
    points(r.points, `${p}.points`, e); num(r, 'width', p, e, 0)
    if (typeof r.type !== 'string') e.push(`${p}.type: string expected`)
  })
  list(v.zones, 'zones', e, (z, p) => {
    points(z.points, `${p}.points`, e, 3)
    if (typeof z.id !== 'string') e.push(`${p}.id: string expected`)
    if (typeof z.kind !== 'string') e.push(`${p}.kind: string expected`)
  })
  if (typeof v.biome !== 'string' || !v.biome) e.push('biome: non-empty string expected')
  if (isObj(v.budget)) { int(v.budget, 'maxMaterials', 'budget', e, 1); int(v.budget, 'maxPerBlock', 'budget', e, 1) }
  else e.push('budget: object expected')
  return { ok: e.length === 0, errors: e }
}

export function validateOutput(v: unknown): ValidationResult {
  const e: Err = []
  if (!isObj(v)) return { ok: false, errors: ['output: object expected'] }
  version(v, e)
  const names = new Set<string>()
  list(v.masks, 'masks', e, (m, p) => {
    if (typeof m.name !== 'string' || !m.name) e.push(`${p}.name: non-empty string expected`)
    else if (names.has(m.name)) e.push(`${p}.name: duplicate "${m.name}"`)
    else names.add(m.name)
    grid(m, p, e, 'weights')
    if (Array.isArray(m.weights) && m.weights.some((x) => isNum(x) && (x < 0 || x > 1))) e.push(`${p}.weights: values in [0,1] expected`)
  })
  list(v.vegetation, 'vegetation', e, (z, p) => {
    points(z.points, `${p}.points`, e, 3)
    if (typeof z.generator !== 'string' || !z.generator) e.push(`${p}.generator: non-empty string expected`)
  })
  const b = v.budget
  if (!isObj(b)) e.push('budget: object expected')
  else {
    int(b, 'materialsUsed', 'budget', e, 0); int(b, 'maxPerBlockSeen', 'budget', e, 0)
    if (!Array.isArray(b.overBlocks) || !b.overBlocks.every(Number.isInteger)) e.push('budget.overBlocks: integer array expected')
    if (typeof b.ok !== 'boolean') e.push('budget.ok: boolean expected')
  }
  return { ok: e.length === 0, errors: e }
}

// ---------- adapters ----------
/** build a contract budget report: blocks of `blockCells` cells, a material counts in a block if any weight > eps */
export function budgetReport(masks: MaterialMask[], budget: MaterialBudget, blockCells = 32, eps = 1e-3): BudgetReport {
  const used = masks.filter((m) => m.weights.some((w) => w > eps))
  const overBlocks: number[] = []
  let maxSeen = 0
  if (used.length) {
    const { cols, rows } = used[0]
    const bc = Math.ceil(cols / blockCells), br = Math.ceil(rows / blockCells)
    for (let by = 0; by < br; by++) for (let bx = 0; bx < bc; bx++) {
      let n = 0
      for (const m of used) {
        let hit = false
        for (let r = by * blockCells; r < Math.min(rows, (by + 1) * blockCells) && !hit; r++)
          for (let c = bx * blockCells; c < Math.min(cols, (bx + 1) * blockCells); c++)
            if (m.weights[r * cols + c] > eps) { hit = true; break }
        if (hit) n++
      }
      if (n > maxSeen) maxSeen = n
      if (n > budget.maxPerBlock) overBlocks.push(by * bc + bx)
    }
  }
  return { materialsUsed: used.length, maxPerBlockSeen: maxSeen, overBlocks, ok: used.length <= budget.maxMaterials && overBlocks.length === 0 }
}

export interface ToInputOptions {
  heightmap: Heightmap
  biome: string
  seaLevel?: number | null
  budget?: Partial<MaterialBudget>
  zones?: Zone[]
}
const LAKE_RE = /WEGenerators\/Water\/Lake\//i
const RIVER_RE = /WEGenerators\/Water\/River\//i
const ROAD_RE = /WEGenerators\/Roads?\//i

/** adapt an app Project (shapes) to a contract input; lakes/rivers/roads are recognised by generator path */
export function toContractInput(project: Project, o: ToInputOptions): ContractInput {
  const lakes: Lake[] = [], rivers: River[] = [], roads: Road[] = []
  for (const s of project.shapes) {
    const param = (k: string) => { const i = s.paramKeys?.indexOf(k) ?? -1; return i >= 0 ? Number(s.paramValues?.[i]) : NaN }
    if (LAKE_RE.test(s.generator)) lakes.push({ points: s.points, level: s.lift?.[0] ?? 0 })
    else if (RIVER_RE.test(s.generator)) rivers.push({ points: s.points, width: Number.isFinite(param('RiverWidth')) ? param('RiverWidth') : 6 })
    else if (ROAD_RE.test(s.generator)) {
      const name = s.generator.split('/').pop()?.replace(/\.et$/, '') ?? 'road'
      roads.push({ points: s.points, type: name, width: Number.isFinite(param('RoadWidth')) ? param('RoadWidth') : 6 })
    }
  }
  return {
    version: CONTRACT_VERSION, heightmap: o.heightmap,
    water: { seaLevel: o.seaLevel ?? null, lakes, rivers }, roads, zones: o.zones ?? [], biome: o.biome,
    budget: { maxMaterials: o.budget?.maxMaterials ?? 16, maxPerBlock: o.budget?.maxPerBlock ?? 4 },
  }
}

/** contract masks -> bridge POST /masks `surfaces` (identical layout) */
export const toMasksPayload = (out: ContractOutput) => out.masks.map(({ name, minX, minZ, step, cols, rows, weights }) => ({ name, minX, minZ, step, cols, rows, weights }))

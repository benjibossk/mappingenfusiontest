// Compare our soil masks with MGP's (docs/PLAN_GIORBEV.md Phase 3 "Banc de comparaison").
// Usage: node --import ./tests/library/resolve-ts.mjs scripts/compare-mgp.ts <ours.json> <mgpDir|mgp.json>
//   ours.json : a ContractOutput (or {masks:[...]}) as written by the soil engine.
//   MGP side  : either the same JSON shape, or a folder with meta.json {cols, rows} and one
//               <MaterialName>.raw per material (8-bit grayscale, row-major, 0..255 = weight 0..1).
//               (PNG is not read: pngjs is not a dependency; export MGP masks as .raw.)
// Prints % cells with the same dominant texture, mean absolute weight error, blocks over budget.
// Pass/fail thresholds come from src/soil/rules/thresholds.json ("compare").
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { budgetReport, type MaterialMask } from '../src/contract/schema.ts'
import thresholds from '../src/soil/rules/thresholds.json' with { type: 'json' }

interface MaskSet { cols: number; rows: number; masks: Map<string, ArrayLike<number>> }

function loadJson(file: string): MaskSet {
  const j = JSON.parse(readFileSync(file, 'utf8')) as { masks: MaterialMask[] }
  const m0 = j.masks[0]
  return { cols: m0.cols, rows: m0.rows, masks: new Map(j.masks.map((m) => [m.name, m.weights])) }
}
function loadRawDir(dir: string): MaskSet {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { cols: number; rows: number }
  const masks = new Map<string, ArrayLike<number>>()
  for (const f of readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.raw')) {
    const b = readFileSync(join(dir, f))
    if (b.length !== meta.cols * meta.rows) throw new Error(`${f}: ${b.length} bytes != cols*rows`)
    masks.set(basename(f, extname(f)), Float32Array.from(b, (x) => x / 255))
  }
  return { ...meta, masks }
}
const load = (p: string) => (statSync(p).isDirectory() ? loadRawDir(p) : loadJson(p))

/** nearest-neighbour sample of set b at the position of cell (c, r) of grid a */
function sampler(a: MaskSet, b: MaskSet) {
  return (w: ArrayLike<number>, c: number, r: number) =>
    w[Math.min(b.rows - 1, Math.floor((r * b.rows) / a.rows)) * b.cols + Math.min(b.cols - 1, Math.floor((c * b.cols) / a.cols))]
}

export function compare(ours: MaskSet, mgp: MaskSet) {
  const names = [...new Set([...ours.masks.keys(), ...mgp.masks.keys()])].sort()
  const at = sampler(ours, mgp), zero = { length: 0 } as ArrayLike<number>
  let same = 0, err = 0, n = 0
  for (let r = 0; r < ours.rows; r++) for (let c = 0; c < ours.cols; c++) {
    const i = r * ours.cols + c
    let bo = -1, bm = -1, ko = '', km = ''
    for (const nm of names) {
      const wo = (ours.masks.get(nm) ?? zero)[i] ?? 0
      const wm = mgp.masks.has(nm) ? at(mgp.masks.get(nm)!, c, r) : 0
      if (wo > bo) { bo = wo; ko = nm }
      if (wm > bm) { bm = wm; km = nm }
      err += Math.abs(wo - wm)
    }
    if (ko === km) same++
    n++
  }
  return { sameDominantPct: (100 * same) / n, meanWeightError: err / (n * names.length) }
}
function overBlocks(s: MaskSet, maxPerBlock: number): number {
  const masks: MaterialMask[] = [...s.masks].map(([name, w]) => ({ name, minX: 0, minZ: 0, step: 1, cols: s.cols, rows: s.rows, weights: Array.from(w) }))
  return budgetReport(masks, { maxMaterials: masks.length, maxPerBlock }, thresholds.blockCells).overBlocks.length
}

if (process.argv[1] && basename(process.argv[1]).startsWith('compare-mgp')) {
  const [a, b, per] = process.argv.slice(2)
  if (!a || !b) { console.error('usage: compare-mgp.ts <ours.json> <mgpDir|mgp.json> [maxPerBlock=4]'); process.exit(2) }
  const ours = load(a), mgp = load(b), max = Number(per ?? 4), t = thresholds.compare
  const r = compare(ours, mgp), ob = overBlocks(ours, max), obm = overBlocks(mgp, max)
  console.log(`same dominant texture : ${r.sameDominantPct.toFixed(1)} % (min ${t.minSameDominantPct})`)
  console.log(`mean weight error     : ${r.meanWeightError.toFixed(3)} (max ${t.maxMeanWeightError})`)
  console.log(`blocks over budget    : ours ${ob}, MGP ${obm} (max ${t.maxOverBlocks})`)
  const ok = r.sameDominantPct >= t.minSameDominantPct && r.meanWeightError <= t.maxMeanWeightError && ob <= t.maxOverBlocks
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

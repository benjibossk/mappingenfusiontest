// Land-cover benchmark: forests, fields and ground surfaces of a generated world vs the vanilla statistics
// (Everon refmap forests + PakTools/analyses/FIELDS_SURFACES_VANILLA.json).
//   npx tsx scripts/bench/landcover.ts [seed=42] [size=4096] [--json out.json] [--set forests=1.2]
// Scores 0..100: 100 * min(a, b) / max(a, b) per ratio metric, KS for distributions; total = mean.
import '../../src/workers/shim'
import { readFileSync, writeFileSync } from 'node:fs'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen'
import type { RefMap } from '../../src/modules/refMap'
import { refHeights } from '../../src/modules/refMap'
import { CROP_COVER } from '../../src/modules/fieldlayout'

const args = process.argv.slice(2)
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(pos[0] ?? 42), size = Number(pos[1] ?? 4096)
const VAN = process.env.RM_VANILLA_STATS ?? 'C:/Users/benbo/tools/PakTools/analyses/FIELDS_SURFACES_VANILLA.json'
const fsv = JSON.parse(readFileSync(VAN, 'utf8')).Eden
const ref: RefMap = JSON.parse(readFileSync(new URL('../../public/refmaps/everon.json', import.meta.url), 'utf8'))

// ---- polygon helpers ----------------------------------------------------------------------------------
const area = (p: number[]) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1] } return Math.abs(a) / 2 }
const perim = (p: number[]) => { let L = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; L += Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]) } return L }
/** oriented min box by testing every edge direction: long, short, rectangularity */
function obox(p: number[]) {
  let best = { A: Infinity, l: 0, s: 0 }
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length, a = Math.atan2(p[j + 1] - p[i + 1], p[j] - p[i]), c = Math.cos(a), s = Math.sin(a)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (let k = 0; k < p.length; k += 2) { const u = p[k] * c + p[k + 1] * s, v = -p[k] * s + p[k + 1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v) }
    const A = (u1 - u0) * (v1 - v0); if (A < best.A) best = { A, l: Math.max(u1 - u0, v1 - v0), s: Math.min(u1 - u0, v1 - v0) }
  }
  return { long: best.l, short: best.s, aspect: best.l / Math.max(1, best.s), rect: area(p) / Math.max(1, best.A) }
}
const q = (a: number[], f: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2) : NaN }
const ratio = (a: number, b: number) => (a > 0 && b > 0 ? +(100 * Math.min(a, b) / Math.max(a, b)).toFixed(1) : 0)
/** score of a [p10, med, p90] triple against the vanilla one (mean ratio) */
const tri = (v: { p10: number; med: number; p90: number }, g: number[]) => +((ratio(v.p10, q(g, 0.1)) + ratio(v.med, q(g, 0.5)) + ratio(v.p90, q(g, 0.9))) / 3).toFixed(1)
const flat = (pp: number[][]) => pp.flat()

// ---- vanilla forests (Everon refmap polygons) -------------------------------------------------------
const rh = refHeights(ref.heights!), hb = ref.heights!
let vLand = 0; for (const h of rh) if (h > 0) vLand++
const vLandHa = vLand * hb.step * hb.step / 1e4
const vF = (ref.forests as { pts: number[]; holes?: number[][]; leaf?: string; kind?: string }[])
const vNet = (f: { pts: number[]; holes?: number[][] }) => area(f.pts) - (f.holes ?? []).reduce((a, h) => a + area(h), 0)
const vForestHa = vF.reduce((a, f) => a + vNet(f), 0) / 1e4
const vFa = vF.map((f) => vNet(f) / 1e4)
const vEdge = vF.reduce((a, f) => a + perim(f.pts), 0) / 1000
const vLeaf: Record<string, number> = {}; for (const f of vF) { const k = f.leaf ?? (f as { type?: string }).type ?? '?'; vLeaf[k] = (vLeaf[k] ?? 0) + 1 }

// ---- our world ----------------------------------------------------------------------------------------
const P: Record<string, unknown> = { ...WORLD_DEFAULTS, seed, size, vanillaSites: true, villageTemplates: true }
for (let i = 0; i < args.length; i++) if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); P[k] = Number.isNaN(Number(v)) ? v : Number(v) }
const t0 = Date.now()
const w = await generateWorld(P as never) as never as {
  grid: { step: number; cols: number; rows: number }; heights: number[]; areas: { kind: string; leaf?: string; pts: number[] }[]
  campaign?: { fields: number[][][]; crops: string[] }; sites: { kind: string }[]; surfaces: { name: string; weights: ArrayLike<number> }[]; roads: { pts: number[] }[]
}
const sec = (Date.now() - t0) / 1000
let gLand = 0; for (const h of w.heights) if (h > 0) gLand++
const gLandHa = gLand * w.grid.step * w.grid.step / 1e4
// a massif is >= 0.5 ha like the vanilla outlines; smaller polygons are groves (vanilla: trees outside the massifs)
const gAll = w.areas.filter((a) => a.kind === 'forest'), gF = gAll.filter((a) => area(a.pts) >= 5000), gGroves = gAll.length - gF.length
const gForestHa = gF.reduce((a, f) => a + area(f.pts), 0) / 1e4
const gFa = gF.map((f) => area(f.pts) / 1e4)
const gEdge = gF.reduce((a, f) => a + perim(f.pts), 0) / 1000
const gLeaf: Record<string, number> = {}; for (const f of gF) gLeaf[f.leaf ?? '?'] = (gLeaf[f.leaf ?? '?'] ?? 0) + 1
const share = (o: Record<string, number>) => { const n = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / n).toFixed(2)])) }
const leafScore = (() => { const a = share(vLeaf), b = share(gLeaf); let s = 0; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) s += Math.min(a[k] ?? 0, b[k] ?? 0); return +(100 * s).toFixed(1) })()
const forests = {
  coverPct: [+(100 * vForestHa / vLandHa).toFixed(1), +(100 * gForestHa / gLandHa).toFixed(1)],
  perKm2: [+(vF.length / vLandHa * 100).toFixed(2), +(gF.length / gLandHa * 100).toFixed(2)],
  areaHa: [[q(vFa, 0.1), q(vFa, 0.5), q(vFa, 0.9)], [q(gFa, 0.1), q(gFa, 0.5), q(gFa, 0.9)]],
  edgeKmPerKm2: [+(vEdge / vLandHa * 100).toFixed(2), +(gEdge / gLandHa * 100).toFixed(2)],
  leaf: [share(vLeaf), share(gLeaf)],
  grovesPerKm2: +(gGroves / gLandHa * 100).toFixed(2),
}
const forestScores = {
  cover: ratio(forests.coverPct[0], forests.coverPct[1]), count: ratio(forests.perKm2[0], forests.perKm2[1]),
  size: tri({ p10: q(vFa, 0.1), med: q(vFa, 0.5), p90: q(vFa, 0.9) }, gFa), edge: ratio(forests.edgeKmPerKm2[0], forests.edgeKmPerKm2[1]), leaf: leafScore,
}

// ---- fields -------------------------------------------------------------------------------------------
const fv = [fsv.fields.Crop_Field_01, fsv.fields.Crop_Field_02]
const vFieldN = fv[0].n + fv[1].n, vFieldHa = fv[0].totalHa + fv[1].totalHa
// vanilla counts the Crop_Field painted components >= 0.5 ha: same filter on ours (meadows / orchards are painted grass)
const allF = (w.campaign?.fields ?? []).map((f, i) => ({ p: flat(f), c: w.campaign?.crops?.[i] ?? 'wheat' }))
const cropF = allF.filter((f) => CROP_COVER[f.c as keyof typeof CROP_COVER] && area(f.p) >= 5000)
const gFields = cropF.map((f) => f.p)
const gCrops = allF.map((f) => f.c)
const gFA = gFields.map((p) => area(p) / 1e4), gBox = gFields.map(obox)
// fields are laid around the settlements: compare per village (vanilla: 31 places with >= 8 houses) as well as per km2
const vVill = fsv.villages as number, gVill = Math.max(1, w.sites.filter((s) => s.kind === 'village' || s.kind === 'town').length)
const fields = {
  perVillage: [+(vFieldN / vVill).toFixed(2), +(gFields.length / gVill).toFixed(2)],
  haPerVillage: [+(vFieldHa / vVill).toFixed(1), +(gFA.reduce((a, b) => a + b, 0) / gVill).toFixed(1)],
  perKm2: [+(vFieldN / vLandHa * 100).toFixed(2), +(gFields.length / gLandHa * 100).toFixed(2)],
  coverPct: [+(100 * vFieldHa / vLandHa).toFixed(1), +(100 * gFA.reduce((a, b) => a + b, 0) / gLandHa).toFixed(1)],
  areaHa: [fv[0].area_ha, [q(gFA, 0.1), q(gFA, 0.5), q(gFA, 0.9)]],
  aspect: [fv[0].aspect, [q(gBox.map((b) => b.aspect), 0.1), q(gBox.map((b) => b.aspect), 0.5), q(gBox.map((b) => b.aspect), 0.9)]],
  rect: [fv[0].rect, [q(gBox.map((b) => b.rect), 0.1), q(gBox.map((b) => b.rect), 0.5), q(gBox.map((b) => b.rect), 0.9)]],
  cropPainted: { Crop_Field_01: +(cropF.filter((f) => CROP_COVER[f.c as keyof typeof CROP_COVER] === 4).length / Math.max(1, cropF.length)).toFixed(2), Crop_Field_02: +(cropF.filter((f) => CROP_COVER[f.c as keyof typeof CROP_COVER] === 8).length / Math.max(1, cropF.length)).toFixed(2) },
  crops: share(gCrops.reduce((a, c) => { a[c] = (a[c] ?? 0) + 1; return a }, {} as Record<string, number>)),
  vanillaCrops: { Crop_Field_01: +(fv[0].n / vFieldN).toFixed(2), Crop_Field_02: +(fv[1].n / vFieldN).toFixed(2) },
}
const fieldScores = {
  count: ratio(fields.perVillage[0], fields.perVillage[1]), cover: ratio(fields.haPerVillage[0], fields.haPerVillage[1]),
  size: tri(fv[0].area_ha, gFA), mix: +(100 - 100 * Math.abs(fields.cropPainted.Crop_Field_01 - fields.vanillaCrops.Crop_Field_01)).toFixed(1), aspect: tri(fv[0].aspect, gBox.map((b) => b.aspect)), rect: tri(fv[0].rect, gBox.map((b) => b.rect)),
}

// ---- surfaces: dominant material per land cell, grouped in the vanilla categories ------------------------
const CAT = (n: string) => /^Forest/.test(n) ? 'forest' : /^Crop/.test(n) ? 'crop' : /^(Debris_Rock|Pebbles|Rock)/.test(n) ? 'rock' : /^Dirt/.test(n) ? 'dirt'
  : /^Heather/.test(n) ? 'heather' : /^(BeachGrass|Grass_03_coastal)/.test(n) ? 'shore' : /^MountainGrass/.test(n) ? 'mountainGrass' : /^(Asphalt|Concrete|Cobble)/.test(n) ? 'paved'
  : /^SeaBed/.test(n) ? 'seabed' : 'grass'
const gCat: Record<string, number> = {}, gMat: Record<string, number> = {}
for (let i = 0; i < w.heights.length; i++) {
  if (w.heights[i] <= 0) continue
  let best = 'Grass_03', bw = 0, sum = 0
  for (const s of w.surfaces) { const v = s.weights[i] ?? 0; sum += v; if (v > bw) { bw = v; best = s.name } }
  if (1 - sum > bw) best = 'Grass_03' // the base layer carries what the masks leave
  gMat[best] = (gMat[best] ?? 0) + 1; gCat[CAT(best)] = (gCat[CAT(best)] ?? 0) + 1
}
const pct = (o: Record<string, number>) => { const n = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(100 * v / n).toFixed(1)])) }
const vCat = fsv.categories as Record<string, number>, gCatP = pct(gCat)
let ov = 0; for (const k of new Set([...Object.keys(vCat), ...Object.keys(gCatP)])) ov += Math.min(vCat[k] ?? 0, gCatP[k] ?? 0)
const surfaces = { categories: { vanilla: vCat, ours: gCatP }, materials: { ours: pct(gMat) }, overlap: +ov.toFixed(1) }

const mean = (o: Record<string, number>) => +(Object.values(o).reduce((a, b) => a + b, 0) / Object.values(o).length).toFixed(1)
const report = {
  seed, size, sec, landHa: [Math.round(vLandHa), Math.round(gLandHa)],
  forests: { score: mean(forestScores), scores: forestScores, ...forests },
  fields: { score: mean(fieldScores), scores: fieldScores, ...fields },
  surfaces: { score: surfaces.overlap, ...surfaces },
  scores: { forests: mean(forestScores), fields: mean(fieldScores), surfaces: surfaces.overlap },
}
console.log(JSON.stringify(report, null, 1))
if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(report, null, 1))

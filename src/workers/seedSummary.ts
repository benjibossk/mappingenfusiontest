// Seed browser (src/ui/seedBrowser.ts): one whole world run reduced to a thumbnail + a few stats,
// so a batch of seeds never ships the heavy WorldResult back to the page.
import { generateWorld, type WorldParams, type WorldResult } from '../modules/worldgen'
import { rasterCover } from '../modules/cover'
import type { Progress } from './ops'

export interface SeedStats {
  towns: number; villages: number; hamlets: number
  ports: number; military: number; industry: number; airfield: number
  forestPct: number; waterPct: number; fieldPct: number
  roadKm: number; powerKm: number; maxElev: number
}
export interface SeedSummary { seed: number; stats: SeedStats; thumb: { w: number; h: number; data: Uint8ClampedArray } }

const len = (p: ArrayLike<number>) => { let s = 0; for (let i = 2; i + 1 < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s }

export function summarise(w: WorldResult, px = 128): SeedSummary {
  const g = w.grid, h = w.heights, n = g.cols * g.rows
  // campaign plots count as fields (drawn first, forests over them)
  const plots = (w.campaign?.fields ?? []).map((ring) => ({ kind: 'field' as const, pts: ring.flat() }))
  const cover = rasterCover(g, [...plots, ...w.areas]) ?? new Uint8Array(n)
  let forest = 0, field = 0, water = 0, land = 0, maxElev = -Infinity
  for (let i = 0; i < n; i++) {
    const v = h[i]; if (v > maxElev) maxElev = v
    if (v <= 0) { water++; continue }
    land++
    const c = cover[i]; if (c >= 1 && c <= 3) forest++; else if (c === 4) field++
  }
  const kinds = { town: 0, village: 0, hamlet: 0 }
  for (const s of w.sites) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  let ports = 0, military = 0, industry = 0, airfield = 0
  for (const z of w.zones) {
    if (z.kind === 'military') military++
    else if (z.kind === 'industrial') industry++
    else if (z.kind === 'airfield') airfield++
    else if (z.sub === 'port' || z.sub?.startsWith('vanilla:port')) ports++ // vanilla harbours: sub 'vanilla:port:<template>'
    else if (z.sub === 'military' || z.sub.startsWith('mil')) military++
  }
  const roadKm = w.roads.reduce((a, r) => a + len(r.pts), 0) / 1000
  const powerKm = w.power.reduce((a, l) => a + len(l.path ?? []), 0) / 1000
  // thumbnail: hypsometric tint + cover + roads, nearest sample of the height grid
  const data = new Uint8ClampedArray(px * px * 4)
  const top = Math.max(1, maxElev)
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const c = Math.min(g.cols - 1, Math.floor((x / px) * g.cols)), r = Math.min(g.rows - 1, Math.floor(((px - 1 - y) / px) * g.rows))
    const i = r * g.cols + c, v = h[i], o = (y * px + x) * 4
    let R: number, G: number, B: number
    if (v <= 0) { const d = Math.min(1, -v / 40); R = 40 - 20 * d; G = 110 - 50 * d; B = 190 - 60 * d }
    else {
      const k = v / top
      R = 150 + 80 * k; G = 170 + 40 * k; B = 110 + 100 * k
      const cv = cover[i]
      if (cv >= 1 && cv <= 3) { R = 50 + 40 * k; G = 105 + 40 * k; B = 50 + 30 * k } else if (cv === 4) { R = 200; G = 190; B = 120 }
    }
    data[o] = R; data[o + 1] = G; data[o + 2] = B; data[o + 3] = 255
  }
  const plot = (pts: ArrayLike<number>, col: number[]) => {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) / (g.cols * g.step / px)))
      for (let s = 0; s <= steps; s++) {
        const X = pts[i] + ((pts[i + 2] - pts[i]) * s) / steps, Z = pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * s) / steps
        const x = Math.floor(((X - g.minX) / (g.cols * g.step)) * px), y = px - 1 - Math.floor(((Z - g.minZ) / (g.rows * g.step)) * px)
        if (x < 0 || y < 0 || x >= px || y >= px) continue
        const o = (y * px + x) * 4; data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]
      }
    }
  }
  for (const wt of w.waters) if (wt.type === 'river') plot(wt.pts, [60, 130, 220])
  for (const r of w.roads) plot(r.pts, [90, 70, 60])
  for (const s of w.sites) { const x = Math.floor(((s.x - g.minX) / (g.cols * g.step)) * px), y = px - 1 - Math.floor(((s.z - g.minZ) / (g.rows * g.step)) * px); const rad = s.kind === 'town' ? 2 : 1
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= px || Y >= px) continue; const o = (Y * px + X) * 4; data[o] = 200; data[o + 1] = 40; data[o + 2] = 40 } }
  const pct = (a: number) => (land ? Math.round((1000 * a) / land) / 10 : 0)
  return {
    seed: w.params.seed,
    stats: { towns: kinds.town, villages: kinds.village, hamlets: kinds.hamlet, ports, military, industry, airfield,
      forestPct: pct(forest), fieldPct: pct(field), waterPct: Math.round((1000 * water) / n) / 10,
      roadKm: Math.round(roadKm * 10) / 10, powerKm: Math.round(powerKm * 10) / 10, maxElev: Math.round(maxElev) },
    thumb: { w: px, h: px, data },
  }
}

export async function seedSummary(p: WorldParams, progress?: Progress): Promise<SeedSummary> {
  return summarise(await generateWorld(p, { progress }))
}

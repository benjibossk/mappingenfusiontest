// Ensembles bench (2026-11-20, "map like a Bohemia mapper"): our villages / parcel groups vs vanilla, per site kind.
// Vanilla has no parcel objects, so every metric is computed the same way on both sides from buildings + fences:
//   plot      half the distance to the nearest house (parcel size / spacing proxy), KS score
//   mix       outbuildings per house
//   fence     fence metres per house, share of houses with a fence piece within 12 m (closure proxy)
//   gradient  share of the buildings in the inner / middle / outer third of the site radius (density centre -> edge)
//   shape     elongation of the site footprint (sqrt of the PCA eigenvalue ratio, 1 = round)
//   rows      share of houses whose two nearest houses lie on either side, roughly in line (> 150 deg)
// Score per kind = mean of the sub-scores (100 = same as vanilla).
export interface EB { x: number; z: number; out: boolean }
export interface EF { x: number; z: number; len: number }
export interface ESite { x: number; z: number; kind: string }

const R: Record<string, number> = { town: 300, village: 170, hamlet: 80 }
const ratio = (a: number, b: number) => (a || b ? (100 * Math.min(a, b)) / Math.max(a, b, 1e-9) : 100)
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

function stats(sites: ESite[], kind: string, bs: EB[], fs: EF[], ks: (a: number[], b: number[]) => number) {
  const plot: number[] = [], grad = [0, 0, 0], el: number[] = []
  let houses = 0, outs = 0, fenced = 0, fenceM = 0, rows = 0, rowN = 0
  for (const s of sites.filter((q) => q.kind === kind)) {
    const r = R[kind], mine = bs.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) < r)
    const hs = mine.filter((b) => !b.out)
    if (hs.length < 3) continue
    houses += hs.length; outs += mine.length - hs.length
    fenceM += fs.reduce((t, f) => t + (Math.hypot(f.x - s.x, f.z - s.z) < r ? f.len : 0), 0)
    const near = fs.filter((f) => Math.hypot(f.x - s.x, f.z - s.z) < r + 15)
    let cx = 0, cz = 0
    for (const h of hs) { cx += h.x; cz += h.z }
    cx /= hs.length; cz /= hs.length
    const rad = hs.map((h) => Math.hypot(h.x - cx, h.z - cz)).sort((a, b) => a - b), r90 = Math.max(10, rad[Math.floor(rad.length * 0.9)])
    let sxx = 0, szz = 0, sxz = 0
    for (const h of hs) {
      const d = Math.hypot(h.x - cx, h.z - cz) / r90
      grad[d < 1 / 3 ? 0 : d < 2 / 3 ? 1 : 2]++
      sxx += (h.x - cx) ** 2; szz += (h.z - cz) ** 2; sxz += (h.x - cx) * (h.z - cz)
      const nn = hs.filter((o) => o !== h).map((o) => ({ o, d: Math.hypot(o.x - h.x, o.z - h.z) })).sort((a, b) => a.d - b.d)
      plot.push(nn[0].d / 2)
      if (near.some((f) => Math.hypot(f.x - h.x, f.z - h.z) < 12)) fenced++
      if (nn.length >= 2 && nn[1].d < 60) {
        rowN++
        const a = nn[0].o, b = nn[1].o, ax = a.x - h.x, az = a.z - h.z, bx = b.x - h.x, bz = b.z - h.z
        if ((ax * bx + az * bz) / (nn[0].d * nn[1].d) < Math.cos((150 * Math.PI) / 180)) rows++
      }
    }
    const tr = sxx + szz, det = sxx * szz - sxz * sxz, l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr - l1
    el.push(Math.sqrt(Math.max(1e-9, l2) / Math.max(1e-9, l1)))
  }
  const g = grad.reduce((a, b) => a + b, 0) || 1
  return { houses, plot, outPerHouse: outs / Math.max(1, houses), fencePerHouse: fenceM / Math.max(1, houses), fencedShare: fenced / Math.max(1, houses),
    gradient: grad.map((v) => v / g), elong: mean(el), rowShare: rows / Math.max(1, rowN) }
}

export function ensemblesBench(sites: ESite[], v: { b: EB[]; f: EF[] }, o: { b: EB[]; f: EF[] }, ks: (a: number[], b: number[]) => number) {
  const out: Record<string, unknown> = {}
  const all: number[] = []
  for (const kind of ['town', 'village', 'hamlet']) {
    const a = stats(sites, kind, v.b, v.f, ks), b = stats(sites, kind, o.b, o.f, ks)
    if (!a.houses || !b.houses) continue
    const sub = {
      plot: +ks(a.plot, b.plot).toFixed(1),
      mix: +ratio(a.outPerHouse, b.outPerHouse).toFixed(1),
      fenceLen: +ratio(a.fencePerHouse, b.fencePerHouse).toFixed(1),
      fenced: +ratio(a.fencedShare, b.fencedShare).toFixed(1),
      gradient: +(100 - 50 * a.gradient.reduce((t, p, i) => t + Math.abs(p - b.gradient[i]), 0)).toFixed(1),
      shape: +ratio(a.elong, b.elong).toFixed(1),
      rows: +ratio(a.rowShare, b.rowShare).toFixed(1),
    }
    const score = +mean(Object.values(sub)).toFixed(1)
    all.push(score)
    const r2 = (x: number) => +x.toFixed(2)
    out[kind] = { score, sub, vanilla: { houses: a.houses, plotMed: r2(a.plot.sort((x, y) => x - y)[a.plot.length >> 1] ?? 0), outPerHouse: r2(a.outPerHouse), fencePerHouse: r2(a.fencePerHouse), fencedShare: r2(a.fencedShare), gradient: a.gradient.map(r2), elong: r2(a.elong), rowShare: r2(a.rowShare) },
      ours: { houses: b.houses, plotMed: r2(b.plot.sort((x, y) => x - y)[b.plot.length >> 1] ?? 0), outPerHouse: r2(b.outPerHouse), fencePerHouse: r2(b.fencePerHouse), fencedShare: r2(b.fencedShare), gradient: b.gradient.map(r2), elong: r2(b.elong), rowShare: r2(b.rowShare) } }
  }
  return { score: +mean(all).toFixed(1), ...out }
}

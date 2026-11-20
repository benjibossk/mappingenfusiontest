// Wall pieces -> wall-generator splines. Rule: EVERY linear wall / fence is placed by a WallGeneratorEntity
// (WG_*.et polyline, like the garden fences), never as loose wall prefabs. Vanilla compositions (vanilla_sites.json,
// harvested parcels) carry the pieces their WG baked; stamped one by one they end up as a grid of loose, slightly
// misaligned blocks (seed 21 MIL_1, StoneWall_01 of Cain). Here the pieces of one family are chained (neighbour at
// ~one piece length along the piece's local X axis) and each chain becomes one WG polyline.
import type { ProjectEntity, ProjectShape } from '../project'
import { wallShape } from './gen-common'

const W = 'Prefabs/WEGenerators/Walls/'
/** piece family folder (Prefabs/Structures/Walls/<Cat>/<Family>/) -> vanilla wall generator (bare path: the plugin
 *  resolves it, MG_ShapeBuilder.c Workbench.GetResourceName). Families without a WG (retaining / silage walls,
 *  ConcreteWall_02) are structures, not linear walls: kept as objects. */
export const WALL_WG: Record<string, string> = {
  ConcreteWall_01: `${W}Concrete/WG_ConcreteWall_01.et`,
  ConcreteWall_USSR_01: '{CB2D3046A8023287}Prefabs/WEGenerators/Walls/Concrete/WG_ConcreteWall_USSR_03.et',
  StoneWall_01: '{AFBC8775A67A25AB}Prefabs/WEGenerators/Walls/Stone/WG_StoneWall_01.et',
  StoneWall_02: '{750314043E7EA87C}Prefabs/WEGenerators/Walls/Stone/WG_StoneWall_02.et',
  BrickWallOld_01: '{23BA8BDB67FAC5C5}Prefabs/WEGenerators/Walls/Brick/WG_BrickWallOld_01.et',
  BrickWall_01: '{1D54F9B155264349}Prefabs/WEGenerators/Walls/Brick/WG_BrickWall_01.et',
  BrickWall_02: `${W}Brick/WG_BrickWall_02.et`,
  NetFence_01: '{78A5D964C7732D51}Prefabs/WEGenerators/Walls/Net/WG_NetFence_01.et',
  NetFence_02: `${W}Net/WG_NetFence_02.et`,
  NetFence_03: `${W}Net/WG_NetFence_03.et`,
  NetFence_04: `${W}Net/WG_NetFence_04.et`,
  NetFence_05: `${W}Net/WG_NetFence_05_green.et`,
  NetFence_USSR_01: '{CA5FA41E2FC5DDA1}Prefabs/WEGenerators/Walls/Net/WG_NetFence_USSR_01.et',
  TinWall_01: '{3BBE8E0E68E0BE9C}Prefabs/WEGenerators/Walls/Metal/WG_TinWall_01.et',
  TinWall_01_rusty: '{25A2E591AC54EF71}Prefabs/WEGenerators/Walls/Metal/WG_TinWall_01_rusty.et',
  MetalWall_01: '{191C938B76395B29}PrefabLibrary/DefaultLibrary/Generators/Walls/Metal/WG_MetalWall_01.et',
  MetalFenceDecorative_E_01: '{3CF9D6E0ED89A634}Prefabs/WEGenerators/Walls/Metal/WG_MetalFenceDecorative_E_01.et',
  MetalFenceDecorative_E_02: '{50ADE200514D291A}Prefabs/WEGenerators/Walls/Metal/WG_MetalFenceDecorative_E_02.et',
  PipeRailing_01: `${W}Pipe/WG_PipeRailing_01.et`,
  PipeRailing_02: `${W}Pipe/WG_PipeRailing_02.et`,
  PipeRailing_03: `${W}Pipe/WG_PipeRailing_03_V1.et`,
  PipeRailing_04: `${W}Pipe/WG_PipeRailing_04.et`,
  PoleFence_01: '{5B6E89F5F31C58DE}Prefabs/WEGenerators/Walls/Pole/WG_PoleFence_01.et',
  PoleFence_02: '{56EB3E90ED6D70D6}Prefabs/WEGenerators/Walls/Pole/WG_PoleFence_02.et',
  CrashBarrier_01: '{D6BDCB7A8BDCB610}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_01A.et',
  WoodenFence_01: '{1A61D6F828325773}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_01.et',
  WoodenFence_02: '{3D01BACFAD3B1797}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_02.et',
  WoodenFence_03: '{D70816286B74E7F8}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_03.et',
  WoodenFence_04: '{0CC5E987AE1787C6}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_04.et',
  WoodenFenceOld_01: '{893BD1EB126A1C01}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFenceOld_01.et',
  WoodenRural_01: '{8F597EE22331F6D3}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenRural_01.et',
  WoodenWall_01: `${W}Wooden/WG_WoodenWall_01.et`,
  WoodenWall_02: `${W}Wooden/WG_WoodenWall_02.et`,
}

/** family of a loose wall piece that a WG can place (null = not a linear wall piece) */
export function wallFamily(prefab: string): string | null {
  const m = /Prefabs\/Structures\/Walls\/[A-Za-z]+\/([A-Za-z0-9_]+)\//.exec(prefab)
  return m && WALL_WG[m[1]] ? m[1] : null
}
/** a loose wall-type prefab that must be a WG shape instead (pre-send check: 0 allowed) */
export const isLooseWallPiece = (prefab: string) => wallFamily(prefab) !== null

/** piece length along its local X (name _4m / _8m...; poles, start / end caps ~0) */
function pieceLen(prefab: string): number {
  const m = /_(\d+(?:\.\d+)?)m(?:_|\.|[A-Z])/.exec(prefab.slice(prefab.lastIndexOf('/')))
  return m ? Number(m[1]) : /pole|end|start|post/i.test(prefab) ? 0.3 : 3
}

/** splits entities into the kept ones and WG polylines replacing their loose wall pieces */
export function wallPiecesToShapes(entities: ProjectEntity[], idPrefix: string): { entities: ProjectEntity[]; shapes: ProjectShape[] } {
  const keep: ProjectEntity[] = [], byFam = new Map<string, ProjectEntity[]>()
  for (const e of entities) { const f = wallFamily(e.prefab); if (f) { const a = byFam.get(f) ?? []; a.push(e); byFam.set(f, a) } else keep.push(e) }
  const shapes: ProjectShape[] = []
  for (const [fam, ps] of byFam) {
    const n = ps.length, L = ps.map((p) => pieceLen(p.prefab))
    const ax = ps.map((p) => { const y = ((p.yaw ?? 0) * Math.PI) / 180; return [Math.cos(y), -Math.sin(y)] })
    // candidate links: neighbour within ~ the mean of both lengths (+ slack), along both axes
    const cand: [number, number, number][] = []
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = ps[j].x - ps[i].x, dz = ps[j].z - ps[i].z, d = Math.hypot(dx, dz)
      const reach = (L[i] + L[j]) / 2 + 2
      if (d < 0.05 || d > reach) continue
      const ci = Math.abs((dx * ax[i][0] + dz * ax[i][1]) / d), cj = Math.abs((dx * ax[j][0] + dz * ax[j][1]) / d)
      if (Math.max(ci, cj) < 0.7 || Math.min(ci, cj) < 0.3) continue
      cand.push([d, i, j])
    }
    cand.sort((a, b) => a[0] - b[0])
    const deg = new Array(n).fill(0), adj: number[][] = ps.map(() => []), root = ps.map((_, i) => i)
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
    for (const [, i, j] of cand) {
      if (deg[i] >= 2 || deg[j] >= 2) continue
      const ri = find(i), rj = find(j)
      if (ri === rj) continue // no ring here: a closed loop stays open at one joint (WG handles it fine)
      root[ri] = rj; deg[i]++; deg[j]++; adj[i].push(j); adj[j].push(i)
    }
    const seen = new Array(n).fill(false)
    const starts = [...ps.keys()].filter((i) => deg[i] <= 1)
    let k = 0
    for (const s of starts) {
      if (seen[s]) continue
      const chain: number[] = []
      let cur = s, prev = -1
      while (cur >= 0 && !seen[cur]) { seen[cur] = true; chain.push(cur); const nx = adj[cur].find((q) => q !== prev && !seen[q]); prev = cur; cur = nx ?? -1 }
      const len = chain.reduce((a, i) => a + L[i], 0)
      if (len < 1.5) continue // a lone post / cap: nothing to wall
      const pts: number[] = []
      const end = (i: number, toward: number, sign: number) => { // outer end of the chain's end piece, half a piece beyond its centre
        const p = ps[i], [ux, uz] = ax[i]
        let s2 = sign
        if (toward >= 0) { const d = (ps[toward].x - p.x) * ux + (ps[toward].z - p.z) * uz; s2 = d > 0 ? -1 : 1 }
        return [p.x + s2 * ux * L[i] / 2, p.z + s2 * uz * L[i] / 2]
      }
      const a = chain[0], b = chain[chain.length - 1]
      pts.push(...end(a, chain.length > 1 ? chain[1] : -1, -1))
      for (let q = 1; q < chain.length - 1; q++) pts.push(ps[chain[q]].x, ps[chain[q]].z)
      if (chain.length === 1) pts.push(...end(a, -1, 1))
      else { if (L[a] < 1) pts.splice(0, 2, ps[a].x, ps[a].z); pts.push(...(L[b] < 1 ? [ps[b].x, ps[b].z] : end(b, chain[chain.length - 2], 1))) }
      // interior centres every piece: thin out collinear vertices (the WG respaces its pieces itself)
      const line = simplify(pts)
      if (line.length >= 4) shapes.push(wallShape(`${idPrefix}-wg-${fam}-${k++}`, line, WALL_WG[fam]))
    }
  }
  return { entities: keep, shapes }
}

/** drops interior vertices whose turn is under ~4 degrees */
function simplify(q: number[]): number[] {
  const p: number[] = [q[0], q[1]] // drop coincident vertices (a cap piece on top of its neighbour's end)
  for (let i = 2; i + 1 < q.length; i += 2) if (Math.hypot(q[i] - p[p.length - 2], q[i + 1] - p[p.length - 1]) > 0.3) p.push(q[i], q[i + 1])
  if (p.length <= 4) return p
  const out = [p[0], p[1]]
  for (let i = 2; i + 2 < p.length; i += 2) {
    const ax = p[i] - out[out.length - 2], az = p[i + 1] - out[out.length - 1], bx = p[i + 2] - p[i], bz = p[i + 3] - p[i + 1]
    const c = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1)
    if (c < 0.9976) out.push(p[i], p[i + 1])
  }
  out.push(p[p.length - 2], p[p.length - 1])
  return out
}

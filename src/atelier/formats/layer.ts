// Workbench .layer / text .ent reader: nested "Head {" ... "}" blocks.
// Ported to TypeScript from giorbev's water_layers.py, eau_layers.py (_bodies_of), layer_objets.py,
// layer_vegetation.py and layer_port.py — MIT, Copyright (c) giorbev (https://github.com/giorbev/Map-generator).
// World position of a child = parent position + local coords rotated by the parent's yaw (angles, 2nd value).

export interface LNode { head: string; a: number; b: number | null; kids: LNode[]; parent: LNode | null }

export function splitLines(text: string): { lines: string[]; nl: string } {
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  return { lines: text.split(nl), nl }
}

export function tree(lines: string[]): LNode {
  const root: LNode = { head: '', a: -1, b: null, kids: [], parent: null }
  let cur = root
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.endsWith('{')) {
      const n: LNode = { head: t.slice(0, -1).trim(), a: i, b: null, kids: [], parent: cur }
      cur.kids.push(n); cur = n
    } else if (t === '}' && cur.parent) { cur.b = i; cur = cur.parent }
  }
  return root
}

export function* walk(n: LNode): Generator<LNode> { for (const k of n.kids) { yield k; yield* walk(k) } }

/** true when every block was closed (after an edit: refuse to write otherwise) */
export function balanced(lines: string[]): boolean {
  let d = 0
  for (const l of lines) { const t = l.trim(); if (t.endsWith('{')) d++; else if (t === '}') { d--; if (d < 0) return false } }
  return d === 0
}

const KV = /^\s*(\w+)\s+(.+?)\s*$/
export function own(lines: string[], n: LNode): Record<string, string> {
  const skip = new Set<number>()
  for (const k of n.kids) for (let i = k.a; i <= (k.b ?? k.a); i++) skip.add(i)
  const out: Record<string, string> = {}
  for (let i = n.a + 1; i < (n.b ?? n.a + 1); i++) {
    if (skip.has(i)) continue
    const m = KV.exec(lines[i])
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}

export function floats(s: string | undefined, n = 3): number[] | null {
  if (!s) return null
  const v = s.trim().split(/\s+/).slice(0, n).map(Number)
  return v.length === n && v.every(Number.isFinite) ? v : null
}

const GEN = /\b(LakeGeneratorEntity|RiverEntity)\s*:/

export interface WaterBody {
  file: string; kind: 'lake' | 'river'; spline: boolean; closed: boolean
  x: number[]; z: number[]; y: number[]
  coords: number[]; angles: number[]; gdy: number; offset: number; width: number | null
  ent: [number, number]; pts: [number, number]; sp: [number, number][]; gen: [number, number]
  named: boolean; name: string
}

/** lakes and rivers of a .layer, with the line ranges of their blocks (for rewriting) */
export function waterBodies(lines: string[], file: string): WaterBody[] {
  const out: WaterBody[] = []
  for (const e of walk(tree(lines))) {
    const pts = e.kids.find((k) => k.head === 'Points')
    if (!pts || e.b === null) continue
    const g = [...walk(e)].find((k) => GEN.test(k.head))
    if (!g || g.b === null || pts.b === null) continue
    const props = own(lines, e), gp = own(lines, g)
    const c = floats(props.coords)
    if (!c) continue
    const ang = floats(props.angles ?? '0 0 0') ?? [0, 0, 0]
    const P: number[][] = [], nodes: LNode[] = []
    for (const sp of pts.kids) { const p = floats(own(lines, sp).Position); if (p) { P.push(p); nodes.push(sp) } }
    if (P.length < 2 || nodes.length !== pts.kids.length) continue
    const yaw = ang[1] * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw)
    const head = e.head.split(/\s+/).filter(Boolean)
    const inGrp = !!e.parent && e.parent.head.startsWith('$grp')
    const cls = inGrp ? (e.parent!.head.split(/\s+/)[1] ?? '') : (head[0] ?? '')
    const lake = g.head.includes('LakeGeneratorEntity')
    if (lake && P.length < 3) continue
    const num = (k: string, d = 0) => { const v = Number(gp[k]); return k in gp && Number.isFinite(v) ? v : d }
    const named = inGrp ? head.length >= 1 : head.length >= 2
    out.push({
      file, kind: lake ? 'lake' : 'river', spline: cls.startsWith('SplineShape'),
      closed: lake || props.IsClosed === '1',
      x: P.map((p) => c[0] + p[0] * cs + p[2] * sn), z: P.map((p) => c[2] - p[0] * sn + p[2] * cs), y: P.map((p) => c[1] + p[1]),
      coords: c, angles: ang, gdy: (floats(gp.coords ?? '0 0 0') ?? [0, 0, 0])[1],
      offset: lake ? num('m_fWaterSurfaceOffset') : num('WaterOffset') + num('SplineOffsetUp'),
      width: lake || !('Width' in gp) ? null : num('Width'),
      ent: [e.a, e.b], pts: [pts.a, pts.b], sp: nodes.map((n) => [n.a, n.b ?? n.a]), gen: [g.a, g.b],
      named, name: named ? (inGrp ? head[0] : head[1]) : '',
    })
  }
  return out
}

export const hasWater = (text: string) => GEN.test(text)

// --- object classification (giorbev layer_objets.py, layer_vegetation.py, layer_port.py) ---
export type RoadSurface = 'asphalt' | 'concrete' | 'dirt'
export function roadType(prefab: string): RoadSurface | null {
  const p = prefab.replace(/\\/g, '/').toLowerCase()
  if (!p.includes('/roads/')) return null
  if (p.includes('/asphalt/')) return 'asphalt'
  if (p.includes('/concrete/') || p.includes('/cobblestone/')) return 'concrete'
  return 'dirt'
}
export type BuildingKind = 'house' | 'industrial'
export function buildingType(prefab: string): BuildingKind | null {
  const p = prefab.replace(/\\/g, '/').toLowerCase(), i = p.indexOf('/structures/')
  if (i < 0) return null
  const s = p.slice(i + 12)
  if (s.startsWith('industrial/containers') || s.startsWith('industrial/piping')) return null
  if (['houses/', 'cultural/', 'commercial/', 'civilian/', 'ruins/'].some((k) => s.startsWith(k))) return 'house'
  if (['industrial/', 'military/', 'agriculture/'].some((k) => s.startsWith(k))) return 'industrial'
  return null
}
export type TreeKind = 'conifer' | 'deciduous' | 'bush'
const CONIFER = ['picea', 'pinus', 'abies', 'larix', 'juniperus', 'taxus', 'pine', 'spruce', 'conifer']
export function treeType(prefab: string): TreeKind | null {
  const p = prefab.replace(/\\/g, '/').toLowerCase()
  if (!p.includes('/vegetation/') || p.includes('/debris/')) return null
  const name = p.split('/').pop() ?? ''
  if (p.includes('/trees/') || p.includes('/tree/')) return CONIFER.some((k) => name.includes(k)) ? 'conifer' : 'deciduous'
  if (p.includes('/bush')) return 'bush'
  return null
}
export type PortKind = 'bollard' | 'stairs' | 'breakwater' | 'quaywall' | 'wooden' | 'slab' | 'retaining'
export function portType(prefab: string): PortKind | null {
  const n = (prefab.split('/').pop() ?? '').toLowerCase()
  if (n.includes('retainingwall')) return 'retaining'
  if (n.includes('bollard')) return 'bollard'
  if ((n.includes('stairs') || n.includes('slipway') || n.includes('ladder')) && !n.includes('cradle')) return 'stairs'
  if (n.includes('breakwater')) return 'breakwater'
  if (n.includes('wall') && n.includes('pierconcrete')) return 'quaywall'
  if (n.includes('pierwooden') && !n.includes('pole')) return 'wooden'
  if (n.includes('pierconcrete') || /pier_0\d/.test(n)) return 'slab'
  return null
}
export type WallKind = 'wall' | 'palisade' | 'fence'
export function wallType(prefab: string): WallKind | null {
  const n = (prefab.split('/').pop() ?? '').toLowerCase()
  if (['piperailing', 'kerb', 'crashbarrier', 'pavement', 'gate', 'pile', '_pole', 'retainingwall'].some((k) => n.includes(k))) return null
  if (['stonewall', 'brickwall', 'concretewall', 'concretefence'].some((k) => n.includes(k))) return 'wall'
  if (['tinwall', 'metalwall', 'woodenwall'].some((k) => n.includes(k))) return 'palisade'
  if (['polefence', 'netfence', 'woodenfence', 'woodenrural', 'gameproof', 'barbedwire', 'fence'].some((k) => n.includes(k))) return 'fence'
  return null
}

export interface LayerObjects {
  /** `layer` = source .layer file name, set by the Atelier loader (zones skip their own previous output) */
  roads: { type: RoadSurface; pts: [number, number][]; layer?: string }[]
  buildings: { x: number; z: number; type: BuildingKind; yaw?: number; prefab?: string; layer?: string }[]
  trees: { x: number; z: number; type: TreeKind }[]
  port: { x: number; z: number; yaw: number; type: PortKind; prefab: string; layer?: string }[]
  walls: { x: number; z: number; yaw: number; type: WallKind; prefab: string; layer?: string }[]
  entities: number
}

const ENTITY = /^\s*(\$grp\s+)?(\w+)(?:\s+\w+)?\s*:\s*"\{[0-9A-Fa-f]+\}([^"]+)"\s*\{\s*$/
const COORDS = /^\s*coords\s+(\S+)\s+(\S+)\s+(\S+)/
const ANGLES = /^\s*angles\s+(\S+)\s+(\S+)\s+(\S+)/
const POS = /^\s*Position\s+(\S+)\s+(\S+)\s+(\S+)/

interface Frame { kind: 'sp' | 'points' | null; grp: boolean; data: boolean; local: [number, number] | null; yaw: number; world: [number, number, number] | null; prefab: string | null; pts: [number, number][] | null }
const frame = (o: Partial<Frame> = {}): Frame => ({ kind: null, grp: false, data: true, local: null, yaw: 0, world: null, prefab: null, pts: null, ...o })

/** roads (parent spline of a road generator), buildings, trees, port pieces and walls, in world coordinates */
export function layerObjects(lines: string[]): LayerObjects {
  const out: LayerObjects = { roads: [], buildings: [], trees: [], port: [], walls: [], entities: 0 }
  const st: Frame[] = [frame({ data: false, world: [0, 0, 0] })]
  const world = (i: number): [number, number, number] => {
    const f = st[i]
    if (!f.world) {
      const [px, pz, pyaw] = world(i - 1), [lx, lz] = f.local ?? [0, 0], a = pyaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
      f.world = [px + lx * c + lz * s, pz - lx * s + lz * c, pyaw + f.yaw]
    }
    return f.world
  }
  const toWorld = (i: number, lx: number, lz: number): [number, number] => {
    const [px, pz, yaw] = world(i), a = yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
    return [px + lx * c + lz * s, pz - lx * s + lz * c]
  }
  const placed = (f: Frame, i: number) => {
    const p = f.prefab!
    const [x, z] = toWorld(i, f.local![0], f.local![1]), yaw = world(i)[2] + f.yaw
    const b = buildingType(p); if (b) { out.buildings.push({ x, z, type: b, yaw, prefab: p }); return }
    const tr = treeType(p); if (tr) { out.trees.push({ x, z, type: tr }); return }
    const pk = portType(p); if (pk) { out.port.push({ x, z, yaw, type: pk, prefab: p }); return }
    const w = wallType(p); if (w) out.walls.push({ x, z, yaw, type: w, prefab: p })
  }
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t === '}') {
      const f = st.length > 1 ? st.pop()! : null
      // objects whose coords came before the yaw: classify on close (needs coords)
      if (f && f.prefab && f.local && !f.grp) placed(f, st.length - 1)
      continue
    }
    if (t.endsWith('{')) {
      const parent = st[st.length - 1], n = frame()
      if (parent.kind === 'points') n.kind = 'sp'
      else if (parent.data) { /* inside a data block */ }
      else if (t.startsWith('Points')) { n.kind = 'points'; parent.pts = [] }
      else {
        const m = ENTITY.exec(line)
        if (m) {
          n.data = false; n.grp = !!m[1]; out.entities++
          if (m[2].endsWith('RoadGeneratorEntity')) {
            const rt = roadType(m[3])
            if (rt) for (let j = st.length - 1; j >= 0; j--) if (st[j].pts?.length) { out.roads.push({ type: rt, pts: st[j].pts!.map(([a, b]) => toWorld(j, a, b)) }); break }
          } else n.prefab = m[3]
        } else if (t === '{') { n.data = false; n.prefab = parent.grp ? parent.prefab : null }
        else if (t.startsWith('$grp') || (t.split(/\s+/)[0] ?? '').endsWith('Entity')) { n.data = false; n.grp = t.startsWith('$grp'); out.entities++ }
      }
      st.push(n)
      continue
    }
    const f = st[st.length - 1]
    if (f.kind === 'sp') {
      const m = POS.exec(t)
      if (m && st.length >= 3) { const a = Number(m[1]), b = Number(m[3]); if (Number.isFinite(a) && Number.isFinite(b)) st[st.length - 3].pts?.push([a, b]) }
      continue
    }
    if (f.data || f.grp) continue
    let m = COORDS.exec(t)
    if (m) { const a = Number(m[1]), b = Number(m[3]); if (Number.isFinite(a) && Number.isFinite(b)) f.local = [a, b]; continue }
    m = ANGLES.exec(t)
    if (m) { const y = Number(m[2]); if (Number.isFinite(y)) f.yaw = y }
  }
  return out
}

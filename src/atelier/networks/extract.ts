// Generic .layer walker for the network viewers (rails, roads, power): placed instances (prefab, world
// position, yaw, line range) and generator splines (ShapePoint positions in world coordinates + the
// generator's own properties). Same transform rules as formats/layer.ts (child = parent + local rotated by
// the parent's yaw), but keeps line numbers so a viewer can point at — or remove — the exact block.
// Read-only: never writes anything.

export interface Inst {
  cls: string; prefab: string; x: number; y: number; z: number; yaw: number
  file: string; a: number; b: number // block lines (inclusive)
  grpA: number // opening line of the enclosing $grp (-1 when the instance is its own entity)
  gen: string | null // class of the enclosing generator (generated children: poles of a power line…)
}
export interface Spline {
  cls: string; prefab: string; pts: [number, number, number][]; file: string; a: number; b: number
  props: Record<string, string>
}
export interface Extract { insts: Inst[]; splines: Spline[]; grpCount: Map<string, number> /* "file:grpA" → children */ }

interface F {
  kind: 'data' | 'ent' | 'grp' | 'points' | 'sp'
  cls: string; prefab: string; local: [number, number, number] | null; yaw: number
  world: [number, number, number, number] | null // x, y, z, yaw
  pts: [number, number, number][] | null; a: number; grpA: number; gen: string | null; props: Record<string, string> | null
}
const ENTITY = /^\s*(\$grp\s+)?(\w+)(?:\s+\w+)?\s*:\s*"(?:\{[0-9A-Fa-f]+\})?([^"]*)"\s*\{\s*$/
const BARE = /^\s*(\$grp\s+)?(\w+)(?:\s+\w+)?\s*\{\s*$/
const COORDS = /^\s*coords\s+(\S+)\s+(\S+)\s+(\S+)/
const ANGLES = /^\s*angles\s+(\S+)\s+(\S+)\s+(\S+)/
const POS = /^\s*Position\s+(\S+)\s+(\S+)\s+(\S+)/
const KV = /^\s*(\w+)\s+(.+?)\s*$/
export const isGenerator = (cls: string) => /Generator\w*Entity$/.test(cls)

export interface ExtractOpts {
  inst?: (prefab: string, cls: string) => boolean // instances to keep (default: none)
  spline?: (cls: string) => boolean // generator classes whose spline is kept (default: none)
}

export function extract(text: string, file: string, o: ExtractOpts, out: Extract = { insts: [], splines: [], grpCount: new Map() }): Extract {
  const lines = text.split(/\r?\n/)
  const mk = (p: Partial<F>): F => ({ kind: 'data', cls: '', prefab: '', local: null, yaw: 0, world: null, pts: null, a: -1, grpA: -1, gen: null, props: null, ...p })
  const st: F[] = [mk({ kind: 'ent', world: [0, 0, 0, 0] })]
  const world = (i: number): [number, number, number, number] => {
    const f = st[i]
    if (!f.world) {
      const [px, py, pz, pyaw] = world(i - 1), [lx, ly, lz] = f.local ?? [0, 0, 0], r = pyaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
      f.world = [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c, pyaw + f.yaw]
    }
    return f.world
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li], t = line.trim()
    if (!t) continue
    if (t === '}') {
      if (st.length <= 1) continue
      const f = st[st.length - 1]
      if (f.kind === 'ent' && f.prefab && o.inst?.(f.prefab, f.cls)) {
        const [x, y, z, yaw] = world(st.length - 1)
        out.insts.push({ cls: f.cls, prefab: f.prefab, x, y, z, yaw, file, a: f.a, b: li, grpA: f.grpA, gen: f.gen })
      }
      if (f.kind === 'ent' && f.grpA >= 0) { const k = file + ':' + f.grpA; out.grpCount.set(k, (out.grpCount.get(k) ?? 0) + 1) }
      if (f.kind === 'ent' && isGenerator(f.cls) && o.spline?.(f.cls)) {
        for (let j = st.length - 2; j >= 0; j--) if (st[j].pts?.length) {
          const [px, py, pz, pyaw] = world(j), r = pyaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r)
          out.splines.push({ cls: f.cls, prefab: f.prefab, file, a: f.a, b: li, props: f.props ?? {},
            pts: st[j].pts!.map(([lx, ly, lz]) => [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c]) })
          break
        }
      }
      st.pop()
      continue
    }
    const parent = st[st.length - 1]
    if (t.endsWith('{')) {
      let n: F
      if (parent.kind === 'points') n = mk({ kind: 'sp', a: li })
      else if (parent.kind === 'data' || parent.kind === 'sp') n = mk({ a: li })
      else if (t.startsWith('Points')) { n = mk({ kind: 'points', a: li }); parent.pts = [] }
      else {
        const gen = isGenerator(parent.cls) ? parent.cls : parent.gen
        const m = ENTITY.exec(line)
        if (m) n = mk({ kind: m[1] ? 'grp' : 'ent', cls: m[2], prefab: m[3], a: li, gen, props: isGenerator(m[2]) ? {} : null })
        else if (t === '{') n = parent.kind === 'grp' ? mk({ kind: 'ent', cls: parent.cls, prefab: parent.prefab, a: li, grpA: parent.a, gen }) : mk({ kind: 'ent', a: li, gen })
        else {
          const b = BARE.exec(line)
          if (b && (b[1] || b[2].endsWith('Entity'))) n = mk({ kind: b[1] ? 'grp' : 'ent', cls: b[2], a: li, gen, props: isGenerator(b[2]) ? {} : null })
          else n = mk({ a: li })
        }
      }
      st.push(n)
      continue
    }
    if (parent.kind === 'sp') {
      const m = POS.exec(t)
      if (m && st.length >= 3) { const v = [Number(m[1]), Number(m[2]), Number(m[3])]; if (v.every(Number.isFinite)) st[st.length - 3].pts?.push(v as [number, number, number]) }
      continue
    }
    if (parent.kind !== 'ent') continue
    let m = COORDS.exec(t)
    if (m) { const v = [Number(m[1]), Number(m[2]), Number(m[3])]; if (v.every(Number.isFinite)) parent.local = v as [number, number, number]; continue }
    m = ANGLES.exec(t)
    if (m) { const y = Number(m[2]); if (Number.isFinite(y)) parent.yaw = y; continue }
    if (parent.props) { const k = KV.exec(t); if (k) parent.props[k[1]] = k[2].replace(/^"|"$/g, '') }
  }
  return out
}

/** remove whole blocks (inclusive line ranges) from a layer text; keeps the newline style */
export function removeBlocks(text: string, ranges: [number, number][]): string {
  const nl = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(nl)
  const drop = new Uint8Array(lines.length)
  for (const [a, b] of ranges) for (let i = a; i <= b && i < lines.length; i++) drop[i] = 1
  return lines.filter((_, i) => !drop[i]).join(nl)
}

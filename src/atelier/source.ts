// Where the Atelier reads a project from: the local relay (read + safe writes) or a folder opened in the
// browser with the File System Access API (read-only; corrected files are downloaded instead).
import { BRIDGE_URL } from '../bridge'

export interface TerrainRef { terr: string; dir: string; name: string; dataDir: string; tilePrefix: string; tiles: number }
export interface WorldRef { ent: string; name: string; layersDir: string | null; layers: number; layersSize: number; terrain: string | null }
export interface ProjectInfo {
  root: string; title: string; gproj: string | null; worlds: WorldRef[]; terrains: TerrainRef[]
  topo: string[]; emat: number; mapConfigs: string[]; hasBackups: boolean; workbenchRunning?: boolean
}
export interface FileEntry { path: string; size: number }
export interface Source {
  kind: 'bridge' | 'fsa'
  canWrite: boolean
  info: ProjectInfo
  read(path: string): Promise<{ bytes: Uint8Array; sha: string }>
  list(dir: string, exts: string[]): Promise<FileEntry[]>
  pack(dir: string, ext: string, prefix: string, onProgress?: (i: number, n: number) => void): Promise<{ name: string; bytes: Uint8Array }[]>
}

export async function sha1Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', b as BufferSource)
  return Array.from(new Uint8Array(d), (v) => v.toString(16).padStart(2, '0')).join('')
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
  return body as T
}

// --- relay ---
export async function bridgeAlive(): Promise<boolean> {
  try { return (await fetch(`${BRIDGE_URL}/atelier/status`)).ok } catch { return false }
}
export async function workbenchRunning(): Promise<boolean | null> {
  try { const r = await fetch(`${BRIDGE_URL}/atelier/status`); return r.ok ? !!(await r.json()).workbenchRunning : null } catch { return null }
}

export async function openBridge(path: string): Promise<Source> {
  const info = await json<ProjectInfo>(await fetch(`${BRIDGE_URL}/atelier/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }))
  return {
    kind: 'bridge', canWrite: true, info,
    async read(p) {
      const r = await fetch(`${BRIDGE_URL}/atelier/file?path=${encodeURIComponent(p)}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      return { bytes, sha: r.headers.get('X-Sha1') ?? await sha1Hex(bytes) }
    },
    async list(dir, exts) { return (await json<{ files: FileEntry[] }>(await fetch(`${BRIDGE_URL}/atelier/list?dir=${encodeURIComponent(dir)}&ext=${encodeURIComponent(exts.join(','))}`))).files },
    async pack(dir, ext, prefix) {
      const r = await fetch(`${BRIDGE_URL}/atelier/pack?dir=${encodeURIComponent(dir)}&ext=${encodeURIComponent(ext)}&prefix=${encodeURIComponent(prefix)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return unpack(new Uint8Array(await r.arrayBuffer()))
    },
  }
}

export function unpack(b: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder(), out: { name: string; bytes: Uint8Array }[] = []
  for (let o = 0; o + 8 <= b.length; ) {
    const nl = d.getUint32(o, true), name = dec.decode(b.subarray(o + 4, o + 4 + nl)), s = d.getUint32(o + 4 + nl, true)
    out.push({ name, bytes: b.subarray(o + 8 + nl, o + 8 + nl + s) }); o += 8 + nl + s
  }
  return out
}

export interface WriteResult { ok: boolean; backup: string | null; sha: string }
export async function bridgeWrite(path: string, data: string | Uint8Array, sha: string | null): Promise<WriteResult> {
  const body: Record<string, unknown> = { path, sha }
  if (typeof data === 'string') body.text = data
  else { let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000)); body.base64 = btoa(s) }
  return json(await fetch(`${BRIDGE_URL}/atelier/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}
export interface Backup { stamp: string; file: string; size: number; current: 'original' | 'written' | 'changed' | 'missing' }
export async function bridgeBackups(): Promise<Backup[]> { return (await json<{ backups: Backup[] }>(await fetch(`${BRIDGE_URL}/atelier/backups`))).backups }
export async function bridgeRestore(stamp: string, file: string, force = false) {
  return json(await fetch(`${BRIDGE_URL}/atelier/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stamp, file, force }) }))
}

// --- File System Access API (read-only) ---
type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }
export const fsaSupported = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

export async function openFsa(): Promise<Source> {
  const root = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'read' })
  const files = new Map<string, FileSystemFileHandle>(), dirs = new Map<string, DirHandle>()
  const SKIP = new Set(['_originaux', '.git', 'Navmesh', '.EditorData'])
  const walk = async (d: DirHandle, prefix: string, depth: number) => {
    dirs.set(prefix, d)
    for await (const [name, h] of d.entries()) {
      const p = prefix ? prefix + '/' + name : name
      if (h.kind === 'directory') { if (!SKIP.has(name) && depth < 8) { if (name === '.Data') dirs.set(p, h as DirHandle); else await walk(h as DirHandle, p, depth + 1) } }
      else if (/\.(ent|layer|terr|topo|emat|conf|gproj)$/i.test(name)) files.set(p, h as FileSystemFileHandle)
    }
  }
  await walk(root, '', 0)
  const paths = [...files.keys()], by = (e: string) => paths.filter((p) => p.toLowerCase().endsWith(e))
  const terrains: TerrainRef[] = []
  for (const terr of by('.terr')) {
    const dir = terr.includes('/') ? terr.slice(0, terr.lastIndexOf('/')) : '', name = terr.split('/').pop()!.replace(/\.terr$/i, '')
    let tiles = 0
    const data = dirs.get(dir ? dir + '/.Data' : '.Data')
    if (data) for await (const [n] of data.entries()) if (n.startsWith(name + '_') && n.endsWith('.ttile')) tiles++
    terrains.push({ terr, dir, name, dataDir: dir ? dir + '/.Data' : '.Data', tilePrefix: name + '_', tiles })
  }
  const worlds: WorldRef[] = by('.ent').map((ent) => {
    const base = ent.slice(0, -4), name = base.split('/').pop()!, layersDir = dirs.has(base + '_Layers') ? base + '_Layers' : null
    const layers = layersDir ? paths.filter((p) => p.startsWith(layersDir + '/') && p.endsWith('.layer')) : []
    return { ent, name, layersDir, layers: layers.length, layersSize: 0, terrain: (terrains.find((t) => t.name === name) ?? terrains.find((t) => t.dir.startsWith(base)))?.terr ?? null }
  })
  const info: ProjectInfo = { root: root.name, title: root.name, gproj: by('.gproj')[0] ?? null, worlds, terrains, topo: by('.topo'), emat: by('.emat').length, mapConfigs: by('.conf').filter((p) => /map/i.test(p)), hasBackups: false }
  const readHandle = async (h: FileSystemFileHandle) => new Uint8Array(await (await h.getFile()).arrayBuffer())
  return {
    kind: 'fsa', canWrite: false, info,
    async read(p) { const h = files.get(p); if (!h) throw new Error('not found: ' + p); const bytes = await readHandle(h); return { bytes, sha: await sha1Hex(bytes) } },
    async list(dir, exts) { return paths.filter((p) => p.startsWith(dir + '/') && exts.some((e) => p.toLowerCase().endsWith(e))).map((path) => ({ path, size: 0 })) },
    async pack(dir, ext, prefix, onProgress) {
      const d = dirs.get(dir); if (!d) return []
      const hs: [string, FileSystemFileHandle][] = []
      for await (const [n, h] of d.entries()) if (h.kind === 'file' && n.toLowerCase().endsWith(ext) && n.startsWith(prefix)) hs.push([n, h as FileSystemFileHandle])
      const out = []
      for (let i = 0; i < hs.length; i++) { out.push({ name: hs[i][0], bytes: await readHandle(hs[i][1]) }); onProgress?.(i, hs.length) }
      return out
    },
  }
}

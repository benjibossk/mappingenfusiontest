// Several projects (Giorbev's "Projets" level, vision-globale-mappingenfusion.md): each project is one record
// { id, name, created, updated, data } where `data` is the portable project file (islandProject(), versioned,
// no machine path). What belongs to this machine only (the Workbench project the map is written to) is kept
// apart, per project id, in `localLink` and never travels with an export / a share.
// Storage is a small key-value backend: IndexedDB in the browser, a Map in the tests.

export interface ProjectRecord { id: string; name: string; created: number; updated: number; data: unknown }
export interface ProjectMeta { id: string; name: string; created: number; updated: number }
/** what this machine associates with a project (not exported) */
export interface LocalLink { wbProject?: string; world?: string }

export interface KV {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>()
  return {
    get: async (k) => structuredClone(m.get(k)),
    set: async (k, v) => { m.set(k, structuredClone(v)) },
    del: async (k) => { m.delete(k) },
    keys: async () => [...m.keys()],
  }
}

/** IndexedDB key-value store (one object store); null when IndexedDB is unavailable (private window) */
export function indexedKV(dbName = 'reforger-mapper-projects', store = 'projects'): KV | null {
  if (typeof indexedDB === 'undefined') return null
  let dbp: Promise<IDBDatabase> | null = null
  const db = () => (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(dbName, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => db().then((d) => new Promise<T>((res, rej) => {
    const q = f(d.transaction(store, mode).objectStore(store))
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  }))
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)).then(() => undefined),
    del: (k) => run('readwrite', (s) => s.delete(k)).then(() => undefined),
    keys: () => run('readonly', (s) => s.getAllKeys()).then((a) => a.map(String)),
  }
}

const P = 'project:', L = 'link:', ACTIVE = 'active'

export function newProjectId(now = Date.now(), rnd = Math.random()): string {
  return `p${now.toString(36)}${Math.floor(rnd * 1e6).toString(36)}`
}

export class ProjectStore {
  private kv: KV
  private now: () => number
  constructor(kv: KV, now: () => number = () => Date.now()) { this.kv = kv; this.now = now }

  /** every project, most recently updated first (no data) */
  async list(): Promise<ProjectMeta[]> {
    const out: ProjectMeta[] = []
    for (const k of await this.kv.keys()) {
      if (!k.startsWith(P)) continue
      const r = (await this.kv.get(k)) as ProjectRecord | undefined
      if (r) out.push({ id: r.id, name: r.name, created: r.created, updated: r.updated })
    }
    return out.sort((a, b) => b.updated - a.updated)
  }
  async recent(n = 3): Promise<ProjectMeta[]> { return (await this.list()).slice(0, n) }
  async get(id: string): Promise<ProjectRecord | null> { return ((await this.kv.get(P + id)) as ProjectRecord | undefined) ?? null }

  async create(name: string, data: unknown = null): Promise<ProjectRecord> {
    const t = this.now()
    const r: ProjectRecord = { id: newProjectId(t), name: name.trim() || 'Sans nom', created: t, updated: t, data }
    await this.kv.set(P + r.id, r)
    return r
  }
  /** saves the project file of an existing project (autosave) */
  async save(id: string, data: unknown): Promise<void> {
    const r = await this.get(id)
    if (!r) throw new Error(`unknown project ${id}`)
    r.data = data; r.updated = this.now()
    await this.kv.set(P + id, r)
  }
  async rename(id: string, name: string): Promise<void> {
    const r = await this.get(id)
    if (!r) return
    r.name = name.trim() || r.name; r.updated = this.now()
    await this.kv.set(P + id, r)
  }
  async duplicate(id: string, name?: string): Promise<ProjectRecord | null> {
    const r = await this.get(id)
    if (!r) return null
    return this.create(name ?? `${r.name} (copie)`, r.data)
  }
  async remove(id: string): Promise<void> {
    await this.kv.del(P + id); await this.kv.del(L + id)
    if ((await this.activeId()) === id) await this.kv.del(ACTIVE)
  }

  async activeId(): Promise<string | null> { return ((await this.kv.get(ACTIVE)) as string | undefined) ?? null }
  async setActive(id: string): Promise<void> { await this.kv.set(ACTIVE, id) }

  async link(id: string): Promise<LocalLink> { return ((await this.kv.get(L + id)) as LocalLink | undefined) ?? {} }
  async setLink(id: string, link: LocalLink): Promise<void> { await this.kv.set(L + id, link) }

  /** portable file of one project (no local link): what "Exporter" writes */
  async exportFile(id: string): Promise<{ kind: 'reforger-mapper-project'; format: 1; name: string; data: unknown } | null> {
    const r = await this.get(id)
    return r ? { kind: 'reforger-mapper-project', format: 1, name: r.name, data: r.data } : null
  }
  /** imports a project file: the wrapped format above, or a bare project file (older exports) */
  async importFile(file: unknown, fallbackName = 'Projet importé'): Promise<ProjectRecord> {
    const f = file as { kind?: string; name?: string; data?: unknown }
    if (f?.kind === 'reforger-mapper-project') return this.create(f.name ?? fallbackName, f.data)
    return this.create(fallbackName, file)
  }

  /** first start with projects: the single autosaved project of older versions becomes "Mon projet" */
  async migrateLegacy(legacy: unknown, name = 'Mon projet'): Promise<ProjectRecord | null> {
    if (!legacy || (await this.list()).length) return null
    const r = await this.create(name, legacy)
    await this.setActive(r.id)
    return r
  }
}

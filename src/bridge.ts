import type { Project } from './project'
import { t } from './i18n'

// bridge/server.mjs, local only
export const BRIDGE_URL = 'http://127.0.0.1:5780'

export interface BridgeStatus {
  bridge: boolean
  workbench: boolean
  detail: string
}

export async function getStatus(): Promise<BridgeStatus> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`)
    const body = await res.json()
    const wb = body.workbench ?? {}
    if (wb.error) return { bridge: true, workbench: false, detail: wb.error }
    return { bridge: true, workbench: true, detail: wb.terrain ? t('status.entities') : t('status.noWorld') }
  } catch {
    return { bridge: false, workbench: false, detail: t('status.bridgeDown') }
  }
}

/** reference map loaded (Everon / Kolguyev / Arland): read-only, nothing may be sent to the Workbench */
export let refReadOnly = false
export const setRefReadOnly = (v: boolean) => { refReadOnly = v }
const guardRef = () => { if (refReadOnly) throw new Error(t('ref.readOnly')) }

export async function sendToWorkbench(project: Project): Promise<string> {
  guardRef()
  const res = await fetch(`${BRIDGE_URL}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`)
  return body.message
}

export interface WorldExport { minX: number; minZ: number; step: number; cols: number; rows: number; ocean: number; heights: number[]; materials: string[]; surfaces: number[] }
export async function getWorld(step: number): Promise<WorldExport> {
  const res = await fetch(`${BRIDGE_URL}/world?step=${step}`)
  const out = await res.json()
  if (!res.ok) throw new Error(out.error ?? out.message ?? `HTTP ${res.status}`)
  return out
}

/** something already in the open world: a prefab object (world box) or a shape with its generators */
export interface ExistingObject { prefab: string; x: number; z: number; yaw: number; box: [number, number, number, number] }
export interface ExistingShape { generators: string[]; closed: boolean; origin: [number, number]; points: [number, number][] }
export interface Existing { objects: ExistingObject[]; shapes: ExistingShape[] }
export async function getExisting(): Promise<Existing> {
  const res = await fetch(`${BRIDGE_URL}/entities`)
  const out = await res.json()
  if (!res.ok) throw new Error(out.error ?? out.message ?? `HTTP ${res.status}`)
  return out
}

export async function getTemplates(): Promise<unknown[]> {
  const res = await fetch(`${BRIDGE_URL}/templates`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function post<T>(route: string, body: unknown): Promise<T> {
  guardRef()
  const res = await fetch(`${BRIDGE_URL}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = await res.json()
  if (!res.ok) throw new Error(out.error ?? out.message ?? `HTTP ${res.status}`)
  return out
}

/** preload surfaces + init surface/normal maps of Worlds/X/X.terr — the world must be CLOSED */
export const prepareSurfaces = (addon: string, world: string) =>
  post<{ added: number; normalsWritten: number }>('/surfaces', { addon, world })

/** writes the height grid and applies it to the OPEN world (MG_ApplyHeightmap) */
export const applyHeightmap = (grid: object) => post<{ message: string }>('/heightmap', grid)

/** writes one mask PNG per surface + <world>_satellite.png, to import by hand in the Workbench */
export const writeMasks = (body: object) =>
  post<{ dir: string; written: string[]; satellite?: { file: string } }>('/masks', body)

/** writes profile/MapGen/ingamemap.png from an RGBA buffer (renderIngameMap in modules/ingameMap.ts) */
export function writeIngameMap(img: { width: number; height: number; data: Uint8ClampedArray }) {
  let bin = ''
  for (let i = 0; i < img.data.length; i += 0x8000) bin += String.fromCharCode(...img.data.subarray(i, i + 0x8000))
  return post<{ file: string; message: string }>('/ingamemap', { width: img.width, height: img.height, rgba: btoa(bin) })
}

/** collects "[MGBench] t=.. fps=.. mem=.." lines of the newest console.log into profile/MapGen/bench/ */
export const collectBench = (gameLogs?: string) =>
  post<{ logs: string[]; samples: number; dir: string; stamp: string }>('/bench', { gameLogs })

/** surface materials declared in the open world's .terr (coverage: null, not readable from the API) */
export async function getMaterials(): Promise<{ terr: string; declared: string[]; coverage: null; coverageNote: string }> {
  const res = await fetch(`${BRIDGE_URL}/materials`)
  const out = await res.json()
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`)
  return out
}

export interface WbCamera { ok: boolean; x: number; y: number; z: number; yaw: number; pitch: number; error?: string }
/** World Editor camera (MG_GetCamera); ok=false when the Workbench is unreachable or no world is open */
export async function getCamera(): Promise<WbCamera> {
  try {
    const res = await fetch(`${BRIDGE_URL}/camera`, { signal: AbortSignal.timeout(2500) })
    return (await res.json()) as WbCamera
  } catch (e) {
    return { ok: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, error: (e as Error).message }
  }
}

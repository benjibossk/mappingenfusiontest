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
    return { bridge: true, workbench: true, detail: t('status.entities', { mode: wb.mode, n: wb.entityCount }) }
  } catch {
    return { bridge: false, workbench: false, detail: t('status.bridgeDown') }
  }
}

export async function sendToWorkbench(project: Project): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`)
  return body.message
}

async function post<T>(route: string, body: unknown): Promise<T> {
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

// Working on one map with several people: a room on the collab server (collab/server.mjs). Every change is
// sent as the whole project (last writer wins, fine for a few mappers); cursors show where the others point.

export interface Peer { id: number; name: string }
export interface RemoteCursor { name: string; x: number; z: number }

export interface CollabEvents {
  project: (p: unknown, from: string) => void
  peers: (peers: Peer[]) => void
  cursors: () => void
  status: (s: 'connected' | 'closed', detail?: string) => void
}

export class Collab {
  readonly cursors = new Map<number, RemoteCursor>()
  private ws: WebSocket
  private id = 0
  private lastCursor = 0

  constructor(url: string, room: string, name: string, key: string, on: CollabEvents) {
    this.ws = new WebSocket(`${url.replace(/\/+$/, '')}/${encodeURIComponent(room)}`)
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'hello', name, key }))
    this.ws.onclose = (e) => on.status('closed', e.reason || undefined)
    this.ws.onerror = () => on.status('closed', url)
    this.ws.onmessage = (e) => {
      let m: any
      try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'welcome') { this.id = m.id; on.status('connected') }
      else if (m.type === 'peers') on.peers((m.peers as Peer[]).filter((p) => p.id !== this.id))
      else if (m.type === 'project' && m.from !== this.id) on.project(m.project, m.name)
      else if (m.type === 'cursor') {
        if (m.gone) this.cursors.delete(m.from)
        else this.cursors.set(m.from, { name: m.name, x: m.x, z: m.z })
        on.cursors()
      }
    }
  }

  get open() { return this.ws.readyState === WebSocket.OPEN }

  sendProject(project: unknown) {
    if (this.open) this.ws.send(JSON.stringify({ type: 'project', project }))
  }

  /** at most 10 per second */
  sendCursor(x: number, z: number) {
    const now = performance.now()
    if (!this.open || now - this.lastCursor < 100) return
    this.lastCursor = now
    this.ws.send(JSON.stringify({ type: 'cursor', x: Math.round(x), z: Math.round(z) }))
  }

  close() { this.ws.close() }
}

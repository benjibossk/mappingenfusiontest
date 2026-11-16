// Direct (peer-to-peer) shared room: no server to host, no port to open. Browsers find each other through
// public Nostr relays (Trystero's default strategy: dozens of independent relays, plain wss:// that passes
// most firewalls, no tracker to be down) and then talk over WebRTC DataChannels. The room key is Trystero's
// password: every signalling payload is encrypted with it, so a wrong key never even gets a connection; on
// top of that each pair of peers proves the key to each other with an HMAC challenge before any map data
// is sent. Public STUN (Google, Cloudflare) finds the way through home routers; no TURN unless the user
// gives one (advanced settings), so some strict networks (corporate, some 4G) cannot connect: the UI then
// proposes the server mode (src/collab.ts).
//
// Host model: the peer that joined first (smallest join time, then peer id: the same answer on every peer)
// is the host. It stamps the ops log and sends the full state (project + ops) to anyone who joins. Every
// peer keeps a copy (ops broadcast to all, project too), saved in IndexedDB per room, so when the host
// leaves the next oldest simply takes over with its copy, and a re-opened room resumes.

import { joinRoom } from 'trystero'
import type { CollabEvents, CollabTransport, Op, Peer, RemoteCursor } from './collab'

const APP_ID = 'reforger-mapper.p2p.v1'
const CHUNK = 48 * 1024 // characters per DataChannel message; Trystero frames further, this keeps memory flat
const FAIL_MS = 15000

export interface TurnSettings { url: string; user?: string; pass?: string }

interface PeerState { name: string; joinedAt: number; verified: boolean; nonce: string; seen: number }
type Msg =
  | { t: 'chal'; nonce: string }
  | { t: 'resp'; mac: string; name: string; joinedAt: number }
  | { t: 'sync'; project: unknown; ops: Op[]; name: string }
  | { t: 'project'; project: unknown; name: string }
  | { t: 'op'; op: Op }
  | { t: 'cursor'; x: number; z: number } | { t: 'gone' } | { t: 'bye' } | { t: 'ping' }

// --- small IndexedDB store: one record per room {project, ops} ---
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('reforger-mapper-p2p', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('rooms')
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
    } catch { res(null) }
  })
}
async function loadRoom(room: string): Promise<{ project?: unknown; ops?: Op[] } | null> {
  const db = await idb()
  if (!db) return null
  return new Promise((res) => {
    try {
      const q = db.transaction('rooms').objectStore('rooms').get(room)
      q.onsuccess = () => res(q.result ?? null)
      q.onerror = () => res(null)
    } catch { res(null) }
  })
}
async function saveRoom(room: string, data: { project?: unknown; ops: Op[] }) {
  const db = await idb()
  try { db?.transaction('rooms', 'readwrite').objectStore('rooms').put(data, room) } catch { /* storage blocked or full */ }
}

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
/** a new room: short code to read aloud, long key (the password) */
export function newRoom() { return { code: rand(8), key: rand(20) } }

async function hmac(key: string, text: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

export class P2PCollab implements CollabTransport {
  readonly cursors = new Map<number | string, RemoteCursor>()
  readonly direct = true
  private room: ReturnType<typeof joinRoom>
  private sendRaw: (d: { id: string; i: number; n: number; d: string }, o?: { target?: string | string[] | null }) => Promise<void>
  private peers = new Map<string, PeerState>()
  private parts = new Map<string, string[]>()
  private joinedAt = Date.now()
  private ops: Op[] = []
  private project: unknown = null
  private synced: boolean
  private wasHost = false
  private closed = false
  private failTimer = 0
  private lastCursor = 0
  private saveTimer = 0
  private beat = 0
  private onHide = () => {}

  /** creator: true for the browser that made the room (it starts as host, nothing to wait for) */
  private code: string
  private key: string
  private name: string
  private on: CollabEvents

  constructor(code: string, key: string, name: string, creator: boolean, on: CollabEvents, turn?: TurnSettings) {
    this.code = code; this.key = key; this.name = name; this.on = on
    this.synced = creator
    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]
    if (turn?.url) iceServers.push({ urls: turn.url, username: turn.user || undefined, credential: turn.pass || undefined })
    this.room = joinRoom({ appId: APP_ID, password: key, identity: 'none', rtcConfig: { iceServers } }, 'room-' + code)
    const act = this.room.makeAction<{ id: string; i: number; n: number; d: string }>('m')
    this.sendRaw = act.send
    act.onMessage((c, ctx) => this.receiveChunk(c, ctx.peerId))
    this.room.onPeerJoin(({ peerId }) => {
      const nonce = rand(24)
      this.peers.set(peerId, { name: '?', joinedAt: Infinity, verified: false, nonce, seen: Date.now() })
      void this.send({ t: 'chal', nonce }, peerId)
    })
    this.room.onPeerLeave(({ peerId }) => this.drop(peerId))
    // a closed tab or a lost network does not always say goodbye: heartbeat, and drop the silent ones
    // (so a host that vanished is replaced within ~10 s and newcomers still get synced)
    this.beat = window.setInterval(() => {
      void this.send({ t: 'ping' }, this.verified())
      for (const [id, p] of this.peers) if (Date.now() - p.seen > 10000) this.drop(id)
    }, 3000)
    this.onHide = () => { void this.send({ t: 'bye' }, this.verified()) }
    window.addEventListener('pagehide', this.onHide)
    void loadRoom(code).then((saved) => {
      if (this.closed || !saved) return
      // a re-opened room: our own copy first, the host's (if any) replaces it when it arrives
      if (saved.ops?.length && !this.ops.length) { this.ops = saved.ops; on.ops?.(this.ops, true) }
      if (creator && saved.project && this.project == null) { this.project = saved.project; on.project(saved.project, '💾') }
    })
    // events after the constructor returns, so the caller already holds this object
    queueMicrotask(() => { on.status('connecting'); if (creator && !this.closed) on.status('connected') })
    if (!creator) this.failTimer = window.setTimeout(() => { if (!this.synced && !this.closed) on.status('failed') }, FAIL_MS)
    this.changed()
  }

  get open() { return this.synced && !this.closed }
  get isHost() { return this.host() === null }

  /** the oldest verified peer, or null when that is this browser */
  private host(): string | null {
    let best: string | null = null, bt = this.joinedAt, bid = '~self'
    for (const [id, p] of this.peers) {
      if (!p.verified) continue
      if (p.joinedAt < bt || (p.joinedAt === bt && id < bid)) { best = id; bt = p.joinedAt; bid = id }
    }
    return best
  }

  private drop(peerId: string) {
    const was = this.peers.get(peerId)
    this.peers.delete(peerId)
    if (this.cursors.delete(peerId)) this.on.cursors()
    if (was?.verified) this.changed()
  }

  private verified() { return [...this.peers].filter(([, p]) => p.verified).map(([id]) => id) }

  private changed() {
    const ps: Peer[] = [...this.peers].filter(([, p]) => p.verified).map(([id, p]) => ({ id, name: p.name }))
    this.on.peers(ps)
    const h = this.isHost
    if (h !== this.wasHost) { this.wasHost = h; this.on.host?.(h) }
  }

  private async send(m: Msg, target?: string | string[]) {
    if (this.closed) return
    if (Array.isArray(target) && !target.length) return
    const s = JSON.stringify(m)
    const id = rand(10), n = Math.max(1, Math.ceil(s.length / CHUNK))
    for (let i = 0; i < n; i++) {
      try { await this.sendRaw({ id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }, { target: target ?? null }) } catch { return }
    }
  }

  private receiveChunk(c: { id: string; i: number; n: number; d: string }, from: string) {
    if (!c || typeof c.id !== 'string' || typeof c.d !== 'string' || !(c.n >= 1 && c.n < 100000)) return
    const k = from + c.id
    let arr = this.parts.get(k)
    if (!arr) { arr = new Array(c.n); this.parts.set(k, arr) }
    arr[c.i] = c.d
    for (let i = 0; i < c.n; i++) if (arr[i] === undefined) return
    this.parts.delete(k)
    let m: Msg
    try { m = JSON.parse(arr.join('')) } catch { return }
    void this.receive(m, from)
  }

  private async receive(m: Msg, from: string) {
    const p = this.peers.get(from)
    if (!p) return
    p.seen = Date.now()
    if (m.t === 'chal') {
      void this.send({ t: 'resp', mac: await hmac(this.key, 'reforger-mapper|' + m.nonce), name: this.name, joinedAt: this.joinedAt }, from)
      return
    }
    if (m.t === 'resp') {
      // the nonce is fresh per peer and never reused, so an answer cannot be replayed
      if (m.mac !== await hmac(this.key, 'reforger-mapper|' + p.nonce)) { this.peers.delete(from); return }
      p.verified = true; p.name = String(m.name).slice(0, 40); p.joinedAt = Number(m.joinedAt) || Date.now()
      this.changed()
      // the host gives the newcomer everything it has
      if (this.isHost && this.synced) void this.send({ t: 'sync', project: this.project, ops: this.ops, name: this.name }, from)
      return
    }
    if (!p.verified) return // nothing from a peer that has not proven the key
    if (m.t === 'sync') {
      if (this.host() !== from && this.synced) return // only the current host's copy counts once we are in
      this.ops = Array.isArray(m.ops) ? m.ops : []
      this.on.ops?.(this.ops, true)
      if (m.project != null) { this.project = m.project; this.on.project(m.project, m.name) }
      this.persist()
      if (!this.synced) { this.synced = true; clearTimeout(this.failTimer); this.on.status('connected') }
    } else if (m.t === 'project') {
      this.project = m.project
      this.on.project(m.project, m.name)
      this.persist()
    } else if (m.t === 'op') {
      this.acceptOp(m.op)
    } else if (m.t === 'cursor') {
      this.cursors.set(from, { name: p.name, x: m.x, z: m.z }); this.on.cursors()
    } else if (m.t === 'gone') {
      this.cursors.delete(from); this.on.cursors()
    } else if (m.t === 'bye') {
      this.drop(from)
    }
  }

  /** the host stamps and relays; everyone keeps a copy so the next host has the whole log */
  private acceptOp(op: Op) {
    if (!op || typeof op.id !== 'string' || this.ops.some((o) => o.id === op.id)) return
    const o: Op = { ...op, local: undefined }
    if (this.isHost) { o.at = Date.now(); void this.send({ t: 'op', op: o }, this.verified()) }
    this.ops.push(o)
    if (this.ops.length > 2000) this.ops = this.ops.slice(-2000)
    this.on.ops?.([o], false)
    this.persist()
  }

  private persist() {
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void saveRoom(this.code, { project: this.project, ops: this.ops }), 800)
  }

  sendProject(project: unknown) {
    if (!this.open) return
    this.project = project
    this.persist()
    void this.send({ t: 'project', project, name: this.name }, this.verified())
  }

  sendOp(op: Partial<Op>) {
    if (!this.open) return
    const h = this.host()
    if (h === null) this.acceptOp(op as Op)
    else void this.send({ t: 'op', op: op as Op }, h)
  }

  /** at most 10 per second */
  sendCursor(x: number, z: number) {
    const now = performance.now()
    if (!this.open || now - this.lastCursor < 100) return
    this.lastCursor = now
    void this.send({ t: 'cursor', x: Math.round(x), z: Math.round(z) }, this.verified())
  }

  close() {
    if (this.closed) return
    clearTimeout(this.failTimer)
    clearInterval(this.beat)
    window.removeEventListener('pagehide', this.onHide)
    void this.send({ t: 'bye' }, this.verified())
    this.closed = true
    void saveRoom(this.code, { project: this.project, ops: this.ops })
    void this.room.leave()
    this.on.status('closed')
  }
}

// Atelier ↔ collaboration comments (src/collab.ts Op kind 'comment', x/z world metres).
// main.ts owns the room (collab instance + ops list). It can register a live hook:
//   import { registerAtelierCollab, notifyAtelierCollab } from './atelier/networks/comments'
//   registerAtelierCollab({ add: (x, z, text) => addOp({ kind: 'comment', text, x, z }), list: () => ops })
//   …and call notifyAtelierCollab() at the end of receiveOps() / addOp().
// Without the hook (today), comments go through the same local op store main.ts uses (OPS_KEY, local: true):
// main.ts loads them and sends them to the room on its next (re)connection (receiveOps replays local ops).
import type { Op } from '../../collab.ts'

export interface AtelierCollab { add(x: number, z: number, text: string): void; list(): Op[] }
const OPS_KEY = 'reforger-mapper.collab.ops', NAME_KEY = 'reforger-mapper.collab.name'
let hook: AtelierCollab | null = null
const subs = new Set<() => void>()
export function registerAtelierCollab(h: AtelierCollab | null) { hook = h; notifyAtelierCollab() }
export function notifyAtelierCollab() { for (const f of subs) f() }
export function onCommentsChange(f: () => void) { subs.add(f); return () => subs.delete(f) }
export const live = () => !!hook

function stored(): Op[] { try { const v = JSON.parse(localStorage.getItem(OPS_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

export interface PinComment { id: string; x: number; z: number; text: string; author: string; at: number; resolved: boolean; replies: number; local: boolean }
export function comments(): PinComment[] {
  const ops = hook ? hook.list() : stored(), m = new Map<string, PinComment>()
  for (const o of ops) {
    if (o.kind === 'comment' && Number.isFinite(o.x) && Number.isFinite(o.z)) m.set(o.id, { id: o.id, x: o.x!, z: o.z!, text: o.text ?? '', author: o.author, at: o.at, resolved: false, replies: 0, local: !!o.local })
    else if (o.kind === 'reply' && o.ref && m.has(o.ref)) m.get(o.ref)!.replies++
    else if (o.kind === 'resolve' && o.ref && m.has(o.ref)) m.get(o.ref)!.resolved = o.resolved !== false
  }
  return [...m.values()]
}
export function addComment(x: number, z: number, text: string) {
  if (hook) { hook.add(x, z, text); notifyAtelierCollab(); return }
  let author = 'Atelier'; try { author = (localStorage.getItem(NAME_KEY) ?? '').trim() || author } catch { /* */ }
  const op: Op = { id: 'l' + Math.random().toString(36).slice(2, 10), kind: 'comment', author, at: Date.now(), text, x, z, local: true }
  try { localStorage.setItem(OPS_KEY, JSON.stringify([...stored(), op].slice(-500))) } catch { /* storage blocked */ }
  notifyAtelierCollab()
}

// Composition importer: a Workbench composition prefab (.et = a parent entity with child entities,
// coords relative to the parent — the "Casseburne" method: objects under a GenericEntity, dragged
// into the resource browser) -> a Composition (library parcel template). Pure, no DOM.
// Handles inline children ("Type : "{GUID}path" { ... }"), "$grp" groups (one prefab, several
// anonymous instances) and nested sub-children (transforms composed). Only GUIDs / paths /
// positions are kept, never game data.

import { own, floats, splitLines, tree, type LNode } from '../atelier/formats/layer.ts'
import type { Composition, CompoItem } from './schema.ts'

const HEAD = /^(\$grp\s+)?(\w+)(?:\s*:\s*"(\{[0-9A-Fa-f]{16}\}[^"]+)")?$/

export interface ParsedComposition { root: string | null; items: CompoItem[] }

interface Xf { x: number; z: number; y: number; yaw: number; s: number }
const rot = (p: Xf, lx: number, ly: number, lz: number) => {
  const a = (p.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  lx *= p.s; ly *= p.s; lz *= p.s
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, y: p.y + ly }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** parse the text of a composition .et (root entity + children) */
export function parseComposition(text: string): ParsedComposition {
  const { lines } = splitLines(text.replace(/^﻿/, ''))
  const top = tree(lines).kids.find((k) => HEAD.test(k.head))
  if (!top) throw new Error('not an entity file (.et): no "Type : \\"{GUID}path\\" {" block')
  const items: CompoItem[] = []
  const rootRef = HEAD.exec(top.head)![3] ?? null
  const rootScale = Number(own(lines, top).scale ?? 1) || 1
  const origin: Xf = { x: 0, y: 0, z: 0, yaw: 0, s: rootScale }
  // the parent itself is an object when it is a real prefab (not an empty GenericEntity / composition base)
  if (rootRef && !/Compositions\//i.test(rootRef)) items.push({ prefab: rootRef, x: 0, y: 0, z: 0, yaw: 0, ...(rootScale !== 1 ? { scale: rootScale } : {}) })

  const instance = (n: LNode, prefab: string | null, parent: Xf) => {
    const kv = own(lines, n)
    const [lx, ly, lz] = floats(kv.coords) ?? [0, 0, 0]
    const ang = floats(kv.angles) ?? [0, 0, 0]
    const sc = Number(kv.scale ?? 1) || 1
    const p = rot(parent, lx, ly, lz)
    const me: Xf = { ...p, yaw: parent.yaw + ang[1], s: parent.s * sc }
    if (prefab) {
      const it: CompoItem = { prefab, x: r3(p.x), y: r3(p.y), z: r3(p.z), yaw: r3(((me.yaw % 360) + 540) % 360 - 180) }
      if (Math.abs(me.s - 1) > 1e-3) it.scale = r3(me.s)
      items.push(it)
    }
    children(n, me)
  }
  const children = (n: LNode, xf: Xf) => {
    for (const box of n.kids) if (box.head === '') for (const k of box.kids) entity(k, xf)
  }
  const entity = (k: LNode, xf: Xf) => {
    const m = HEAD.exec(k.head)
    if (!m || k.head === '' || ['components', 'editorData'].includes(k.head)) return
    if (m[1]) { for (const inst of k.kids) if (inst.head === '') instance(inst, m[3] ?? null, xf) }
    else instance(k, m[3] ?? null, xf)
  }
  children(top, origin)
  return { root: rootRef, items }
}

/** bounding box of the items (x / z, metres) */
export function itemBounds(items: CompoItem[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const i of items) { minX = Math.min(minX, i.x); maxX = Math.max(maxX, i.x); minZ = Math.min(minZ, i.z); maxZ = Math.max(maxZ, i.z) }
  if (!items.length) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  return { minX, maxX, minZ, maxZ }
}

export type CompositionMeta = Pick<Composition, 'id' | 'name' | 'biomes' | 'tags' | 'source' | 'author' | 'licence'> & { ref?: string }

/** .et text -> Composition: items re-centred on their bounding box, size = box + 1 m margin */
export function importComposition(text: string, meta: CompositionMeta): Composition {
  const p = parseComposition(text)
  if (!p.items.length) throw new Error('composition has no child entity with a prefab')
  const b = itemBounds(p.items)
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  const items = p.items.map((i) => ({ ...i, x: r3(i.x - cx), z: r3(i.z - cz) }))
  return {
    ...meta,
    size: { w: r3(b.maxX - b.minX + 2), d: r3(b.maxZ - b.minZ + 2) },
    items,
  }
}

/** a kebab-case id from a file name ("Crate_Firewood_01.et" -> "crate-firewood-01") */
export const compoId = (file: string) =>
  file.replace(/^.*[\\/]/, '').replace(/\.et$/i, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'composition'

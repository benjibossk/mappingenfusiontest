// 3D view (view3d): bridge decks, railings and piers as boxes from the real prefab dims (catalogue).
// Pure (no DOM), so the deck pose can be tested against the road it carries.
import { prefabDims } from '../library/dims'
import type { ProjectEntity } from '../project'

export interface BridgeBox { cx: number; cz: number; w: number; d: number; h: number; yaw: number; toGround?: boolean }

/** 3D bridge parts from the real prefab dims (catalogue): deck slab + two railings per deck piece, piers
 *  down to the ground. Entity origin conventions of bridges.ts: deck top = origin + 0.13 (slab 1.43 m),
 *  pillar top = origin + 7.05. Prefab local X (w) runs along the deck: world (cos yaw, -sin yaw). */
export function bridgeParts(ents: ProjectEntity[], ground: (x: number, z: number) => number): { boxes: { cx: number; cz: number; w: number; d: number; h: number; yaw: number; toGround?: boolean }[]; top: number[] } {
  const boxes: { cx: number; cz: number; w: number; d: number; h: number; yaw: number; toGround?: boolean }[] = [], top: number[] = []
  for (const b of ents) {
    const yd = ((b.yaw ?? 0) * Math.PI) / 180, ux = Math.cos(yd), uz = -Math.sin(yd), vx = Math.sin(yd), vz = Math.cos(yd)
    const dm = prefabDims(b.prefab), y0 = b.ycm !== undefined ? b.ycm / 100 : ground(b.x, b.z)
    const w = dm?.w ?? 16, d = dm?.dz ?? 8, cx = b.x + ux * (dm?.cx ?? 0) + vx * (dm?.cz ?? 0), cz = b.z + uz * (dm?.cx ?? 0) + vz * (dm?.cz ?? 0)
    const yaw = -yd
    if (/PILLAR/i.test(b.id ?? '')) { boxes.push({ cx, cz, w: Math.min(w, 2.5), d: d * 0.85, h: 0, yaw, toGround: true }); top.push(y0 + 7.05); continue }
    const isWood = /Wooden/i.test(b.prefab)
    const t = y0 + (isWood ? (dm?.h ?? 2) * 0.2 : 0.13), slab = isWood ? 0.5 : Math.min(1.43, dm?.h ?? 1.43)
    // long axis: the larger of w / d (wooden pier bridges run along their local Z)
    const along = w >= d ? { len: w, wid: d, ax: ux, az: uz, px: vx, pz: vz, yw: yaw } : { len: d, wid: w, ax: vx, az: vz, px: ux, pz: uz, yw: yaw - Math.PI / 2 }
    boxes.push({ cx, cz, w: along.len, d: along.wid, h: slab, yaw: along.yw }); top.push(t)
    for (const sg of [1, -1]) { boxes.push({ cx: cx + along.px * sg * (along.wid / 2 - 0.2), cz: cz + along.pz * sg * (along.wid / 2 - 0.2), w: along.len, d: 0.3, h: 1, yaw: along.yw }); top.push(t + 1) }
    if (isWood) { boxes.push({ cx, cz, w: 1, d: along.wid * 0.8, h: 0, yaw: along.yw, toGround: true }); top.push(t - slab) }
  }
  return { boxes, top }
}

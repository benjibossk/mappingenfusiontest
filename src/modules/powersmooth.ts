// Power line finishing (powergrid.ts): where a line touches a transformer station, and a path smoothing
// pass that removes the zigzag of tightly spaced poles left by the grid A* (corners on 16 m cells).
//
// Station attachment points: read from the vanilla prefabs (base game data via game_read, 2026-11), the
// SCR_PowerPole / SCR_JunctionPowerPole children and their SCR_PoleCableSlot positions, local frame
// (x right, z forward = gate side in powergrid.ts), metres from the entity origin. One point per slot
// group = the middle of its slots (the generator hangs the 3 phases from there).
//   TransformerStation110kV_E_01_simple_v1  portal slots (3.52 | 0.1 | -3.5, 10.15, -11.65): back side
//   TransformerSubstation_01                junction pole at the origin: HV in at z +2.25 (0.29, 6.66, 2.25),
//                                           out ("OTHER_LINE") at z -2.21 (-0.26, 6.01, -2.21)
//   TransformerStation_E_02 / _USSR_02      junction pole at (-4.505, 9.102, -1.483) yaw 90, slots at local
//                                           z -1.88 -> parent x -6.39, z -1.48 (west wall)
//   TransformerStation110kV_E_01_double     (EHV) placed by the EHV generator itself: lines end on its centre
// Anything else (no pole data) falls back to the station centre.

export interface AttachDef { pts: [number, number][]; y: number }

export const STATION_ATTACH: Record<string, AttachDef> = {
  '{BE3D31D8919CA073}': { pts: [[0.04, -11.65]], y: 10.15 }, // simple_v1
  '{A54F6416C3A6A4D7}': { pts: [[0.24, 2.25], [-0.2, -2.21]], y: 6.4 }, // TransformerSubstation_01
  '{6AD4788522334B53}': { pts: [[-6.39, -1.48]], y: 8.95 }, // TransformerStation_E_02
  '{E5CB175C37DBD3BC}': { pts: [[-6.39, -1.48]], y: 8.95 }, // TransformerStation_USSR_02
}

export interface AttachStation { x: number; z: number; yaw: number; prefab: string; off?: [number, number] }

const guidOf = (prefab: string) => prefab.slice(0, prefab.indexOf('}') + 1)

/** local (prefab frame) -> world, same convention as powergrid.footprint / stationEntities */
function toWorld(st: AttachStation, lx: number, lz: number): [number, number] {
  const [ox, oz] = st.off ?? [0, 0]
  const s = Math.sin(st.yaw), c = Math.cos(st.yaw)
  const ex = st.x - (ox * c + oz * s), ez = st.z - (-ox * s + oz * c) // entity origin
  return [ex + lx * c + lz * s, ez - lx * s + lz * c]
}

/** Attachment point of `st` for a line heading to (tx, tz), plus a lead point out of the yard along the
 *  attachment's outward direction (the route starts there, so the first span leaves the portal straight).
 *  `null` lead = no pole data: the line ends on the station centre. */
export function attachPoint(st: AttachStation, tx: number, tz: number, lead = 15): { at: [number, number]; lead: [number, number] | null } {
  const def = STATION_ATTACH[guidOf(st.prefab)]
  if (!def) return { at: [st.x, st.z], lead: null }
  let best: [number, number] = [st.x, st.z], bl: [number, number] = best, bd = Infinity
  for (const [lx, lz] of def.pts) {
    const at = toWorld(st, lx, lz)
    // outward = the dominant local axis of the slot (a portal on the back wall points -Z, etc.)
    const [nx, nz] = Math.abs(lz) >= Math.abs(lx) ? [0, Math.sign(lz) || 1] : [Math.sign(lx) || 1, 0]
    const o = toWorld(st, lx + nx * lead, lz + nz * lead)
    const d = Math.hypot(o[0] - tx, o[1] - tz)
    if (d < bd) { bd = d; best = at; bl = o }
  }
  return { at: best, lead: bl }
}

/** Remove the zigzag: drop interior corners that make a span shorter than `minSpan` or that barely turn
 *  (< `minTurn` radians), as long as `ok(ax, az, bx, bz)` accepts the straight replacement. End points and
 *  `pin` leading / trailing vertices are kept. Flat x/z in, flat x/z out. */
export function smoothPath(path: number[], minSpan: number, ok: (ax: number, az: number, bx: number, bz: number) => boolean, minTurn = 0.2, pin = 0): number[] {
  const p: [number, number][] = []
  for (let i = 0; i + 1 < path.length; i += 2) {
    const q: [number, number] = [path[i], path[i + 1]]
    if (p.length && Math.hypot(q[0] - p[p.length - 1][0], q[1] - p[p.length - 1][1]) < 0.01) continue
    p.push(q)
  }
  for (let guard = 0; guard < 4 * p.length; guard++) {
    let bi = -1, bs = Infinity
    for (let i = 1 + pin; i < p.length - 1 - pin; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1]
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1])
      let turn = Math.abs(Math.atan2(c[0] - b[0], c[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1]))
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      const short = Math.min(l1, l2)
      if (short >= minSpan && turn >= minTurn) continue
      const s = short / minSpan + turn / minTurn // worst first
      if (s < bs && ok(a[0], a[1], c[0], c[1])) { bs = s; bi = i }
    }
    if (bi < 0) break
    p.splice(bi, 1)
  }
  return p.flat()
}

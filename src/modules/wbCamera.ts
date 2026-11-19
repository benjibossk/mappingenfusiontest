// Workbench camera -> web 2D map. The Workbench world frame IS the generator frame (no offset, no scale,
// +Z = north): shapes/entities in mapgen.json are placed at their raw X/Z, so the camera X/Z is used as is.
// The pitfall is the camera POSITION vs what it LOOKS AT: at 270 m and pitch -47 deg the camera sits ~250 m
// before the target, often above the sea. camLookAt gives the ground point the view centre hits.

export interface CamPose { x: number; y: number; z: number; yaw: number; pitch: number }
export interface MapView { x: number; z: number; mpp: number; width: number; height: number }

/** world X/Z -> canvas pixels (north up), same transform as the map's toScreen */
export function worldToMap(v: MapView, x: number, z: number): [number, number] {
  return [(x - v.x) / v.mpp + v.width / 2, v.height / 2 - (z - v.z) / v.mpp]
}

/** ground point under the view centre (ray march, 2 m steps); null if looking up or nothing hit within maxDist */
export function camLookAt(c: CamPose, ground: (x: number, z: number) => number | undefined, maxDist = 6000): [number, number] | null {
  if (c.pitch >= 0) return null
  const a = (c.yaw * Math.PI) / 180, p = (c.pitch * Math.PI) / 180
  const dx = Math.sin(a) * Math.cos(p), dz = Math.cos(a) * Math.cos(p), dy = Math.sin(p)
  for (let s = 0; s <= maxDist; s += 2) {
    const x = c.x + dx * s, z = c.z + dz * s, g = ground(x, z)
    if (g === undefined) return null
    if (c.y + dy * s <= g) return [x, z]
  }
  return null
}

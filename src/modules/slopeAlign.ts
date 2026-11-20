// Slope alignment of small props and fences (VANILLA_PLACEMENT_OPTIM.md §1): vanilla aligns small props and
// fence pieces to the terrain normal, buildings stay upright (buried foundation). Pitch/roll are measured on
// the heightmap along the prefab's own axes, same convention as SlopeAngles() in MG_ApplyProjectPlugin.c
// (editor X/Z angles turn the other way than MatrixToAngles: hence the minus signs).

import type { ProjectEntity } from '../project'

/** objects that stay vertical: buildings and anything you walk in / on, trees, bridges, lamps, poles */
const UPRIGHT = /Building|House|Barn|Shed|Church|Chapel|Garage|Hangar|Tower|Bridge|Pier|Bunker|Ruin|Station|Tree|\/Vegetation\/Tree|Lamp|Pole|Pylon|Power|Sign|Container|Tank|Silo|Well|Kiosk/i
/** fences, walls, small props and decoration that look wrong standing level on a slope */
const ALIGN = /Fence|Wall|Railing|Gate|Hedge|Props\/|Prop_|Pallet|Crate|Barrel|Bench|Log|Stump|Debris|Litter|Trash|Sandbag|Hay|Woodpile|Wood_?pile|Tire|Bucket|Grave|Tomb|Cross|Rocks\//i
/** tilt cap: beyond it the slope is a cliff, not ground a fence would follow */
export const MAX_TILT = 30

/** should this object follow the slope? (not for buildings, objects at a set height, or unknown kinds) */
export function alignsToSlope(e: Pick<ProjectEntity, 'prefab' | 'id' | 'ycm'>): boolean {
  if (e.ycm) return false
  if (/Structures\/Walls\/|Fence|Railing/i.test(e.prefab)) return true // fence pieces (pole fences too) follow the ground
  if (UPRIGHT.test(e.prefab)) return false
  return ALIGN.test(e.prefab)
}

/** [pitch, roll] in degrees (rounded, capped at MAX_TILT) of the slope under (x, z) for a prefab turned `yaw` */
export function slopeTilt(heightAt: (x: number, z: number) => number, x: number, z: number, yaw: number, d = 2): [number, number] {
  const r = yaw * Math.PI / 180, fx = Math.sin(r), fz = Math.cos(r)
  const sF = (heightAt(x + fx * d, z + fz * d) - heightAt(x - fx * d, z - fz * d)) / (2 * d)
  const sR = (heightAt(x + fz * d, z - fx * d) - heightAt(x - fz * d, z + fx * d)) / (2 * d)
  const cap = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.round(v))) || 0
  return [cap(-Math.atan(sF) * 180 / Math.PI), cap(-Math.atan(sR) * 180 / Math.PI)]
}

/** sets pitch/roll on the objects that follow the slope (explicit values kept, under 1 degree left out) */
export function withSlopeTilt(es: ProjectEntity[], heightAt: (x: number, z: number) => number): ProjectEntity[] {
  return es.map((e) => {
    if (e.pitch !== undefined || e.roll !== undefined || !alignsToSlope(e)) return e
    const [pitch, roll] = slopeTilt(heightAt, e.x, e.z, e.yaw)
    return pitch || roll ? { ...e, pitch, roll } : e
  })
}

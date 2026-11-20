// Rocks on steep ground (VANILLA_PLACEMENT_OPTIM.md §4): vanilla never leaves a bare heightmap face past
// ~40-45 degrees, it lays Rock / Cliff prefabs on it. Here: a jittered grid over the map, kept where the slope
// passes ~37 degrees, away from roads / buildings / water (ok()), big cliff pieces on the steepest cells,
// each one turned to face down the slope.

import type { ProjectEntity } from '../project'
import { mulberry } from './vegLayers'

/** vanilla granite cliff faces and big rocks (GUIDs from PakTools/analyses/base_guidmap.json) */
export const CLIFF_PREFABS = {
  cliff: ['{3F68EE5DCB004B10}Prefabs/Rocks/Granite/GraniteCliff_01.et', '{533CDABD77C4C43E}Prefabs/Rocks/Granite/GraniteCliff_02.et', '{B6A096447B215355}Prefabs/Rocks/Granite/GraniteCliff_03.et'],
  rock: ['{DF692A1784D6B324}Prefabs/Rocks/Granite/GraniteRock_01_V2.et', '{D5CC7A5A32C640A3}Prefabs/Rocks/Granite/GraniteRock_02_V2.et',
    '{ADC53C3320B368DA}Prefabs/Rocks/Granite/Granite_Boulder_01_V2.et', '{A7606C7E96A39B5D}Prefabs/Rocks/Granite/Granite_Boulder_02_V2.et'],
}
/** rise/run: tan 37 deg (rocks), tan 45 deg (cliff faces) */
export const CLIFF_MIN_SLOPE = 0.75
export const CLIFF_FACE_SLOPE = 1

export interface CliffOptions {
  box: { minX: number; minZ: number; maxX: number; maxZ: number }
  heightAt: (x: number, z: number) => number
  ok: (x: number, z: number) => boolean
  seed: number
  /** grid spacing in metres (one rock at most per cell) */
  spacing?: number
  minSlope?: number
  max?: number
  prefix?: string
}

export function cliffRocks(o: CliffOptions): ProjectEntity[] {
  const sp = o.spacing ?? 14, min = o.minSlope ?? CLIFF_MIN_SLOPE, rand = mulberry(o.seed * 17 + 3)
  const out: ProjectEntity[] = []
  const d = 3
  for (let z = o.box.minZ + sp / 2; z < o.box.maxZ; z += sp) {
    for (let x = o.box.minX + sp / 2; x < o.box.maxX; x += sp) {
      if (out.length >= (o.max ?? 4000)) return out
      const px = x + (rand() - 0.5) * sp * 0.6, pz = z + (rand() - 0.5) * sp * 0.6
      if (o.heightAt(px, pz) <= 0.5) continue
      const gx = (o.heightAt(px + d, pz) - o.heightAt(px - d, pz)) / (2 * d), gz = (o.heightAt(px, pz + d) - o.heightAt(px, pz - d)) / (2 * d)
      const s = Math.hypot(gx, gz)
      if (s < min || !o.ok(px, pz)) continue
      const face = s >= CLIFF_FACE_SLOPE
      const set = face ? CLIFF_PREFABS.cliff : CLIFF_PREFABS.rock
      // +Z of the prefab towards the valley: yaw of the downhill direction (-gradient), 0 = north, clockwise
      const yaw = Math.round(((Math.atan2(-gx, -gz) * 180 / Math.PI) + 360 + (rand() - 0.5) * 30) % 360)
      out.push({ id: `${o.prefix ?? 'CLIFF_'}${out.length + 1}`, prefab: set[Math.floor(rand() * set.length)], x: Math.round(px * 100) / 100, z: Math.round(pz * 100) / 100, yaw, role: 'essential' })
    }
  }
  return out
}

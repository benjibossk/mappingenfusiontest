// Object roles: essential (gameplay, cover) / pc (PC-only detail) / clutter (pure decoration).
// Fairness rule: anything that can act as cover is always essential, never dropped on weaker platforms.

import type { ProjectEntity } from '../project'

export type Role = 'essential' | 'pc' | 'clutter'

const ESSENTIAL = /build|house|barn|shed|church|chapel|bridge|pier|wall|fence|gate|bunker|sandbag|hesco|barrier|trench|tower|garage|hangar|rock|boulder|stone_?wall|container|wreck|vehicle|car_|truck|tank|ruin|well|pole|tree/i
const CLUTTER = /grass|flower|fern|weed|clutter|decal_?grass|bush_?small|smallbush|shrub_?small|moss|leaves|reed/i
const PC = /prop|decal|grave|tomb|cross|log|sign|bench|bucket|bottle|crate_?small|litter|trash|debris|pallet|lamp|mailbox|flowerpot|stump|branch|bush/i

/** default role from prefab path and entity id; cover-giving objects win over everything else */
export function roleOf(prefab: string, id = ''): Role {
  const s = prefab + ' ' + id
  if (ESSENTIAL.test(s)) return 'essential'
  if (CLUTTER.test(s)) return 'clutter'
  if (PC.test(s)) return 'pc'
  return 'essential' // unknown: keep it (it might give cover)
}

/** fill in the role of entities that have none (explicit roles are kept) */
export function withRoles(es: ProjectEntity[]): ProjectEntity[] {
  return es.map((e) => (e.role ? e : { ...e, role: roleOf(e.prefab, e.id) }))
}

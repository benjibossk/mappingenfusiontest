// Families sent to the Workbench (name prefix up to the first "_": ROAD_, FOREST_, CLIFF_...). The Apply replaces
// the objects of the families it receives only, so a family a new send no longer has (rocks of an earlier world, of
// a map 2.5 km wide when the new one is 2 km) stayed in the world, floating at the old ground height. The bridge keeps
// the families it sent (profile/MapGen/families.json); a full send ("replaceAll") asks the Apply to clear the others.

/** what the app has ever named its objects with: assumed present when families.json is missing (older sends) */
export const APP_FAMILIES = ["ROAD_", "WATER_", "FOREST_", "FIELD_", "SET_", "CLIFF_", "SCAT_", "TREE_", "POWER_", "PSTA_", "MW_", "IMG_", "VAN_", "PARCEL_",
  "ACCESS_", "SITE_", "RP_", "RIPA_", "REF_", "RB_", "PLANT_", "OSM_", "MIL_", "JCT_", "IND_", "FEEDER_", "FARM_"];

export function familyOf(id) {
  const u = String(id ?? "").indexOf("_");
  return u < 1 ? null : String(id).slice(0, u + 1);
}

/** families of a project's shapes and objects */
export function projectFamilies(project) {
  const out = new Set();
  for (const s of project.shapes ?? []) { const f = familyOf(s.id); if (f) out.add(f); }
  for (const e of project.entities ?? []) { const f = familyOf(e.id); if (f) out.add(f); }
  return [...out];
}

/** families to clear and the families in the world after this send.
 *  stored: families in the world (null = unknown: APP_FAMILIES); keep: families a full send leaves (forests sent later) */
export function familiesPlan(stored, project) {
  const now = projectFamilies(project), was = Array.isArray(stored) ? stored : APP_FAMILIES;
  const keep = new Set((project.keep ?? []).filter((x) => typeof x === "string"));
  if (!project.replaceAll) return { clear: [], after: [...new Set([...was, ...now])] };
  // the record only says what the last send asked for: a family the Workbench failed to delete (PARCEL_ fences
  // floating at sea, 2026-11-26) dropped out of it and was never cleared again. A full send targets every app family.
  const clear = [...new Set([...was, ...APP_FAMILIES])].filter((f) => !now.includes(f) && !keep.has(f));
  return { clear, after: [...new Set([...now, ...was.filter((f) => keep.has(f))])] };
}

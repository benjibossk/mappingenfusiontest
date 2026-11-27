// Navigation in three levels (schema by giorbev, approved by Benji): HOME -> PROJECTS -> DASHBOARD of the
// active project, the dashboard split into 6 sections. Pure data + small helpers (tested in tests/nav.test.ts);
// main.ts turns the actions into clicks on the existing panels, nothing here touches the DOM.

export type Level = 'home' | 'projects' | 'dashboard'
export const SECTIONS = ['terrain', 'atelier', 'masks', 'sat', 'diag', 'share'] as const
export type Section = typeof SECTIONS[number]
export interface NavState { level: Level; section: Section }

/** generator steps (side stepper of main.ts) shown in each section; the others are hidden */
export const SECTION_STEPS: Record<Section, readonly string[]> = {
  terrain: ['island', 'brush'],
  atelier: ['water', 'roads', 'villages', 'camp', 'wb'],
  masks: ['wb'],
  sat: ['camp', 'wb'],
  diag: ['wb'],
  share: [],
}

/**
 * One tile of a section hub. `act` is a token main.ts runs:
 * - `step:<tab>` open that generator step; `click:<id>` click that existing button (after opening `step` if set);
 * - `focus:<id>` open the step and scroll to / open that block; `atelier:<s0-s6|net|tex|zone>` open the Atelier there;
 * - `soon` placeholder (disabled tile). `focus`: a block to bring into view after the click.
 */
export interface Tile { id: string; act: string; step?: string; group?: string; focus?: string }

export const SECTION_TILES: Record<Section, readonly Tile[]> = {
  // 3.1 every path ends in the same terrain (grid, size, origin, coordinates) = the same project
  terrain: [
    { id: 'island', act: 'click:tGen', step: 'island', group: 'create' },
    { id: 'random', act: 'click:tRandom', step: 'island', group: 'create' },
    { id: 'image', act: 'click:tImg', step: 'island', group: 'create', focus: 'imgBox' },
    { id: 'heightmap', act: 'click:tGaea', step: 'island', group: 'import', focus: 'gaeaBox' },
    { id: 'wbWorld', act: 'click:tImport', step: 'island', group: 'import' },
    { id: 'real', act: 'click:tReal', step: 'island', group: 'import' },
    { id: 'gis', act: 'soon', group: 'import' },
    { id: 'sculpt', act: 'step:brush', group: 'edit' },
    { id: 'ref', act: 'focus:tRef', step: 'island', group: 'edit' },
  ],
  // 3.2 the Reforger target must be associated and validated before an export
  atelier: [
    { id: 'assoc', act: 'atelier:s0', group: 'project' },
    { id: 'analyse', act: 'atelier:s1', group: 'project' },
    { id: 'link', act: 'focus:wbProject', step: 'wb', group: 'project' },
    { id: 'water', act: 'step:water', group: 'water' },
    { id: 'atWater', act: 'atelier:s3', group: 'water' },
    { id: 'roads', act: 'step:roads', group: 'net' },
    { id: 'atNet', act: 'atelier:net', group: 'net' },
    { id: 'villages', act: 'step:villages', group: 'build' },
    { id: 'fields', act: 'step:camp', group: 'build' },
    { id: 'atZone', act: 'atelier:zone', group: 'build' },
    { id: 'library', act: 'click:libBtn', group: 'lib' },
    { id: 'plib', act: 'focus:plBox', step: 'villages', group: 'lib' },
    { id: 'export', act: 'step:wb', group: 'export' },
    { id: 'atExport', act: 'atelier:s6', group: 'export' },
  ],
  // 3.3
  masks: [
    { id: 'biomes', act: 'focus:gcBox', step: 'wb' },
    { id: 'atSurf', act: 'atelier:s2' },
    { id: 'classic', act: 'focus:tMasks', step: 'wb' },
    { id: 'automat', act: 'focus:gcSlope', step: 'wb' },
    { id: 'bake', act: 'atelier:tex' },
  ],
  // 3.4
  sat: [
    { id: 'satmap', act: 'focus:satBox', step: 'camp' },
    { id: 'textures', act: 'atelier:tex' },
    { id: 'topo', act: 'focus:tIngame', step: 'wb' },
    { id: 'atMap', act: 'atelier:s4' },
    { id: 'atContours', act: 'atelier:s5' },
    { id: 'water', act: 'atelier:s3' },
  ],
  diag: [
    { id: 'check', act: 'focus:checkBox', step: 'wb' },
    { id: 'gameplay', act: 'focus:gameplayBox', step: 'wb' },
    { id: 'atDiag', act: 'atelier:s1' },
  ],
  share: [
    { id: 'collab', act: 'click:collab' },
    { id: 'export', act: 'click:pSave' },
    { id: 'projects', act: 'level:projects' },
  ],
}

/** the section a generator step belongs to (first match), for the stepper shortcuts and the help panel */
export function sectionOfStep(step: string): Section {
  return SECTIONS.find((s) => SECTION_STEPS[s].includes(step)) ?? 'terrain'
}

export function isSection(v: unknown): v is Section { return typeof v === 'string' && (SECTIONS as readonly string[]).includes(v) }

/** where the app opens: an autosaved terrain lands on its dashboard (the last section), otherwise home */
export function startState(hasTerrain: boolean, saved: unknown): NavState {
  const s = typeof saved === 'string' ? saved : ''
  return hasTerrain ? { level: 'dashboard', section: isSection(s) ? s : 'terrain' } : { level: 'home', section: 'terrain' }
}

/** a step opened while in another section moves the dashboard to that step's section */
export function followStep(st: NavState, step: string): NavState {
  if (SECTION_STEPS[st.section].includes(step)) return st
  return { level: st.level, section: sectionOfStep(step) }
}

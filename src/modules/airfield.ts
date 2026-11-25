// Airfield generator (pure), every type from a large Cold War air base down to a grass strip in a field.
// Option `kind` (military | civil | strip) x `size` (small | medium | large). Everything is laid out in a
// RUNWAY-LOCAL frame: s along the runway axis (local Z), t across it (local X, `side` = the building side),
// then rotated by the runway yaw (toWorld).
//
// LAYOUT (per kind)
//  - military: concrete runway 40 m (vanilla RG_Runway_40m), full parallel taxiway (RG_Runway_20m) at
//    120-150 m centre-to-centre (real bases 150-180 m, scaled down for a game map), 90 deg links at both ends
//    and every 450-500 m, apron beyond the taxiway, parcel rows on the apron (stands / service lane /
//    building band with the hangars and the ops building), dispersal U-loop with hardened aircraft shelters
//    (vanilla AircraftShelter_E_01 = shelter with its earth mound) at the +s end, military tower 300+ m
//    from the axis near mid-runway, isolated fuel depot (>= 50 m from any building), perimeter net fence,
//    inner perimeter road, guard house + bar gate on the access side (the access point).
//  - civil: asphalt runway 20-30 m (RG_Road_Asphalt_E_02 + RoadWidth), short partial taxiway (large /
//    medium) or a turn pad at each end (small), small apron, terminal + car park on the road side, 1-2
//    hangars, small tower (medium), big civil tower (large) or only a windsock (small).
//  - strip: grass (no spline, ground left as is, edge markers AirfieldMark_01) or dirt (RG_Road_Dirt_01 +
//    RoadWidth) 15-20 m x 450-800 m, an open metal shed, windsock, fuel barrels, jerrycans, access point
//    at the shed for a farm track.
// RULES: buildings stay outside the runway strip (stripHalf: 75 m military, 60 m civil, 40 m small civil
// and field strips) and under the 1:7 transition surface (height h needs |t| >= stripHalf + 7 h; planned
// buildings are pushed out to that line, props that break it are rejected). Runway grade <= 1 % (flatten).
// MARKINGS: vanilla decals only. Threshold piano keys (Runway_Line_2x30), designation numbers
// (Runway_Num0-9, from the heading), centreline (decal generator RG_Runway_Line50_01), taxiway yellow
// centreline (RG_Runway_Line50_01_Yellow), holding lines (Runway_Line_WaitStart), worn concrete
// (DecalModel_Runway_Cracks_*), tyre prints on the stands. SKIPPED: closed-runway cross (no vanilla decal).
// UNVERIFIED in the Workbench: RoadWidth on the asphalt / dirt generators at 15-30 m, the facing of the
// shelter door (+Z assumed, like the hangar), the reading direction of the number decals.
// Every prefab below carries its {GUID}; all were checked against the base-game resourceDatabase.rdb
// (2026-11-25) and are listed in AIR_KNOWN_PREFABS (tests check nothing else is emitted).

import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'
import {
  rng, toWorld, heightAt, bestPlane, earthwork, toEntity, roadShape, wallShape, round,
  type Box, type FlattenRequest, type SitePlacement, type Disc,
} from './gen-common'
import { halfDims } from '../library/dims.ts'

export type AirfieldSize = 'small' | 'medium' | 'large'
export type AirfieldKind = 'military' | 'civil' | 'strip'
export const AIRFIELD_KINDS: AirfieldKind[] = ['military', 'civil', 'strip']
export type StripSurface = 'grass' | 'dirt'

/** real half sizes + height from the catalogue dims (.xob bbox), the estimate as fallback */
const air = (p: string, hw: number, hd: number, h: number) => { const d = halfDims(p, hw, hd, h); return { p, hw: d.hw, hd: d.hd, h: d.h || h } }
export const AIR_PREFABS = {
  hangar: air('{CEB1F71D46592F3C}Prefabs/Structures/Airport/Hangar_01/Hangar_01.et', 22, 19, 18.4),
  tower: air('{9CEC8BB63429FF28}Prefabs/Structures/Airport/ControlTower_01/ControlTower_01.et', 9.4, 8.5, 29),
  towerMil: air('{F6FC9703E7F4FDCA}Prefabs/Structures/Military/Houses/ControlTowerMilitary_E_01/ControlTowerMilitary_E_01.et', 8.6, 6.7, 32.3),
  towerSmall: air('{49721D29CCBB820E}Prefabs/Structures/Military/Houses/ControlTowerMilitary_E_02/ControlTowerMilitary_E_02.et', 2.2, 2.6, 12.1),
  shelter: air('{6A8FF322CBD99236}Prefabs/Structures/Military/Bunkers/AircraftShelter_E_01/AircraftShelter_E_01_green.et', 23.4, 29.3, 12.8),
  shelterCamo: air('{C526728F8920399A}Prefabs/Structures/Military/Bunkers/AircraftShelter_E_01/AircraftShelter_E_01_camo_v2.et', 23.4, 29.3, 12.8),
  bunker: air('{8A8A7A558772D718}Prefabs/Structures/Military/Bunkers/AirfieldBunker_E_01/AirfieldBunker_E_01_small.et', 9.7, 13.5, 5.4),
  ops: air('{51F233A0BA73532A}Prefabs/Structures/Industrial/Houses/Office_E_01/Office_E_01.et', 8.5, 7.5, 9),
  terminal: air('{363A616E6C64BB7F}Prefabs/Structures/Services/Government/MunicipalOffice_E_01/MunicipalOffice_E_01.et', 12, 8.9, 12),
  clubhouse: air('{9606669975C97DC9}Prefabs/Structures/Military/Houses/GuardHouse_02/GuardHouse_02_civilian.et', 6.4, 7, 5),
  guardHouse: air('{3F91DEEC9C78E473}Prefabs/Structures/Military/Houses/GuardHouse_01/GuardHouse_01.et', 3.8, 4.5, 4),
  barGate: air('{07F043DD6AACCD0B}Prefabs/Structures/Infrastructure/Barriers/BarGate_01/BarGate_01.et', 4.4, 0.3, 1.5),
  shed: air('{DEBC2FB8DA61B83E}Prefabs/Structures/Industrial/Sheds/ShedMetal_02/ShedMetal_02_short_nowalls.et', 8.1, 5.6, 7.1),
  fuel: air('{D44E66C875C41446}Prefabs/Structures/Industrial/Containers/FuelTanks/FuelTank_01/FuelTank_01_green.et', 2.6, 2.3, 10.2),
  fuelBig: air('{D39297A56E6648F0}Prefabs/Structures/Industrial/Containers/FuelTanks/FuelTank_03/FuelTank_03_green.et', 8, 8.8, 12.6),
  fuelPump: air('{51453500F5727B57}Prefabs/Structures/Industrial/Containers/FuelTanks/FuelTank_02/FuelTank_02_Pump_green.et', 5.6, 1.4, 7),
  pipeShed: air('{DBAFF105C2969F61}Prefabs/Structures/Airport/AirfieldPipeline_01/AirfieldPipeline_01_shed.et', 1.1, 1.6, 4.2),
  pump: air('{69C0826D0263EB72}Prefabs/Structures/Airport/AirfieldPipeline_01/AirfieldPipeline_01_pump.et', 0.6, 0.7, 3.1),
  antenna: air('{53251E86B44EF4F2}Prefabs/Structures/Airport/AntennaAirport_01/AntennaAirport_01.et', 4.4, 4.4, 15.3),
  windsock: air('{02EFED19023C6C3D}Prefabs/Structures/Military/Flags/Windsock_01/Windsock_01.et', 0.5, 0.8, 4.1),
  genUSSR: air('{2FCB46C395C9CBE7}Prefabs/Props/Airport/GeneratorAirfield_USSR_01/GeneratorAirfield_USSR_01.et', 2, 1, 1.8),
  genUS: air('{7F671B405CDBF0A2}Prefabs/Props/Airport/GeneratorAirfield_US_01/GeneratorAirfield_US_01.et', 1.8, 1, 2),
  blast: air('{0831D4051CEB3EC1}Prefabs/Props/Airport/JetBlastDeflector_01/JetBlastDeflector_E_01.et', 2.3, 2, 2.5),
  barrel: air('{4BE795374BE3D67E}Prefabs/Props/Industrial/BarrelFuel_01_closed.et', 0.35, 0.35, 1),
  jerrycan: air('{62B2ADC4243454F9}Prefabs/Props/Civilian/Jerrycan_01.et', 0.1, 0.2, 0.5),
  marker: air('{A72414FEC60F1E7F}Prefabs/Structures/Signs/Airfield/AirfieldMark_01/AirfieldMark_01.et', 0.7, 1.2, 1.2),
  light: air('{8746DE528BA26F02}Prefabs/Structures/Airport/LightRunway_01/LightRunway_01_white.et', 0.2, 0.2, 0.6),
  lightEnd: air('{C1873CADC253F79B}Prefabs/Structures/Airport/LightRunway_01/LightRunway_01_green_red.et', 0.2, 0.2, 0.6),
  lightTaxi: air('{38A8C0CE913C7CEA}Prefabs/Structures/Airport/LightRunway_01/LightRunway_01_blue.et', 0.2, 0.2, 0.6),
  // markings (flat meshes / decals, height 0)
  piano: air('{27DEA1289174B2DA}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Line_2x30.et', 15, 1, 0),
  hold: air('{26649EBE262394AE}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Line_WaitStart.et', 10, 1.1, 0),
  tyres: air('{93B0F2CFAEE378B9}Prefabs/Decals/Markings/Runway/DecalModel_AircraftTirePrints_01_v1.et', 7.9, 3.1, 0),
} as const
/** designation digits 0-9 (Runway_NumN.et), ~3 x 9 m each */
export const AIR_DIGITS = [
  '{B716516F961C0FF7}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num0.et', '{528A1D969AF9989C}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num1.et',
  '{3EDE2976263D17B2}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num2.et', '{DB42658F2AD880D9}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num3.et',
  '{E67640B75FB409EE}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num4.et', '{03EA0C4E53519E85}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num5.et',
  '{6FBE38AEEF9511AB}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num6.et', '{8A227457E37086C0}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num7.et',
  '{15D672DE054C03C5}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num8.et', '{F04A3E2709A994AE}Prefabs/Structures/Infrastructure/Roads/Runway/Runway_Num9.et',
]
export const AIR_CRACKS = [
  '{6655A585AEE41E2E}Prefabs/Decals/Concrete/Damage/DecalModel_Runway_Cracks_01.et',
  '{0A01916512209100}Prefabs/Decals/Concrete/Damage/DecalModel_Runway_Cracks_02.et',
  '{EF9DDD9C1EC5066B}Prefabs/Decals/Concrete/Damage/DecalModel_Runway_Cracks_03.et',
]
/** spline generators: vanilla runway roads (fixed widths 10/20/40 m), roads, decal lines, fence */
export const AIR_GEN = {
  runway40: '{463B1C1172BF1444}Prefabs/WEGenerators/Roads/Concrete/RG_Runway_40m.et',
  runway20: '{FBEB4E960DA4085A}Prefabs/WEGenerators/Roads/Concrete/RG_Runway_20m.et',
  runway10: '{A50367D5B2298655}Prefabs/WEGenerators/Roads/Concrete/RG_Runway_10m.et',
  panel: '{EEB3D2A6FCAADFD6}Prefabs/WEGenerators/Roads/Concrete/RG_Road_ConcretePanel_01.et',
  asphalt: '{1E681E4ED25E5E1F}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_02.et',
  dirt: '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et',
  centre: '{E583F234A3FDB272}Prefabs/WEGenerators/Decals/Runway/RG_Runway_Line50_01.et',
  taxiLine: '{CBFAC6EDC0D57A02}Prefabs/WEGenerators/Decals/Runway/RG_Runway_Line50_01_Yellow.et',
  fence: '{CA5FA41E2FC5DDA1}Prefabs/WEGenerators/Walls/Net/WG_NetFence_USSR_01.et',
}
/** every prefab / generator this module can emit (rdb-verified) */
export const AIR_KNOWN_PREFABS = new Set<string>([...Object.values(AIR_PREFABS).map((p) => p.p), ...AIR_DIGITS, ...AIR_CRACKS, ...Object.values(AIR_GEN)])

export interface AirfieldSpec {
  length: number; width: number; surface: 'concrete' | 'asphalt' | StripSurface
  stripHalf: number
  /** taxiway width and centre-to-centre offset from the runway axis (0 = no taxiway) */
  taxi: number; taxiOff: number
  /** spacing of the intermediate links (0: ends only) */
  linkEvery: number
  apronW: number; apronD: number
  hangars: number; shelters: number
  tower: 'mil' | 'civil' | 'small' | null
  fuelTanks: number
}
const MIL = (length: number, taxiOff: number, linkEvery: number, apronW: number, apronD: number, hangars: number, shelters: number, fuelTanks: number): AirfieldSpec =>
  ({ length, width: 40, surface: 'concrete', stripHalf: 75, taxi: 20, taxiOff, linkEvery, apronW, apronD, hangars, shelters, tower: 'mil', fuelTanks })
export const AIRFIELD_SPECS: Record<AirfieldKind, Record<AirfieldSize, AirfieldSpec>> = {
  military: {
    small: MIL(900, 120, 450, 160, 80, 1, 2, 2),
    medium: MIL(1100, 130, 450, 220, 90, 2, 4, 3),
    large: MIL(1500, 150, 500, 300, 110, 3, 6, 4),
  },
  civil: {
    small: { length: 700, width: 20, surface: 'asphalt', stripHalf: 40, taxi: 0, taxiOff: 0, linkEvery: 0, apronW: 80, apronD: 45, hangars: 1, shelters: 0, tower: null, fuelTanks: 1 },
    medium: { length: 1000, width: 25, surface: 'asphalt', stripHalf: 60, taxi: 10, taxiOff: 90, linkEvery: 0, apronW: 140, apronD: 60, hangars: 2, shelters: 0, tower: 'small', fuelTanks: 2 },
    large: { length: 1300, width: 30, surface: 'asphalt', stripHalf: 60, taxi: 10, taxiOff: 90, linkEvery: 0, apronW: 180, apronD: 70, hangars: 2, shelters: 0, tower: 'civil', fuelTanks: 2 },
  },
  strip: {
    small: { length: 450, width: 15, surface: 'grass', stripHalf: 40, taxi: 0, taxiOff: 0, linkEvery: 0, apronW: 0, apronD: 0, hangars: 0, shelters: 0, tower: null, fuelTanks: 0 },
    medium: { length: 600, width: 18, surface: 'grass', stripHalf: 40, taxi: 0, taxiOff: 0, linkEvery: 0, apronW: 0, apronD: 0, hangars: 0, shelters: 0, tower: null, fuelTanks: 0 },
    large: { length: 800, width: 20, surface: 'grass', stripHalf: 40, taxi: 0, taxiOff: 0, linkEvery: 0, apronW: 0, apronD: 0, hangars: 0, shelters: 0, tower: null, fuelTanks: 0 },
  },
}
/** legacy table (size only = military base, as before), kept for callers of the old API */
export const AIRFIELD_SIZES: Record<AirfieldSize, { length: number; width: number; taxi: number; apronW: number; apronD: number; hangars: number }> = Object.fromEntries(
  (['small', 'medium', 'large'] as AirfieldSize[]).map((k) => { const s = AIRFIELD_SPECS.military[k]; return [k, { length: s.length, width: s.width, taxi: s.taxi, apronW: s.apronW, apronD: s.apronD, hangars: s.hangars }] }),
) as never

export const MAX_RUNWAY_GRADE = 0.01
/** transition surface 1:7 (height allowed = distance beyond the strip edge / 7) */
export const TRANSITION_SLOPE = 1 / 7

export interface AirfieldOptions { size: AirfieldSize; kind?: AirfieldKind; surface?: StripSurface; x: number; z: number; yaw: number; seed: number | string; side?: 1 | -1 }

/** a placement with its runway-local footprint (s along, t across, half extents) */
export interface AirLocal { role: string; s: number; t: number; hs: number; ht: number; h: number }

export interface Airfield {
  kind: AirfieldKind
  size: AirfieldSize
  spec: AirfieldSpec
  surface: AirfieldSpec['surface']
  side: 1 | -1
  runway: Box
  taxiways: Box[]
  apron: Box
  placements: SitePlacement[]
  /** same order as placements: local footprint, for the rule checks */
  local: AirLocal[]
  entities: ProjectEntity[]
  shapes: ProjectShape[]
  /** [0] runway strip (grade <= 1 %), [1] taxiway + apron platform; set heights with flattenAirfield */
  flatten: FlattenRequest[]
  /** whole footprint incl. fence and flatten falloff (keep-out for other generators) */
  site: Box
  /** where the access road arrives (gate, car park or shed) */
  access: [number, number]
  /** placements dropped by the rules (role: reason) */
  rejected: string[]
}

/** "military-large", "strip-small", legacy "medium" (= military) */
export function parseAirfieldSub(sub: string): { kind: AirfieldKind; size: AirfieldSize } {
  const [a, b] = sub.split('-')
  if (b && (AIRFIELD_KINDS as string[]).includes(a)) return { kind: a as AirfieldKind, size: (b as AirfieldSize) in AIRFIELD_SPECS.military ? b as AirfieldSize : 'medium' }
  return { kind: 'military', size: (a as AirfieldSize) in AIRFIELD_SPECS.military ? a as AirfieldSize : 'medium' }
}

/** designation from the heading of +s (yaw, degrees clockwise from +Z) */
export const runwayNumber = (yaw: number) => { const n = Math.round((((yaw % 360) + 360) % 360) / 10) % 36; return n === 0 ? 36 : n }

export function generateAirfield(o: AirfieldOptions): Airfield {
  const kind = o.kind ?? 'military', S = AIRFIELD_SPECS[kind][o.size], yaw = o.yaw
  const R = rng(`${o.seed}|air|${kind}|${o.size}`)
  const side: 1 | -1 = o.side ?? (R() < 0.5 ? 1 : -1)
  const W = (t: number, s: number) => toWorld(o.x, o.z, yaw, t, s)
  const lbox = (t: number, s: number, ht: number, hs: number, ly = 0): Box => { const [x, z] = W(t, s); return { x, z, hw: ht, hd: hs, yaw: yaw + ly } }
  const pts = (...ts: [number, number][]) => ts.flatMap(([t, s]) => W(t, s))
  const id = (k: string) => `air-${o.seed}-${k}`
  const L = S.length / 2, hwR = S.width / 2, sh = S.stripHalf
  const surface = kind === 'strip' ? (o.surface ?? (R() < 0.7 ? 'grass' : 'dirt')) : S.surface
  const placements: SitePlacement[] = [], local: AirLocal[] = [], rejected: string[] = [], shapes: ProjectShape[] = []
  const taxiways: Box[] = []
  /** door (+Z) of a building facing the runway: rotated a quarter turn, its X spans s and its Z spans t */
  const face = side > 0 ? -90 : 90
  const minT = (h: number, role: string) => (FLAT_ROLES.has(role) ? 0 : sh + h / TRANSITION_SLOPE)
  /** place at signed t (centre) and s; ly = extra yaw. mode 'bump': pushed out to the 1:7 line; 'reject': dropped */
  const put = (role: string, pf: { p: string; hw: number; hd: number; h: number }, t: number, s: number, ly = 0, mode: 'bump' | 'reject' = 'reject') => {
    const quarter = Math.abs(((ly % 180) + 180) % 180) === 90
    const ht = quarter ? pf.hd : pf.hw, hs = quarter ? pf.hw : pf.hd
    const need = minT(pf.h, role)
    let inner = Math.abs(t) - ht
    if (need > 0 && inner < need) {
      if (mode === 'reject') { rejected.push(`${role}: 1:7`); return null }
      const sg = Math.sign(t) || side
      t = sg * (need + ht + 0.5); inner = need
    }
    placements.push({ role, prefab: pf.p, box: lbox(t, s, pf.hw, pf.hd, ly) })
    const l = { role, s, t, hs, ht, h: pf.h }
    local.push(l)
    return l
  }
  const line = (k: string, gen: string, a: [number, number], b: [number, number]) => shapes.push({ id: id(k), kind: 'spline', closed: false, points: pts(a, b).map(round), generator: gen })

  // --- runway surface
  const runway = lbox(0, 0, hwR, L)
  const paved = surface === 'concrete' || surface === 'asphalt'
  const rwGen = surface === 'concrete' ? AIR_GEN.runway40 : surface === 'asphalt' ? AIR_GEN.asphalt : AIR_GEN.dirt
  if (surface !== 'grass') shapes.push(roadShape(id('rwy'), pts([0, -L], [0, L]), rwGen, S.width))
  else for (let s = -L; s <= L + 0.1; s += 50) for (const sx of [-1, 1]) put('marker', AIR_PREFABS.marker, sx * (hwR + 1), s)

  // --- markings (paved only)
  if (paved) {
    line('cl', AIR_GEN.centre, [0, -L + 90], [0, L - 90])
    for (const end of [-1, 1]) {
      const sKey = end * (L - 25) // piano keys 30 m long, 6 m in from the edge
      const n = Math.max(2, Math.floor((S.width - 8) / 4.5 / 2)) // keys per half
      for (let k = 0; k < n; k++) for (const sx of [-1, 1]) put('mark', AIR_PREFABS.piano, sx * (3 + k * 4.5), sKey, 90)
      const num = String(runwayNumber(end < 0 ? yaw : yaw + 180)).padStart(2, '0')
      const ly = end < 0 ? 0 : 180, sNum = end * (L - 60)
      for (let i = 0; i < 2; i++) {
        const tt = (i === 0 ? -2.5 : 2.5) * (end < 0 ? 1 : -1)
        placements.push({ role: 'mark', prefab: AIR_DIGITS[+num[i]], box: lbox(tt, sNum, 1.5, 4.5, ly) }); local.push({ role: 'mark', s: sNum, t: tt, hs: 4.5, ht: 1.5, h: 0 })
      }
    }
    const nCr = kind === 'military' ? 10 : 5
    for (let i = 0; i < nCr; i++) {
      const tt = round((R() - 0.5) * (S.width - 8)), ss = round((R() - 0.5) * 2 * (L - 40))
      placements.push({ role: 'mark', prefab: AIR_CRACKS[Math.floor(R() * 3)], box: lbox(tt, ss, 3.5, 4, round(R() * 360)) }); local.push({ role: 'mark', s: ss, t: tt, hs: 4, ht: 3.5, h: 0 })
    }
    // edge lights every 60 m, threshold lights
    for (let s = -L; s <= L + 0.1; s += 60) for (const sx of [-1, 1]) put('light', AIR_PREFABS.light, sx * (hwR + 2), s)
    for (const s of [-L - 4, L + 4]) for (let t = -hwR; t <= hwR + 0.1; t += 5) put('light', AIR_PREFABS.lightEnd, t, s)
  }

  // --- taxiways and links
  const off = side * S.taxiOff, tL = L - 40
  const taxiGen = kind === 'military' ? AIR_GEN.runway20 : AIR_GEN.runway10
  const link = (s: number, from: number, to: number, w: number, gen: string) => {
    const a = side * from, b = side * to
    taxiways.push(lbox((a + b) / 2, s, Math.abs(b - a) / 2, w / 2))
    shapes.push(roadShape(id(`lk${Math.round(s)}`), pts([a, s], [b, s]), gen, w))
    line(`lkl${Math.round(s)}`, AIR_GEN.taxiLine, [a + side * 4, s], [b, s])
    // holding line on the link, at the strip edge (where the link leaves the strip)
    if (sh < to) put('mark', AIR_PREFABS.hold, side * (sh - 3), s, 90)
  }
  let az = 0, apronT0 = 0 // apron centre along s, apron inner edge |t|
  if (kind === 'military') {
    taxiways.push(lbox(off, 0, S.taxi / 2, tL))
    shapes.push(roadShape(id('twy'), pts([off, -tL], [off, tL]), taxiGen, S.taxi))
    line('twyl', AIR_GEN.taxiLine, [off, -tL + 15], [off, tL - 15])
    const links = [-tL, tL]
    const n = Math.floor((2 * tL) / S.linkEvery)
    for (let i = 1; i < n; i++) links.push(round(-tL + (i * 2 * tL) / n))
    for (const s of links) link(s, hwR, S.taxiOff - S.taxi / 2, S.taxi, taxiGen)
    for (let s = -tL; s <= tL + 0.1; s += 60) for (const d of [-1, 1]) put('light', AIR_PREFABS.lightTaxi, off + d * (S.taxi / 2 + 1.5), s)
    az = round(-L * 0.35 + (R() - 0.5) * 60)
    apronT0 = S.taxiOff + S.taxi / 2
  } else if (kind === 'civil') {
    az = round(-L * 0.2 + (R() - 0.5) * 80)
    if (S.taxi) {
      // partial parallel taxiway: from the apron to the -s end, links at that end and at the apron
      const s0 = -tL, s1 = az + S.apronW / 2
      taxiways.push(lbox(off, (s0 + s1) / 2, S.taxi / 2, (s1 - s0) / 2))
      shapes.push(roadShape(id('twy'), pts([off, s0], [off, s1]), taxiGen, S.taxi))
      line('twyl', AIR_GEN.taxiLine, [off, s0 + 10], [off, s1 - 5])
      link(s0, hwR, S.taxiOff - S.taxi / 2, S.taxi, taxiGen)
      link(az, hwR, S.taxiOff - S.taxi / 2, S.taxi, taxiGen)
      apronT0 = S.taxiOff + S.taxi / 2
    } else {
      apronT0 = sh + 4
      link(az, hwR, apronT0, 12, AIR_GEN.runway10)
    }
    // turn pad at the end(s) without a taxiway
    for (const end of S.taxi ? [1] : [-1, 1]) {
      const s = end * (L - 20)
      taxiways.push(lbox(0, s, hwR + 15, 20))
      shapes.push(roadShape(id(`pad${end}`), pts([0, s - 20], [0, s + 20]), AIR_GEN.asphalt, S.width + 30))
    }
  }

  // --- apron and its parcel rows: stands (next to the taxiway) / service lane / building band
  let apron: Box = lbox(0, 0, 0, 0), bandT0 = 0
  if (S.apronD > 0) {
    const ac = side * (apronT0 + S.apronD / 2)
    apron = lbox(ac, az, S.apronD / 2, S.apronW / 2)
    shapes.push(roadShape(id('apron'), pts([ac, az - S.apronW / 2], [ac, az + S.apronW / 2]), kind === 'military' ? AIR_GEN.panel : AIR_GEN.asphalt, S.apronD))
    const standD = S.apronD * 0.6, laneT = apronT0 + standD + 5
    const pitch = kind === 'military' ? 40 : 28
    const nStand = Math.max(1, Math.floor(S.apronW / pitch))
    for (let i = 0; i < nStand; i++) {
      const s = round(az - S.apronW / 2 + pitch * (i + 0.5))
      put('mark', AIR_PREFABS.tyres, side * (apronT0 + standD / 2), s, 90)
      if (kind === 'military') put('prop', AIR_PREFABS.blast, side * (apronT0 + standD - 2), s, face, 'reject')
    }
    // service lane: ground power units + fuel barrels, every other stand
    const gen = R() < 0.5 ? AIR_PREFABS.genUSSR : AIR_PREFABS.genUS
    for (let i = 0; i < nStand; i += 2) {
      const s = round(az - S.apronW / 2 + pitch * (i + 0.5) + 6)
      put('prop', gen, side * laneT, s, 0, 'reject')
      for (let k = 0; k < 3; k++) put('prop', AIR_PREFABS.barrel, side * (laneT + 3), s + 4 + k * 0.9, 0, 'reject')
    }
    bandT0 = apronT0 + S.apronD + 4
    // building band, filled like village lots: cursor along s, each item takes its width + a gap
    const items: { role: string; pf: (typeof AIR_PREFABS)[keyof typeof AIR_PREFABS] }[] = []
    for (let i = 0; i < S.hangars; i++) items.push({ role: 'hangar', pf: AIR_PREFABS.hangar })
    if (kind === 'military') items.push({ role: 'ops', pf: AIR_PREFABS.ops }, { role: 'bunker', pf: AIR_PREFABS.bunker })
    else items.push({ role: 'terminal', pf: o.size === 'small' ? AIR_PREFABS.clubhouse : AIR_PREFABS.terminal })
    const total = items.reduce((a, it) => a + it.pf.hw * 2 + 12, -12)
    let cur = az - total / 2
    for (const it of items) {
      const s = round(cur + it.pf.hw)
      put(it.role, it.pf, side * (bandT0 + it.pf.hd), s, face, 'bump')
      cur += it.pf.hw * 2 + 12
    }
  }

  // --- towers, windsock
  const ws = R() < 0.5 ? -1 : 1
  put('windsock', AIR_PREFABS.windsock, side * (sh + 30), ws * (L - 120), 0, 'bump')
  if (S.tower === 'mil') {
    const l = put('tower_ctrl', AIR_PREFABS.towerMil, side * 300, round(L * 0.05), face, 'bump')!
    put('antenna', AIR_PREFABS.antenna, side * (Math.abs(l.t) + 20), l.s + 18, 0, 'bump')
  } else if (S.tower && S.apronD > 0) {
    const pf = S.tower === 'civil' ? AIR_PREFABS.tower : AIR_PREFABS.towerSmall
    put('tower_ctrl', pf, side * (bandT0 + 30), round(az + S.apronW / 2 + 30), face, 'bump')
  }

  // --- military: dispersal U-loop with hardened shelters at the +s end
  const extra: number[] = [] // |t| of the outermost items (platform and fence)
  if (kind === 'military' && S.shelters) {
    const s0 = round(L * 0.45), s1 = tL, outer = S.taxiOff + 130
    const lg = AIR_GEN.runway20
    shapes.push(roadShape(id('disp'), pts([off + side * (S.taxi / 2), s0], [side * outer, s0], [side * outer, s1], [off + side * (S.taxi / 2), s1]), lg, 20))
    taxiways.push(lbox(side * (S.taxiOff + outer) / 2, s0, (outer - S.taxiOff) / 2, 10), lbox(side * outer, (s0 + s1) / 2, 10, (s1 - s0) / 2), lbox(side * (S.taxiOff + outer) / 2, s1, (outer - S.taxiOff) / 2, 10))
    const pf = AIR_PREFABS.shelter, pitch = pf.hw * 2 + 12
    const n = Math.min(S.shelters, Math.floor((s1 - s0 - 20) / pitch))
    for (let i = 0; i < n; i++) {
      const s = round(s0 + 10 + pitch * (i + 0.5))
      put('shelter', i % 2 ? AIR_PREFABS.shelterCamo : pf, side * (outer + 10 + 3 + pf.hd), s, face, 'bump')
    }
    extra.push(outer + 10 + 3 + pf.hd * 2)
  }

  // --- fuel depot, isolated (>= 50 m from every other building)
  if (S.fuelTanks) {
    const big = kind === 'military'
    const tk = big ? AIR_PREFABS.fuelBig : AIR_PREFABS.fuel
    const tc = big ? S.taxiOff + 110 : (S.taxiOff || sh) + 70
    let sc = -L + 50
    const others = () => local.filter((l) => l.h > 3)
    const far = (s: number) => others().every((l) => Math.max(Math.abs(l.s - s) - l.hs, Math.abs(Math.abs(l.t) - tc) - l.ht) > 50 + 30)
    for (let k = 0; k < 8 && !far(sc); k++) sc -= 40
    for (let i = 0; i < S.fuelTanks; i++) put('fuel', tk, side * tc, round(sc + (i - (S.fuelTanks - 1) / 2) * (tk.hd * 2 + 6)), 0, 'bump')
    put('fuel', AIR_PREFABS.fuelPump, side * (tc - tk.hw - 10), sc, 90, 'bump')
    put('prop', AIR_PREFABS.pipeShed, side * (tc - tk.hw - 18), sc + 8, 0, 'bump')
    extra.push(tc + tk.hw + 10)
  }

  // --- field strip: shed, windsock done, barrels and jerrycans
  if (kind === 'strip') {
    const s = round((R() - 0.5) * L * 0.6)
    const l = put('hangar', AIR_PREFABS.shed, side * 60, s, face, 'bump')!
    for (let k = 0; k < 4; k++) put('prop', AIR_PREFABS.barrel, side * (Math.abs(l.t) + l.ht + 2), l.s + l.hs + 2 + k * 0.9, 0, 'reject')
    for (let k = 0; k < 2; k++) put('prop', AIR_PREFABS.jerrycan, side * (Math.abs(l.t) + l.ht + 3.5), l.s - l.hs + k * 0.5, 0, 'reject')
  }

  // --- outer extent, access
  const maxT = Math.max(sh, ...local.filter((l) => !FLAT_ROLES.has(l.role)).map((l) => Math.abs(l.t) + l.ht), ...extra)
  let access: [number, number]
  if (kind === 'military') {
    // perimeter net fence (gap = gate on the building side, at the apron), inner perimeter road
    const fo = maxT + 30, fi = sh + 40, fs = L + 100, gS = az, gw = 6
    const ring = (o2: number, i2: number, e: number): [number, number][] => [[side * o2, gS + gw], [side * o2, e], [-side * i2, e], [-side * i2, -e], [side * o2, -e], [side * o2, gS - gw]]
    shapes.push(wallShape(id('fence'), pts(...ring(fo, fi, fs)), AIR_GEN.fence))
    shapes.push(roadShape(id('perim'), pts(...ring(fo - 10, fi - 10, fs - 10)), AIR_GEN.panel, 4))
    shapes.push(roadShape(id('gate'), pts([side * (fo + 15), gS], [side * (bandT0 || fo - 10), gS]), AIR_GEN.panel, 7))
    put('gate', AIR_PREFABS.barGate, side * fo, gS, 90, 'bump')
    put('guard', AIR_PREFABS.guardHouse, side * (fo - 8), gS + gw + 6, face, 'bump')
    access = W(side * (fo + 15), gS) as [number, number]
  } else if (kind === 'civil') {
    // car park on the road side of the terminal
    const term = local.find((l) => l.role === 'terminal')!
    const cpT = Math.abs(term.t) + term.ht + 16
    shapes.push(roadShape(id('park'), pts([side * cpT, term.s - 25], [side * cpT, term.s + 25]), AIR_GEN.asphalt, 24))
    taxiways.push(lbox(side * cpT, term.s, 12, 25))
    access = W(side * (cpT + 14), term.s) as [number, number]
  } else {
    const shed = local.find((l) => l.role === 'hangar')!
    access = W(side * (Math.abs(shed.t) + shed.ht + 12), shed.s) as [number, number]
  }

  // --- flatten: runway strip (+ 60 m overrun), platform = everything on the building side
  const strip: FlattenRequest = { box: lbox(0, 0, hwR + 20, L + 60), h0: 0, h1: 0, falloff: kind === 'strip' ? 30 : 60 }
  const pIn = hwR + 20, pOut = maxT + 10
  const solid = local.filter((l) => !FLAT_ROLES.has(l.role))
  const sMin = Math.min(-L - 20, ...solid.map((l) => l.s - l.hs - 10)), sMax = Math.max(L + 20, ...solid.map((l) => l.s + l.hs + 10))
  const plat: FlattenRequest = { box: lbox(side * (pIn + pOut) / 2, (sMin + sMax) / 2, (pOut - pIn) / 2, (sMax - sMin) / 2), h0: 0, h1: 0, falloff: 40 }
  // whole footprint (fence, platforms and their falloff): what other generators must keep out of
  const tOut = Math.max(pOut + 40, kind === 'military' ? maxT + 50 : 0), tIn = Math.max(hwR + 20 + strip.falloff, kind === 'military' ? sh + 50 : 0)
  const sLo = Math.min(sMin - 40, -L - 60 - strip.falloff, kind === 'military' ? -L - 110 : 0), sHi = Math.max(sMax + 40, L + 60 + strip.falloff, kind === 'military' ? L + 110 : 0)
  const site = lbox(side * (tOut - tIn) / 2, (sLo + sHi) / 2, (tOut + tIn) / 2, (sHi - sLo) / 2)
  return {
    site, kind, size: o.size, spec: S, surface, side, runway, taxiways, apron, placements, local, shapes, flatten: [strip, plat], access, rejected,
    entities: placements.map((p, i) => toEntity(p, `air-${o.seed}-${i}`)),
  }
}
/** flat items (lights, markers, decals, marks) are allowed inside the strip */
const FLAT_ROLES = new Set(['light', 'marker', 'mark'])

/** fits the two planes on the terrain (runway <= 1 %), the platform takes the same plane (no step).
 *  Returns the estimated earthwork (m3). */
export function flattenAirfield(a: Airfield, heights: ArrayLike<number>, g: Grid): number {
  const [s, p] = a.flatten
  const [h0, h1] = bestPlane(heights, g, s.box, MAX_RUNWAY_GRADE)
  s.h0 = round(h0); s.h1 = round(h1)
  p.h0 = s.h0; p.h1 = s.h1
  return Math.round(earthwork(heights, g, s, 10) + earthwork(heights, g, p, 10))
}

export interface AirfieldSuggestOptions { size: AirfieldSize; kind?: AirfieldKind | 'auto'; seaLevel?: number; keepOut?: Disc[]; count?: number; step?: number; angleStep?: number; maxMeanCut?: number }
export interface AirfieldSuggestion { x: number; z: number; yaw: number; earthwork: number; meanCut: number; score: number; kind: AirfieldKind; size: AirfieldSize }

const dimsOf = (size: AirfieldSize | { length: number; width: number }) => (typeof size === 'string' ? AIRFIELD_SIZES[size] : size)

/** best orientation at one centre: tries yaw 0..180 by angleStep, keeps the least earthwork on the
 *  runway strip (dry land along the whole strip required). `size`: legacy size or explicit dims. */
export function bestRunwayYaw(heights: ArrayLike<number>, g: Grid, x: number, z: number, size: AirfieldSize | { length: number; width: number }, seaLevel = 0, angleStep = 10): { yaw: number; earthwork: number } | null {
  const S = dimsOf(size)
  let best: { yaw: number; earthwork: number } | null = null
  for (let yaw = 0; yaw < 180; yaw += angleStep) {
    const box: Box = { x, z, hw: S.width / 2 + 20, hd: S.length / 2 + 60, yaw }
    let dry = true
    for (let lz = -box.hd; lz <= box.hd && dry; lz += 50) for (const lx of [-box.hw, 0, box.hw]) {
      const [px, pz] = toWorld(x, z, yaw, lx, lz)
      if (px < g.minX || pz < g.minZ || px > g.minX + (g.cols - 1) * g.step || pz > g.minZ + (g.rows - 1) * g.step || heightAt(heights, g, px, pz) < seaLevel + 2) { dry = false; break }
    }
    if (!dry) continue
    const [h0, h1] = bestPlane(heights, g, box, MAX_RUNWAY_GRADE, 20)
    const ew = earthwork(heights, g, { box, h0, h1, falloff: 0 }, 20)
    if (!best || ew < best.earthwork) best = { yaw, earthwork: Math.round(ew) }
  }
  return best
}

/** longest first: the auto suggester keeps the biggest airfield the flat ground allows at each spot */
export const AIRFIELD_LADDER: { kind: AirfieldKind; size: AirfieldSize }[] = [
  { kind: 'military', size: 'large' }, { kind: 'military', size: 'medium' }, { kind: 'civil', size: 'medium' },
  { kind: 'civil', size: 'small' }, { kind: 'strip', size: 'large' }, { kind: 'strip', size: 'medium' }, { kind: 'strip', size: 'small' },
]

/** scans the map for long flat dry strips; returns the best sites (yaw included), far apart.
 *  kind 'auto': at each spot, the biggest type of the ladder whose mean cut stays under maxMeanCut. */
export function suggestAirfield(heights: ArrayLike<number>, g: Grid, o: AirfieldSuggestOptions): AirfieldSuggestion[] {
  const kind = o.kind ?? 'military', step = o.step ?? 250, out: AirfieldSuggestion[] = []
  const ladder = kind === 'auto' ? AIRFIELD_LADDER : [{ kind, size: o.size }]
  const maxCut = o.maxMeanCut ?? 1.5
  for (let z = g.minZ + step; z < g.minZ + (g.rows - 1) * g.step - step; z += step) for (let x = g.minX + step; x < g.minX + (g.cols - 1) * g.step - step; x += step) {
    for (const rung of ladder) {
      const S = AIRFIELD_SPECS[rung.kind][rung.size]
      if (o.keepOut?.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + S.length / 2 + 100)) continue
      const b = bestRunwayYaw(heights, g, x, z, S, o.seaLevel ?? 0, o.angleStep ?? 15)
      if (!b) continue
      const meanCut = b.earthwork / ((S.width + 40) * (S.length + 120))
      if (kind === 'auto' && meanCut > maxCut && rung !== ladder[ladder.length - 1]) continue
      // auto: bigger rungs score higher at equal flatness
      const bonus = kind === 'auto' ? S.length / 1500 : 0
      out.push({ x: round(x), z: round(z), yaw: b.yaw, earthwork: b.earthwork, meanCut: round(meanCut), score: round(1 / (1 + meanCut) + bonus), kind: rung.kind, size: rung.size })
      break
    }
  }
  out.sort((a, b) => b.score - a.score)
  const keep: AirfieldSuggestion[] = []
  for (const s of out) {
    if (keep.length >= (o.count ?? 3)) break
    const len = AIRFIELD_SPECS[s.kind][s.size].length
    if (keep.every((k) => Math.hypot(k.x - s.x, k.z - s.z) > Math.max(len, AIRFIELD_SPECS[k.kind][k.size].length))) keep.push(s)
  }
  return keep
}

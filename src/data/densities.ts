// Map-size scaling: every count of the random world is a density x the map's land area (or coast / road length),
// measured on the Bohemia maps (C:\Users\benbo\tools\PakTools\analyses\ SITES_VANILLA.md, VILLAGES_VANILLA.md,
// FORESTS_VANILLA.md, FIELDS_SURFACES_VANILLA.md). Everon (Eden) and Kolguyev (Cain) are 12.8 km maps (163.8 km²,
// ~80 km² of land each), Arland 4.1 km (16.8 km², ~9 km² of land). Densities below are per km² of LAND
// (the generator counts land cells: a 4 km island map has ~9-11 km² of land, an 8 km one ~40).
// Fixed distances (base spacing 800-950 m, fields 400 m from villages, forest edge 16-24 m) are NOT scaled.

export interface Density {
  /** per km² of land (or per km of coast / road, see the key) */
  perKm2: number
  /** floor once the slider is > 0 and the map is big enough to hold one (minLandKm2) */
  min?: number
  max?: number
  /** below this land area the floor is not applied (a 1 km islet gets no airbase) */
  minLandKm2?: number
}

export const DENSITY = {
  /** localities (towns + villages, >= 10 buildings): [M] Everon 34 for ~74 km² of land -> 0.46, [enfumap] median 0.46.
   *  (VILLAGES_VANILLA counts only residential clusters >= 8 houses: Everon 17, Arland 2 -> 0.21; buildings of all
   *  kinds are what the generator places, so the 34-locality figure is the one kept) */
  localities: { perKm2: 0.46, min: 1, max: 120 },
  /** hamlets: [M] Everon 50 hamlets (3-9 buildings) for 34 localities -> 0.69 / km² of land */
  hamlets: { perKm2: 0.69, max: 160 },
  /** farmsteads: Everon 108 clusters (1.35 / km² of land); each one costs a routed track, so we place ~2/3 of it */
  farms: { perKm2: 0.9, max: 120 },
  /** military bases: Everon 9, Kolguyev 21 (0.11-0.26 / km² of land); spacing 800-950 m kept apart */
  military: { perKm2: 0.1, min: 1, max: 16, minLandKm2: 3 },
  /** industrial zones: Everon 29 / Kolguyev 34 small yards; ours are 220 x 160 m estates, so ~half */
  industry: { perKm2: 0.15, min: 1, max: 16, minLandKm2: 3 },
  /** fuel depots: Everon 13, Kolguyev 15 (0.16-0.19 / km² of land) */
  fuelDepots: { perKm2: 0.16, max: 16 },
  /** gas stations on main asphalt roads: Everon 15, Kolguyev 9 */
  gasStations: { perKm2: 0.15, max: 16 },
  /** bus stops (SignBusStop + BusShed): Everon 43 (0.54), Kolguyev 5, Arland 0 -> 0.3 */
  busStops: { perKm2: 0.3, max: 40 },
  /** churches: Everon 31 for 17 villages + 22 hamlets (0.39 / km² of land); generated with each village (village.ts) */
  churches: { perKm2: 0.39 },
  /** bridges: Everon 36, Kolguyev 13 (0.16-0.45 / km² of land): they come from the road x river crossings */
  bridges: { perKm2: 0.3 },
  /** ports per km of coast: Everon 36, Kolguyev 33 for ~60-80 km of coast [est coast length] -> 0.45 / km */
  portsPerKmCoast: { perKm2: 0.45, max: 24 },
  /** road signs per km of road: verge posts 8.5-13 / km (generator spacing), warning signs per junction / bend */
  signsPerKmRoad: { perKm2: 10 },
} satisfies Record<string, Density>

/** shares of the land (not counts): forest cover, crop fields, materials */
export const SHARE = {
  /** [M] FORESTS_VANILLA: massifs 8.8-11.5 % of the map + 18-21 % of the trees outside them; our cover slider 1 = 0.35 incl. groves */
  forest: 0.35,
  /** [M] Everon crop material 5.8 % of land (Kolguyev / Arland unpainted) */
  field: 0.06,
  /** [M] bare Rock_01: Everon 1.4 %, Kolguyev 0, Arland 0.1 % (cap of rockMask) */
  rock: 0.05,
}

/** count = density x amount (km² of land, km of coast...) x slider, rounded, clamped to [min, max] */
export function scaledCount(d: Density, amount: number, slider = 1): number {
  if (slider <= 0 || amount <= 0) return 0
  let n = Math.round(d.perKm2 * amount * slider)
  if (d.min != null && amount >= (d.minLandKm2 ?? 0)) n = Math.max(n, d.min)
  if (d.max != null) n = Math.min(n, Math.round(d.max * Math.max(1, slider)))
  return n
}

export interface WorldCountParams { towns: number; villages: number; hamlets: number; industry: number; military: number; vanillaSites?: boolean }
export interface WorldCounts { town: number; village: number; hamlet: number; farms: number; military: number; industry: number; fuelDepots: number; gasStations: number; busStops: number }

/** shares of the localities that are towns (>= 40 buildings): [M] Everon 1 town + 7 bourgs of 34 -> 0.24 */
export const TOWN_SHARE = 0.24

//! every count of the random world from its land area (km²); the sliders are multipliers (1 = measured average)
export function worldCounts(p: WorldCountParams, landKm2: number): WorldCounts {
  const loc = DENSITY.localities.perKm2 * landKm2
  const vanilla = p.vanillaSites ? 1 : 0
  return {
    town: p.towns > 0 ? Math.max(1, Math.round(loc * TOWN_SHARE * p.towns)) : 0,
    village: Math.min(DENSITY.localities.max, Math.round(loc * (1 - TOWN_SHARE) * p.villages)),
    hamlet: scaledCount(DENSITY.hamlets, landKm2, p.hamlets),
    farms: scaledCount(DENSITY.farms, landKm2, p.hamlets),
    military: scaledCount(DENSITY.military, landKm2, p.military),
    industry: scaledCount(DENSITY.industry, landKm2, p.industry),
    fuelDepots: scaledCount(DENSITY.fuelDepots, landKm2, vanilla * p.industry),
    gasStations: scaledCount(DENSITY.gasStations, landKm2, vanilla),
    busStops: scaledCount(DENSITY.busStops, landKm2, vanilla),
  }
}

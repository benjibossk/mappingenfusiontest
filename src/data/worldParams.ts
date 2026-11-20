// Tunable numbers of the random world generator (src/modules/worldgen.ts).
// Source: docs/MAP_KNOWLEDGE_BASE.md. [enfumap] = section "Analyse enfumap (34 cartes)", measured on
// 738 named localities of 34 published maps; [M] = section "2 bis. Mesures réelles" (Everon / Arland /
// Kolguyev read from the game files, settlements = building clusters at 70 m); [KB§n] = rule n of section 3 (estimated); [est] = our guess.

export const WORLD = {
  island: {
    landRatio: 0.6, // [KB§1] 30-60 % of the map is land (0.6 gives ~7 km² on 4 km, [M] Arland ~8 km²)
    /** highest point per map size: [KB§1] 250-450 m for 12.8 km, scaled down for small maps [est] */
    maxHeight: (size: number) => Math.round(Math.min(380, Math.max(140, size / 30))),
    seaDepth: 30,
    roughness: 0.6,
  },
  water: {
    rain: 1, threshold: 400, riverDepth: 1.5, // threshold (cells) = UI default of the Water step only
    /** random world: catchment (km²) a cell drains before it is a river. 400 cells (0.03 km² at 8 m) drew ~100 gullies
     *  on 4 km; [M] Arland has a handful of streams, Everon ~10 named rivers on 12.8 km. 0.35 km² -> 2-6 on 4 km [est] */
    catchmentKm2: 0.35,
    minLenM: 500, // a course (or tributary) shorter than this is a gully, not drawn [est]
    coursesPerKm2: 0.45, // longest courses kept per km² of land, tributaries included (4 km ~3-4, 8 km ~10) [est]
    minCourses: 2,
    lakeMinArea: 6000, // a pit must hold >= 0.6 ha to be a lake (was 2 000 m²: dozens of ponds) [est]
    lakeSourceShare: 0.1,
    lakesPerKm2: 0.12, // cap, biggest first: 4 km ~1, 8 km ~3 [est; Everon has 2-3 ponds / reservoirs]
  },
  sites: {
    /** localities (towns + villages) per km² of land: [enfumap] median 0.46 (range 0.15-3.3, Everon 0.65) */
    perKm2: 0.46,
    /** share of towns (town + bourg, >= 40 buildings) among localities: [M] Everon 1 + 7 of 34 (>= 10 buildings) -> 0.24 */
    townShare: 0.24,
    /** hamlets per locality: [M] Everon 50 hamlets (3-9 buildings) for 34 localities -> 1.5; [enfumap] 1-2 */
    hamletsPerLocality: 1.5,
    /** min spacing (m) between two places of the kind. [M] Everon nearest neighbour: village-village median 660 m
     *  (min 312), bourg-bourg 1 320 m; groups >= 3: 346 m. [enfumap] median 819 m, p10 323 m. A greedy placement
     *  ends ~1.3x above its minimum, hence these floors. KB §4 table (M): nnMedian town 1 320 / village 620 / hamlet 320 m. */
    minDist: { town: 1000, village: 470, hamlet: 250 },
    /** any two places: never closer than this [enfumap] floor 250 m outside urban maps */
    minAny: 260,
    maxSlope: { town: 0.08, village: 0.1, hamlet: 0.16 }, // [KB§4] < 6 % ideal, ridges > 10 % rejected [est per kind]
    maxAltFrac: 0.6, // [KB§4]
    spreadWeight: 1.5, // score penalty for the mean grade over a town / village footprint (lots need flat ground) [est]
    waterBonusM: 500, // [KB§4]
    edgeM: 300, // [enfumap] islands: 0 % of localities within 1 km of the edge (we keep 300 m, small maps) [est]
  },
  /** settleVillages per kind: [M] Everon class sizes: town 189, bourgs 40-119 (median ~60), villages 10-39, hamlets 3-9.
   *  maxStreets undefined = the variant default (+0-1) */
  villages: {
    /** the generated relief is bumpy at 8-16 m a cell: footprints may straddle 1.5x the default drop (foundations hide it) [est] */
    dropScale: 3, // was 1.5: with lot-sized model choice + sliding retries, fill rose from ~30 % to ~70 % of the lots that drew a house (8 km bench)
    town: { density: 1.25, maxStreets: 16 as number | undefined },
    // reconstruction bench (scripts/bench, Everon sites + roads): 1.15 / 7 / 0.6 built 2.3x the vanilla buildings per site;
    // 0.3 / 4 / 0.2 gives 1.01x (villages) and 1.07x (hamlets), score 62.8 -> 75.5
    village: { density: 0.29, maxStreets: 5 as number | undefined },
    hamlet: { density: 0.2, maxStreets: undefined as number | undefined },
    farm: { density: 0.15, maxStreets: 0 as number | undefined }, // farmsteads: 1-3 buildings
  },
  /** farmsteads at the end of a dirt track ([M] Everon 197 lone buildings for ~80 km² of land -> ~2.5/km²; we
   *  place fewer, each one costs a routed track) [est] */
  farms: { perKm2: 0.9, gridM: 150, maxSlope: 0.1, siteGapM: 250, roadM: [180, 900] as [number, number], spacingM: 380, track: 'dirt' },
  airfield: {
    minMapKm: 4, // [KB§6] one per map >= 10 km, 0-1 below; we offer it from 4 km [est]
    /** [M] runways 1 000 m x 40 m (Everon), 1 217 m x 60 m (Arland 4 km), 1 007 m (Kolguyev): medium (1 100 m) from 4 km */
    sizeFor: (size: number): 'small' | 'medium' | 'large' => (size >= 4000 ? 'medium' : 'small'),
    keepOutM: 400, // distance runway <-> place edge; [enfumap] median 636 m to the nearest locality
  },
  military: {
    perMap4km: 1, // bases for a 4 km map at slider 1, scaled by map area, max 4 [est]; KB §4 (M) 8.5-18 military sites / 100 km² (most are small posts)
    keepOutM: 700, // [enfumap] median 1.1 km from the nearest locality (noisy, n = 80): 700 m past the radius
    /** main base <-> runway: [M] Arland (4 km) all 9 sites 0.1-1.2 km from the runway; Everon / Kolguyev (12.8 km) 2.4-5 km */
    nearAirfieldM: (size: number) => (size <= 5000 ? 1200 : 3500),
  },
  industry: {
    perTown: 1, // [KB§8] 1-3 zones per map, near a town [est: 1 per town at slider 1]
    maxZones: 4,
    searchM: 2000, // [KB§8] 0.5-2 km from a town
    size: { w: 220, d: 160 },
  },
  roads: {
    maxSlope: 10, main: 'asphaltLine', minor: 'asphalt', lane: 'asphaltNarrow', // UI defaults (step Roads): main = town-town (widest asphalt, dashed line), secondary = village, local = hamlet
    /** random world: shortcut links that turn the tree into a mesh. [M] Everon ~637 junctions for 344 km (1 per
     *  540 m), Arland 79 for 46 km: a pure tree has one junction per place. A pair is linked when the road between
     *  them is > loopDetour x their straight distance */
    loopsPerKm2: 0.6, loopDetour: 1.7, loopMaxM: 2200, loopType: 'dirt',
  },
  power: { lvMax: 2500 }, // UI default; pole span is power.ts POWER_DEFAULTS ([M] median 35-50 m between poles)
  // [M] road density 1.4-2.8 km/km² of map (Everon 2.1): not a target of buildNetwork; tree + farm tracks + loops give
  // 1.8-2.7 km per km² of LAND (see docs/MAP_KNOWLEDGE_BASE.md "Calibration du générateur")
  vegetation: {
    /** forest cover of the land at slider 1: [enfumap] green (forest + meadow) median 44 % [visual]; [KB§11] forest 35-50 % */
    forestCover: 0.5,
  },
} as const

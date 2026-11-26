// Biomes (docs/BIOMES_LIBRARY.md): a terrain style = surface palette + vegetation + building style +
// fences/props + road look + 3D drape colours. Pure data. Every surface name resolves to a vanilla
// GUID through SURFACES; vegetation / fence / prop prefabs are base-game refs checked against the
// resource database index (2026-11-16). Biomes without vanilla assets declare a `fallback` biome
// whose assets are used until a mod pack (src/library) provides real ones.

import { SURFACES } from './biomesSurfaces.ts'

export type BiomeId = 'temperate_everon' | 'woodland_arland' | 'nordic_kolguyev' | 'mediterranean_dry' | 'desert' | 'winter_tundra' | 'tropical'
export type Availability = 'vanilla' | 'partial' | 'mods'
/** Freedom Fighters JWK_EWorldBiome (JWK_WorldEntity.c): bit flags used to pick camouflage / forces */
export type FFBiome = 'WOODLAND' | 'WINTER' | 'DESERT' | 'JUNGLE'
/** the building style a biome uses: Everon/Arland "_E_" western houses or Kolguyev "USSR" variants */
export type BuildingStyle = 'western' | 'soviet' | 'none'

export type SurfaceRole = 'grass' | 'meadow' | 'forest' | 'forestConifer' | 'clearing' | 'field' | 'dirt' | 'rock' | 'scree' | 'beach' | 'seabed' | 'town' | 'heath'
export interface Weighted { p: string; w: number }
export interface Biome {
  id: BiomeId
  label: { en: string; fr: string }
  desc: { en: string; fr: string }
  availability: Availability
  ff: FFBiome
  maps: string[] // reference vanilla worlds
  fallback?: BiomeId // whose vanilla assets stand in when this biome has none
  surfaces: Record<SurfaceRole, string> // role -> surface name (key of SURFACES)
  vegetation: { trees: Weighted[]; bushes: Weighted[]; treesPerHa: number; bushesPerHa: number; gardenTrees: Weighted[] }
  buildingStyle: BuildingStyle
  fences: { front: string[]; side: string[] } // wall generator prefabs
  props: string[] // garden / yard props
  road: { paved: string; dirt: string; village: string } // surface names
  /** surface under the river water (generators write Pebbles_01, else its scree role) */
  riverBed?: string
  drape: { ground: string; forest: string; field: string; rock: string; sand: string; water: string } // #rrggbb
  missing: { en: string; fr: string } // what only mods can bring
}

const T = (n: string) => `Prefabs/Vegetation/Tree/${n}.et`
// verified tree / bush refs (rdb index)
export const VEG = {
  pine: '{598D3D0E711E8082}' + T('t_pinus_sylvestris/T_Pinus_sylvestris_02_0c'),
  pineF: '{ED71602FB45311F0}' + T('t_pinus_sylvestris/T_Pinus_sylvestris_02_0f'),
  spruce: '{F4C920FCE86AD599}' + T('t_picea_abies/t_picea_abies_0'),
  spruceSw: '{2856B1FB07D0384C}' + T('t_picea_abies/t_picea_abies_0sw'),
  birch: '{1C4EEFC81C19E4C6}' + T('t_betula_pendula/t_betula_pendula_0'),
  birchAut: '{DDA7B42B3EC90811}' + T('t_betula_pendula/t_betula_pendula_0_aut'),
  hornbeam: '{9FDBC6DD8E57C895}' + T('t_carpinus_betulus/t_carpinus_betulus_0'),
  hornbeamAut: '{480B84C66F5030FE}' + T('t_carpinus_betulus/t_carpinus_betulus_0_aut'),
  rowan: '{363FF046F12F045D}' + T('t_sorbus_aucuparia/t_sorbus_aucuparia_1sw'),
  rowanAut: '{98C05A60EE82FC61}' + T('t_sorbus_aucuparia/t_sorbus_aucuparia_1sw_aut'),
  larch: '{2B08D648FA93268C}' + T('t_larix_decidua/t_larix_decidua_1s'),
  larchAut: '{10BB4D962D6D6FAD}' + T('t_larix_decidua/t_larix_decidua_1s_aut'),
  alder: '{34326A41A24A1B16}' + T('t_alnus_glutinosa/t_alnus_glutinosa_2f'),
  alderAut: '{53564BDC18C86389}' + T('t_alnus_glutinosa/t_alnus_glutinosa_2f_aut'),
  willow: '{6C788B70DF94793B}' + T('t_salix_fragilis/t_salix_fragilis_2s'),
  willowAut: '{5C388FCA613EA2D8}' + T('t_salix_fragilis/t_salix_fragilis_2s_aut'),
  lime: '{C46F2709EDF643D4}' + T('t_tilia_cordata/t_tilia_cordata_3s'),
  limeAut: '{4D91063663E79782}' + T('t_tilia_cordata/t_tilia_cordata_3s_aut'),
  plum: '{CEFEBF266E7040A9}' + T('t_prunus_domestica/t_prunus_domestica_2s'),
  plumAut: '{55BD07481C975FB8}' + T('t_prunus_domestica/t_prunus_domestica_2s_aut'),
  poplar: '{63DC62906A5917F3}' + T('t_populus_nigra/t_populus_nigra_3s'),
  poplarAut: '{74EE1A00F7A643AE}' + T('t_populus_nigra/t_populus_nigra_3s_aut'),
  apple: '{1C6F9AD2669C17F9}' + T('t_malus_domestica/t_malus_domestica_2s'),
  appleAut: '{CD36E67527A13CAE}' + T('t_malus_domestica/t_malus_domestica_2s_aut'),
  hazel: '{C98A6C1C2372354E}Prefabs/Vegetation/Bush/b_corylus_avellana_1.et',
  hazelAut: '{EAC4947FCD1B4A3B}Prefabs/Vegetation/Bush/b_corylus_avellana_1_aut.et',
  hazelL: '{AF4BFBE29028A9FD}Prefabs/Vegetation/Bush/b_corylus_avellana_1l.et',
  hazel2: '{A5DE58FC9FB6BA60}Prefabs/Vegetation/Bush/b_corylus_avellana_2.et',
} as const

// verified wall generators (rdb index; FENCE_NET / MIL_WALLS live in their own modules)
export const FENCES = {
  wood1: '{1A61D6F828325773}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_01.et',
  wood2: '{3D01BACFAD3B1797}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_02.et',
  wood3: '{D70816286B74E7F8}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_03.et',
  wood4: '{0CC5E987AE1787C6}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFence_04.et',
  woodOld: '{893BD1EB126A1C01}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenFenceOld_01.et',
  woodRural: '{8F597EE22331F6D3}Prefabs/WEGenerators/Walls/Wooden/WG_WoodenRural_01.et',
  pole1: '{5B6E89F5F31C58DE}Prefabs/WEGenerators/Walls/Pole/WG_PoleFence_01.et', // pasture fences (pastures.ts)
  pole2: '{56EB3E90ED6D70D6}Prefabs/WEGenerators/Walls/Pole/WG_PoleFence_02.et',
  stone1: '{AFBC8775A67A25AB}Prefabs/WEGenerators/Walls/Stone/WG_StoneWall_01.et',
  stone2: '{750314043E7EA87C}Prefabs/WEGenerators/Walls/Stone/WG_StoneWall_02.et',
  brick1: '{1D54F9B155264349}Prefabs/WEGenerators/Walls/Brick/WG_BrickWall_01.et',
  brickOld: '{23BA8BDB67FAC5C5}Prefabs/WEGenerators/Walls/Brick/WG_BrickWallOld_01.et',
  brickUssr: '{01D40951CD10C8B6}Prefabs/WEGenerators/Walls/Brick/WG_BrickWall_USSR_04.et',
  metalDecoE: '{3CF9D6E0ED89A634}Prefabs/WEGenerators/Walls/Metal/WG_MetalFenceDecorative_E_01.et',
  metalDecoE2: '{50ADE200514D291A}Prefabs/WEGenerators/Walls/Metal/WG_MetalFenceDecorative_E_02.et',
  metalUssr: '{4F9952E0B07CFA33}Prefabs/WEGenerators/Walls/Metal/WG_MetalFence_USSR_01.et',
  tin: '{3BBE8E0E68E0BE9C}Prefabs/WEGenerators/Walls/Metal/WG_TinWall_01.et',
  tinRusty: '{25A2E591AC54EF71}Prefabs/WEGenerators/Walls/Metal/WG_TinWall_01_rusty.et',
  woodConcretePole: '{A9BC6A9EAA05114A}Prefabs/WEGenerators/Walls/Custom/WG_WoodenConcretePoleFence_03.et',
} as const

export const PROPS = {
  beehive: '{E3A2574E3BC3935C}Prefabs/Props/Agriculture/Beehive_01/Beehive_01_blue.et',
  beehiveGreen: '{5C6CDA125FB8EC67}Prefabs/Props/Agriculture/Beehive_01/Beehive_01_green.et',
  hayBale: '{6A8D0F8B78685E0A}Prefabs/Props/Agriculture/Farm/HayBale_01.et',
  hayBaleSquare: '{C959D3CF939EBBB3}Prefabs/Props/Agriculture/Farm/HayBale_01_square_small.et',
  haystack: '{520626A206926F47}Prefabs/Props/Agriculture/Farm/Haystack_01.et',
  haystackSmall: '{6BEDCCDEE119AC7C}Prefabs/Props/Agriculture/Farm/HaystackSmall_01.et',
  haystackDryer: '{ECAF8FE9FFC28643}Prefabs/Props/Agriculture/Farm/HaystackDryer_01.et',
  woodLogA: '{32654927F2657E8A}Prefabs/Props/Forest/WoodPile/WoodLog_01_A.et',
  woodLogB: '{5E317DC74EA1F1A4}Prefabs/Props/Forest/WoodPile/WoodLog_01_B.et',
  firewoodCrate: '{A13BCC98B8C380C7}Prefabs/Compositions/Misc/SubCompositions/Decorations/Crate_Firewood_01.et',
} as const

const w = (p: string, n: number): Weighted => ({ p, w: n })

export const BIOMES: Biome[] = [
  {
    id: 'temperate_everon',
    label: { en: 'Temperate European (Everon)', fr: 'Tempéré européen (Everon)' },
    desc: { en: 'Green Atlantic island: meadows, mixed woods, stone-walled farms, western houses.', fr: 'Île atlantique verte : prairies, bois mixtes, fermes à murets de pierre, maisons occidentales.' },
    availability: 'vanilla', ff: 'WOODLAND', maps: ['Everon (Eden)'],
    surfaces: { grass: 'Grass_01', meadow: 'Grass_02', forest: 'ForestDeciduous_01_Base', forestConifer: 'ForestPine_01_Base', clearing: 'ForestClearing_Deciduous_01', field: 'Crop_Field_01', dirt: 'Dirt_01', rock: 'Rock_01', scree: 'Debris_Rock_01', beach: 'BeachGrass_01', seabed: 'SeaBed_01', town: 'Cobblestone_01_Wave', heath: 'Heather_01' },
    vegetation: { trees: [w(VEG.hornbeam, 3), w(VEG.lime, 2), w(VEG.pine, 2), w(VEG.alder, 1), w(VEG.poplar, 1)], bushes: [w(VEG.hazel, 3), w(VEG.hazelL, 1)], treesPerHa: 320, bushesPerHa: 160, gardenTrees: [w(VEG.apple, 2), w(VEG.plum, 2), w(VEG.lime, 1)] },
    buildingStyle: 'western',
    fences: { front: [FENCES.stone1, FENCES.metalDecoE, FENCES.wood1], side: [FENCES.stone2, FENCES.wood2] },
    props: [PROPS.beehive, PROPS.woodLogA, PROPS.firewoodCrate, PROPS.haystackSmall],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_02', village: 'Cobblestone_01_Wave' },
    drape: { ground: '#6f8f4a', forest: '#3f5f2e', field: '#a99a55', rock: '#8a8478', sand: '#cdbf8f', water: '#3c6e8f' },
    missing: { en: 'Nothing: full vanilla set.', fr: 'Rien : jeu vanilla complet.' },
  },
  {
    id: 'woodland_arland',
    label: { en: 'Woodland (Arland)', fr: 'Woodland (Arland)' },
    desc: { en: 'Flat wooded island, pine stands and fields, same western houses as Everon.', fr: 'Île plate boisée, pinèdes et champs, mêmes maisons occidentales qu’Everon.' },
    availability: 'vanilla', ff: 'WOODLAND', maps: ['Arland'],
    surfaces: { grass: 'Grass_03', meadow: 'Grass_02', forest: 'ForestConiferous_01_Base', forestConifer: 'ForestPine_01_Base', clearing: 'ForestClearing_Coniferous_01', field: 'Grass_02', dirt: 'Dirt_01', rock: 'Debris_Rock_01', scree: 'Debris_Rock_01', beach: 'Grass_03_coastal', seabed: 'SeaBed_01', town: 'Concrete_01', heath: 'Heather_01' },
    vegetation: { trees: [w(VEG.pine, 4), w(VEG.pineF, 2), w(VEG.spruce, 2), w(VEG.birch, 2), w(VEG.hornbeam, 1)], bushes: [w(VEG.hazel, 2), w(VEG.hazel2, 1)], treesPerHa: 380, bushesPerHa: 120, gardenTrees: [w(VEG.apple, 2), w(VEG.birch, 1)] },
    buildingStyle: 'western',
    fences: { front: [FENCES.wood1, FENCES.metalDecoE2, FENCES.wood3], side: [FENCES.wood2, FENCES.woodRural] },
    props: [PROPS.woodLogB, PROPS.firewoodCrate, PROPS.hayBale, PROPS.beehiveGreen],
    // Arland paints no crop and no Dirt_02 (FIELDS_SURFACES_VANILLA §1: Dirt_01 5.6 %, Pebbles_02 5.2 %): fields are
    // meadow patches, dirt / shoulders Dirt_01 (Dirt_02 / Crop_Field_02 were the dark speckled bands), river bed Pebbles_02
    // (scree = Debris_Rock_01 made dark blotches under shallow water)
    road: { paved: 'Asphalt_01', dirt: 'Dirt_01', village: 'Concrete_01' },
    riverBed: 'Pebbles_02',
    drape: { ground: '#738f4f', forest: '#2f4f2a', field: '#b09f5c', rock: '#85806f', sand: '#d1c393', water: '#3d6a86' },
    missing: { en: 'Nothing: full vanilla set.', fr: 'Rien : jeu vanilla complet.' },
  },
  {
    id: 'nordic_kolguyev',
    label: { en: 'Soviet Nordic (Kolguyev)', fr: 'Soviétique nordique (Kolguyev)' },
    desc: { en: 'Autumn boreal island: birch, spruce, larch; soviet (USSR) house variants, tin and net fences.', fr: 'Île boréale d’automne : bouleaux, épicéas, mélèzes ; maisons variantes soviétiques (USSR), clôtures tôle et grillage.' },
    availability: 'vanilla', ff: 'WOODLAND', maps: ['Kolguyev (Cain)'],
    surfaces: { grass: 'Grass_01_aut', meadow: 'Grass_02_aut', forest: 'ForestDeciduous_01_Base_aut', forestConifer: 'ForestConiferous_01_Base_aut', clearing: 'ForestClearing_Coniferous_01_aut', field: 'Crop_Field_02', dirt: 'Dirt_03', rock: 'Rock_01', scree: 'Debris_Rock_01_V2', beach: 'Pebbles_02', seabed: 'SeaBed_01', town: 'Concrete_02', heath: 'Heather_01_aut' },
    vegetation: { trees: [w(VEG.birchAut, 4), w(VEG.spruceSw, 3), w(VEG.larchAut, 2), w(VEG.rowanAut, 1), w(VEG.alderAut, 1)], bushes: [w(VEG.hazelAut, 2)], treesPerHa: 300, bushesPerHa: 100, gardenTrees: [w(VEG.appleAut, 2), w(VEG.rowanAut, 1), w(VEG.birchAut, 1)] },
    buildingStyle: 'soviet',
    fences: { front: [FENCES.metalUssr, FENCES.woodOld, FENCES.woodConcretePole], side: [FENCES.tinRusty, FENCES.wood4, FENCES.tin] },
    props: [PROPS.woodLogA, PROPS.woodLogB, PROPS.haystack, PROPS.haystackDryer],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_03', village: 'Concrete_02' },
    drape: { ground: '#8a8650', forest: '#4f5a2e', field: '#a38a4d', rock: '#7d786c', sand: '#bfb08a', water: '#35586e' },
    missing: { en: 'Autumn surfaces assumed for Kolguyev (check its .terr layers).', fr: 'Surfaces « _aut » supposées pour Kolguyev (à confirmer dans ses calques .terr).' },
  },
  {
    id: 'mediterranean_dry',
    label: { en: 'Dry Mediterranean', fr: 'Méditerranéen sec' },
    desc: { en: 'Sparse scrub, pebbles and dry dirt; vanilla surfaces work, olive/cypress trees and stucco houses need mods.', fr: 'Garrigue clairsemée, cailloux et terre sèche ; surfaces vanilla OK, oliviers/cyprès et maisons crépies = mods.' },
    availability: 'partial', ff: 'WOODLAND', maps: [], fallback: 'temperate_everon',
    surfaces: { grass: 'Grass_03_coastal', meadow: 'MountainGrass_02', forest: 'ForestPine_01_Base', forestConifer: 'ForestPine_01_Base', clearing: 'Heather_01', field: 'Crop_Field_01', dirt: 'Dirt_02', rock: 'Rock_01', scree: 'Pebbles_01', beach: 'Pebbles_02', seabed: 'SeaBed_01', town: 'Cobblestone_01_Wave_V2', heath: 'Heather_01' },
    vegetation: { trees: [w(VEG.pine, 4), w(VEG.poplar, 1)], bushes: [w(VEG.hazel2, 1)], treesPerHa: 90, bushesPerHa: 140, gardenTrees: [w(VEG.plum, 1), w(VEG.apple, 1)] },
    buildingStyle: 'western',
    fences: { front: [FENCES.stone1, FENCES.brickOld], side: [FENCES.stone2] },
    props: [PROPS.firewoodCrate, PROPS.hayBaleSquare],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_01', village: 'Cobblestone_01_Wave_V2' },
    drape: { ground: '#a59a62', forest: '#56653a', field: '#c2a866', rock: '#a39a87', sand: '#dccb9a', water: '#3a7896' },
    missing: { en: 'Olive, cypress, agave; whitewashed houses.', fr: 'Oliviers, cyprès, agaves ; maisons blanchies à la chaux.' },
  },
  {
    id: 'desert',
    label: { en: 'Desert / arid', fr: 'Désert / aride' },
    desc: { en: 'No sand surface nor palm/adobe in vanilla: Dirt/Pebbles/Rock approximate it; real sand needs a desert terrain mod.', fr: 'Pas de surface sable ni palmiers/maisons en pisé en vanilla : Dirt/Pebbles/Rock en approximation ; un vrai sable demande un mod désert.' },
    availability: 'mods', ff: 'DESERT', maps: [], fallback: 'mediterranean_dry',
    surfaces: { grass: 'Dirt_02', meadow: 'Pebbles_01', forest: 'Dirt_01', forestConifer: 'Dirt_01', clearing: 'Pebbles_02', field: 'Crop_Field_02', dirt: 'Dirt_02', rock: 'Rock_01', scree: 'Debris_Rock_01', beach: 'Pebbles_02', seabed: 'SeaBed_01', town: 'Concrete_01', heath: 'Pebbles_01' },
    vegetation: { trees: [w(VEG.pineF, 1)], bushes: [w(VEG.hazel2, 1)], treesPerHa: 4, bushesPerHa: 20, gardenTrees: [] },
    buildingStyle: 'none',
    fences: { front: [FENCES.brickOld, FENCES.tin], side: [FENCES.tinRusty] },
    props: [PROPS.firewoodCrate],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_02', village: 'Concrete_01' },
    drape: { ground: '#c9ad78', forest: '#9a8a5a', field: '#b89a60', rock: '#a07f5c', sand: '#e2c98f', water: '#3f7f9a' },
    missing: { en: 'Sand/dune surfaces, palms, desert shrubs, flat-roof houses.', fr: 'Surfaces sable/dunes, palmiers, arbustes du désert, maisons à toit plat.' },
  },
  {
    id: 'winter_tundra',
    label: { en: 'Winter / tundra', fr: 'Hiver / toundra' },
    desc: { en: 'No snow surface in vanilla: mountain grass, heather and dwarf birch give a bare tundra; snow needs a winter mod.', fr: 'Pas de neige en vanilla : herbe de montagne, lande et bouleau nain donnent une toundra nue ; la neige demande un mod hiver.' },
    availability: 'mods', ff: 'WINTER', maps: [], fallback: 'nordic_kolguyev',
    surfaces: { grass: 'MountainGrass_01_aut', meadow: 'MountainGrass_02_aut', forest: 'ForestConiferous_02_aut', forestConifer: 'ForestConiferous_02', clearing: 'Heather_01_aut', field: 'MountainGrass_03_aut', dirt: 'Dirt_03', rock: 'Rock_01', scree: 'Debris_Rock_01_V2', beach: 'Pebbles_02', seabed: 'SeaBed_01', town: 'Concrete_02', heath: 'Heather_01_aut' },
    vegetation: { trees: [w(VEG.spruce, 4), w(VEG.spruceSw, 2), w(VEG.birchAut, 1)], bushes: [w(VEG.hazelAut, 1)], treesPerHa: 120, bushesPerHa: 40, gardenTrees: [w(VEG.birchAut, 1)] },
    buildingStyle: 'soviet',
    fences: { front: [FENCES.woodOld, FENCES.metalUssr], side: [FENCES.wood4] },
    props: [PROPS.woodLogA, PROPS.woodLogB],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_03', village: 'Concrete_02' },
    drape: { ground: '#d9dcd6', forest: '#3c4a3a', field: '#c8c6b8', rock: '#8b8d8f', sand: '#d5d2c4', water: '#4a6878' },
    missing: { en: 'Snow surfaces, snowy trees, snow-covered roofs.', fr: 'Surfaces de neige, arbres enneigés, toits enneigés.' },
  },
  {
    id: 'tropical',
    label: { en: 'Tropical / jungle', fr: 'Tropical / jungle' },
    desc: { en: 'Nothing tropical in vanilla (FF knows a JUNGLE biome flag): requires a jungle asset pack.', fr: 'Rien de tropical en vanilla (FF connaît le drapeau JUNGLE) : nécessite un pack jungle.' },
    availability: 'mods', ff: 'JUNGLE', maps: [], fallback: 'temperate_everon',
    surfaces: { grass: 'Grass_02', meadow: 'Grass_01', forest: 'ForestDeciduous_02', forestConifer: 'ForestDeciduous_02', clearing: 'ForestClearing_Deciduous_01', field: 'Crop_Field_01', dirt: 'Dirt_01', rock: 'Rock_01', scree: 'Debris_Rock_01', beach: 'BeachGrass_01', seabed: 'SeaBed_01', town: 'Dirt_01', heath: 'Grass_03' },
    vegetation: { trees: [w(VEG.alder, 2), w(VEG.willow, 2), w(VEG.lime, 1)], bushes: [w(VEG.hazel, 3), w(VEG.hazelL, 2)], treesPerHa: 450, bushesPerHa: 300, gardenTrees: [w(VEG.plum, 1)] },
    buildingStyle: 'none',
    fences: { front: [FENCES.woodRural], side: [FENCES.woodRural] },
    props: [PROPS.firewoodCrate],
    road: { paved: 'Asphalt_01', dirt: 'Dirt_01', village: 'Dirt_01' },
    drape: { ground: '#4f8a3a', forest: '#24502a', field: '#7f9a45', rock: '#6f6a5c', sand: '#d8c88f', water: '#2f7a7f' },
    missing: { en: 'Palms, jungle canopy, stilt houses, red laterite surfaces.', fr: 'Palmiers, canopée, maisons sur pilotis, latérite rouge.' },
  },
]

export const biome = (id: string): Biome | undefined => BIOMES.find((b) => b.id === id)
/** surface GUID of a role in a biome ("{GUID}Terrains/...emat") */
export const surfaceOf = (b: Biome, role: SurfaceRole): string => SURFACES[b.surfaces[role]]
/** biome whose vanilla assets fill in for `b` (itself when it has a building style) */
export function assetBiome(b: Biome): Biome {
  let cur = b
  for (let i = 0; i < 4 && cur.buildingStyle === 'none' && cur.fallback; i++) cur = biome(cur.fallback) ?? cur
  return cur
}

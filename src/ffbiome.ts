// Freedom Fighters biome: JWK_WorldEntity.m_iBiome (enum JWK_EWorldBiome, flags) picks faction camouflage and vehicles.
// Values from FF source (Scripts/Game/JWK/Framework/Entities/JWK_WorldEntity.c).
import { biome, type FFBiome } from './data/biomes'

export const FF_BIOME_VALUE: Record<FFBiome, number> = { WOODLAND: 1, WINTER: 2, DESERT: 4, JUNGLE: 8 }

/** FF enum name for one of our biomes (unknown id -> WOODLAND, FF's own default for its maps). */
export const ffBiomeName = (id: string): FFBiome => biome(id)?.ff ?? 'WOODLAND'
/** m_iBiome flag value sent to the Workbench. */
export const ffBiomeValue = (id: string): number => FF_BIOME_VALUE[ffBiomeName(id)]

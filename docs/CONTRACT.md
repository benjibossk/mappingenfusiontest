# Contrat du moteur de sol (v1)

Source : `src/contract/schema.ts`. Données JSON pures, validateur sans dépendance, commun à l'app et au pont.

## Entrée (`ContractInput`)
- `version` : 1.
- `heightmap` : grille `{minX, minZ, step, cols, rows, heights[]}` (ligne = Z, colonne = X, `heights.length = cols*rows`).
- `water` : `seaLevel` (nombre ou `null`), `lakes[] {points, level}`, `rivers[] {points, width, depth?}`.
- `roads[]` : `{points, type, width}`. `zones[]` : `{id, kind, points}`.
- `biome` : identifiant (texte). `budget` : `{maxMaterials, maxPerBlock}`.
- `points` = paires X/Z à plat `[x0, z0, x1, z1, ...]`, comme `ProjectShape.points`.

## Sortie (`ContractOutput`)
- `masks[]` : `{name, minX, minZ, step, cols, rows, weights[]}` — exactement une entrée `surfaces` de `POST /masks` (`toMasksPayload`). Poids dans [0,1], noms uniques.
- `vegetation[]` : polygones `{points, generator, prefab?}` (spline + générateur natif, jamais des prefabs à l'unité).
- `budget` : `{materialsUsed, maxPerBlockSeen, overBlocks[], ok}` (`budgetReport` le calcule, blocs de 32 cellules).

## Fonctions
- `validateInput(v)` / `validateOutput(v)` → `{ok, errors[]}` (chemins du type `water.lakes[0].level`).
- `toContractInput(project, {heightmap, biome, seaLevel?, budget?, zones?})` : lacs, rivières et routes reconnus au chemin du générateur.

Changer la forme = incrémenter `CONTRACT_VERSION`.

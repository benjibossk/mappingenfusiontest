# Biomes, bibliothèque d'assets publique et parcelles

Objectif : choisir un **biome** (tempéré, woodland, désert…) pour que les **surfaces**, la
**végétation** et les **parcelles** de village (maison + jardin + clôtures + objets) s'adaptent ;
partager les assets dans une **bibliothèque publique** (biome + tags) ; prévisualiser en **3D**.

État : modèle + code + tests + page `library.html` faits. **Pas encore câblé dans `main.ts`**
(voir § « À câbler »).

---

## 1. Recherche — ce qui existe

### 1.1 Jeu de base (Arma Reforger vanilla)

Sources : `bridge/surfaces-vanilla.txt` (51 surfaces `.emat` vérifiées), index des ressources
(`rdb_index.txt`, prefabs `.et`), `src/data/buildings.ts` (bâtiments mesurés).

| Carte (nom interne) | Prefabs monde | Style |
|---|---|---|
| Everon (`Eden`) | `GenericTerrain_Eden` `{5AD924374E8C7AF6}` | île atlantique tempérée, maisons « _E_ » occidentales |
| Arland | `GenericTerrain_Arland` `{80F042D21CC0BBCA}` | petite île plate boisée, mêmes maisons |
| Kolguyev (`Cain`) | `GenericTerrain_Cain` `{17857A588EC4C3C0}` | île boréale d'automne, variantes **USSR** des maisons |

**Surfaces** (toutes dans `Terrains/Common/Surfaces/`, donc communes aux 3 cartes) :
Grass_01/02/03 (+ `_aut`, `_coastal`, `_aut_leaves`), MountainGrass_01/02/03 (+ `_aut`),
Heather_01 (+ `_aut`), ForestDeciduous_01/02, ForestConiferous_01/02, ForestPine_01,
ForestClearing_Deciduous/Coniferous (+ `_aut`), Crop_Field_01/02, Dirt_01/02/03, Pebbles_01/02,
Rock_01, Debris_Rock_01 (+ V2), Debris_Coal_01/02/03, SulfurStream_01_bed, BeachGrass_01,
SeaBed_01, Asphalt_01, Concrete_01/02, Cobblestone_01_Wave (+ V2).
→ Les variantes **`_aut`** (automne) sont les teintes de Kolguyev (*supposé* : à confirmer dans
les calques `.terr` de Kolguyev, non extraits).
→ **Aucune surface sable, neige, latérite, jungle.**

**Végétation** (`Prefabs/Vegetation/`) : uniquement des essences d'Europe tempérée/boréale —
pin sylvestre, épicéa, bouleau, charme, sorbier, mélèze, aulne, saule, tilleul, prunier, peuplier,
pommier (chacune avec variante `_aut`), noisetier, bouleau nain, plantes (lierre, ronce, ortie…),
potager (tomate, potiron, pomme de terre, chou, poivron). **Ni palmier, ni olivier, ni cyprès,
ni cactus.**

**Bâtiments** : deux styles. `*_E_*` = Everon/Arland (occidental) ; `*_USSR_*` = Kolguyev
(soviétique), souvent la même maquette recolorée. Lieux de culte : `Chapel_01_white`, `Church_01_white` (rangés `civic` dans
`buildings.ts`, `religious` dans la bibliothèque), calvaires, petit clocher. Pas de maison à toit
plat ni en pisé.

**Clôtures / murs** (générateurs `WEGenerators/Walls/`) : bois (01-04, Old, Rural), pierre
(01-02), brique (01, Old, USSR_04), métal décoratif `_E_`, métal USSR, tôle (+ rouillée),
grillage, béton.

### 1.2 Freedom Fighters (JWK, `CAFEBEEFF0CACC1A`)

- `Scripts/Game/JWK/Framework/Entities/JWK_WorldEntity.c` définit
  `enum JWK_EWorldBiome { UNDEFINED=0, WOODLAND=1, WINTER=2, DESERT=4, JUNGLE=8 }` (drapeaux),
  attribut `m_iBiome` du `JWK_WorldEntity` : « utilisé pour choisir personnages et véhicules de
  faction adaptés (camouflage) ».
- `JWK_FactionForceConfig.c` : une force peut être limitée à un biome.
- Les 3 mondes FF (`Prefabs/World/Terrains/JWK_World_{Everon,Arland,Kolguyev}.et`) sont tous
  **`m_iBiome WOODLAND`**. FF ne fournit aucun asset de terrain : il **prévoit** WINTER / DESERT /
  JUNGLE pour des cartes moddées.
- → Notre modèle porte un champ `ff` par biome : à écrire dans le `JWK_WorldEntity` d'une carte
  générée pour que FF choisisse les bons camouflages.

### 1.3 giorbev map-generator (lecture seule)

`data/biomes/biomes.json` : 6 presets (auto, tempéré volcanique, tempéré côtier, alpin/rocheux,
désertique/aride, arctique/toundra) = des **listes de surfaces vanilla** + pondérations par rôle.
`Textures_ArmaReforger/vanilla_base/biomes_presets.json` : tempéré océanique, méditerranéen…
avec un rôle → surface (seabed, coastal, prairie, forêt, lande, roche…). Même constat : leurs
« désert » et « arctique » ne sont que des **approximations vanilla** (Dirt/Pebbles/Rock,
MountainGrass/Heather). Notre table de rôles s'en inspire (`SurfaceRole`).

### 1.4 Workshop (mention seulement, rien téléchargé)

Le Workshop contient des cartes/packs **désert** et **hiver** (surfaces sable / neige, palmiers,
arbres enneigés, maisons à toit plat) et quelques packs **jungle**. Ils ne sont pas vérifiés ici :
c'est précisément le rôle de la bibliothèque — un auteur publie un pack JSON avec les GUID de
son addon (`source` = GUID 16 hex de l'addon) et le biome qu'il couvre.

### 1.5 Biomes proposés (`src/data/biomes.ts`)

| id | Libellé | Dispo | FF | Repli assets | Ce qui manque |
|---|---|---|---|---|---|
| `temperate_everon` | Tempéré européen (Everon) | vanilla | WOODLAND | — | rien |
| `woodland_arland` | Woodland (Arland) | vanilla | WOODLAND | — | rien |
| `nordic_kolguyev` | Soviétique nordique (Kolguyev) | vanilla | WOODLAND | — | confirmer `_aut` |
| `mediterranean_dry` | Méditerranéen sec | partiel | WOODLAND | everon | oliviers, cyprès, maisons blanchies |
| `desert` | Désert / aride | mods | DESERT | méditerranéen | sable, palmiers, toits plats |
| `winter_tundra` | Hiver / toundra | mods | WINTER | kolguyev | neige, arbres/toits enneigés |
| `tropical` | Tropical / jungle | mods | JUNGLE | everon | palmiers, canopée, pilotis |

Chaque biome : palette de surfaces par rôle (13 rôles, **GUID réels** via `SURFACES`),
végétation pondérée + densités (arbres/ha, buissons/ha, arbres de jardin), style de bâtiments,
clôtures (avant / côtés), objets de jardin, surfaces de route, couleurs du drapé 3D.
Biome « mods » = utilisable tout de suite avec ses approximations vanilla + avertissement ; dès
qu'un pack apporte des assets avec ce biome, la recherche les préfère au repli.

---

## 2. Modèle de données & code

| Fichier | Rôle |
|---|---|
| `src/data/biomesSurfaces.ts` | 51 surfaces vanilla nom → `{GUID}…emat` (généré depuis `bridge/surfaces-vanilla.txt`) |
| `src/data/biomes.ts` | `Biome`, `BIOMES`, `VEG` / `FENCES` / `PROPS` (refs vérifiées), `surfaceOf()`, `assetBiome()` (repli) |
| `src/library/schema.ts` | `Asset`, `AssetPack`, `validateAsset/validatePack`, `ASSET_PACK_SCHEMA` (JSON Schema 2020-12) |
| `src/library/seed.ts` | `VANILLA_PACK` **dérivé** de `BUILDINGS`, `INDUSTRIAL`, `MIL_PREFABS`, `MIL_WALLS`, `FENCE_NET` + biomes (aucune duplication) |
| `src/library/index.ts` | `buildLibrary`, `defaultLibrary`, `search`, `tagCounts`, `importPack`, `exportPack` |
| `src/biomes/parcel.ts` | `LotTemplate`, `LOT_TEMPLATES`, `generateParcel`, `demoLot` |
| `src/library/viewer3d.ts` | visionneuse three (lazy) : `createViewer(host).showAsset / showParcel / dispose` |
| `src/library/page.ts` + `page.css`, `library.html` | page de navigation de la bibliothèque |
| `vite.config.ts` | build multi-pages (`index.html` + `library.html`) — nouveau fichier, rien d'existant écrasé |

```ts
interface Asset {
  guid: string            // "{16 HEX}Prefabs/....et"
  name?: string
  kind: 'house'|'farm'|'annex'|'shed'|'civic'|'religious'|'block'|'industrial'|'military'|'fence'|'wall'|'tree'|'bush'|'prop'
  footprint: { minX, minZ, maxX, maxZ, h, measured? }   // m, +Z = façade côté rue
  biomes: string[]        // ids de biomes (un id de biome moddé est permis)
  tags: string[]
  source: 'vanilla' | string   // ou GUID d'addon (16 hex)
  author: string; licence: string
}
```

Règle d'attache vanilla : chemin contenant `USSR` → Kolguyev + toundra ; `_E_` → Everon, Arland,
méditerranéen ; ni l'un ni l'autre (abris, garages) → tous. Végétation : selon les listes des
biomes, sinon `_aut` → Kolguyev. Hauteurs **estimées** (prefabs.txt ne donne que XZ) ;
`measured: true` = emprise XZ mesurée au Workbench.

Recherche : `search(lib, { text, tags, biome, kind, source, fallback })` — texte insensible
casse/accents, tous les mots requis, tags en ET, biome exact classé avant le biome de repli.

### Parcelles
`LotTemplate` = plage de façade/profondeur, recul de la maison, types de maison (+ tags), annexes
(type + nombre), clôtures (avant/côtés/fond + largeur du portail), nombre d'objets et d'arbres
de jardin. 3 gabarits : maisonnette, maison de village, corps de ferme.
`generateParcel(lib, biomeId, template, lot, seed)` remplit un `Lot` de `villageLots.ts`
(import lecture seule) : maison la plus adaptée centrée au recul, façade vers la rue
(`yaw = atan2(-n)`, même convention que `FRONT_YAW`), annexes/objets/arbres sans chevauchement
dans le fond, clôtures en polylignes sur les bords du lot avec ouverture de portail.
Déterministe par seed. Renvoie `{ items, fences, corners, warnings }`.

Tests : `node --import ./tests/library/resolve-ts.mjs --test tests/biomes/*.test.ts tests/library/*.test.ts`
(le hook ajoute `.ts` aux imports sans extension style Vite). 9 tests : GUID de surfaces,
seed valide et couvrant tous les bâtiments, refs végétation/clôtures/objets présentes dans
l'index rdb, styles USSR/E, recherche, import/export, parcelles dans le lot + déterministes +
orientation sur lot tourné.

---

## 3. Bibliothèque publique — contribution, modération, attribution

- **Format** : un fichier JSON par pack, `format: "reforger-mapper.assetpack"`, `version: 1`,
  `id` kebab-case, `name`, `author`, `licence`, `source` (`vanilla` ou GUID d'addon),
  `workshop` (URL, conseillé), `assets[]`. Schéma : `ASSET_PACK_SCHEMA` (à exporter en
  `library/assetpack.schema.json` pour les éditeurs).
- **Emplacement public** : dossier `library/*.json` du dépôt. `library.html` les charge tous
  (`import.meta.glob`) et les valide ; un pack invalide est listé en erreur, pas chargé.
  Plus tard : un index hébergé (`library/index.json` → URL des packs) sans changer le format.
- **Contribuer** : (1) exporter les GUID depuis le Workbench (plugin de capture / Resource
  Browser « Copy resource name »), (2) remplir footprint (mesuré si possible), biomes, tags,
  (3) valider en l'important dans `library.html`, (4) **PR** ajoutant `library/<id>.json`, ou
  partage direct du fichier dans une salle collab (import local, non publié).
- **Modération** : revue de PR — schéma valide (CI : `validatePack`), GUID existants dans
  l'addon cité (`source`), pas de doublon de GUID (le premier pack chargé gagne, le doublon est
  signalé), licence compatible avec la redistribution d'une **référence** (on ne publie que des
  GUID/chemins, jamais de maillages ni textures), auteur réel.
- **Attribution** : `author` + `licence` obligatoires par pack **et** par asset ; affichés dans la
  fiche de l'asset. Les refs vanilla : « Bohemia Interactive », `Bohemia-EULA`. Une carte qui
  utilise un asset moddé doit déclarer l'addon en dépendance : `source` sert à générer la liste.

---

## 4. Visionneuse 3D (`library.html`)

Filtres biome / type / tags / texte, liste (300 premiers), case « inclure le biome de repli »,
import d'un pack local. Panneau 3D (three chargé à la demande) : onglet **Parcelle** (gabarit +
🎲 seed) ou **Asset** (clic dans la liste). Formes simples à partir des emprises : boîte + toit
pour les maisons, cône + tronc pour les arbres, bandes pour clôtures/murs, sol à la couleur du
biome, caméra tournante (OrbitControls autoRotate). Aucun maillage du jeu.
Captures : `scratchpad/pw/library-1-parcelle-everon.png`, `-2-ferme-kolguyev.png`,
`-3-asset.png`, `-4-desert-repli.png`.

---

## 5. À câbler (étape suivante, dans `main.ts` / `i18n.ts` / `style.css`)

> État 2026-11-16 : points 1, 2, 3 (`biomes/vegetation.ts` + `forestgen.ts`), 4 (jardins des lots via `gardenParcel`, hors Everon) et 5 (teintes du drapé et des arbres) câblés. Everon reste identique octet pour octet (`tests/biomes/worldgen-biome.test.ts`).

API exacte disponible :

```ts
import { BIOMES, biome, surfaceOf, assetBiome, type BiomeId, type SurfaceRole } from './data/biomes'
import { defaultLibrary, search, importPack, type Library } from './library'
import { LOT_TEMPLATES, generateParcel, type Parcel3D } from './biomes/parcel'
// 3D (lazy) : const { createViewer } = await import('./library/viewer3d')
```

1. **Sélecteur de biome à l'étape 1** (et dans le dialogue « monde aléatoire ») :
   `<select>` rempli par `BIOMES.map(b => [b.id, lang==='fr' ? b.label.fr : b.label.en])`, badge
   `b.availability` (vanilla / partiel / mods requis) + `b.missing` en infobulle. Stocker
   `project.biome: BiomeId` (défaut `temperate_everon`), à sauvegarder dans le projet.
2. **Surfaces** : là où le peintre de surfaces / l'export choisit un `.emat` par rôle, remplacer
   la constante par `surfaceOf(biome(project.biome)!, role)`. Rôles : grass, meadow, forest,
   forestConifer, clearing, field, dirt, rock, scree, beach, seabed, town, heath. Routes :
   `SURFACES[b.road.paved|dirt|village]`.
3. **Végétation** : `forestgen`/`canopy` tirent leurs prefabs de `b.vegetation.trees/bushes`
   (pondérés) et densités `treesPerHa/bushesPerHa`.
4. **Villages** : dans `village.ts`, pour chaque `Lot` issu de `splitLot`, appeler
   `generateParcel(lib, project.biome, template, lot, seed)` (gabarit choisi selon `lot.w/d` dans
   `t.size`), puis convertir `items` en entités (`x, z, yaw` + hauteur sol) et `fences` en
   formes de générateurs de murs (`guid` = prefab WG_*). Afficher `warnings` (biome de repli).
5. **Drapé 3D** : `src/view3d/drape.ts` peut lire `b.drape.{ground,forest,field,rock,sand,water}`.
6. **Bouton « Bibliothèque »** dans la barre d'outils : `window.open('library.html', '_blank')`
   (ou un panneau intégré réutilisant `createViewer`). Les packs importés localement peuvent
   être passés à `defaultLibrary(extraPacks)` et partagés via `collab.ts` (envoyer le JSON brut,
   `importPack` à la réception).
7. **Export FF** : écrire `m_iBiome <b.ff>` dans le `JWK_WorldEntity` de la carte FF générée.
8. Chaînes i18n à ajouter : `biome`, `biomeAvailability.*`, `library`, `lotTemplate.*`.
9. Script npm conseillé : `"test:library": "node --import ./tests/library/resolve-ts.mjs --test tests/biomes/*.test.ts tests/library/*.test.ts"` (non ajouté : `package.json` hors périmètre).

Limites connues : hauteurs et emprises militaires estimées ; `_aut` = Kolguyev non confirmé ;
biomes « mods » sans aucun asset réel tant qu'aucun pack n'est publié ; la page charge
`military.ts` (≈25 kB) pour `MIL_PREFABS`.

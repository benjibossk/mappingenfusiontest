# Feuille de route — suite (rédigée le 2026-11-16, version 0.4.8)

Ce document remplace la feuille de route d'origine (`ROADMAP.md`, 6 points, tous lancés) et détaille
trois chantiers : **lignes électriques**, **villages (amélioration)**, **zones industrielles**.
Sources marquées `[NV]` = non vérifiées par lecture de la page.

---

## 1. Où on en est

### Fait (CHANGELOG 0.1 → 0.4.8)
- Île fictive (relief façon mapgen4, rivières, mer, côtes), pinceau de relief, masques de surfaces
  (limite 5 surfaces/bloc), image satellite.
- Routes : dessin, réseau automatique A* (`network.ts`), largeur/aplanissement par route, bornes,
  glissières, panneaux, ponts ; nettoyage des splines avant envoi (0.4.7–0.4.8).
- Forêts → Forest Generator (hauteur jeune/normal/mature, CHM LiDAR).
- Lieu réel : DEM (GeoTIFF/asc/hgt/Copernicus), OSM (routes avec largeur par classe, rivières, lacs,
  forêts, champs, bâtiments remplacés par le vanilla le plus proche), « Adapter pour le gameplay ».
- Import du monde ouvert dans le Workbench, édition/suppression d'objets existants.
- **Villages étape 1** (`settlements.ts`, CITIES.md §3.8 étape 1) : bandes constructibles le long des
  routes, découpe en parcelles, maison face à la route + annexe, anneaux centre/mid/edge, contrôle de
  pente 5 points, collisions OBB.
- **Une partie de l'étape 2** : place (`SQUARE_R` village 15 m / ville 24 m), ruelles
  (`LANE_COUNT`), chemins de terre (`trailDirt`), lissage Chaikin ; parcelles capturées dans des mondes
  existants (`templates.ts`, plugin « Capture templates », bibliothèque 📦, type « immeubles + parking »).
- Envoi groupé au Workbench (morceaux ~300 Ko), rapport envoyé/construit, plugin Budget d'entités,
  collaboration multi-utilisateurs, interface guidée en 7 étapes, FR/EN.

### En cours / à valider (RECETTE.md)
- R1 Angers 32 km (envoi complet, 0 « invalid segments »), R2 interface guidée, R3 limite de surfaces
  (**❌ 1 bloc en dépassement sur l'île seed 1**), R4 apports ARTE (largeurs OSM, ponts/tunnels,
  NoData).

### Prévu pour les établissements (CITIES.md §3.3, §3.8, §6.10) — statut
| Type | Prévu | Statut |
|---|---|---|
| Hameau-rue (5–15 bât.) | bandes le long de la route existante, 0–2 pistes de ferme | **fait** |
| Village à place (20–60) | place 30–60 m, 2–5 rues en L-system contraint (pente, eau, accrochage 15 m) | **partiel** : place + ruelles, pas de vrai L-system ni bouclage |
| Petite ville (100–300) | champ tensoriel (radial + routes + courbes de niveau + grille industrielle), îlots fermés, découpe OBB | **à faire** (étapes 3–4) |
| Port / côte | bonus « côte abritée » dans le score de site, district industriel près du port | **à faire** (rien dans `settlements.ts`) |
| Ferme | cours en U (2–4 prefabs), clôtures | **à faire** (gabarits 📦 en dépannage) |
| Placement auto des sites | score sur grille 25–50 m + NMS | **fait côté réseau** (`network.ts` sites), pas pour le type/score complet |
| Murs/clôtures de parcelle | polyline + wall generator en fond de parcelle | **à faire** |

### Ensuite (ordre proposé)
1. Fermer la recette R1–R4 (corriger R3).
2. **Lignes électriques** (§2) — petit, très visible, réutilise le chemin « forme + générateur ».
3. **Villages étape 2 complète** (§3) : L-system, cours de ferme, clôtures, port.
4. **Zones industrielles** (§4).
5. Restes de FINDINGS §5 : validation avant envoi, lisières/corridors, objets isolés, bench FPS.

---

## 2. Module « Lignes électriques »

### 2.1 Ce que fait le moteur
- Générateur natif : `SCR_PowerlineGeneratorEntity`, enfant direct d'une forme polyline/spline ; il
  pose poteaux + câbles (`PowerlineEntity` = un tronçon entre deux poteaux). Types de poteau
  début / défaut / fin / jonction ; câble par défaut `SCR_EPoleCableType.POWER_LV`.
  Sources : [wiki Powerline Generator](https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Powerline_Generator)
  (page 403 au robot, contenu vu via le résumé de recherche),
  [API SCR_PowerlineGeneratorEntity](https://community.bistudio.com/wikidata/external-data/arma-reforger/ArmaReforgerScriptAPIPublic/interfaceSCR__PowerlineGeneratorEntity.html),
  [API PowerlineEntity](https://community.bistudio.com/wikidata/external-data/arma-reforger/ArmaReforgerScriptAPIPublic/interfacePowerlineEntity.html),
  [SCR_PowerlineGeneratorJunctionData](https://community.bistudio.com/wikidata/external-data/arma-reforger/ArmaReforgerScriptAPIPublic/interfaceSCR__PowerlineGeneratorJunctionData.html).
- Déjà noté dans le projet (ENFUSION_FORMATS.md, WIKI_TERRAIN.md) : `m_fDistance 50`, `Clearance 3`,
  « Generate per point » = un poteau exactement sur chaque point ; les forêts avec *Avoid PowerLines*
  dégagent le couloir. GUID connus : `{20E4877A07D28502}` PG_PowerLine_01_WoodenSmall,
  `{613763D114E7CD1C}` Powerline.et.
- Générateurs vanilla (GENERATORS.md) : `PG_PowerLine_EHV_01` (très haute tension), `HV_02_Metal`
  (pylônes), `HV_01_Concrete`, `HV_03_Wooden`, `HV_USSR_01`, `LV_USSR_01`, `01_WoodenSmall`,
  variantes `nowire`.
- `prefabs.txt` (844 prefabs mesurés) ne contient **aucun pylône/poteau électrique** (seuls
  `CablewayWooden_01_pole`, poteaux de ponton) : inutile, le générateur pose ses poteaux lui-même.
  Transformateurs / postes : à chercher dans `Prefabs/Structures/Infrastructure/Power*` [NV] puis à
  mesurer avec le plugin « Measure prefabs ».

### 2.2 Comment un vrai réseau est tracé
- **HT/THT (pylônes)** : de poste à poste, en lignes droites longues, évite villages, pentes fortes et
  lacs ; traverse forêts en tranchée. Méthode standard en SIG : **chemin de moindre coût** (Dijkstra/A*)
  sur un raster de coûts pente + occupation du sol, zones interdites en valeur sentinelle
  ([Chalmers](https://odr.chalmers.se/bitstreams/a1a2366c-fedc-4e8b-a9d2-3d71ebc5d6b7/download),
  [PYORPS](https://pyorps.readthedocs.io/en/latest/README.html),
  [ICAE 2024, pente des pylônes](https://www.energy-proceedings.org/wp-content/uploads/icae2024/1756953085.pdf)).
  Limite connue : distorsion directionnelle de la grille → on redresse le chemin ensuite.
- **MT/BT (poteaux bois/béton)** : suivent les routes à quelques mètres, entrent dans les villages,
  finissent sur un transformateur (poteau ou cabine) ; portées ~30–60 m [NV pour les chiffres].
- **OSM** : `power=line` (surtout sur pylônes) vs `power=minor_line` (réseau de distribution, poteaux),
  `power=tower` / `power=pole` = nœuds sur la ligne, `voltage=*`, `power=substation`
  ([power=line](https://wiki.openstreetmap.org/wiki/Tag:power%3Dline),
  [power=minor_line](https://wiki.openstreetmap.org/wiki/Tag:power=minor_line),
  [power=pole](https://wiki.openstreetmap.org/wiki/Tag:power=pole)).

### 2.3 Modèle de données
```ts
PowerLine { kind: 'hv'|'mv'|'lv'; path: number[]; poles: number[]; length }
Substation { id; x; z; kind: 'hv'|'mv' }          // à ajouter au projet (étape 3)
→ ProjectShape { kind:'polyline', points: poles, generator: POWER_GENERATORS[kind] }
```

### 2.4 Algorithme (premier jet fait : `src/modules/power.ts`, non branché à l'UI)
1. Champ de coûts par cellule : `1 + 6·(pente/pente max)²`, interdit si pente > max (HT 45 %, MT 35 %,
   BT 30 %), eau, cercles d'exclusion (centres de village, bâtiments). Bande 6–25 m d'une route ×
   `roadBonus` (BT 0.35, MT 0.6, HT 1 = ignore les routes) ; sur la chaussée ×3 (traverser oui,
   longer non).
2. A* 8 voisins, tas binaire, heuristique octile.
3. Redressement par ligne de vue (aucune cellule interdite traversée), portée max par morceau.
4. Poteaux : un à chaque coin + intermédiaires répartis pour que portée ≤ `spacing` (HT 220 m, MT 90,
   BT 40).
5. Sortie : polyline « un point = un poteau » pour le générateur natif.

Test : `scratchpad/power.test.ts` (crête raide, lac, village) → 5 OK ; `npx tsc --noEmit` OK.

### 2.5 Côté Workbench
**Générateur natif, pas de placement d'entités** : `MG_ApplyProjectPlugin` → `MG_ShapeBuilder.Create`
crée déjà forme + générateur enfant pour routes/forêts. Il suffit d'envoyer les shapes et, au besoin,
`paramKeys` (`m_fDistance`, « Generate per point ») — noms exacts à confirmer en lisant un
`PG_PowerLine_*.et` (`game_read`). Ensuite ajouter une forêt *Avoid PowerLines* = couloir gratuit.

### 2.6 Place dans le parcours en 7 étapes
Sous-section de l'étape **Routes** (juste après le réseau routier, avant Villages) : bouton
« Lignes électriques » + choix HT/MT/BT ; ou dans l'étape Villages comme « raccorder au réseau ».

### 2.7 Étapes (petites)
1. ✅ Routage pur + test.
2. Lire un `PG_PowerLine_*.et` → GUID et noms de paramètres ; compléter `POWER_GENERATORS`.
3. Postes : clic sur la carte pour poser un poste (HT/MT), stockés dans le projet.
4. Bouton « Relier » : HT poste→poste (arbre couvrant minimal entre postes), puis MT/BT poste →
   chaque village (keepOut = rayon de village pour la HT, rien pour la BT qui y entre).
5. Aperçu carte (ligne + points de poteaux), envoi via le chemin shapes existant.
6. Transformateur au bout de chaque ligne BT (prefab à mesurer).
7. Import OSM `power=line/minor_line` (+ `tower/pole` comme points imposés) en lieu réel.
8. Recette : générateur bien construit, pas de poteau dans l'eau / sur route, couloir forestier dégagé.

---

## 3. Générateur de villages : améliorations

### 3.1 Références utiles
- Emilien, Bernhardt, Peytavie, Cani, Galin 2012 : cartes d'intérêt → graines + routes, **conquête
  anisotrope** pour les parcelles, grammaire de forme ouverte qui s'adapte à la pente
  ([HAL](https://hal.archives-ouvertes.fr/hal-00694525), [PDF](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf)).
- Parish & Müller 2001 (L-system à contraintes globales/locales), Chen et al. 2008 (champ tensoriel),
  watabou, découpe OBB / squelette droit, Townscaper/WFC, OpenTTD, Cities: Skylines (zonage le long des
  routes), Manor Lords (parcelles en lanières) : déjà analysés dans CITIES.md §1 et §6.

### 3.2 Améliorations, par ordre
1. **L-system contraint** (CITIES §3.3) : segments 30–60 m, 90°±20°, rotation vers la courbe de niveau
   si pente > 10 %, arrêt eau/15 %/rayon, accrochage 15 m → boucles. Réutiliser l'A* de `network.ts`
   pour les tronçons difficiles.
2. **Cours de ferme en U** : 2–4 prefabs (ferme + grange + hangar) autour d'une cour, anneau `edge` et
   contact avec les champs ; murs/clôtures via wall generator (polyline arrière de parcelle).
3. **Unique par village** : église sur la place, mairie à côté (CITIES §6.10-9).
4. **Variante selon voisins** : mitoyen au centre, isolé ailleurs, bâtiment d'angle au carrefour.
5. **Port / village côtier** : score de site + bonus côte abritée ; rue parallèle au rivage, quai
   (`PierWooden_01`), `BoatShed_01` (dans prefabs.txt), entrepôts côté port.
6. **Petite ville** : îlots fermés (graphe planaire → faces), découpe OBB, puis champ tensoriel.
7. **Raccordement** : chaque village reçoit une ligne BT (§2) et un transformateur.

---

## 4. Générateur de zones industrielles

### 4.1 Logique d'implantation
- Site : en périphérie d'une ville, le long d'une route principale, d'une voie ferrée, d'une rivière
  ou du port ; terrain plat (≤ 5–8 %), loin du centre (anneau > 0.8 R) ; à côté d'un poste électrique.
- Forme : **grille** (seul endroit où elle est crédible, CITIES §3.3), grands lots 40–120 m, découpe
  OBB récursive, recul 8–15 m, aire de manœuvre en béton, clôture grillagée + portail sur rue
  (wall generators `Net`/`Metal`, GENERATORS.md).
- Contenu : entrepôts/hangars, ateliers, silos, chaufferie + cheminée, citernes, piles de matériaux,
  parking. Ferme industrielle (kolkhoze) = variante agricole : hangars, silos, étables autour d'une cour.

### 4.2 Prefabs vanilla mesurés (prefabs.txt)
Présents : `BoilerHouse_E_02` (+ `smokestack`, `_active`), `CoalLoader_01_*` (convoyeurs, tour, grue),
`CoalMineShaft_USSR_01_*` (Aurora, Nadezhda…), `CablewayWooden_01_*`, `BoatShed_01`, `BlockPile_01`,
`BrickPile_02`, `FarmHouse_*`. Pour hangars, silos, entrepôts, granges : grep plus fin à faire dans
`prefabs.txt` (catégories `Industrial/`, `Farm/`) et compléter `src/data/buildings.ts` avec une
catégorie `industrial` (aujourd'hui seulement maisons/ferme/civique/annexe/hangar).

### 4.3 Étapes
1. Catégorie `industrial` + 10–15 prefabs mesurés (dimensions, porte).
2. Outil « zone industrielle » : l'utilisateur dessine un polygone (ou clic près d'une route principale).
3. Rue de desserte en peigne ou boucle depuis la route principale (spline asphalte large).
4. Découpe OBB en lots, un gros bâtiment par lot + annexes (citernes, piles, parking).
5. Clôtures de lot (polyline + `WG_` grillage), portail côté rue.
6. Poste électrique + ligne MT (§2).
7. Variante ferme collective / silo.

### 4.4 API (fait : `src/modules/industrial.ts`, non branché à l'UI)
Générateur pur, déterministe (seed). Prefabs : `INDUSTRIAL` / `industrialFor(type, role)` dans
`src/data/buildings.ts` (32 prefabs mesurés, rôles `main`/`annex`/`prop`, hors `BuildingCat` : le
générateur de villages est inchangé). Pas de conteneur, palette ni portail mesuré : cours = citernes,
silos, cabines, piles de blocs/briques, tours d'éclairage. Clôture = `FENCE_NET` (`WG_NetFence_01`, chemin nu).
- `generateIndustrial(heightAt, roads, { type: 'factory'|'depot'|'quarry'|'farm'|'fuel', seed, polygon? | center+size?, lotMin, lotMax, rowDepth, setback, spineWidth, streetWidth, gateWidth, props, idPrefix })`
  → `{ roads: Road[] (épine reliée à la route principale la plus proche + rues transversales), lots[{id, corners, gate{x,z,yaw,width}}], placed[{id,prefab,role,lot,x,z,yaw,corners}], fences: ProjectShape[] (polylignes ouvertes, trou = portail), shapes (roadShapes + fences), entities: ProjectEntity[], flatten, frame, warnings }`.
- `flatten: { kind:'platform', polygon, height, falloff, slope }` — aucune requête d'aplanissement de zone
  n'existait (les routes utilisent `Road.flatten` + `carveRoads`) : appliquer avec
  `applyFlatten(heights, grid, flatten)` (en place, même format que `carveRoads`) AVANT `carveRoads`.
- `suggestIndustrialSites(heightAt, roads, { type, bounds, size?, villages?: {x,z,r}[], waterDist?, isWater?, step?, n? })`
  → `[{x,z,score,slope,roadDist,villageDist,waterDist}]` (top N espacés). Villages : `sites` + `SITE_RADIUS[kind]`.
- Branchement : `shapes` → projet (splines/polylignes), `entities` → objets, `roads` éventuellement ajoutés
  à la liste des routes (ids préfixés `ind_`).

---

## 5. Outils IA : ce qui peut vraiment aider
| Outil | Usage | Hors-ligne/gratuit ? |
|---|---|---|
| CityDreamer (CVPR 2024) / [CityDreamer4D](https://arxiv.org/html/2501.08983v1) — code [hzxie/CityDreamer4D](https://github.com/hzxie/CityDreamer4D/) | génère carte sémantique + hauteurs de ville (layout), puis rendu | code ouvert, GPU lourd ; **recherche** — on pourrait au mieux en extraire une carte de zonage |
| [InfiniCity](https://ar5iv.labs.arxiv.org/html/2301.09637) (ICCV 2023) | ville infinie depuis du bruit | **recherche**, pas de code trouvé |
| [CityX](https://arxiv.org/html/2407.17572v2) | PCG piloté par agents LLM | recherche ; l'idée « LLM qui pilote des outils procéduraux » est la seule transposable |
| CityGen (2023) | layout de ville infini contrôlable | recherche [NV code] |
| LLM (Claude, local via Ollama) | transformer « village de pêcheurs, 30 maisons, église au port » en **paramètres** de nos générateurs (type, rayon, quotas, styles) | oui (local) ; réaliste et peu coûteux |
| Diffusion image (SD + ControlNet) | esquisse → plan de masse à retracer comme image calque (déjà supporté) | local gratuit ; qualité inégale |

Conclusion : les générateurs « tout IA » ne produisent pas des prefabs Reforger ; l'apport réaliste =
LLM pour paramétrer et nommer, image calque pour guider à la main. Le cœur reste procédural.

---

## 6. Base militaire — `src/modules/military.ts` (générateur pur)
- `generateMilitary({ kind: 'checkpoint'|'outpost'|'main', x, z, yaw, seed, wall? }) → MilitarySite`
  `{ area: Box, placements: SitePlacement[], entities: ProjectEntity[], shapes: ProjectShape[], roads: Box[], gate: [x,z], flatten: FlattenRequest }`.
  Repère local : portail côté −Z (face à la route d'accès), tours de garde aux 4 coins (+2 au portail pour `main`),
  rue principale portail → centre (+ rue transversale `main`), QG au bout, parc véhicules (bâches) près du portail,
  héliport dans un coin du fond, casernes (`main`) / tentes (`outpost`) en rangées. Périmètre = polyligne ouverte au portail,
  wall generator `WG_ConcreteWall_USSR_03` (main) / `WG_NetFence_USSR_01` (outpost). Pas de Hesco/sacs de sable en vanilla.
- `flattenFor(site, heights, grid, maxGrade=0.02)` : plan au moindre carrés (pente ≤ 2 %) → `site.flatten`.
- `suggestMilitary(heights, grid, { kind, seaLevel, keepOut, roads, coast, count })` → `{x,z,yaw,score,slope,relief,roadDist}[]`
  (plat, en surplomb, route à ~60 m, loin des villages, biais côte optionnel ; `yaw` tourne le portail vers la route).
- `MIL_PREFABS` / `MIL_WALLS` : chemins trouvés dans l'index du jeu (asset_search), **emprises estimées** (pas dans prefabs.txt).

## 7. Aérodrome — `src/modules/airfield.ts` (générateur pur)
- `AIRFIELD_SIZES` small/medium/large = piste 800/1100/1500 m × 25/35/45 m, taxiway 12–18 m, apron, 1–3 hangars.
- `generateAirfield({ size, x, z, yaw, seed, side? }) → Airfield { runway, taxiways, apron, placements, entities, shapes, flatten[2] }` :
  piste + taxiway parallèle (60 m du bord) + 3 bretelles, apron, hangars portes vers la piste, tour de contrôle + antenne,
  dépôt carburant + pompe, balisage `LightRunway_01` tous les 60 m + seuils.
- **Représentation de la piste** : splines de **road generator** (`RG_Road_Concrete_USSR_02` piste, `RG_Road_ConcretePanel_01`
  taxiways/apron) avec `RoadWidth` explicite et `AdjustHeightMap=0`, même format que `roadShapes` — seul chemin que le plugin
  sait déjà construire ; aucun prefab de piste en vanilla. **Non vérifié** : rendu d'un RoadWidth 30–45 m (repli : 2–3 splines de 15 m).
- `flattenAirfield(a, heights, grid) → m³` : plan piste pente ≤ `MAX_RUNWAY_GRADE` (1 %) + 60 m de prolongement, la plate-forme
  (taxiway/apron/bâtiments) prend le même plan (pas de marche). Appliquer avec `applyFlatten`.
- `bestRunwayYaw(...)`, `suggestAirfield(heights, grid, { size, seaLevel, keepOut, count })` : balaye les caps 0–180°,
  garde le moindre terrassement, terrain sec sur toute la bande.

## 8. Helpers communs — `src/modules/gen-common.ts`
`rng(seed)`, `Box` orienté (+Z = avant, yaw en degrés), `boxesOverlap`, `inBox`, `toWorld`, `heightAt`,
`FlattenRequest {box,h0,h1,falloff}` + `applyFlatten(heights, grid, reqs) → m³`, `bestPlane`, `earthwork`, `maxSlope`,
`toEntity`, `wallShape`, `roadShape`, `svgPreview`. Aucun import DOM / i18n (testable sous node/tsx).

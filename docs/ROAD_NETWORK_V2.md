# Réseau routier V2 — étude et conception (2026-11-16)

Étude de trois sources + conception d'un réseau routier « graphe » pour reforger-mapper.
Aucun fichier `src/` modifié. `network.ts` est en cours de refonte par un autre agent : ce
document propose une couche au-dessus, il ne réécrit pas le routage.

---

## 1. Sources

### 1a. KARTMAKER-ARGH (github.com/josharghhh/KARTMAKER-ARGH)
Cloné en lecture seule dans `C:\Users\benbo\tools\third_party\kartmaker-argh\` (jamais exécuté).

- **Licence : aucune** (API GitHub `license: null`, pas de fichier LICENSE). Donc tous droits
  réservés : **on ne copie aucun code**, on réimplémente les idées (cf. `TAT_STUDY.md`).
- **Ce que c'est** : une appli web en un seul fichier (`index.html`, 11 536 lignes ; `backup.html`
  = ancienne copie) pour dessiner des circuits type Mario Kart / F1 en splines 2D, aperçu 3D,
  génération procédurale, export OBJ et « FBX (Enfusion) » (maillages visuels + collision pour
  Blender). Ce n'est **pas** un outil Workbench : il **fabrique des maillages**, ce que nous ne
  faisons pas.
- **Le « Road Network V2 Blueprint » collé par Benji vient de ce dépôt** :
  `ROAD_NETWORK_V2.md` (117 lignes). Références citées : FHWA (giratoires, ICE, RCUT/MUT/DLT/DDI),
  TxDOT (hiérarchie, gabarits verticaux), SUMO (nodes/edges/lanes/connections).

Implémentation (refs `index.html`) :

| Sujet | Où | Comment |
|---|---|---|
| Échantillonnage spline + dévers auto | `:701` `sampleSpline` | spline de contrôle → polyligne |
| Clothoïdes | `:930` `buildUnitBiClothoid`, `:961` `tryInsertClothoidCorner`, `:1024/1079` | à chaque coin, on remplace l'angle par une **bi-clothoïde** (courbure linéaire montante puis descendante), 18 pas |
| Classes de route | `:1282` `ROAD_CLASS_PRIORITY` | local 0, collector 1, arterial 2, ramp 2.4, freeway 3.2 ; spec UI « voies • vitesse • Rmin • pente max » (`:334`) |
| Choix du contrôle de carrefour (« ICE ») | `:1316` `pickIceControlType` | règles simples : merge/diverge → yield ; rampe → ramp_terminal/DDI ; degré ≤ 2 → rien ; lent + peu de voies → stop ; modéré + ≤ 4 branches → giratoire ; rapide + forte demande → RCUT/MUT/DLT ; sinon feux |
| Graphe | `:1624-1745` | nœuds typés par degré entrant/sortant (`:1648`), jonctions + `laneConnections`, `analyzeNetworkTopology` (`:1349`) |
| Giratoire | `:5620` `insertRoundaboutAt` | insertion géométrique d'un anneau |
| Échangeurs | `:7874`, `:7918` `buildInterchangeBranchPlan` | gabarits de branches |
| Dénivellation (ponts) | `:6233` `enforceNetworkGradeSeparation` | détecte les croisements au même niveau, **soulève** une des deux routes de `clearance − dy` avec un fondu sur un rayon (~2× largeur) |
| Piles | `:3277` `buildSupportMeshes` | une pile tous les `spacing` m si l'écart tablier-sol ≥ `minGap` (`:3303/3360`), évite les obstacles (`:3206`) |
| Profil vertical | — | pas de vraies courbes verticales : seulement le soulèvement lissé + lissage du terrain (`:2166-2482`) |

### 1b. Blog « The art of roads in games » (sandboxspirit.com)
- Les Bézier se prêtent mal aux routes : leur décalage (bord gauche/droit) n'est plus une
  Bézier, d'où des bords pincés ou auto-intersectés dans les virages serrés.
- Les deux bords doivent rester **parallèles** (distance constante à l'axe).
- **Arcs de cercle** : le décalage d'un arc reste un arc → bords propres ; on enchaîne des
  arcs de rayons différents pour tout dessiner ; intersections arc/arc en temps constant.
- Passer d'une droite à un arc donne un saut de force latérale ; les **clothoïdes** (courbure
  progressive) le corrigent mais sont mathématiquement lourdes ; en ville lente, les arcs
  suffisent.

### 1c. Le Blueprint (= `ROAD_NETWORK_V2.md` du dépôt)
Graphe nœuds (intersection/merge/diverge/giratoire/échangeur) + arêtes orientées (classe, voies,
vitesse) ; contrôle ICE ; clothoïdes, courbes verticales, limites par classe ; dénivellation avec
gabarit + piles auto ; pipeline topologie → géométrie → surface → ouvrages → métadonnées trafic ;
étapes A-D. C'est un plan de **simulateur de trafic / générateur de maillage**.

---

## 2. Ce qui s'applique à Reforger (et ce qui ne s'applique pas)

Rappel moteur (docs `ENFUSION_FORMATS.md:83`, `WIKI_TERRAIN.md:55,80`, `FINDINGS.md` §2,
`FF_ET_SKILLS.md:20`) :
- Une route = `SplineShapeEntity` + enfant `RoadGeneratorEntity` (prefab `RG_*`) ; **Enfusion
  fabrique le maillage** et peut ajuster le heightmap (`AdjustHeightMap`).
- **Carrefours** : aucun « junction prefab » de route n'est documenté chez nous ; la pratique BI
  est de **souder** les splines sur **un point partagé à la même hauteur**. Les générateurs
  se chevauchent alors proprement. (Seules les lignes électriques ont un `JunctionData`.)
- **Ponts** : prefabs réels mesurés — tabliers `ConcreteBridge_01` (Narrow 13 m / Narrow_Long et
  Wide 26 m, largeur ±5 / ±6.5 m, dessus +0.13, dessous −1.3, pivot à une extrémité vers +X),
  **piles** `ConcreteBridge_01_Pillar(_narrow)` (Y −4.3..7.05), `BridgeConcrete_E_01_small`
  (13 m × 4.6 m), `PierWooden_02_bridge` (50 m). Placement bout à bout avec un yaw arrondi au degré.
- **IA** : la navigation routière IA vient du réseau produit par le générateur de routes ; il
  n'y a pas de voies, de feux ni de priorités.

| Idée | Pour nous ? |
|---|---|
| Graphe nœuds/arêtes, carrefours soudés | **Oui**, c'est le gain principal (connexité, « îlots », soudure) |
| Classes hiérarchiques → largeur, pente max, Rmin | **Oui**, mappées sur les prefabs `RG_*` |
| Voies, vitesse, connexions de voies, sens unique | **Non** (au mieux visuel : `_DashedLine`) ; pas de sim de trafic |
| Contrôle ICE (feux, RCUT, MUT, DLT, DDI) | **Non**. On garde seulement T / X / giratoire (si possible) |
| Échangeurs autoroutiers (losange, trèfle, trompette) | **Non** pour V2 (cartes rurales d'Europe de l'Est, pas d'autoroute) |
| Clothoïdes / arcs | **Partiel** : lisser la polyligne envoyée (moins de cassures pour le générateur) |
| Courbes verticales + pente max par classe | **Oui** : profil Y envoyé + `carveRoads` |
| Piles auto selon l'écart tablier-sol | **Oui**, mais avec les **vrais prefabs** de piles, pas des maillages |
| Maillages, matériaux, export OBJ/FBX | **Non** (le moteur le fait) |

---

## 3. Conception V2 pour reforger-mapper

### 3.1 Modèle de données (compatible `Road`)
Le `Road` actuel (`roads.ts:52` : `type`, `pts`, `width?`, `flatten`, `bridge?`…) reste **le
format d'export**. On ajoute un graphe **à côté**, d'où l'on dérive les `Road[]` :

```ts
type RoadClass = 'main' | 'secondary' | 'local' | 'street' | 'track' | 'trail'
interface RNode { id: string; x: number; z: number; y?: number
  kind: 'end' | 'join' | 'tee' | 'cross' | 'roundabout' | 'bridgeEnd' }
interface REdge { id: string; a: string; b: string; cls: RoadClass
  type?: RoadType          // surcharge du prefab ; défaut = selon la classe
  pts: number[]            // polyligne x,z intermédiaire (sans a/b)
  profile?: number[]       // Y par point après lissage vertical
  structure?: { kind: 'bridge'; from: number; to: number } }  // abscisses curvilignes
interface RoadGraph { nodes: Map<string, RNode>; edges: REdge[] }
// graphToRoads(g): Road[]  — une Road par arête (ou par chaîne d'arêtes de même classe)
// roadsToGraph(roads, snapDist): RoadGraph — import des routes existantes (soudure via snap())
```
Aller-retour `roads → graphe → roads` sans perte = premier test.

### 3.2 Classes → prefabs Reforger
| Classe | `RoadType` défaut | Largeur | Pente max | Rmin | Usage |
|---|---|---|---|---|---|
| main | `asphaltLine` (E_01_DashedLine) | 8 m | 8 % | 60 m | ville ↔ ville |
| secondary | `asphalt` (E_01) | 8 m | 10 % | 40 m | ville ↔ village |
| local | `asphaltNarrow` | 6 m | 12 % | 25 m | village ↔ hameau |
| street | `cobble` / `asphaltNarrow` | 6 m | 12 % | 10 m (arcs) | rues de bourg |
| track | `dirt` / `dirt2` / `forest` | 4 m | 15 % | 15 m | fermes, forêts |
| trail | `trailDirt`/`trailGravel`/`trailForest` | 2 m | 25 % | 5 m | sentiers |

Les seuils de pente alimentent le coût du routage pente-sensible de `network.ts`
(paramètre, pas réécriture) et la validation (`worstGrade`).

### 3.3 Carrefours
- **Soudure** : toute extrémité à < `snapDist` d'une route devient un nœud ; si elle tombe au milieu
  d'une arête, on **coupe** l'arête (nœud `tee`). Le point partagé reçoit **une seule hauteur**
  (max des profils, puis lissage de part et d'autre).
- **Angle** : imposer ≥ 60° entre branches (sinon ré-orienter les 15-20 derniers mètres de la
  branche mineure pour arriver ~perpendiculaire). Fusionner deux nœuds à < 25 m (pas de
  carrefours décalés minuscules).
- **Priorité** : la classe la plus haute passe « à travers » (sa spline n'est pas coupée en
  export ; la mineure s'y arrête). Optionnel : prefab de panneau stop/céder sur la mineure.
- **Giratoire** : **pas de prefab vanilla connu** (à vérifier par `asset_search "roundabout"`).
  Si absent, giratoire « fabriqué » : une spline **fermée** (cercle de 12-18 m de rayon, ≥ 12
  points) + branches soudées sur l'anneau + îlot central (herbe/décor). Réservé aux villes,
  nœud de degré ≥ 4 de classes main/secondary. Étape tardive, à valider en jeu (IA !).

### 3.4 Géométrie horizontale (lissage « clothoïde-like »)
- Pour chaque sommet d'angle > 10° : remplacer le coin par **arc de rayon ≥ Rmin(classe)**
  raccordé par deux courtes transitions (idée bi-clothoïde ; approximation par 3-5 points avec
  courbure croissante suffit, le générateur interpole). Si la place manque (segments trop
  courts), réduire le rayon et **signaler** dans la validation.
- Rues de ville : arcs simples (conseil du blog), pas de clothoïde.
- Rééchantillonnage régulier (`centreLine`, déjà là) : « points réguliers, peu nombreux »
  (`WIKI_TERRAIN.md:55`).

### 3.5 Profil vertical
- Y brut = terrain sous l'axe. Puis : (1) filtre moyenne glissante sur ~2× Rmin ; (2) écrêtage
  de pente à `maxGrade(classe)` en deux passes (avant/arrière) ; (3) **courbes verticales** :
  arrondi parabolique aux changements de pente > 2 % (longueur ≈ K × Δpente, K ~ 15 m/% en
  rural, 6 en ville). (4) `carveRoads` taille déblai/remblai vers ce profil (déjà le cas pour
  `flatten`).
- Le profil sert aussi à détecter les **ponts** : là où profil − terrain > 4 m sur > 10 m,
  ou au-dessus de l'eau.

### 3.6 Ponts et piles (prefabs réels)
- Une travée `structure: bridge` est **coupée** de la spline (la route s'arrête aux culées ;
  nœuds `bridgeEnd` à hauteur de tablier).
- Choix : longueur L, largeur de route → `BridgeConcrete_E_01_small` (L ≤ 13, route ≤ 4.6 m),
  sinon tabliers `ConcreteBridge_01` Narrow (13/26 m) ou Wide (26 m) mis **bout à bout** avec le
  yaw arrondi au degré (cf. FINDINGS) ; chemins/sentiers en forêt : `PierWooden_02_bridge`.
  Arrondir L au multiple de 13 m en déplaçant les culées.
- **Piles auto** (idée KARTMAKER, mais prefabs) : à chaque joint entre tabliers, si
  écart tablier-sol > ~1.5 m, poser `ConcreteBridge_01_Pillar(_narrow)` avec le haut à
  `deck − 1.3`, enfoncé dans le sol (la pile fait 11.35 m : au-delà, empiler deux piles ou
  refuser et signaler « pont trop haut »).
- Pas de croisement route/route dénivelé en V2 (rare sur nos cartes) : un croisement → carrefour.

### 3.7 Ville vs campagne
- **Campagne** : `network.ts` (routage pente-sensible entre sites) produit les arêtes
  main/secondary/local ; pistes en bout.
- **Ville** : graphe de rues (`CITIES.md` : croissance contrainte, grille déformée par le
  terrain), classe `street`, raccordé au réseau rural par soudure sur les entrées de bourg ;
  arcs courts, pentes jusqu'à 12 %, pas de pont.

---

## 4. Plan par petites étapes (chacune testée)

| # | Étape | Test (vitest) |
|---|---|---|
| 1 | `RoadGraph` + `roadsToGraph` / `graphToRoads` | aller-retour sans perte ; deux routes se touchant → 1 nœud partagé |
| 2 | Soudure + coupe en T + fusion de nœuds proches | T et X synthétiques → degrés 3/4 ; même Y au nœud |
| 3 | Rapport d'îlots (composantes connexes) dans la validation | 2 réseaux séparés → « 2 îlots » |
| 4 | Classes + table prefab/largeur/pente ; `network.ts` lit les seuils | chaque classe → bon `generator` ; pente > max signalée |
| 5 | Lissage horizontal arcs/transitions | rayon mini ≥ Rmin sur zigzag ; extrémités inchangées |
| 6 | Profil vertical (lissage, écrêtage, courbes verticales) | pente max respectée ; Δpente entre points ≤ seuil |
| 7 | Angle mini aux carrefours | branche à 30° → ≥ 60° après correction |
| 8 | Ponts : découpe + choix prefab + bout à bout | rivière de 30 m → 2 tabliers de 13/26 m alignés, culées soudées |
| 9 | Piles auto | tablier à 6 m du sol → piles aux joints, haut à deck−1.3 |
| 10 | Test Workbench réel (spline + RG + pont), conduite IA sur le carrefour | manuel (Benji) |
| 11 | Giratoire (si step 10 OK et IA tolère l'anneau) | anneau fermé ≥ 12 pts, 4 branches soudées |

Ordre conseillé : 1-3 d'abord (valeur immédiate, sans risque), puis 4-6, puis ponts.

---

## 5. Autres articles du blog sandboxspirit.com

L'index (`/blog`) ne compte que **4 articles**, tous sur les routes sauf un. Rien sur le terrain,
les villes ou l'ergonomie d'éditeur.

- **The Simple Geometry Behind Any Road** (`/blog/simple-geometry-of-roads`) : une route n'est
  faite que de droites et d'arcs. Chaque liaison = une droite + un arc tangent aux deux bouts ;
  si les prolongements ne se coupent pas, un profil intermédiaire (Hermite à t = 0.5) découpe
  en deux arcs. *Pour nous* : c'est l'algorithme du §3.4 (congé droite + arc ≥ Rmin), simple à
  tester.
- **The Data Structures of Roads** (`/blog/data-structures-of-roads`) : au lieu de « nœud =
  carrefour, arête = tronçon », les nœuds sont des morceaux physiques de route (tronçons et
  carrefours), reliés par des **profils** (coupe transversale : nombre, largeur, type de voies).
  *Pour nous* : les voies ne servent pas, mais l'idée de stocker la **largeur/classe au point de
  raccord** aide la soudure (§3.3) : deux classes différentes se rejoignent à un nœud qui
  porte la largeur de la plus grande.
- **Art of Roads in Games** : résumé au §1b.
- **What's the Sandbox Spirit?** : manifeste de l'auteur, hors sujet.

Tout reste dans ce fichier : pas besoin de `SANDBOXSPIRIT_BLOG.md`.

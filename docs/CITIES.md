# Génération de villages et de villes : état de l'art et pipeline proposé

Recherche d'idées et d'algorithmes uniquement : aucun code n'a été copié.
Rédigé le 2026-10-15. Les sources marquées « (non vérifié) » n'ont pas pu être consultées
pendant la rédaction (vidéo, page Fab) : leur description repose sur le titre ou la catégorie
du lien et doit être relue avant de s'y fier.

---

## 1. Les sources

### 1.1 Fantasy Town Generator (fantasytowngenerator.com, avec /temporary-settlement)
- **Ce qu'il fait** : il génère une ville complète (plan, bâtiments nommés, habitants, commerces).
  La variante « temporary settlement » produit des campements : tentes et feux disposés autour
  d'un centre, sans vraies rues.
- **Méthode observable** : le plan part d'un tracé de routes principales qui traversent la zone
  (souvent 2 à 4 axes jusqu'aux bords), plus un éventuel fleuve ou une côte. Les bâtiments
  s'alignent ensuite le long des axes, avec un **recul fixe**, et une rotation qui suit la
  tangente de la route. La densité baisse quand on s'éloigne du centre. Le type des bâtiments
  (taverne, forge, ferme) se tire selon la taille de la ville, puis on lui assigne un lot.
  Le campement temporaire n'a pas de rues : c'est un **placement radial ou en anneaux avec
  rejet des collisions** (de type Poisson disk).
- **À retenir** : « axes d'abord, puis bâtiments en façade, densité décroissante ». C'est
  exactement le modèle d'un hameau-rue (Straßendorf).
- **Licence** : code fermé, commercial (freemium). Idées seulement.

### 1.2 FantasyGen, City Map Generator (fantasygen.net/city-map-generator)
- **Ce qu'il fait** : une carte de ville stylisée avec des murailles, des quartiers, des rues
  et des places.
- **Méthode probable** : on y retrouve le principe du générateur de watabou : diagramme de
  **Voronoï** relâché (Lloyd), cellules centrales = quartiers, cellules extérieures =
  campagne, rues = arêtes de Voronoï, et lots découpés à l'intérieur de chaque cellule.
- **Licence** : fermé. Idées seulement.

### 1.3 Vidéo YouTube UmUs9W4riPs (non vérifié)
- Le titre, la description et la transcription n'ont pas pu être récupérés. D'après le
  contexte, c'est probablement un devlog de génération procédurale de ville (routes, puis
  blocs, puis lots). **À visionner** pour compléter cette section : notez-y la méthode de
  croissance des routes et la manière de découper les lots.

### 1.4 Fab listing 013f192b-… (non vérifié)
- C'est un asset Unreal/Unity de la marketplace Fab, probablement un générateur de ville ou de
  route (outil PCG ou spline). Ce type d'outil suit en général le schéma suivant : splines
  de route posées à la main, puis **remplissage PCG des bandes en bordure** (échantillonnage
  le long de la spline, décalage latéral, projection sur le sol, filtre de pente, sélection
  pondérée d'un mesh). **À vérifier.**
- **Licence** : propriétaire (licence Fab standard). Idées seulement.

### 1.5 ProbableTrain MapGenerator (maps.probabletrain.com)
- Dépôt : github.com/ProbableTrain/MapGenerator. Le README et la documentation sont en ligne
  sur le site.
- **Méthode** (d'après Chen et al. 2008) :
  1. **Champ de tenseurs** : c'est une somme pondérée de champs de base. Un champ « grille »
     a une direction fixe. Un champ « radial » est centré sur un point. Le poids décroît avec
     la distance (exponentielle). Les bords d'eau et les routes existantes ajoutent un champ
     aligné sur leur tangente. Le bruit fait pivoter le champ.
  2. **Streamlines** : on intègre le champ (RK4) dans la direction majeure ou mineure à partir
     de graines. On arrête une ligne si elle passe à moins de `dsep` d'une autre ligne,
     sort de la zone ou tombe sur l'eau. On l'étend jusqu'à rejoindre une ligne proche
     (`dlookahead`) pour fermer les carrefours.
  3. **Hiérarchie** : plusieurs passes avec un `dsep` décroissant, d'abord l'eau, puis les
     routes principales, puis les rues majeures et enfin les rues mineures.
  4. **Graphe** : on calcule les intersections, puis on extrait les **polygones** (faces du
     graphe planaire). On rétrécit ces polygones pour obtenir les îlots, puis on les
     **subdivise récursivement** en lots. Les bâtiments sont extrudés à partir des lots.
- **Contrôle utilisateur** : on ajoute ou on déplace les champs de base (grille ou radial), on
  règle `dsep`, la taille, le bruit et la densité des parcs.
- **Licence** : **LGPL-3.0** (à confirmer dans le dépôt). Les idées sont libres. Si on
  reprenait du code, il faudrait le garder dans un module séparé et en publier les sources.
  → On réimplémente.

### 1.6 Simteract City Generator (simteract.com/projects/city-generator)
- Un outil commercial ou de R&D qui génère des villes réalistes pour la simulation (conduite
  autonome, jumeaux numériques). Il génère d'abord le réseau routier, à partir d'OSM ou de
  manière procédurale, puis les voies et les carrefours détaillés. Il découpe ensuite les
  îlots en parcelles et pose des bâtiments tirés d'une bibliothèque d'assets, **dont le type
  dépend du zonage**.
- À retenir : l'**inventaire des assets par catégorie et par taille**, et le zonage qui pilote
  le choix. C'est ce qu'il nous faut pour les prefabs Reforger.
- **Licence** : fermé.

### 1.7 Mapimator City Roads (mapimator.com/tools/city-roads)
- Il extrait les routes d'une ville réelle via l'**API Overpass d'OSM** (`way[highway]` dans
  une bbox ou une zone administrative), puis les rend en SVG/PNG. L'épaisseur du trait dépend
  du type de `highway`. Le principe vient de « city-roads » d'anvaka (MIT).
- **Intérêt pour nous** : on peut importer le **plan réel d'un village français ou est-européen**
  comme gabarit : rues, tags `building=*`, empreintes au sol. On le recale ensuite sur nos
  routes. Les données OSM sont sous **ODbL** : attribution obligatoire, et partage à
  l'identique si on redistribue une base dérivée.
- Le code de Mapimator est fermé. city-roads d'anvaka est sous licence MIT.

### 1.8 Parish & Müller 2001, « Procedural Modeling of Cities » (SIGGRAPH)
- **L-system étendu** : un module de route propose un segment, puis deux jeux de contraintes le
  corrigent.
  - **Global goals** : il suit la densité de population (le point le plus peuplé dans un cône),
    ou un motif (grille, radial, suivi du relief).
  - **Local constraints** : on refuse l'eau et les pentes trop fortes, on tronque ou on pivote
    le segment, et on **accroche** le segment à un carrefour ou à une route existante dans un
    rayon donné.
- Une file de priorité (le « delay » des modules) permet de faire croître les autoroutes avant
  les rues.
- Les îlots sont découpés en lots par subdivision. Les bâtiments utilisent des L-systems de
  façade.
- À retenir : **proposer, puis corriger par contraintes locales**. C'est très adapté à notre
  carte (pente, rivières, mer, routes existantes).

### 1.9 Chen, Esch, Wonka, Müller, Zhang 2008, « Interactive Procedural Street Modeling »
- C'est la base de ProbableTrain. Le champ de tenseurs est éditable à la main avec des pinceaux
  (grille, radial, champ issu d'une polyligne). Le champ **s'aligne sur les contours** :
  littoral, rivière, courbes de niveau via le gradient de hauteur. Les rues sont tracées en
  streamlines, majeures puis mineures.
- À retenir : un **champ dérivé du gradient du terrain** donne des rues qui suivent les courbes
  de niveau (rues de village en flanc de colline). Le contrôle est très bon.

### 1.10 watabou, Medieval Fantasy City Generator
- On génère des points en spirale, puis on construit un **Voronoï** que l'on relaxe. Les
  cellules centrales deviennent des « wards » (place, marché, artisanat, noblesse, ferme…).
  Les murailles suivent le contour des cellules intérieures, et les rues suivent les arêtes de
  Voronoï, de la porte au centre (plus court chemin). Chaque ward est **découpé récursivement**
  (on coupe le polygone sur son plus long côté, à un ratio aléatoire, avec un écart entre les
  lots) jusqu'à atteindre une surface minimale, puis on retire une partie des lots au hasard
  (cours, jardins).
- Licence : l'ancienne version Haxe est publiée sous **GPL-3.0** (dépôt watabou/TownGeneratorOS).
  Les versions web récentes sont fermées. → **Idées seulement** pour nous, car notre projet
  n'est pas GPL.

### 1.11 Découpage de lots
- **OBB recursive split** : on calcule la boîte orientée minimale du polygone, on coupe
  perpendiculairement au grand axe vers 0,4–0,6, et on recommence tant que la surface dépasse
  le maximum. On rejette un lot qui n'a **aucun côté sur une rue** (accès), ou on le fusionne.
- **Straight skeleton** (Vanegas et al. 2012, « Procedural Generation of Parcels in Urban
  Modeling ») : le squelette droit de l'îlot donne des bandes qui longent chaque rue. Chaque
  bande est découpée en lots perpendiculaires à la façade. Résultat : **tous les lots touchent
  la rue**, ce qui est réaliste pour l'Europe. C'est plus complexe à coder. Un **décalage
  intérieur (offset)** à profondeur fixe suffit en pratique pour une première approximation.

### 1.12 Townscaper / Wave Function Collapse
- Townscaper utilise une grille irrégulière (des quads issus d'hexagones relaxés) et des
  modules choisis par **marching cubes et règles d'adjacence**. La WFC sert à assembler des
  tuiles selon des contraintes de voisinage.
- **Pertinence faible** pour nous : on pose des **prefabs entiers** et pas des modules. La WFC
  pourrait servir plus tard pour les murets, les clôtures ou les dépendances d'une cour de
  ferme. Hors MVP.

---

## 2. Tableau comparatif

| Source | Méthode | Entrée | Contrôle utilisateur | Suit le relief ? | Suit les routes existantes ? | Sortie |
|---|---|---|---|---|---|---|
| Fantasy Town Gen | axes + façades, densité radiale | taille, type | faible (preset) | non | non | plan 2D + texte |
| FantasyGen | Voronoï + wards (supposé) | taille, graine | faible | non | non | image de carte |
| ProbableTrain | champ de tenseurs + streamlines + subdivision | champs de base, eau | **fort** (champs éditables) | possible (champ de gradient) | oui (champ de polyligne) | graphe routier, polygones, SVG/STL |
| Simteract | réseau, puis zonage, puis bibliothèque d'assets | OSM ou procédural | moyen | oui (moteur 3D) | oui | scène 3D |
| Mapimator | requête Overpass | bbox/ville réelle | choix de zone | — | — (c'est réel) | polylignes OSM |
| Parish & Müller | L-system + contraintes | densité, eau, relief | moyen (cartes) | **oui** (contrainte locale) | **oui** (accroche) | graphe, lots, bâtiments |
| Chen 2008 | tenseurs interactifs | pinceaux, contours | **fort** | **oui** | **oui** | graphe routier |
| watabou | Voronoï + wards + split | taille, graine | faible | non | non | plan 2D |
| OBB / squelette | subdivision | polygone d'îlot | paramètres | — | façade sur la rue | lots |
| Townscaper/WFC | grille + règles | clics | fort, local | non | non | modules |
| Fab (non vérifié) | spline + PCG en bordure | splines | moyen | oui (projection) | oui | instances |

---

## 3. Pipeline recommandé pour reforger-mapper

Données déjà disponibles : hauteur, pente, rivières, mer, routes utilisateur typées avec
jonctions, parcelles agricoles. Sorties : `ProjectShape` (polyline/spline + generator) et
`ProjectEntity` (`prefab`, `x`, `z`, `yaw`).

**Principe général** : *on ne génère pas une ville sur une feuille blanche.* On **densifie le
réseau existant** :
1. on choisit un centre ;
2. on fait pousser des rues secondaires et des chemins sous contraintes (approche Parish &
   Müller) ;
3. on découpe des **bandes en façade** des rues ;
4. on remplit ces bandes de prefabs.

### 3.1 Placement des localités (seeding)
On calcule un score sur une grille grossière (cellules de 25–50 m) :
- `+` proximité d'une **jonction** de routes (bonus selon le nombre de branches et le type de
  route) ;
- `+` rivière à 50–300 m (eau, moulin), **sans être en zone inondable** : altitude au moins
  2–3 m au-dessus du lit ;
- `+` côte abritée (port) ;
- `+` terrain plat : pente moyenne sous 8 % sur un rayon de 100 m ;
- `+` lisière des parcelles agricoles (les villages sont au milieu des champs) ;
- `−` pente forte, eau, distance à toute route, autre localité à moins de `Dmin` (environ
  1,5 km pour un village et 4 km pour une petite ville).

Ensuite, on prend les maxima locaux avec suppression des non-maxima (Poisson). Le type de
localité découle du score et du rang de la route : un hameau sur une route de rang ≤ chemin,
un village sur une route départementale avec un carrefour, une petite ville sur un carrefour
de routes principales et/ou un pont. L'utilisateur peut **poser ou déplacer** le centre et
le type à la main : c'est le contrôle prioritaire.

### 3.2 Hiérarchie des voies
| Niveau | Source | Largeur indicative | Génération |
|---|---|---|---|
| Route principale | routes utilisateur existantes | — | jamais modifiée |
| Rue | générée | 6–7 m | croissance depuis la route principale |
| Ruelle/chemin | générée | 3–4 m, souvent en terre | depuis les rues, en impasse vers les cours ou les champs |

Chaque voie générée devient un `ProjectShape` `spline` avec le generator de route adapté
(asphalte étroit, gravier, terre), réutilisé depuis la table de types de routes existante.

### 3.3 Croissance des rues, selon le type de localité
- **Hameau-rue** (5–15 bâtiments) : **aucune rue nouvelle**. On utilise des bandes de façade le
  long de la route existante, sur 150–400 m autour de la graine, d'un côté ou des deux. On
  ajoute 0 à 2 chemins de ferme perpendiculaires.
- **Village-place** (20–60 bâtiments) : on crée une **place** (un polygone de 30–60 m) à la
  jonction ou sur le point plat le plus proche. On fait pousser 2 à 5 rues en **L-system
  contraint** à partir de la place et de la route principale :
  - **segment** : 30–60 m, avec un angle de branchement de 90° ± 20° ;
  - **contrainte de pente** : si la pente dans la direction du segment dépasse 10 %, on fait
    pivoter le segment vers la courbe de niveau (projection sur la perpendiculaire du
    gradient) ;
  - **arrêt** : sur l'eau, une pente au-delà de 15 % ou un rayon maximal ;
  - **accroche** : vers un nœud ou une rue à moins de 15 m, ce qui ferme les boucles ;
  - **priorité** : on traite d'abord les segments proches du centre.
- **Petite ville** (100–300 bâtiments) : on combine un **champ de tenseurs** (style Chen) avec
  les éléments suivants :
  - un champ radial au centre (vieux centre) ;
  - un champ aligné sur chaque route existante ;
  - un champ aligné sur les courbes de niveau, pondéré par la pente ;
  - un champ en grille pour un quartier récent ou industriel en périphérie.

  On trace des streamlines avec `dsep` égal à 60–80 m pour les rues et à 30–40 m pour les
  ruelles. Le L-system suffit si l'on veut repousser l'effort : le tenseur est une **étape 3**.
- On évite la grille pure, sauf pour une zone industrielle ou un lotissement : elle n'est pas
  crédible pour Everon/Arland.

### 3.4 Îlots → lots → empreintes
1. **Graphe planaire** : on y met les routes existantes et les nouvelles rues (intersections
   calculées, puis faces extraites). Ces faces sont les **îlots**. Dans le cas d'un hameau, il
   n'y a pas de face fermée : on utilise directement des **bandes** (offset de la polyligne
   de route de chaque côté).
2. **Bande de façade** : on décale l'axe de la rue de `demi-largeur + recul`, puis on crée une
   bande de profondeur `P` (le centre a un recul de 0–2 m et une profondeur de 15–25 m,
   le résidentiel 3–6 m et 25–40 m, une ferme 5–10 m et 40–70 m). C'est l'approximation
   du straight skeleton.
3. **Découpage** : on avance le long de la bande par abscisse curviligne avec une largeur de
   façade tirée selon le district (centre 8–12 m, résidentiel 12–20 m, ferme 25–50 m). On
   coupe perpendiculairement à la tangente locale. Pour les îlots fermés d'une petite ville,
   on applique un **OBB recursive split** au cœur de l'îlot (cours, hangars, parcs) et on rejette
   les lots sans accès.
4. On **saute** un lot avec une probabilité de 10–25 % (jardins, vides), davantage en
   périphérie.
5. **Empreinte** : prefab centré sur la façade du lot, à `recul + profondeur/2` de l'axe. Le
   `yaw` est l'orientation de la tangente, ±90° pour que la **porte fasse face à la rue** (voir
   §4). On ajoute un petit jitter de ±2° et de ±0,5 m. Pour les bâtiments en coin, on choisit
   la rue de rang supérieur.
6. **Collisions** : on teste le chevauchement des OBB entre prefabs placés, avec la route
   (distance de l'OBB à l'axe supérieure à la demi-largeur plus 1 m), et avec l'eau et les
   parcelles agricoles (on **rogne** la parcelle ou on rejette le lot).

### 3.5 Districts et choix du prefab
Le district est attribué par distance au centre et par contexte :
- **centre** (rayon ≈ 0,25 R) : maisons de ville mitoyennes, mairie, église, commerces,
  café. On place un **seul** bâtiment civique par village : l'église va sur la place, la
  mairie à côté.
- **résidentiel** (0,25–0,8 R) : maisons individuelles avec jardin.
- **ferme** (au-delà de 0,8 R ou au contact des parcelles agricoles) : corps de ferme,
  granges et hangars regroupés en **cour** (2–4 prefabs disposés en U autour d'une cour).
- **industriel** (petite ville, le long de la route principale ou près de la rivière, du rail
  ou du port) : entrepôts, ateliers, silos.

Choix du prefab pour un lot :
1. on filtre les candidats de la table `district ∈ tags`, `largeur ≤ façade − 2·marge`,
   `profondeur ≤ P` ;
2. on fait un tirage **pondéré** par le poids du prefab, en limitant la répétition (pas deux
   fois le même prefab côte à côte) ;
3. s'il n'y a aucun candidat, on refait la découpe avec une façade plus large ou on laisse le
   lot vide.

### 3.6 Limites de pente
- On échantillonne la hauteur aux **4 coins et au centre** de l'OBB du prefab. On calcule
  `Δh = max − min`.
- On accepte si `Δh ≤ maxDrop` du prefab : environ 0,5 m pour une maison sans soubassement,
  1–1,5 m pour une maison avec soubassement ou cave, 0,3 m pour un hangar ou un entrepôt.
- Valeurs de repli : pente du lot ≤ 8 % pour le centre et l'industriel, ≤ 12 % pour le
  résidentiel, ≤ 15 % pour les granges. Au-delà, on rejette le lot.
- Rues générées : pente longitudinale ≤ 10 % pour une rue et ≤ 15 % pour un chemin.
- Plus tard : un aplanissement local du terrain (terrain flatten) via le Workbench. Hors MVP.

### 3.7 Sortie
- Chaque rue ou ruelle donne un `ProjectShape { kind:'spline', closed:false, points, generator,
  paramKeys:['RoadWidth'], … }`.
- La place donne un `ProjectShape` `polyline` fermé, avec un generator de surface ou de pavés
  s'il en existe un.
- Les clôtures et murets éventuels (étape 2) donnent un `ProjectShape` `polyline` avec un
  generator de mur, le long de la limite arrière ou latérale du lot.
- Chaque bâtiment donne un `ProjectEntity { id, prefab:'{GUID}path.et', x, z, yaw }`. La hauteur
  est laissée au Workbench (accroche au sol à la création).
- On regroupe les éléments par localité avec un `id` préfixé (`settle-<n>-…`) pour pouvoir
  supprimer et régénérer une localité. Graine aléatoire par localité, pour un résultat
  reproductible.

### 3.8 Étapes d'implémentation
- **Étape 1, MVP : « hameau et village-rue le long des routes existantes »**
  - L'utilisateur clique sur une jonction ou un point de route, puis choisit le type (hameau
    ou village) et le rayon.
  - On crée des bandes de façade des deux côtés des routes existantes dans le rayon, avec
    découpage curviligne, district par distance (centre, résidentiel, ferme), contrôle de
    pente aux 5 points et tests de collision OBB.
  - Une **table de prefabs écrite à la main** de 15–25 bâtiments, avec ses dimensions et le côté
    de la porte.
  - On ne génère aucune rue nouvelle. La sortie est uniquement constituée de `ProjectEntity`.
  - Un aperçu 2D est dessiné sur la carte (rectangles orientés) avant l'envoi au Workbench.
- **Étape 2** : création de la place et rues secondaires en L-system contraint (pente, eau,
  accroche), avec sortie en `spline`. On ajoute les cours de ferme en U et les clôtures.
- **Étape 3** : le placement automatique des localités (score, §3.1), puis des îlots fermés,
  l'OBB split et le zonage industriel.
- **Étape 4** : champ de tenseurs pour les petites villes, avec un champ de base éditable dans
  l'UI. Import OSM optionnel comme gabarit.

---

## 4. Données nécessaires sur les prefabs vanilla

**L'inventaire des prefabs reste à faire.** Pour chaque prefab de bâtiment
(`Prefabs/Structures/Houses/...`, `.../Farms/...`, `.../Industrial/...`, `.../Civic/...`), il
nous faut :

| Champ | Usage |
|---|---|
| `prefab` (`{GUID}path.et`) | sortie |
| `width`, `depth` (m, dans le repère local) | découpage, collisions |
| `offset` (centre de la bbox par rapport à l'origine du prefab) | une origine décentrée est courante ; corriger x/z |
| `doorSide` (`+z`, `-z`, `+x`, `-x`) | calcul du yaw pour que la porte fasse face à la rue |
| `districts` (`centre`/`residential`/`farm`/`industrial`/`civic`) | choix |
| `maxDrop` (m) | limite de pente |
| `weight`, `unique` (église, mairie) | tirage |
| `terrace` (bool, mitoyen possible) | rangées de maisons de ville au centre |

Deux façons d'obtenir l'empreinte :
1. **Via l'API du Workbench** (plugin existant ou enfusion-mcp) : instancier chaque prefab dans
   un monde vide, lire `IEntity.GetBounds(mins, maxs)` (ou la bbox du mesh visuel), puis la
   transformation, puis exporter en JSON. On automatise une fois pour toutes. Attention : la
   bbox inclut les débords (perron, auvent) et l'**origine** n'est pas toujours au centre.
2. **Table écrite à la main** : on mesure dans le Workbench (gizmo, grille), puis on note le
   côté de la porte à l'œil. C'est fiable mais lent. Une combinaison est recommandée : **bbox
   automatique + `doorSide`, districts et `maxDrop` saisis à la main** dans un JSON versionné
   (`data/prefabs-buildings.json`).

Le côté de la porte ne se déduit pas d'une bbox. Pistes possibles : la position des entités
porte enfants, si le prefab en contient, ou la saisie manuelle.

---

## 5. Licences

| Source | Code | Licence | Usage pour nous |
|---|---|---|---|
| ProbableTrain MapGenerator | ouvert | LGPL-3.0 (à confirmer) | idées ; réimplémenter |
| watabou TownGeneratorOS (Haxe) | ouvert | GPL-3.0 | idées seulement (contaminant) |
| watabou MFCG web récent | fermé | — | idées |
| anvaka city-roads | ouvert | MIT | idées ; réutilisable avec mention |
| Données OSM / Overpass | ouvertes | ODbL | attribution + partage à l'identique des bases dérivées |
| Fantasy Town Generator | fermé | — | idées |
| FantasyGen | fermé | — | idées |
| Simteract | fermé | — | idées |
| Mapimator | fermé | — | idées |
| Asset Fab | propriétaire | licence Fab | idées ; à vérifier |
| Vidéo YouTube | — | droits d'auteur | idées |
| Articles (Parish & Müller, Chen, Vanegas) | — | publications | algorithmes librement réimplémentables |

Règle : **aucun code copié**. Tout est réimplémenté en TS à partir des descriptions
algorithmiques ci-dessus.

## 6. City builders : logiques récupérables

Synthèse des mécaniques de croissance de jeux et simulateurs réels, tirée de docs, wikis
et pages de code. Aucun code n'est copié ; le code GPL ne sert qu'à inspirer une logique réécrite.

### 6.1 OpenTTD : croissance des villes (`src/town_cmd.cpp`)

Sources : https://github.com/OpenTTD/OpenTTD/blob/master/src/town_cmd.cpp ,
https://wiki.openttd.org/en/Manual/Game%20mechanics ,
https://wiki.openttd.org/en/Manual/Settings/Road%20layout

1. À chaque tick de croissance : **marche aléatoire le long des routes** depuis le centre ;
   à chaque case, on tente une action (prolonger, bifurquer, construire).
2. Mode de tracé : *original* (organique, bifurcations au hasard), *better roads* (évite
   impasses et routes collées), *2x2 / 3x3 grid* (routes autorisées seulement si
   `(x-cx) % (n+1) == 0` ou `(y-cy) % (n+1) == 0` → îlots n×n), *random*.
3. Case libre en bord de route → **maison** plutôt que route (probabilité selon le mode).
4. Rejets : pente incompatible (route sur pente « droite » seulement, maison sur sol
   plat ou à fondations), eau, case occupée.
5. Choix de la maison : filtres climat, **zone de ville** (5 anneaux concentriques
   `dist² < radius[i]`, rayons croissant avec le nombre de maisons), année, taille
   (1×1, 2×1, 1×2, 2×2), puis tirage pondéré. Bâtiments **uniques** (église, stade) posés une fois.
6. Rythme : intervalle entre ticks dépendant des stations desservies et du financement.

À retenir : anneaux de zone, essais répartis le long des routes, tailles de lot discrètes,
bâtiments uniques. GPL v2 → inspiration seulement.

### 6.2 Micropolis (SimCity open source)

Source : https://github.com/SimHacker/micropolis (GPL v3 ; `zone.cpp`, `scan.cpp`)

1. Zones R/C/I peintes en blocs 3×3.
2. Cartes d'influence basse résolution : valeur foncière (distance au centre, terrain,
   pollution, criminalité), trafic, densité de population, couverture des services.
3. À chaque scan, une zone croît ou décroît selon demande + valeur foncière − pollution
   − trafic, à condition d'avoir un **accès routier**.
4. La densité est un niveau 0..N qui remplace la tuile par une version plus dense.

À retenir : un **score de site** (centre + route − pente − nuisance) calculé sur des cartes
basse résolution peu coûteuses. La simulation temporelle n'est pas utile ici.

### 6.3 Cities: Skylines (zonage attaché aux routes)

Sources : https://skylines.paradoxwikis.com/Zoning , https://skylines.paradoxwikis.com/Districts

1. Chaque segment de route crée des **cellules de 8×8 m sur 4 de profondeur** (32 m) de
   chaque côté. Les cellules qui chevauchent une autre route ou un objet sont supprimées.
2. Le joueur peint un type (résidentiel basse/haute densité, commercial, industriel, bureaux).
3. Un bâtiment occupe un **lot de 1..4 × 1..4 cellules**, adossé à la route, façade vers la route.
4. Niveaux 1..5 selon la valeur foncière et les services.
5. **Districts** : polygones peints portant des politiques et des spécialisations
   (agricole, forestière…) qui filtrent les bâtiments.

À retenir directement : bande constructible de profondeur fixe, découpée en cellules ;
lot en cellules ; façade orientée route ; district = filtre de catalogue. Jeu propriétaire :
seules les mécaniques décrites publiquement sont reprises.

### 6.4 Citybound (AGPL v3)

Sources : https://github.com/citybound/citybound , https://aeplay.org/citybound-devblog

Le joueur dessine des **plans** (routes et zones en polygones libres). Les **lots** sont
calculés par intersection zone ∩ bande le long des routes, et chaque lot connaît son côté
façade. Des agents (ménages, entreprises) choisissent ensuite les lots. Le modèle des plans
est éditable et versionné : un plan proposé ne s'applique qu'une fois validé.
À retenir : lot = polygone avec une arête façade ; plans proposés puis appliqués.

### 6.5 Manor Lords (burgage plots) et Banished

Sources : https://wiki.hoodedhorse.com/Manor_Lords/Building ,
https://steamcommunity.com/app/1363080/discussions/0/4524512863775599726/ ,
https://www.gamespot.com/articles/manor-lords-upgrade-town-village-guide/1100-6523015/

Le joueur trace un polygone le long d'une route ; le jeu le découpe en **parcelles
laniérées** : façade étroite sur la route, grande profondeur à l'arrière (jardin, potager,
annexe). Il n'y a pas de grille : les limites sont perpendiculaires à la route et le
« snapping » se fait sur les routes. L'algorithme interne n'est pas publié, seul le
comportement observé est décrit. Banished n'a pas de génération automatique ; on en retient
seulement les grappes de maisons autour des services.

C'est **la référence la plus juste pour un village-rue européen** : façade de 12 à 25 m,
profondeur de 30 à 60 m, maison en façade, grange au fond, haie ou clôture sur les limites latérales.

### 6.6 Emilien et al. 2012, « Procedural generation of villages on arbitrary terrains »

Source : https://hal.inria.fr/hal-00694525 (The Visual Computer, 2012)

1. Ajout incrémental de bâtiments selon une **fonction d'intérêt** : distance au centre,
   pente, altitude, eau, route.
2. Chaque nouveau bâtiment est raccordé au réseau par un plus court chemin pondéré par la pente.
3. Les parcelles sont déduites ensuite par expansion ; les bâtiments sont orientés selon
   la route ou la pente.
4. Jeux de paramètres selon le type de village (perché, de plaine, de vallée).

À retenir : la fonction d'intérêt par candidat, le faîtage parallèle aux courbes de niveau,
le remplissage jusqu'à un quota. Article académique : la logique est réimplémentable.

### 6.7 Minecraft (villages « jigsaw »)

Sources : https://minecraft.wiki/w/Jigsaw_Block , https://minecraft.wiki/w/Village

Une pièce de départ (place, puits) est posée, puis on attache par **connecteurs** des pièces
tirées dans des **pools pondérés** par biome. La profondeur est limitée (environ 7) et toute
pièce en collision de boîtes englobantes est rejetée. Les rues suivent le relief.
À retenir : pools pondérés, connecteur « bord de route → porte du prefab », test OBB,
profondeur bornée.

### 6.8 Townscaper

Source : https://www.gamedeveloper.com/design/how-townscaper-works-a-story-four-games-in-the-making

Grille irrégulière et WFC sur les coins : le module affiché dépend des voisins.
À retenir : **choisir la variante selon les voisins** (maison mitoyenne, isolée ou d'angle).

### 6.9 Le site comme city builder : outils d'interaction

Les jeux reposent tous sur une boucle **outil → aperçu fantôme → validation → croissance**.
Outils proposés pour un canvas 2D vu de dessus, chacun relié à l'étape de génération qu'il pilote :

| Outil (UI) | Inspiration | Étape pilotée |
|---|---|---|
| **Route** : polyligne cliquée/glissée avec snapping sur les nœuds et routes existants, choix de la classe (chemin, rue, départementale) | C:S, Citybound | Graphe de voies (§3.2) ; recalcule les bandes constructibles |
| **Pinceau de zone** : glisser le long d'une route pour peindre les cellules de bande (8 m) ; un clic-droit efface ; taille 1 à 4 cellules | C:S | Bande → type (résidentiel, ferme, centre, industrie) |
| **Lasso de parcelles** : polygone libre adossé à une route, découpé en lanières en direct, avec une poignée de largeur de façade | Manor Lords | Découpe en lots (§3.4) |
| **District** : polygone peint et nommé, avec un style (Everon/Arland), une époque et une faction | C:S, Citybound | Filtre du pool de prefabs (§3.5) |
| **Sélecteurs de densité, d'époque et de style** (par district ou par localité), curseur de remplissage en % | OpenTTD (années), C:S (niveaux) | Taux de remplissage par anneau, filtre de catalogue |
| **Centre et rayon** : déplacer le centre d'une localité ; type hameau, village ou bourg | OpenTTD (anneaux) | Anneaux de zone, quota |
| **Bâtiment unique** : épingler église, mairie ou place sur un lot | OpenTTD | Réserve le lot avant le remplissage |
| **Édition de lot** : clic sur un lot pour figer ou rejeter le prefab, en tirer un autre, le tourner ou le vider | Citybound | Surcharge manuelle conservée lors des régénérations |
| **Croissance** : bouton « générer » instantané, plus un mode « pas à pas » ou « lecture » qui remplit les lots dans l'ordre du score | Micropolis, OpenTTD | Ordre de remplissage ; utile pour régler le quota à vue |
| **Graine** : afficher et changer le seed, avec un bouton pour retirer au hasard ce qui n'est pas verrouillé | — | Déterminisme |
| **Calques** de pente, de score et de zones (heatmap) | Micropolis (cartes) | Diagnostic des rejets |
| **Annuler / Rétablir** : pile de commandes (pattern Command) sur le modèle éditable, la génération étant une fonction pure | Citybound (plans) | Toute l'édition |
| **Export** des placements de prefabs (`.layer` ou JSON) | — | Sortie (§3.7) |

Principe : on stocke **l'intention** (routes, zones, districts, verrous) et non le résultat ;
les bâtiments sont recalculés de façon déterministe à partir de l'intention et du seed.
Le mode « croissance dans le temps » n'est qu'une animation de l'ordre de remplissage,
pas une simulation.

### 6.10 Ce qu'on retient pour reforger-mapper (ordre d'implémentation)

1. **Bande constructible** de part et d'autre de chaque route : 35 à 50 m de profondeur en
   hameau ou village, 25 à 35 m en centre de bourg ; on exclut l'eau, les routes et les pentes au-delà du seuil.
2. **Parcelles laniérées** : découpe perpendiculaire à la route, façade de 12 à 25 m au
   village et de 8 à 14 m en centre de bourg, avec un jitter de ±10 %.
3. **Prefab en façade** : la bbox doit tenir dans le lot avec un recul de 2 à 6 m, la porte
   tournée vers la route ; rejet par collision OBB avec les voisins et la route.
4. **Pente** : rejet si le dénivelé sous l'empreinte dépasse le seuil du prefab ; faîtage
   parallèle aux courbes de niveau quand c'est possible ; pose à la hauteur min ou médiane.
5. **Fond de parcelle** : grange, remise ou jardin si la profondeur restante dépasse 15 m.
6. **Anneaux** selon d/rayon (50, 120 ou 250 m) : 0 = centre (église, mairie, mitoyen),
   1 = maisons serrées, 2 = maisons avec jardins, 3 = fermes et lots vides.
7. **Taux de remplissage** par anneau (par exemple 90, 70, 45, 20 %) pour un aspect organique.
8. **Score de site** (centre + carrefour − pente − nuisance) qui fixe l'ordre de remplissage
   jusqu'au quota.
9. **Bâtiments uniques** posés sur le meilleur lot de l'anneau 0.
10. **Pools pondérés** par type de localité × anneau × style ou district.
11. **Variante selon les voisins** : mitoyenne, isolée ou d'angle aux carrefours.
12. **Outils UI** dans cet ordre : route, puis centre et rayon, puis génération et seed,
    puis annuler/rétablir, puis édition de lot ; pinceau de zone, lasso et districts viennent ensuite.
13. Plus tard : ruelles en impasse quand une bande est saturée (règle *better roads* : pas d'impasse de moins de 30 m).

Licences : OpenTTD (GPL v2), Micropolis (GPL v3) et Citybound (AGPL v3) ne servent qu'à
inspirer une logique réécrite. C:S, Manor Lords, Minecraft et Townscaper sont propriétaires :
seules leurs mécaniques décrites publiquement sont reprises. Emilien et al. est un article,
donc réimplémentable.

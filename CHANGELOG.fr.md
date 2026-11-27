# Journal des modifications

Version française du [CHANGELOG.md](CHANGELOG.md) (la version anglaise fait foi). Format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/), sous 1.0.0 tant que l'outil est en chantier.

## [Non publié]

## [0.11.0-beta.1] - 2026-11-27

Préversion. Pas encore testé dans le Workbench : la côte en île des cartes depuis une image, la génération de zones de l'Atelier (plugin Workbench modifié, pas encore compilé) et l'import automatique de la satmap.

### Ajouté
- **Carte depuis une image** (Terrain > Image) : n’importe quelle image de carte (topographique, bandes de relief, plan de campagne) est découpée en couleurs ; on donne un rôle à chaque couleur (terre, eau, bande d’altitude, forêt, champ, bord de champ, bâtiment, route, chemin / rail, ignorer) et l’outil construit le relief, les routes, les rivières (axe + profil de largeur, même larges) ou lacs, les bâtiments, les forêts lissées, les champs fermés par leurs bords et les haies. Les voies ferrées en pointillés ne deviennent jamais des bâtiments.
- Cartes depuis une image : rivières, lacs et ponts ; une carte depuis une image devient une île avec une côte naturelle (fond marin, embouchures, plages de sable).
- Satmap : couleurs unies plus bruit, une palette par biome. Elle ne lit plus aucun fichier du jeu, sur le conseil de Bohemia.
- Import automatique de la satmap dans le Workbench (`wb-import-satmap.ps1`).
- Sol de forêt façon Everon.
- Zones de l'Atelier : on dessine une zone sur un monde existant et on y génère villages, lignes électriques, champs, routes et forêt. Entités seulement, jamais les hauteurs. Le plugin Workbench `MG_ApplyProjectPlugin.c` gagne `layer` (calques par zone) et `clear` (supprimer / régénérer une zone).

## [0.10.1] - 2026-11-26

### Corrigé
- Atelier : un terrain existant est reconnu même si ses tuiles n'ont pas la même casse ou le même préfixe que le `.terr` (ex. `ZBK_terrain.terr`), et un monde est relié au terrain qui porte son nom.
- Traits au sol sur les bords de tuiles : l'import des masques régénère la carte des normales par défaut, avec un avertissement si on la saute.
- La sauvegarde du Workbench vise le port NET API de Mapgenerator et ne touche plus le Workbench d'un autre projet.

## [0.10.0] - 2026-11-26

### Ajouté

- Sol : priorité de peinture des masques qui se chevauchent (béton > terre > roche > champs > sol forestier > herbe), le résultat ne dépend plus de l'ordre des masques ; la terre nue est répartie en deux teintes par un bruit basse fréquence (`src/modules/paintPriority.ts`).
- Électricité : les fermes loin de toute route et de toute ligne BT reçoivent une antenne MT tout droit à travers champs jusqu'à un transformateur sur poteau dans la cour ; un branchement de ferme ne longe jamais une route sur plus de 600 m.
- Ville (outil Zone) : chaque îlot est découpé en parcelles sur rue, une par maison, du bord de la rue jusqu'au milieu de l'îlot ; dessinées comme jardins avec sol usé.
- Atelier : bâtiments et pièces de port dessinés avec leur vraie emprise (dimensions du prefab, orientée) au lieu de carrés fixes ; `footprintClashes` trouve les objets qui se chevauchent sur ces emprises.
- Ville : les remises et garages derrière une maison restent dans sa parcelle.
- Import OSM : largeur des routes depuis `width` / `lanes`, type de route selon `surface` (terre, pavés, béton, piste goudronnée), tunnels exclus, ponts marqués.
- Monde aléatoire : parcelles des îlots de ville dessinées comme jardins ; option « Style des maisons » (soviétique) aussi pour le monde aléatoire et l'outil Zone Ville.
- Villages : option « Style des maisons », soviétique (style Kolguyev) avec les maisons USSR vanilla en bois, préfabriquées, les fermes et la villa Guba (uniquement des GUID déjà référencés dans le dépôt).

### Modifié

- Satmap : les textures de sol vanilla sont générées sur ta machine depuis ton propre jeu (automatiquement, par le bridge) et ne sont plus distribuées ; nouveau mode « Couleurs propres » sans aucun pixel Bohemia.
- Workbench : « Fix block borders » après l'import des masques devient optionnel (`-TerrainFix`) : il faisait planter chaque sauvegarde qui suivait.

### Corrigé

- Plus d'objets sur les routes : bordures de station-service, accès des bases, haies sur les routes déviées autour des aérodromes, piles de grumes sur leur piste, tombes du cimetière sur le bas-côté.

## [0.9.0] - 2026-11-25

### Ajouté

- Aérodromes de tous types : base aérienne militaire (piste béton, voie de circulation parallèle, abris durcis pour avions, tour, dépôt de carburant, clôture et portail), aérodrome civil (piste en enrobé, aérogare et parking) et piste en herbe ou en terre au milieu des champs ; pièces et marquages de piste vanilla, bâtiments hors de la bande de piste et sous la pente 1:7 ; le choix Auto prend le plus grand type que le terrain plat permet.
- Intégration naturelle : l'aérodrome dégage son emprise (bâtiments, champs, bois, lignes électriques), coupe ou dévie les routes autour et relie son portail au réseau, plus rien ne se superpose.
- Pistes, voies et tabliers sont peints dans le sol (béton, enrobé ou terre) : ce sont de vraies surfaces dans le jeu.
- Un port NET API Workbench par projet (`wb-launch.ps1`, `MAPGEN_WB_PORT`), avec test de la liaison avant tout envoi.

### Corrigé

- Addon Workbench : un deuxième envoi de suite ne fait plus planter le Workbench.
- Les grands tabliers et aires de retournement ne sortent plus vides ; les longues clôtures et lignes de marquage sont découpées pour se construire.

## [0.8.0] - 2026-11-25

### Ajouté
- **Relief érodé façon Gaea** : crêtes, incision des rivières (stream power), ravines par gouttelettes et passe thermique, avec masques flow / wear / deposits ; option « montagnes » pour de vrais reliefs, détail 8 m conservé.
- **Import depuis Gaea** via Advanced Terrain Tools : un relief érodé fait dans Gaea arrive directement dans le projet.
- **Routes de col** : quand une liaison ne peut pas monter en direct, le routeur trace des lacets à 10-15 % de pente confortable, avec une plateforme plate à chaque virage.
- **Plusieurs projets** : projets enregistrés dans le navigateur, les 3 récents sur l'accueil, et un tableau de bord du projet ouvert (Terrain, Atelier, Masques...).
- **Pièces vanilla partout** : ports vanilla entiers choisis par biome (grands ports pour les villes), sites RP (mine, garage, dépôt, ferme, ruches, bûcheron, scierie), 370 parcelles et 109 fermes vanilla, 712 groupes de rochers vanilla.
- **Score gameplay** : règles de couvert et compatibilité par scénario (Conflict, Combat Ops, Freedom Fighters, King of the Hill, Game Master).
- **Diagnostic automatique après chaque envoi** : vérifie les entités de base d'un monde jouable (liste World Setup) et signale les problèmes ; l'onglet Workbench montre l'état de chaque couche (vide, prête, envoyée, à réenvoyer).
- **Satmap texturée et fond topographique dans l'Atelier** : 37 textures de sol vanilla sur l'image satellite ; teintes d'altitude, ombrage et courbes de niveau derrière l'Atelier.
- **Réseau électrique comme en vanilla** : étoiles basse tension autour des villages, antennes moyenne tension et transformateurs sur poteau pour les fermes isolées, couloirs dégagés en forêt, lignes qui partent de la centrale.
- **Détails de bord de route** : merlons antibruit le long des grandes routes en bord de ville, glissières sur les barrages, lampadaires sur les rues éclairées, cédez-le-passage à chaque entrée de rond-point, sentiers depuis les portes des maisons.
- **Panneau de log de l'appli** : un bouton « Log » dans la barre d'état montre tous les messages (logs des étapes, notifications, erreurs JavaScript), quelle que soit l'étape.
- **Commentaires en 3D** : clic sur un commentaire pour y amener la caméra ; les commentaires deviennent des repères dans le World Editor.

### Modifié
- **Page Bibliothèque d'assets retravaillée** : la colonne de filtres tient sans défiler (recherche en premier, biome avec une description courte, Type et Source côte à côte, 12 mots-clés par défaut avec « Tous les mots-clés », « Effacer les filtres » à côté du compteur) ; packs, mods Workshop et imports déplacés dans un tiroir « Packs et mods » ; lignes de la liste avec le nom d'abord et un badge de type ; fiche de l'asset avec type, taille, source et biomes, et un bouton « Copier le GUID » ; l'aperçu 3D prend toute la hauteur restante ; sur écran étroit, un clic dans la liste amène à l'aperçu.
- **README** (EN/FR) rafraîchi pour la 0.8.0 : galerie montagnes, fonctionnalités, problèmes connus, nouvelles captures.
- **Encadré d'import Gaea** : aide courte sur toute la largeur, nuages d'arbres et masques repliés, champs fichier et Relief pleine largeur.
- **Routes de montagne dans le monde généré** : les liaisons raides entre villes passent en lacets au lieu d'être déclassées, et les gués ne transforment plus une route de ville en piste.
- **Flancs de montagne** : herbe sur les pentes, roche et éboulis en bandes, rochers et falaises de granit au-delà d'environ 37 degrés.
- **Forêts sur les pentes** : les bois montent sur les flancs jusqu'à 35 degrés ; les bois fusionnés n'ont plus de trous.
- **Maisons et parcelles hors des pentes raides** : fermes, champs et lots évitent les pentes fortes ; les maisons traversées par une ruelle sont retirées.
- **Chemins forestiers et agricoles nivelés** : 15 % maximum, avec lacets si possible, sinon supprimés.
- **Villages et villes plus proches des cartes Bohemia** : rues de village obliques, îlots de ville plus petits, cabanons derrière les maisons, chaque lot bâti clôturé, densité par biome, rangées de fermes à Kolguyev et Arland.
- **Interface au look Reforger** : Roboto Condensed en casse normale, coins carrés, barre du haut sur une ligne, panneau latéral repliable, panneaux d'étape plus calmes et visite guidée pour la première fois.
- **Vue 3D** : la grille km est désactivée par défaut.
- **Économie Life** : panneau ancré en bas de la carte, 6 colonnes, noms en anglais.

### Corrigé
- **Plus d'erreur JS à la fin d'un monde aléatoire** quand la carte du guide est absente (« Cannot set properties of null »).
- **Les libellés de la carte suivent la langue de l'interface** : les badges des lieux RP (FERME, SCIERIE, VENTE...) restaient en français.
- **L'envoi n'échoue plus sur les forêts** : les erreurs de géométrie (« Unable to complete output ring ») sont rattrapées au lieu d'interrompre tout l'envoi.
- **Surfaces** : plus de SeaBed noir sur la terre, bords plus doux, plages seulement depuis la vraie mer et sous 12 degrés.
- **Rotation des objets** : les objets à lacet décimal ne restent plus à 0 degré (environ 1 objet sur 7 touché).
- **Import des masques** : sauvegarde par la NET API (sans clavier ni vol de focus), attend la normal map et signale un import raté.
- Haies, arbres et poteaux tenus hors de toutes les routes et pistes ; ports et forêts écartés des autres zones ; chemins de village sans marche sous les plateformes.

## [0.7.0] - 2026-11-19

### Ajouté
- **Ports réalistes** : bassin dragué (-7,5 m), terre-plein plat (+2,2 m), digues, jetées, bouées et rue de quai ; les ports vanilla font face à la mer et évitent les routes.
- **Champs façon FTG** : parcelles en lanières ancrées sur les routes avec gradient de taille, mosaïque de cultures et haies ; parcelles calibrées sur Everon (110 m, rapport 1,5).
- **Plateformes sous chaque bâtiment**, et carrefours raccordés au niveau de la route principale.
- **Sites et modèles de villages vanilla** (Everon / Kolguyev / Arland) avec tamponnage, activés par défaut dans le monde aléatoire, plus une option base militaire vanilla complète.
- **Cartes de référence** (Everon / Kolguyev / Arland) : chargement en lecture seule avec vrai relief, largeurs de rivières, niveaux des lacs, lignes électriques, types de routes exacts et statistiques de placement.
- **Vérification avant envoi** : bâtiments qui se chevauchent, objets sur les routes, objets de zone hors carte, avec correction automatique ; compteur d’objets 3D.
- **Mise à l’échelle selon la taille de carte** : bases, industrie, sites vanilla et ports suivent les densités vanilla mesurées × surface ; bandes d’altitude façon TAT, rochers et buissons en disque de Poisson.
- **Règles de sol issues du vanilla** : roche nue seulement au-delà de 35°, éboulis entre 15 et 35°, galets de rive, herbe de montagne/bruyère selon la hauteur, accotements en terre, pelouses des maisons.
- **Outils Workbench** : import automatique des masques de terrain (script UIA), captures headless du World Editor, audit chiffré après application, capture de fenêtre WGC.
- Villages : orientation mesurée chez Bohemia (de côté, dos à la route), dépendances à côté/derrière, archétypes et mode modèle.
- **Essence de la forêt de l’outil Zone** (`src/biomes/vegetation.ts` `zoneForestLeaf`, `src/main.ts`, #12) : la liste Essence gagne `Auto` (par défaut) : type de feuillage selon l’altitude relative moyenne de la zone (`leafOf`, décalé par le biome), ou selon la part de conifères du biome sans relief ; Mixte / Conifères / Feuillus inchangés. L’export prend déjà le générateur vanilla du biome (`forestGeneratorFor`) ; le journal l’indique maintenant. Tests dans `tests/biomes/forest-rules.test.ts`.
- **Arbres dans les champs** (`src/modules/fieldtrees.ts`, étape 10d du monde aléatoire, #8) : arbres isolés bien à l’intérieur d’environ une parcelle sur six, bouquets de 2 à 4 arbres à certains coins et arbres de haie tous les ~45 m, en entités d’arbres vanilla (`VEG`, feuillus du biome en priorité). Hors routes, forêts, eau et bâtiments. Ils forment une zone `site` `TREES_FIELD` (dessinée, enregistrée et envoyée comme toute zone). Nouveau `WorldParams.fieldTrees` (0-2, curseur dans le dialogue monde aléatoire). Tests : `tests/biomes/fieldtrees.test.ts`.
- **Forêts selon altitude et pente** (`src/modules/forestgen.ts`, #7) : chaque bois généré reste dans une seule tranche d’altitude (`leafOf` : feuillus en bas, mixte à mi-pente, conifères en haut), un bois qui couvre une colline est donc découpé en bandes d’essences au lieu d’une essence moyenne ; `forestCellOk` refuse les cellules plus raides que `FOREST_MAX_SLOPE` (0,55, avant 0,7) et les crêtes convexes exposées juste sous la limite des arbres. Les bosquets des champs prennent `leafOf(0.2)` du biome (mixte en Arland, feuillus en Everon). Tests dans `tests/biomes/forest-rules.test.ts`.
- **Électricité des fermes isolées** (`src/modules/powergrid.ts`, étape 4, `farmMax` 600 m) : une ferme du monde aléatoire (`FARM_*` ou `farm: true`) n’est plus traitée comme un hameau. Elle reçoit un court branchement BT droit depuis le poteau BT le plus proche ; à défaut un transformateur sur poteau (`TransformerSubstation_01`) à côté du poteau MT le plus proche, et le branchement depuis lui ; hors de portée elle reste non alimentée. `GridPlan.farms` indique comment chaque ferme est alimentée. Tests : `tests/library/powerfarm.test.ts`.
- **Distribution électrique dans les localités** (`src/modules/powergrid.ts`, onglet Électricité + dialogue monde aléatoire, enregistré dans le projet) : la ligne amène un transformateur / poteau d'entrée à l'entrée de la localité, sur la route par laquelle elle arrive ; nouveau réglage *Distribution dans les localités* : `auto` (villes et villages de plus de 25 bâtiments en souterrain au-delà de l'entrée, petits villages une courte ligne aérienne dans la rue principale, hameaux une ligne jusqu'au centre), `aérienne`, `souterraine`. Poteaux BT dans les villages divisés par ~5 (graine 77, 8 km : 267 -> 47). Correctif vue 3D : les surfaces au sol des zones (parcelles industrielles, emprise et voiries des bases militaires) étaient dessinées comme des dalles de 7 m flottant à côté des routes ; pièces de pont déplacées dans `src/modules/bridges3d.ts` (testé : tabliers sur l'axe de la route, cap et hauteur).
- **Lignes électriques le long des routes, jamais au-dessus d’une maison** (`src/modules/powerroads.ts`, `powergrid.ts`, `worldpower.ts`) : la BT (petits poteaux bois) et la MT bois USSR suivent le graphe routier, poteaux à 4,5 m du bord de chaussée côté poste (sur l’accotement, ou de l’autre côté, seulement devant une maison), aucun dans un carrefour / rond-point / sur un pont ; MT/HT/THT à 8 / 30 m des maisons, postes et poteaux jamais sur une maison ni une parcelle clôturée ; une portée au-dessus d’une maison reçoit un poteau de contournement. Nouveau contrôle `powerOverBuilding`. Graines 7/21/77 : poteaux BT à moins de 10 m d’une route 36-43 % -> 82-90 %, poteaux dans un bâtiment 11-18 -> 0, maisons sous une ligne 26-47 -> 1-8. 3D : tabliers, garde-corps et piles de ponts aux vraies dimensions des prefabs ; poteaux et câbles avec flèche.
- Étape électrique du monde aléatoire : planificateur hiérarchique (src/modules/worldpower.ts -> powergrid.ts) avec postes et pistes d'accès ; les lignes aboutissent sur les vrais points d'accroche des postes lus dans les prefabs vanilla (src/modules/powersmooth.ts), plus de zigzag des poteaux (portée mini 45 % de l'espacement, coudes quasi droits supprimés).
- Correctif, monde aléatoire : certaines graines 8 km ne créaient aucun lieu — polyclip levait « Unable to complete output ring » dans la découpe des champs et tout le monde échouait ; la découpe réessaie arrondie et n'écarte que la cellule fautive.
- **Routes : rayon de l’autoroute jusqu’aux extrémités, courts ponts sur les ruisseaux** (`src/modules/motorway.ts`, `bridges.ts`, `network.ts`) : `trimTightEnds` arrête l’autoroute ~80 m avant un virage de moins de 225 m que la mer bloque (graine 7 : 64 m près de l’extrémité côtière, désormais ≥ 600 m ; la liaison de bout prend le relais) ; le routage compte 30 au lieu de 400 pour entrer sur un petit ruisseau (force hydro < 0,5), les routes le franchissent donc sur une seule pièce vanilla de 13 m (BridgeConcrete_E_01_small / ConcreteBridge_01 Narrow ; pas de buse dans le vanilla) au lieu de faire un détour ; passages supérieurs vérifiés en tabliers + piles vanilla ConcreteBridge_01. Tests : rayon > 200 m sur toute la longueur des deux chaussées, `tests/library/bridges-streams.test.ts`.
- **Zones de campagne, plus de champs aux hameaux, chemins agricoles courbes** : les zones de campagne du monde aléatoire s’affichent sur la carte (calque « Zones de campagne ») ; hameaux et fermes ont une couronne de champs plus large ; les chemins agricoles suivent les bords des parcelles en courbes douces et rejoignent le réseau routier.
- **Anneau de terrain hors carte** (onglet Relief, docs/OUTSIDE_TERRAIN.md) : `src/modules/outside.ts` construit un anneau au pas de 64 m (2 à 8 km) autour de la carte à partir des hauteurs du bord, lissées le long du bord avec la distance, éteintes vers la mer ou une plaine basse avec du bruit ; raccord exact, côte gardée sous l’eau ; aperçu 3D ; le bridge `POST /outside` écrit `profile/MapGen/outside.txt` en chunks OTC 33x33 pour `MG_ApplyOutside` (copie repo, pas encore compilée).
- **Outil Zone Habitation : le remplissage suit la taille de la zone et la densité** : une grille de rues en boucles (rues parallèles toutes les 2 profondeurs de lot le long de la route principale + rues transversales, src/modules/zoneStreets.ts) dessert tout le polygone ; les lots restent du côté de leur rue ; les arrière-bandes profondes reçoivent des maisons en second rang ; nouveau sélecteur Densité (clairsemée / normale / dense, dense = ~2/3 de la façade sur rue bâtie). Une zone dense de 600×500 m passe de ~15 maisons / 5 rues à ~200 maisons / 11 rues.
- Forêts : lisières progressives dans l’export Workbench (cœur dense + 1 à 2 bandes de générateurs brushland / pionniers vanilla, évitement des obstacles, pas de lisière entre forêts qui se touchent).
- **Largeurs de route = vanilla** (audit de tous les générateurs Prefabs/WEGenerators/Roads, docs/ROAD_NETWORK_V2.md §3.2.1) : asphalte E_01 / ligne pointillée 12 m (au lieu de 8), étroite 8, pavés 8, béton USSR 7,5, dalles béton 3,5, terre 02 / forêt 4,5, sentiers 1,75 ; nouveaux styles béton USSR ligne pointillée (11 m) et étroit (5 m), allée béton, route et sentier de charbon.
- **Classes de route dans le réseau auto** : ville-ville et village-ville = principale (asphalte le plus large, ligne pointillée), village-village = secondaire, hameaux = asphalte étroit, boucles / fermes = terre ; pistes et sentiers auto surtout en forêt = route / sentier forestier, sentiers à découvert terre / gravier en alternance.
- **Option autoroute** (src/modules/motorway.ts, décochée par défaut ; étape Routes et monde aléatoire) : 2 × 2 voies (deux splines d'asphalte 12 m, glissière centrale) entre les plus grands lieux, contournant villes et villages, pente max 6 %, courbes douces, échangeurs à bretelles (losange sur une route qui la croise) et raccords aux deux bouts ; les autres routes passent dessus (lit relevé + tablier) ou sont coupées, jamais de croisement à niveau.
- **Giratoires qui apparaissent vraiment** : aussi là où une principale rencontre une secondaire, à l'entrée d'un lieu (principale / secondaire × locale), ou quand deux T revêtus sont à < 60 m (fusionnés) ; chaque branche finit sur un point de l'anneau ; un anneau sans branche est retiré.

### Corrigé
- Plus de roche nue dans les villages (le masque de localité la change en herbe/terre).
- Électricité : plus aucun poteau dans un bâtiment (raccordements de fermes revérifiés, poteaux impossibles retirés).
- Les bosquets de champs d’Everon ne deviennent plus mixtes.
- Monde aléatoire : plus de bosquets de champs dans un biome sans arbres (désert).

- **Hiérarchie du réseau électrique** (src/modules/powergrid.ts, docs/POWER_GRID.md) : 1 à 3 centrales (DieselPowerPlant_USSR_01, placées près de l'eau / de l'industrie / des routes, loin des localités) avec poste élévateur ; boucle de transport maillée (arbre couvrant + une liaison depuis chaque cul-de-sac) de lignes THT (PG_PowerLine_EHV_01, ses postes doubles en travées) et HT entre centrales et postes 110 kV des villes (TransformerStation110kV_E_01_simple_v1) ; départs MT en arbre vers un transformateur en bordure de chaque village, zone industrielle et ferme isolée (TransformerSubstation_01 / TransformerStation_E_02 / USSR_02) ; BT le long des rues et vers les hameaux. Plateformes aplanies, chemins d'accès, style de poteaux Everon ou soviétique (HV_USSR_01, HV_03_Wooden, LV_USSR_01), couleur par niveau en 2D, postes en volume en 3D, postes exportés en prefabs.
- **Ripisylve** (src/modules/riparian.ts) : roseaux (FG_Brushland_Phragmites) au bord de l'eau puis saules / saulaies (FG_Brushland_Salix) le long des rivières et des rives de lacs. Largeur selon la hauteur au-dessus de l'eau la plus proche (HAND) et la pente de la berge : jusqu'à ~40 m sur les plaines inondables, quelques mètres sur les berges raides, rien sur les falaises ; chaque rive mesurée à part, découpée en taches, hors routes, ponts, champs, forêts, villages et zones. Dans le monde aléatoire, et dans l'onglet Eau pour les rivières dessinées (case + bouton) ; 2D, 3D et export Workbench (générateurs avec évitement).
- **Ripisylve v2** : variantes d’automne (FG_Brushland_Phragmites_aut / FG_Brushland_Salix_aut) quand l’herbe du biome est une surface _aut ; recalcul automatique (temporisé) quand les rivières / lacs dessinés changent ; les forêts qui touchent l’eau sont découpées par la bande (cutForests) au lieu de la bloquer ; en monde aléatoire, hauteur mesurée depuis le haut de la berge creusée (4 m), bandes un peu plus larges.
- **Outil Zone « Ville »** (src/modules/town.ts, PLAN_RESTANT P3 #13) : une ville de 100-300 habitants (40-110 bâtiments) d'après les idées de watabou (code maison) : cellules de Voronoï relaxées autour d'une place centrale, rues principales = plus courts chemins de la place aux routes d'entrée, rues secondaires sur les bords des îlots (boucles fermées, impasses élaguées), cellules extérieures = fermes ; chaque îlot typé (centre, habitat, petit artisanat, parc, parking, église) et rempli selon son type, maisons face à la rue. Les villes du monde aléatoire l'utilisent aussi (repli sur le générateur de village si le site est trop exigu). Les îlots parking / cimetière restent pour l'instant en terrain libre.
- **Vraies dimensions des prefabs** : 4 576 / 4 947 prefabs du catalogue ont `d:[w,dz,h,cx,cz]` lu dans la boîte englobante des maillages .xob du jeu (identique à la mesure Workbench) ; `prefabDims()` (src/library/dims.ts) alimente les emprises et vraies hauteurs de la bibliothèque.

## [0.6.0] - 2026-11-16

### Ajouté
- **Lieu réel** : import local de fichiers .osm (XML) / .geojson (sélecteur ou glisser-déposer) avec un schéma JSON tag -> couche modifiable : routes (largeurs ARTE), eau, forêts, champs, bâtiments, zones résidentielles, lignes électriques.
- **Surfaces** : la roche dépend désormais de la pente et du relief (crêtes, ruptures de pente, hauteur de falaise, altitude, parois quasi verticales) avec une part plafonnée des terres ; les longues pentes régulières gardent herbe / sol forestier et les éboulis ne sont qu’au pied des falaises. Les îles escarpées ne sont plus presque entièrement en roche.
- **Biomes** : choix du biome à l’étape 1 et dans le monde aléatoire (7 biomes, badge de disponibilité, sauvegardé et partagé). Il pilote les sols exportés, la densité et le mélange des forêts, les générateurs de forêt, les jardins des villages et les teintes 3D. Everon inchangé à graine égale.
- Page **Bibliothèque d’assets** (thème sombre, bouton Bibliothèque, aperçu 3D des parcelles et assets).
- **Routes V2** : carrefours soudés, virages arrondis, profil en long, ponts de vallée, îlots reliés.
- **Collaboration pair à pair**, **vue 3D façon OpsTrack**, **réseaux de l’Atelier** et **simplification des textures** : voir la version anglaise pour le détail.
- **Mode Atelier** (carte d'accueil « Ouvrir un projet Workbench existant ») : finir un projet fait dans le Workbench, parité avec les outils de Map Generator Pro de giorbev. Étapes A0-A6 : ouvrir le projet (relais ou lecture seule navigateur), diagnostic des tuiles QTRE, surfaces/biomes, eau comme en jeu + réécriture `.layer` (Appliquer / Restaurer), fond de carte en jeu (militaire / réaliste, légende, PNG 2k-8k), `.conf` des courbes de niveau, sauvegardes `_originaux` + export/import d'archive.
- Relais : routes `/atelier/*` et écriture sûre (refus si Workbench ouvert, SHA, sauvegarde, jamais hors du dossier projet).

### Modifié
- **Finition de l'interface** (`docs/UI_POLISH_PLAN.md`, 20 points, maquettes MILSPEC) : accueil en deux groupes (Créer : 3 cartes égales · Carte existante : 2 cartes larges), en plein écran (plus de panneau d'étape, de Calques ni d'aide derrière), bandeau « Carte en cours → Revenir à ma carte » depuis le Menu, carte Monde aléatoire « ≈ 10 s · 4 à 16 km » ; bouton d'aide dans l'en-tête (32 px, **F1**) au lieu du « ? » flottant, panneau d'aide ancré sous l'en-tête avec onglets Cette étape / FAQ / Lexique / Clavier (lignes d'étape cliquables, légende déplacée ici) ; badge de version à côté du nom avec point ambre si non lu, panneau Nouveautés avec COMPRIS ; aide souris sur une ligne courte en bas au centre (masquable) ; barre 3D groupée (RETOUR 2D, Réaliste / Carte segmenté, relief, bascules Arbres / Grille km, Recentrer, Vue de dessus ; temps de rendu en toast ; aide souris en bas) ; panneau Collaboration avec liste « En ligne » (pastilles nominatives, direct / relais) et Quitter le salon en bas (plus de « (direct : ) » vide ni d'emoji) ; dialogue Partager à onglets Créer / Rejoindre, un seul bouton primaire, lien mono pleine largeur + COPIER, avertissement avec cadenas, lien « Réglages réseau avancés » ; le dialogue Monde aléatoire ne montre plus que la progression pendant le calcul (étapes cochées, %, temps restant, Annuler) et la valeur à droite des curseurs ; toasts empilés en bas au centre de la carte (3 au maximum, les erreurs restent jusqu'à fermeture) ; étapier en 13 px avec libellés courts, boutons d'étape en grille 2 colonnes et actions destructives en liens texte rouges, Précédent / Suivant collés en bas du panneau ; téléphone (< 720 px) : en-tête compact, accueil en une colonne, panneau d'étape repliable. Ancien thème bleu retiré de `style.css` (coins 2 px, ambre seul). Plus aucun emoji dans l'interface.
- **Atelier** : en-tête comme le générateur (← Générateur, sélecteur FR · Français), puce Workbench ambre « Workbench ouvert · lecture seule » avec explication au survol (c'est normal, pas une erreur), étapier avec ✓ fait (vert) et étape courante (ambre), surtitre « Étape A1 / A6 », chiffres-clés en tête du panneau (blocs dépassés / au maximum / tuiles), état vide avec un bouton « Aller à A0 · Projet ». Le journal affiche le chemin complet du projet (barres obliques inverses conservées ; celles perdues dans l'audit venaient du script de test, pas de l'application).

## [0.5.0] - 2026-11-16

La grande version « débutant » : une interface guidée, un monde aléatoire en un clic et beaucoup de nouveautés à poser sur la carte.

### Ajouté
- Pipeline rejouable (src/modules/replay.ts) : générations de monde enregistrées dans le projet (étape, réglages, graine, durées, empreintes) ; boutons « Rejouer tout » (déterministe, empreintes vérifiées) et « Relief en un clic » avec la durée de chaque étape.
- **Interface guidée en 7 étapes** : écran d'accueil avec des chemins d'entrée (Nouvelle île, Monde aléatoire, Lieu réel, Rejoindre un salon, Ouvrir un fichier), puis 7 étapes numérotées (Relief, Sculpter, Eau, Routes, Villages, Champs & forêts, Envoyer) avec Suivant / Précédent et un état fait / à refaire / à faire sur chaque étape. Les réglages avancés sont repliés.
- **De l'aide partout** : bulle « ? » avec les 7 étapes, les commandes, une FAQ et un glossaire, visite guidée à la première visite, et un panneau « Nouveautés » dans l'appli (aussi ouvert par le numéro de version dans la barre d'état).
- **Choix de la langue** : anglais / français avec le % traduit, option « suivre la langue du navigateur », export / import d'un fichier de langue pour que chacun puisse ajouter une traduction.
- **Onglet Collaboration** : commentaires épinglés sur la carte (répondre, résoudre), historique des changements (qui, quelle étape, quand) et mini-carte satellite / ombrage. Les salons sont gardés sur disque par le serveur collab.
- **Générateur de monde aléatoire** : un seul nombre fait une carte entière — relief, rivières et lacs, villes et villages, aérodrome, bases militaires, routes, zones industrielles, lignes électriques, forêts et sols. Ses chiffres sont calibrés sur les vraies cartes Everon, Arland et Kolguyev. Même nombre, même carte.
- **Villages v2** : rues organiques, rues secondaires, cours de ferme, jardins à l'arrière, une église par village, ports, et différents types de lieu (hameau, village, ville).
- **Zones industrielles, bases militaires et aérodromes** (étape Villages) : « Proposer des emplacements » affiche des emplacements numérotés et classés, un clic construit le site et aplanit le sol.
- **Réseau routier qui tient compte de la pente** : le réseau automatique évite les pentes raides et il est vérifié sur le lit de route creusé.
- **Lignes électriques** (étape Routes) : pylônes haute tension entre les lieux principaux, poteaux basse tension le long des routes.
- **Sols depuis une photo satellite** (étape Champs & forêts) : 5 couleurs lues sur la photo, chacune devient un sol, avec aperçu sur la carte ; envoi en masques de sol ou enregistrement d'un PNG.
- **Portages depuis ARTE** (MIT, © Icebird) : table des largeurs de route OpenStreetMap, ponts et tunnels exclus, lit de route au-dessus de l'eau avec un bord adouci, trous des données d'altitude comblés.
- **Pastille de connexion Workbench** avec un guide en 3 étapes et Réessayer ; `start-bridge.bat` lance le relais d'un double-clic.
- Vue ombrage ; l'image satellite est maintenant enregistrée avec le projet.

### Modifié
- **Thème MILSPEC Tactical** : fond sombre, accents ambre, titres lisibles et barre d'état avec X / Z / altitude du curseur.
- **Les gros calculs tournent en arrière-plan** (Web Worker) : la page reste fluide, le panneau de progression affiche un vrai pourcentage, et Annuler arrête le travail sans toucher à ta carte.
- Villages plus denses et plus crédibles dans le monde aléatoire (environ 70 % des parcelles ont une maison au lieu de 30 %).
- README réécrit pour la nouvelle interface, avec un README français et des captures neuves.

### Corrigé
- « Too many layers » dans Workbench : au plus 4 sols par bloc de 64 m, blocs voisins compris.
- Les forêts se génèrent maintenant sur les îles fictives.
- Chaque référence de prefab porte son `{GUID}` vérifié (contrôlé dans la base de ressources du jeu).
- Lieu réel avec Copernicus : le relais est vérifié d'abord ; s'il est éteint, un guide dit quoi lancer, avec Réessayer ou « Utiliser Terrarium ».
- Le réseau routier et la vérification avant envoi sont d'accord ; les pontons construits exprès sur l'eau ne sont plus signalés.
- La visite guidée ne s'ouvre plus par-dessus l'écran d'accueil ; les fermes sont comptées à part des hameaux ; les lieux évitent les lacs.
- Plein de petites corrections pour les débutants : un seul panneau flottant à la fois, libellés plus clairs, étape de l'historique.

## Versions précédentes

Les versions 0.1.0 à 0.4.8 sont décrites (en anglais) dans le [CHANGELOG.md](CHANGELOG.md#048---2026-10-17).

[Non publié]: https://github.com/benjibossk/mappingenfusiontest/compare/v0.8.0...main
[0.8.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.8.0
[0.7.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.7.0
[0.5.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.5.0

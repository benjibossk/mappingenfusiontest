# Journal des modifications

Version française du [CHANGELOG.md](CHANGELOG.md) (la version anglaise fait foi). Format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/), sous 1.0.0 tant que l'outil est en chantier.

## [Non publié]

### Ajouté
- Forêts : lisières progressives dans l’export Workbench (cœur dense + 1 à 2 bandes de générateurs brushland / pionniers vanilla, évitement des obstacles, pas de lisière entre forêts qui se touchent).
- **Anneau de terrain hors carte** (onglet Relief, docs/OUTSIDE_TERRAIN.md) : `src/modules/outside.ts` construit un anneau au pas de 64 m (2 à 8 km) autour de la carte à partir des hauteurs du bord, lissées le long du bord avec la distance, éteintes vers la mer ou une plaine basse avec du bruit ; raccord exact, côte gardée sous l’eau ; aperçu 3D ; le bridge `POST /outside` écrit `profile/MapGen/outside.txt` en chunks OTC 33x33 pour `MG_ApplyOutside` (copie repo, pas encore compilée).
- **Outil Zone Habitation : le remplissage suit la taille de la zone et la densité** : une grille de rues en boucles (rues parallèles toutes les 2 profondeurs de lot le long de la route principale + rues transversales, src/modules/zoneStreets.ts) dessert tout le polygone ; les lots restent du côté de leur rue ; les arrière-bandes profondes reçoivent des maisons en second rang ; nouveau sélecteur Densité (clairsemée / normale / dense, dense = ~2/3 de la façade sur rue bâtie). Une zone dense de 600×500 m passe de ~15 maisons / 5 rues à ~200 maisons / 11 rues.
- **Zones de campagne, plus de champs aux hameaux, chemins agricoles courbes** : les zones de campagne du monde aléatoire s’affichent sur la carte (calque « Zones de campagne ») ; hameaux et fermes ont une couronne de champs plus large ; les chemins agricoles suivent les bords des parcelles en courbes douces et rejoignent le réseau routier.
- **Lieu réel** : import local de fichiers .osm (XML) / .geojson (sélecteur ou glisser-déposer) avec un schéma JSON tag -> couche modifiable : routes (largeurs ARTE), eau, forêts, champs, bâtiments, zones résidentielles, lignes électriques.
- **Largeurs de route = vanilla** (audit de tous les générateurs Prefabs/WEGenerators/Roads, docs/ROAD_NETWORK_V2.md §3.2.1) : asphalte E_01 / ligne pointillée 12 m (au lieu de 8), étroite 8, pavés 8, béton USSR 7,5, dalles béton 3,5, terre 02 / forêt 4,5, sentiers 1,75 ; nouveaux styles béton USSR ligne pointillée (11 m) et étroit (5 m), allée béton, route et sentier de charbon.
- **Classes de route dans le réseau auto** : ville-ville et village-ville = principale (asphalte le plus large, ligne pointillée), village-village = secondaire, hameaux = asphalte étroit, boucles / fermes = terre ; pistes et sentiers auto surtout en forêt = route / sentier forestier, sentiers à découvert terre / gravier en alternance.
- **Option autoroute** (src/modules/motorway.ts, décochée par défaut ; étape Routes et monde aléatoire) : 2 × 2 voies (deux splines d'asphalte 12 m, glissière centrale) entre les plus grands lieux, contournant villes et villages, pente max 6 %, courbes douces, échangeurs à bretelles (losange sur une route qui la croise) et raccords aux deux bouts ; les autres routes passent dessus (lit relevé + tablier) ou sont coupées, jamais de croisement à niveau.
- **Giratoires qui apparaissent vraiment** : aussi là où une principale rencontre une secondaire, à l'entrée d'un lieu (principale / secondaire × locale), ou quand deux T revêtus sont à < 60 m (fusionnés) ; chaque branche finit sur un point de l'anneau ; un anneau sans branche est retiré.

### Corrigé
- Monde aléatoire : plus de bosquets de champs dans un biome sans arbres (désert).

- **Hiérarchie du réseau électrique** (src/modules/powergrid.ts, docs/POWER_GRID.md) : 1 à 3 centrales (DieselPowerPlant_USSR_01, placées près de l'eau / de l'industrie / des routes, loin des localités) avec poste élévateur ; boucle de transport maillée (arbre couvrant + une liaison depuis chaque cul-de-sac) de lignes THT (PG_PowerLine_EHV_01, ses postes doubles en travées) et HT entre centrales et postes 110 kV des villes (TransformerStation110kV_E_01_simple_v1) ; départs MT en arbre vers un transformateur en bordure de chaque village, zone industrielle et ferme isolée (TransformerSubstation_01 / TransformerStation_E_02 / USSR_02) ; BT le long des rues et vers les hameaux. Plateformes aplanies, chemins d'accès, style de poteaux Everon ou soviétique (HV_USSR_01, HV_03_Wooden, LV_USSR_01), couleur par niveau en 2D, postes en volume en 3D, postes exportés en prefabs.
- **Ripisylve** (src/modules/riparian.ts) : roseaux (FG_Brushland_Phragmites) au bord de l'eau puis saules / saulaies (FG_Brushland_Salix) le long des rivières et des rives de lacs. Largeur selon la hauteur au-dessus de l'eau la plus proche (HAND) et la pente de la berge : jusqu'à ~40 m sur les plaines inondables, quelques mètres sur les berges raides, rien sur les falaises ; chaque rive mesurée à part, découpée en taches, hors routes, ponts, champs, forêts, villages et zones. Dans le monde aléatoire, et dans l'onglet Eau pour les rivières dessinées (case + bouton) ; 2D, 3D et export Workbench (générateurs avec évitement).
- **Outil Zone « Ville »** (src/modules/town.ts, PLAN_RESTANT P3 #13) : une ville de 100-300 habitants (40-110 bâtiments) d'après les idées de watabou (code maison) : cellules de Voronoï relaxées autour d'une place centrale, rues principales = plus courts chemins de la place aux routes d'entrée, rues secondaires sur les bords des îlots (boucles fermées, impasses élaguées), cellules extérieures = fermes ; chaque îlot typé (centre, habitat, petit artisanat, parc, parking, église) et rempli selon son type, maisons face à la rue. Les villes du monde aléatoire l'utilisent aussi (repli sur le générateur de village si le site est trop exigu). Les îlots parking / cimetière restent pour l'instant en terrain libre.
- **Vraies dimensions des prefabs** : 4 576 / 4 947 prefabs du catalogue ont `d:[w,dz,h,cx,cz]` lu dans la boîte englobante des maillages .xob du jeu (identique à la mesure Workbench) ; `prefabDims()` (src/library/dims.ts) alimente les emprises et vraies hauteurs de la bibliothèque.

## [0.6.0] - 2026-11-16

### Ajouté
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

[Non publié]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.5.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.5.0

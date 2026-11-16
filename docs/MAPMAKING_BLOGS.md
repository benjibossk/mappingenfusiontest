# Veille : comment les map makers construisent leurs mondes

Recherche du 2026-11-16. Seules les URL vues dans les résultats ou ouvertes sont citées. Je n'ai pas trouvé de devblog Bohemia décrivant la création d'Everon, d'Arland ou de Tanoa. Rien non plus sur Arc Raiders, MSFS/Blackshark, RDR2, DICE ou Ghost Recon Wildlands.

## Sources

### Arma / Enfusion
1. **Terrain Creation Tool** (BI Wiki) : https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool
   - L'image satellite sert à l'affichage de loin, et la texture par tuile au détail de près. La heightmap, la satmap et le masque de surface n'ont pas la même résolution.
   - Pour nous : un seul repère de coordonnées, avec les rapports de taille exposés à l'export.
2. **Terrain Preparation Tutorial** (BI Wiki) : https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Preparation_Tutorial
   - Le pipeline officiel : nouveau monde, puis Terrain Tool, puis Manage, puis import d'une heightmap PNG. La normal map est générée à la première édition.
   - Pour nous : fournir exactement ce PNG, avec une fiche d'import pas à pas.
3. **2D Map Creation** (BI Wiki) : https://community.bistudio.com/wiki/Arma_Reforger:2D_Map_Creation
   - La carte en jeu utilise un fond satellite .edds produit par Export Map Data.
   - Pour nous : notre vue satellite peut servir d'aperçu de la carte 2D finale.
4. **ARTE (plugin QGIS)** : https://plugins.qgis.org/plugins/ARTE/
   - Il extrait des DEM et de l'imagerie satellite, aplanit les routes à partir d'OSM et creuse les rivières.
   - Pour nous : appliquer le même aplanissement des routes et le même creusement des rivières dans la heightmap.
5. **Advanced Terrain Tools** (Workshop) : https://reforger.armaplatform.com/workshop/6874E07B40C6D5E5-AdvancedTerrainTools
   - Des plugins Workbench vont de la génération jusqu'à Enfusion.
   - Pour nous : un modèle pour le côté réception de l'envoi vers le Workbench.
6. **Terrain Processor Tutorial** (BI Wiki, Arma 3) : https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial
   - La heightmap est carrée, en puissance de 2. Sur Arma 3, 8192 est déconseillé et 4096 est un plafond sûr.
   - Pour nous : valider la taille avant l'export.
7. **Common Terrain Creation Problems** (BI Wiki) : https://community.bistudio.com/wiki/Arma_3:_Common_Terrain_Creation_Problems
   - On y trouve un catalogue d'erreurs fréquentes, comme « Bad texel mapping for surface mask ».
   - Pour nous : en faire une checklist de validation automatique.
8. **How to Make an Arma 3 Map With Terrain Builder** (Instructables) : https://www.instructables.com/How-to-Make-an-Arma-3-Map-With-Terrain-Builder
   - L'ordre suivi est heightmap, satmap, masque, coordonnées, config, puis binarisation. Les routes et les objets viennent ensuite.
   - Pour nous : l'ordre de notre pipeline guidé correspond à la pratique de la communauté.
9. **PMC Real World Data Terrains** : https://www.pmctactical.org/arma3/manual-pmc-real-world-data-terrains.php
   - Le site est peut-être hors ligne. Il décrit un pipeline à partir de données réelles (DEM, OSM).
   - Pour nous : proposer une étape « importer un relief réel ».

### Grands studios
10. **GPU-Based Procedural Placement in Horizon Zero Dawn** (Guerrilla, GDC 2017, J. van Muijden) : https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn ; slides : https://www.guerrilla-games.com/media/News/Files/GDC2017_VanMuijden_GPUBasedProceduralPlacementInHorizonZeroDawn.pdf
    - Les artistes peignent quelques données (une lisière de forêt, une route). Des règles éditées dans un graphe en déduisent la densité de 500 types d'assets.
    - Le système est déterministe et localement stable : modifier une zone ne bouleverse pas le reste.
    - Pour nous : des règles de placement et une graine stable par zone.
11. **Procedural World Generation of Far Cry 5** (Ubisoft, É. Carrier, GDC) : https://gdcvault.com/play/1025557/Procedural-World-Generation-of-Far ; résumé 80.lv : https://80.lv/articles/houdini-procedural-world-generation-of-far-cry-5/
    - Des outils Houdini séparés couvrent les biomes, l'eau douce, les falaises, les lignes électriques et la carte du monde. Le terrain change tous les jours, donc tout se régénère.
    - Les espèces végétales « se battent » pour le sol selon l'humidité et la pente. Le vent oriente l'herbe.
    - Pour nous : une génération non destructive, où chaque étape peut être rejouée quand le relief change.
12. **PlayStation Blog : Far Cry 5 procedural world** : https://blog.playstation.com/2018/03/22/the-procedural-world-generation-of-far-cry-5/
    - Les outils servent l'intention artistique, ils ne la remplacent pas.

### Travail collaboratif
13. **One File Per Actor** (Epic doc) : https://dev.epicgames.com/documentation/en-us/unreal-engine/one-file-per-actor-in-unreal-engine
    - Un fichier par acteur, si bien que deux artistes ne verrouillent jamais le même fichier de niveau.
    - Pour nous : stocker chaque objet (route, village, champ) comme une entrée indépendante, ce qui limite les conflits.
14. **World Building features in UE5** (Epic blog) : https://www.unrealengine.com/blog/understanding-the-new-world-building-features-in-unreal-engine-5
    - World Partition propose une grille spatiale et des Data Layers par discipline (environnement, gameplay, lumière) sur une même zone.
    - Pour nous : combiner la réservation de zones (spatial) et les calques par étape (logique).
15. **World Partition team workflow** (guide fournisseur) : https://usourcecontrol.com/guides/world-partition-team-workflow
    - Même avec OFPA, il faut coordonner les réglages globaux et un même acteur modifié par deux personnes.
    - Pour nous : un verrou sur les paramètres globaux (taille, mer) et une alerte quand une zone est déjà réservée.

### Générateurs indés
16. **Polygonal Map Generation** (Red Blob Games, Amit Patel) : https://www.redblobgames.com/maps/polygon-map-generation/
    - L'ordre est côte, puis montagnes, puis rivières qui descendent, puis bassins versants. Le relief est construit sur un maillage Voronoi/Delaunay, et des « noisy edges » cachent les polygones.
17. **Procedural river drainage basins** (Red Blob) : https://www.redblobgames.com/x/1723-procedural-river-growing/
    - Les rivières poussent depuis l'embouchure vers l'amont, ce qui garantit un réseau cohérent.
18. **Generating fantasy maps** (Martin O'Leary) : https://mewo2.com/notes/terrain
    - Le relief part d'un bruit et passe par une simulation d'érosion. Les villes sont placées selon l'eau et le relief, puis viennent les frontières et les labels.
    - Pour nous : placer les villages par score (proximité de l'eau, pente faible, route).

## Top 10 des idées à reproduire
1. **Une génération non destructive** (FC5) : chaque étape garde ses paramètres et une graine. Modifier le relief rejoue l'eau, les routes et la suite.
2. **Des règles plutôt que des pinceaux** (Horizon) : on peint quelques masques et des règles (pente, altitude, distance à l'eau) remplissent les champs et forêts.
3. **Un déterminisme local** : une graine par zone, pour qu'une modification ne change pas le reste de la carte.
4. **Les rivières tracées de l'embouchure vers l'amont, et le creusement du lit** (Red Blob, ARTE).
5. **L'aplanissement automatique sous les routes** (ARTE), avec talus lissés.
6. **Un score d'emplacement des villages** (O'Leary) : une carte de chaleur affichée comme suggestion.
7. **Un objet = une entrée** (OFPA) : le journal d'historique et la fusion se font par objet, pas par carte.
8. **Une réservation de zones combinée à des calques par étape** (World Partition et Data Layers) : on réserve une zone pour une étape donnée.
9. **Une checklist d'export** (BI Wiki) : puissance de 2, résolutions cohérentes et masques valides avant l'envoi au Workbench.
10. **Un aperçu satellite qui imite la carte 2D** en jeu, avec une étape optionnelle « relief réel » (DEM/OSM).

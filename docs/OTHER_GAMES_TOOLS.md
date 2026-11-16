# Outils de création de cartes hors Bohemia : idées pour reforger-mapper

Sources : seuls les extraits de résultats de recherche ont pu être lus. Les WebFetch directs ont échoué (404/403 sur maps4fs, mapng.com). [NV] = fait tiré de ma connaissance, non vérifié pendant cette recherche.

## Outils (18)

1. **Maps4FS (Farming Simulator 25)** : génère un modèle de carte à partir d'OSM et du relief, puis on l'ouvre dans Giants Editor 10 pour y ajouter les bâtiments. Il fournit des scripts QGIS pour récupérer l'imagerie satellite en un clic, et il est chaîné avec le Procedural Generator de Giants (fichiers .lua) pour les arbres, la végétation et les textures. Il déconseille les cartes de plus de 8192 m. -> *À retenir : c'est notre jumeau le plus proche. Prévoir une limite de taille, un avertissement sur le matériel nécessaire, et un export de « scripts d'aide » à côté des données.* https://maps4fs.gitbook.io/docs/getting-started/step_by_step_guide , https://maps4fs.gitbook.io/docs/advanced-topics/procedural_generation , https://github.com/iwatkot/maps4fs
2. **Giants Editor, Procedural Placement** : des règles de placement par couche [NV]. Le SplineToolkit communautaire pose des préfabs le long d'une spline. https://farmsim.uk/mods/ge10-script-splinetoolkit-prefab -> *Bibliothèque de « préfabs le long d'une spline » (clôtures, lignes électriques).*
3. **MapNG (BeamNG)** : application web open source qui produit à partir d'OSM et d'un MNT une heightmap 16 bits, des textures, des bâtiments, des arbres et des barrières. Exports GeoTIFF/GeoJSON et ZIP de niveau BeamNG. Les utilisateurs signalent des barrières pivotées et des rivières mal placées. https://mapng.com , https://beamng.com/posts/1961437/ -> *Exporter aussi en GeoJSON/GeoTIFF, et prévoir une vérification « orientation/décalage » des objets issus d'OSM.*
4. **TerraDrive / EarthNG (BeamNG)** : OSM + relief vers routes, terrain et bâtiments, avec du trafic SUMO. https://boxthislap.org/beamng-drive-real-world-map-generator-terradrive/ , https://github.com/Alezx311/earthng/wiki -> *Signaler à l'utilisateur la complétude d'OSM selon la zone.*
5. **BeamNG Road Spline Tool / Master Spline** : couper, inverser, simplifier une spline, et exporter les routes en masque PNG. https://documentation.beamng.com/world_editor/tools/road_spline_tool/interface/ -> *Ajouter les opérations couper/simplifier, et un export des masques de routes.*
6. **Unreal Landscape Splines (Squad, Hell Let Loose)** : « Apply splines » modifie la heightmap et les couches. Options : relever le terrain (remblai sous la route) ou l'abaisser (rivière, fossé). https://docs.unrealengine.com/4.26/BuildingWorlds/Landscape/Editing/Splines -> *Paramètres remblai/déblai par route ou rivière, avec un falloff.*
7. **LandscapeCombinator (UE)** : importe des splines réelles depuis OSM. https://landscapecombinator.github.io/LandscapeCombinator/splines.html
8. **Leadwerks road splines** : largeur, matériau et alignement au terrain réglables par nœud. La route sert aussi de chemin pour l'IA. https://leadwerks.com/community/blogs/entry/1995-aggrors-devlog-3-road-splines -> *Largeur par nœud, et export de la route comme chemin d'IA (réseau routier FF).*
9. **Cities: Skylines 2, éditeur de carte** : heightmap en 16 bits gris, avec une « World Map » d'arrière-plan à la même résolution. Le mod MOOB comble les manques (dialogue d'import, redimensionnement). https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-2-map-editor , https://thunderstore.io/c/cities-skylines-ii/p/Cities2Modding/MOOB/ -> *Prévoir un relief d'arrière-plan (horizon) au-delà de la zone jouable.*
10. **terrain.party / heightmap.skydark.pl / Terraining** : on choisit un carré sur une carte et on obtient une heightmap en un clic. Les utilisateurs se plaignent des conversions en niveaux de gris. https://github.com/nonta1234/terraining-heightmap-generator , https://shankscs2.github.io/cs2-maps-wiki/docs/zero-to-heightmap -> *L'étape « Relief » doit sortir directement au bon format, sans conversion manuelle.*
11. **CS1, mods Move It / Network Anarchy / TM:PE** [NV] : sélection multiple et déplacement précis, routes sans contraintes de pente ou de collision, règles de circulation. -> *Un mode « anarchie » qui coupe les validations, et un outil de sélection/déplacement de groupe.*
12. **Arnis (OSM vers Minecraft)** : application Rust, Overpass + AWS Terrain Tiles, échelle mètres/bloc réglable, environ 900 000 téléchargements. https://wiki.openstreetmap.org/wiki/Arnis , https://github.blog/open-source/maintainers/arnis-turns-any-place-on-earth-into-a-minecraft-world -> *Tuiles d'élévation AWS gratuites comme source de relief par défaut, et bbox + Overpass côté navigateur.*
13. **WorldPainter (Minecraft)** [NV] : pinceaux par couche (forêt, rivière), « custom object layers » qui dispersent des objets selon la densité peinte, import de heightmap, filtres de pente et d'altitude. -> *Peindre une densité, et laisser les règles placer les objets.*
14. **WorldEdit** [NV] : commandes de masques et de remplacement, schematics réutilisables. -> *Stamps/schematics de hameaux.*
15. **Terrain3D (Godot)** : clipmap jusqu'à 65 km, peinture de textures, trous, navigation, foliage avec LOD, licence MIT. https://terrain3d.readthedocs.io/en/1.0/ , https://80.lv/articles/terrain3d-a-free-terrain-system-for-godot-engine
16. **Gaia / GeNa / MapMagic 2 (Unity)** [NV] : spawners à règles (pente, altitude, distance à l'eau ou aux routes, bruit). MapMagic utilise un graphe de nœuds non destructif. GeNa pose des objets le long d'une spline. -> *Règles de placement explicites et éditables, recalculées sans détruire le travail.*
17. **Houdini Engine** [NV] : terrain procédural (érosion) et outils numériques rejouables. -> *Pipeline rejouable : chaque étape relancée met à jour les étapes suivantes.*
18. **ETS2 Map Editor / UEFN / Halo Forge / Roblox** [NV] : préfabs de carrefours paramétrés (ETS2), édition collaborative en direct et sessions partagées (UEFN), budget d'objets visible en permanence (Forge), générateur de terrain par biomes (Roblox). -> *Préfabs d'intersections et jauge de budget d'objets/perf.*

## Top 12 (valeur/effort)

1. **Remblai/déblai sous routes et rivières** (falloff, réglé par spline). Valeur élevée, effort faible.
2. **Règles de placement explicites** pour forêts et champs (pente, altitude, distance route/eau). Valeur élevée, effort moyen.
3. **Préfabs le long d'une spline** (lignes électriques, clôtures, haies), avec espacement et alignement. Valeur élevée, effort faible.
4. **Relief en un clic** depuis les tuiles AWS Terrain, au bon format, sans conversion. Valeur élevée, effort faible.
5. **Avertissements de complétude OSM** et contrôle d'orientation des objets importés. Effort faible.
6. **Pipeline rejouable** : modifier le relief recalcule routes, forêts, etc. Valeur élevée, effort élevé.
7. **Stamps/templates** de village et de zone industrielle, paramétrés par densité. Effort moyen.
8. **Largeur et profil par nœud** de route, et export du réseau comme chemin d'IA. Effort moyen.
9. **Jauge de budget** (nombre d'entités, taille, perf) avec limite de taille de carte. Effort faible.
10. **Exports GeoJSON/GeoTIFF** et masques PNG, en plus de l'envoi au Workbench. Effort faible.
11. **Relief d'arrière-plan** (horizon) hors zone jouable. Effort moyen.
12. **Mode « anarchie »** (désactiver les validations) et outil de sélection/déplacement de groupe. Effort moyen.

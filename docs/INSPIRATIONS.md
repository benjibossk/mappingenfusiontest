# Inspirations — veille outils (2026-11-16)

Synthèse de 4 recherches par sous-agents. [NV] = non vérifié (de mémoire, pas lu en ligne).

## Outils Reforger
| Outil | Ce que c'est | Licence | À reprendre |
|---|---|---|---|
| **ARTE** (QGIS, Icebird) — plugins.qgis.org/plugins/ARTE, github.com/Rendszerguru/ARTE-QGIS-plugin | Pipeline relief : DEM → aplanir routes OSM → creuser rivières → export PNG16/ASC/GeoTIFF | MIT (README ; code seulement dans le zip v1.2.0, non lu) | Anti-submersion des routes ; largeur route d'après tags OSM (lanes/surface/classe) ; pas de terrassement sous ponts/tunnels ; carte de différence avant/après ; calcul auto des paramètres d'import Workbench ; couches pente/flux/érosion ; bouchage NoData. Ne fait PAS : splines, surfaces, villages, lien Workbench. |
| **Terrain Lab** (WickedWabbit) — workshop 7F43B8A2D19E6C05 | Îles procédurales générées EN JEU (GM), villes, routes, ponts, forêts, navmesh | APL-ND : idées seulement | Même seed = même île ; pipeline relief→villes→routes→forêts avec barre de progression |
| **Advanced Terrain Tools** (Hypoxic125) — workshop 6874E07B40C6D5E5 | Plugins WB : import nuages de points .xyz (Gaea) pour arbres/débris, analyse min/max heightmap, création des entités de base d'un monde | APL-SA | Format liste de points comme échange ; analyse heightmap avant import ; calculs lourds délégués à Python |
| **Outside Terrain Tool** (MR-REX) — workshop 61F2B96F0D3F27D4 | Terrain hors-jeu autour de la map (chunks), POC, ancien (1.2.1) | APL-SA | Prolonger les bords de la heightmap + bruit + lissage ; choix « vers la mer » ou par direction |
| **Terrain Automation Tools** (gaz8157) — workshop 684876344DA83476 | Panneau WB : Auto-Decorator, Biome Painter, Density Painter, Forest Featherer (lisières par densité de voisins), Corridor Clearance, Object Replacer, Ctrl+Z | APL | **Le plus proche de nos besoins** : lisières de forêt, dégagement de corridors (routes), peinture de densité |

## Interfaces (Azgaar, MapNG, Gaea, World Creator, Inkarnate) [NV en grande partie]
- Pastille d'état par étape : à faire / fait / à refaire / erreur.
- « Régénérer cette étape » avec seed verrouillable ; les étapes suivantes passent « à refaire ».
- Verrou par objet (route, village) respecté par la régénération ; petit éditeur au clic.
- Presets JSON partageables (relief, campagne…), lien `#preset=`.
- Ombrage du relief (hillshade) sur la carte 2D ; vue 3D three.js chargée à la demande.
- Masques de règles (pente, altitude, distance à l'eau) affichés en surimpression.
- Pinceaux avec curseur cercle, `[ ]` pour la taille ; tampons dispersés.
- Presets de visibilité des calques.
- Azgaar (MIT à confirmer) : algos rivières / placement des villes à adapter (maillage Voronoi ≠ notre grille).

## Priorités proposées
1. Pastilles d'état + régénérer une étape + écran d'accueil (carte vide au 1er lancement).
2. Hillshade 2D.
3. Garde-fous routes d'ARTE : anti-submersion, largeur OSM, ponts/tunnels.
4. Presets JSON.
5. Lisières de forêt + dégagement le long des routes (Terrain Automation Tools).
6. Terrain hors-jeu (prolongement des bords).
7. Vue 3D, carte de différence.

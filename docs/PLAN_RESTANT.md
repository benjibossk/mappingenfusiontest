# Plan de ce qu'il reste à faire (état au 17/11/2026, v0.6.0)

Synthèse des feuilles de route (ROADMAP*, FINDINGS) et des outils étudiés. Les items marqués « à faire » dans
les anciennes feuilles de route qui sont déjà livrés (lignes électriques, villages, zones industrielles, biomes,
vue 3D OpsTrack, militaire, aérodrome, outil Zone) ne sont pas repris ici.

## Priorité 1 — sortir une carte jouable dans le Workbench
| # | Tâche | Inspiré de |
|---|---|---|
| 1 | Validation avant envoi (pentes, chevauchements, budget par bloc, objets hors carte) | FINDINGS §1 |
| 2 | Export bridge → Workbench complet (champs/haies/zones de l'outil Zone) et test de bout en bout | — |
| 3 | Export biome FF (`m_iBiome` dans `JWK_WorldEntity`) | Freedom Fighters |
| 4 | Corriger la recette R3 (1 bloc > 5 surfaces sur seed 1) | ROADMAP_NEXT |
| 5 | Bench limites (objets / arbres) par plateforme Series S/X, PS5, PC + carte de densité | RESEARCH §151 |

## Priorité 2 — qualité du terrain et de la végétation
| # | Tâche | Inspiré de |
|---|---|---|
| 6 | Lisières forestières progressives (Forest Featherer) | TAT / FINDINGS §3 |
| 7 | Forêts selon altitude et pente (règles de placement) | FINDINGS §4, Maps4FS |
| 8 | Bosquets et arbres isolés dans les champs, chemins de terre entre parcelles | AgriFieldGenerator |
| 9 | Creuser le lit des rivières, protéger rivières/lacs sous l'aplanissement des routes, remblai sous routes | ARTE, Maps4FS |
| 10 | Masques de sol par rampes/cloches + TPI/courbure (rochers sur crêtes, herbe en creux) | giorbev |
| 11 | Bruit pour variantes de sol, peinture par priorité | Maps4FS |
| 12 | Choix de l'essence pour la zone Forêt de l'outil Zone | — |

## Priorité 3 — villes et routes
| # | Tâche | Inspiré de |
|---|---|---|
| 13 | Ville 100-300 habitants (îlots, bouclage des rues, L-system contraint) | CITIES, ProbableTrain, watabou |
| 14 | Port / côte, ferme en U, murs et clôtures de village | ROADMAP_NEXT |
| 15 | Giratoires, croisements dénivelés, ponts sur arcs courts | KARTMAKER, ROAD_NETWORK_V2 |
| 16 | Largeur de route depuis OSM (lanes, surface, tracktype), exclure ponts/tunnels | ARTE |
| 17 | Prefabs le long d'une spline (glissières, poteaux, murets) | Unreal / BeamNG |

## Priorité 4 — vue 3D et confort
| # | Tâche | Inspiré de |
|---|---|---|
| 18 | Sélecteur de qualité + compteur arbres / FPS | OpsTrack |
| 19 | Vraies emprises des prefabs (lecture des bbox dans les .xob) pour l'Atelier / Zimnitrita | OpsTrack |
| 20 | Forêts visibles en mode Carte quand les arbres sont masqués | — |
| 21 | Case « compositions réelles » (jardins Casseburne) dans l'app | Casseburne |

## Priorité 5 — plus tard / idées
- Anneau de terrain hors carte (Outside Terrain Core) généré côté TS.
- Import .osm / .geojson local, schéma tag → couche configurable (Maps4FS).
- Pipeline rejouable (rejouer toutes les étapes d'un projet), relief en un clic.
- Packs de compositions Workshop (ARMA EXPANDED, iRON79, FF-Extra, MMHs) : à évaluer.
- Variantes de maisons soviétiques (Kolguyev).

## Volontairement non repris
- Écriture directe des `.ttile` (giorbev) : on passe par le Workbench.
- Code de TAT, BARNMAP, KARTMAKER (pas de licence ouverte) : idées seulement.
- Import XYZ / analyse heightmap Python d'ATT : notre DEM couvre le besoin.

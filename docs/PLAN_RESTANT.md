# Plan de ce qu'il reste à faire (état au 17/11/2026, v0.6.0, mis à jour en fin de session)

Synthèse des feuilles de route (ROADMAP*, FINDINGS) et des outils étudiés. Les items marqués « à faire » dans
les anciennes feuilles de route qui sont déjà livrés (lignes électriques, villages, zones industrielles, biomes,
vue 3D OpsTrack, militaire, aérodrome, outil Zone) ne sont pas repris ici.

Légende : ✅ livré · 🟡 en partie · ⬜ à faire.

## Livré pendant la session du 16-17/11/2026
- Électricité : planificateur hiérarchique (centrales, boucle THT/HT, départs MT, BT, postes vanilla), lignes le
  long des routes sans survoler les maisons, un transformateur / poteau d'entrée par localité, réglage
  « Distribution dans les localités » (auto / aérien / souterrain), fermes isolées sur un court branchement BT
  ou un transfo sur poteau de la MT.
- Barrages (option du monde aléatoire, barrage béton des mods).
- Mods Workshop : registres de prefabs (Minus Building Pack, Zimnitrita, Anizay, Kodiis), bâtiments en option,
  dépendances exportées ; outils `tools/pak` (pak hors-ligne, dimensions, vignettes).
- Ripisylve v2, remblais sous routes, lit des rivières, masques de sol TPI/courbure, rochers par pente.
- Forêts : lisières progressives, essences par altitude et pente, arbres dans les champs, essence « Auto » de l'outil Zone.

## Priorité 1 — sortir une carte jouable dans le Workbench
| # | Tâche | État |
|---|---|---|
| 1 | Validation avant envoi (pentes, chevauchements, budget par bloc, objets hors carte) | ✅ panneau « Vérification avant envoi » (étape 7) : + bâtiments qui se chevauchent, objets sur la chaussée, objets de zone hors carte (logique de scripts/mg-audit.mjs, `src/validate/preSend.ts`), clic = zoom, boutons Retirer / Décaler et « Tout corriger » |
| 2 | Export bridge → Workbench complet (champs/haies/zones de l'outil Zone) et test de bout en bout | ⬜ test de bout en bout à faire |
| 3 | Export biome FF (`m_iBiome` dans `JWK_WorldEntity`) | ✅ |
| 4 | Corriger la recette R3 (1 bloc > 5 surfaces sur seed 1) | 🟡 `limitPerBlock` ; recette à revérifier |
| 5 | Bench limites (objets / arbres) par plateforme + carte de densité | ✅ (budgets indicatifs, à mesurer en jeu) |

## Priorité 2 — qualité du terrain et de la végétation
| # | Tâche | État |
|---|---|---|
| 6 | Lisières forestières progressives (Forest Featherer) | ✅ |
| 7 | Forêts selon altitude et pente | ✅ bandes feuillus / mixte / conifères, pas de bois > 0,55 de pente ni sur crêtes rocheuses |
| 8 | Bosquets et arbres isolés dans les champs, chemins de terre entre parcelles | ✅ (curseur « Arbres dans les champs ») |
| 9 | Lit des rivières, protection rivières/lacs sous l'aplanissement, remblai sous routes | ✅ |
| 10 | Masques de sol par rampes/cloches + TPI/courbure | ✅ |
| 11 | Bruit pour variantes de sol, peinture par priorité | 🟡 variantes d'herbe ; priorité de peinture à faire |
| 12 | Choix de l'essence pour la zone Forêt de l'outil Zone | ✅ Auto / Mixte / Conifères / Feuillus, générateurs du biome |

## Priorité 3 — villes et routes
| # | Tâche | État |
|---|---|---|
| 13 | Ville 100-300 habitants (îlots, bouclage des rues, L-system contraint) | 🟡 grille de rues avec boucles (zone Habitation) ; vraie ville à îlots à faire |
| 14 | Port / côte, ferme en U, murs et clôtures de village | 🟡 murets, clôtures et ferme en U livrés (sites FARM_* : parcelles larges 26-46 x 46-52 m, ferme au fond + 2 ailes grange/hangar autour de la cour, option `farmyards` de village.ts) ; port à faire |
| 15 | Giratoires, croisements dénivelés, ponts sur arcs courts | ✅ giratoires + passage supérieur autoroute + ponts courts sur les petits ruisseaux (culverts.ts : tablier vanilla le plus court selon la largeur, BridgeConcrete_E_01_small pour pistes, ConcreteBridge_01 Narrow/Wide sinon ; pas de prefab de buse en vanilla), dessinés en ocre sur la carte 2D |
| 16 | Largeur de route depuis OSM, exclure ponts/tunnels | 🟡 largeurs vanilla par classe ; tags OSM lanes/surface à faire |
| 17 | Prefabs le long d'une spline (glissières, poteaux, murets) | ✅ murets + glissières (remblai > 1,8 m déjà dans roadFurniture ; guardrails.ts ajoute abords de pont 24 m des deux côtés et extérieur des virages serrés en pente, mêmes générateurs WG_CrashBarrier vanilla, les poteaux recouverts sont retirés) |

## Priorité 4 — vue 3D et confort
| # | Tâche | État |
|---|---|---|
| 18 | Sélecteur de qualité + compteur arbres / FPS | ✅ compteur arbres affichés + objets + FPS dans la vue 3D |
| 19 | Vraies emprises des prefabs (bbox des .xob) | 🟡 dimensions réelles sites / militaire / ponts / mods ; reste l'Atelier |
| 20 | Forêts visibles en mode Carte quand les arbres sont masqués | ✅ (teinte + contour sur le drapé, commit 0731d34) |
| 21 | Case « compositions réelles » (jardins Casseburne) dans l'app | ✅ déjà là : case « Vraies compositions de jardins » (étape Villages) |

## Priorité 5 — plus tard / idées
- ✅ Anneau de terrain hors carte (Outside Terrain Core) généré côté TS.
- ✅ Import .osm / .geojson local, schéma tag → couche configurable.
- ✅ Pipeline rejouable, relief en un clic.
- 🟡 Packs de compositions Workshop : registres de prefabs de 4 mods ; ARMA EXPANDED, iRON79, FF-Extra, MMHs à évaluer.
- ⬜ Variantes de maisons soviétiques (Kolguyev).
- ⬜ Électricité : fermes très à l'écart des routes (dernière portée à travers champs, branchements parfois > 600 m le long de la route).

## Volontairement non repris
- Écriture directe des `.ttile` (giorbev) : on passe par le Workbench.
- Code de TAT, BARNMAP, KARTMAKER (pas de licence ouverte) : idées seulement.
- Import XYZ / analyse heightmap Python d'ATT : notre DEM couvre le besoin.

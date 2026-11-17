# Catalogue des prefabs « finis » du jeu de base

Fichier : `library/prefabs-catalogue.json` (généré 2026-11-17 en lisant les .pak en lecture seule via le VFS d'enfusion-mcp).

- **4 947 prefabs finis** sous `Prefabs/{Structures,Props,Vegetation,Rocks,Decals}` (exclus : `*_base`, `Core/`, `Dst/`, `BuildingParts/`, `Parts/`, portes/fenêtres, proxies, test).
- **GUID connu pour 3 828** (77 %). Les paks ne contiennent pas de `.meta` : les GUID sont récoltés dans les références `{GUID}Prefabs/...` de 21 700 fichiers (.et/.conf/.layer). Les 1 119 restants ne sont référencés nulle part → GUID à lire dans le Workbench si besoin.
- Champs : `p` chemin (sans `Prefabs/`), `g` GUID, `c` famille/sous-famille, `s` taille devinée (S/M/L, d'après le nom — pas de bbox), `t` tags (regex sur le chemin, approximatifs), `e`=1 si une variante `PrefabsEditable/Auto/.../E_*.et` existe (placeable Game Master **et** miniature dans `UI/Textures/EditorPreviews/Auto/...` → piste pour des images sans capture).
- `PrefabLibrary/DefaultLibrary/` (1 964 .et) = copies « bibliothèque » pour la palette du World Editor qui héritent des prefabs `Prefabs/` : non listées, utiliser les originaux.

## Comptes par famille (principales)
| Famille | Nb | | Famille | Nb |
|---|---|---|---|---|
| Structures/Signs | 785 | | Props/Military | 455 |
| Structures/Walls | 473 | | Props/Furniture | 268 |
| Structures/Infrastructure | 411 | | Props/Civilian | 167 |
| Structures/Military | 378 | | Vegetation/Tree | 148 |
| Structures/Industrial | 195 | | Props/Industrial | 126 |
| Structures/Houses | 134 | | Props/Commercial | 114 |
| Structures/Cultural | 111 | | Props/Decorations | 96 |
| Props/Garbage | 90 | | Rocks/Granite | 69 |
| Structures/Agriculture | 52 | | Props/Wrecks | 47 |
| Decals (tous) | 118 | | Vegetation/Plant+Bush | 118 |

## Familles utiles pour nos générateurs de zones
- **Clôtures / murs** : `Structures/Walls/` — Brick 102, Net (grillage) 84, Concrete 70, Wooden 57, Pipe 46, Stone 45, Metal 30, Pole 16, BarbedWire 15, Crashbarrier 8. + `Structures/Infrastructure/Barriers` 17.
- **Ferme** : `Structures/Agriculture` (52, dont portails `Gates`), `Structures/Houses/Farm` (8), `Props/Agriculture` (32, dont `Farm` 11 : bottes de foin…).
- **Parking / station** : peu de prefabs dédiés (panneaux `Signs/Warnings`, quelques props) → composer avec épaves `Props/Wrecks` (47) et décals `Decals/Markings` (28) / `Asphalt` (20).
- **Chantier** : `Props/Construction` (31 : conteneurs métal, buses béton `ConcretePipe`, tas de briques/gravier).
- **Plage** : `Props/Recreation/Beach` (26), `Structures/Recreation/Beach` (6), `Structures/Infrastructure/Naval` (52 : jetées, pontons), `Props/Naval` (32).
- **Cimetière** : `Structures/Cultural/Cemeteries` (18), `Props/Military/Graves` (7).
- **Chasse** : `Structures/Forest/DeerStands/DeerStand_01.et` (+ `_struts`).
- **Déchets / junk** : `Props/Garbage` (90, dont `Generic`), `Props/Remains` (18), `Props/VehicleParts` (18).
- **Camp militaire** : `Structures/Military/Camps` (59), `Props/Military/Camps` (29), `CamoNets` (4), `Fortifications` (49), `Bunkers` (35), `Props/Military` total 455.
- **Checkpoints** : `Props/Infrastructure/Roadblocks`, `Structures/Signs/Military`, + barrières/fortifications ci-dessus (peu de prefabs « checkpoint » tout faits → compositions).
- **Végétation** : arbres 148, buissons 42, plantes 76, rochers granite 69.

Images : plugin de capture Workbench (dans le scratchpad de session, `prefabshots/`, à lancer manuellement) — ou exploiter les miniatures `EditorPreviews` des prefabs `e=1`.

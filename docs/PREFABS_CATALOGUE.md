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

## Miniatures (EditorPreviews extraites des paks, sans Workbench)

**Couverture** : 1 801 aperçus `UI/Textures/EditorPreviews/Auto/**/E_*.edds` décodés (sur 1 813 ; 10 atlas d'icônes Arsenal ignorés, 2 `.imageset`). **1 061 / 4 947 prefabs du catalogue ont une miniature** (`thumb: true`) — dont 861 / 956 des entrées `e=1`. Les ~740 aperçus restants concernent des compositions, personnages, véhicules : hors catalogue. Les 3 886 prefabs sans miniature (décals, végétation, murs, bâtiments non éditables…) sont listés pour le plugin de captures.

**Correspondance** : `Auto/<chemin>/E_<Nom>.edds` ↔ `Prefabs/<chemin>/<Nom>.et` (chemin complet, sinon nom de base unique).

**Format .edds** : en-tête DDS standard (+ DX10), formats DXGI 72 (BC1 sRGB, ~65 %), 99 (BC7 sRGB), 91 (BGRA). Après l'en-tête : une table de `mipCount` × (tag 4 car. `COPY`|`LZ4 `, u32 taille), puis les mips du plus petit au plus grand. Un bloc `LZ4 ` = u32 taille décompressée puis blocs LZ4 chaînés `[u32 taille | 0x80000000 si dernier][bloc]`. Pak Enfusion : `FORM/PAC1`, chunk `DATA`, puis chunk `FILE` = arbre (type u8, nom u8+octets ; dossier → u32 nb enfants ; fichier → offset, taille comp., taille, 0, u16 flags, timestamp ; zlib si tailles ≠). Image native 400×300, miniatures réduites à 200×150.

**Régénérer** (scripts hors repo, Node + Python/Pillow ≥ 12 ; PakInspector.exe n'est plus présent) :
1. `node pak.js "<Jeu>/addons/data" index.json` — liste les entrées EditorPreviews de tous les `data*.pak`.
2. `node edds.js dds/ index.json` — extrait le plus grand mip, décompresse LZ4, réécrit un `.dds` mono-mip (72→71, 91→87 pour Pillow).
3. `python -I topng.py dds png` — DDS → PNG 200×150.
4. `node map.js <dossier> prefab-list-missing.txt` — mappe vers le catalogue, pose `thumb`, copie `byprefab/<chemin__Nom>.png`, génère les planches HTML (48/page, par famille).
Les PNG (~1 060, ~25 Mo) restent hors du repo.

**Analyse par famille (pour les générateurs de zones)**
- *Structures/Military* (115) : filets de camouflage US/soviétiques en toutes tailles (Small/Medium/Large, *_Top*, murs, sur bunker/caisse/kit), bâches CanvasCover (pliées ou montées), abris ShelterStorage en sacs de sable, tentes FIA, bunkers béton 1fp/3fp. Parfait pour habiller un camp/checkpoint par faction.
- *Props/Military* (213) : caisses de munitions par calibre, piles EquipmentBoxStack US/USSR (bâchées ou non, variantes V1-V6), caisses bois typées (munitions, explosifs, lanceurs, médical, armes), caisses Arsenal, antennes radio R161/RC292. Remplissage de dépôts et d'intérieurs de bases.
- *Structures/Infrastructure* (47) : barrière levante (BarGate), tronçons/piles de pont béton, abribus, lampadaires (3 modèles, version éteinte), cabine téléphonique, regards/caniveaux, brise-lames, grue portuaire, davits, bollards, pylônes émetteurs, pompes/puits colorés. Mobilier de rue et de port.
- *Props/Civilian* (94) / *Furniture* (161) : petit mobilier domestique (réveils, cendriers, bouteilles, bancs de rue colorés, seaux, extincteur, ventilateur, classeurs, chauffages, cercueil, clapier) — décor intérieur/jardin, peu visible à l'échelle zone ; bancs et cendriers de rue utiles en village.
- *Props/Industrial* (56), *Construction* (30), *Garbage* (35), *Agriculture* (28) : palettes, fûts, matériel de chantier, déchets, outillage agricole — remplissage de cours et friches.
- Points d'attention : plusieurs variantes de couleur/état d'un même objet (`_off`, `_empty`, couleurs) — dédoublonner pour la variété ; certains aperçus sont sur fond bleu (bunkers) ou quasi vides (ShelterStorageUS_01).

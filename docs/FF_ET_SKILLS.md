# Ce qu'on réutilise des skills Reforger / Freedom Fighters et du CLAUDE.md des addons

## Formats et GUID (skill arma-reforger-modding)
- **Chaque `.et` exporté a besoin d'un `.meta`** (`MetaFileClass`, `Name "{GUID}chemin"`, configurations PC/XBOX_ONE/XBOX_SERIES/PS4/PS5/HEADLESS). BARNMAP fait pareil.
- **GUID déterministes** : `sha256(sel + chemin)[:16]` en majuscules. Réexporter une même zone garde ainsi les mêmes GUID, et les références des calques restent valides.
- Les références utilisent le **GUID de la ressource** (`.meta`), jamais le GUID de l'addon.
- Vérifié en test (2026-10-14) : le Workbench résout aussi un prefab par **chemin seul** (`Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et`). C'est une solution de repli pour les GUID inconnus.
- Validation : `mod_validate` (MCP) comme pré-contrôle.

## ⚠️ IDs d'entités non « bakés » : risque de crash en serveur dédié (skill FF §15.18)
- Un `.et` écrit à la main sans `ID "..."` stable à la racine désynchronise le client et le serveur, ce qui provoque un kick `REPLICATION SYSTEM_FAILURE`.
- **L'outil doit écrire un `ID` 16-hex à chaque entité** : la shape, le générateur enfant et le ShapePoint en `{GUID}`. BARNMAP le fait.
- Par sécurité, on documente dans la fiche d'import un « Force Save All » dans le Workbench : Resource Browser, puis Edit Prefab(s), puis Force Save All. **Ne pas utiliser Reimport.**
- Détection : `rg --files-without-match -g '*.et' '^\s*ID "'`. On l'intègre au validateur de l'outil.

## Freedom Fighters : un terrain généré doit être « FF-ready » (skill FF §3-4)
- **Taille conseillée de 25 km² ou plus** (Arland, environ 2,5 × 2,5 km, est le minimum souple). Nos 4 km = 16 km² sont donc limites ; il vaut mieux viser 8 km.
- **Réseau routier asphalté connecté** entre les lieux principaux. Sans lui, FF n'a ni trafic, ni QRF, ni convois.
  - Pièges FF : des **extrémités qui ne se touchent pas** (gaps) et des **îlots** (sous-réseaux déconnectés).
  - → L'outil doit **souder les intersections** (un point commun, même hauteur, ce que recommande aussi BI) et détecter les composantes connexes du graphe routier avant l'export (rapport « îlots »).
- `JWK_World` demande Map Offset et Map Size. On peut les calculer directement depuis la grille exportée (origine 0,0,0, taille N×1,024 km, Y min/max).
- Lieux FF (Town, FOB, base militaire, tour radio, port, checkpoint, station-service) : l'outil pourrait proposer des **marqueurs de POI** à partir d'OSM (`place=village`, `amenity=fuel`, `man_made=mast`, `harbour`, `military`) et les exporter comme emplacements à compléter avec les contrôleurs `JWK_*`. C'est une idée pour une phase ultérieure.
- Bâtiments personnalisés : `JWK_SpawnPointsContainerComponent`. Ce n'est pas notre périmètre.

## Outillage MCP (CLAUDE.md addons)
- ⚠️ **Appeler un outil `wb_*` peut supprimer `addons/EnfusionMCP/`.** Copie de secours dans `enfusion-mcp-local\ADDON_EnfusionMCP_SAFE\`. Vérifié présent après nos tests du 2026-10-14.
- `wb_compile` sert à compiler un plugin Workbench (piste : un importeur JSON en script Enforce).
- Lire les logs avec `wb_console`, ou en dernier recours le `console.log` du dossier de logs le plus récent.
- `ToggleGeneratorEvents(true)` (API) est nécessaire pour que les générateurs tournent quand on crée des entités par script.

## Bench / performance
- Le plugin `WorldEditorPlugin` (pattern du skill FF §15.18) peut aussi servir de base au **plugin de bench** : densité par cellule avec `QueryEntitiesByAABB` (scripts de Lou), puis heatmap PNG.

# Reforger Mapper

> **English summary** — Reforger Mapper is an unofficial, work-in-progress web tool (Vite + TypeScript) to quickly design Arma Reforger terrains: generate an island, sculpt the heightmap, paint surface masks, lay out roads, rivers, lakes and bridges, then send everything to the Enfusion Workbench through a small local bridge and a Workbench plugin (`MapGen` menu). Vanilla assets only. MIT licensed. Documentation is in French.

Outil web pour mapper vite sur **Arma Reforger** (moteur Enfusion) et auto-remplir une carte avec les assets vanilla, puis l'envoyer dans le World Editor du Workbench.

## Fonctionnalités

- **Génération de terrain / île** : relief procédural (bruit, forme d'île), export heightmap.
- **Sculpt** : pinceau de relief interactif (approche inspirée de mapgen4).
- **Surfaces et masques** : masques de surfaces calculés (altitude, pente, etc.).
- **Routes** : tracé, réseau routier (graphe), mobilier et panneaux le long des routes.
- **Eau** : rivières (accumulation de flux), lacs, berges.
- **Ponts** aux croisements route / rivière.
- **Campagne** : parcelles agricoles (Voronoï, inspiré d'AgriFieldGenerator).
- **Labels de debug** dans le World Editor.
- **Envoi vers le Workbench** : formes (`.et`), générateurs et prefabs vanilla.

Modules principaux : `src/modules/` (`island`, `sculpt`, `roads`, `network`, `hydro`, `water`, `campaign`), `src/terrain.ts`, `src/project.ts`, `src/bridge.ts`.

## Fonctionnement

1. **Site** : `npm install` puis `npm run dev` → http://localhost:5173
2. **Pont local** : `npm run bridge` (Node, port **5780**), qui relie le site au Workbench.
3. **Plugin Workbench** : copier `workbench/Mapgenerator/` comme addon dans
   `Documents/My Games/ArmaReforgerWorkbench/addons/`, puis l'ajouter dans le Workbench.
   Les plugins apparaissent dans le menu **MapGen** du World Editor :
   - `MapGen - Apply project` : applique le projet envoyé par le site
   - `MapGen - Apply heightmap`
   - `MapGen - Labels` (**Ctrl+Shift+L**) : labels de debug
   - `MapGen - Measure prefabs`
   - `MapGen - Regenerate MG_ shapes`
   - `MapGen - Register surfaces`
   - `MapGen - Stamp calibration`, `MapGen - Terrain probe`, `MapGen - Create test shapes`,
     `MapGen - Terrain write test` / `test 2` (outils de diagnostic)

## Documentation (`docs/`)

| Fichier | Contenu |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture : un seul outil, trois couches, des modules partageant un même projet |
| [ROADMAP.md](docs/ROADMAP.md) | Feuille de route et stack technique |
| [RESEARCH.md](docs/RESEARCH.md) | Dossier de recherche (BARNMAP, Map-generator, mapgen4, AgriFieldGenerator…) |
| [STATE_OF_ART.md](docs/STATE_OF_ART.md) | État de l'art de la génération / auto-remplissage de terrain (moteurs, outils, données, libs) |
| [CITIES.md](docs/CITIES.md) | Génération de villages et de villes : état de l'art et pipeline proposé |
| [GENERATORS.md](docs/GENERATORS.md) | Liste des prefabs générateurs vanilla du World Editor (`Prefabs/WEGenerators/`) |
| [ENFUSION_FORMATS.md](docs/ENFUSION_FORMATS.md) | Formats et API Enfusion (vérifiés / supposés) |
| [WIKI_TERRAIN.md](docs/WIKI_TERRAIN.md) | Synthèse du wiki Bohemia sur la création de terrain Reforger |
| [WORKSHOP_TERRAIN_MODS.md](docs/WORKSHOP_TERRAIN_MODS.md) | Étude des mods Workshop d'outillage terrain |
| [FINDINGS.md](docs/FINDINGS.md) | Trouvailles et pièges rencontrés (script Workbench, prefabs mesurés, eau, outillage) et reste à faire |
| [BENCHMARK_GIORBEV.md](docs/BENCHMARK_GIORBEV.md) | Analyse de l'outil de benchmark de giorbev |
| [FF_ET_SKILLS.md](docs/FF_ET_SKILLS.md) | Ce qu'on réutilise des skills Reforger / Freedom Fighters |

## Statut

**Travail en cours.** Prochaine étape : génération de **villages et villes** (voir [docs/CITIES.md](docs/CITIES.md)).

- Uniquement des **assets vanilla** : aucun contenu tiers n'est requis ni redistribué.
- Sources, inspirations et licences : voir [CREDITS.md](CREDITS.md).

## Licence et mentions

Code sous licence [MIT](LICENSE).

*Arma Reforger* et *Enfusion* sont des marques de **Bohemia Interactive**. Reforger Mapper est un **outil de fan non officiel**, sans lien avec Bohemia Interactive ni approuvé par elle.
